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
