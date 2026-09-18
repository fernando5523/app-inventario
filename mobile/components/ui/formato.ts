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

/**
 * ---------------------------------------------------------------------------
 * TODA FECHA SE MUESTRA EN HORA DE LIMA, no en la del dispositivo
 * ---------------------------------------------------------------------------
 * El bug que motivó esto (visto en la app el 2026-09-05): la tarjeta de
 * ajustes decía "Registrado por Nancy Quispe el 05/09/2026 10:38" cuando en
 * Lima eran las 05:38. El servidor manda ISO en UTC y estos helpers usaban
 * `getHours()`, que es la zona LOCAL DEL DISPOSITIVO — y el emulador corre en
 * UTC. En un teléfono de la tienda hubiera dado bien por casualidad, no por
 * diseño: basta un equipo con la zona mal puesta para que la hora de una
 * firma contable quede mal.
 *
 * Se resuelve con offset FIJO y no con `Intl.DateTimeFormat({timeZone})`, por
 * lo mismo que el resto de este archivo: los datos ICU no están garantizados
 * en Hermes, y `Intl` con timeZone es justo lo primero que falla sin ellos —
 * en silencio, cayendo a UTC.
 *
 * -5 fijo es seguro para Lima: **Perú no tiene horario de verano** desde
 * 1994. Si algún día lo reinstaurara, esto deja de alcanzar y hay que traer
 * una tabla de transiciones (o `Intl` con un fallback probado). El día que
 * pase, este comentario es el lugar por donde empezar.
 */
const OFFSET_LIMA_MINUTOS = -5 * 60;

/** El instante, corrido a hora de Lima, para leerlo con los getters UTC. */
function enLima(iso: string): Date {
  return new Date(new Date(iso).getTime() + OFFSET_LIMA_MINUTOS * 60_000);
}

/**
 * "2026-06-29T16:00:00.000Z" -> "29/06/2026" (11:00 en Lima, mismo día).
 *
 * A mano, como todo lo de este archivo: `toLocaleDateString` depende de los
 * datos ICU, que en Hermes no están garantizados y caen a formato inglés en
 * silencio — un histórico que dice "06/29/2026" a un usuario peruano es un
 * dato mal leído, no un detalle cosmético.
 *
 * Los getters son los `getUTC*` sobre la fecha YA corrida: usar los locales
 * volvería a meter la zona del dispositivo por la ventana.
 */
export function formatoFecha(iso: string): string {
  const d = enLima(iso);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/**
 * "2026-09-05T10:38:00.000Z" -> "05:38" (hora de Lima), sin la fecha.
 *
 * Para cuando el día ya lo dice el contexto y repetirlo es ruido: la hora de
 * entrada de una fila que está debajo del encabezado "martes 15/09/2026" no
 * necesita decir "15/09/2026" once veces.
 */
export function formatoHora(iso: string): string {
  const d = enLima(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** "2026-09-05T10:38:00.000Z" -> "05/09/2026 05:38" (hora de Lima). */
export function formatoFechaHora(iso: string): string {
  const d = enLima(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${formatoFecha(iso)} ${hh}:${mi}`;
}

/** ["ENE".."DIC"] — los meses en la abreviatura de tres letras que usan las maquetas. */
export const MESES_CORTOS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC'];

// ---------------------------------------------------------------------------
// EL DÍA DE LA JORNADA (asistencia)
// ---------------------------------------------------------------------------

/**
 * El DÍA de la jornada en hora de Lima, `YYYY-MM-DD`.
 *
 * Reusa `OFFSET_LIMA_MINUTOS` y no `getDate()` por lo mismo que todo lo de
 * arriba, pero acá el costo del error es peor que una hora mal escrita: la
 * marca de asistencia se guarda CONTRA UN DÍA, y los días distintos con al
 * menos una marca son la duración del inventario -- el denominador de la
 * multa de todo el personal. Un teléfono en UTC a las 19:05 de Lima ya está
 * en el día siguiente: el Coordinador marcaría la entrada de once personas en
 * un día que nadie trabajó, agregándole un día al inventario y una falta a
 * cada uno de los que sí vinieron.
 *
 * Recibe el instante y no lo toma de adentro para poder probarlo: una función
 * que lee el reloj por su cuenta solo se puede probar el día correcto.
 */
export function diaEnLima(momento: Date): string {
  const d = new Date(momento.getTime() + OFFSET_LIMA_MINUTOS * 60_000);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/** Días de la semana en español, del domingo al sábado -- índice de `getUTCDay()`. */
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/**
 * "2026-09-15" -> "Mar 15/09", para la tira de días ya registrados.
 *
 * El día de la semana va adelante porque es como se acuerda una jornada
 * ("el martes vino toda la mañana"), no por el número. A mano y sin `Intl`,
 * igual que el resto del archivo.
 *
 * El día se interpreta como UTC (`T00:00:00Z`) a propósito: es una FECHA, no
 * un instante, y `new Date('2026-09-15')` sin zona ya se parsea así. Correrlo
 * a Lima sería restarle 5 horas a algo que no tiene hora, y devolvería el día
 * anterior.
 */
export function formatoDiaJornada(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`);
  const semana = DIAS_SEMANA[d.getUTCDay()];
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${semana.charAt(0).toUpperCase()}${semana.slice(1, 3)} ${dd}/${mm}`;
}

/** "2026-09-15" -> "martes 15/09/2026", para el encabezado que dice qué día se está marcando. */
export function formatoDiaJornadaLargo(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${DIAS_SEMANA[d.getUTCDay()]} ${dd}/${mm}/${d.getUTCFullYear()}`;
}
