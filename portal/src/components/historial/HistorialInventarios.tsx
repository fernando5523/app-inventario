import { useCallback, useEffect, useMemo, useState } from 'react'
import { DownloadIcon } from '@primer/octicons-react'
import { HiRefresh } from 'react-icons/hi'
import { ActionGroup } from '../common/ActionGroup'
import { EmptyState } from '../common/EmptyState'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { Pagination } from '../common/Pagination'
import { SearchableSelect } from '../common/SearchableSelect'
import { StatusBadge } from '../common/StatusBadge'
import { TableSettingsButton } from '../common/table-settings/TableSettingsButton'
import { useTableColumns } from '../common/table-settings/useTableColumns'
import type { TableColumnDef } from '../common/table-settings/types'
import { ColumnHeaderCell, NoFilterMatches, QuickFilterInput, buildQueryGetters, useTableQuery } from '../common/table-filters'
import { GridHeaderCell, useColumnDrag, useColumnLayout } from '../common/table-grid'
import { sesionApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { downloadXlsx } from '../../utils/xlsx'
import { notifyError } from '../../utils/notifyError'
import { MESES, MESES_CORTOS, formatoMiles, formatoMoneda, formatoPct, pluralizar } from '../../utils/formato'
import type { EstadoInventario, Sucursal } from '../../tipos'
import { historialApi } from './historialApi'
import {
  ESTADOS,
  ESTADOS_FILTRABLES,
  aniosDisponibles,
  fecha,
  motivoSinNetoCorto,
  periodoMasReciente,
  textoFirmas,
} from './historialDominio'
import type { InventarioHistorico } from './historialTipos'
import { ModalExportarConsolidado } from './ModalExportarConsolidado'
import { PanelDetalle } from './PanelDetalle'

/**
 * ---------------------------------------------------------------------------
 * HISTORIAL DE INVENTARIOS
 * ---------------------------------------------------------------------------
 * El registro de todos los inventarios: en qué estado está cada uno, cómo
 * cerró y quién lo firmó. Responde la pregunta textual del cliente — *"falta
 * el registro de todos los inventarios, dónde llevaremos el control y el
 * histórico"*.
 *
 * Portada de `mobile/components/pantallas/HistorialScreen.web.tsx`: mismos
 * endpoints, mismas reglas y los mismos textos, que están discutidos uno por
 * uno (`historialDominio.ts`). Lo que cambia es la forma — la lista pasa a la
 * grilla de esta casa y el detalle a un panel lateral.
 *
 * SOLO LECTURA, Y NO POR CASUALIDAD. Firmar y lacrar viven en "Aprobación y
 * lacrado", donde el control de dos personas ya está resuelto: un histórico
 * que además escribe es un histórico que se puede reescribir.
 *
 * EL ALCANCE LO DECIDE EL SERVIDOR (`historial.permisos.ts`), no esta
 * pantalla: acá se manda el filtro de sucursal para no pedir de más y para que
 * el encabezado diga la verdad sobre qué se está mirando.
 */

const HEADER_CELL_CLASS = 'px-2 md:px-3 py-1.5 text-[11px] md:text-xs font-semibold text-[var(--fg-muted)]'
/**
 * TODAS LAS CIFRAS EN LA TINTA NORMAL, sin verde ni rojo según el signo. Lo
 * pidió el cliente y es la regla de la marca: el rojo es SIEMPRE acción, nunca
 * un estado. El signo menos ya dice lo que hay que decir.
 */
const NUM_CELL_CLASS = 'py-1.5 text-xs text-[var(--fg)] tabular-nums text-right'

/** Sin dato es guion, NUNCA un 0: un cero afirma que se midió y dio cero. */
const SIN_DATO = '—'

/** Cuántos inventarios por página. El endpoint topea en 100. */
const POR_PAGINA = 24

/** Sentinel de "sin filtro de esta dimensión" — nunca un id real. */
const TODOS = ''

export function HistorialInventarios() {
  const { sucursal: sucursalDeSesion } = useAuthStore()

  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [inventarios, setInventarios] = useState<InventarioHistorico[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [cargando, setCargando] = useState(true)
  const [refrescando, setRefrescando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [filtroSucursal, setFiltroSucursal] = useState<string>(TODOS)
  const [filtroEstado, setFiltroEstado] = useState<string>(TODOS)
  const [filtroAnio, setFiltroAnio] = useState<string>(TODOS)
  const [filtroMes, setFiltroMes] = useState<string>(TODOS)
  /**
   * El período arranca en el del inventario más reciente, no en el mes del
   * reloj: los primeros días del mes todavía no hay ninguno abierto y la
   * pantalla se vería vacía, que se lee como "no hay historial". Se calcula
   * una sola vez, con la primera lectura sin filtros.
   */
  const [periodoResuelto, setPeriodoResuelto] = useState(false)

  const [abierto, setAbierto] = useState<InventarioHistorico | null>(null)
  const [modalConsolidado, setModalConsolidado] = useState(false)
  const [exportando, setExportando] = useState(false)

  useEffect(() => {
    sesionApi
      .sucursales()
      .then(setSucursales)
      // SIN RED NO SE VACÍA el padrón: una lista vacía apagaría el filtro
      // entero, y no porque no haya tiendas sino porque no se pudo preguntar.
      .catch((e) => notifyError('No se pudieron cargar las sucursales', e))
  }, [])

  const cargar = useCallback(async () => {
    try {
      const pedido = await historialApi.listar({
        ...(filtroSucursal === TODOS ? {} : { sucursalId: Number(filtroSucursal) }),
        ...(filtroEstado === TODOS ? {} : { estado: filtroEstado as EstadoInventario }),
        ...(filtroAnio === TODOS ? {} : { periodoAnio: Number(filtroAnio) }),
        ...(filtroMes === TODOS ? {} : { periodoMes: Number(filtroMes) }),
        limite: POR_PAGINA,
        desplazamiento: (pagina - 1) * POR_PAGINA,
      })
      setInventarios(pedido.inventarios)
      setTotal(pedido.total)
      setError(null)
      if (!periodoResuelto) {
        setPeriodoResuelto(true)
        const reciente = periodoMasReciente(pedido.inventarios)
        if (reciente !== null) {
          setFiltroAnio(String(reciente.anio))
          setFiltroMes(String(reciente.mes))
        }
      }
    } catch (e) {
      // SIN RELLENO: una lista vacía sobre una tienda que sí contó se lee como
      // un dato ("nunca hubo inventario"), y acá eso es una afirmación falsa.
      setInventarios([])
      setTotal(0)
      setError(e instanceof Error ? e.message : 'No se pudo cargar el historial.')
      notifyError('No se pudo cargar el historial', e)
    } finally {
      setCargando(false)
    }
  }, [filtroSucursal, filtroEstado, filtroAnio, filtroMes, pagina, periodoResuelto])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /** Cambió un filtro: volver a la página 1. Quedarse en la 7 de una lista de 2 muestra vacío. */
  useEffect(() => {
    setPagina(1)
  }, [filtroSucursal, filtroEstado, filtroAnio, filtroMes])

  const refrescar = async () => {
    setRefrescando(true)
    try {
      await cargar()
    } finally {
      setRefrescando(false)
    }
  }

  /**
   * El consolidado es de UN período: sin año y mes el pedido barrería años de
   * histórico, y el servidor lo exige. Con "Todos" puesto no se puede ofrecer.
   */
  const periodoDelConsolidado =
    filtroAnio === TODOS || filtroMes === TODOS ? null : { periodoAnio: Number(filtroAnio), periodoMes: Number(filtroMes) }

  const exportarConsolidado = async (sucursalIds: number[]) => {
    if (periodoDelConsolidado === null) return
    setExportando(true)
    try {
      const archivo = await historialApi.exportarConsolidado({ ...periodoDelConsolidado, sucursalIds })
      downloadXlsx(archivo.nombreArchivo, archivo.bytes)
      setModalConsolidado(false)
    } catch (e) {
      notifyError('No se pudo exportar el consolidado', e)
    } finally {
      setExportando(false)
    }
  }

  const columnas: TableColumnDef<InventarioHistorico>[] = useMemo(
    () => [
      {
        id: 'periodo',
        label: 'Período',
        width: 10,
        locked: true,
        sortable: true,
        filter: { type: 'text', value: (i) => i.periodo },
        cellClassName: 'py-1.5 text-xs font-semibold text-[var(--fg)]',
        renderCell: (i) => `${MESES_CORTOS[i.periodoMes - 1]} ${i.periodoAnio}`,
        exportValue: (i) => i.periodo,
      },
      {
        id: 'sucursal',
        label: 'Sucursal',
        width: 20,
        sortable: true,
        filter: {
          type: 'enum',
          options: Array.from(new Set(inventarios.map((i) => i.sucursalNombre))).map((label) => ({ value: label, label })),
          value: (i) => i.sucursalNombre,
        },
        cellClassName: 'py-1.5 text-xs text-[var(--fg)]',
        renderCell: (i) => i.sucursalNombre,
        exportValue: (i) => i.sucursalNombre,
      },
      {
        id: 'estado',
        label: 'Estado',
        width: 14,
        sortable: true,
        filter: {
          // SOLO LOS ESTADOS PRESENTES: ofrecer uno que siempre devuelve vacío
          // es ruido en un filtro que se usa para encontrar algo.
          type: 'enum',
          options: Array.from(new Set(inventarios.map((i) => ESTADOS[i.estado].etiqueta))).map((label) => ({ value: label, label })),
          value: (i) => ESTADOS[i.estado].etiqueta,
        },
        cellClassName: 'py-1.5 text-xs',
        renderCell: (i) => {
          const e = ESTADOS[i.estado]
          return (
            <span className="inline-flex min-w-[124px]">
              <StatusBadge status={e.etiqueta} label={e.etiqueta} variant={e.variante} />
            </span>
          )
        },
        exportValue: (i) => ESTADOS[i.estado].etiqueta,
      },
      {
        id: 'items',
        label: 'Ítems',
        width: 8,
        align: 'right',
        sortable: true,
        filter: { type: 'number', value: (i) => i.snapshotItems },
        cellClassName: NUM_CELL_CLASS,
        renderCell: (i) => formatoMiles(i.snapshotItems),
        exportValue: (i) => i.snapshotItems,
        exportFormat: 'number',
      },
      {
        id: 'cuadrados',
        label: 'Cuadrados',
        width: 11,
        align: 'right',
        sortable: true,
        filter: { type: 'number', value: (i) => i.resultado?.porcentajeCuadrado ?? null },
        cellClassName: NUM_CELL_CLASS,
        // GUION, no 0%: un inventario que todavía no cerró no "cuadró 0%".
        renderCell: (i) => (i.resultado === null ? SIN_DATO : `${formatoPct(i.resultado.porcentajeCuadrado)}%`),
        exportValue: (i) => i.resultado?.porcentajeCuadrado ?? '',
        exportFormat: 'number',
      },
      {
        id: 'conDiferencia',
        label: 'Con diferencia',
        width: 11,
        align: 'right',
        sortable: true,
        filter: { type: 'number', value: (i) => i.resultado?.itemsConDiferencia ?? null },
        cellClassName: NUM_CELL_CLASS,
        renderCell: (i) => (i.resultado === null ? SIN_DATO : formatoMiles(i.resultado.itemsConDiferencia)),
        exportValue: (i) => i.resultado?.itemsConDiferencia ?? '',
        exportFormat: 'number',
      },
      {
        id: 'faltanteBruto',
        label: 'Faltante bruto',
        width: 12,
        align: 'right',
        sortable: true,
        filter: { type: 'number', value: (i) => i.resultado?.montoFaltanteBruto ?? null },
        cellClassName: NUM_CELL_CLASS,
        renderCell: (i) => (i.resultado === null ? SIN_DATO : `S/ ${formatoMoneda(i.resultado.montoFaltanteBruto)}`),
        exportValue: (i) => i.resultado?.montoFaltanteBruto ?? '',
        exportFormat: 'number',
      },
      {
        /*
          `null` NO ES 0, y acá menos que en ninguna otra columna: "todavía no
          se liquidó" y "no falta nada" son cosas distintas. Cuando es null se
          dice POR QUÉ (`motivoSinNetoCorto`), nunca un guion que obligue a
          abrir el detalle para enterarse.
        */
        id: 'faltanteNeto',
        label: 'Faltante neto',
        width: 13,
        align: 'right',
        sortable: true,
        filter: { type: 'number', value: (i) => i.resultado?.montoFaltanteNeto ?? null },
        cellClassName: NUM_CELL_CLASS,
        renderCell: (i) => {
          if (i.resultado === null) return SIN_DATO
          if (i.resultado.montoFaltanteNeto === null) {
            return <span className="text-[var(--fg-muted)]">{motivoSinNetoCorto(i.resultado)}</span>
          }
          return `S/ ${formatoMoneda(i.resultado.montoFaltanteNeto)}`
        },
        exportValue: (i) => i.resultado?.montoFaltanteNeto ?? '',
        exportFormat: 'number',
      },
      {
        id: 'firmas',
        label: 'Firmas',
        width: 9,
        align: 'right',
        sortable: true,
        filter: { type: 'number', value: (i) => i.aprobaciones },
        cellClassName: NUM_CELL_CLASS,
        // El requerido VIAJA DESDE EL SERVIDOR: hoy es 1 y el día que sean
        // tres la pantalla se entera sola. Nunca un 2 escrito a mano.
        renderCell: (i) => textoFirmas(i.aprobaciones, i.aprobacionesRequeridas),
        exportValue: (i) => textoFirmas(i.aprobaciones, i.aprobacionesRequeridas),
      },
      {
        id: 'folio',
        label: 'Folio',
        width: 14,
        sortable: true,
        filter: { type: 'text', value: (i) => i.lacrado?.folio ?? '' },
        cellClassName: 'py-1.5 text-xs text-[var(--fg)] tabular-nums',
        renderCell: (i) => i.lacrado?.folio ?? SIN_DATO,
        exportValue: (i) => i.lacrado?.folio ?? '',
      },
      {
        id: 'abierto',
        label: 'Abierto el',
        width: 11,
        sortable: true,
        filter: { type: 'text', value: (i) => fecha(i.abiertoEn) },
        cellClassName: 'py-1.5 text-xs text-[var(--fg)] tabular-nums',
        renderCell: (i) => fecha(i.abiertoEn),
        exportValue: (i) => fecha(i.abiertoEn),
      },
    ],
    [inventarios],
  )

  const tableColumns = useTableColumns('historial-inventarios', columnas)
  const { filterGetters, filterTypes, sortGetters } = buildQueryGetters(columnas)
  const tableQuery = useTableQuery<InventarioHistorico>({
    rows: inventarios,
    filterGetters,
    filterTypes,
    sortGetters,
    persisted: { value: tableColumns.query, onChange: tableColumns.setQuery },
    getQuickFilterText: (i) => `${i.sucursalNombre} ${i.periodo} ${i.lacrado?.folio ?? ''}`,
  })

  const { visibleColumns } = tableColumns
  const layout = useColumnLayout({
    visibleColumns,
    widths: tableColumns.widths,
    setWidths: tableColumns.setWidths,
    ready: !cargando,
  })
  const columnDrag = useColumnDrag(
    tableColumns.move,
    tableColumns.columns.map((c) => c.id),
  )

  const filas = tableQuery.rows
  const limpiarFiltros = () => {
    tableQuery.clearAllColumnFilters()
    tableQuery.setQuickFilter('')
  }

  const alcance =
    filtroSucursal === TODOS
      ? 'Todas las tiendas'
      : (sucursales.find((s) => String(s.id) === filtroSucursal)?.nombre ?? sucursalDeSesion?.nombre ?? '')

  return (
    <div className="space-y-3 md:space-y-0 md:flex md:flex-col md:gap-4 md:h-[calc(100vh_-_var(--app-header-h)_-_1px_-_2*var(--app-content-pad))]">
      <div className="flex items-center justify-between gap-2">
        <ActionGroup
          items={[
            {
              id: 'consolidado',
              label: 'Exportar el consolidado del período',
              icon: <DownloadIcon size={14} />,
              disabled: periodoDelConsolidado === null || exportando,
              title:
                periodoDelConsolidado === null
                  ? 'Elige un año y un mes: el consolidado es de un período, no de todo el histórico'
                  : 'Un .xlsx con las diferencias de las tiendas que elijas, en una sola tabla',
              onClick: () => setModalConsolidado(true),
            },
          ]}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refrescar()}
            disabled={refrescando}
            className="p-[7px] border border-[var(--border)] rounded-md bg-white text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)] disabled:opacity-50 transition-colors"
            title="Volver a leer el historial"
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
          Historial de inventarios
          {alcance && <span className="ml-2 font-normal text-[var(--fg-muted)]">{alcance}</span>}
        </h1>
        <p className="text-[12px] text-[var(--fg-muted)]">
          El registro de todos los inventarios: en qué estado quedó cada uno, cómo cerró y quién lo firmó. Abre una fila
          para ver el detalle, las diferencias y la planilla. Acá no se modifica nada.
        </p>
        {!cargando && (
          <p className="text-[12px] text-[var(--fg-muted)]">
            {formatoMiles(total)} {pluralizar(total, 'inventario', 'inventarios')} con estos filtros
          </p>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
        <QuickFilterInput value={tableQuery.quickFilter} onChange={tableQuery.setQuickFilter} />
        <SearchableSelect
          options={[{ value: TODOS, label: 'Todas las tiendas' }, ...sucursales.map((s) => ({ value: String(s.id), label: s.nombre }))]}
          value={filtroSucursal}
          onChange={setFiltroSucursal}
          ariaLabel="Sucursal"
          className="sm:w-56"
        />
        <SearchableSelect
          options={[
            { value: TODOS, label: 'Todos los estados' },
            // NO los seis: `ajuste_auditor` da 400 en el servidor. Ver
            // `ESTADOS_FILTRABLES` en el dominio.
            ...ESTADOS_FILTRABLES.map((e) => ({ value: e, label: ESTADOS[e].etiqueta })),
          ]}
          value={filtroEstado}
          onChange={setFiltroEstado}
          ariaLabel="Estado del inventario"
          className="sm:w-48"
          searchThreshold={12}
        />
        <SearchableSelect
          options={[{ value: TODOS, label: 'Todos los años' }, ...aniosDisponibles().map((a) => ({ value: String(a), label: String(a) }))]}
          value={filtroAnio}
          onChange={(v) => {
            setFiltroAnio(v)
            // Sin año, el mes no significa nada: "marzo de cualquier año"
            // mezcla tiendas de años distintos en la misma lista.
            if (v === TODOS) setFiltroMes(TODOS)
          }}
          ariaLabel="Año del período"
          className="sm:w-36"
          searchThreshold={12}
        />
        <SearchableSelect
          options={[{ value: TODOS, label: 'Todo el año' }, ...MESES.map((m, i) => ({ value: String(i + 1), label: m }))]}
          value={filtroMes}
          onChange={setFiltroMes}
          ariaLabel="Mes del período"
          className="sm:w-40"
          disabled={filtroAnio === TODOS}
          searchThreshold={13}
        />
      </div>

      {cargando ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner text="Leyendo el historial..." />
        </div>
      ) : error !== null ? (
        <EmptyState
          title="No se pudo cargar el historial"
          message={error}
          action={{ label: 'Volver a intentar', onClick: () => void refrescar() }}
        />
      ) : inventarios.length === 0 ? (
        <EmptyState
          title="No hay inventarios con estos filtros"
          message="Puede que el período elegido todavía no tenga inventarios abiertos. Prueba con otro mes o quita el filtro de tienda."
        />
      ) : (
        <>
          <div className="hidden md:block md:flex-1 md:min-h-0 border border-[var(--border)] rounded-md overflow-auto">
            <table ref={layout.tableRef} className={`${layout.tableClass} text-sm`} style={layout.tableStyle}>
              <colgroup>
                {visibleColumns.map((column) => (
                  <col key={column.id} style={layout.colStyle(column)} />
                ))}
                {layout.hasFiller && <col />}
              </colgroup>
              <thead className="bg-[var(--bg-subtle)] border-b border-[var(--border)] sticky top-0 z-10">
                <tr>
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
                        onApplyFilter={(filter) => tableQuery.setColumnFilter(column.id, filter)}
                        onClearFilter={() => tableQuery.clearColumnFilter(column.id)}
                      />
                    </GridHeaderCell>
                  ))}
                  {layout.hasFiller && <th aria-hidden="true" className="p-0" />}
                </tr>
              </thead>
              <tbody>
                {filas.map((inv) => (
                  <tr
                    key={inv.id}
                    onClick={() => setAbierto(inv)}
                    className="cursor-pointer transition-colors hover:bg-[var(--bg-subtle)]"
                  >
                    {visibleColumns.map((column) => (
                      <td key={column.id} className={`px-2 md:px-3 truncate ${column.cellClassName ?? ''}`}>
                        {column.renderCell(inv)}
                      </td>
                    ))}
                    {layout.hasFiller && <td aria-hidden="true" className="p-0" />}
                  </tr>
                ))}
                {filas.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length + (layout.hasFiller ? 1 : 0)} className="py-10 text-center">
                      <NoFilterMatches onClear={limpiarFiltros} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Tarjetas en móvil: la grilla de once columnas no entra en un teléfono. */}
          <div className="md:hidden space-y-3">
            {filas.length === 0 && <NoFilterMatches onClear={limpiarFiltros} />}
            {filas.map((inv) => (
              <button
                key={inv.id}
                type="button"
                onClick={() => setAbierto(inv)}
                className="w-full text-left bg-white rounded-md border border-[var(--border)] p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--fg)] truncate">
                    {MESES_CORTOS[inv.periodoMes - 1]} {inv.periodoAnio} · {inv.sucursalNombre}
                  </p>
                  <StatusBadge status={ESTADOS[inv.estado].etiqueta} label={ESTADOS[inv.estado].etiqueta} variant={ESTADOS[inv.estado].variante} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-[var(--fg-muted)]">Ítems</p>
                    <p className="text-[var(--fg)] tabular-nums">{formatoMiles(inv.snapshotItems)}</p>
                  </div>
                  <div>
                    <p className="text-[var(--fg-muted)]">Cuadrados</p>
                    <p className="text-[var(--fg)] tabular-nums">
                      {inv.resultado === null ? SIN_DATO : `${formatoPct(inv.resultado.porcentajeCuadrado)}%`}
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--fg-muted)]">Faltante neto</p>
                    <p className="text-[var(--fg)] tabular-nums">
                      {inv.resultado === null
                        ? SIN_DATO
                        : inv.resultado.montoFaltanteNeto === null
                          ? motivoSinNetoCorto(inv.resultado)
                          : `S/ ${formatoMoneda(inv.resultado.montoFaltanteNeto)}`}
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--fg-muted)]">Firmas</p>
                    <p className="text-[var(--fg)] tabular-nums">{textoFirmas(inv.aprobaciones, inv.aprobacionesRequeridas)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {total > POR_PAGINA && (
            <Pagination
              currentPage={pagina}
              totalPages={Math.ceil(total / POR_PAGINA)}
              totalItems={total}
              itemsPerPage={POR_PAGINA}
              onPageChange={setPagina}
              isLoading={refrescando}
            />
          )}
        </>
      )}

      <PanelDetalle inventario={abierto} onCerrar={() => setAbierto(null)} />

      {modalConsolidado && periodoDelConsolidado !== null && (
        <ModalExportarConsolidado
          tiendas={sucursales}
          periodoAnio={periodoDelConsolidado.periodoAnio}
          periodoMes={periodoDelConsolidado.periodoMes}
          exportando={exportando}
          onExportar={(ids) => void exportarConsolidado(ids)}
          onCerrar={() => setModalConsolidado(false)}
        />
      )}
    </div>
  )
}
