/**
 * UN REFRESCO NO PUEDE ACHICAR LO QUE YA SE ESTÁ VIENDO.
 *
 * Las listas paginadas (Historial, Clasificación) traen la primera página y
 * van agregando con "cargar más". Pero el refresco automático —volver a la
 * pestaña, volver la app del bolsillo— pedía SIEMPRE la primera página y
 * reemplazaba la lista entera: quien había cargado 120 productos volvía y
 * tenía 40, con el scroll arriba. No es un dato viejo, es trabajo de
 * navegación que se pierde sin que nadie lo haya pedido.
 *
 * La solución es pedir de nuevo TANTAS filas como ya había, en un solo pedido
 * desde el desplazamiento 0 — así se refresca todo lo que está a la vista, y
 * no quedan huecos ni filas repetidas como pasaría pidiendo página por página
 * sobre una lista que el servidor pudo reordenar en el medio.
 */

/**
 * El tope de `limite` que aceptan los endpoints paginados del backend.
 *
 * Verificado el 2026-09-21 en los dos schemas que usan estas pantallas:
 * `historial.schema.ts` (`max(100)`) y `clasificacion.schema.ts`
 * (`max(100)`). Pedir más devuelve un 400 de validación, así que el tope se
 * respeta acá en vez de descubrirlo en la pantalla.
 */
export const MAXIMO_POR_PEDIDO = 100;

/**
 * Cuántas filas pedir al REFRESCAR una lista paginada.
 *
 * Nunca menos que una página (una lista recién abierta pide lo de siempre) y
 * nunca más de lo que el backend acepta.
 *
 * CUANDO `cargados` PASA EL TOPE se devuelve el tope, y eso deja la lista más
 * corta de lo que estaba. Es el único caso en que el refresco achica algo, y
 * se elige a conciencia: la alternativa —encadenar varios pedidos para
 * reconstruir 300 filas en cada vuelta a la pantalla— convierte un refresco
 * silencioso en una ráfaga contra el backend de la tienda, que es el que
 * también está recibiendo los conteos. Quien tenga más de 100 cargadas
 * aprieta "cargar más" otra vez; nadie ve un dato falso.
 */
export function limiteParaRefrescar(cargados: number, tamanoPagina: number): number {
  const pedido = Math.max(tamanoPagina, cargados);
  return Math.min(pedido, MAXIMO_POR_PEDIDO);
}
