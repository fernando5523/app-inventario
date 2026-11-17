import type { EstadoInventario } from '../../tipos'

/**
 * Los contratos del backend que usa esta pantalla, verificados con curl
 * contra el backend vivo el 2026-10-13 (no deducidos de la pantalla del
 * teléfono). Viven acá y no en `src/tipos.ts` porque ese archivo lo está
 * tocando otro agente; cuando esta pantalla se integre, se mudan.
 */

/**
 * `GET /api/sucursales/:sucursalId/inventarios/activo` -- `InventarioActivoDto`
 * en `backend/src/modules/inventarios/inventarios.service.ts`.
 *
 * Devuelve `null` (cuerpo `null`, status 200) cuando la sucursal no tiene
 * inventario abierto. Trae también los `ajuste_auditor`, no solo los
 * `en_curso`.
 */
export interface InventarioActivo {
  inventarioId: number
  /** Solo `en_curso` o `ajuste_auditor`: los demás no son "activos". */
  estado: Extract<EstadoInventario, 'en_curso' | 'ajuste_auditor'>
  items: number
  tomadoEn: string
  /** null = todavía no se crearon hojas (el Coordinador está en el paso 1). */
  tamanoHoja: number | null
  totalHojas: number
  /**
   * La ronda MÁS ALTA que tiene hojas creadas. YA NO ES SIEMPRE UNA RONDA QUE
   * ADMITE CONTEO: sigue siendo un número mientras el Auditor ajusta. Quién
   * puede contar lo dicen `estado` y `admiteConteo`.
   */
  rondaActiva: number | null
  /** La última ronda que se CERRÓ. Es la marca propia del cierre. */
  ultimaRondaCerrada: number | null
  /**
   * Si todavía se puede contar en `rondaActiva`. ESTA PANTALLA NO LO USA, a
   * propósito: ver el comentario de `faseDeCierre` en `cicloDominio.ts`.
   */
  admiteConteo: boolean
  stockDeRondaTomadoEn: string | null
  stockDeRondaItems: number | null
}

/**
 * `GET /api/inventarios/:inventarioId/rondas/:ronda/resumen` --
 * `ResumenRondaDto`. Es un PREVIEW: no muta nada.
 *
 * Responde **404** cuando esa ronda todavía no tiene hojas, y eso NO es un
 * fallo: es "esta pasada no empezó". Quien llama lo convierte en `null`.
 */
export interface ResumenRonda {
  inventarioId: number
  ronda: number
  /** Ítems que ENTRARON a la ronda. No dice nada sobre si se contaron. */
  total: number
  /** De esos, cuántos tienen conteo en alguna ronda (la actual o anterior). */
  contados: number
  /** Cuántos no tienen conteo en NINGUNA ronda: nadie los miró todavía. */
  sinContar: number
  cuadrados: number
  /** Van a la ronda siguiente. */
  aRecontar: number
  /** No se pueden auditar: falta el stock del ERP. No se recuentan. */
  sinDatoErp: number
  /** % de cuadrados sobre los AUDITABLES (los que tienen stock), no sobre el total. */
  porcentajeCuadrado: number
  /** Hojas de la ronda que faltan finalizar: bloquean el cierre. */
  hojasSinFinalizar: Array<{ id: number; numero: string; estado: string; zona: string; asignada: boolean }>
  sePuedeCerrar: boolean
  /** Qué pasaría al cerrar: se abre otra ronda, o el ciclo termina. */
  siguienteRonda: number | null
  motivoSinSiguiente: string | null
}

/** `POST /api/inventarios/:inventarioId/rondas/abrir` -- `RondaExtraDto`. */
export interface RondaExtraAbierta {
  inventarioId: number
  /** La ronda nueva (la anterior + 1). */
  ronda: number
  /** Cuántos ítems entraron a recontar. */
  items: number
  hojas: Array<{ id: number; numero: string }>
}

/** `POST /api/inventarios/:inventarioId/ajuste/iniciar` -- `AjusteDto`. */
export interface AjusteIniciado {
  inventarioId: number
  estado: string
  /** La ronda sobre la que escribe el ajuste: la última que se contó. */
  ronda: number
}

/** Una fila de `GET /api/historial/inventarios` -- `InventarioListadoDto`, recortada. */
export interface InventarioDelHistorial {
  id: number
  sucursalId: number
  sucursalNombre: string
  estado: EstadoInventario
  periodo: string
  tamanoHoja: number | null
  snapshotItems: number
}

export interface ListadoDelHistorial {
  total: number
  inventarios: InventarioDelHistorial[]
}
