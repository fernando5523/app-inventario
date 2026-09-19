/**
 * Adaptador HTTP de la configuración de navegación — el lado del
 * Administrador. El del resto de los roles es `navegacion-api.ts`, que trae
 * lo suyo y tiene respaldo; este NO tiene respaldo a propósito: si la
 * pantalla de configuración no puede leer el estado real, no puede dejar que
 * nadie lo cambie a ciegas.
 *
 *   GET  /api/navegacion/config/:rol                 → ConfiguracionDeUnRol
 *   PUT  /api/navegacion/config/:rol   { tipo, elementos }
 *   POST /api/navegacion/config/:rol/restablecer { tipo }
 *
 * Quién puede tocarlo lo decide el servidor (solo administrador) y responde
 * 403. Acá no se replica esa decisión: una pantalla que esconde un botón no
 * es un control de acceso.
 */

import type { Rol } from '../dominio/tipos';
import { pedir } from './_http';

export type TipoNavegacion = 'acceso' | 'tab';

export interface AccesoConfigurable {
  ruta: string;
  titulo: string;
  sub: string;
  /** El porqué del catálogo: por qué está donde está. Lo muestra la pantalla. */
  nota?: string;
  visible: boolean;
  orden: number;
}

export interface TabConfigurable {
  name: string;
  etiqueta: string;
  nota?: string;
  visible: boolean;
  orden: number;
}

export interface ConfiguracionDeUnRol {
  rol: Rol;
  accesos: AccesoConfigurable[];
  tabs: TabConfigurable[];
  /** Cuántos tabs se pueden prender a la vez. Viene del servidor, no se hardcodea. */
  maximoTabs: number;
}

export function traerConfiguracion(rol: Rol): Promise<ConfiguracionDeUnRol> {
  return pedir<ConfiguracionDeUnRol>(`/api/navegacion/config/${rol}`);
}

/**
 * Guarda la lista ENTERA y en orden, no un cambio suelto. Reordenar es
 * justamente donde un diff se rompe: dos cambios simultáneos dejarían el
 * orden a medias (ver el servicio del backend).
 */
export function guardarConfiguracion(
  rol: Rol,
  tipo: TipoNavegacion,
  elementos: Array<{ clave: string; visible: boolean }>,
): Promise<ConfiguracionDeUnRol> {
  return pedir<ConfiguracionDeUnRol>(`/api/navegacion/config/${rol}`, {
    metodo: 'PUT',
    cuerpo: { tipo, elementos },
  });
}

/** Vuelve al valor de fábrica ese rol y tipo. La salida cuando alguien se equivoca. */
export function restablecerConfiguracion(rol: Rol, tipo: TipoNavegacion): Promise<ConfiguracionDeUnRol> {
  return pedir<ConfiguracionDeUnRol>(`/api/navegacion/config/${rol}/restablecer`, {
    metodo: 'POST',
    cuerpo: { tipo },
  });
}
