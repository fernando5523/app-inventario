/**
 * Qué inventario muestra la pantalla de Ciclo, y con qué ronda activa.
 *
 * ESTE ES EL ARREGLO DE LA LECTURA. `RepositorioInventario.activo()` devuelve
 * `null` cuando el inventario ya cerró (filtra `estado: en_curso`), y la
 * pantalla se quedaba EN BLANCO: los 3 pasos "sin datos todavía", el bloque
 * final "no hay ningún conteo cargado". Todo eso es falso — el ciclo terminó
 * CON sus 3 pasadas contadas, están en el servidor. El bug no era el texto:
 * era que sin `activo()` la pantalla ni siquiera pedía el embudo.
 *
 * Cuando no hay inventario en curso, el ciclo de la sucursal es el ÚLTIMO que
 * terminó de contar, y su embudo (`resumenRonda` del server para las rondas
 * 1/2/3) es real y se muestra igual. Lo único que no hay es ronda activa que
 * cerrar: `rondaActiva` queda en `null` (y `null` NO es 1 — no se ofrece
 * cerrar una ronda que ya no existe).
 *
 * Vive en el dominio, aparte de la pantalla, porque es una regla con casos
 * borde (hay en curso / no hay ninguno / no hay historial) que se prueba sin
 * montar la UI.
 */

import type { EstadoInventario } from '../puertos/repositorios';
import { TAMANOS_HOJA, type TamanoHoja } from './tipos';

/** El inventario cuyo ciclo de 3 conteos se muestra. */
export interface InventarioDelCiclo {
  inventarioId: number;
  /** Ítems del snapshot: alimenta el cálculo de hojas del Paso 1 y el encabezado. */
  items: number;
  tamanoHoja: TamanoHoja | null;
  /**
   * La ronda que HOY admite cierre (la activa del backend), o `null` si el
   * ciclo ya cerró. `null` NO es 1: con un inventario cerrado el embudo se
   * muestra igual, pero no hay ronda que cerrar ni bloque de cierre.
   */
  rondaActiva: number | null;
}

/** Lo mínimo de `RepositorioInventario.activo()` que usa la resolución. */
export interface ActivoParaCiclo {
  inventarioId: number;
  items: number;
  tamanoHoja: TamanoHoja | null;
  rondaActiva: number | null;
}

/** Lo mínimo de una fila de `RepositorioHistorial.listar()`. */
export interface HistoricoParaCiclo {
  id: number;
  estado: EstadoInventario;
  tamanoHoja: number | null;
  snapshotItems: number;
}

/**
 * Los estados de un inventario que YA terminó de contar: su ciclo de 3 pasadas
 * está completo y su embudo es historia real, aunque no haya ronda activa.
 * `en_curso` lo trae `activo()`; `anulado` nunca tuvo ciclo que mostrar.
 */
const CERRADOS: ReadonlySet<EstadoInventario> = new Set(['conteo_cerrado', 'liquidado', 'lacrado']);

/** El tamaño de hoja del historial (`number | null`) validado contra la unión real. */
function aTamanoHoja(valor: number | null): TamanoHoja | null {
  return TAMANOS_HOJA.find((t) => t === valor) ?? null;
}

/**
 * @param activo    lo que devolvió `RepositorioInventario.activo()` (null si el
 *                  inventario ya cerró, o si no hay ninguno en la sucursal).
 * @param historial las filas de `RepositorioHistorial.listar()`, YA ordenadas
 *                  del más nuevo al más viejo (así las devuelve el backend:
 *                  `periodoAnio desc, periodoMes desc, id desc`), así que el
 *                  primero cerrado es el último ciclo de la sucursal.
 */
export function inventarioDelCiclo(
  activo: ActivoParaCiclo | null,
  historial: readonly HistoricoParaCiclo[],
): InventarioDelCiclo | null {
  // Con un inventario en curso, ese es el del ciclo: su `rondaActiva` gobierna
  // el cierre y sus cifras las trae `activo()` sin pasar por el historial.
  if (activo) {
    return {
      inventarioId: activo.inventarioId,
      items: activo.items,
      tamanoHoja: activo.tamanoHoja,
      rondaActiva: activo.rondaActiva,
    };
  }
  const cerrado = historial.find((i) => CERRADOS.has(i.estado));
  if (!cerrado) return null;
  return {
    inventarioId: cerrado.id,
    items: cerrado.snapshotItems,
    tamanoHoja: aTamanoHoja(cerrado.tamanoHoja),
    rondaActiva: null,
  };
}
