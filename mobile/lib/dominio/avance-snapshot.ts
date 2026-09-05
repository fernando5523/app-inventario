/**
 * Qué dice la pantalla mientras baja el catálogo de Dynamics.
 *
 * Pura y aparte del JSX por la misma razón que `comparativo-ronda.ts`: es
 * una regla de presentación con casos que importan, y adentro de un ternario
 * anidado en el render no se puede probar ninguno.
 *
 * ---------------------------------------------------------------------------
 * EL 4% QUE NO EXISTÍA
 * ---------------------------------------------------------------------------
 * Antes la barra se dibujaba al 4% cuando no había total, "para que no
 * parezca trabada". Era el síntoma de otra cosa: el número no se movía porque
 * el backend no reportaba progreso (`GET /api/d365/snapshot/progreso` no
 * existía). Se veía "0 ítems traídos…" durante 90 segundos al lado del cartel
 * "puede tardar varios minutos", y eso se lee como "se colgó".
 *
 * Con el progreso real, el 4% no solo sobra: estorba. Una barra que avanza
 * sola sin que avance el trabajo miente sobre lo único que la persona
 * necesita saber en esos 90 segundos — si esto sigue vivo o hay que cancelar.
 */

import type { AvanceSnapshot } from '../puertos/repositorios';

export interface AvanceParaMostrar {
  texto: string;
  /**
   * `undefined` = NO se dibuja barra.
   *
   * Una barra necesita un denominador. Sin total, cualquier ancho que se
   * elija es inventado: un 0 parece trabado y un "mínimo visible" afirma un
   * avance que nadie midió. El número que sube en el texto ya comunica que
   * está vivo, y esa es la pregunta real.
   */
  porcentaje?: number;
}

/**
 * Los tres estados de la bajada, cada uno con lo que se puede afirmar:
 *
 *   · `null`          → todavía no llegó ningún reporte: conectando.
 *   · `total` conocido → "N de M ítems traídos" + barra real.
 *   · `total: null`    → se sabe cuántos llegaron pero no sobre cuántos:
 *                        "Trayendo… N ítems", sin barra.
 *
 * El tercer caso es breve en la práctica —el backend avisa el total apenas
 * responde el `$count` de Dynamics, antes de la primera página— pero existe,
 * y mientras dura no hay denominador que mostrar.
 */
export function avanceParaMostrar(
  avance: AvanceSnapshot | null,
  formatoMiles: (n: number) => string,
): AvanceParaMostrar {
  if (avance === null) return { texto: 'Conectando con Dynamics…' };

  if (avance.total === null || avance.total <= 0) {
    return { texto: `Trayendo… ${formatoMiles(avance.traidos)} ítems` };
  }

  return {
    texto: `${formatoMiles(avance.traidos)} de ${formatoMiles(avance.total)} ítems traídos`,
    // Se recorta acá y no en el componente: un `traidos` mayor que el total
    // (el `$count` de Dynamics se calcula aparte de la página y puede quedar
    // desactualizado) daría una barra que se pasa del riel.
    porcentaje: Math.max(0, Math.min(100, (avance.traidos / avance.total) * 100)),
  };
}
