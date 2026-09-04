/**
 * La pregunta que decide si `ProductCategoryAssignments` se puede usar para
 * ordenar las hojas: ¿un producto puede tener MAS DE UNA asignacion?
 *
 * Si la respuesta es si y se hace un join ingenuo, cada producto con dos
 * categorias aparece DOS VECES en las hojas de conteo. Nadie lo nota al
 * revisar el codigo -- se nota en tienda, contando el mismo producto dos
 * veces, y el descuadre aparece recien en la auditoria.
 *
 * Tambien mide el volumen: si son 100.000 asignaciones, la bajada tiene que
 * filtrarse por jerarquia, no traerse entera.
 *
 *   npx tsx scripts/explorar-categorias-detalle.ts
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ruta = resolve(import.meta.dirname, '..', '.env');
if (existsSync(ruta)) process.loadEnvFile(ruta);

import { d365AuthService } from '../src/modules/d365/d365-auth.service';
import { prisma } from '../src/config/database';

async function odata<T>(camino: string): Promise<T> {
  const base = await d365AuthService.getODataBaseUrl();
  const token = await d365AuthService.getTokenValido();
  const r = await fetch(`${base}/${camino}`, { headers: { Authorization: token, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
}

interface Asignacion {
  ProductNumber: string;
  ProductCategoryHierarchyName: string;
  ProductCategoryName: string;
}

async function main(): Promise<void> {
  console.log('\n=== ProductCategoryAssignments: volumen y unicidad ===\n');

  const { '@odata.count': total } = await odata<{ '@odata.count': number }>(
    'ProductCategoryAssignments/$count',
  ).catch(async () => {
    // $count devuelve texto plano en F&O, no JSON: se lee aparte.
    const base = await d365AuthService.getODataBaseUrl();
    const token = await d365AuthService.getTokenValido();
    const r = await fetch(`${base}/ProductCategoryAssignments/$count`, {
      headers: { Authorization: token },
    });
    return { '@odata.count': Number((await r.text()).trim()) };
  });
  console.log(`Total de asignaciones: ${total}`);

  // Muestra grande para medir la duplicacion. 2.000 alcanza para ver el
  // patron sin bajar la entidad entera.
  const { value } = await odata<{ value: Asignacion[] }>(
    'ProductCategoryAssignments?$select=ProductNumber,ProductCategoryHierarchyName,ProductCategoryName&$top=2000',
  );
  console.log(`Muestra: ${value.length} filas\n`);

  const jerarquias = new Map<string, number>();
  for (const a of value) jerarquias.set(a.ProductCategoryHierarchyName, (jerarquias.get(a.ProductCategoryHierarchyName) ?? 0) + 1);
  console.log('--- jerarquias presentes ---');
  for (const [j, n] of [...jerarquias].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${j}`);

  const porProducto = new Map<string, Asignacion[]>();
  for (const a of value) {
    const lista = porProducto.get(a.ProductNumber) ?? [];
    lista.push(a);
    porProducto.set(a.ProductNumber, lista);
  }
  const conVarias = [...porProducto.entries()].filter(([, l]) => l.length > 1);
  console.log(`\n--- unicidad ---`);
  console.log(`  productos distintos en la muestra: ${porProducto.size}`);
  console.log(`  con MAS DE UNA asignacion:         ${conVarias.length}`);
  if (conVarias.length > 0) {
    console.log('\n  ejemplos (esto es lo que duplicaria items en las hojas):');
    for (const [prod, lista] of conVarias.slice(0, 5)) {
      console.log(`    ${prod}:`);
      for (const a of lista) console.log(`      [${a.ProductCategoryHierarchyName}] ${a.ProductCategoryName}`);
    }
  }

  // Y la pregunta siguiente: DENTRO de una sola jerarquia, ¿sigue habiendo
  // duplicados? Si no los hay, filtrar por jerarquia resuelve el problema.
  for (const jerarquia of jerarquias.keys()) {
    const deEsta = value.filter((a) => a.ProductCategoryHierarchyName === jerarquia);
    const productos = new Set(deEsta.map((a) => a.ProductNumber));
    const dupes = deEsta.length - productos.size;
    console.log(`\n  dentro de "${jerarquia}": ${deEsta.length} filas / ${productos.size} productos → ${dupes} duplicados`);
  }

  const categorias = new Set(value.map((a) => a.ProductCategoryName));
  console.log(`\n--- categorias distintas en la muestra: ${categorias.size} ---`);
  console.log('  ' + [...categorias].slice(0, 25).join(' · '));
  console.log('');
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e: unknown) => {
    console.error('[ERROR]', e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });
