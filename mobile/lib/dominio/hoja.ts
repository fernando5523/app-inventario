/**
 * Ciclo de vida de una hoja de conteo.
 *
 * Transiciones validas: pendiente -> en-proceso -> finalizada. Nunca al
 * reves: no hay funcion que "reabra" una hoja finalizada, y `finalizar`
 * rechaza finalizar dos veces en vez de dejarlo pasar en silencio.
 */

import type { EstadoHoja, HojaConteo } from './tipos';

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

/**
 * Estado de una RONDA entera (todas las hojas de un conteo), no de una
 * hoja sola. `'sin-hojas'` es un estado aparte de `'pendiente'` a
 * proposito: una ronda sin hojas todavia (el paso ni arranco, ej. el 2do
 * conteo antes de que existan sus hojas) no es lo mismo que una ronda con
 * hojas creadas y ninguna tocada — confundirlas es exactamente el bug que
 * la auditoria marco en CicloScreen.tsx: un paso mostrado como
 * "Finalizada" cuando en realidad no hay ningun dato real detras.
 */
export type EstadoConjunto = 'sin-hojas' | EstadoHoja;

/**
 * `'finalizada'` solo cuando TODAS las hojas lo estan -- una sola sin
 * terminar mantiene la ronda entera "en-proceso", por mas que el resto ya
 * haya cerrado (mismo criterio que el negocio usa para una hoja sola,
 * aplicado al conjunto).
 */
export function estadoConjunto(hojas: HojaConteo[]): EstadoConjunto {
  if (hojas.length === 0) return 'sin-hojas';
  if (hojas.every((h) => h.estado === 'finalizada')) return 'finalizada';
  if (hojas.every((h) => h.estado === 'pendiente')) return 'pendiente';
  return 'en-proceso';
}

export interface AvanceConjunto {
  hojasFinalizadas: number;
  totalHojas: number;
  itemsContados: number;
  totalItems: number;
}

/**
 * Suma `avance()` de cada hoja de la ronda -- la cifra que Inicio y Ciclo
 * tienen que mostrar IGUAL, porque las dos pantallas llaman a esta misma
 * funcion sobre el mismo `repositorioHojas.todas()`: no pueden divergir
 * porque no hay dos calculos distintos, hay uno solo.
 */
export function avanceConjunto(hojas: HojaConteo[]): AvanceConjunto {
  let itemsContados = 0;
  let totalItems = 0;
  let hojasFinalizadas = 0;
  for (const h of hojas) {
    const a = avance(h);
    itemsContados += a.contados;
    totalItems += a.total;
    if (h.estado === 'finalizada') hojasFinalizadas++;
  }
  return { hojasFinalizadas, totalHojas: hojas.length, itemsContados, totalItems };
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
