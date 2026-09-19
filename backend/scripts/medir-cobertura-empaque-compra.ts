/**
 * ¿A CUANTOS ITEMS DEL CATALOGO REAL SE LES PUEDE APLICAR LA REGLA DEL
 * FALTANTE POR PAQUETE? Medicion sobre el catalogo COMPLETO, no una muestra.
 *
 * ---------------------------------------------------------------------------
 * POR QUE IMPORTA, Y POR QUE SOBRE EL CATALOGO ENTERO
 * ---------------------------------------------------------------------------
 * La regla del cliente (Gilmer, reunion 2) necesita un denominador: el
 * EMPAQUE DE COMPRA. Un item sin ese numero no puede entrar a la regla, y el
 * tratamiento que le queda es el de siempre -- se le descuenta el faltante
 * ENTERO al personal. O sea que cada NULL es plata que alguien va a pagar.
 *
 * Una muestra de 2.000 items dijo 97,5% de cobertura. Eso no alcanza para
 * decidir: en produccion son 11 tiendas de ~9.400 items, y esta misma
 * medicion YA SALIO FALSA UNA VEZ por un corte de paginacion de OData (se
 * trajeron 10.000 de 37.690 conversiones y el resultado dijo, con total
 * aplomo, que el empaque de compra nunca difiere del que guarda el catalogo).
 * Por eso acá se pagina con `d365EntityService.obtenerTodos` -- el MISMO
 * camino que usa el snapshot -- y ademas se compara lo traido contra el
 * `$count` del servidor, para que un corte se vea en vez de disfrazarse de
 * resultado.
 *
 * ---------------------------------------------------------------------------
 * MIDE CON LAS FUNCIONES DE PRODUCCION, NO CON UNA COPIA
 * ---------------------------------------------------------------------------
 * `empaqueDeCompra` y `clasificarItem` se importan del servicio. Una
 * reimplementacion "parecida" mediria otra cosa y daria una cobertura que no
 * es la que el snapshot va a producir -- que es justamente el numero que se
 * quiere saber.
 *
 * SOLO LECTURA: no escribe en la base ni en Dynamics, no toma snapshots.
 *
 *   npx tsx scripts/medir-cobertura-empaque-compra.ts
 *   npx tsx scripts/medir-cobertura-empaque-compra.ts --todos   (sin filtrar por responsable)
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rutaEnv = resolve(import.meta.dirname, '..', '.env');
if (existsSync(rutaEnv)) process.loadEnvFile(rutaEnv);

import { d365AuthService } from '../src/modules/d365/d365-auth.service';
import { d365EntityService } from '../src/modules/d365/d365-entity.service';
import {
  agruparConversionesPorProducto,
  agruparResponsablesPorItem,
  clasificarItem,
  empaqueDeCompra,
} from '../src/modules/d365/d365-catalogo.service';
import type {
  D365ReleasedProduct,
  D365ResponsableItem,
  D365UnitConversion,
} from '../src/modules/d365/d365.types';

/** El mismo valor crudo que filtra el snapshot (ver `seCuenta`). */
const RESPONSABLE_EMPLEADO = 'Employee';

/**
 * POR QUE un item se queda sin empaque de compra. No es lo mismo "se compra
 * por unidad" que "no se sabe": el primero es un dato y el segundo es un
 * agujero, y los dos terminan en `clase = unidad`.
 */
type MotivoNulo =
  | 'sin_simbolo_de_compra'
  | 'simbolo_sin_conversion_ni_numero';

const EXPLICACION: Record<MotivoNulo, string> = {
  sin_simbolo_de_compra: 'el item no tiene PurchaseUnitSymbol en el ERP',
  simbolo_sin_conversion_ni_numero:
    'tiene simbolo de compra, pero ni conversion a la unidad base ni numero en el nombre',
};

function motivoDelNulo(producto: D365ReleasedProduct): MotivoNulo {
  const simbolo = (producto.PurchaseUnitSymbol ?? '').trim();
  return simbolo === '' ? 'sin_simbolo_de_compra' : 'simbolo_sin_conversion_ni_numero';
}

/** Cuenta ocurrencias y guarda hasta `maxEjemplos` ejemplos por clave. */
class Agrupador<K> {
  readonly cuenta = new Map<K, number>();
  readonly ejemplos = new Map<K, string[]>();
  constructor(private readonly maxEjemplos = 5) {}
  sumar(clave: K, ejemplo: string): void {
    this.cuenta.set(clave, (this.cuenta.get(clave) ?? 0) + 1);
    const lista = this.ejemplos.get(clave) ?? [];
    if (lista.length < this.maxEjemplos) this.ejemplos.set(clave, [...lista, ejemplo]);
  }
}

const pct = (parte: number, total: number): string =>
  total === 0 ? '0.0%' : `${((parte / total) * 100).toFixed(2)}%`;

async function main(): Promise<void> {
  const sinFiltro = process.argv.includes('--todos');
  const dataAreaId = await d365AuthService.getDataAreaId();
  const filtroCompania = dataAreaId ? `dataAreaId eq '${dataAreaId}'` : undefined;

  console.log(`Empresa (dataAreaId): ${dataAreaId ?? '(sin filtro)'}`);
  console.log(`Filtro de responsable: ${sinFiltro ? 'NINGUNO (--todos)' : 'solo Employee, como el inventario mensual'}\n`);

  // -------------------------------------------------------------------------
  // BAJADA, paginada por el mismo camino que el snapshot
  // -------------------------------------------------------------------------
  console.log('Bajando el catalogo completo...');

  const [productos, conversiones, responsables] = await Promise.all([
    d365EntityService.obtenerTodos<D365ReleasedProduct>('ReleasedProductsV2', {
      $select: 'ItemNumber,SearchName,InventoryUnitSymbol,PurchaseUnitSymbol',
      ...(filtroCompania ? { $filter: filtroCompania } : {}),
    }),
    d365EntityService.obtenerTodos<D365UnitConversion>('ProductSpecificUnitOfMeasureConversions', {
      $select: 'ProductNumber,FromUnitSymbol,ToUnitSymbol,Factor',
    }),
    d365EntityService.obtenerTodos<D365ResponsableItem>('TRU_InventoryManagerPEEntities', {
      $select: 'ItemId,ModuleType,TRU_InventoryManagerPE',
    }),
  ]);

  /**
   * LA GUARDA QUE FALTO LA VEZ PASADA: se compara lo traido contra el
   * `$count` del servidor. Si OData corta, el numero aparece acá con nombre y
   * apellido en vez de convertirse en una conclusion falsa.
   */
  const controles: Array<{ entidad: string; traidas: number; declaradas: number }> = [
    { entidad: 'ReleasedProductsV2', traidas: productos.length, declaradas: await d365EntityService.contar('ReleasedProductsV2', filtroCompania) },
    { entidad: 'ProductSpecificUnitOfMeasureConversions', traidas: conversiones.length, declaradas: await d365EntityService.contar('ProductSpecificUnitOfMeasureConversions') },
    { entidad: 'TRU_InventoryManagerPEEntities', traidas: responsables.length, declaradas: await d365EntityService.contar('TRU_InventoryManagerPEEntities') },
  ];

  console.log('\n== INTEGRIDAD DE LA BAJADA (traido contra $count del servidor) ==');
  let hayCorte = false;
  for (const c of controles) {
    const completo = c.traidas === c.declaradas;
    if (!completo) hayCorte = true;
    console.log(`  ${completo ? '[OK]   ' : '[CORTE]'} ${c.entidad}: ${c.traidas} de ${c.declaradas}`);
  }
  if (hayCorte) {
    console.log('\n  ATENCION: la bajada quedo incompleta. Los porcentajes de abajo NO son confiables.');
  }

  // -------------------------------------------------------------------------
  // FILTRO: el mismo universo que cuenta el inventario mensual
  // -------------------------------------------------------------------------
  const responsablePorItem = agruparResponsablesPorItem(responsables);
  const conversionesPorItem = agruparConversionesPorProducto(conversiones);

  const universo = sinFiltro
    ? productos
    : productos.filter((p) => responsablePorItem.get(p.ItemNumber) === RESPONSABLE_EMPLEADO);

  console.log('\n== EL UNIVERSO ==');
  console.log(`  productos en el ERP:            ${productos.length}`);
  console.log(`  con responsable = Employee:     ${universo.length}  (${pct(universo.length, productos.length)})`);
  console.log(`  -> este es el universo que se cuenta en un inventario mensual`);

  // -------------------------------------------------------------------------
  // COBERTURA
  // -------------------------------------------------------------------------
  const nulos = new Agrupador<MotivoNulo>();
  const simbolosSinResolver = new Agrupador<string>(3);
  const tamanos = new Agrupador<number>(3);
  let resueltos = 0;
  let clasePaquete = 0;
  let unidadDeVerdad = 0;
  let unidadPorFaltaDeDato = 0;
  const ejemplosUnidadReal: string[] = [];

  for (const producto of universo) {
    const conversionesDelItem = conversionesPorItem.get(producto.ItemNumber) ?? [];
    const compra = empaqueDeCompra(conversionesDelItem, producto);
    const clase = clasificarItem(false, compra?.unidades ?? null);

    if (compra === null) {
      const motivo = motivoDelNulo(producto);
      nulos.sumar(motivo, producto.ItemNumber);
      simbolosSinResolver.sumar((producto.PurchaseUnitSymbol ?? '').trim() || '(vacio)', producto.ItemNumber);
      unidadPorFaltaDeDato += 1;
      continue;
    }

    resueltos += 1;
    tamanos.sumar(compra.unidades, producto.ItemNumber);
    if (clase === 'paquete') clasePaquete += 1;
    else {
      // Resuelto en 1: se compra por unidad. Es un DATO, no un agujero.
      unidadDeVerdad += 1;
      if (ejemplosUnidadReal.length < 5) ejemplosUnidadReal.push(`${producto.ItemNumber} ("${compra.simbolo}")`);
    }
  }

  const total = universo.length;
  console.log('\n== COBERTURA DEL EMPAQUE DE COMPRA ==');
  console.log(`  resuelven empaque de compra:    ${resueltos}  (${pct(resueltos, total)})`);
  console.log(`  quedan en NULL:                 ${unidadPorFaltaDeDato}  (${pct(unidadPorFaltaDeDato, total)})`);

  console.log('\n  POR QUE quedan en NULL:');
  for (const [motivo, n] of [...nulos.cuenta].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${motivo}: ${n} (${pct(n, total)}) -- ${EXPLICACION[motivo]}`);
    console.log(`      ejemplos: ${(nulos.ejemplos.get(motivo) ?? []).join(', ')}`);
  }
  if (simbolosSinResolver.cuenta.size > 0) {
    console.log('\n  QUE simbolo de compra tienen los que no resuelven:');
    for (const [simbolo, n] of [...simbolosSinResolver.cuenta].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`    "${simbolo}": ${n} item(s) -- ej. ${(simbolosSinResolver.ejemplos.get(simbolo) ?? []).join(', ')}`);
    }
  }

  // -------------------------------------------------------------------------
  // LAS DOS CLASES DE `unidad`, que no son la misma cosa
  // -------------------------------------------------------------------------
  console.log('\n== CLASE RESULTANTE (sin contar los de empresa, que ya salen del universo) ==');
  console.log(`  clase = paquete:                ${clasePaquete}  (${pct(clasePaquete, total)})  -> la regla del umbral SI aplica`);
  console.log(`  clase = unidad:                 ${unidadDeVerdad + unidadPorFaltaDeDato}  (${pct(unidadDeVerdad + unidadPorFaltaDeDato, total)})`);
  console.log(`    de los cuales:`);
  console.log(`      unidad DE VERDAD (compra=1): ${unidadDeVerdad}  (${pct(unidadDeVerdad, total)})  -> correcto: no hay paquete que medir`);
  console.log(`      unidad POR FALTA DE DATO:    ${unidadPorFaltaDeDato}  (${pct(unidadPorFaltaDeDato, total)})  -> se le descuenta el faltante ENTERO al personal`);
  if (ejemplosUnidadReal.length > 0) {
    console.log(`      ejemplos de unidad de verdad: ${ejemplosUnidadReal.join(', ')}`);
  }

  // -------------------------------------------------------------------------
  // TAMANOS: con un Emp.1000 el umbral del 50% son 500 unidades
  // -------------------------------------------------------------------------
  console.log('\n== TAMANOS DE EMPAQUE DE COMPRA ==');
  const porTamano = [...tamanos.cuenta].sort((a, b) => b[1] - a[1]);
  console.log('  los mas frecuentes:');
  for (const [tamano, n] of porTamano.slice(0, 10)) {
    console.log(`    ${String(tamano).padStart(5)} u.: ${n} item(s) (${pct(n, total)})`);
  }

  const RANGOS: Array<[string, (t: number) => boolean]> = [
    ['= 1 (suelto)', (t) => t === 1],
    ['2 a 12', (t) => t >= 2 && t <= 12],
    ['13 a 48', (t) => t >= 13 && t <= 48],
    ['49 a 100', (t) => t >= 49 && t <= 100],
    ['101 a 500', (t) => t >= 101 && t <= 500],
    ['> 500', (t) => t > 500],
  ];
  console.log('\n  por rango (el umbral del 50% es la mitad de esto):');
  for (const [nombre, dentro] of RANGOS) {
    const n = [...tamanos.cuenta].filter(([t]) => dentro(t)).reduce((s, [, c]) => s + c, 0);
    console.log(`    ${nombre.padEnd(14)}: ${String(n).padStart(6)} (${pct(n, total)})`);
  }

  const grandes = [...tamanos.cuenta.keys()].sort((a, b) => b - a).slice(0, 5);
  console.log('\n  los empaques MAS GRANDES que existen (y su media unidad):');
  for (const t of grandes) {
    console.log(`    ${t} u. -> umbral 0.5 = ${t / 2} unidades  | ej. ${(tamanos.ejemplos.get(t) ?? []).join(', ')}`);
  }
}

main().catch((e: unknown) => {
  console.error('[ERROR]', e instanceof Error ? e.message : e);
  process.exit(1);
});
