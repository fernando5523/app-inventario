import api from '../../services/api'
import type {
  CorreccionDeConteo,
  HojaDeConteo,
  InventarioActivo,
  ItemDeLaMatriz,
  LineaEmpaque,
  PeriodoDelInventario,
  RespuestaMatriz,
  ResultadoConfirmacion,
  VistaPreviaImportacion,
} from './tipos'

/** Un archivo que armó el servidor, con el nombre que el servidor le puso. */
export interface ArchivoDelServidor {
  bytes: Uint8Array
  nombreArchivo: string
}

/**
 * El nombre sale del `Content-Disposition`, no se arma acá: lo pone el
 * servidor y es el que identifica de qué tienda y de qué mes es el archivo.
 * Sin él, cinco exportaciones del mismo día se llaman todas igual.
 */
function nombreDeLaCabecera(disposition: unknown, respaldo: string): string {
  if (typeof disposition !== 'string') return respaldo
  const coincidencia = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
  return coincidencia ? decodeURIComponent(coincidencia[1]) : respaldo
}

/**
 * Las llamadas de "Corregir lo contado".
 *
 * VIVEN ACÁ Y NO EN `services/api.ts` porque ese archivo es zona compartida:
 * hay otros agentes escribiendo en el portal. Reusan la MISMA instancia de
 * axios (su token, su timeout y su 401 → login), que es lo único que no se
 * puede duplicar sin partir la sesión en dos.
 *
 * Los cuatro endpoints están verificados con curl contra el backend vivo, no
 * deducidos: el cuerpo es el objeto pelado (este backend no envuelve en
 * `{ success, data }`).
 */

/**
 * `GET /api/sucursales/:id/inventarios/activo`.
 *
 * Devuelve `null` cuando la tienda no tiene inventario abierto, y eso NO es un
 * error: es la respuesta correcta para una tienda que todavía no empezó el mes.
 * El servidor contesta 200 con `null`, así que se propaga tal cual.
 */
async function inventarioActivo(sucursalId: number): Promise<InventarioActivo | null> {
  const { data } = await api.get<InventarioActivo | null>(`/sucursales/${sucursalId}/inventarios/activo`)
  return data ?? null
}

/**
 * `GET /api/hojas?inventarioId=&alcance=todas&ronda=`.
 *
 * `alcance=todas` es el lote entero de la ronda, no solo las hojas propias: el
 * Auditor no cuenta, audita. El servidor lo valida (un rol `conteo` nunca ve
 * el lote entero, por el conteo ciego), así que pedirlo acá no amplía nada.
 *
 * Son las hojas las que traen el `hojaId` de cada producto, que es lo que pide
 * el endpoint de corrección. La matriz sola no alcanza: no trae hoja_id.
 */
async function hojasDeLaRonda(inventarioId: number, ronda: number): Promise<HojaDeConteo[]> {
  const { data } = await api.get<HojaDeConteo[]>('/hojas', {
    params: { inventarioId, alcance: 'todas', ronda },
  })
  return data
}

/**
 * Cuántas filas pide cada página de la matriz. El servidor topea en 500
 * (`matrizQuerySchema`), así que 500 es el máximo que se puede pedir de una.
 */
const POR_PAGINA = 500

/**
 * `GET /api/auditoria/inventarios/:id/matriz` — TODAS las páginas.
 *
 * La matriz es paginada y el tope del servidor son 500 filas por pedido;
 * Luzuriaga tiene 985 ítems, así que con una sola página faltarían 485 — y
 * esas filas se verían como "sin stock del sistema", que es una afirmación
 * falsa sobre un ítem que sí lo tiene. Se piden todas y se corta por `total`.
 *
 * El corte por `recibidas === 0` es la red contra un bucle infinito si el
 * servidor devolviera un `total` mayor que lo que entrega.
 */
async function matrizCompleta(inventarioId: number): Promise<ItemDeLaMatriz[]> {
  const filas: ItemDeLaMatriz[] = []
  let desplazamiento = 0
  for (;;) {
    const { data } = await api.get<RespuestaMatriz>(`/auditoria/inventarios/${inventarioId}/matriz`, {
      params: { limite: POR_PAGINA, desplazamiento },
    })
    filas.push(...data.matriz)
    const recibidas = data.matriz.length
    if (recibidas === 0 || filas.length >= data.total) break
    desplazamiento += recibidas
  }
  return filas
}

/**
 * `PATCH /api/hojas/:id/conteos/:productoId/corregir`.
 *
 * PATCH y no PUT: el cuerpo lleva el valor NUEVO completo más el motivo, y el
 * motivo no es parte del conteo — es la explicación del cambio. El schema del
 * servidor es `.strict()`: un campo de más da 400 en vez de ignorarse.
 *
 * EL STOCK NO VIAJA EN EL CUERPO, y no es un olvido: no hay forma de mandarlo.
 * `ajuste.permisos.ts` lo dice entero — el stock del ERP no lo corrige nadie
 * desde la app, y no existe ningún endpoint que lo edite.
 */
async function corregirConteo(
  hojaId: number,
  productoId: number,
  cuerpo: { empaques: LineaEmpaque[]; sueltas: number; motivo: string },
): Promise<CorreccionDeConteo> {
  const { data } = await api.patch<CorreccionDeConteo>(
    `/hojas/${hojaId}/conteos/${productoId}/corregir`,
    cuerpo,
  )
  return data
}

/**
 * `GET /api/historial/inventarios/:id` — SOLO para sacarle el período.
 *
 * La exportación exige `anio` y `mes`, y esta pantalla no los tiene: trabaja
 * con el inventario ACTIVO de una tienda, y su DTO no los trae. Derivarlos de
 * `tomadoEn` o del reloj sería un error medible, no teórico (ver
 * `PeriodoDelInventario` en tipos.ts). Es un pedido más, y solo al exportar.
 */
async function periodoDelInventario(inventarioId: number): Promise<PeriodoDelInventario> {
  const { data } = await api.get<PeriodoDelInventario>(`/historial/inventarios/${inventarioId}`)
  return { periodoAnio: data.periodoAnio, periodoMes: data.periodoMes }
}

/**
 * `GET /api/correcciones/exportar` — la plantilla que el auditor edita.
 *
 * Devuelve el .xlsx ya armado por el servidor: acá NO se construye ninguno.
 * `utils/xlsx.ts` sabe escribir libros, pero el formato de esta plantilla
 * (dos hojas, los nombres exactos de columna, la columna Corregible con su
 * motivo) lo define el backend, y una segunda implementación del mismo formato
 * se desalinea el día que cambie una columna.
 */
async function exportarPlantilla(filtro: {
  anio: number
  mes: number
  sucursalId?: number
  soloSinCuadrar: boolean
}): Promise<ArchivoDelServidor> {
  try {
    const respuesta = await api.get<ArrayBuffer>('/correcciones/exportar', {
      params: {
        anio: filtro.anio,
        mes: filtro.mes,
        ...(filtro.sucursalId === undefined ? {} : { sucursalId: filtro.sucursalId }),
        soloSinCuadrar: filtro.soloSinCuadrar ? 'true' : 'false',
      },
      responseType: 'arraybuffer',
    })
    return {
      bytes: new Uint8Array(respuesta.data),
      nombreArchivo: nombreDeLaCabecera(
        respuesta.headers['content-disposition'],
        `correcciones-${filtro.anio}-${String(filtro.mes).padStart(2, '0')}.xlsx`,
      ),
    }
  } catch (error) {
    throw conCuerpoLegible(error)
  }
}

/**
 * EL MENSAJE DEL SERVIDOR, QUE CON `responseType` BINARIO SE PERDÍA.
 *
 * Pidiendo un `ArrayBuffer`, el cuerpo de un error tambien llega binario, y
 * `describeApiError` busca `data.error` sobre un objeto que ya no es JSON: el
 * auditor leía "El servidor rechazó los datos enviados" en vez del motivo real.
 * Se decodifica y se reemplaza por el `{ error }` que el backend sí mandó.
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

/**
 * EL CUERPO ES EL .xlsx CRUDO, no JSON.
 *
 * El `Content-Type: application/octet-stream` va explícito porque la instancia
 * compartida de axios manda `application/json` por defecto, y con ese
 * encabezado el servidor intentaría parsear el binario como texto. El
 * `transformRequest` vacío evita que axios toque el `ArrayBuffer`.
 */
function cuerpoBinario() {
  return {
    headers: { 'Content-Type': 'application/octet-stream' },
    transformRequest: [(datos: unknown) => datos],
  }
}

/**
 * `POST /api/correcciones/preview` — NUNCA ESCRIBE.
 *
 * Es el paso que hace que el auditor vea qué va a pasar antes de que pase. Un
 * import que aplica directo sobre 985 conteos no se puede deshacer leyendo la
 * pantalla después.
 */
async function previsualizarCorrecciones(bytes: ArrayBuffer): Promise<VistaPreviaImportacion> {
  const { data } = await api.post<VistaPreviaImportacion>('/correcciones/preview', bytes, cuerpoBinario())
  return data
}

/**
 * `POST /api/correcciones/confirmar` — aplica.
 *
 * Manda el MISMO archivo, no el resultado de la previsualización: el servidor
 * relee y reclasifica porque el estado pudo cambiar en el medio (otra tienda
 * entró en ajuste final, el coordinador corrigió una fila). Mandar lo
 * previsualizado sería aplicar una foto vencida.
 */
async function confirmarCorrecciones(bytes: ArrayBuffer, nombreArchivo: string): Promise<ResultadoConfirmacion> {
  const { data } = await api.post<ResultadoConfirmacion>(
    `/correcciones/confirmar?nombreArchivo=${encodeURIComponent(nombreArchivo)}`,
    bytes,
    cuerpoBinario(),
  )
  return data
}

export const corregirApi = {
  inventarioActivo,
  hojasDeLaRonda,
  matrizCompleta,
  corregirConteo,
  periodoDelInventario,
  exportarPlantilla,
  previsualizarCorrecciones,
  confirmarCorrecciones,
}
