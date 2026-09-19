/**
 * QUÉ VA A PASAR SI SE GUARDA ESTO. Puro, sin red y sin React.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTA FUNCIÓN EXISTE
 * ---------------------------------------------------------------------------
 * Apagarle un acceso a un rol puede dejar a alguien sin poder trabajar un
 * lunes a las 7 de la mañana: el contador abre la app, no tiene "Mis hojas" y
 * no hay nadie a quien preguntarle a esa hora. El que aprieta el interruptor
 * tiene que VER eso antes de confirmar, no enterarse el lunes.
 *
 * Y no alcanza con marcar el toggle: "4 accesos pasan a 3" es un número;
 * "deja de ver Asistencia del inventario" es la consecuencia. La segunda es
 * la que hace dudar a quien está por equivocarse.
 *
 * Misma idea que la consecuencia de ClasificacionScreen, y por el mismo
 * motivo: lo que decide no se deduce mirando los controles.
 */

/** Un elemento configurable, del tipo que sea. */
export interface ElementoConfigurable {
  /** Ruta (acceso) o nombre de archivo (tab). */
  clave: string;
  /** Lo que se le muestra a la persona: el título o la etiqueta. */
  nombre: string;
  visible: boolean;
}

export interface EfectoDeGuardar {
  /** `false` = no hay nada que guardar: los botones se apagan. */
  cambia: boolean;
  visiblesAntes: number;
  visiblesDespues: number;
  /** Los que se APAGAN. Son los que importan: alguien deja de verlos. */
  seApagan: string[];
  /** Los que se PRENDEN. */
  sePrenden: string[];
  /** `true` si además cambió el orden de los que quedan prendidos. */
  cambiaElOrden: boolean;
  /**
   * `true` cuando no queda NINGUNO prendido. Es el caso que hay que frenar,
   * no solo avisar: un rol sin un solo acceso es una persona que abre la app
   * y no tiene por dónde empezar.
   */
  quedaVacio: boolean;
}

/**
 * Compara lo guardado contra lo que hay en pantalla.
 *
 * Las dos listas son del MISMO tipo (accesos o tabs) y del mismo rol: mezclar
 * tipos daría un resumen que no se corresponde con ningún botón de guardar.
 */
export function calcularEfecto(
  antes: readonly ElementoConfigurable[],
  despues: readonly ElementoConfigurable[],
): EfectoDeGuardar {
  const visiblePorClave = new Map(antes.map((e) => [e.clave, e.visible]));

  const seApagan = despues.filter((e) => !e.visible && visiblePorClave.get(e.clave) === true).map((e) => e.nombre);
  const sePrenden = despues.filter((e) => e.visible && visiblePorClave.get(e.clave) === false).map((e) => e.nombre);

  // El orden se compara SOLO entre los prendidos: mover un apagado no cambia
  // nada de lo que alguien ve, y avisarlo sería ruido sobre una pantalla que
  // ya pide atención.
  const ordenAntes = antes.filter((e) => e.visible).map((e) => e.clave);
  const ordenDespues = despues.filter((e) => e.visible).map((e) => e.clave);
  const cambiaElOrden =
    ordenAntes.length === ordenDespues.length && ordenAntes.some((clave, i) => clave !== ordenDespues[i]);

  const visiblesDespues = ordenDespues.length;

  return {
    cambia: seApagan.length > 0 || sePrenden.length > 0 || cambiaElOrden,
    visiblesAntes: ordenAntes.length,
    visiblesDespues,
    seApagan,
    sePrenden,
    cambiaElOrden,
    quedaVacio: visiblesDespues === 0,
  };
}

/** Mueve un elemento una posición. Devuelve una lista nueva; no muta. */
export function mover<T>(lista: readonly T[], desde: number, hacia: number): T[] {
  if (desde < 0 || desde >= lista.length || hacia < 0 || hacia >= lista.length || desde === hacia) {
    return [...lista];
  }
  const copia = [...lista];
  const [elemento] = copia.splice(desde, 1);
  copia.splice(hacia, 0, elemento!);
  return copia;
}
