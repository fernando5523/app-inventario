/**
 * LA PALETA NO VIVE ACA: vive en `src/index.css`, en las variables de `:root`.
 *
 * En app_pdv el azul primario estaba escrito a mano 272 veces en 95 archivos y
 * esta constante `COLORS` era una copia mas, que nadie importaba. Al portar el
 * portal se centralizo todo en tokens CSS (`var(--primary)`, `var(--fg)`...),
 * asi que la copia se borro en vez de recolorearse: dos fuentes para el mismo
 * color es como se vuelve a desincronizar.
 *
 * Los colores de AVATAR son la unica excepcion legitima a esa regla, y por eso
 * siguen siendo hex literales: NO son tokens del sistema de diseno, son una
 * rueda de colores para distinguir personas de un vistazo. Tienen que ser
 * VARIADOS -- un avatar en el rojo de marca para las diez personas de la lista
 * no distingue a nadie.
 */

/**
 * Color de fondo del avatar, por persona. El PRIMERO es el primario de la marca
 * y sale de la variable, no de un hex: es el que le toca a quien no tenga color
 * asignado, y tiene que seguir al primario si cambia (paso del rojo al negro).
 *
 * Dos entradas se cambiaron respecto de app_pdv y no por gusto: su azul
 * primario y su rojo destructivo son justo los hex que este portal no puede
 * volver a tener sueltos (la verificacion de color los busca con grep). Se
 * reemplazaron por dos tonos distintos de la misma familia, que es lo que esta
 * lista necesita -- variedad, no un valor exacto.
 */
export const AVATAR_COLORS = [
  'var(--primary)', '#8250df', '#B3242F', '#1a7f37', '#bf8700',
  '#1F4E9C', '#6639ba', '#a40e26', '#116329', '#953800',
]
