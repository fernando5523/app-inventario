/**
 * Muestra CHICA de las entidades de PRECIO de Dynamics, para decidir con
 * datos reales de donde sacar `CatalogoItem.precioVenta`.
 *
 * Hoy los 1.230 items del inventario 17 tienen `precioVenta` en NULL: el
 * snapshot trae stock pero no precio, asi que la columna de valor de la
 * auditoria y toda la liquidacion en plata dan cero.
 *
 * Mismo metodo que explorar-categorias.ts, y por la misma razon: este modulo
 * ya se construyo una vez sobre nombres "de manual" que no existian en este
 * tenant. Muestra chica primero, diseño despues.
 *
 * LO QUE HAY QUE MEDIR, en este orden:
 *   1. que entidad y que campo traen precio de VENTA
 *   2. cuantas filas traen un precio con valor real (no null, no 0)
 *   3. si hay UNA fila por item o VARIAS -- lo critico: con varias, un join
 *      ingenuo duplica items en las hojas de conteo.
 *
 *   npx tsx scripts/explorar-precios.ts
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ruta = resolve(import.meta.dirname, '..', '.env');
if (existsSync(ruta)) process.loadEnvFile(ruta);

import { d365AuthService } from '../src/modules/d365/d365-auth.service';

interface Candidata {
  entidad: string;
  select: string;
  /** Campo que deberia traer el precio de venta. */
  campoPrecio: string;
  /** Campo que identifica el producto, para medir duplicados. */
  campoItem: string;
  porque: string;
}

const CANDIDATAS: Candidata[] = [
  {
    entidad: 'ReleasedProductsV2',
    select: 'ItemNumber,SalesPrice',
    campoPrecio: 'SalesPrice',
    campoItem: 'ItemNumber',
    porque: 'LA MEJOR SI ANDA: ya la bajamos para el catalogo. Un campo mas, cero pedidos extra, 1:1 garantizado.',
  },
  {
    entidad: 'SalesPriceAgreements',
    select: 'ItemNumber,Price,PriceCurrencyCode,PriceWarehouseId,QuantityUnitySymbol',
    campoPrecio: 'Price',
    campoItem: 'ItemNumber',
    porque: 'La que usa monorepo/inventario contra ESTE mismo tenant. Ojo: tiene PriceWarehouseId, puede haber varias filas por item.',
  },
  {
    entidad: 'InventItemPrices',
    select: 'ItemNumber,Price,PriceType',
    campoPrecio: 'Price',
    campoItem: 'ItemNumber',
    porque: 'Precios por tipo (Cost/Sales). Respaldo si las otras dos no traen venta.',
  },
];

/** Cuantas filas traer para medir duplicados. Mismo tamaño que se uso con categorias. */
const MUESTRA_GRANDE = 2000;

async function pedir(entidad: string, select: string, top: number): Promise<Record<string, unknown>[] | null> {
  const base = await d365AuthService.getODataBaseUrl();
  const token = await d365AuthService.getTokenValido();
  const url = `${base}/${entidad}?$select=${encodeURIComponent(select)}&$top=${top}`;

  const r = await fetch(url, { headers: { Authorization: token, Accept: 'application/json' } });
  if (!r.ok) {
    console.log(`    [HTTP ${r.status}] ${(await r.text()).slice(0, 200)}`);
    return null;
  }
  const { value } = (await r.json()) as { value: Record<string, unknown>[] };
  return value;
}

function tienePrecioReal(fila: Record<string, unknown>, campo: string): boolean {
  const v = fila[campo];
  if (v === null || v === undefined) return false;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0;
}

async function probar(c: Candidata): Promise<void> {
  console.log(`\n=== ${c.entidad} [${c.select}] ===`);
  console.log(`    ${c.porque}`);

  const muestra = await pedir(c.entidad, c.select, 5);
  if (muestra === null) return;
  if (muestra.length === 0) {
    console.log('    (0 filas: la entidad existe pero esta vacia)');
    return;
  }
  console.log('    5 primeras filas:');
  for (const f of muestra) console.log(`      ${JSON.stringify(f)}`);

  // --- Medicion sobre muestra grande ---
  const grande = await pedir(c.entidad, c.select, MUESTRA_GRANDE);
  if (grande === null || grande.length === 0) return;

  const conPrecio = grande.filter((f) => tienePrecioReal(f, c.campoPrecio)).length;
  const items = grande.map((f) => String(f[c.campoItem] ?? ''));
  const distintos = new Set(items).size;
  const duplicados = items.length - distintos;

  // Cuantas filas tiene el item que MAS filas tiene: dice cuan grave es el
  // duplicado si lo hay.
  const porItem = new Map<string, number>();
  for (const i of items) porItem.set(i, (porItem.get(i) ?? 0) + 1);
  const maxFilas = Math.max(...porItem.values());
  const ejemploDup = [...porItem.entries()].find(([, n]) => n > 1);

  console.log(`    filas en la muestra:     ${grande.length}`);
  console.log(`    con precio > 0:          ${conPrecio} (${((conPrecio / grande.length) * 100).toFixed(1)}%)`);
  console.log(`    items distintos:         ${distintos}`);
  console.log(`    FILAS DUPLICADAS:        ${duplicados}  -> ${duplicados === 0 ? '1:1, se puede cruzar directo' : 'HAY VARIAS FILAS POR ITEM'}`);
  console.log(`    max filas de un item:    ${maxFilas}`);
  if (ejemploDup) {
    const [item] = ejemploDup;
    const filasDelItem = grande.filter((f) => String(f[c.campoItem]) === item).slice(0, 4);
    console.log(`    ejemplo duplicado (${item}):`);
    for (const f of filasDelItem) console.log(`      ${JSON.stringify(f)}`);
  }
}

async function main(): Promise<void> {
  for (const c of CANDIDATAS) {
    try {
      await probar(c);
    } catch (e) {
      console.log(`    ERROR: ${(e as Error).message.slice(0, 200)}`);
    }
  }
}

main();
