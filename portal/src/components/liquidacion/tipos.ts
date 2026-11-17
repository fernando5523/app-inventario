/**
 * Los contratos de liquidación, tal como los devuelve
 * `backend/src/modules/liquidacion/`. Espejan `mobile/lib/puertos/repositorios.ts`,
 * que es el mismo contrato visto desde el teléfono.
 *
 * `GET /liquidacion/inventarios/:id/ajustes` y `.../ajustes-negativos/lineas`
 * verificados con curl contra el backend vivo el 2026-10-17 (inventario 8078).
 * El resto sale del código del backend: con la base de hoy no hay ningún
 * inventario con el conteo cerrado, así que `GET /liquidacion/sucursales/:id`
 * contesta `null` en las once tiendas y no hay respuesta real que leer.
 *
 * ---------------------------------------------------------------------------
 * LOS `null` DE ESTE MÓDULO SON DATOS, NO HUECOS
 * ---------------------------------------------------------------------------
 * `faltanteNeto`, `cuotaBase`, `bonoAsistencia`, `diasDelInventario`,
 * `totalFaltas`, `diasFaltadosEnTotal` y `fondoMultas` vienen en `null` —nunca
 * en 0— mientras falte la asistencia o los ajustes del mes. Un 0 ahí diría "no
 * se descuenta nada", que es una afirmación sobre el sueldo de alguien; el
 * `null` dice "todavía no se puede calcular", y `advertencia` dice por qué.
 */

/** Los cuatro roles del padrón. El mismo tipo que `tipos.ts` de la raíz. */
import type { Rol } from '../../tipos'

/** Una persona de la planilla. */
export interface DetalleLiquidacion {
  colaboradorId: number
  nombre: string
  rol: Rol
  /**
   * ASISTENCIA COMPLETA: vino TODOS los días del inventario, o sea multa 0 y
   * por eso cobra el bono.
   *
   * Un `false` NO quiere decir ausente total: quiere decir que faltó AL MENOS
   * UN DÍA. Quien vino dos de tres días tiene `asistio: false` y aun así
   * estuvo dos jornadas. Por eso los filtros dicen "sin faltas"/"con faltas" y
   * no "asistieron"/"faltaron".
   */
  asistio: boolean
  /** De cuántos días tiene marca. El denominador es `Liquidacion.diasDelInventario`. */
  diasAsistidos: number | null
  /** Lo que se le descuenta, ya calculado por el servidor. Nunca se recalcula acá. */
  monto: number
}

/** Lo que hay que ADVERTIR sobre el monto, antes de firmarlo. */
export interface AdvertenciaLiquidacion {
  /** Ítems con diferencia real que no se pudieron valorizar: el monto queda incompleto. */
  itemsSinPrecio: number
  asistenciaSinRegistrar: boolean
  ajustesSinRegistrar: boolean
  /** Texto listo para mostrar tal cual. `null` cuando no hay nada que advertir. */
  mensaje: string | null
}

/** `GET /api/liquidacion/sucursales/:sucursalId`. `null` = la tienda no cerró ningún ciclo. */
export interface Liquidacion {
  inventarioId: number
  periodo: string
  periodoAnio: number
  periodoMes: number
  faltanteBruto: number
  negativosDelMes: number | null
  faltanteEmpresa: number
  faltanteNeto: number | null
  cuotaBase: number | null
  /** LA TARIFA POR DÍA FALTADO, no el monto por persona ausente. */
  multaInasistencia: number
  /**
   * El PISO del reparto del fondo, no el promedio: cuando no divide exacto, a
   * algunos les toca un centavo más. Por eso una fila puede mostrar un centavo
   * más que este número, y la pantalla lo aclara cuando pasa.
   */
  bonoAsistencia: number | null
  /** `0` = cierre con la REGLA VIEJA (multa fija por persona), no "duró cero días". */
  diasDelInventario: number | null
  /** PERSONAS que no completaron el inventario. */
  totalFaltas: number | null
  /** DÍAS faltados sumando a todos: el multiplicando del fondo. */
  diasFaltadosEnTotal: number | null
  fondoMultas: number | null
  planilla: DetalleLiquidacion[]
  /** `true` = la planilla todavía no se cerró: son los descuentos que VAN A pasar. */
  proyectada: boolean
  advertencia: AdvertenciaLiquidacion
}

export interface FondoDeMultas {
  recaudado: number
  repartido: number
  diferencia: number
  cierra: boolean
}

/** `GET /api/liquidacion/sucursales/:sucursalId/conciliacion`. */
export type Conciliacion =
  | { calculable: false; periodo: string; advertencia: AdvertenciaLiquidacion }
  | {
      calculable: true
      periodo: string
      faltanteNeto: number
      /** Suma real de los montos de la planilla. No siempre igual a `faltanteNeto`. */
      sumaPlanilla: number
      /** Los centavos que deja el redondeo de la cuota. Hoy quedan a favor del personal. */
      diferenciaPorRedondeo: number
      colaboradores: number
      asistieron: number
      faltaron: number
      fondoDeMultas: FondoDeMultas
      advertencia: AdvertenciaLiquidacion
    }

/**
 * `GET /api/liquidacion/inventarios/:id/ajustes`. SOLO LECTURA desde el
 * 2026-09-14: el monto entra por el Excel de Dynamics, no se escribe a mano.
 *
 * `montoNegativos: null` = nadie importó el Excel, y ESO bloquea liquidar. Un
 * `0` importado la destraba: "se importó y no había" es un dato.
 */
export interface AjustesDelMes {
  inventarioId: number
  registrado: boolean
  montoNegativos: number | null
  montoFaltanteEmpresa: number | null
  /** Solo existe en inventarios viejos, cuando los montos se tipeaban. */
  nota: string | null
  registradoPor: { id: number; nombre: string } | null
  registradoEn: string | null
}

/** `POST /api/liquidacion/inventarios/:id/liquidar` — 201. */
export interface CierreLiquidacion {
  inventarioId: number
  estado: 'liquidado'
  colaboradores: number
  cuotaBase: number
  bonoAsistencia: number
  faltantes: number
  totalDescontado: number
}

/** Una fila del reporte a gerencia: un producto de la EMPRESA con diferencia. */
export interface FilaReporteGerencia {
  codigo: string
  descripcion: string
  /** Siempre positivo: el signo lo dice la lista en la que aparece. */
  unidades: number
  /** `null` = sin precio de venta en Dynamics: la unidad es un hecho, el monto no. */
  monto: number | null
}

/** `GET /api/liquidacion/inventarios/:id/reporte-gerencia`. Solo con la planilla cerrada. */
export interface ReporteGerencia {
  inventarioId: number
  estado: string
  faltantes: FilaReporteGerencia[]
  sobrantes: FilaReporteGerencia[]
  totalFaltante: number
  totalSobrante: number
}

/** Una tienda del padrón, para el selector. */
export interface SucursalDelPadron {
  id: number
  nombre: string
}
