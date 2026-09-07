import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { debeRefrescar, esVueltaAPrimerPlano, type EstadoApp } from './refresco';

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
}

export interface RefrescoAlEnfocar {
  /** `true` mientras corre un refresco. Para el `RefreshControl`. */
  refrescando: boolean;
  /** Dispara un refresco a mano ("tirar para refrescar"). */
  refrescar: () => void;
}

export function useRefrescoAlEnfocar(
  cargar: () => Promise<void> | void,
  opciones: OpcionesRefresco = {},
): RefrescoAlEnfocar {
  const pausado = opciones.pausado ?? false;
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

  const ejecutar = useCallback(async (): Promise<void> => {
    if (!debeRefrescar({ enVuelo: enVuelo.current, pausado: pausadoRef.current })) return;
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
