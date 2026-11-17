import axios, { AxiosError, type AxiosInstance } from 'axios'
import type { Colaborador, Periodo, ResumenDeLaCadena, Sesion, Sucursal } from '../tipos'

/**
 * UNA sola instancia de axios para todo el portal, con el patrón de
 * `app_pdv/client/src/services/api.ts`: token en el interceptor de pedido,
 * limpieza y vuelta al login en el de respuesta.
 *
 * Dos diferencias con app_pdv, y las dos importan:
 *
 * 1. NO van las cabeceras `x-device-fingerprint` ni `x-company-id`. La primera
 *    identifica el equipo para resolver la caja de una venta; la segunda, la
 *    empresa activa de un sistema multiempresa. Acá no hay ninguna de las dos
 *    cosas, y mandar cabeceras que el servidor ignora hace creer que significan
 *    algo.
 *
 * 2. EL CUERPO DE LA RESPUESTA ES EL DATO. app_pdv envuelve todo en
 *    `{ success, data }` y sus funciones devuelven `response.data.data!`. Este
 *    backend contesta el objeto pelado (verificado con curl contra el backend
 *    vivo), así que acá es `response.data`. Copiar el `.data.data` de app_pdv
 *    habría devuelto `undefined` en silencio.
 */
const API_URL = import.meta.env.VITE_API_URL || '/api'

const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
})

/** La clave del token en `localStorage`. Un solo lugar: lo leen el store y los dos interceptores. */
export const CLAVE_TOKEN = 'inventario_token'

api.interceptors.request.use(
  (config) => {
    let token: string | null = null
    try {
      token = localStorage.getItem(CLAVE_TOKEN)
    } catch {
      // Almacenamiento bloqueado (modo privado estricto): el pedido sale sin
      // token y el servidor contesta 401, que es la verdad.
    }
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  },
  (error) => Promise.reject(error),
)

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const url = error.config?.url ?? ''
    /**
     * El 401 del propio ingreso NO es una sesión vencida: es un PIN
     * equivocado, y tiene que llegar al formulario para que lo diga ahí. Si
     * entrara por este camino, la pantalla de login se recargaría sola y el
     * usuario no vería nunca el mensaje.
     */
    const esElIngreso = url.includes('/sesion/ingresar')
    if (error.response?.status === 401 && !esElIngreso) {
      try {
        localStorage.removeItem(CLAVE_TOKEN)
      } catch {
        // Sin almacenamiento no había token que borrar.
      }
      if (window.location.pathname !== '/login') window.location.href = '/login'
    }
    return Promise.reject(error)
  },
)

/** Sesión: las tres listas públicas del login, el ingreso y el cambio de PIN. */
export const sesionApi = {
  /** Público, sin token. */
  sucursales: async (): Promise<Sucursal[]> => (await api.get<Sucursal[]>('/sesion/sucursales')).data,

  /** Público. Los que se pueden elegir EN esa tienda (incluye al auditor asignado). */
  colaboradores: async (sucursalId: number): Promise<Colaborador[]> =>
    (await api.get<Colaborador[]>(`/sesion/sucursales/${sucursalId}/colaboradores`)).data,

  /**
   * Público. Camino aparte para el administrador: no cuelga de ninguna tienda,
   * así que no puede salir de la lista de arriba.
   */
  administradores: async (): Promise<Colaborador[]> =>
    (await api.get<Colaborador[]>('/sesion/administradores')).data,

  /** El PIN son 6 dígitos exactos: el servidor rechaza con 400 cualquier otra cosa. */
  ingresar: async (colaboradorId: number, pin: string): Promise<Sesion> =>
    (await api.post<Sesion>('/sesion/ingresar', { colaboradorId, pin })).data,

  /**
   * Cambio de PIN propio. NO lleva `colaboradorId`: quién cambia el PIN sale
   * del token, y el schema del servidor es `.strict()` -- mandar un id ajeno
   * da 400 en vez de ignorarse.
   */
  cambiarPin: async (pinActual: string, pinNuevo: string): Promise<void> => {
    await api.post('/sesion/cambiar-pin', { pinActual, pinNuevo })
  },
}

/** La query del período, compartida por la tabla y por su .xlsx de respaldo. */
function consultaPeriodo(periodo?: Periodo): string {
  if (!periodo) return ''
  return `?anio=${periodo.anio}&mes=${periodo.mes}`
}

/** Un archivo que armó el servidor, con el nombre que el servidor le puso. */
export interface ArchivoDelServidor {
  bytes: Blob
  nombreArchivo: string
}

/**
 * Saca el nombre del archivo de `Content-Disposition`. El nombre lo manda el
 * SERVIDOR y no se arma acá: sin `anio`/`mes` en la query el período lo
 * resuelve el servidor con su reloj, así que el cliente no sabe de qué mes es
 * el archivo que acaba de bajar.
 */
function nombreDeLaCabecera(disposition: unknown, respaldo: string): string {
  if (typeof disposition !== 'string') return respaldo
  const coincidencia = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
  return coincidencia ? decodeURIComponent(coincidencia[1]) : respaldo
}

export const auditoriaApi = {
  /**
   * `GET /api/auditoria/cadena?anio=&mes=` -- las diez tiendas del período en
   * una sola llamada. Sin período, el servidor usa el mes en curso.
   *
   * SIN RELLENO: si el endpoint falla, falla. Devolver una cadena vacía
   * mostraría "0 tiendas con inventario" sobre una cadena que sí está contando.
   */
  cadena: async (periodo?: Periodo): Promise<ResumenDeLaCadena> =>
    (await api.get<ResumenDeLaCadena>(`/auditoria/cadena${consultaPeriodo(periodo)}`)).data,

  /**
   * `GET /api/auditoria/cadena/diferencias/exportar?anio=&mes=` -- el .xlsx con
   * el detalle por producto de los faltantes y sobrantes de todas las tiendas.
   * Es el respaldo de la tabla: misma query y mismo permiso.
   */
  exportarDiferenciasDeLaCadena: async (periodo?: Periodo): Promise<ArchivoDelServidor> => {
    const respuesta = await api.get(`/auditoria/cadena/diferencias/exportar${consultaPeriodo(periodo)}`, {
      responseType: 'blob',
    })
    return {
      bytes: respuesta.data as Blob,
      nombreArchivo: nombreDeLaCabecera(
        respuesta.headers['content-disposition'],
        periodo
          ? `diferencias-cadena-${periodo.anio}-${String(periodo.mes).padStart(2, '0')}.xlsx`
          : 'diferencias-cadena.xlsx',
      ),
    }
  },
}

export default api
