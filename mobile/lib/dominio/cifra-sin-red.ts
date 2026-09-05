/**
 * Cómo se muestra un número que puede no haberse podido traer del
 * servidor (sin red). Nace del hallazgo de la auditoría de "números que
 * mienten" en InicioScreen.tsx: sin red, `items`/`totalHojas` quedaban en
 * `0` y la pantalla decía "0 hojas · 0 ítems" — un cero que significa "no
 * lo sé" mostrado como si significara "no hay ninguno". La cadena entera
 * (InicioScreen) ahora guarda esos dos campos como `number | null`;
 * `null` es "no se pudo traer", nunca "vale cero".
 */

/**
 * El valor tal cual, o "—" cuando no se pudo traer. Nunca un cero
 * inventado en su lugar.
 */
export function cifraOSinRed(valor: number | null, formatear: (n: number) => string = String): string {
  return valor === null ? '—' : formatear(valor);
}

/**
 * El sufijo "/ total (pct%)" de una fila de avance — nunca con `total` en
 * 0 como denominador, en NINGUNO de los dos sentidos en que puede llegar a
 * serlo: `null` (sin red, no se sabe el total) dice "sin red"; `0` real
 * (el inventario existe pero todavía no tiene hojas creadas) dice "sin
 * hojas creadas". Ninguno de los dos casos calcula un "0%" que sonaría a
 * "no avanzó nada" cuando en realidad no hay nada que avanzar todavía.
 */
export function filaPct(parte: number, total: number | null): string {
  if (total === null) return 'sin red';
  if (total === 0) return 'sin hojas creadas';
  return `/ ${total} (${Math.round((parte / total) * 100)}%)`;
}
