import type { EstadoInventario } from '../../tipos'

/**
 * Los contratos del backend que usa esta pantalla, leídos de
 * `backend/src/modules/historial/` (no deducidos de la pantalla del teléfono).
 *
 * Viven acá y no en `src/tipos.ts` porque el orquestador acotó la escritura a
 * `src/components/lacrado/` y hay otros agentes en el portal. Mismo criterio
 * que `ciclo/cicloTipos.ts`; cuando esta pantalla se integre, se mudan.
 */

/** Una firma registrada. `fecha` es ISO. */
export interface AprobacionDeCierre {
  colaboradorId: number
  nombre: string
  fecha: string
}

/**
 * `GET /api/historial/inventarios/:id/lacrado/estado` -- `EstadoLacradoDto` en
 * `historial.service.ts`.
 *
 * `aprobacionesRequeridas` VIAJA DESDE EL SERVIDOR y no se asume 2: hoy la
 * configuración es 1 (`APROBACIONES_REQUERIDAS`), y el día que sean tres la
 * pantalla se entera sola. Todo el texto de firmas se deriva de este número.
 */
export interface EstadoLacrado {
  inventarioId: number
  aprobaciones: AprobacionDeCierre[]
  aprobacionesRequeridas: number
  /** `false` = quedan hojas sin subir. Bloquea el lacrado. */
  todoSincronizado: boolean
  lacrado: boolean
  /** El sello. `null` mientras no se lacró. */
  hash: string | null
  lacradoEn: string | null
  /** Constancia del registro MANUAL en el ERP. Ver `lacradoApi.marcarRegistradoEnErp`. */
  registradoManualmenteEnDynamics: boolean
}

/**
 * `GET /api/historial/inventarios/:id/lacrado/verificacion` -- recalcula el
 * hash del contenido sellado y lo compara con el guardado.
 *
 * Es la respuesta a "¿alguien tocó esto después de lacrarlo?", y por eso la
 * pantalla la ofrece DESPUÉS del lacrado y no antes: sin sello no hay nada que
 * verificar.
 */
export interface VerificacionDelSello {
  inventarioId: number
  valido: boolean
  hashGuardado: string | null
  hashRecalculado: string | null
  motivo: string | null
}

/**
 * Una fila de `GET /api/historial/inventarios?sucursalId=` --
 * `InventarioListadoDto`. Solo los campos que esta pantalla lee.
 */
export interface InventarioDelHistorial {
  id: number
  sucursalId: number
  sucursalNombre: string
  estado: EstadoInventario
  /** "2026-09": clave legible y ordenable como texto. */
  periodo: string
  /** `null` mientras no se tomó el snapshot de Dynamics. */
  snapshotItems: number | null
}

export interface ListadoDelHistorial {
  inventarios: InventarioDelHistorial[]
}
