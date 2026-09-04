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
 * El precio para valorizar es el de VENTA, no el de compra -- asi lo
 * definio el cliente en la reunion (docs/pantallas.md, Pantalla 5).
 */

import { redondear } from '../historial/historial.calculos';

/** Espeja tipos.ts#ItemAuditoria. */
export interface ItemAuditoria {
  productoId: number;
  codigo: string;
  descripcion: string;
  zona: string;
  precioVenta: number;
  stockErp: number;
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

export type VeredictoAuditoria = 'cuadrado' | 'falta' | 'empresa';

/** Los 4 filtros que ya usa la pantalla (mobile/design/auditoria.html). */
export const FILTROS_AUDITORIA = ['todos', 'cuadrados', 'faltante', 'empresa'] as const;
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

/**
 * conteoFinal - stockErp. Negativo = faltante, positivo = sobrante.
 *
 * Un item sin ningun conteo devuelve 0 y NO "menos todo el stock": que
 * nadie lo haya contado todavia no es lo mismo que haberlo contado en cero.
 * La diferencia importa -- lo segundo seria reportar un faltante inventado
 * por cada item que la gente no llego a contar.
 */
export function diferenciaUnidades(item: Pick<ItemAuditoria, 'conteo1' | 'conteo2' | 'conteo3' | 'stockErp'>): number {
  const final = conteoFinal(item);
  return final === null ? 0 : final - item.stockErp;
}

/** diferenciaUnidades * precioVenta -- nunca precio de compra. */
export function diferenciaValor(item: ItemAuditoria): number {
  return redondear(diferenciaUnidades(item) * item.precioVenta);
}

/**
 * 'cuadrado' si el conteo final coincide con el ERP. Si no coincide y la
 * categoria la asume la empresa, 'empresa' -- el faltante existe pero no se
 * descuenta a nomina. El resto es 'falta', sea faltante O SOBRANTE: la
 * maqueta valida solo esos tres buckets (Todos/Cuadrados/Faltante/Empresa),
 * no hay un cuarto separado para sobrantes.
 */
export function veredicto(item: ItemAuditoria): VeredictoAuditoria {
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
 * Aplica uno de los 4 filtros de la pantalla. `cuadrados` y `empresa` son
 * exactamente el veredicto; `faltante` tambien, aunque el nombre del filtro
 * en la UI diga "Faltante" e incluya sobrantes -- se respeta el nombre que
 * el cliente ya vio en la maqueta en vez de renombrarlo por prolijidad.
 */
export function aplicarFiltro(items: ItemAuditoria[], filtro: FiltroAuditoria): ItemAuditoria[] {
  if (filtro === 'todos') return items;
  const buscado: VeredictoAuditoria = filtro === 'cuadrados' ? 'cuadrado' : filtro === 'empresa' ? 'empresa' : 'falta';
  return items.filter((i) => veredicto(i) === buscado);
}

export interface ResumenAuditoria {
  items: number;
  cuadrados: number;
  conFalta: number;
  deEmpresa: number;
  /** % de items que cuadraron contra el ERP. */
  porcentajeCuadrado: number;
  /** Unidades, siempre en positivo. */
  unidadesFaltantes: number;
  unidadesSobrantes: number;
  /** Valorizado a precio de venta. Negativo = perdida. */
  valorFaltante: number;
  valorSobrante: number;
  /**
   * Lo que SI se descuenta a nomina: el faltante que no absorbe la empresa.
   * Es el numero que entra a la liquidacion (Pantalla 6) como faltante
   * bruto -- separarlo aca evita que alguien reste las cervezas dos veces.
   */
  valorFaltanteDescontable: number;
  /** Items que todavia no conto nadie: la matriz no esta completa. */
  sinContar: number;
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
    porcentajeCuadrado: 0,
    unidadesFaltantes: 0,
    unidadesSobrantes: 0,
    valorFaltante: 0,
    valorSobrante: 0,
    valorFaltanteDescontable: 0,
    sinContar: 0,
  };

  for (const item of items) {
    if (conteoFinal(item) === null) r.sinContar += 1;

    const v = veredicto(item);
    if (v === 'cuadrado') r.cuadrados += 1;
    else if (v === 'empresa') r.deEmpresa += 1;
    else r.conFalta += 1;

    const unidades = diferenciaUnidades(item);
    const valor = unidades * item.precioVenta;
    if (unidades < 0) {
      r.unidadesFaltantes += -unidades;
      r.valorFaltante += -valor;
      if (!item.esEmpresa) r.valorFaltanteDescontable += -valor;
    } else if (unidades > 0) {
      r.unidadesSobrantes += unidades;
      r.valorSobrante += valor;
    }
  }

  r.porcentajeCuadrado = items.length === 0 ? 0 : redondear((r.cuadrados / items.length) * 100, 1);
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
    itemsConDiferencia: items.filter((i) => diferenciaUnidades(i) !== 0).length,
  };
}
