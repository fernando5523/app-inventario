/**
 * Formato numérico es-PE: punto de miles, coma decimal -- "8.000", "98,4%",
 * "S/ 2.200,00". Es la convención ya validada en las maquetas y en la app del
 * teléfono (`mobile/components/ui/formato.ts`), y se replica al pie para que el
 * mismo número se lea igual en los dos lados.
 *
 * A mano y no con `Intl.NumberFormat`: en el teléfono es obligatorio (Hermes
 * puede no traer los datos ICU de `es-PE` y cae a formato inglés en silencio),
 * y acá se mantiene idéntico a propósito -- un portal que escribe "2,200.50"
 * donde la app escribe "2.200,50" obliga a traducir mentalmente cada cifra que
 * se compara entre pantallas.
 */

function conMiles(entero: number): string {
  return Math.round(entero).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** "8000" -> "8.000" (cantidades: ítems, hojas). */
export function formatoMiles(valor: number): string {
  return conMiles(valor)
}

/** "98.42" -> "98,4". El "%" lo agrega quien llama. */
export function formatoPct(valor: number, decimales = 1): string {
  return valor.toFixed(decimales).replace('.', ',')
}

/** "2200.5" -> "2.200,50". El "S/" lo agrega quien llama. */
export function formatoMoneda(valor: number): string {
  const negativo = valor < 0
  const [enteros, decimales] = Math.abs(valor).toFixed(2).split('.')
  return `${negativo ? '-' : ''}${conMiles(Number(enteros))},${decimales}`
}

/** Los meses en la abreviatura de tres letras que usan las maquetas. */
export const MESES_CORTOS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC']

/** Los meses escritos: para el selector de período, donde hay lugar. */
export const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Setiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

export function pluralizar(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural
}
