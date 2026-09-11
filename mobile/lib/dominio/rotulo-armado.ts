/**
 * Qué dice el paso 2 ("Crear hojas") una vez armada la ronda.
 *
 * Pura y aparte del JSX por la misma razón que `avance-snapshot.ts`: es una
 * regla de presentación con casos que importan (qué ronda, singular/plural) y
 * dentro de un ternario anidado en el render no se puede probar ninguno.
 *
 * ---------------------------------------------------------------------------
 * BUG B — el número sin apellido
 * ---------------------------------------------------------------------------
 * En el caso end-to-end, durante las rondas 2 y 3 el rótulo seguía mostrando
 * las cifras de la RONDA 1: "1 hojas creadas de 10 ítems (10 ítems en total)",
 * cuando la hoja nueva del reconteo tenía 3 ítems y después 1. Dos datos
 * prestados de otra ronda:
 *   · el "total" salía de `items` (el universo del SNAPSHOT, que es el de la
 *     ronda 1), no de lo que de verdad hay en las hojas de ESTA ronda;
 *   · el "de N ítems" salía del tamaño NOMINAL del lote, que en un reconteo
 *     no dice nada (ver el comentario de HojaConteo.tamano).
 *
 * Acá se cuenta lo REAL —los `productos` de las hojas de la ronda, que son la
 * fuente de verdad del conteo— y se nombra la RONDA. Un número sin apellido
 * fue la familia de bugs que más costó.
 */

import type { HojaConteo } from './tipos';

export function rotuloHojasCreadas(
  hojas: Pick<HojaConteo, 'productos'>[],
  ronda: number,
  formatoMiles: (n: number) => string,
): string {
  const totalItems = hojas.reduce((suma, h) => suma + h.productos.length, 0);
  const hojaPalabra = hojas.length === 1 ? 'hoja creada' : 'hojas creadas';
  const itemPalabra = totalItems === 1 ? 'ítem' : 'ítems';
  return `Ronda ${ronda}: ${formatoMiles(hojas.length)} ${hojaPalabra} · ${formatoMiles(totalItems)} ${itemPalabra} en total.`;
}
