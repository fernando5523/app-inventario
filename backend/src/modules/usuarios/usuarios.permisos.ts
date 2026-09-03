/**
 * Matriz de "quien puede crear/gestionar a quien" -- CERO Prisma aca a
 * proposito: es la regla de negocio mas sensible del modulo (evita que un
 * auditor se cree un administrador), asi que tiene que poder testearse
 * sin base de datos. usuarios.service.ts llama estas funciones y agrega
 * el acceso a Prisma alrededor; el pedido explicito del cliente que
 * codifican estas dos funciones:
 *
 *   - El rol de una cuenta lo decide SIEMPRE quien la crea -- nunca se
 *     acepta un rol que venga de un token ni del cliente mas alla de
 *     `actor` (que sale de req.colaborador, puesto por auth.middleware.ts
 *     a partir del token, jamas del body).
 *   - Nadie crea una cuenta con rol superior al propio:
 *       administrador -> puede crear/gestionar cualquier rol, cualquier sucursal.
 *       auditor       -> coordinador/conteo, SOLO de su propia sucursal.
 *                         Nunca otro auditor ni un administrador.
 *       coordinador/conteo -> ninguno (ademas bloqueados antes por
 *                         requiereRol en las rutas -- esto es cinturon y
 *                         tiradores, no el unico lugar que los frena).
 */

import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado, Rol } from '../../shared/tipos';

/** Roles que un auditor puede crear/gestionar -- nunca auditor ni administrador. */
export const ROLES_GESTIONABLES_POR_AUDITOR: Rol[] = ['coordinador', 'conteo'];

export interface DatosAlta {
  rol: Rol;
  /** undefined es valido SOLO cuando rol === 'administrador' (ver usuarios.schema.ts). */
  sucursalId: number | undefined;
}

/** Lanza Prohibido si `actor` no puede dar de alta una cuenta con estos datos. */
export function validarPermisoDeAlta(actor: ColaboradorAutenticado, datos: DatosAlta): void {
  if (actor.rol === 'administrador') return;

  if (actor.rol !== 'auditor') {
    throw new Prohibido('Tu rol no puede dar de alta usuarios.');
  }
  if (!ROLES_GESTIONABLES_POR_AUDITOR.includes(datos.rol)) {
    throw new Prohibido('Un auditor solo puede crear coordinador o conteo, nunca auditor ni administrador.');
  }
  if (datos.sucursalId !== actor.sucursalId) {
    throw new Prohibido('Un auditor solo puede crear cuentas de su propia sucursal.');
  }
}

export interface DatosObjetivo {
  rol: Rol;
  sucursalId: number | null;
}

/**
 * Lanza Prohibido si `actor` no puede gestionar (habilitar/deshabilitar/
 * resetear PIN) a una cuenta YA EXISTENTE con estos datos. Mismo recorte
 * que validarPermisoDeAlta, pero contra una fila real en vez del input de
 * creacion (el objetivo puede tener sucursalId null si es otro
 * administrador -- eso ya lo saca el chequeo de rol antes de comparar).
 */
export function validarAlcanceDeGestion(actor: ColaboradorAutenticado, objetivo: DatosObjetivo): void {
  if (actor.rol === 'administrador') return;

  if (actor.rol !== 'auditor') {
    throw new Prohibido('Tu rol no puede gestionar usuarios.');
  }
  if (objetivo.sucursalId !== actor.sucursalId || !ROLES_GESTIONABLES_POR_AUDITOR.includes(objetivo.rol)) {
    throw new Prohibido('Un auditor solo gestiona coordinador/conteo de su propia sucursal.');
  }
}
