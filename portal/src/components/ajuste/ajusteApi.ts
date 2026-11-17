import api from '../../services/api'
import { corregirApi } from '../corregir/api'
import type { EstadoDelInventario, LineaEmpaque } from '../corregir/tipos'
import { productoIdPorCodigo } from './reglas'

/**
 * Los tres endpoints del ajuste final. Las LECTURAS no están acá: el
 * inventario activo y la matriz las trae `corregirApi`, y pedirlas por un
 * camino propio sería una segunda forma de leer lo mismo.
 *
 * Verificado contra `backend/src/modules/inventarios/` el 2026-10-17.
 */

/** `POST /api/inventarios/:id/ajuste/iniciar` — `AjusteDto`. `en_curso` pasa a `ajuste_auditor`. */
export interface AjusteIniciado {
  inventarioId: number
  estado: EstadoDelInventario
  /** La ronda sobre la que escribe el ajuste: la última que se contó. */
  ronda: number
}

/**
 * `PATCH /api/inventarios/:id/ajuste/:productoId` — `AjusteDeConteoDto`.
 *
 * El cuerpo es el MISMO de la corrección (`corregirConteoSchema`, `.strict()`,
 * motivo de 3 a 200). El stock NO viaja: no hay forma de editarlo desde acá
 * porque no existe el campo, no porque esté deshabilitado.
 */
export interface AjusteDeConteo {
  total: number
  totalAnterior: number
  /** `null` = el snapshot no trajo stock. Nunca 0: "no sé" no es "cero". */
  stockErp: number | null
  diferencia: number | null
}

/** `POST /api/inventarios/:id/ajuste/cerrar` — `CierreDelConteoDto`. Lo que quedó congelado. */
export interface AjusteCerrado {
  inventarioId: number
  estado: EstadoDelInventario
  itemsTotales: number
  itemsConDiferencia: number
  unidadesFaltantes: number
  unidadesSobrantes: number
  montoFaltanteBruto: number
  colaboradoresAlcanzados: number
  diasDelInventario: number
}

/**
 * ---------------------------------------------------------------------------
 * EL `productoId` QUE PIDE EL AJUSTE, POR CÓDIGO — Y POR QUÉ NO ES EL DE LA MATRIZ
 * ---------------------------------------------------------------------------
 * El mismo artículo se materializa como un `Producto` DISTINTO en cada hoja de
 * cada ronda; el puente entre rondas es el CÓDIGO, no el id. La matriz devuelve
 * el `productoId` DE LA RONDA 1 —lo dice `auditoria.service.ts`: "la ronda 1
 * manda para productoId/zona/hoja"— y `ajustarConteo` exige el de la ÚLTIMA
 * ronda, porque el ajuste corrige el último conteo.
 *
 * Mandar el de la matriz da 404 "Ese producto no pertenece a la última ronda"
 * en TODO inventario con más de una ronda. Verificado contra el backend vivo el
 * 2026-10-17 con el inventario 8078: el código 100150 es el producto 7045 en la
 * ronda 1 y el 8054 en la 4ta.
 *
 * De paso resuelve quién SE PUEDE ajustar: la última ronda solo tiene los ítems
 * que llegaron hasta ella. Un ítem que cuadró en la ronda 1 no está en sus
 * hojas y no tiene nada que ajustar — el que no esté en este mapa no es
 * ajustable, y la pantalla lo dice en vez de dejar que falle al guardar.
 */
async function productosDeLaUltimaRonda(inventarioId: number, ronda: number): Promise<Map<string, number>> {
  return productoIdPorCodigo(await corregirApi.hojasDeLaRonda(inventarioId, ronda))
}

export const ajusteApi = {
  productosDeLaUltimaRonda,

  iniciar: async (inventarioId: number): Promise<AjusteIniciado> =>
    (await api.post<AjusteIniciado>(`/inventarios/${inventarioId}/ajuste/iniciar`)).data,

  /** El valor va en UNIDADES: `{ empaques: [], sueltas: N }`. Ver `reglas.ts`. */
  ajustarItem: async (
    inventarioId: number,
    productoId: number,
    cuerpo: { empaques: LineaEmpaque[]; sueltas: number; motivo: string },
  ): Promise<AjusteDeConteo> =>
    (await api.patch<AjusteDeConteo>(`/inventarios/${inventarioId}/ajuste/${productoId}`, cuerpo)).data,

  cerrar: async (inventarioId: number): Promise<AjusteCerrado> =>
    (await api.post<AjusteCerrado>(`/inventarios/${inventarioId}/ajuste/cerrar`)).data,
}
