import type { Rol } from '../../tipos'

/**
 * LOS CONTRATOS DE `/api/usuarios`, tal como los devuelve el backend de este
 * repo (`backend/src/modules/usuarios/`). Viven acá y no en `src/tipos.ts`
 * porque ese archivo es zona compartida con otros agentes; cuando la pantalla
 * se integre, se mudan.
 *
 * Cotejados contra `usuarios.service.ts#UsuarioDto` y `usuarios.schema.ts`, no
 * deducidos de la pantalla del teléfono.
 */

/**
 * Una cuenta, como la manda `GET /api/usuarios` (y la devuelven el alta, la
 * edición y el cambio de estado).
 *
 * `sucursalId` es `null` SOLO para el rol administrador: es del sistema, no de
 * una tienda. Se deja `null` y no se normaliza a `undefined` como hace el
 * adaptador del teléfono: acá nadie más consume el tipo, y traducirlo sería un
 * paso que no compra nada.
 */
export interface UsuarioDto {
  id: number
  nombre: string
  dni: string
  rol: Rol
  sucursalId: number | null
  activo: boolean
  /** Quién la dio de alta. `null` = sembrada por el seed, no creada por la API. */
  creadoPorId: number | null
  /** ISO 8601. */
  createdAt: string
}

/**
 * Cuerpo de `POST /api/usuarios` (`crearUsuarioSchema`).
 *
 * `sucursalId` se OMITE para un administrador y es obligatorio para los otros
 * tres roles: el servidor rechaza con 400 las dos desviaciones (mandarla para
 * un administrador, u omitirla para el resto).
 *
 * NO HAY CAMPO PARA EL ROL DE QUIEN CREA, y es a propósito: el servidor lo saca
 * del token (`usuarios.controller.ts#actorDe`), nunca del cuerpo.
 */
export interface CuerpoDeAlta {
  nombre: string
  dni: string
  rol: Rol
  sucursalId?: number
  pin: string
}

/**
 * Cuerpo de `PATCH /api/usuarios/:id` (`editarUsuarioSchema`). Todos los
 * campos son opcionales para el servidor; la pantalla manda siempre los
 * cuatro, igual que el teléfono, salvo `sucursalId` para un administrador.
 */
export interface CuerpoDeEdicion {
  nombre: string
  dni: string
  rol: Rol
  sucursalId?: number
}

/**
 * Quién está usando la pantalla, armado desde la sesión del portal
 * (`authStore`). El servidor no lo recibe nunca: lo vuelve a sacar del token.
 * Acá sirve solo para no OFRECER lo que el servidor va a rechazar.
 */
export interface Actor {
  id: number
  rol: Rol
  /** `null` para el administrador. */
  sucursalId: number | null
}

/** Una tienda que el administrador puede elegir al crear o editar una cuenta. */
export interface SucursalElegible {
  id: number
  nombre: string
}
