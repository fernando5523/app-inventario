/**
 * Formato numérico es-PE, a mano — sin `Intl`/`toLocaleString`: en Hermes
 * (motor de RN en Android) no está garantizado que la build del emulador
 * traiga los datos ICU de `es-PE`, y si no los trae, cae en formato
 * inglés silenciosamente. Punto de miles, coma decimal — "8.000",
 * "98,4%", "S/ 2.200,00" — es la convención validada en las 9 maquetas.
 */

function conMiles(entero: number): string {
  return Math.round(entero).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** "8000" -> "8.000" (sin decimales — cantidades: ítems, hojas, etc). */
export function formatoMiles(valor: number): string {
  return conMiles(valor);
}

/** "98.42" -> "98,4" (un decimal, coma — el "%" lo agrega quien llama). */
export function formatoPct(valor: number, decimales = 1): string {
  return valor.toFixed(decimales).replace('.', ',');
}

/** "2200.5" -> "2.200,50" (dos decimales, coma — el "S/" lo agrega quien llama). */
export function formatoMoneda(valor: number): string {
  const negativo = valor < 0;
  const [enteros, decimales] = Math.abs(valor).toFixed(2).split('.');
  return `${negativo ? '-' : ''}${conMiles(Number(enteros))},${decimales}`;
}
