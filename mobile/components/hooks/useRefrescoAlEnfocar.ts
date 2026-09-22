import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { decidirRefresco, esVueltaAPrimerPlano, type EstadoApp } from './refresco';

/**
 * "Cualquier dato actualizado no debe depender de cerrar sesión y volver."
 * — pedido del cliente, 2026-09-07.
 *
 * Este hook es ese pedido, en un solo lugar. Recarga los datos de la pantalla
 * en los dos momentos en que la persona espera verlos frescos:
 *
 *   1. Al ENFOCAR la pantalla (volver de otra pestaña o de un push).
 *   2. Al volver la app a PRIMER PLANO (estaba en el bolsillo, se cerró la
 *      ronda mientras tanto).
 *
 * El (2) es el que faltaba en todas: los tabs quedan montados una vez
 * visitados (React Navigation), así que una pantalla que solo escucha el foco
 * NUNCA se entera de nada mientras el teléfono está bloqueado. Es exactamente
 * el caso del Contador que deja la app abierta, el Coordinador abre la ronda
 * 2, y él sigue viendo la ronda 1 hasta que cierra sesión.
 *
 * Lo que este hook NO hace, y es deliberado:
 *
 *  - NO toca tu estado de `cargando`. La primera carga la seguís manejando
 *    vos con tu spinner; los refrescos posteriores son silenciosos y dejan lo
 *    que ya se ve en pantalla hasta que llega el dato nuevo. Un spinner que
 *    tapa la lista cada vez que volvés de otra pestaña se siente peor que el
 *    dato viejo que venía a arreglar.
 *  - NO maneja errores. Si `cargar` falla (sin red), la pantalla ya sabe qué
 *    hacer con eso: lo último bueno se sigue mostrando porque nadie lo borró.
 *    El hook solo garantiza que un fallo no deje el candado trabado.
 *
 * ## Uso
 *
 * ```tsx
 * const cargar = useCallback(async () => {
 *   setDatos(await repositorio.traer());
 * }, [deps]);
 *
 * const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar);
 *
 * return (
 *   <PantallaConTabs
 *     scrollable
 *     refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
 *   >
 * ```
 *
 * Con un modal o un formulario abierto, pausalo — refrescar no puede pisar
 * lo que la persona está escribiendo:
 *
 * ```tsx
 * useRefrescoAlEnfocar(cargar, { pausado: modalAbierto || Boolean(editando) });
 * ```
 */
export interface OpcionesRefresco {
  /**
   * `true` = no refrescar ahora. Para cuando hay un modal abierto o una
   * edición a medio escribir: un refresco que llega en ese momento puede
   * cerrar el modal o pisar el formulario, y eso es perder trabajo de la
   * persona, no un parpadeo.
   *
   * OJO con lo que NO cubre: si tu pantalla tiene trabajo local sin
   * sincronizar (la cola de conteos), eso no se protege con esta bandera sino
   * no tocándolo — `cargar` nunca debe borrar lo pendiente de subir.
   */
  pausado?: boolean;
  /**
   * `true` = un disparo que llegó estando PAUSADO no se tira: se guarda y
   * corre apenas se despausa (se cierra el modal, se termina de guardar).
   *
   * OPT-IN, y el default `false` es el comportamiento de siempre. Este hook lo
   * usan las pantallas de cuatro roles a la vez y hay gente escribiendo en
   * ellas ahora mismo: cambiarle el comportamiento a todas desde acá sería
   * moverles el piso sin que lo hayan pedido (misma regla que el select
   * buscable compartido, ver trujillo-ui). Lo prende la pantalla que lo
   * necesita.
   *
   * PARA QUE SIRVE, medido el 2026-09-21: `pausado` descartaba el disparo. El
   * Administrador deja abierto el menú de acciones de una ficha en Usuarios,
   * manda la app al fondo, vuelve, cierra el menú -- y la lista sigue siendo
   * la de antes, con una cuenta mostrada como activa que otro administrador ya
   * deshabilitó. Ver `decidirRefresco` en ./refresco.
   *
   * HAY DOS FORMAS DE PAUSA, Y ESTA OPCION IMPORTA MAS EN LA SEGUNDA:
   *
   *  - Un MODAL o un formulario abierto. Dura lo que tarda la persona en
   *    decidir, y el disparo perdido se recupera solo en el próximo foco.
   *  - Una OPERACION LARGA en curso. `app/coordinador/armar.tsx` pausa
   *    mientras baja el snapshot de ~11.000 ítems de Dynamics: son minutos, y
   *    es justo cuando alguien manda la app al fondo y se va a hacer otra
   *    cosa. Ahí la pausa no protege nada que se esté escribiendo -- protege
   *    una espera -- y el disparo que llega en el medio es el que más falta
   *    hace al volver.
   *
   * CUANDO NO PRENDERLO: cuando la acción que pausa YA deja el estado al día
   * con su propia respuesta, y no queda nada más que releer (Configuración,
   * Accesos y menús). Ahí el refresco diferido es un pedido de más que no
   * cambia nada de lo que se ve. Ojo con el matiz: lo que decide no es que sea
   * un formulario, es si la respuesta de la acción cubre TODO lo que la
   * pantalla muestra -- una acción que actualiza su parte y deja el resto
   * viejo sí lo necesita.
   *
   * SU LIMITE, dicho para que nadie lo lea como una garantía absoluta: si al
   * despausar justo hay otra recarga en vuelo, este disparo se descarta. No se
   * pierde nada real -- la que está corriendo trae datos igual de frescos --,
   * pero no es "siempre corre exactamente una recarga al despausar".
   */
  recuperarAlDespausar?: boolean;
}

export interface RefrescoAlEnfocar {
  /** `true` mientras corre un refresco. Para el `RefreshControl`. */
  refrescando: boolean;
  /** Dispara un refresco a mano ("tirar para refrescar"). */
  refrescar: () => void;
}

/**
 * LO QUE ESTE HOOK NO HACE, Y YA COSTO UNA PANTALLA MUERTA
 * ---------------------------------------------------------------------------
 * NO reacciona a que `cargar` cambie de identidad. Dispara al ENFOCAR la
 * pantalla y al volver a primer plano, y nada más -- `cargar` vive en un ref
 * justamente para eso (ver el comentario de `cargarRef`).
 *
 * O sea: si tu pantalla tiene un selector PROPIO que cambia QUE se pide -- un
 * chip de rol, un filtro de período, un combo de sucursal --, cambiarlo NO
 * dispara una recarga. Con la pantalla ya enfocada, el evento que despierta a
 * este hook no vuelve a ocurrir nunca.
 *
 * Bug real (2026-09-19, `app/administrador/navegacion.tsx`): el handler del
 * chip de rol hacía `setCargando(true)` y confiaba en que este hook recargara.
 * No recarga. El spinner quedaba girando para siempre y volver al rol anterior
 * tampoco lo recuperaba, sin excepción ni nada en logcat.
 *
 * QUE HACER en esas pantallas: un `useEffect` propio con el selector en las
 * dependencias, que sea el ÚNICO dueño del estado de carga -- que lo prenda al
 * empezar y lo apague al terminar. Así no existe forma de prender el spinner
 * sin arrancar el pedido. Este hook queda para lo suyo: el "tirar para
 * refrescar" y el volver a la pantalla.
 */
export function useRefrescoAlEnfocar(
  cargar: () => Promise<void> | void,
  opciones: OpcionesRefresco = {},
): RefrescoAlEnfocar {
  const pausado = opciones.pausado ?? false;
  const recuperarAlDespausar = opciones.recuperarAlDespausar ?? false;
  const [refrescando, setRefrescando] = useState(false);

  // En un ref y no en el estado: es un CANDADO, y tiene que valer ya mismo
  // dentro del mismo tick. `setRefrescando(true)` no se ve hasta el próximo
  // render, así que dos disparos en el mismo instante (enfocar + volver a
  // primer plano, que pasan juntos al desbloquear el teléfono) leerían los
  // dos `false` y saldrían las dos recargas.
  const enVuelo = useRef(false);

  // `cargar` cambia de identidad en cada render (depende de filtros, sesión,
  // etc.). Guardarlo en un ref deja que el listener de AppState se suscriba
  // UNA vez y siga llamando siempre a la versión actual -- si el efecto
  // dependiera de `cargar`, se desuscribiría y resuscribiría en cada tecla
  // que cambie un filtro.
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;
  const pausadoRef = useRef(pausado);
  pausadoRef.current = pausado;

  /**
   * Hubo un disparo mientras estaba pausado y todavía no se recuperó.
   *
   * En un ref y no en el estado por lo mismo que `enVuelo`: se escribe desde
   * `ejecutar`, que corre fuera del ciclo de render, y hay que poder leerlo en
   * el mismo tick. Es un booleano y no una cola a propósito -- tres disparos
   * pausados se recuperan con UNA recarga, porque lo que se quiere es el
   * estado de ahora, no repetir la historia.
   */
  const pendienteRef = useRef(false);

  const ejecutar = useCallback(async (): Promise<void> => {
    const decision = decidirRefresco({ enVuelo: enVuelo.current, pausado: pausadoRef.current });
    if (decision === 'posponer') {
      // Se anota SIEMPRE, aunque la pantalla no haya pedido recuperarlo: el
      // efecto de abajo es el único que lo lee, y solo corre con la opción
      // prendida. Así la bandera no depende de cuándo se leyó la opción.
      pendienteRef.current = true;
      return;
    }
    if (decision === 'descartar') return;
    enVuelo.current = true;
    setRefrescando(true);
    try {
      await cargarRef.current();
    } finally {
      // SIEMPRE, aunque `cargar` haya lanzado: si el candado quedara trabado
      // por un error de red, la pantalla no volvería a refrescarse nunca más
      // en toda la sesión -- justo lo que este hook viene a arreglar.
      enVuelo.current = false;
      setRefrescando(false);
    }
  }, []);

  // Al enfocar. `useFocusEffect` ya se usaba en todas estas pantallas; lo que
  // se agrega es el candado, para que no se solape con el de AppState.
  useFocusEffect(
    useCallback(() => {
      void ejecutar();
    }, [ejecutar]),
  );

  // AL DESPAUSAR: corre el disparo que se pospuso mientras había un modal
  // abierto o un guardado en curso. Depende de `pausado` (no de un ref) porque
  // justamente lo que interesa es el RENDER en que pasa a `false`: ahí ya no
  // hay nada que pisarle a la persona.
  useEffect(() => {
    if (!recuperarAlDespausar || pausado || !pendienteRef.current) return;
    pendienteRef.current = false;
    void ejecutar();
  }, [recuperarAlDespausar, pausado, ejecutar]);

  // Al volver a primer plano.
  useEffect(() => {
    let anterior: EstadoApp = (AppState.currentState as EstadoApp | null) ?? 'active';
    const suscripcion = AppState.addEventListener('change', (siguiente) => {
      const estado = siguiente as EstadoApp;
      const volvio = esVueltaAPrimerPlano(anterior, estado);
      anterior = estado;
      if (volvio) void ejecutar();
    });
    return () => suscripcion.remove();
  }, [ejecutar]);

  const refrescar = useCallback((): void => {
    void ejecutar();
  }, [ejecutar]);

  return { refrescando, refrescar };
}
