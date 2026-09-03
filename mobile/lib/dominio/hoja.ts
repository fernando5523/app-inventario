/**
 * Ciclo de vida de una hoja de conteo.
 *
 * Transiciones validas: pendiente -> en-proceso -> finalizada. Nunca al
 * reves: no hay funcion que "reabra" una hoja finalizada, y `finalizar`
 * rechaza finalizar dos veces en vez de dejarlo pasar en silencio.
 */

import type { HojaConteo } from './tipos';

export interface AvanceHoja {
  contados: number;
  total: number;
  /** Redondeado: mismo criterio que ya usa la maqueta (Math.round). */
  porcentaje: number;
}

/**
 * `contados` es la cantidad de PRODUCTOS distintos con conteo, no la
 * cantidad de registros en `conteos`: guardarConteo corrige en el mismo
 * producto, no deberia duplicar, pero contar por productoId nos protege
 * igual de un adaptador que sí duplique.
 */
export function avance(hoja: HojaConteo): AvanceHoja {
  const total = hoja.productos.length;
  const contados = new Set(hoja.conteos.map((c) => c.productoId)).size;
  const porcentaje = total === 0 ? 0 : Math.round((contados / total) * 100);
  return { contados, total, porcentaje };
}

/** Falso una vez finalizada: es el punto de no retorno del negocio. */
export function puedeEditar(hoja: HojaConteo): boolean {
  return hoja.estado !== 'finalizada';
}

export interface ResultadoPuedeFinalizar {
  puede: boolean;
  /** Items sin contar. Informativo: no bloquea la finalizacion. */
  faltantes: number;
}

export function puedeFinalizar(hoja: HojaConteo): ResultadoPuedeFinalizar {
  const { contados, total } = avance(hoja);
  return {
    puede: hoja.estado !== 'finalizada',
    faltantes: total - contados,
  };
}

/**
 * Devuelve una hoja NUEVA con estado 'finalizada'. Pura: no muta `hoja`.
 * Lanza si ya estaba finalizada: finalizar dos veces no es un no-op
 * inofensivo, es el sintoma de que alguien intenta saltarse el punto de
 * no retorno.
 */
export function finalizar(hoja: HojaConteo): HojaConteo {
  if (hoja.estado === 'finalizada') {
    throw new Error(`La hoja #${hoja.numero} ya esta finalizada: no se puede finalizar dos veces.`);
  }
  return { ...hoja, estado: 'finalizada' };
}
