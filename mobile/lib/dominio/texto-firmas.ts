/**
 * El texto de firmas de la tarjeta del Historial, con el mínimo de firmas
 * CONFIGURABLE (backend, 5c2c23c -- hoy 1), NUNCA un 2 hardcodeado. Si el
 * parámetro dice 1, la tarjeta dice 1. Pluraliza "firma"/"firmas" y
 * "auditor"/"auditores" según el requerido.
 */

/** "0 / 1 firma" · "1 / 2 firmas" — inventario sin lacrar todavía. */
export function textoFirmas(hechas: number, requeridas: number): string {
  return `${hechas} / ${requeridas} firma${requeridas === 1 ? '' : 's'}`;
}

/** "Firmado por 1 auditor" · "Firmado por 2 auditores" — ya lacrado. */
export function textoFirmadoPor(requeridas: number): string {
  return `Firmado por ${requeridas} auditor${requeridas === 1 ? '' : 'es'}`;
}
