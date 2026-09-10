import type { Rol } from './tipos';

export interface EntradaSucursalEnFoco {
  /** El rol de quien mira la pantalla (sale de la sesión, del padrón). */
  rol: Rol;
  /** La sucursal de la sesión (`sesion.sucursal?.id`), o `null` si no tiene. */
  sucursalDeSesion: number | null;
  /** La que el AUDITOR eligió en el selector; `null` = todavía no eligió. */
  elegida: number | null;
}

/**
 * Qué sucursal opera una pantalla de INVENTARIO ÚNICO (Panel de Auditoría,
 * Ciclo): esas pantallas miran UN inventario de UNA sucursal, no "todas".
 *
 * - Coordinador / conteo: SIEMPRE la de su sesión. Están atados a su tienda y
 *   no eligen -- no cambia con este requisito (regla del cliente).
 * - Auditor: la que ELIGIÓ. Si todavía no eligió, arranca en la de su ficha
 *   como default inicial (para no abrir la pantalla vacía, mismo criterio que
 *   ComparativoScreen), pero es una selección más que puede cambiar -- ya NO
 *   es un recorte fijo. El cliente definió que el auditor accede a TODAS las
 *   sucursales; la ficha deja de atarlo y pasa a ser solo el punto de partida.
 *
 * Devuelve `null` solo si un auditor sin sucursal en la ficha no eligió nada:
 * ahí la pantalla pide elegir en vez de inventar una.
 */
export function sucursalEnFoco({ rol, sucursalDeSesion, elegida }: EntradaSucursalEnFoco): number | null {
  if (rol !== 'auditor') return sucursalDeSesion;
  return elegida ?? sucursalDeSesion;
}
