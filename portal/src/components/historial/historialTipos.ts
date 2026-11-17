import type { EstadoInventario, Rol } from '../../tipos'

/**
 * Los contratos de `backend/src/modules/historial/`, verificados contra el
 * backend vivo el 2026-10-17 (no deducidos de la pantalla del teléfono).
 *
 * Viven acá y no en `src/tipos.ts` porque esa es zona compartida con los otros
 * agentes del portal. Mismo criterio que `ciclo/cicloTipos.ts` y
 * `lacrado/lacradoTipos.ts`; cuando estas pantallas se integren, se mudan de
 * una vez.
 *
 * SON LOS DTO CRUDOS, sin la traducción que hace el adaptador del móvil. En
 * particular `lacrado` llega como objeto o `null` tanto en el listado como en
 * el detalle, y acá se lee así en vez de aplanarlo a `folio`/`lacradoEn`.
 */

/** Las cifras del cierre. `null` mientras el ciclo no cerró. */
export interface ResultadoInventario {
  itemsTotales: number
  itemsConDiferencia: number
  itemsCuadrados: number
  porcentajeCuadrado: number
  montoFaltanteBruto: number
  /**
   * `null` NO ES 0: "todavía no se liquidó" y "no falta nada" son cosas
   * distintas, y confundirlas en un inventario decide plata. Por qué es null
   * lo explica `motivoSinNeto` con los dos campos de abajo.
   */
  montoFaltanteNeto: number | null
  cuotaBase: number | null
  itemsSegundoConteo?: number
  itemsTercerConteo?: number
  unidadesFaltantes?: number
  unidadesSobrantes?: number
  asistenciaSinRegistrar?: boolean
  ajustesSinRegistrar?: boolean
}

/** El sello, tal como lo manda el servidor. `null` mientras no se lacró. */
export interface SelloLacrado {
  folio: string
  hash: string
  lacradoEn: string
  lacradoPor: { id: number; nombre: string }
  /** Constancia del registro MANUAL en Dynamics. El ajuste automático es fase 2. */
  registroErp: { referencia: string; registradoEn: string; registradoPor: { id: number; nombre: string } } | null
}

/** Una fila de `GET /api/historial/inventarios`. */
export interface InventarioHistorico {
  id: number
  sucursalId: number
  sucursalNombre: string
  estado: EstadoInventario
  /** "2026-09": clave legible y ordenable como texto. */
  periodo: string
  periodoAnio: number
  periodoMes: number
  tamanoHoja: number | null
  snapshotItems: number
  abiertoEn: string
  cerradoEn: string | null
  resultado: ResultadoInventario | null
  /** Cuántas firmas tiene. En el detalle, en cambio, llega la lista entera. */
  aprobaciones: number
  /** VIAJA DESDE EL SERVIDOR y no se asume 2: hoy la configuración es 1. */
  aprobacionesRequeridas: number
  lacrado: { folio: string; lacradoEn: string; lacradoPor: { id: number; nombre: string } } | null
}

export interface PaginaHistorial {
  total: number
  limite: number
  desplazamiento: number
  inventarios: InventarioHistorico[]
}

/** Una hoja del inventario, como la guarda el histórico. */
export interface HojaHistorica {
  id: number
  numeroConteo: number
  numero: string
  zona: string | null
  gondola: string | null
  tamano: number
  estado: string
  sync: string
  asignados: { id: number; nombre: string }[]
  productos: number
  contados: number
}

/** Una firma de cierre, con el rol CONGELADO al momento de firmar. */
export interface AprobacionCierre {
  aprobadorId: number
  aprobadorNombre: string
  rolAlAprobar: Rol
  aprobadoEn: string
  nota: string | null
}

/** `GET /api/historial/inventarios/:id`. */
export interface DetalleInventarioHistorico {
  id: number
  sucursal: { id: number; nombre: string }
  estado: EstadoInventario
  periodo: string
  periodoAnio: number
  periodoMes: number
  tamanoHoja: number | null
  snapshotItems: number
  snapshotTomadoEn: string | null
  abierto: boolean
  abiertoEn: string
  cerradoEn: string | null
  cerradoPor: { id: number; nombre: string } | null
  resultado: ResultadoInventario | null
  hojas: HojaHistorica[]
  /** Cuántas diferencias tiene calculadas. El detalle de cada una va aparte. */
  diferencias: number
  liquidaciones: number
  aprobaciones: AprobacionCierre[]
  aprobacionesRequeridas: number
  lacrado: SelloLacrado | null
}

/** Una fila de `GET /api/historial/inventarios/:id/diferencias`. */
export interface DiferenciaHistorica {
  codigo: string
  descripcion: string
  stockSistema: number
  conteoFinal: number
  diferencia: number
  tipo: 'faltante' | 'sobrante'
  resueltoEnConteo: number
  precioUnitario: number | null
  /** `null` = el snapshot no trajo precio: la diferencia no se puede valorizar. */
  montoDiferencia: number | null
}

/** `GET /api/historial/inventarios/:id/diferencias` — paginado, tope de 500. */
export interface PaginaDiferencias {
  total: number
  limite: number
  desplazamiento: number
  diferencias: DiferenciaHistorica[]
}

export interface ResumenLiquidacion {
  montoFaltanteNeto: number
  cuotaBase: number
  faltantes: number
  fondoMultas: number
  bonoAsistencia: number
  residuoCentavos: number
}

/**
 * Una línea de la planilla. `nombre` es el que tenía al liquidar y
 * `nombreActual` el de hoy: si cambió, los dos importan — la planilla dice lo
 * que se firmó, y el nombre de hoy es con el que se lo busca.
 */
export interface LiquidacionColaborador {
  colaboradorId: number
  nombre: string
  nombreActual: string
  dni: string
  rol: Rol
  asistio: boolean
  cuotaBase: number
  multaInasistencia: number
  bonoAsistencia: number
  totalDescuento: number
}

/** `GET /api/historial/inventarios/:id/liquidacion`. */
export interface LiquidacionInventario {
  inventarioId: number
  sucursal: { id: number; nombre: string }
  periodo: string
  /** Cuántos días duró el inventario. `null` mientras no se liquidó. */
  diasDelInventario: number | null
  /** `null` NO es un resumen con ceros: falta un dato de captura, no falta plata. */
  resumen: ResumenLiquidacion | null
  asistenciaSinRegistrar: boolean
  ajustesSinRegistrar: boolean
  planilla: LiquidacionColaborador[]
}

export interface PeorPeriodoItem {
  anio: number
  mes: number
  diferencia: number
}

export interface ResumenHistoricoItem {
  veces: number
  vecesFaltante: number
  vecesSobrante: number
  unidadesFaltantes: number
  unidadesSobrantes: number
  montoAcumulado: number
  peorPeriodo: PeorPeriodoItem | null
}

export interface AparicionItemHistorico {
  inventarioId: number
  sucursalId: number
  sucursalNombre: string
  periodo: string
  periodoAnio: number
  periodoMes: number
  estadoInventario: EstadoInventario
  stockSistema: number
  conteoFinal: number
  diferencia: number
  resueltoEnConteo: number
  montoDiferencia: number | null
}

/**
 * `GET /api/historial/items/:codigo` — "este producto, cuántas veces dio
 * diferencia", la pregunta textual del cliente. Un ítem que aparece todos los
 * meses con faltante no es un error de conteo: es una merma sistemática, y eso
 * solo se ve mirando el histórico completo y no un mes suelto.
 */
export interface HistoricoItem {
  codigo: string
  /** La descripción más reciente entre las apariciones. `null` si nunca apareció. */
  descripcion: string | null
  resumen: ResumenHistoricoItem
  apariciones: AparicionItemHistorico[]
}

export interface FiltroHistorial {
  sucursalId?: number
  estado?: EstadoInventario
  periodoAnio?: number
  periodoMes?: number
  limite?: number
  desplazamiento?: number
}
