/**
 * LA LISTA BLANCA: que elementos puede tener cada rol.
 *
 * ---------------------------------------------------------------------------
 * DE DONDE SALE, Y POR QUE NO SALE DE LOS `requiereRol`
 * ---------------------------------------------------------------------------
 * La lista blanca de un rol son LAS RUTAS DE SU GRUPO: las pantallas que
 * viven en `mobile/app/<rol>/`. El Administrador prende, apaga y reordena
 * dentro de ese conjunto; nunca puede darle a un rol un elemento de otro.
 *
 * La primera version de esta funcionalidad iba a derivarla de los
 * `requiereRol` de cada router, y ESO ESTABA MAL. El router de auditoria
 * declara `requiereRol('administrador', 'auditor', 'coordinador')`: el
 * coordinador SI pasa esa puerta. Lo que le esconde el stock del ERP no es el
 * rol sino `auditoria.permisos.ts#puedeVerLaMatriz`, que es mas fino -- el
 * coordinador ve la matriz solo de inventarios YA CERRADOS, nunca del que
 * esta en curso. Derivando de los `requiereRol`, el Administrador habria
 * podido darle al Coordinador el "Panel de auditoria", que es exactamente lo
 * que no puede pasar: seria romper el CONTEO CIEGO, la regla sobre la que se
 * apoya el producto entero.
 *
 * El grupo de ruta no tiene ese problema, y no por convencion sino por
 * construccion: `app/auditor/auditoria.tsx` no existe dentro de
 * `app/coordinador/`, asi que no hay forma de darsela. La fuente de verdad ya
 * existia y ya estaba separada por rol.
 *
 * ---------------------------------------------------------------------------
 * SI ALGUNA VEZ APARECE UNA PANTALLA COMPARTIDA, ESTO SE ROMPE
 * ---------------------------------------------------------------------------
 * Hoy cada pantalla vive en el grupo de un solo rol, y cuando dos roles hacen
 * lo mismo hay DOS archivos (`/administrador/historial` y
 * `/auditor/historial`, que ademas comparten componente). El dia que alguien
 * ponga una pantalla en un solo grupo y la use desde dos roles, la contencion
 * de abajo deja de valer y hay que decidir otra cosa.
 *
 * NO se resuelve por adelantado a proposito: cualquier mecanismo que se
 * invente hoy para un caso que no existe va a ser el mecanismo equivocado. Se
 * deja anotado para que quien se lo cruce sepa que fue una decision y no un
 * descuido. El test de contencion va a romper primero, que es justamente lo
 * que se quiere.
 */

import type { Rol } from '../../shared/tipos';

/**
 * El prefijo de ruta de cada rol. Es la lista blanca: una ruta pertenece al
 * rol cuyo prefijo tiene, y a ninguno mas.
 */
export const PREFIJO_POR_ROL: Record<Rol, string> = {
  administrador: '/administrador/',
  coordinador: '/coordinador/',
  conteo: '/conteo/',
  auditor: '/auditor/',
};

/** El rol dueño de una ruta, o `null` si no cae en ningun grupo. */
export function rolDeLaRuta(ruta: string): Rol | null {
  for (const [rol, prefijo] of Object.entries(PREFIJO_POR_ROL) as Array<[Rol, string]>) {
    if (ruta.startsWith(prefijo)) return rol;
  }
  return null;
}

/**
 * Si este rol puede tener este acceso. Es LA regla de la lista blanca, en una
 * linea: la ruta tiene que ser de su propio grupo.
 */
export function rolAdmiteAcceso(rol: Rol, ruta: string): boolean {
  return rolDeLaRuta(ruta) === rol;
}
