/**
 * El texto del botón de cierre del ciclo de conteos — su ÚNICA fuente.
 *
 * Vive en el dominio, aparte de CicloScreen.tsx, por dos razones: es lógica
 * pura (qué ronda cierra, qué pasa después) que se prueba sin montar la
 * pantalla, y el número de ítems se formatea con un formateador INYECTADO
 * (mismo patrón que `comparativo-ronda.ts`) para no atar el dominio a la UI.
 */

/** "1er", "2do", "3er" — nombre ordinal de una ronda del ciclo. */
export const ORDINAL: Record<number, string> = { 1: '1er', 2: '2do', 3: '3er' };

/**
 * El ciclo tiene 3 pasadas — no hay un 4to conteo (ver CicloScreen, Paso 3:
 * "Las cantidades resultantes quedan fijas para la liquidación"). Cerrar la
 * 3ra no abre otra ronda: termina el inventario.
 */
export const RONDA_MAX = 3;

/**
 * Qué dice el botón de cierre: la ronda que CIERRA y qué pasa DESPUÉS.
 *
 * Antes decía "Cerrar y abrir el 2do conteo" fijo — con la ronda 2 activa
 * eso MENTÍA (cerraba la 2da diciendo que abría la 2da). Ahora la siguiente
 * sale de la activa (+1), salvo que sea la última pasada del ciclo: la 3ra,
 * o cuando ya no queda nada por recontar (`aRecontar === 0`, todo cuadró).
 * En ese caso cerrar TERMINA el inventario, no abre otra ronda — y el botón
 * lo dice, en vez de prometer una ronda que no va a existir.
 *
 * @param rondaActiva la ronda que se está por cerrar (la activa del backend).
 * @param aRecontar   ítems que pasarían al reconteo (del preview del cierre).
 * @param formato     cómo mostrar ese número (inyectado: el dominio no formatea).
 */
export function textoBotonCierre(rondaActiva: number, aRecontar: number, formato: (n: number) => string): string {
  const esUltimaPasada = rondaActiva >= RONDA_MAX || aRecontar === 0;
  if (esUltimaPasada) {
    return `Cerrar el ${ORDINAL[rondaActiva]} conteo y terminar el inventario`;
  }
  return `Cerrar el ${ORDINAL[rondaActiva]} conteo y abrir el ${ORDINAL[rondaActiva + 1]} · ${formato(aRecontar)} ítems`;
}
