/**
 * Comparacion de un item contra Dynamics tras el ciclo de 3 conteos.
 * PUROS -- sin Prisma, sin Express -- para testearlos sin base (mismo
 * criterio que hojas.calculos.ts y historial.calculos.ts).
 *
 * ESPEJA mobile/lib/dominio/auditoria.ts, funcion por funcion y con las
 * mismas reglas. La cuenta que decide si el inventario cuadra tiene que dar
 * igual en el telefono y en el servidor: si difieren, el Auditor ve un
 * numero en la pantalla y otro en el cierre, y no hay forma de saber cual
 * era el bueno. Cualquier cambio aca va tambien alla, y al reves.
 *
 * ------------------------------------------------------------------------
 * LA REGLA MAS IMPORTANTE DE ESTE ARCHIVO: "NO SE" NO ES "CERO".
 *
 * Un item sin stock en el snapshot del ERP y un item cuyo ERP dice 0 son
 * cosas COMPLETAMENTE distintas en un inventario. El primero no se puede
 * auditar; el segundo dice "no deberia haber ninguno". Tratar el primero
 * como el segundo produjo, contra los 11.835 productos reales que todavia
 * no tienen stock cargado, un resumen que decia "100% cuadrados" -- un
 * falso "todo bien" en la unica pantalla donde se decide si el inventario
 * cierra.
 *
 * Por eso `stockErp` y las diferencias son `number | null`, y hay dos
 * veredictos (`sin_erp`, `sin_contar`) para lo que NO se puede afirmar. Un
 * inventario prefiere decir "no se" cien veces antes que decir "cuadra" una
 * vez sin evidencia.
 * ------------------------------------------------------------------------
 */

import { redondear } from '../historial/historial.calculos';

/**
 * Espeja tipos.ts#ItemAuditoria, con UNA diferencia deliberada:
 * `stockErp` y `precioVenta` son nullables. El tipo del front los declara
 * `number` a secas y eso obliga a inventar un 0 cuando el ERP no trajo el
 * dato -- ver el comentario de cabecera. Un tipo que no puede expresar "no
 * se" fuerza a mentir.
 */
export interface ItemAuditoria {
  productoId: number;
  codigo: string;
  descripcion: string;
  zona: string;
  /** null = el snapshot no trajo precio: la diferencia no se puede valorizar. */
  precioVenta: number | null;
  /** null = el snapshot no trajo stock: este item NO se puede auditar. */
  stockErp: number | null;
  /** null = ese item no llego a necesitar esa pasada (cuadro antes). */
  conteo1: number | null;
  conteo2: number | null;
  conteo3: number | null;
  /**
   * true = la categoria la asume la empresa por orden de gerencia (las
   * cervezas del ejemplo, por seguimiento de robo): el faltante existe y se
   * reporta, pero no se descuenta a nomina.
   */
  esEmpresa: boolean;
}

/**
 * Los tres veredictos de la maqueta MAS dos que dicen "no se".
 *
 * `sin_erp` y `sin_contar` no estaban en el mockup, y se agregan igual
 * porque el mockup asumia que siempre hay dato de los dos lados. Contra
 * datos reales eso no se cumple, y la alternativa era que un item sin
 * informacion se reportara como "cuadrado".
 */
export type VeredictoAuditoria = 'cuadrado' | 'falta' | 'empresa' | 'sin_erp' | 'sin_contar';

/**
 * Los 4 filtros que ya usa la pantalla (mobile/design/auditoria.html) mas
 * `sin_dato`, que junta los dos veredictos de "no se". Los cuatro
 * originales NO cambian de significado -- solo dejan de incluir por error a
 * los items que no tienen con que compararse.
 */
export const FILTROS_AUDITORIA = ['todos', 'cuadrados', 'faltante', 'empresa', 'sin_dato'] as const;
export type FiltroAuditoria = (typeof FILTROS_AUDITORIA)[number];

/**
 * El conteo que queda fijo para liquidar: el ULTIMO que se hizo. Si un item
 * cuadro en el 1er o 2do conteo no hay 3ro (ni 2do), asi que se toma el mas
 * avanzado que exista y no siempre `conteo3` -- tomar conteo3 a secas daria
 * null para los ~7.350 items que cuadraron en la primera pasada, o sea para
 * la enorme mayoria del inventario.
 */
export function conteoFinal(item: Pick<ItemAuditoria, 'conteo1' | 'conteo2' | 'conteo3'>): number | null {
  return item.conteo3 ?? item.conteo2 ?? item.conteo1 ?? null;
}

/** true si hay con que comparar: stock del ERP Y algun conteo. */
export function esAuditable(item: Pick<ItemAuditoria, 'stockErp' | 'conteo1' | 'conteo2' | 'conteo3'>): boolean {
  return item.stockErp !== null && conteoFinal(item) !== null;
}

/**
 * conteoFinal - stockErp. Negativo = faltante, positivo = sobrante.
 *
 * Devuelve `null` -- NO 0 -- cuando falta cualquiera de los dos lados. Un 0
 * significa "conte exactamente lo que decia el ERP", que es una afirmacion
 * fuerte; no puede ser tambien el valor de "no tengo idea". Esta distincion
 * es lo unico que impide que un catalogo sin stock cargado se reporte como
 * un inventario perfecto.
 */
export function diferenciaUnidades(
  item: Pick<ItemAuditoria, 'conteo1' | 'conteo2' | 'conteo3' | 'stockErp'>,
): number | null {
  const final = conteoFinal(item);
  if (item.stockErp === null || final === null) return null;
  return final - item.stockErp;
}

/**
 * diferenciaUnidades * precioVenta -- nunca precio de compra.
 * `null` si no se puede calcular la diferencia o si no hay precio: la
 * diferencia en unidades sigue siendo valida aunque no se pueda valorizar.
 */
export function diferenciaValor(item: ItemAuditoria): number | null {
  const unidades = diferenciaUnidades(item);
  if (unidades === null || item.precioVenta === null) return null;
  return redondear(unidades * item.precioVenta);
}

/**
 * El orden de los chequeos es la regla, no un detalle de implementacion:
 *
 *   1. Sin stock del ERP -> `sin_erp`. No se puede afirmar NADA de este
 *      item, ni siquiera que la empresa lo asume.
 *   2. Sin ningun conteo -> `sin_contar`. Hay contra que comparar, pero
 *      nadie lo conto todavia.
 *   3. Diferencia 0 -> `cuadrado`.
 *   4. Hay diferencia y la asume gerencia -> `empresa`.
 *   5. El resto -> `falta`, sea faltante O SOBRANTE: la maqueta valida solo
 *      esos tres buckets, no hay un cuarto separado para sobrantes.
 */
export function veredicto(item: ItemAuditoria): VeredictoAuditoria {
  if (item.stockErp === null) return 'sin_erp';
  if (conteoFinal(item) === null) return 'sin_contar';
  if (diferenciaUnidades(item) === 0) return 'cuadrado';
  if (item.esEmpresa) return 'empresa';
  return 'falta';
}

/** Cuantas pasadas necesito este item: 1, 2 o 3. */
export function rondasNecesarias(item: Pick<ItemAuditoria, 'conteo1' | 'conteo2' | 'conteo3'>): number {
  if (item.conteo3 !== null) return 3;
  if (item.conteo2 !== null) return 2;
  return item.conteo1 !== null ? 1 : 0;
}

/**
 * Aplica uno de los filtros de la pantalla. Los cuatro de la maqueta
 * (`todos`, `cuadrados`, `faltante`, `empresa`) mapean al veredicto; el
 * quinto, `sin_dato`, junta lo que no se puede auditar todavia.
 */
export function aplicarFiltro(items: ItemAuditoria[], filtro: FiltroAuditoria): ItemAuditoria[] {
  if (filtro === 'todos') return items;
  if (filtro === 'sin_dato') {
    return items.filter((i) => {
      const v = veredicto(i);
      return v === 'sin_erp' || v === 'sin_contar';
    });
  }
  const buscado: VeredictoAuditoria = filtro === 'cuadrados' ? 'cuadrado' : filtro === 'empresa' ? 'empresa' : 'falta';
  return items.filter((i) => veredicto(i) === buscado);
}

export interface ResumenAuditoria {
  items: number;
  cuadrados: number;
  conFalta: number;
  deEmpresa: number;
  /**
   * Items que el snapshot trajo SIN stock del ERP: no se pueden auditar.
   * Se cuentan aparte y NUNCA como cuadrados -- ver el comentario de
   * cabecera del archivo.
   */
  sinDatoErp: number;
  /** Tienen stock del ERP pero nadie los conto todavia. */
  sinContar: number;
  /** items - sinDatoErp - sinContar: sobre estos se puede afirmar algo. */
  auditables: number;
  /**
   * % de cuadrados sobre los AUDITABLES, no sobre el total. Sobre el total
   * mezclaria peras con manzanas: con 11.835 items sin stock cargado,
   * dividir por el total da un porcentaje que no significa nada.
   */
  porcentajeCuadrado: number;
  /** Que porcion del inventario se puede auditar hoy. */
  porcentajeAuditable: number;
  /** Unidades, siempre en positivo. */
  unidadesFaltantes: number;
  unidadesSobrantes: number;
  /** Valorizado a precio de venta. */
  valorFaltante: number;
  valorSobrante: number;
  /**
   * Lo que SI se descuenta a nomina: el faltante que no absorbe la empresa.
   * Es el numero que entra a la liquidacion (Pantalla 6) como faltante
   * bruto -- separarlo aca evita que alguien reste las cervezas dos veces.
   */
  valorFaltanteDescontable: number;
  /**
   * Items con diferencia que NO se pudieron valorizar por falta de precio.
   * Se avisa en vez de callarse: si son muchos, el monto del faltante que
   * muestra la pantalla esta incompleto y quien lo lee tiene que saberlo.
   */
  sinPrecio: number;
}

/**
 * El encabezado de la pantalla del Auditor. Se calcula sobre TODOS los
 * items del inventario, nunca sobre la pagina que se esta mostrando: un
 * resumen que cambia cuando pasas de pagina no es un resumen.
 */
export function resumir(items: ItemAuditoria[]): ResumenAuditoria {
  const r: ResumenAuditoria = {
    items: items.length,
    cuadrados: 0,
    conFalta: 0,
    deEmpresa: 0,
    sinDatoErp: 0,
    sinContar: 0,
    auditables: 0,
    porcentajeCuadrado: 0,
    porcentajeAuditable: 0,
    unidadesFaltantes: 0,
    unidadesSobrantes: 0,
    valorFaltante: 0,
    valorSobrante: 0,
    valorFaltanteDescontable: 0,
    sinPrecio: 0,
  };

  for (const item of items) {
    const v = veredicto(item);
    if (v === 'sin_erp') {
      r.sinDatoErp += 1;
      continue;
    }
    if (v === 'sin_contar') {
      r.sinContar += 1;
      continue;
    }

    r.auditables += 1;
    if (v === 'cuadrado') r.cuadrados += 1;
    else if (v === 'empresa') r.deEmpresa += 1;
    else r.conFalta += 1;

    const unidades = diferenciaUnidades(item);
    if (unidades === null || unidades === 0) continue;

    if (item.precioVenta === null) r.sinPrecio += 1;
    const valor = unidades * (item.precioVenta ?? 0);

    if (unidades < 0) {
      r.unidadesFaltantes += -unidades;
      r.valorFaltante += -valor;
      if (!item.esEmpresa) r.valorFaltanteDescontable += -valor;
    } else {
      r.unidadesSobrantes += unidades;
      r.valorSobrante += valor;
    }
  }

  r.porcentajeCuadrado = r.auditables === 0 ? 0 : redondear((r.cuadrados / r.auditables) * 100, 1);
  r.porcentajeAuditable = items.length === 0 ? 0 : redondear((r.auditables / items.length) * 100, 1);
  r.valorFaltante = redondear(r.valorFaltante);
  r.valorSobrante = redondear(r.valorSobrante);
  r.valorFaltanteDescontable = redondear(r.valorFaltanteDescontable);
  return r;
}

/**
 * El embudo de la Pantalla 4, sacado de la matriz: cuantos items entraron a
 * cada ronda. Es la misma forma que consume ResultadoInventario, asi que
 * cerrar el conteo puede alimentarse de aca sin recalcular nada.
 */
export function embudoDeConteos(items: ItemAuditoria[]): {
  itemsTotales: number;
  itemsSegundoConteo: number;
  itemsTercerConteo: number;
  itemsConDiferencia: number;
} {
  return {
    itemsTotales: items.length,
    itemsSegundoConteo: items.filter((i) => i.conteo2 !== null).length,
    itemsTercerConteo: items.filter((i) => i.conteo3 !== null).length,
    // Solo los que tienen una diferencia REAL calculada: un null no cuenta
    // como "sin diferencia", cuenta como "no se sabe".
    itemsConDiferencia: items.filter((i) => {
      const d = diferenciaUnidades(i);
      return d !== null && d !== 0;
    }).length,
  };
}
