/**
 * El sustantivo en singular o plural según `n`, para no clavar el plural en un
 * `${n} productos` que miente cuando n === 1. Devuelve SOLO el sustantivo: el
 * número lo compone quien llama (con `formatoMiles` o crudo, según la
 * pantalla).
 *
 * Toma las DOS formas a propósito, en vez de un sufijo "s": así cubre también
 * los irregulares ("excepción"/"excepciones", "vez"/"veces"), donde el sufijo
 * no alcanza. En español el 0 es plural ("0 productos"), así que solo el 1 es
 * singular.
 */
export function pluralizar(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

/**
 * "a", "a y b", "a, b y c" — el separador final en palabras, como se habla.
 *
 * Vive acá junto a `pluralizar` porque es la otra mitad del mismo problema:
 * una lista pegada con comas ("Carla, Hugo") se lee como una enumeración
 * cortada, y quien la ve espera que siga. Estaba duplicada dentro de
 * `criterios-snapshot.ts`; se subió acá al necesitarla también el reparto de
 * hojas, en vez de escribirla una segunda vez.
 */
export function unirConY(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}
