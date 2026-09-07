/**
 * El texto de la línea resumen cuando el armado de hojas ya terminó — su
 * ÚNICA fuente, aparte de HojasScreen.tsx, para poder probarlo sin montar la
 * pantalla. El número se formatea con un formateador INYECTADO (mismo patrón
 * que texto-cierre-ronda.ts): el dominio no ata a la UI.
 *
 * Solo se usa cuando el armado ya está en el paso "hecho" (catálogo traído,
 * hojas creadas Y repartidas) — por eso no contempla un estado "sin
 * repartir": ese caso todavía muestra el wizard completo, nunca la línea
 * resumen.
 */
export function textoResumenArmado(items: number, hojas: number, formato: (n: number) => string): string {
  const sufijo = (n: number) => (n === 1 ? '' : 's');
  return `${formato(items)} ítem${sufijo(items)} · ${formato(hojas)} hoja${sufijo(hojas)} · repartidas`;
}
