/**
 * Muestra CHICA de las entidades de categoria de Dynamics, para decidir con
 * datos reales cual sirve para ordenar las hojas de conteo.
 *
 * POR QUE UNA MUESTRA Y NO LA BAJADA ENTERA: este mismo modulo ya se
 * construyo una vez sobre nombres "de manual" (`ReleasedProducts`,
 * `ProductBarcodes`) y ninguno existia en este ambiente. La regla que salio
 * de ahi: contra el tenant real, muestra chica primero, diseño despues.
 *
 * Va por `fetch` directo y no por `d365EntityService.obtenerTodos`: ese
 * metodo pagina la entidad ENTERA (sobrescribe `$top` al armar cada pagina),
 * que es lo correcto para bajar un catalogo y exactamente lo que no se
 * quiere para mirar cinco filas.
 *
 *   npx tsx scripts/explorar-categorias.ts
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ruta = resolve(import.meta.dirname, '..', '.env');
if (existsSync(ruta)) process.loadEnvFile(ruta);

import { d365AuthService } from '../src/modules/d365/d365-auth.service';
import { prisma } from '../src/config/database';

/** Cada candidata: la entidad, los campos que se piden y por que interesa. */
const CANDIDATAS = [
  {
    entidad: 'ProductCategoryAssignments',
    select: 'ProductNumber,ProductCategoryHierarchyName,ProductCategoryName',
    porque: 'La que usa app_inventarioautomatico para agrupar el reporte.',
  },
  {
    entidad: 'ReleasedProductsV2',
    select: 'ItemNumber,ProductName,RetailProductCategoryName',
    porque: 'Ya la consultamos para el catalogo: si trae categoria, es una entidad menos.',
  },
  {
    entidad: 'ReleasedProductsV2',
    select: 'ItemNumber,ProductName,ItemModelGroupId,ProductGroupId',
    porque: 'Agrupadores alternativos, por si la categoria retail viene vacia.',
  },
];

async function probar(c: (typeof CANDIDATAS)[number]): Promise<void> {
  console.log(`\n--- ${c.entidad} [${c.select}] ---`);
  console.log(`    ${c.porque}`);

  const base = await d365AuthService.getODataBaseUrl();
  const token = await d365AuthService.getTokenValido();
  const url = `${base}/${c.entidad}?$select=${encodeURIComponent(c.select)}&$top=5`;

  try {
    const r = await fetch(url, { headers: { Authorization: token, Accept: 'application/json' } });
    if (!r.ok) {
      console.log(`    [HTTP ${r.status}] ${(await r.text()).slice(0, 180)}`);
      return;
    }
    const { value } = (await r.json()) as { value: Array<Record<string, unknown>> };
    if (value.length === 0) {
      console.log('    [VACIO] responde pero no devolvio filas.');
      return;
    }

    console.log(`    [OK] ${value.length} filas:`);
    for (const f of value) console.log('      ', JSON.stringify(f));

    // Lo que decide si sirve: cuantas filas traen el campo con valor real.
    // Una entidad que responde 200 con todos los campos vacios no sirve para
    // ordenar nada, y es el modo en que estas cosas fallan sin avisar.
    console.log('    --- cuantas con valor ---');
    for (const campo of Object.keys(value[0] as object)) {
      const conValor = value.filter((f) => f[campo] !== null && f[campo] !== '' && f[campo] !== undefined).length;
      console.log(`      ${campo.padEnd(34)} ${conValor}/${value.length}`);
    }
  } catch (e) {
    console.log(`    [FALLA] ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
  }
}

async function main(): Promise<void> {
  for (const c of CANDIDATAS) await probar(c);
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
