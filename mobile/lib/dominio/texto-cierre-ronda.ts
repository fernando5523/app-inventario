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
/**
 * true cuando cerrar ESTA ronda termina el conteo en vez de abrir otra: es la
 * última pasada del ciclo (>= RONDA_MAX), o ya no queda nada por recontar
 * (`aRecontar === 0`, todo cuadró). La ÚNICA fuente de esa decisión — el botón,
 * la etiqueta del preview y el párrafo explicativo la comparten para no
 * contradecirse entre sí.
 */
export function esUltimaPasada(rondaActiva: number, aRecontar: number): boolean {
  return rondaActiva >= RONDA_MAX || aRecontar === 0;
}

export function textoBotonCierre(rondaActiva: number, aRecontar: number, formato: (n: number) => string): string {
  if (esUltimaPasada(rondaActiva, aRecontar)) {
    return `Cerrar el ${ORDINAL[rondaActiva]} conteo y terminar el inventario`;
  }
  return `Cerrar el ${ORDINAL[rondaActiva]} conteo y abrir el ${ORDINAL[rondaActiva + 1]} · ${formato(aRecontar)} ítems`;
}

/**
 * Estado de un PASO (una ronda) del embudo del ciclo, comparando su número
 * con la ronda ACTIVA del backend — NUNCA un literal. Ese era el bug: el
 * Paso 2 decía "En curso" fijo aunque el inventario ya estuviera en la 3ra.
 *
 *   'cerrado'    ya pasó (número < activa), o el conteo entero ya cerró.
 *   'en-curso'   es la ronda activa y ya tiene datos cargados.
 *   'pendiente'  todavía no se abrió (número > activa), o la activa sin un
 *                solo conteo cargado.
 *   'sin-datos'  el conteo cerró y esta ronda nunca corrió (cuadró antes).
 */
export type EstadoPaso = 'cerrado' | 'en-curso' | 'pendiente' | 'sin-datos';

export function estadoDePaso(rondaPaso: number, rondaActiva: number | null, tieneDatos: boolean): EstadoPaso {
  // Sin ronda activa = el conteo del inventario ya se cerró. Lo que corrió
  // (tiene datos) quedó cerrado; lo que nunca se abrió no tiene nada que mostrar.
  if (rondaActiva === null) return tieneDatos ? 'cerrado' : 'sin-datos';
  if (rondaPaso < rondaActiva) return 'cerrado';
  if (rondaPaso > rondaActiva) return 'pendiente';
  // La ronda activa: en curso si ya se contó algo; pendiente si se abrió pero
  // todavía no entró ni una hoja.
  return tieneDatos ? 'en-curso' : 'pendiente';
}

/**
 * La etiqueta de la fila "a recontar" del preview de cierre. En una ronda
 * intermedia nombra la ronda SIGUIENTE (activa + 1); en la última no hay
 * siguiente, así que esos ítems son la diferencia definitiva para liquidar.
 */
export function etiquetaARecontar(rondaActiva: number, aRecontar: number): string {
  return esUltimaPasada(rondaActiva, aRecontar)
    ? 'Sin cuadrar (diferencia final para liquidar)'
    : `A recontar en el ${ORDINAL[rondaActiva + 1]} conteo`;
}

/**
 * El párrafo que explica qué hace cerrar ESTA ronda. En una intermedia abre la
 * siguiente con lo que no cuadró; en la última cierra el conteo y deja el
 * inventario listo para liquidar — nunca promete una ronda que no va a existir.
 */
export function textoCierreExplicacion(rondaActiva: number, aRecontar: number): string {
  if (esUltimaPasada(rondaActiva, aRecontar)) {
    return 'Cerrar termina el conteo: el inventario queda listo para liquidar. Los ítems que sigan sin cuadrar quedan como diferencia definitiva, sin otra pasada.';
  }
  return (
    `Cerrar abre el ${ORDINAL[rondaActiva + 1]} conteo solo con lo que no cuadró — los conteos anteriores quedan ` +
    'intactos. Si quedan pocos ítems para recontar, es media hora; si quedan muchos, conviene mirar qué se contó ' +
    'mal antes de mandar a todos a recontar.'
  );
}
