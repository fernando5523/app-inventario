/**
 * Los tipos de "Corregir lo contado", verificados contra el backend vivo con
 * curl (no copiados del mensaje que pidió esta pantalla).
 *
 * Viven acá y no en `src/tipos.ts` porque esa es zona compartida con los otros
 * agentes del portal. El día que otra pantalla necesite la matriz o las hojas,
 * se suben ahí de una vez.
 */

/** Un empaque del producto: su nombre tal cual lo da el ERP y cuántas unidades trae. */
export interface EmpaqueProducto {
  nombre: string
  factor: number
}

export interface ProductoDeHoja {
  id: number
  codigo: string
  codigoBarras: string
  descripcion: string
  empaques: EmpaqueProducto[]
  /**
   * LA CATEGORÍA REAL DEL PRODUCTO, la que trae Dynamics ("LICOR-VINO TINTO
   * DULCE"). ES ESTA Y NO LA `zona` DE LA HOJA, que es otra cosa.
   *
   * Opcional porque el ERP no clasifica todos los productos; medido en el
   * inventario 8090, los 45 la tienen.
   */
  categoria?: string
}

/** Una línea del conteo: "2 Emp.12". `empaqueNombre` identifica cuál de los empaques del producto es. */
export interface LineaEmpaque {
  empaqueNombre: string
  cantidad: number
}

export interface ConteoDeHoja {
  productoId: number
  empaques: LineaEmpaque[]
  sueltas: number
  confirmadoPorEscaner: boolean
  contadoEn: string
}

export interface HojaDeConteo {
  id: number
  inventarioId: number
  numero: string
  productos: ProductoDeHoja[]
  conteos: ConteoDeHoja[]
}

export type EstadoDelInventario =
  | 'en_curso'
  | 'ajuste_auditor'
  | 'conteo_cerrado'
  | 'liquidado'
  | 'lacrado'
  | 'anulado'

/** `GET /api/sucursales/:id/inventarios/activo`. `null` = esta tienda no tiene inventario abierto. */
export interface InventarioActivo {
  inventarioId: number
  estado: EstadoDelInventario
  /** La ronda MÁS ALTA con hojas creadas. `null` = todavía no hay hojas. */
  rondaActiva: number | null
  /** La marca propia del cierre: sin ella no se distingue "contando" de "todas las rondas cerradas". */
  ultimaRondaCerrada: number | null
  totalHojas: number
  items: number
}

/**
 * CONTRA QUÉ STOCK SE MIDIÓ ESTE ÍTEM. Lo calcula el servidor y llega resuelto:
 * con stock por ronda, el de la ronda 1 es la vara de la primera pasada, y
 * comparar un conteo de la ronda 3 contra el stock del día 22 es otra
 * afirmación — y de ahí sale un descuento a nómina.
 */
export interface StockDeLaMedicion {
  stockErp: number | null
  rondaDelConteo: number | null
  rondaDelStock: number | null
  /** El conteo de esta ronda no trajo stock propio: se comparó contra el de la ronda 1. */
  cayoALaRonda1: boolean
}

export type VeredictoAuditoria = 'cuadrado' | 'falta' | 'empresa' | 'sin_erp' | 'sin_contar'

/**
 * Una fila de `GET /api/auditoria/inventarios/:id/matriz`.
 *
 * ---------------------------------------------------------------------------
 * `zona` NO ESTÁ ACÁ A PROPÓSITO, Y ESO ES EL ARREGLO DE UN BUG
 * ---------------------------------------------------------------------------
 * El DTO la trae, y la pantalla la pintaba como "Categoría". No lo es: `zona`
 * es la categoría DOMINANTE del bloque con el que se armó la hoja, un dato
 * sintético. En el inventario 8090 vale "DETERGENTES EN POLVO" para los 45
 * ítems, así que un vino aparecía como detergente delante del auditor.
 *
 * La categoría real es `ProductoDeHoja.categoria`, que llega por el endpoint
 * de hojas. Se deja fuera del tipo en vez de solo dejar de usarla: mientras
 * esté a mano, alguien la va a volver a tomar -- se lee igual de bien que la
 * buena y es falsa de la misma forma.
 *
 * TRAE LAS CUENTAS HECHAS —`diferenciaUnidades`, `veredicto`,
 * `stockDeLaMedicion`— y acá no se recalcula ninguna. La app móvil las
 * recalcula en su dominio porque trabaja sin red; el portal siempre tiene
 * servidor, así que una segunda copia de esas fórmulas solo podría discrepar.
 */
export interface ItemDeLaMatriz {
  productoId: number
  codigo: string
  descripcion: string
  hoja: string
  stockErp: number | null
  conteos: (number | null)[]
  conteoFinal: number | null
  diferenciaUnidades: number | null
  veredicto: VeredictoAuditoria
  stockDeLaMedicion: StockDeLaMedicion
}

export interface RespuestaMatriz {
  inventarioId: number
  estado: EstadoDelInventario
  matriz: ItemDeLaMatriz[]
  total: number
}

/**
 * EL ÍTEM SALIÓ DE LA RONDA SIGUIENTE porque la corrección lo hizo cuadrar.
 * Es lo que el cliente pidió ver con esas palabras: *"corrígelo para que ya no
 * salga en mi segundo conteo"*.
 */
export interface SalidaDeLaRonda {
  codigo: string
  ronda: number
  hojaBorrada: boolean
  rondaBorrada: boolean
}

/** La respuesta de `PATCH /api/hojas/:id/conteos/:productoId/corregir`. */
export interface CorreccionDeConteo {
  total: number
  totalAnterior: number
  /** Solo para quien ya podía ver la matriz de este inventario. */
  stockErp?: number | null
  diferencia?: number | null
  salioDeLaRonda?: SalidaDeLaRonda | null
}

/** Una fila de la pantalla: el producto, su conteo y lo que la matriz sabe de él. */
export interface FilaCorregible {
  /** A qué hoja pertenece: es lo que pide el endpoint de corrección. */
  hojaId: number
  numeroHoja: string
  producto: ProductoDeHoja
  /** Lo que se cargó, o `null` si nadie lo contó en esta ronda. */
  conteo: ConteoDeHoja | null
  /** Unidades contadas. `null` si no hay conteo. */
  contado: number | null
  /** El ítem en la matriz, para el stock y el veredicto. `null` si la matriz no lo trajo. */
  item: ItemDeLaMatriz | null
}

// ---------------------------------------------------------------------------
// La corrección masiva por Excel
// ---------------------------------------------------------------------------

/**
 * EL PERÍODO DE UN INVENTARIO, que la exportación necesita y la pantalla no
 * tiene.
 *
 * NO SE DERIVA DE `tomadoEn` NI DEL RELOJ, y no es una precaución teórica:
 * medido el 2026-10-13, el inventario 8090 tiene `tomadoEn` del 13 de OCTUBRE y
 * pertenece al período de SEPTIEMBRE; el 8088, del 12 de octubre, también. Un
 * archivo exportado con el mes del snapshot saldría del mes equivocado, y el
 * mes de hoy (octubre) no tiene ningún inventario. Sale del detalle del
 * inventario, que es quien lo sabe.
 */
export interface PeriodoDelInventario {
  periodoAnio: number
  periodoMes: number
}

/**
 * Lo que no impide corregir pero hay que ver. Hoy el servidor tiene una sola
 * (`correcciones.formato.ts#MotivoAdvertenciaFila`), y es la que más importa:
 * escribió el motivo y el valor NO cambió.
 */
export type MotivoAdvertenciaFila = 'motivo-sin-cambio'

/** Una fila que SÍ se va a corregir. `fila` es el número de fila del Excel. */
export interface FilaACorregir {
  fila: number
  inventarioId: number
  sucursal: string
  ronda: number
  hoja: string
  codigo: string
  hojaId: number
  productoId: number
  contadoActual: number
  nuevoValor: number
  motivo: string
}

/**
 * Una fila que se leyó bien y no cambia nada. Sus `advertencias` son lo que hay
 * que mirar: `motivo-sin-cambio` casi siempre significa que el auditor escribió
 * el motivo y se olvidó de cambiar el número.
 */
export interface FilaSinCambio {
  fila: number
  inventarioId: number
  ronda: number
  codigo: string
  /** `null` cuando la fila no trae ni un `Contado` legible. */
  contado: number | null
  advertencias: readonly MotivoAdvertenciaFila[]
}

/**
 * Una fila que no se puede aplicar. `detalle` ya viene en términos del
 * negocio y es lo que se muestra; `motivo` es el enum, solo de respaldo.
 *
 * `inventarioId` y `ronda` son NULEABLES: una fila a la que no se le pudo leer
 * la clave se rechaza igual, y ahí no hay inventario ni ronda que nombrar.
 */
export interface FilaRechazada {
  fila: number
  motivo: string
  detalle: string
  codigo: string
  inventarioId: number | null
  ronda: number | null
}

export interface ResumenDeLaImportacion {
  aCorregir: number
  sinCambio: number
  rechazadas: number
  conAdvertencia: number
}

/** La respuesta de `POST /api/correcciones/preview`. */
export interface VistaPreviaImportacion {
  /** Siempre `true` acá: el archivo ilegible llega como error 400, no como esto. */
  ok: true
  resumen: ResumenDeLaImportacion
  aCorregir: readonly FilaACorregir[]
  sinCambio: readonly FilaSinCambio[]
  rechazadas: readonly FilaRechazada[]
}

/**
 * Una fila que SE ESCRIBIÓ. No es la misma forma que `FilaACorregir`, y la
 * diferencia es el punto: acá los valores son los que el servidor guardó de
 * verdad (`valorAnterior`/`valorNuevo`), no los que el archivo pedía.
 */
export interface FilaAplicada {
  fila: number
  inventarioId: number
  sucursal: string
  ronda: number
  hoja: string
  codigo: string
  valorAnterior: number
  valorNuevo: number
  /** La corrección lo hizo cuadrar y salió de la ronda siguiente. */
  salioDeLaRondaSiguiente: boolean
}

/**
 * La respuesta de `POST /api/correcciones/confirmar`.
 *
 * EL LOTE NO ES ATÓMICO: `aplicadas` y `fallidas` son dos cifras distintas que
 * conviven, y `fallidas` son las filas que se cayeron AL ESCRIBIR (las otras
 * rechazadas ya venían rechazadas de la vista previa). No trae `aCorregir`:
 * después de aplicar, lo que importa es lo que entró.
 */
export interface ResultadoConfirmacion {
  nombreArchivo: string
  aplicadoEn: string
  resumen: ResumenDeLaImportacion & { aplicadas: number; fallidas: number }
  aplicadas: readonly FilaAplicada[]
  sinCambio: readonly FilaSinCambio[]
  rechazadas: readonly FilaRechazada[]
}

/** El archivo que eligió el auditor, ya leído. */
export interface ArchivoElegido {
  nombre: string
  bytes: ArrayBuffer
}
