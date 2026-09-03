/**
 * Regla de permisos: qué rol puede crear qué otro rol al dar de alta una
 * cuenta.
 *
 * NO es un ranking numérico "igual o inferior": el Auditor es un caso
 * explícito aparte. Definido por el cliente (arquitectura de roles,
 * 2026-09-03): un Administrador puede crear cualquier rol, incluido otro
 * Administrador. Un Auditor puede crear cuentas para SU sucursal, pero
 * solo de rol Coordinador o Conteo — nunca Auditor (su propio rol) ni
 * Administrador. Coordinador y Conteo no gestionan cuentas: lista vacía.
 *
 * Regla de negocio pura, sin dependencias — por eso vive en el dominio y
 * no en un adaptador. La usan la pantalla (para no ofrecer siquiera la
 * opción en el selector) Y cada adaptador de RepositorioUsuarios (para
 * revalidar en `crear()`, nunca confiar en que la UI ya lo impidió) —
 * ambos importan de acá, ninguno depende del otro.
 */

import type { Rol } from './tipos';

const ROLES_QUE_PUEDE_CREAR: Partial<Record<Rol, Rol[]>> = {
  administrador: ['administrador', 'auditor', 'coordinador', 'conteo'],
  auditor: ['coordinador', 'conteo'],
};

export function rolesQuePuedeCrear(creador: Rol): Rol[] {
  return ROLES_QUE_PUEDE_CREAR[creador] ?? [];
}

export function puedeCrearRol(creador: Rol, rolNuevo: Rol): boolean {
  return rolesQuePuedeCrear(creador).includes(rolNuevo);
}
