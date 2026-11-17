import api from '../../services/api'
import { nombreArchivoConsolidado } from './historialDominio'
import type {
  DetalleInventarioHistorico,
  DiferenciaHistorica,
  FiltroHistorial,
  HistoricoItem,
  LiquidacionInventario,
  PaginaDiferencias,
  PaginaHistorial,
} from './historialTipos'

/**
 * Las llamadas del Historial que `services/api.ts` todavía no tiene.
 *
 * Viven acá por indicación del orquestador: ese archivo lo está tocando otro
 * agente. Usan la MISMA instancia de axios — el token, el `baseURL` y el 401
 * que vuelve al login salen de ahí y no se reconfiguran. Mismo criterio que
 * `ciclo/cicloApi.ts` y `lacrado/lacradoApi.ts`.
 *
 * TODO EL MÓDULO ES DE LECTURA. Firmar y lacrar viven en
 * `lacrado/AprobacionYLacrado.tsx`, donde el control de dos personas ya está
 * resuelto: un histórico que además escribe es un histórico que se puede
 * reescribir. Las tres rutas de escritura del router (`aprobaciones`,
 * `lacrado`, `registro-erp`) no se cablean acá a propósito.
 *
 * Los contratos están verificados contra el backend vivo el 2026-10-17, no
 * deducidos: en particular las diferencias llegan envueltas en
 * `{ total, limite, desplazamiento, diferencias }` y NO como un array pelado.
 */

/** Un archivo que armó el servidor, con el nombre que el servidor le puso. */
export interface ArchivoDelServidor {
  bytes: Uint8Array
  nombreArchivo: string
}

/**
 * EL NOMBRE SALE DEL `Content-Disposition` cuando se puede leer, y si no del
 * respaldo que arma `historialDominio.ts` — ahí está explicado por qué hacen
 * falta los dos (en desarrollo la cabecera es invisible: otro origen y el
 * backend no la expone).
 */
function nombreDeLaCabecera(disposition: unknown, respaldo: string): string {
  if (typeof disposition !== 'string') return respaldo
  const coincidencia = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
  return coincidencia ? decodeURIComponent(coincidencia[1]) : respaldo
}

/**
 * EL MENSAJE DEL SERVIDOR, QUE CON `responseType` BINARIO SE PERDÍA.
 *
 * Pidiendo un `ArrayBuffer`, el cuerpo de un error también llega binario y
 * `describeApiError` busca `data.error` sobre algo que ya no es JSON: se leía
 * "El servidor rechazó los datos enviados" en vez del motivo real.
 */
function conCuerpoLegible(error: unknown): unknown {
  const respuesta = (error as { response?: { data?: unknown } }).response
  if (!(respuesta?.data instanceof ArrayBuffer)) return error
  try {
    respuesta.data = JSON.parse(new TextDecoder().decode(respuesta.data)) as unknown
  } catch {
    // No era JSON: se deja el binario y el mensaje sale del estado HTTP.
  }
  return error
}

async function bajarXlsx(url: string, respaldo: string, config = {}): Promise<ArchivoDelServidor> {
  try {
    const respuesta = await api.get<ArrayBuffer>(url, { responseType: 'arraybuffer', ...config })
    return {
      bytes: new Uint8Array(respuesta.data),
      nombreArchivo: nombreDeLaCabecera(respuesta.headers['content-disposition'], respaldo),
    }
  } catch (error) {
    throw conCuerpoLegible(error)
  }
}

/** El máximo que acepta el endpoint (`listarDiferenciasQuerySchema`). */
const MAXIMO_DIFERENCIAS = 500

export const historialApi = {
  /**
   * `GET /api/historial/inventarios` — paginado, tope de 100 por pedido.
   *
   * El recorte por rol lo aplica el servidor (`historial.permisos.ts`): el
   * administrador ve la cadena entera y el auditor lo que le corresponda. Acá
   * se manda el filtro para no pedir de más, nunca para autorizar.
   */
  listar: async (filtro: FiltroHistorial = {}): Promise<PaginaHistorial> =>
    (await api.get<PaginaHistorial>('/historial/inventarios', { params: filtro })).data,

  detalle: async (inventarioId: number): Promise<DetalleInventarioHistorico> =>
    (await api.get<DetalleInventarioHistorico>(`/historial/inventarios/${inventarioId}`)).data,

  /**
   * LAS DIFERENCIAS, TODAS LAS PÁGINAS.
   *
   * El endpoint topea en 500 por pedido y un mes malo pasa de 8.000 ítems, así
   * que con una sola página faltarían las demás — y faltarían EN SILENCIO: la
   * lista se vería completa y el total de abajo diría otra cosa. Se piden
   * todas y se corta por `total`; el corte por `recibidas === 0` es la red
   * contra un bucle si el servidor devolviera un `total` mayor que lo que
   * entrega. Mismo criterio que la matriz de "Corregir lo contado".
   */
  diferencias: async (inventarioId: number): Promise<DiferenciaHistorica[]> => {
    const filas: DiferenciaHistorica[] = []
    let desplazamiento = 0
    for (;;) {
      const { data } = await api.get<PaginaDiferencias>(`/historial/inventarios/${inventarioId}/diferencias`, {
        params: { limite: MAXIMO_DIFERENCIAS, desplazamiento },
      })
      filas.push(...data.diferencias)
      const recibidas = data.diferencias.length
      if (recibidas === 0 || filas.length >= data.total) break
      desplazamiento += recibidas
    }
    return filas
  },

  liquidacion: async (inventarioId: number): Promise<LiquidacionInventario> =>
    (await api.get<LiquidacionInventario>(`/historial/inventarios/${inventarioId}/liquidacion`)).data,

  /** `GET /api/historial/items/:codigo` — todas las veces que ese código dio diferencia. */
  historicoDeItem: async (codigo: string): Promise<HistoricoItem> =>
    (await api.get<HistoricoItem>(`/historial/items/${encodeURIComponent(codigo)}`)).data,

  /**
   * El .xlsx de faltantes/sobrantes de UN inventario. Lo arma el servidor: acá
   * no se construye ninguno. `utils/xlsx.ts` sabe escribir libros, pero el
   * formato de esta planilla lo define el backend, y una segunda
   * implementación se desalinea el día que cambie una columna.
   */
  exportarDiferencias: (inventarioId: number, respaldo: string): Promise<ArchivoDelServidor> =>
    bajarXlsx(`/historial/inventarios/${inventarioId}/diferencias/exportar`, respaldo),

  /**
   * El .xlsx de VARIAS tiendas (o todas) en un mismo período.
   *
   * `sucursalId` es REPETIBLE en la query (`?sucursalId=1&sucursalId=2`), no
   * un `sucursalIds` con comas: así lo valida `exportarConsolidadoQuerySchema`.
   * Por eso la query se arma a mano — el serializador por defecto de axios
   * escribe `sucursalId[]=1`, que depende de cómo esté configurado el parser
   * de Express para llegar como array.
   *
   * Sin `sucursalIds` son todas las que el rol permita: el recorte lo hace el
   * servidor (`resolverSucursalesConsultables`), nunca esta lista.
   */
  exportarConsolidado: (filtro: {
    periodoAnio: number
    periodoMes: number
    sucursalIds?: number[]
  }): Promise<ArchivoDelServidor> => {
    const query = new URLSearchParams({
      periodoAnio: String(filtro.periodoAnio),
      periodoMes: String(filtro.periodoMes),
    })
    for (const id of filtro.sucursalIds ?? []) query.append('sucursalId', String(id))
    return bajarXlsx(
      `/historial/diferencias/exportar?${query.toString()}`,
      nombreArchivoConsolidado(filtro.periodoAnio, filtro.periodoMes),
    )
  },

  /**
   * El .xlsx CON EL FORMATO DEL CLIENTE: los cuatro cuadros, empresa aparte y
   * la hoja de descuento, tal como el auditor arma su planilla a mano todos
   * los meses. Es OTRO archivo que el de diferencias, no su reemplazo.
   */
  exportarCuadros: (inventarioId: number, respaldo: string): Promise<ArchivoDelServidor> =>
    bajarXlsx(`/historial/inventarios/${inventarioId}/cuadros/exportar`, respaldo),
}
