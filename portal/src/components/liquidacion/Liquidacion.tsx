import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertIcon, DownloadIcon, FileIcon } from '@primer/octicons-react'
import { HiRefresh } from 'react-icons/hi'
import { ActionGroup } from '../common/ActionGroup'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { EmptyState } from '../common/EmptyState'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { SearchableSelect } from '../common/SearchableSelect'
import { StatusBadge } from '../common/StatusBadge'
import { TableSettingsButton } from '../common/table-settings/TableSettingsButton'
import { useTableColumns } from '../common/table-settings/useTableColumns'
import type { TableColumnDef } from '../common/table-settings/types'
import { ColumnHeaderCell, NoFilterMatches, QuickFilterInput, buildQueryGetters, useTableQuery } from '../common/table-filters'
import { GridHeaderCell, useColumnDrag, useColumnLayout } from '../common/table-grid'
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus'
import { sesionApi } from '../../services/api'
import { notifyError } from '../../utils/notifyError'
import { formatoMiles, formatoMoneda, pluralizar } from '../../utils/formato'
import { useAuthStore } from '../../store/authStore'
import { liquidacionApi } from './api'
import { PanelAjustesNegativos } from './PanelAjustesNegativos'
import { estadoNegativos } from './ajustesNegativos'
import {
  SIN_CICLO_CERRADO,
  SIN_DATO,
  asistentesConCentavoExtra,
  bonoDeLaFila,
  estadoAjustesNegativos,
  motivoSinCalcular,
  multaDeLaFila,
  notaFaltanteEmpresa,
  puedeLiquidar,
  regimenDeLaMulta,
  resumirAsistencia,
  textoDiasAsistidos,
  textoMontoReporte,
  textoSinPrecioReporte,
  textoUnidadesReporte,
  vistaReporteGerencia,
} from './reglas'
import type {
  AjustesDelMes,
  CierreLiquidacion,
  Conciliacion,
  DetalleLiquidacion,
  Liquidacion as LiquidacionDto,
  ReporteGerencia,
  SucursalDelPadron,
} from './tipos'

/**
 * ---------------------------------------------------------------------------
 * LIQUIDACIÓN Y NÓMINA: el cierre de fin de mes
 * ---------------------------------------------------------------------------
 * Port de `mobile/app/auditor/liquidacion.web.tsx` con la grilla de este
 * portal. Define cuánta plata sale del sueldo de cada persona, así que las
 * reglas no se reinventaron: están en `reglas.ts`, portadas una por una.
 *
 * LAS CIFRAS DE PLATA VIENEN HECHAS DEL SERVIDOR. `monto` por persona,
 * `faltanteNeto`, `cuotaBase`, `bonoAsistencia` y `fondoMultas` los calcula
 * `liquidacion.cierre.ts`. Acá no se suma ni se resta nada de eso: una segunda
 * copia de esa fórmula es cómo una pantalla termina mostrando un número y el
 * cierre firmando otro.
 *
 * LO ÚNICO QUE SE CALCULA ACÁ es el desglose de cada fila —la multa, con
 * `multaPorInasistencia`, la misma función que usa el servidor— y va al lado
 * del monto justamente para que se vea si alguna vez no coinciden.
 *
 * ---------------------------------------------------------------------------
 * LOS TOTALES VAN EN RENGLONES, NO EN TARJETAS
 * ---------------------------------------------------------------------------
 * Mismo criterio que `PanelAuditoria`: el cliente sacó las tarjetas de la
 * pantalla del teléfono ("quita estos cards") porque repetían en grande lo que
 * la tabla ya dice fila por fila y empujaban la planilla media pantalla hacia
 * abajo. Lo que no se puede perder es el total, y eso son dos renglones.
 *
 * ---------------------------------------------------------------------------
 * PRIVACIDAD
 * ---------------------------------------------------------------------------
 * Esta pantalla muestra personas con su descuento. Los nombres vienen del
 * servidor y se dibujan; no se escriben en comentarios, ni en fixtures, ni en
 * el nombre de un archivo exportado.
 */

const HEADER_CELL_CLASS = 'px-2 md:px-3 py-1.5 text-[11px] md:text-xs font-semibold text-[var(--fg-muted)]'
/**
 * TODAS LAS CIFRAS EN LA TINTA NORMAL, sin verde ni rojo según el signo: regla
 * ya decidida en este portal. El signo y la columna ya dicen qué es cada
 * número.
 */
const NUM_CELL_CLASS = 'py-1.5 text-xs text-[var(--fg)] tabular-nums text-right'

const soles = (n: number): string => `S/ ${formatoMoneda(n)}`

const NOMBRE_ROL: Record<string, string> = { coordinador: 'Coordinador', conteo: 'Conteo', auditor: 'Auditor' }

/**
 * Los ids siguen siendo `asistio`/`falto` porque es el campo que filtran, pero
 * LAS ETIQUETAS dicen "sin faltas"/"con faltas": con la asistencia por día, un
 * `false` es "faltó al menos un día", no "no vino". Un chip que dijera
 * "Faltaron" sobre alguien que trabajó dos de tres jornadas afirmaría algo
 * falso de esa persona — y es justo la fila a la que se le descuenta plata.
 */
type Filtro = 'todos' | 'asistio' | 'falto'

export function Liquidacion() {
  // La tienda de la sesión del auditor: es la que abre el selector.
  const sucursalDeSesion = useAuthStore((s) => s.sucursal)

  const [sucursales, setSucursales] = useState<SucursalDelPadron[]>([])
  const [sucursalId, setSucursalId] = useState<number | null>(null)
  const [liquidacion, setLiquidacion] = useState<LiquidacionDto | null>(null)
  const [conciliacion, setConciliacion] = useState<Conciliacion | null>(null)
  const [ajustes, setAjustes] = useState<AjustesDelMes | null>(null)
  const [reporte, setReporte] = useState<ReporteGerencia | null>(null)
  const [errorReporte, setErrorReporte] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refrescando, setRefrescando] = useState(false)
  const [bajando, setBajando] = useState(false)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [panelAjustes, setPanelAjustes] = useState(false)
  const [confirmarCierre, setConfirmarCierre] = useState(false)
  const [liquidando, setLiquidando] = useState(false)
  const [cerrado, setCerrado] = useState<CierreLiquidacion | null>(null)

  /** El padrón, para el selector. La tienda de la sesión es la que abre. */
  useEffect(() => {
    sesionApi
      .sucursales()
      .then((lista) => {
        setSucursales(lista)
        setSucursalId((actual) => actual ?? sucursalDeSesion?.id ?? lista[0]?.id ?? null)
      })
      .catch((e) => notifyError('No se pudo cargar el padrón de tiendas', e))
  }, [sucursalDeSesion])

  /**
   * SIN RELLENO: si falla, la pantalla lo dice y no muestra una planilla vacía.
   * Una planilla en cero sobre un mes que sí tiene descuentos se lee como un
   * dato, no como una falla.
   */
  const cargar = useCallback(async (id: number, silencioso = false) => {
    if (!silencioso) setCargando(true)
    try {
      // Las dos preguntan por lo mismo (el último ciclo cerrado de la tienda):
      // si una da null la otra también, pero van en paralelo porque no dependen
      // entre sí.
      const [datos, conc] = await Promise.all([liquidacionApi.deSucursal(id), liquidacionApi.conciliacion(id)])
      setLiquidacion(datos)
      setConciliacion(conc)
      setError(null)

      // Los ajustes SÍ van encadenados: cuelgan del inventario, y el id sale de
      // la liquidación que se acaba de traer.
      setAjustes(datos === null ? null : await liquidacionApi.ajustes(datos.inventarioId))

      // EL REPORTE A GERENCIA, con su propio try: si falla, su sección dice por
      // qué y el resto de la liquidación se sigue viendo. Y solo con la planilla
      // cerrada — antes ni se pide: `vistaReporteGerencia` ya sabe explicarlo.
      if (datos === null || datos.proyectada) {
        setReporte(null)
        setErrorReporte(null)
      } else {
        try {
          setReporte(await liquidacionApi.reporteGerencia(datos.inventarioId))
          setErrorReporte(null)
        } catch (e) {
          setReporte(null)
          setErrorReporte(e instanceof Error ? e.message : 'No se pudo cargar el reporte a gerencia.')
        }
      }
    } catch (e) {
      if (!silencioso) {
        setLiquidacion(null)
        setConciliacion(null)
        setError('No se pudo cargar la liquidación.')
      }
      notifyError('No se pudo cargar la liquidación', e)
    } finally {
      if (!silencioso) setCargando(false)
    }
  }, [])

  useEffect(() => {
    if (sucursalId === null) return
    // Se limpia ANTES de que llegue lo nuevo: el encabezado ya dice la tienda
    // nueva, y dejar la planilla de la anterior sería un número con el
    // apellido equivocado.
    setCerrado(null)
    void cargar(sucursalId)
  }, [sucursalId, cargar])

  // Volver a la ventana relee en silencio. PAUSADO con el panel o el diálogo
  // abiertos: un refresco que redibuje la pantalla debajo de una confirmación
  // es la peor forma de que alguien apriete lo que no era.
  useRefreshOnFocus(
    () => (sucursalId === null ? undefined : cargar(sucursalId, true)),
    sucursalId !== null && !panelAjustes && !confirmarCierre,
  )

  const refrescar = async () => {
    if (sucursalId === null) return
    setRefrescando(true)
    try {
      await cargar(sucursalId)
    } finally {
      setRefrescando(false)
    }
  }

  /**
   * EL .XLSX LO ARMA EL SERVIDOR, con su formato y su nombre. Exportar la
   * grilla daría otra cosa: una foto de esta pantalla, no el reporte que se
   * presenta a gerencia.
   */
  const bajarReporte = async () => {
    if (liquidacion === null) return
    setBajando(true)
    try {
      const { bytes, nombreArchivo } = await liquidacionApi.exportarReporteGerencia(liquidacion.inventarioId)
      const url = URL.createObjectURL(bytes)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = nombreArchivo
      document.body.appendChild(enlace)
      enlace.click()
      enlace.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      notifyError('No se pudo bajar el reporte a gerencia', e)
    } finally {
      setBajando(false)
    }
  }

  /**
   * PUNTO DE NO RETORNO: al confirmar, los descuentos quedan firmes y el
   * inventario pasa a `liquidado`.
   *
   * El 409 del servidor se muestra TAL CUAL: sus mensajes dicen qué falta —los
   * ajustes, que nadie registró conteos, que ya se liquidó— y reemplazarlos
   * por un genérico borraría justo lo accionable.
   */
  const liquidar = async () => {
    if (liquidacion === null) return
    setLiquidando(true)
    try {
      setCerrado(await liquidacionApi.liquidar(liquidacion.inventarioId))
      setConfirmarCierre(false)
      // Se relee: la pantalla pasa a mostrar la planilla FIRME.
      if (sucursalId !== null) await cargar(sucursalId)
    } catch (e) {
      notifyError('No se pudo cerrar la planilla', e)
    } finally {
      setLiquidando(false)
    }
  }

  const planilla = liquidacion?.planilla ?? []
  const multaPorDia = liquidacion !== null && regimenDeLaMulta(liquidacion) === 'multa-por-dia'

  /**
   * Los seis nacen o faltan JUNTOS: todos dependen de los mismos dos datos
   * (la asistencia y los ajustes del mes). Un solo flag en vez de seis
   * chequeos sueltos evita que un caso quede a medio blindar.
   */
  const datosCompletos =
    liquidacion !== null &&
    liquidacion.totalFaltas !== null &&
    liquidacion.cuotaBase !== null &&
    liquidacion.bonoAsistencia !== null &&
    liquidacion.diasDelInventario !== null &&
    liquidacion.diasFaltadosEnTotal !== null &&
    liquidacion.fondoMultas !== null

  const asistencia =
    liquidacion === null ? null : resumirAsistencia(planilla.length, planilla.filter((p) => p.asistio).length)
  const asistieron = datosCompletos ? asistencia!.asistieron : null
  const conFaltas = datosCompletos ? asistencia!.faltaron : null

  const conCentavoExtra = datosCompletos
    ? asistentesConCentavoExtra(planilla, liquidacion.cuotaBase!, liquidacion.bonoAsistencia!)
    : 0

  const filas = useMemo(() => {
    if (filtro === 'asistio') return planilla.filter((p) => p.asistio)
    if (filtro === 'falto') return planilla.filter((p) => !p.asistio)
    return planilla
  }, [planilla, filtro])

  const columnas: TableColumnDef<DetalleLiquidacion>[] = useMemo(() => {
    if (liquidacion === null) return []
    /**
     * CUOTA BASE · MULTA · BONO · A DESCONTAR, en ese orden: es el camino del
     * número. Se parte de lo que le toca a todos, se le suma lo que le costó
     * faltar, se le resta lo que le devolvió venir, y lo último es lo que de
     * verdad se le descuenta — la única cifra que el servidor manda calculada.
     */
    return [
      {
        id: 'nombre',
        label: 'Colaborador',
        width: 24,
        locked: true,
        sortable: true,
        filter: { type: 'text', value: (p) => p.nombre },
        cellClassName: 'py-1.5 text-xs font-semibold text-[var(--fg)]',
        renderCell: (p) => p.nombre,
        exportValue: (p) => p.nombre,
      },
      {
        id: 'rol',
        label: 'Rol',
        width: 12,
        sortable: true,
        filter: {
          type: 'enum',
          options: Array.from(new Set(planilla.map((p) => NOMBRE_ROL[p.rol] ?? p.rol))).map((label) => ({
            value: label,
            label,
          })),
          value: (p) => NOMBRE_ROL[p.rol] ?? p.rol,
        },
        cellClassName: 'py-1.5 text-xs text-[var(--fg)]',
        renderCell: (p) => NOMBRE_ROL[p.rol] ?? p.rol,
        exportValue: (p) => NOMBRE_ROL[p.rol] ?? p.rol,
      },
      {
        id: 'dias',
        label: 'Días',
        width: 13,
        sortable: true,
        filter: { type: 'number', value: (p) => p.diasAsistidos },
        cellClassName: 'py-1.5 text-xs text-[var(--fg)]',
        // En un cierre de la regla vieja no hay denominador, y "0 de 0 días" no
        // dice nada de esa persona.
        renderCell: (p) => (multaPorDia ? textoDiasAsistidos(p.diasAsistidos, liquidacion.diasDelInventario) : SIN_DATO),
        exportValue: (p) => p.diasAsistidos,
        exportFormat: 'number',
      },
      {
        id: 'cuota',
        label: 'Cuota base',
        width: 13,
        align: 'right',
        cellClassName: NUM_CELL_CLASS,
        renderCell: () => (liquidacion.cuotaBase === null ? SIN_DATO : soles(liquidacion.cuotaBase)),
        exportValue: () => liquidacion.cuotaBase,
        exportFormat: 'money',
      },
      {
        id: 'multa',
        label: 'Multa',
        width: 12,
        align: 'right',
        cellClassName: NUM_CELL_CLASS,
        renderCell: (p) => multaDeLaFila(p, liquidacion, soles),
        exportValue: (p) => multaDeLaFila(p, liquidacion, soles),
      },
      {
        id: 'bono',
        label: 'Bono',
        width: 12,
        align: 'right',
        cellClassName: NUM_CELL_CLASS,
        renderCell: (p) => bonoDeLaFila(p, liquidacion, soles),
        exportValue: (p) => bonoDeLaFila(p, liquidacion, soles),
      },
      {
        id: 'monto',
        label: 'A descontar',
        width: 14,
        align: 'right',
        sortable: true,
        filter: { type: 'number', value: (p) => p.monto },
        // LA COLUMNA QUE SE BARRE DE ARRIBA ABAJO: es la plata que sale del
        // sueldo. En negrita, sin color: la regla del portal.
        cellClassName: 'py-1.5 text-xs font-semibold text-[var(--fg)] tabular-nums text-right',
        renderCell: (p) => soles(p.monto),
        exportValue: (p) => p.monto,
        exportFormat: 'money',
      },
    ]
  }, [liquidacion, planilla, multaPorDia])

  const tableColumns = useTableColumns('liquidacion-planilla', columnas)
  const { filterGetters, filterTypes, sortGetters } = buildQueryGetters(columnas)
  const tableQuery = useTableQuery<DetalleLiquidacion>({
    rows: filas,
    filterGetters,
    filterTypes,
    sortGetters,
    persisted: { value: tableColumns.query, onChange: tableColumns.setQuery },
    getQuickFilterText: (p) => `${p.nombre} ${NOMBRE_ROL[p.rol] ?? p.rol}`,
  })

  const { visibleColumns } = tableColumns
  const layout = useColumnLayout({
    visibleColumns,
    widths: tableColumns.widths,
    setWidths: tableColumns.setWidths,
    ready: !cargando && planilla.length > 0,
  })
  const columnDrag = useColumnDrag(
    tableColumns.move,
    tableColumns.columns.map((c) => c.id),
  )

  const visibles = tableQuery.rows
  const limpiarFiltros = () => {
    tableQuery.clearAllColumnFilters()
    tableQuery.setQuickFilter('')
  }

  const estadoAjustes = estadoAjustesNegativos(ajustes?.montoNegativos ?? null, soles)
  const negativos = estadoNegativos(ajustes?.montoNegativos ?? null)
  const cierre = liquidacion === null ? null : puedeLiquidar(liquidacion, ajustes?.montoNegativos ?? null)
  const vistaReporte =
    liquidacion === null
      ? null
      : vistaReporteGerencia({ proyectada: liquidacion.proyectada, reporte, error: errorReporte })

  /**
   * EL RESUMEN DE LA PLATA, en renglones pegados al título.
   *
   * `faltanteBruto − negativos − empresa = neto`, y la cuota que sale de él.
   * Son las cifras que el servidor calculó; acá solo se escriben en el orden
   * en que se restan, que es lo que permite seguir la cuenta sin una
   * calculadora al lado.
   */
  const resumen = useMemo(() => {
    if (liquidacion === null) return null
    const partes = [
      `${soles(liquidacion.faltanteBruto)} de faltante bruto`,
      `(–) ${liquidacion.negativosDelMes === null ? 'ajustes del mes sin importar' : `${soles(liquidacion.negativosDelMes)} de negativos`}`,
      `(–) ${soles(liquidacion.faltanteEmpresa)} de empresa`,
      `= ${liquidacion.faltanteNeto === null ? 'neto sin calcular' : `${soles(liquidacion.faltanteNeto)} de faltante neto`}`,
    ]
    const cuota =
      liquidacion.cuotaBase === null
        ? motivoSinCalcular(liquidacion.advertencia)
        : `${soles(liquidacion.cuotaBase)} por persona entre ${planilla.length} ${pluralizar(planilla.length, 'colaborador', 'colaboradores')}`
    return { plata: partes.join(' · '), cuota }
  }, [liquidacion, planilla.length])

  /**
   * EL FONDO DE MULTAS, redactado según el régimen del cierre.
   *
   * EL MONTO SALE DE `fondoMultas`, NUNCA de multiplicar acá: `totalFaltas` son
   * PERSONAS y `diasFaltadosEnTotal` son DÍAS. Con una sola persona faltando 2
   * de 3 días el fondo real es S/40 y multiplicar por personas daría S/20 —la
   * mitad— con toda la pinta de ser correcto.
   */
  const textoFondo = useMemo(() => {
    if (liquidacion === null || !datosCompletos) return null
    if (multaPorDia) {
      return `${liquidacion.diasFaltadosEnTotal} ${pluralizar(liquidacion.diasFaltadosEnTotal!, 'día faltado', 'días faltados')} × ${soles(liquidacion.multaInasistencia)} por día = ${soles(liquidacion.fondoMultas!)}, redistribuido entre los ${asistieron} ${pluralizar(asistieron ?? 0, 'colaborador que vino', 'colaboradores que vinieron')} todos los días del inventario (${liquidacion.diasDelInventario}).`
    }
    return `${liquidacion.totalFaltas} ${pluralizar(liquidacion.totalFaltas!, 'persona que faltó', 'personas que faltaron')} × ${soles(liquidacion.multaInasistencia)} = ${soles(liquidacion.fondoMultas!)}, redistribuido entre los ${asistieron} ${pluralizar(asistieron ?? 0, 'colaborador que asistió', 'colaboradores que asistieron')}. Este cierre es anterior a la asistencia por día: la multa era un monto fijo por persona.`
  }, [liquidacion, datosCompletos, multaPorDia, asistieron])

  return (
    <div className="space-y-3 md:space-y-0 md:flex md:flex-col md:gap-4 md:h-[calc(100vh_-_var(--app-header-h)_-_1px_-_2*var(--app-content-pad))]">
      {/* Panel de acciones (D365): las acciones de la pantalla a la izquierda. */}
      <div className="flex items-center justify-between gap-2">
        <ActionGroup
          items={[
            {
              id: 'ajustes',
              label: estadoAjustes.boton,
              icon: <FileIcon size={14} />,
              tone: negativos.bloqueaLiquidar ? 'primary' : 'neutral',
              disabled: liquidacion === null,
              title: liquidacion === null ? 'Primero elige una tienda con el conteo cerrado' : estadoAjustes.texto,
              onClick: () => setPanelAjustes(true),
            },
            {
              id: 'reporte',
              label: bajando ? 'Bajando...' : 'Reporte a gerencia en Excel',
              icon: <DownloadIcon size={14} />,
              tone: 'neutral',
              disabled: bajando || liquidacion === null || liquidacion.proyectada,
              title:
                liquidacion?.proyectada === true
                  ? 'El reporte a gerencia se arma al liquidar'
                  : 'Baja el .xlsx que arma el servidor',
              onClick: () => void bajarReporte(),
            },
          ]}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refrescar()}
            disabled={refrescando || sucursalId === null}
            className="p-[7px] border border-[var(--border)] rounded-md bg-white text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)] disabled:opacity-50 transition-colors"
            title="Volver a leer la liquidación"
          >
            <HiRefresh className={`w-3.5 h-3.5 ${refrescando ? 'animate-spin' : ''}`} />
          </button>
          <div className="hidden md:flex">
            <TableSettingsButton
              columns={tableColumns.columns}
              canHide={tableColumns.canHide}
              onToggle={tableColumns.toggle}
              onMove={tableColumns.move}
              onReset={tableColumns.reset}
              isDefault={tableColumns.isDefault}
            />
          </div>
        </div>
      </div>

      <div>
        <h1 className="text-sm md:text-[13px] font-semibold text-[var(--fg)]">
          Liquidación y nómina
          {liquidacion && <span className="ml-2 font-normal text-[var(--fg-muted)]">{liquidacion.periodo}</span>}
          {liquidacion && (
            <span className="ml-2 align-middle">
              <StatusBadge
                status={liquidacion.proyectada ? 'Planilla proyectada' : 'Planilla firme'}
                label={liquidacion.proyectada ? 'Planilla proyectada' : 'Planilla firme'}
                variant={liquidacion.proyectada ? 'warning' : 'success'}
              />
            </span>
          )}
        </h1>
        {resumen && (
          <>
            <p className="text-[12px] text-[var(--fg-muted)]">{resumen.plata}</p>
            <p className="text-[12px] text-[var(--fg-muted)]">Cuota base: {resumen.cuota}</p>
          </>
        )}
        {/* La nota del faltante de empresa: es CALCULADO y de solo lectura, y
            se dice de dónde sale para que nadie busque dónde corregirlo. */}
        {liquidacion && (
          <p className="text-[12px] text-[var(--fg-muted)]">{notaFaltanteEmpresa(liquidacion.proyectada)}</p>
        )}
        {/* PEGADA AL MONTO, no al pie en letra chica: quien autoriza un
            descuento a la nómina de otra persona tiene que ver que el número
            está incompleto ANTES de firmar. */}
        {liquidacion?.advertencia.mensaje !== null && liquidacion !== null && (
          <p className="mt-1 flex items-start gap-1.5 text-[12px] text-[var(--fg)]">
            <AlertIcon size={13} className="mt-0.5 shrink-0" />
            <span>{liquidacion.advertencia.mensaje}</span>
          </p>
        )}
      </div>

      {/* Selector de tienda, filtro de asistencia y filtro rápido. Nunca un <select> nativo. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <QuickFilterInput value={tableQuery.quickFilter} onChange={tableQuery.setQuickFilter} />
        <SearchableSelect
          options={sucursales.map((s) => ({ value: String(s.id), label: s.nombre }))}
          value={sucursalId === null ? '' : String(sucursalId)}
          onChange={(v) => setSucursalId(Number(v))}
          placeholder="Elige una tienda"
          ariaLabel="Tienda a liquidar"
          className="sm:w-72"
        />
        <SearchableSelect
          options={[
            { value: 'todos', label: `Todos (${planilla.length})` },
            // '—' y no el número: sin asistencia registrada no se puede afirmar
            // quién vino completo. Las dos cuentas son de PERSONAS.
            { value: 'asistio', label: `Sin faltas (${asistieron ?? SIN_DATO})` },
            { value: 'falto', label: `Con faltas (${conFaltas ?? SIN_DATO})` },
          ]}
          value={filtro}
          onChange={(v) => setFiltro(v as Filtro)}
          ariaLabel="Filtrar por asistencia"
          className="sm:w-56"
          searchThreshold={12}
        />
      </div>

      {cargando ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner text="Leyendo la liquidación..." />
        </div>
      ) : error !== null ? (
        <EmptyState title="No se pudo cargar la liquidación" message={error} />
      ) : liquidacion === null ? (
        /* NO ES UN ERROR: es el estado normal de una tienda mientras se cuenta,
           o sea la mayor parte del mes. Dice QUÉ falta y DÓNDE se hace. */
        <EmptyState title="Todavía no hay nada que liquidar" message={SIN_CICLO_CERRADO} />
      ) : (
        <>
          {/* EL FONDO DE MULTAS Y LA CONCILIACIÓN, en renglones: explican el
              monto de cada fila sin empujar la planilla fuera de la pantalla. */}
          <div className="space-y-1 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[12px] text-[var(--fg-muted)]">
            <p className="font-semibold text-[var(--fg)]">Fondo de multas por inasistencia</p>
            {!datosCompletos ? (
              <p>{motivoSinCalcular(liquidacion.advertencia)}</p>
            ) : (
              <>
                <p>{textoFondo}</p>
                <p>Cada uno de ellos recibe {soles(liquidacion.bonoAsistencia!)} de descuento adicional.</p>
                {/* EL CENTAVO DEL REPARTO, explicado donde se ve: sin esta
                    línea, quien compare el encabezado contra la planilla ve dos
                    números distintos y piensa que el sistema calcula mal. */}
                {conCentavoExtra > 0 && (
                  <p>
                    A {conCentavoExtra} de ellos les toca S/ 0.01 más, para que la suma dé exactamente{' '}
                    {soles(liquidacion.fondoMultas!)}.
                  </p>
                )}
              </>
            )}
            {conciliacion?.calculable === true && (
              <p className="border-t border-[var(--border)] pt-1">
                Conciliación: la planilla suma {soles(conciliacion.sumaPlanilla)} y el redondeo de la cuota deja{' '}
                {soles(conciliacion.diferenciaPorRedondeo)} a favor del personal. Del fondo se repartió{' '}
                {soles(conciliacion.fondoDeMultas.repartido)} de {soles(conciliacion.fondoDeMultas.recaudado)}{' '}
                recaudados
                {conciliacion.fondoDeMultas.cierra
                  ? ': cierra.'
                  : ` (diferencia de ${soles(conciliacion.fondoDeMultas.diferencia)}).`}
              </p>
            )}
          </div>

          <div className="hidden md:block md:flex-1 md:min-h-0 border border-[var(--border)] rounded-md overflow-auto">
            <table ref={layout.tableRef} className={`${layout.tableClass} text-sm`} style={layout.tableStyle}>
              <colgroup>
                {visibleColumns.map((column) => (
                  <col key={column.id} style={layout.colStyle(column)} />
                ))}
                {layout.hasFiller && <col />}
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="bg-white border-b border-[var(--border)]">
                  {visibleColumns.map((column) => (
                    <GridHeaderCell
                      key={column.id}
                      column={column}
                      ariaSort={
                        tableQuery.sort?.columnId === column.id
                          ? tableQuery.sort.direction === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : undefined
                      }
                      className={HEADER_CELL_CLASS}
                      layout={layout}
                      drag={columnDrag}
                    >
                      <ColumnHeaderCell
                        label={column.label}
                        sortable={Boolean(column.sortable)}
                        currentSort={tableQuery.sort?.columnId === column.id ? tableQuery.sort.direction : null}
                        onSort={(direction) => tableQuery.setSortColumn(column.id, direction)}
                        filterType={column.filter?.type}
                        operators={column.filter?.operators}
                        options={column.filter?.options}
                        currentFilter={tableQuery.columnFilters[column.id] ?? null}
                        onApplyFilter={(f) => tableQuery.setColumnFilter(column.id, f)}
                        onClearFilter={() => tableQuery.clearColumnFilter(column.id)}
                      />
                    </GridHeaderCell>
                  ))}
                  {layout.hasFiller && <th aria-hidden="true" className="p-0" />}
                </tr>
              </thead>
              <tbody>
                {visibles.map((p) => (
                  <tr key={p.colaboradorId} className="transition-colors hover:bg-[var(--bg-subtle)]">
                    {visibleColumns.map((column) => (
                      <td key={column.id} className={`px-2 md:px-3 truncate ${column.cellClassName ?? ''}`}>
                        {column.renderCell(p)}
                      </td>
                    ))}
                    {layout.hasFiller && <td aria-hidden="true" className="p-0" />}
                  </tr>
                ))}
                {visibles.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length + (layout.hasFiller ? 1 : 0)} className="py-10 text-center">
                      <NoFilterMatches onClear={limpiarFiltros} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Tarjetas en móvil: siete columnas no entran en un teléfono. */}
          <div className="md:hidden space-y-3">
            {visibles.map((p) => (
              <div key={p.colaboradorId} className="rounded-md border border-[var(--border)] bg-white p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--fg)]">{p.nombre}</p>
                    <p className="text-xs text-[var(--fg-muted)]">{NOMBRE_ROL[p.rol] ?? p.rol}</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-[var(--fg)]">{soles(p.monto)}</p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-[var(--fg-muted)]">Días</p>
                    <p className="text-[var(--fg)]">
                      {multaPorDia ? textoDiasAsistidos(p.diasAsistidos, liquidacion.diasDelInventario) : SIN_DATO}
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--fg-muted)]">Multa</p>
                    <p className="tabular-nums text-[var(--fg)]">{multaDeLaFila(p, liquidacion, soles)}</p>
                  </div>
                  <div>
                    <p className="text-[var(--fg-muted)]">Bono</p>
                    <p className="tabular-nums text-[var(--fg)]">{bonoDeLaFila(p, liquidacion, soles)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* EL CIERRE VA AL FINAL, después de la planilla: es lo último que se
              hace, y ponerlo arriba invitaría a firmar sin mirar los números
              que se firman. */}
          <div className="rounded-md border border-[var(--border)] bg-white p-3 text-[12px]">
            {cerrado !== null ? (
              <p className="text-[var(--fg)]">
                Planilla cerrada: los descuentos de {cerrado.colaboradores}{' '}
                {pluralizar(cerrado.colaboradores, 'colaborador', 'colaboradores')} quedaron firmes por{' '}
                {soles(cerrado.totalDescontado)} en total. El paso que sigue es la aprobación y el lacrado: el sello
                incluye esta planilla.
              </p>
            ) : !liquidacion.proyectada ? (
              <p className="text-[var(--fg-muted)]">
                Esta planilla ya está firme. El paso que sigue es la aprobación y el lacrado.
              </p>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[var(--fg-muted)]">
                  {cierre?.puede === true
                    ? `Vas a dejar firmes los descuentos de ${planilla.length} ${pluralizar(planilla.length, 'colaborador', 'colaboradores')} por ${soles(liquidacion.faltanteNeto!)} de faltante neto. Después de esto sigue el lacrado.`
                    : cierre?.motivo}
                </p>
                <button
                  type="button"
                  className="btn btn-primary shrink-0"
                  disabled={cierre?.puede !== true || liquidando}
                  onClick={() => setConfirmarCierre(true)}
                >
                  Liquidar este inventario
                </button>
              </div>
            )}
          </div>

          {/* EL REPORTE A GERENCIA: los productos de la EMPRESA, que no entran
              a la planilla del personal. Nunca se muestra vacío: siempre el
              motivo real de por qué no hay nada. */}
          {vistaReporte !== null && (
            <div className="rounded-md border border-[var(--border)] bg-white p-3 text-[12px]">
              <p className="font-semibold text-[var(--fg)]">Reporte a gerencia</p>
              {vistaReporte.tipo === 'cargando' ? (
                <LoadingSpinner size="sm" />
              ) : vistaReporte.tipo !== 'con-datos' ? (
                <p className="text-[var(--fg-muted)]">{vistaReporte.motivo}</p>
              ) : (
                <div className="space-y-1">
                  <p className="text-[var(--fg-muted)]">
                    Faltante de la empresa ({vistaReporte.faltantes.length}): {soles(vistaReporte.totalFaltante)} ·
                    Sobrante ({vistaReporte.sobrantes.length}): {soles(vistaReporte.totalSobrante)}
                  </p>
                  {vistaReporte.sinPrecio > 0 && (
                    <p className="flex items-start gap-1.5 text-[var(--fg)]">
                      <AlertIcon size={13} className="mt-0.5 shrink-0" />
                      <span>{textoSinPrecioReporte(vistaReporte.sinPrecio)}</span>
                    </p>
                  )}
                  <ListaReporte titulo="Faltantes" tipo="faltante" filas={vistaReporte.faltantes} />
                  <ListaReporte titulo="Sobrantes" tipo="sobrante" filas={vistaReporte.sobrantes} />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {liquidacion !== null && (
        <PanelAjustesNegativos
          abierto={panelAjustes}
          inventarioId={liquidacion.inventarioId}
          onCerrar={() => setPanelAjustes(false)}
          onCambio={() => sucursalId !== null && void cargar(sucursalId, true)}
        />
      )}

      {/* LA CONFIRMACIÓN DICE LOS DOS NÚMEROS que se están firmando antes de la
          frase de advertencia: un "¿estás seguro?" sin cifras no le da a nadie
          con qué decidir. */}
      {confirmarCierre && liquidacion !== null && (
        <ConfirmDialog
          isOpen
          title="Cerrar la planilla"
          isLoading={liquidando}
          confirmText="Liquidar"
          variant="destructive"
          onCancel={() => setConfirmarCierre(false)}
          onClose={() => setConfirmarCierre(false)}
          onConfirm={() => void liquidar()}
          message={
            <div className="space-y-2 text-left text-[13px]">
              <p>Faltante neto: {soles(liquidacion.faltanteNeto ?? 0)}</p>
              <p>
                Alcanza a {planilla.length} {pluralizar(planilla.length, 'colaborador', 'colaboradores')}.
              </p>
              <p>
                Esto cierra la planilla: los descuentos quedan firmes y el paso siguiente es el lacrado. No se puede
                deshacer.
              </p>
            </div>
          }
        />
      )}
    </div>
  )
}

/**
 * Faltantes y sobrantes en DOS listas, y cada fila lleva la señal por dos vías:
 * la lista en la que está y el signo de las unidades. Sin color por signo, que
 * es la regla de este portal.
 */
function ListaReporte({
  titulo,
  tipo,
  filas,
}: {
  titulo: string
  tipo: 'faltante' | 'sobrante'
  filas: { codigo: string; descripcion: string; unidades: number; monto: number | null }[]
}) {
  return (
    <div className="mt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-muted)]">
        {titulo} ({filas.length})
      </p>
      {filas.length === 0 ? (
        <p className="text-[var(--fg-muted)]">
          {tipo === 'faltante'
            ? 'Ningún producto de la empresa con faltante.'
            : 'Ningún producto de la empresa con sobrante.'}
        </p>
      ) : (
        <ul>
          {filas.map((f) => (
            <li key={f.codigo} className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] py-1 last:border-0">
              <span className="min-w-0 truncate text-[var(--fg)]">
                {f.descripcion}
                <span className="ml-2 text-[var(--fg-muted)]">
                  {f.codigo} · {textoUnidadesReporte(tipo, f.unidades, formatoMiles)}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-[var(--fg)]">{textoMontoReporte(f.monto, soles)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
