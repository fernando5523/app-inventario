/**
 * Comparación de un ítem contra Dynamics tras el ciclo de 3 conteos.
 *
 * ESPEJA backend/src/modules/auditoria/auditoria.calculos.ts, función por
 * función y con las MISMAS reglas. La cuenta que decide si el inventario
 * cuadra tiene que dar igual en el teléfono y en el servidor: si difieren, el
 * Auditor ve un número en la pantalla y otro en el cierre, y no hay forma de
 * saber cuál era el bueno. Cualquier cambio acá va también allá, y al revés.
 *
 * ---------------------------------------------------------------------------
 * LA REGLA MÁS IMPORTANTE DE ESTE ARCHIVO: "NO SÉ" NO ES "CERO".
 *
 * Un ítem sin stock en el snapshot del ERP y un ítem cuyo ERP dice 0 son cosas
 * distintas; y un ítem que NADIE contó no es un ítem que cuadró. La versión
 * anterior de este archivo hacía `diferenciaUnidades = final === null ? 0 :
 * ...` y `veredicto = diferencia 0 ? 'cuadrado'`: para un inventario recién
 * abierto (catálogo cargado, cero conteos) eso reportaba "100% cuadrado" —
 * un vacío leído como éxito en la única pantalla donde se decide si el
 * inventario cierra. Por eso ahora `stockErp`/las diferencias son nullables y
 * hay dos veredictos (`sin_erp`, `sin_contar`) para lo que NO se puede afirmar.
 * ---------------------------------------------------------------------------
 */

import type { ItemAuditoria, VeredictoAuditoria } from './tipos';

/**
 * El conteo que queda fijo para liquidar: el ÚLTIMO que se hizo. Si un ítem
 * cuadró en el 1er o 2do conteo no hay 3ro (ni 2do), así que se toma el más
 * avanzado que exista y no siempre `conteo3` — `null` si nadie lo contó.
 */
export function conteoFinal(item: Pick<ItemAuditoria, 'conteo1' | 'conteo2' | 'conteo3'>): number | null {
  return item.conteo3 ?? item.conteo2 ?? item.conteo1 ?? null;
}

/** true si hay con qué comparar: stock del ERP Y algún conteo. */
export function esAuditable(item: Pick<ItemAuditoria, 'stockErp' | 'conteo1' | 'conteo2' | 'conteo3'>): boolean {
  return item.stockErp !== null && conteoFinal(item) !== null;
}

/**
 * conteoFinal - stockErp. Negativo = faltante, positivo = sobrante.
 *
 * Devuelve `null` — NO 0 — cuando falta cualquiera de los dos lados. Un 0
 * significa "conté exactamente lo que decía el ERP", una afirmación fuerte;
 * no puede ser también el valor de "no tengo idea". Esta distinción es lo
 * único que impide que un catálogo sin contar se reporte como perfecto.
 */
export function diferenciaUnidades(item: Pick<ItemAuditoria, 'conteo1' | 'conteo2' | 'conteo3' | 'stockErp'>): number | null {
  const final = conteoFinal(item);
  if (item.stockErp === null || final === null) return null;
  return final - item.stockErp;
}

/**
 * diferenciaUnidades * precioVenta — nunca precio de compra.
 * `null` si no se puede calcular la diferencia o si no hay precio.
 */
export function diferenciaValor(item: ItemAuditoria): number | null {
  const unidades = diferenciaUnidades(item);
  if (unidades === null || item.precioVenta === null) return null;
  return unidades * item.precioVenta;
}

/**
 * El orden de los chequeos es la regla, no un detalle de implementación
 * (espeja `veredicto` del backend):
 *   1. Sin stock del ERP  -> `sin_erp`.  No se puede afirmar NADA del ítem.
 *   2. Sin ningún conteo   -> `sin_contar`. Hay ERP, pero nadie lo contó.
 *   3. Diferencia 0        -> `cuadrado`.
 *   4. Diferencia y la asume gerencia -> `empresa`.
 *   5. El resto            -> `falta` (faltante O sobrante).
 */
export function veredicto(item: ItemAuditoria): VeredictoAuditoria {
  if (item.stockErp === null) return 'sin_erp';
  if (conteoFinal(item) === null) return 'sin_contar';
  if (diferenciaUnidades(item) === 0) return 'cuadrado';
  if (item.esEmpresa) return 'empresa';
  return 'falta';
}

/**
 * La ronda en la que quedó fijado el ítem: 1, 2 o 3 — o `0` si nadie lo contó.
 * El badge "Cuadró en Ner" sale de acá: NUNCA de un default a la 3ra (ese era
 * el bug — un ítem sin contar mostraba "Cuadró en 3er", nombrando una ronda
 * que no ocurrió).
 */
export function rondasNecesarias(item: Pick<ItemAuditoria, 'conteo1' | 'conteo2' | 'conteo3'>): number {
  if (item.conteo3 !== null) return 3;
  if (item.conteo2 !== null) return 2;
  return item.conteo1 !== null ? 1 : 0;
}

/**
 * El resumen HONESTO del encabezado, sobre TODOS los ítems del inventario.
 * Distingue contados de sin contar, y `cuadrados` NUNCA incluye a los que
 * nadie contó: `auditables` (con ERP y con conteo) es el denominador real del
 * "cuadrado X de Y". Incluye `veredictoPorId` para que la pantalla filtre en
 * O(1) sin re-recorrer el catálogo — una sola pasada, una sola fuente.
 */
export interface ResumenAuditoria {
  total: number;
  /** Tienen al menos un conteo (`conteoFinal !== null`). */
  contados: number;
  /** Tienen stock del ERP pero nadie los contó todavía. */
  sinContar: number;
  /** El snapshot no trajo stock del ERP: no se pueden auditar. */
  sinDatoErp: number;
  /** total - sinContar - sinDatoErp: sobre estos se puede afirmar algo. */
  auditables: number;
  cuadrados: number;
  conFalta: number;
  deEmpresa: number;
  /** Ítems con una diferencia REAL != 0 (falta + empresa). */
  conDiferencia: number;
  /** Suma de las diferencias en valor: faltante <= 0, sobrante >= 0. */
  faltanteNeto: number;
  sobranteNeto: number;
  /** Lo que absorbe la empresa (no se descuenta a nómina). */
  asumidoEmpresa: number;
  /** Ítems con diferencia que no se pudieron valorizar por falta de precio. */
  sinPrecio: number;
  veredictoPorId: Map<number, VeredictoAuditoria>;
}

export function resumirAuditoria(items: readonly ItemAuditoria[]): ResumenAuditoria {
  const r: ResumenAuditoria = {
    total: items.length,
    contados: 0,
    sinContar: 0,
    sinDatoErp: 0,
    auditables: 0,
    cuadrados: 0,
    conFalta: 0,
    deEmpresa: 0,
    conDiferencia: 0,
    faltanteNeto: 0,
    sobranteNeto: 0,
    asumidoEmpresa: 0,
    sinPrecio: 0,
    veredictoPorId: new Map<number, VeredictoAuditoria>(),
  };

  for (const item of items) {
    const v = veredicto(item);
    r.veredictoPorId.set(item.productoId, v);
    if (conteoFinal(item) !== null) r.contados += 1;

    if (v === 'sin_erp') {
      r.sinDatoErp += 1;
      continue;
    }
    if (v === 'sin_contar') {
      r.sinContar += 1;
      continue;
    }

    r.auditables += 1;
    if (v === 'cuadrado') {
      r.cuadrados += 1;
      continue;
    }

    // falta o empresa: hay una diferencia real.
    r.conDiferencia += 1;
    if (v === 'empresa') r.deEmpresa += 1;
    else r.conFalta += 1;

    const valor = diferenciaValor(item);
    if (valor === null) {
      r.sinPrecio += 1;
      continue;
    }
    if (v === 'empresa') {
      r.asumidoEmpresa += valor;
    } else if (valor < 0) {
      r.faltanteNeto += valor;
    } else {
      r.sobranteNeto += valor;
    }
  }

  return r;
}
