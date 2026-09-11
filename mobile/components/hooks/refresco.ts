/**
 * Las DECISIONES del refresco automático, separadas del hook.
 *
 * Están acá y no adentro de `useRefrescoAlEnfocar` por lo mismo que
 * `filtro-hojas.ts` o `escaner-confirmacion.ts`: son reglas con bordes
 * ("¿esta transición de AppState cuenta?", "¿corresponde recargar ahora?") y
 * adentro de un `useEffect` no se puede probar ninguna sin montar React
 * Native entero. Acá se prueban con `vitest` y sin dispositivo.
 *
 * El hook queda siendo solo el cableado: suscribirse, desuscribirse, llamar.
 */

/**
 * Estados de `AppState` de React Native que nos importan. Se declara acá en
 * vez de importar el tipo de `react-native` para que este archivo siga sin
 * depender de RN y pueda correr bajo vitest.
 *
 * `inactive` es real y es de iOS: la app está en transición (el switcher
 * abierto, una llamada entrando). Android salta directo entre `active` y
 * `background`.
 */
export type EstadoApp = 'active' | 'background' | 'inactive';

/**
 * ¿Esta transición es "la persona volvió a la app"?
 *
 * Solo cuenta si el estado ANTERIOR no era `active`: `AppState` emite
 * `active -> active` en algunos equipos, y tratar eso como una vuelta
 * dispararía una recarga por cada evento espurio. Lo que importa no es el
 * estado nuevo, es el CAMBIO.
 */
export function esVueltaAPrimerPlano(anterior: EstadoApp, siguiente: EstadoApp): boolean {
  return siguiente === 'active' && anterior !== 'active';
}

export interface CondicionesRefresco {
  /** Ya hay una recarga corriendo. */
  enVuelo: boolean;
  /**
   * La pantalla pidió no refrescar ahora: hay un modal abierto o un
   * formulario a medio escribir. Ver el comentario de `pausado` en el hook —
   * es la regla de "refrescar nunca pisa lo que la persona está haciendo".
   */
  pausado: boolean;
}

/**
 * ¿Corresponde recargar?
 *
 * Dos motivos para decir que no, y son distintos:
 *
 *  - `enVuelo`: ya hay una pedida en curso. Sin esto, enfocar la pantalla
 *    justo cuando vuelve del segundo plano dispara DOS recargas iguales, y
 *    la que conteste segunda pisa a la primera -- con dos respuestas del
 *    servidor en distinto orden, puede quedar mostrando la vieja.
 *  - `pausado`: la persona está en el medio de algo. Refrescar acá no es
 *    "un poco molesto": le puede cerrar el modal o pisarle lo que escribió.
 *
 * `pausado` gana sobre todo lo demás a propósito: es la regla de negocio, no
 * una optimización.
 */
export function debeRefrescar({ enVuelo, pausado }: CondicionesRefresco): boolean {
  if (pausado) return false;
  if (enVuelo) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Reintento automático de una carga que falló, SIN esperar un nuevo foco.
//
// Bug real (2026-09-11): "0 hojas asignadas" en Inicio (Contador) recién se
// arreglaba al entrar a Mis hojas y volver. Esa pantalla no hace nada
// distinto de Inicio -- usa el MISMO `useRefrescoAlEnfocar` -- lo único que
// pasa al visitarla es que cada visita dispara UN INTENTO MÁS, y el fallo
// original (un timeout de red) era transitorio: el siguiente intento, dado
// más tiempo, sale bien. El cliente fue explícito: "ningún dato actualizado
// puede depender de cerrar sesión o de navegar a otra pantalla" -- así que
// ese reintento tiene que dispararlo la propia pantalla, sola.
// ---------------------------------------------------------------------------

export interface EstadoReintento {
  /** Cuántos intentos automáticos ya fallaron seguidos, desde el último éxito (o desde que se entró a la pantalla). */
  intentos: number;
}

export const REINTENTO_INICIAL: EstadoReintento = { intentos: 0 };

/**
 * Milisegundos antes del próximo intento automático. Fijo y corto a
 * propósito: lo que se está compensando es un timeout de red de unos
 * segundos (el caso real: el backend recién reiniciado), no una caída
 * prolongada -- para esa, ya está el mensaje honesto ("sin red") y el
 * "Reintentar" a mano.
 */
export const INTERVALO_REINTENTO_MS = 4000;

/**
 * Tope de intentos automáticos y silenciosos antes de dejar de insistir
 * solo. Sin este tope, una red de verdad caída dispararía un intento cada
 * `INTERVALO_REINTENTO_MS` para siempre mientras la pantalla siga
 * enfocada -- gasto de batería y de red por algo que ya se le avisó a la
 * persona con el mensaje de error. Agotado el cupo, el próximo foco (o el
 * botón "Reintentar") retoma con la cuenta en cero.
 */
export const MAX_REINTENTOS_AUTOMATICOS = 5;

/** ¿Corresponde programar OTRO intento automático? */
export function debeReintentarAutomaticamente(estado: EstadoReintento): boolean {
  return estado.intentos < MAX_REINTENTOS_AUTOMATICOS;
}

/** El estado siguiente tras un intento que falló: un intento más. Un éxito no pasa por acá -- vuelve directo a `REINTENTO_INICIAL`. */
export function trasIntentoFallido(estado: EstadoReintento): EstadoReintento {
  return { intentos: estado.intentos + 1 };
}
