/**
 * Las llamadas de "Liquidación y nómina".
 *
 * VIVEN ACÁ Y NO EN `services/api.ts` porque ese archivo es zona compartida:
 * hay varios agentes escribiendo en el portal. Reusan la MISMA instancia de
 * axios (su token, su timeout y su 401 → login), que es lo único que no se
 * puede duplicar sin partir la sesión en dos. Mismo criterio que
 * `components/corregir/api.ts`.
 *
 * TODO el router exige rol `auditor` (`liquidacion.routes.ts`), incluidas las
 * lecturas. No hay nada que ofrecerle acá a otro rol.
 */

import api from '../../services/api'
import type {
  AjustesDelMes,
  CierreLiquidacion,
  Conciliacion,
  Liquidacion,
  ReporteGerencia,
} from './tipos'
import type {
  ImportacionConfirmada,
  ListadoLineasAjustesNegativos,
  ResultadoPreviewAjustesNegativos,
} from './ajustesNegativos'

/** Un archivo que armó el servidor, con el nombre que el servidor le puso. */
export interface ArchivoDelServidor {
  bytes: Blob
  nombreArchivo: string
}

/**
 * El nombre sale del `Content-Disposition`, no se arma acá: lo pone el
 * servidor y es el que identifica de qué tienda y de qué mes es el archivo.
 */
function nombreDeLaCabecera(disposition: unknown, respaldo: string): string {
  if (typeof disposition !== 'string') return respaldo
  const coincidencia = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
  return coincidencia ? decodeURIComponent(coincidencia[1]) : respaldo
}

/**
 * EL CUERPO ES EL .xlsx CRUDO, no JSON.
 *
 * El backend monta un `express.raw({ type: () => true })` solo en estas dos
 * rutas, y advierte que el cliente NO debe mandar `application/json`. La
 * instancia compartida de axios lo manda por defecto, así que acá se pisa; el
 * `transformRequest` vacío evita que axios toque el `ArrayBuffer`.
 */
function cuerpoBinario() {
  return {
    headers: { 'Content-Type': 'application/octet-stream' },
    transformRequest: [(datos: unknown) => datos],
  }
}

/**
 * `GET /api/liquidacion/sucursales/:id`.
 *
 * `null` = esta tienda todavía no tiene ningún inventario con el conteo
 * cerrado, y eso NO es un error: es el estado normal mientras se está
 * contando. El servidor contesta 200 con `null`.
 */
async function deSucursal(sucursalId: number): Promise<Liquidacion | null> {
  const { data } = await api.get<Liquidacion | null>(`/liquidacion/sucursales/${sucursalId}`)
  return data ?? null
}

/** `GET /api/liquidacion/sucursales/:id/conciliacion`. `null` con el mismo criterio. */
async function conciliacion(sucursalId: number): Promise<Conciliacion | null> {
  const { data } = await api.get<Conciliacion | null>(`/liquidacion/sucursales/${sucursalId}/conciliacion`)
  return data ?? null
}

/** `GET /api/liquidacion/inventarios/:id/ajustes` — solo lectura. */
async function ajustes(inventarioId: number): Promise<AjustesDelMes> {
  const { data } = await api.get<AjustesDelMes>(`/liquidacion/inventarios/${inventarioId}/ajustes`)
  return data
}

/**
 * `POST /api/liquidacion/inventarios/:id/liquidar` — EL PUNTO DE NO RETORNO.
 *
 * Deja los descuentos firmes y el inventario en `liquidado`. El 409 del
 * servidor se muestra TAL CUAL: sus mensajes dicen qué falta (los ajustes, que
 * nadie registró conteos, que ya se liquidó) y reemplazarlos por un genérico
 * borraría justo lo accionable.
 */
async function liquidar(inventarioId: number): Promise<CierreLiquidacion> {
  const { data } = await api.post<CierreLiquidacion>(`/liquidacion/inventarios/${inventarioId}/liquidar`)
  return data
}

/** `GET /api/liquidacion/inventarios/:id/reporte-gerencia` — solo con la planilla cerrada. */
async function reporteGerencia(inventarioId: number): Promise<ReporteGerencia> {
  const { data } = await api.get<ReporteGerencia>(`/liquidacion/inventarios/${inventarioId}/reporte-gerencia`)
  return data
}

/**
 * `GET .../reporte-gerencia/exportar` — el MISMO reporte en .xlsx.
 *
 * Lo arma el SERVIDOR. Exportar la grilla de la pantalla daría otro archivo
 * (una foto de lo que se ve), y el que sirve para presentar a gerencia es el
 * del servidor, con su formato y su nombre.
 */
async function exportarReporteGerencia(inventarioId: number): Promise<ArchivoDelServidor> {
  const respuesta = await api.get(`/liquidacion/inventarios/${inventarioId}/reporte-gerencia/exportar`, {
    responseType: 'blob',
  })
  return {
    bytes: respuesta.data as Blob,
    nombreArchivo: nombreDeLaCabecera(
      respuesta.headers['content-disposition'],
      `reporte-gerencia-inv${inventarioId}.xlsx`,
    ),
  }
}

// ---------------------------------------------------------------------------
// El Excel de ajustes de negativos
// ---------------------------------------------------------------------------

/** `GET .../ajustes-negativos/lineas` — las líneas de la importación VIGENTE. */
async function listarLineas(inventarioId: number): Promise<ListadoLineasAjustesNegativos> {
  const { data } = await api.get<ListadoLineasAjustesNegativos>(
    `/liquidacion/inventarios/${inventarioId}/ajustes-negativos/lineas`,
  )
  return data
}

/**
 * `POST .../ajustes-negativos/preview` — NUNCA PERSISTE.
 *
 * Es el paso que hace que el auditor vea qué va a pasar antes de que pase: de
 * este archivo sale el monto que baja el faltante que se le descuenta al
 * personal, y leer la pantalla después de aplicarlo no deshace nada.
 */
async function previsualizar(inventarioId: number, bytes: ArrayBuffer): Promise<ResultadoPreviewAjustesNegativos> {
  const { data } = await api.post<ResultadoPreviewAjustesNegativos>(
    `/liquidacion/inventarios/${inventarioId}/ajustes-negativos/preview`,
    bytes,
    cuerpoBinario(),
  )
  return data
}

/**
 * `POST .../ajustes-negativos/confirmar?nombreArchivo=` — persiste.
 *
 * Manda el MISMO archivo, no el resultado de la previsualización: el servidor
 * relee y revalida porque el estado pudo cambiar en el medio. Mandar lo
 * previsualizado sería aplicar una foto vencida.
 */
async function confirmar(
  inventarioId: number,
  bytes: ArrayBuffer,
  nombreArchivo: string,
): Promise<ImportacionConfirmada & { importacionId: number; cantidadRechazadas: number }> {
  const { data } = await api.post(
    `/liquidacion/inventarios/${inventarioId}/ajustes-negativos/confirmar?nombreArchivo=${encodeURIComponent(nombreArchivo)}`,
    bytes,
    cuerpoBinario(),
  )
  return data
}

/**
 * `PATCH .../lineas/:lineaId/excluir` y `/incluir` — el motivo es OBLIGATORIO
 * y queda firmado con el nombre de quien lo escribió.
 */
async function excluirLinea(inventarioId: number, lineaId: number, motivo: string): Promise<void> {
  await api.patch(`/liquidacion/inventarios/${inventarioId}/ajustes-negativos/lineas/${lineaId}/excluir`, { motivo })
}

async function incluirLinea(inventarioId: number, lineaId: number, motivo: string): Promise<void> {
  await api.patch(`/liquidacion/inventarios/${inventarioId}/ajustes-negativos/lineas/${lineaId}/incluir`, { motivo })
}

export const liquidacionApi = {
  deSucursal,
  conciliacion,
  ajustes,
  liquidar,
  reporteGerencia,
  exportarReporteGerencia,
  listarLineas,
  previsualizar,
  confirmar,
  excluirLinea,
  incluirLinea,
}

/**
 * ABRE EL DIÁLOGO DEL NAVEGADOR Y DEVUELVE EL ARCHIVO.
 *
 * `null` = la persona canceló, que no es un error y no se avisa. Vive acá y no
 * en `common/` porque esa carpeta es zona compartida; es un `<input type=file>`
 * de doce líneas, no vale partir un archivo común por él.
 */
export interface ArchivoElegido {
  nombre: string
  bytes: ArrayBuffer
}

export function elegirArchivoXlsx(): Promise<ArchivoElegido | null> {
  return new Promise((resolver, rechazar) => {
    const entrada = document.createElement('input')
    entrada.type = 'file'
    entrada.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    entrada.onchange = () => {
      const archivo = entrada.files?.[0]
      if (!archivo) {
        resolver(null)
        return
      }
      archivo
        .arrayBuffer()
        .then((bytes) => resolver({ nombre: archivo.name, bytes }))
        .catch(rechazar)
    }
    // `cancel` existe en los navegadores actuales; si no llegara, la promesa
    // queda pendiente y no pasa nada: nadie espera de ella más que el archivo.
    entrada.oncancel = () => resolver(null)
    entrada.click()
  })
}
