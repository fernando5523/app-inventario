import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HiRefresh } from 'react-icons/hi'
import { LawIcon, LockIcon } from '@primer/octicons-react'
import { ActionGroup } from '../common/ActionGroup'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { EmptyState } from '../common/EmptyState'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { SearchableSelect } from '../common/SearchableSelect'
import { StatusBadge } from '../common/StatusBadge'
import { TableSettingsButton } from '../common/table-settings/TableSettingsButton'
import { useTableColumns } from '../common/table-settings/useTableColumns'
import type { TableColumnDef } from '../common/table-settings/types'
import {
  ColumnHeaderCell,
  NoFilterMatches,
  QuickFilterInput,
  buildQueryGetters,
  useTableQuery,
} from '../common/table-filters'
import { GridHeaderCell, useColumnDrag, useColumnLayout } from '../common/table-grid'
import { sesionApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { notifyError } from '../../utils/notifyError'
import { formatoMiles, pluralizar } from '../../utils/formato'
import type { Sucursal } from '../../tipos'
import { corregirApi } from '../corregir/api'
import { faseDeCierre, ordinal, type FaseDeCierre } from '../corregir/reglas'
import type { InventarioActivo, ItemDeLaMatriz, VeredictoAuditoria } from '../corregir/tipos'
import { ajusteApi } from './ajusteApi'
import { PanelAjuste } from './PanelAjuste'
import { puedeAjustar, puedeIniciarAjuste, sinCuadrar } from './reglas'

/**
 * ---------------------------------------------------------------------------
 * EL AJUSTE FINAL DEL CONTEO
 * ---------------------------------------------------------------------------
 * Donde el Auditor fija los valores definitivos mirando el stock del ERP y
 * cierra el ajuste para que el inventario pase a liquidación. Portada de
 * `mobile/app/auditor/ajuste.web.tsx`: mismas reglas, mismos textos, misma
 * secuencia. Lo que cambia es la forma — la grilla de esta casa.
 *
 * ES EL ÚNICO LUGAR DEL SISTEMA DONDE SE ESCRIBE MIRANDO EL ERP. Todo lo
 * demás —crear hojas, contar, recontar, corregir— deja el stock afuera a
 * propósito: es el conteo ciego. Acá se levanta porque ya no queda nadie
 * contando (ver la cabecera de `backend/src/modules/inventarios/ajuste.service.ts`).
 *
 * LAS CUENTAS LLEGAN HECHAS del servidor —`diferenciaUnidades`, `veredicto`,
 * `stockDeLaMedicion`—; acá no se recalcula ninguna. Lo único que se calcula
 * en el cliente es la previsualización del valor tipeado, que por definición
 * todavía no existe en el servidor.
 *
 * SIN COLUMNA DE CATEGORÍA, a propósito: la tabla del teléfono tampoco la
 * tiene, y la única categoría válida (`ProductoDeHoja.categoria`) llega por el
 * endpoint de hojas, no por la matriz. `zona` sí viene en el DTO y NO se usa:
 * es la categoría dominante del bloque y ya pintó un vino como detergente.
 */

/** Sin dato es guion, NUNCA un 0: un cero afirma que se contó y dio cero. */
const SIN_DATO = '—'

const HEADER_CELL_CLASS = 'px-2 md:px-3 py-1.5 text-[11px] md:text-xs font-semibold text-[var(--fg-muted)]'
/** Toda cifra en la tinta normal: el signo menos ya dice que es negativo. */
const NUM_CELL_CLASS = 'py-1.5 text-xs text-[var(--fg)] tabular-nums text-right'

const ETIQUETA_VEREDICTO: Record<VeredictoAuditoria, { label: string; variant: 'default' | 'success' | 'warning' }> = {
  cuadrado: { label: 'Cuadrado', variant: 'success' },
  falta: { label: 'Con diferencia', variant: 'warning' },
  empresa: { label: 'Empresa', variant: 'warning' },
  sin_erp: { label: 'Sin dato del ERP', variant: 'default' },
  sin_contar: { label: 'Sin contar', variant: 'default' },
}

type Filtro = 'sin-cuadrar' | 'todos'

/** Lo que pasó con la última acción de la página (no del formulario). */
interface Aviso {
  tono: 'ok' | 'error'
  texto: string
}

export function AjusteFinal() {
  const { sucursal: sucursalDeSesion } = useAuthStore()

  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [sucursalElegida, setSucursalElegida] = useState<number | null>(null)
  const sucursalId = sucursalElegida ?? sucursalDeSesion?.id ?? null

  const [inventario, setInventario] = useState<InventarioActivo | null>(null)
  const [items, setItems] = useState<ItemDeLaMatriz[]>([])
  /** código → `productoId` de la ÚLTIMA ronda, el único que acepta el ajuste. Ver `ajusteApi.ts`. */
  const [ajustables, setAjustables] = useState<Map<string, number>>(new Map())
  const [filtro, setFiltro] = useState<Filtro>('sin-cuadrar')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refrescando, setRefrescando] = useState(false)

  const [enEdicion, setEnEdicion] = useState<ItemDeLaMatriz | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [errorDelPanel, setErrorDelPanel] = useState<unknown>(null)
  const [accion, setAccion] = useState<'iniciar' | 'cerrar' | null>(null)
  const [confirmarCerrar, setConfirmarCerrar] = useState(false)
  const [aviso, setAviso] = useState<Aviso | null>(null)

  useEffect(() => {
    sesionApi
      .sucursales()
      .then(setSucursales)
      .catch((e) => notifyError('No se pudieron cargar las sucursales', e))
  }, [])

  /**
   * SIN RELLENO: si la lectura falla, la tabla desaparece y se dice por qué.
   * Una matriz vacía sobre un inventario que sí tiene ítems se lee como un
   * dato —"todo cuadró"— y acá eso decide plata.
   */
  const cargar = useCallback(async () => {
    if (sucursalId === null) {
      setInventario(null)
      setItems([])
      setAjustables(new Map())
      setCargando(false)
      return
    }
    try {
      const activo = await corregirApi.inventarioActivo(sucursalId)
      setInventario(activo)
      // Las dos lecturas EN PARALELO: son independientes y la matriz de una
      // tienda grande ya son dos páginas de 500.
      const [matriz, porCodigo] = await Promise.all([
        activo === null ? [] : corregirApi.matrizCompleta(activo.inventarioId),
        activo === null || activo.rondaActiva === null
          ? new Map<string, number>()
          : ajusteApi.productosDeLaUltimaRonda(activo.inventarioId, activo.rondaActiva),
      ])
      setItems(matriz)
      setAjustables(porCodigo)
      setError(null)
    } catch (e) {
      setInventario(null)
      setItems([])
      setAjustables(new Map())
      setError(e instanceof Error ? e.message : 'No se pudo cargar el ajuste.')
      notifyError('No se pudo cargar el ajuste', e)
    } finally {
      setCargando(false)
    }
  }, [sucursalId])

  /** Cambió la tienda: limpiar ANTES de pedir. Dejar la matriz de la otra sería un número con el apellido equivocado. */
  const primerRender = useRef(true)
  useEffect(() => {
    if (!primerRender.current) {
      setItems([])
      setInventario(null)
      setAviso(null)
      setCargando(true)
    }
    primerRender.current = false
    void cargar()
  }, [cargar])

  const refrescar = async () => {
    setRefrescando(true)
    try {
      await cargar()
    } finally {
      setRefrescando(false)
    }
  }

  const fase: FaseDeCierre | null = useMemo(() => faseDeCierre(inventario), [inventario])
  const enAjuste = puedeAjustar(fase)
  const sePuedeIniciar = puedeIniciarAjuste(fase)

  const noCuadran = useMemo(() => sinCuadrar(items), [items])
  const visibles = filtro === 'sin-cuadrar' ? noCuadran : items

  /** Cuántas rondas tuvo ESTE inventario: no tres fijas — el Auditor abre un 4to o un 5to. */
  const rondas = useMemo(() => items.reduce((max, it) => Math.max(max, it.conteos.length), 0), [items])

  /**
   * EL ID DE LA ÚLTIMA RONDA, no el de la matriz (que es el de la ronda 1 y da
   * 404). `null` = este ítem no llegó a la última ronda: no es ajustable.
   */
  const productoAjustable = enEdicion === null ? null : (ajustables.get(enEdicion.codigo) ?? null)

  const guardarAjuste = async (unidades: number, motivo: string) => {
    if (inventario === null || enEdicion === null || productoAjustable === null) return
    setGuardando(true)
    setErrorDelPanel(null)
    try {
      // El valor va en unidades: `{ empaques: [], sueltas: N }`. Ver `reglas.ts`.
      await ajusteApi.ajustarItem(inventario.inventarioId, productoAjustable, {
        empaques: [],
        sueltas: unidades,
        motivo,
      })
      setEnEdicion(null)
      // Se relee la matriz entera: el ajuste puede cambiar el veredicto del
      // ítem y con él el filtro "Sin cuadrar" y los contadores. Recalcularlo
      // acá sería una segunda copia de la regla.
      await cargar()
    } catch (e) {
      // El mensaje del servidor queda EN EL FORMULARIO, al lado del campo que
      // lo produjo: dice qué regla se topó (ese producto no es de la última
      // ronda, el ajuste ya terminó) y eso es lo accionable.
      setErrorDelPanel(e)
    } finally {
      setGuardando(false)
    }
  }

  const ejecutar = async (cual: 'iniciar' | 'cerrar') => {
    if (inventario === null) return
    setAccion(cual)
    setAviso(null)
    setConfirmarCerrar(false)
    try {
      if (cual === 'iniciar') {
        const r = await ajusteApi.iniciar(inventario.inventarioId)
        setAviso({
          tono: 'ok',
          texto: `Ajuste final iniciado sobre el ${ordinal(r.ronda)} conteo. Desde ahora los valores los cambias tú, comparando contra el stock. El coordinador ya no puede corregir.`,
        })
      } else {
        const r = await ajusteApi.cerrar(inventario.inventarioId)
        setAviso({
          tono: 'ok',
          texto: `Ajuste cerrado. Quedaron firmes ${formatoMiles(r.itemsTotales)} ${pluralizar(r.itemsTotales, 'ítem', 'ítems')}, ${formatoMiles(r.itemsConDiferencia)} con diferencia. El paso que sigue es la liquidación.`,
        })
      }
      await cargar()
    } catch (e) {
      setAviso({
        tono: 'error',
        texto: e instanceof Error ? e.message : 'No se pudo completar. Intenta de nuevo en un momento.',
      })
    } finally {
      setAccion(null)
    }
  }

  const columnas: TableColumnDef<ItemDeLaMatriz>[] = useMemo(() => {
    const numero = (valor: number | null | undefined): string =>
      valor === null || valor === undefined ? SIN_DATO : formatoMiles(valor)

    return [
      {
        id: 'codigo',
        label: 'Código',
        width: 11,
        locked: true,
        sortable: true,
        filter: { type: 'text', value: (i) => i.codigo },
        cellClassName: 'py-1.5 text-xs font-semibold text-[var(--fg)]',
        renderCell: (i) => i.codigo,
        exportValue: (i) => i.codigo,
      },
      {
        id: 'descripcion',
        label: 'Descripción',
        width: 30,
        sortable: true,
        filter: { type: 'text', value: (i) => i.descripcion },
        cellClassName: 'py-1.5 text-xs text-[var(--fg)]',
        renderCell: (i) => i.descripcion,
        exportValue: (i) => i.descripcion,
      },
      {
        // "ERP" y no "Stock": es el nombre con el que el Auditor lo pide. Lleva
        // la ronda del stock cuando no es la primera -- la vara puede ser de
        // otra pasada y de esa resta sale un descuento.
        id: 'erp',
        label: 'ERP',
        width: 11,
        align: 'right',
        sortable: true,
        filter: { type: 'number', value: (i) => i.stockDeLaMedicion.stockErp },
        cellClassName: NUM_CELL_CLASS,
        renderCell: (i) => {
          const m = i.stockDeLaMedicion
          if (m.stockErp === null) return SIN_DATO
          return m.rondaDelStock != null && m.rondaDelStock > 1
            ? `${formatoMiles(m.stockErp)} (${m.rondaDelStock}°)`
            : formatoMiles(m.stockErp)
        },
        exportValue: (i) => i.stockDeLaMedicion.stockErp ?? '',
        exportFormat: 'number',
      },
      // UNA COLUMNA POR RONDA, no tres fijas: el Auditor abre un 4to o un 5to
      // conteo, y ese último es justo el que fijó el número.
      ...Array.from({ length: rondas }, (_, indice) => ({
        id: `ronda-${indice}`,
        label: ordinal(indice + 1),
        width: 8,
        align: 'right' as const,
        sortable: true,
        filter: { type: 'number' as const, value: (i: ItemDeLaMatriz) => i.conteos[indice] ?? null },
        cellClassName: NUM_CELL_CLASS,
        renderCell: (i: ItemDeLaMatriz) => numero(i.conteos[indice]),
        exportValue: (i: ItemDeLaMatriz) => i.conteos[indice] ?? '',
        exportFormat: 'number' as const,
      })),
      {
        id: 'diferencia',
        label: 'Diferencia',
        width: 11,
        align: 'right',
        sortable: true,
        filter: { type: 'number', value: (i) => i.diferenciaUnidades },
        // Sin color por signo: el signo ya lo dice.
        cellClassName: 'py-1.5 text-xs font-semibold text-[var(--fg)] tabular-nums text-right',
        renderCell: (i) => {
          const d = i.diferenciaUnidades
          if (d === null) return SIN_DATO
          if (d === 0) return '0'
          return `${d < 0 ? '-' : '+'}${formatoMiles(Math.abs(d))}`
        },
        exportValue: (i) => i.diferenciaUnidades ?? '',
        exportFormat: 'number',
      },
      {
        id: 'estado',
        label: 'Estado',
        width: 16,
        sortable: true,
        filter: {
          type: 'enum',
          // Las opciones salen de los veredictos que REALMENTE trae este
          // inventario: ofrecer uno que siempre devuelve vacío es ruido.
          options: Array.from(new Set(items.map((i) => ETIQUETA_VEREDICTO[i.veredicto].label))).map((label) => ({
            value: label,
            label,
          })),
          value: (i) => ETIQUETA_VEREDICTO[i.veredicto].label,
        },
        cellClassName: 'py-1.5 text-xs',
        renderCell: (i) => {
          const b = ETIQUETA_VEREDICTO[i.veredicto]
          return (
            <span className="inline-flex min-w-[124px]">
              <StatusBadge status={b.label} label={b.label} variant={b.variant} />
            </span>
          )
        },
        exportValue: (i) => ETIQUETA_VEREDICTO[i.veredicto].label,
      },
    ]
  }, [rondas, items])

  const tableColumns = useTableColumns('ajuste-final', columnas)
  const { filterGetters, filterTypes, sortGetters } = buildQueryGetters(columnas)
  const tableQuery = useTableQuery<ItemDeLaMatriz>({
    rows: visibles,
    filterGetters,
    filterTypes,
    sortGetters,
    persisted: { value: tableColumns.query, onChange: tableColumns.setQuery },
    getQuickFilterText: (i) => `${i.codigo} ${i.descripcion}`,
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

  const nombreSucursal = sucursales.find((s) => s.id === sucursalId)?.nombre ?? sucursalDeSesion?.nombre

  return (
    <div className="space-y-3 md:space-y-0 md:flex md:flex-col md:gap-4 md:h-[calc(100vh_-_var(--app-header-h)_-_1px_-_2*var(--app-content-pad))]">
      <div className="flex items-center justify-between gap-2">
        <ActionGroup
          items={[
            {
              id: 'iniciar',
              label: accion === 'iniciar' ? 'Iniciando...' : 'Empezar el ajuste final',
              icon: <LawIcon size={14} />,
              disabled: !sePuedeIniciar || accion !== null,
              title: sePuedeIniciar
                ? 'A partir de aquí el coordinador ya no puede corregir'
                : 'Se puede con la última ronda cerrada y el ajuste sin empezar',
              onClick: () => void ejecutar('iniciar'),
            },
            {
              id: 'cerrar',
              label: accion === 'cerrar' ? 'Cerrando...' : 'Cerrar el ajuste y fijar los valores',
              icon: <LockIcon size={14} />,
              tone: 'primary',
              disabled: !enAjuste || accion !== null,
              title: enAjuste
                ? 'Los valores quedan firmes y pasan a la liquidación'
                : 'Se puede con el ajuste final en curso',
              onClick: () => setConfirmarCerrar(true),
            },
          ]}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refrescar()}
            disabled={refrescando}
            className="p-[7px] border border-[var(--border)] rounded-md bg-white text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)] disabled:opacity-50 transition-colors"
            title="Volver a leer el inventario"
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

      {aviso !== null && (
        <div
          className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[12px] text-[var(--fg)] ${
            aviso.tono === 'ok'
              ? 'border-[var(--success-border)] bg-[var(--success-light)]'
              : 'border-[var(--warning-border)] bg-[var(--warning-light)]'
          }`}
        >
          <p className="min-w-0 break-words">{aviso.texto}</p>
          <button
            type="button"
            onClick={() => setAviso(null)}
            aria-label="Cerrar el aviso"
            className="ml-auto shrink-0 text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            ✕
          </button>
        </div>
      )}

      <div>
        <h1 className="text-sm md:text-[13px] font-semibold text-[var(--fg)]">
          Ajuste final del conteo
          {nombreSucursal && <span className="ml-2 font-normal text-[var(--fg-muted)]">{nombreSucursal}</span>}
        </h1>
        <p className="text-[12px] text-[var(--fg-muted)]">
          Fija el valor definitivo de cada ítem contra el stock del ERP. Cada cambio pide un motivo y queda registrado
          con tu nombre. Mientras dure el ajuste, el coordinador no puede corregir nada.
        </p>
        {inventario !== null && !cargando && (
          <p className="text-[12px] text-[var(--fg-muted)]">
            Inventario {inventario.inventarioId} · {formatoMiles(items.length)}{' '}
            {pluralizar(items.length, 'ítem', 'ítems')} · {formatoMiles(noCuadran.length)} sin cuadrar
          </p>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <QuickFilterInput value={tableQuery.quickFilter} onChange={tableQuery.setQuickFilter} />
        <SearchableSelect
          options={sucursales.map((s) => ({ value: String(s.id), label: s.nombre }))}
          value={sucursalId === null ? '' : String(sucursalId)}
          onChange={(v) => setSucursalElegida(Number(v))}
          ariaLabel="Sucursal a auditar"
          placeholder="Elige la sucursal"
          className="sm:w-64"
        />
        <SearchableSelect
          options={[
            { value: 'sin-cuadrar', label: `Sin cuadrar (${noCuadran.length})` },
            { value: 'todos', label: `Todos (${items.length})` },
          ]}
          value={filtro}
          onChange={(v) => setFiltro(v as Filtro)}
          ariaLabel="Qué ítems se muestran"
          className="sm:w-56"
          searchThreshold={12}
        />
      </div>

      {sucursalId === null ? (
        <EmptyState title="Elige una sucursal" message="El ajuste es de un inventario, así que hay que elegir de qué tienda." />
      ) : cargando ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner text="Leyendo el inventario..." />
        </div>
      ) : error !== null ? (
        <EmptyState title="No se pudo cargar el ajuste" message={error} action={{ label: 'Volver a intentar', onClick: () => void refrescar() }} />
      ) : inventario === null ? (
        <EmptyState
          title="Esta tienda no tiene inventario abierto"
          message="El ajuste final se hace sobre el inventario en curso. Cuando el coordinador arme las hojas y el ciclo avance, aparece acá."
        />
      ) : !enAjuste ? (
        /*
          NO dice "vuelve a intentar": mientras el ajuste no se inicie esto no
          cambia solo, y una regla de negocio disfrazada de error deja a la
          persona tocando un botón en loop.
        */
        <EmptyState
          title="El ajuste final todavía no empezó"
          message="El ajuste se inicia con la última ronda ya cerrada. Hasta entonces el coordinador todavía puede corregir lo que cargaron los contadores."
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="Este inventario no tiene ítems"
          message="La matriz de auditoría llegó vacía: sin ítems no hay nada que ajustar."
        />
      ) : visibles.length === 0 ? (
        <EmptyState
          title="No queda ningún ítem sin cuadrar"
          message="Todo lo que tiene stock del ERP y conteo coincide. Puedes cerrar el ajuste, o mirar la lista completa."
        />
      ) : (
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
                      onApplyFilter={(filter) => tableQuery.setColumnFilter(column.id, filter)}
                      onClearFilter={() => tableQuery.clearColumnFilter(column.id)}
                    />
                  </GridHeaderCell>
                ))}
                {layout.hasFiller && <th aria-hidden="true" className="p-0" />}
              </tr>
            </thead>
            <tbody>
              {filas.map((item) => (
                <tr
                  // POR CÓDIGO, no por `productoId`: el de un ítem que ninguna
                  // hoja finalizada incluye vale 0, y dos ceros son la misma key.
                  key={item.codigo}
                  onClick={() => {
                    setErrorDelPanel(null)
                    setEnEdicion(item)
                  }}
                  className="cursor-pointer transition-colors hover:bg-[var(--bg-subtle)]"
                >
                  {visibleColumns.map((column) => (
                    <td key={column.id} className={`px-2 md:px-3 truncate ${column.cellClassName ?? ''}`}>
                      {column.renderCell(item)}
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
      )}

      <PanelAjuste
        item={enEdicion}
        ajustable={productoAjustable !== null}
        ultimaRonda={inventario?.rondaActiva ?? null}
        guardando={guardando}
        error={errorDelPanel}
        onGuardar={(unidades, motivo) => void guardarAjuste(unidades, motivo)}
        onCerrar={() => {
          setEnEdicion(null)
          setErrorDelPanel(null)
        }}
      />

      {/*
        CERRAR SE CONFIRMA, iniciar no. No es simetría olvidada: iniciar abre
        una ventana que el propio Auditor controla; cerrar deja los valores
        firmes, se los lleva a liquidación y NO SE PUEDE DESHACER.
      */}
      {confirmarCerrar && (
        <ConfirmDialog
          title="Cerrar el ajuste final"
          message={`Esto deja firmes los ${formatoMiles(items.length)} ${pluralizar(items.length, 'valor', 'valores')} de este inventario: son los que van a la liquidación y al lacrado. Después de esto nadie los cambia, ni tú ni el coordinador. No se puede deshacer.`}
          confirmText="Cerrar el ajuste"
          cancelText="Seguir ajustando"
          isDestructive
          isLoading={accion === 'cerrar'}
          onConfirm={() => void ejecutar('cerrar')}
          onCancel={() => setConfirmarCerrar(false)}
          onClose={() => setConfirmarCerrar(false)}
        />
      )}
    </div>
  )
}
