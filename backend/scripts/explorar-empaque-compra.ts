/**
 * COMPUERTA: ¿existe en Dynamics el EMPAQUE DE COMPRA de un producto, y con
 * que numero?
 *
 * Sin ese dato, la regla del faltante por paquete se queda sin insumo. Gilmer
 * [reunion 2] la aterrizo en el ERP y fue explicito tres veces: "lo que estoy
 * hablando aca es el empaque de compra, que no se base al empaque de venta" y
 * "eso depende de lo que hayan marcado en Dynamics, si ellos lo tienen
 * marcado 540, te va a decir 540". Su ejemplo: un chocolate con empaque de
 * COMPRA 540 y display de VENTA 20. Con esa diferencia, medir "media unidad
 * de paquete" contra el de venta da un resultado completamente distinto: 10
 * unidades faltantes son media caja de venta (se le descuenta al trabajador)
 * o 1/54 de la de compra (no se le descuenta).
 *
 * QUE SE SABE HOY, y por que no alcanza:
 *   - `ReleasedProductsV2` trae `PurchaseUnitSymbol`: el NOMBRE de la unidad
 *     de compra ("Emp.12", "CJ"), no su factor.
 *   - `ProductSpecificUnitOfMeasureConversions` trae los FACTORES, pero el
 *     catalogo los toma TODOS los que tengan Factor != 1 y los ordena de
 *     mayor a menor, sin distinguir cual es de compra y cual de venta.
 * O sea que el factor puede estar ahi y nadie lo esta identificando como "el
 * de compra". Eso es lo que este script mide.
 *
 * LO QUE HAY QUE RESPONDER, en este orden:
 *   1. que campos de unidad expone ReleasedProductsV2 en ESTE tenant
 *      (se vuelca una fila entera: nada de nombres "de manual");
 *   2. si el PurchaseUnitSymbol de un producto aparece como FromUnitSymbol
 *      en sus conversiones -- que es lo que le daria factor;
 *   3. CUANTOS productos tienen empaque de compra DISTINTO del de venta, que
 *      es el caso que importa, con ejemplos reales;
 *   4. si hay alguna otra entidad que exponga el factor de compra directo.
 *
 * SOLO LECTURA. No escribe en Dynamics ni en la base.
 *
 *   npx tsx scripts/explorar-empaque-compra.ts
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ruta = resolve(import.meta.dirname, '..', '.env');
if (existsSync(ruta)) process.loadEnvFile(ruta);

import { d365AuthService } from '../src/modules/d365/d365-auth.service';

type Fila = Record<string, unknown>;

/**
 * Trae TODAS las filas de un recurso, paginando.
 *
 * NO es un lujo: `ProductSpecificUnitOfMeasureConversions` tiene 37.690 filas
 * y OData corta en 10.000 por pedido. Medir con un solo `$top=10000` deja a
 * tres cuartos del catalogo sin sus conversiones, y entonces "este producto
 * no tiene una conversion mas grande" significa en realidad "no la traje".
 * Con ese recorte esta misma medicion llego a decir que el empaque de compra
 * nunca difiere del que guarda hoy el catalogo -- y difiere (item 101127).
 */
async function pedirTodo(recurso: string, select: string, porPagina = 10000): Promise<Fila[] | null> {
  const filas: Fila[] = [];
  for (let skip = 0; ; skip += porPagina) {
    const pagina = await pedir(
      `${recurso}?$select=${encodeURIComponent(select)}&$top=${porPagina}&$skip=${skip}`,
    );
    if (pagina === null) return filas.length > 0 ? filas : null;
    filas.push(...pagina);
    if (pagina.length < porPagina) return filas;
  }
}

async function pedir(recurso: string): Promise<Fila[] | null> {
  const base = await d365AuthService.getODataBaseUrl();
  const token = await d365AuthService.getTokenValido();
  const r = await fetch(`${base}/${recurso}`, {
    headers: { Authorization: token, Accept: 'application/json' },
  });
  if (!r.ok) {
    console.log(`    [HTTP ${r.status}] ${(await r.text()).slice(0, 240)}`);
    return null;
  }
  const { value } = (await r.json()) as { value: Fila[] };
  return value;
}

/** El dataAreaId de la empresa, que acota TODAS las consultas. */
const AREA = process.env['D365_DATA_AREA_ID'] ?? 'trv';
const filtroArea = `$filter=${encodeURIComponent(`dataAreaId eq '${AREA}'`)}`;

// ===========================================================================
async function paso1CamposDeUnidad(): Promise<void> {
  console.log('\n=== PASO 1: que campos de unidad expone ReleasedProductsV2 ===');
  // SIN $select: se vuelca una fila entera para ver los nombres REALES de los
  // campos en este tenant. Este modulo ya se construyo una vez sobre nombres
  // "de manual" que no existian aca.
  const filas = await pedir(`ReleasedProductsV2?${filtroArea}&$top=1`);
  if (filas === null || filas.length === 0) {
    console.log('    (sin filas)');
    return;
  }
  const claves = Object.keys(filas[0]!).sort();
  const deUnidad = claves.filter((k) => /unit|uom|measure|packag|quantity/i.test(k));
  console.log(`    ${claves.length} campos en total. Los que hablan de unidad/empaque:`);
  for (const k of deUnidad) console.log(`      ${k} = ${JSON.stringify(filas[0]![k])}`);
}

// ===========================================================================
/**
 * LA TRAMPA QUE HAY QUE ESQUIVAR: un mismo `FromUnitSymbol` tiene VARIAS
 * filas de conversion, una por cada unidad destino. Caso real (item 100016):
 *
 *   Emp.48 -> Emp.12  Factor 4
 *   Emp.48 -> U       Factor 48
 *   Emp.48 -> U.      Factor 48
 *
 * Tomar "la primera fila que coincida" devuelve 4 -- cuantos Emp.12 entran en
 * un Emp.48 --, no 48. El numero que hace falta es SIEMPRE el que va a la
 * unidad BASE (la suelta), porque el conteo se hace en unidades sueltas y el
 * umbral compara unidades faltantes contra el tamano del paquete.
 *
 * "U" y "U." son la misma unidad escrita distinto (el catalogo ya lo
 * documenta: la conversion U->U. con Factor 1 existe justamente por eso), asi
 * que las dos sirven de destino.
 */
function esUnidadBase(simbolo: string): boolean {
  return /^u\.?$/i.test(simbolo.trim());
}

async function paso2ConversionesDeCompra(): Promise<void> {
  console.log('\n=== PASO 2: el PurchaseUnitSymbol, ¿tiene factor A LA UNIDAD BASE? ===');

  const productos = await pedir(
    `ReleasedProductsV2?${filtroArea}&$select=${encodeURIComponent(
      'ItemNumber,PurchaseUnitSymbol,InventoryUnitSymbol,SalesUnitSymbol',
    )}&$top=2000`,
  );
  if (productos === null || productos.length === 0) return;

  const conversiones = await pedirTodo(
    'ProductSpecificUnitOfMeasureConversions',
    'ProductNumber,FromUnitSymbol,ToUnitSymbol,Factor',
  );
  if (conversiones === null) return;
  console.log(`    conversiones traidas (paginadas): ${conversiones.length}`);

  const porProducto = new Map<string, Fila[]>();
  for (const c of conversiones) {
    const k = String(c['ProductNumber'] ?? '');
    porProducto.set(k, [...(porProducto.get(k) ?? []), c]);
  }

  /** El factor de `simbolo` A LA UNIDAD BASE, o null si no hay esa conversion. */
  const factorABase = (item: string, simbolo: string): number | null => {
    const fila = (porProducto.get(item) ?? []).find(
      (c) => String(c['FromUnitSymbol']) === simbolo && esUnidadBase(String(c['ToUnitSymbol'])),
    );
    return fila === undefined ? null : Number(fila['Factor']);
  };

  /** Lo que el catalogo guarda HOY como empaque: el mayor factor, sin mirar destino. */
  const mayorFactorDeHoy = (item: string): number | null => {
    const factores = (porProducto.get(item) ?? [])
      .map((c) => Number(c['Factor']))
      .filter((f) => Number.isFinite(f) && f !== 1);
    return factores.length === 0 ? null : Math.max(...factores);
  };

  let conConversiones = 0;
  let compraConFactor = 0;
  let compraSinFactorPeroConNumeroEnElNombre = 0;
  let sinNadaDeNada = 0;
  const distintosDeVenta: Array<{ item: string; compra: string; f: number; venta: string; fv: number }> = [];
  const difieren: Array<{ item: string; compra: string; f: number; hoy: number }> = [];
  const factores = new Map<number, number>();

  for (const p of productos) {
    const item = String(p['ItemNumber'] ?? '');
    const compra = String(p['PurchaseUnitSymbol'] ?? '');
    const venta = String(p['SalesUnitSymbol'] ?? '');
    if (porProducto.has(item)) conConversiones += 1;

    const f = compra === '' ? null : factorABase(item, compra);
    if (f !== null) {
      compraConFactor += 1;
      factores.set(f, (factores.get(f) ?? 0) + 1);

      const fv = venta === '' ? null : esUnidadBase(venta) ? 1 : factorABase(item, venta);
      if (fv !== null && fv !== f) distintosDeVenta.push({ item, compra, f, venta, fv });

      const hoy = mayorFactorDeHoy(item);
      if (hoy !== null && hoy !== f) difieren.push({ item, compra, f, hoy });
    } else {
      // RESPALDO que el catalogo ya usa: el numero adentro del nombre
      // ("Emp.12" -> 12). Ver dominio/empaque.ts#factorDesdeSimbolo.
      const enElNombre = /(\d+(?:[.,]\d+)?)/.exec(compra);
      if (enElNombre) compraSinFactorPeroConNumeroEnElNombre += 1;
      else sinNadaDeNada += 1;
    }
  }

  console.log(`    productos mirados:                            ${productos.length}`);
  console.log(`    con alguna conversion cargada:                ${conConversiones}`);
  console.log(`    con factor de COMPRA a la unidad base:        ${compraConFactor}`);
  console.log(`    sin factor, pero con el numero en el nombre:  ${compraSinFactorPeroConNumeroEnElNombre}`);
  console.log(`    SIN NINGUN NUMERO DE COMPRA:                  ${sinNadaDeNada}`);
  console.log(`    empaque de compra != de venta:                ${distintosDeVenta.length}`);

  const orden = [...factores.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`    factores de compra mas frecuentes: ${orden.slice(0, 8).map(([f, n]) => `${f}x(${n})`).join(', ')}`);
  const grandes = [...factores.keys()].sort((a, b) => b - a).slice(0, 6);
  console.log(`    los factores mas GRANDES que existen: ${grandes.join(', ')}`);

  console.log(`\n    ejemplos de compra != venta:`);
  for (const d of distintosDeVenta.slice(0, 5)) {
    console.log(`      item ${d.item}: compra "${d.compra}"=${d.f}  |  venta "${d.venta}"=${d.fv}`);
  }

  /**
   * LO MAS IMPORTANTE DE ESTE PASO: donde el empaque de COMPRA no coincide
   * con lo que el catalogo guarda HOY como empaque (el mayor factor de las
   * conversiones, sin mirar a que unidad va). Cada una de estas filas es un
   * producto donde medir el umbral con el dato de hoy daria un resultado
   * distinto del que pidio el cliente.
   */
  console.log(`\n    productos donde el empaque de COMPRA != el que guarda hoy el catalogo: ${difieren.length}`);
  for (const d of difieren.slice(0, 10)) {
    console.log(`      item ${d.item}: compra "${d.compra}"=${d.f}  |  catalogo hoy=${d.hoy}`);
  }
}

// ===========================================================================
async function paso3OtrasEntidades(): Promise<void> {
  console.log('\n=== PASO 3: ¿alguna entidad expone el factor de compra directo? ===');
  const candidatas = [
    {
      recurso: `ProductDefaultOrderSettings?$top=3`,
      porque: 'Los defaults de compra por producto: suele traer la cantidad por pedido/multiplo.',
    },
    {
      recurso: `ProductSpecificUnitOfMeasureConversions?$top=3`,
      porque: 'La que ya se usa: se vuelca entera para ver si distingue el proposito de la conversion.',
    },
    {
      recurso: `UnitOfMeasureConversions?$top=3`,
      porque: 'Conversiones GENERICAS (no por producto). Respaldo si las especificas no alcanzan.',
    },
  ];

  for (const c of candidatas) {
    console.log(`\n    --- ${c.recurso.split('?')[0]} ---`);
    console.log(`        ${c.porque}`);
    const filas = await pedir(c.recurso);
    if (filas === null) continue;
    if (filas.length === 0) {
      console.log('        (0 filas: existe pero esta vacia)');
      continue;
    }
    console.log(`        campos: ${Object.keys(filas[0]!).join(', ')}`);
    for (const f of filas.slice(0, 2)) console.log(`        ${JSON.stringify(f).slice(0, 400)}`);
  }
}

// ===========================================================================
/**
 * COBERTURA REAL Y EL EJEMPLO DE GILMER.
 *
 * Los porcentajes del paso 2 salen de los primeros 2.000 items; el catalogo
 * real tiene ~11.800. Y sobre todo: hace falta saber QUE son los productos
 * que no tienen numero de compra, porque de eso depende si la regla se puede
 * aplicar a todos o solo a una parte.
 */
async function paso4CoberturaYEl540(): Promise<void> {
  console.log('\n=== PASO 4: cobertura sobre el catalogo entero, y el 540 de Gilmer ===');

  const contar = async (recurso: string): Promise<string> => {
    const base = await d365AuthService.getODataBaseUrl();
    const token = await d365AuthService.getTokenValido();
    const r = await fetch(`${base}/${recurso}`, { headers: { Authorization: token, Accept: 'text/plain' } });
    return r.ok ? (await r.text()).trim() : `[HTTP ${r.status}]`;
  };
  console.log(`    productos (ReleasedProductsV2):    ${await contar(`ReleasedProductsV2/$count?${filtroArea}`)}`);
  console.log(`    conversiones especificas:          ${await contar('ProductSpecificUnitOfMeasureConversions/$count')}`);

  // --- QUE SON los que no tienen factor de compra ---
  const productos = await pedir(
    `ReleasedProductsV2?${filtroArea}&$select=${encodeURIComponent('ItemNumber,PurchaseUnitSymbol')}&$top=2000`,
  );
  const conversiones = await pedirTodo(
    'ProductSpecificUnitOfMeasureConversions',
    'ProductNumber,FromUnitSymbol,ToUnitSymbol,Factor',
  );
  if (productos === null || conversiones === null) return;

  const base = new Map<string, Set<string>>();
  for (const c of conversiones) {
    if (!esUnidadBase(String(c['ToUnitSymbol']))) continue;
    const k = String(c['ProductNumber'] ?? '');
    base.set(k, (base.get(k) ?? new Set()).add(String(c['FromUnitSymbol'])));
  }

  const simbolosSinFactor = new Map<string, number>();
  for (const p of productos) {
    const item = String(p['ItemNumber'] ?? '');
    const compra = String(p['PurchaseUnitSymbol'] ?? '');
    if (base.get(item)?.has(compra)) continue;
    if (/(\d)/.test(compra)) continue; // el numero esta en el nombre: hay respaldo
    simbolosSinFactor.set(compra, (simbolosSinFactor.get(compra) ?? 0) + 1);
  }
  const orden = [...simbolosSinFactor.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n    QUE unidad de compra tienen los que se quedan sin numero:`);
  for (const [simbolo, n] of orden.slice(0, 8)) {
    console.log(`      "${simbolo}": ${n} producto(s)`);
  }

  // --- el 540 del ejemplo ---
  const con540 = conversiones.filter((c) => Number(c['Factor']) === 540);
  console.log(`\n    conversiones con Factor 540 en la muestra: ${con540.length}`);
  for (const c of con540.slice(0, 3)) console.log(`      ${JSON.stringify(c)}`);

  const grandes = conversiones
    .filter((c) => esUnidadBase(String(c['ToUnitSymbol'])) && Number(c['Factor']) >= 200)
    .sort((a, b) => Number(b['Factor']) - Number(a['Factor']));
  console.log(`\n    los empaques MAS GRANDES a unidad base (>=200), que son los que mueven la regla:`);
  for (const c of grandes.slice(0, 6)) {
    console.log(`      item ${c['ProductNumber']}: "${c['FromUnitSymbol']}" = ${c['Factor']}`);
  }
}

async function main(): Promise<void> {
  console.log(`Empresa (dataAreaId): ${AREA}`);
  for (const paso of [paso1CamposDeUnidad, paso2ConversionesDeCompra, paso3OtrasEntidades, paso4CoberturaYEl540]) {
    try {
      await paso();
    } catch (e) {
      console.log(`    ERROR: ${(e as Error).message.slice(0, 240)}`);
    }
  }
}

main();
