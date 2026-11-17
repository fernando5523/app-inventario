import { useCallback, useEffect, useMemo, useState } from 'react'
import { HiRefresh } from 'react-icons/hi'
import { CheckCircleIcon, KeyIcon, PencilIcon, PersonAddIcon, StopIcon, TrashIcon } from '@primer/octicons-react'
import { ActionGroup } from '../common/ActionGroup'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { EmptyState } from '../common/EmptyState'
import { LoadingSpinner } from '../common/LoadingSpinner'
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
import {
  GridHeaderCell,
  RowSelectCell,
  SELECTION_COLUMN_WIDTH,
  SelectAllHeaderCell,
  useColumnDrag,
  useColumnLayout,
  useRowSelection,
} from '../common/table-grid'
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus'
import { useAuthStore } from '../../store/authStore'
import { notifyError } from '../../utils/notifyError'
import { DialogoResetearPin } from './DialogoResetearPin'
import { FormularioCuenta } from './FormularioCuenta'
import { usuariosApi } from './usuariosApi'
import {
  NOMBRE_ROL,
  ORDEN_DE_ROLES,
  estadoDeCuenta,
  motivoSinEliminar,
  motivoSinGestion,
  motivoSinSeleccion,
  resumenDeCuentas,
  textoDeAlcance,
} from './usuariosReglas'
import type { Actor, SucursalElegible, UsuarioDto } from './usuariosTipos'

/**
 * ---------------------------------------------------------------------------
 * USUARIOS DE MI SUCURSAL
 * ---------------------------------------------------------------------------
 * Las cuentas con las que la gente entra a contar. Quién puede crear a quién
 * es el corazón de la pantalla y NO lo decide ella: lo decide
 * `backend/src/modules/usuarios/usuarios.permisos.ts`. Un auditor crea
 * coordinador y conteo, y solo de su propia sucursal; nunca otro auditor ni un
 * administrador.
 *
 * LA PANTALLA NO AUTORIZA, SOLO EVITA OFRECER. Cada acción apagada dice POR
 * QUÉ en su tooltip (`motivoSinGestion`), que es la diferencia entre "no se
 * puede" y "no entiendo qué pasa". Si igual llega un 403 —porque la sesión
 * cambió de rol, o porque la regla del servidor es más estricta—, se muestra
 * el mensaje del servidor tal cual.
 *
 * EL PIN NO SE VE NUNCA. Se guarda con argon2, que no se puede revertir, así
 * que no existe "ver el PIN": existe ponerle uno nuevo. Está dicho con esas
 * palabras en el alta y en el diálogo de reseteo, porque es justo lo que la
 * gente pregunta.
 *
 * La lista entera entra en una tanda (una tienda tiene unas pocas cuentas, la
 * cadena unas decenas), así que acá el filtro por columna y el orden de la
 * grilla SÍ trabajan sobre todas las filas, no sobre una página.
 */

const HEADER_CELL_CLASS = 'px-2 md:px-3 py-1.5 text-[11px] md:text-xs font-semibold text-[var(--fg-muted)]'

/** Fecha corta, sin hora: cuándo se dio de alta la cuenta. */
function fechaCorta(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? '—' : fecha.toLocaleDateString('es-PE')
}

export function UsuariosDeMiSucursal() {
  const { colaborador, sucursal } = useAuthStore()

  const [cuentas, setCuentas] = useState<UsuarioDto[]>([])
  const [sucursales, setSucursales] = useState<SucursalElegible[]>([])
  const [cargando, setCargando] = useState(true)
  const [refrescando, setRefrescando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** `null` = ningún formulario abierto. `'alta'` o la cuenta que se edita. */
  const [formulario, setFormulario] = useState<'alta' | UsuarioDto | null>(null)
  const [reseteando, setReseteando] = useState<UsuarioDto | null>(null)
  const [porEliminar, setPorEliminar] = useState<UsuarioDto | null>(null)
  const [porCambiarEstado, setPorCambiarEstado] = useState<UsuarioDto | null>(null)
  const [ejecutando, setEjecutando] = useState(false)

  const actor: Actor | null = useMemo(
    () =>
      colaborador === null
        ? null
        : { id: colaborador.id, rol: colaborador.rol, sucursalId: sucursal?.id ?? null },
    [colaborador, sucursal],
  )

  const esAdministrador = actor?.rol === 'administrador'

  const cargar = useCallback(async () => {
    try {
      // El auditor no manda sucursal: el servidor le devuelve la suya igual.
      setCuentas(await usuariosApi.listar())
      setError(null)
    } catch (e) {
      /**
       * SIN RELLENO: si falla, la tabla desaparece y se dice por qué. Una lista
       * vacía se leería como "esta tienda no tiene cuentas", que sobre una
       * tienda que sí las tiene es peor que un error.
       */
      setCuentas([])
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las cuentas.')
      notifyError('No se pudieron cargar las cuentas', e)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Solo el administrador elige sucursal al crear; el auditor crea para la
  // suya, así que no se le pide la lista.
  useEffect(() => {
    if (!esAdministrador) return
    usuariosApi
      .sucursales()
      .then(setSucursales)
      .catch((e) => notifyError('No se pudieron cargar las sucursales', e))
  }, [esAdministrador])

  // Volver a la ventana relee: otro administrador puede haber dado de alta a
  // alguien. Pausado con un formulario abierto, para no pisar lo tecleado.
  useRefreshOnFocus(cargar, formulario === null && reseteando === null && !ejecutando)

  const refrescar = async () => {
    setRefrescando(true)
    try {
      await cargar()
    } finally {
      setRefrescando(false)
    }
  }

  const columnas: TableColumnDef<UsuarioDto>[] = useMemo(
    () => [
      {
        id: 'nombre',
        label: 'Nombre',
        width: 26,
        locked: true,
        sortable: true,
        filter: { type: 'text', value: (c) => c.nombre },
        cellClassName: 'py-1.5 text-xs font-medium text-[var(--fg)]',
        renderCell: (c) => c.nombre,
        exportValue: (c) => c.nombre,
      },
      {
        id: 'dni',
        label: 'Documento',
        width: 14,
        sortable: true,
        filter: { type: 'text', value: (c) => c.dni },
        cellClassName: 'py-1.5 text-xs text-[var(--fg-muted)] tabular-nums',
        renderCell: (c) => c.dni,
        exportValue: (c) => c.dni,
      },
      {
        id: 'rol',
        label: 'Rol',
        width: 16,
        sortable: true,
        filter: {
          type: 'enum',
          options: ORDEN_DE_ROLES.map((r) => ({ value: NOMBRE_ROL[r], label: NOMBRE_ROL[r] })),
          value: (c) => NOMBRE_ROL[c.rol],
        },
        cellClassName: 'py-1.5 text-xs text-[var(--fg)]',
        renderCell: (c) => NOMBRE_ROL[c.rol],
        exportValue: (c) => NOMBRE_ROL[c.rol],
      },
      {
        id: 'sucursal',
        label: 'Tienda',
        width: 20,
        sortable: true,
        // Para el auditor son TODAS la suya, así que la columna no distingue
        // nada: se puede prender desde la configuración de tabla si hace falta.
        defaultVisible: esAdministrador,
        filter: { type: 'text', value: (c) => nombreDeTienda(c, sucursales) },
        cellClassName: 'py-1.5 text-xs text-[var(--fg-muted)]',
        renderCell: (c) => nombreDeTienda(c, sucursales),
        exportValue: (c) => nombreDeTienda(c, sucursales),
      },
      {
        id: 'estado',
        label: 'Estado',
        width: 14,
        sortable: true,
        filter: {
          type: 'enum',
          options: [
            { value: 'Habilitada', label: 'Habilitada' },
            { value: 'Deshabilitada', label: 'Deshabilitada' },
          ],
          value: (c) => estadoDeCuenta(c.activo).label,
        },
        cellClassName: 'py-1.5 text-xs',
        renderCell: (c) => {
          const estado = estadoDeCuenta(c.activo)
          return <StatusBadge status={estado.label} label={estado.label} variant={estado.variant} />
        },
        exportValue: (c) => estadoDeCuenta(c.activo).label,
      },
      {
        id: 'creada',
        label: 'Dada de alta',
        width: 14,
        sortable: true,
        defaultVisible: false,
        filter: { type: 'text', value: (c) => fechaCorta(c.createdAt) },
        cellClassName: 'py-1.5 text-xs text-[var(--fg-muted)] tabular-nums',
        renderCell: (c) => fechaCorta(c.createdAt),
        exportValue: (c) => fechaCorta(c.createdAt),
      },
    ],
    [esAdministrador, sucursales],
  )

  const tableColumns = useTableColumns('usuarios-sucursal', columnas)
  const { filterGetters, filterTypes, sortGetters } = buildQueryGetters(columnas)
  const tableQuery = useTableQuery<UsuarioDto>({
    rows: cuentas,
    filterGetters,
    filterTypes,
    sortGetters,
    persisted: { value: tableColumns.query, onChange: tableColumns.setQuery },
    getQuickFilterText: (c) => `${c.nombre} ${c.dni} ${NOMBRE_ROL[c.rol]}`,
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
  const selection = useRowSelection(filas, (c) => String(c.id))
  const hayFiltros = tableQuery.quickFilter !== '' || Object.keys(tableQuery.columnFilters).length > 0
  const limpiarFiltros = () => {
    tableQuery.clearAllColumnFilters()
    tableQuery.setQuickFilter('')
  }

  /** La única cuenta seleccionada, o `null` si hay cero o más de una. */
  const elegida = useMemo(() => {
    const ids = [...selection.selectedIds]
    if (ids.length !== 1) return null
    return cuentas.find((c) => String(c.id) === ids[0]) ?? null
  }, [selection.selectedIds, cuentas])

  /**
   * POR QUÉ CADA ACCIÓN ESTÁ APAGADA, en su propio tooltip: primero porque no
   * hay una sola cuenta elegida, y después porque esa cuenta está fuera de lo
   * que este rol gestiona. Un botón gris sin motivo manda a adivinar.
   */
  const sinSeleccion = motivoSinSeleccion(selection.count)
  const motivoGestion = actor && elegida ? motivoSinGestion(actor, elegida) : null
  const motivoEliminar = actor && elegida ? motivoSinEliminar(actor, elegida) : null
  const noGestiona = sinSeleccion ?? motivoGestion
  const noElimina = sinSeleccion ?? motivoEliminar

  async function cambiarEstado(cuenta: UsuarioDto) {
    setEjecutando(true)
    try {
      const actualizada = await usuariosApi.cambiarEstado(cuenta.id, !cuenta.activo)
      setCuentas((actuales) => actuales.map((c) => (c.id === actualizada.id ? actualizada : c)))
      setPorCambiarEstado(null)
    } catch (e) {
      notifyError(cuenta.activo ? 'No se pudo deshabilitar la cuenta' : 'No se pudo habilitar la cuenta', e)
    } finally {
      setEjecutando(false)
    }
  }

  async function eliminar(cuenta: UsuarioDto) {
    setEjecutando(true)
    try {
      await usuariosApi.eliminar(cuenta.id)
      setCuentas((actuales) => actuales.filter((c) => c.id !== cuenta.id))
      setPorEliminar(null)
    } catch (e) {
      notifyError('No se pudo eliminar la cuenta', e)
    } finally {
      setEjecutando(false)
    }
  }

  function guardada(cuenta: UsuarioDto) {
    setCuentas((actuales) =>
      actuales.some((c) => c.id === cuenta.id)
        ? actuales.map((c) => (c.id === cuenta.id ? cuenta : c))
        : [...actuales, cuenta],
    )
    setFormulario(null)
  }

  if (actor === null) return <LoadingSpinner />

  return (
    <div className="space-y-3 md:space-y-0 md:flex md:flex-col md:gap-4 md:h-[calc(100vh_-_var(--app-header-h)_-_1px_-_2*var(--app-content-pad))]">
      {/* Panel de acciones (D365): las de la cuenta a la izquierda, [⟳][⚙] a la derecha. */}
      <div className="flex items-center justify-between gap-2">
        <ActionGroup
          label="Acciones sobre las cuentas"
          items={[
            {
              id: 'nueva',
              label: 'Nueva cuenta',
              icon: <PersonAddIcon size={14} />,
              tone: 'primary',
              title: textoDeAlcance(actor.rol),
              onClick: () => setFormulario('alta'),
            },
            {
              id: 'editar',
              label: 'Editar',
              icon: <PencilIcon size={14} />,
              disabled: noGestiona !== null,
              title: noGestiona ?? 'Cambia el nombre, el documento o el rol',
              onClick: () => elegida && setFormulario(elegida),
            },
            {
              id: 'estado',
              label: elegida?.activo === false ? 'Habilitar' : 'Deshabilitar',
              icon: elegida?.activo === false ? <CheckCircleIcon size={14} /> : <StopIcon size={14} />,
              disabled: noGestiona !== null,
              title:
                noGestiona ??
                (elegida?.activo === false
                  ? 'Vuelve a dejarla entrar a la app'
                  : 'Deja de poder entrar, sin borrar lo que ya contó'),
              onClick: () => elegida && setPorCambiarEstado(elegida),
            },
            {
              id: 'pin',
              label: 'Poner un PIN nuevo',
              icon: <KeyIcon size={14} />,
              disabled: noGestiona !== null,
              title: noGestiona ?? 'El PIN no se puede ver, solo reemplazar',
              onClick: () => elegida && setReseteando(elegida),
            },
            {
              id: 'eliminar',
              label: 'Eliminar',
              icon: <TrashIcon size={14} />,
              tone: 'danger',
              disabled: noElimina !== null,
              title: noElimina ?? 'Borra la cuenta del padrón',
              onClick: () => elegida && setPorEliminar(elegida),
            },
          ]}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refrescar()}
            disabled={refrescando || cargando}
            className="p-[7px] border border-[var(--border)] rounded-md bg-white text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)] disabled:opacity-50 transition-colors"
            title="Volver a leer las cuentas"
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
          Usuarios de mi sucursal
          {sucursal && <span className="ml-2 font-normal text-[var(--fg-muted)]">{sucursal.nombre}</span>}
        </h1>
        {!cargando && error === null && (
          <p className="text-[12px] text-[var(--fg-muted)]">{resumenDeCuentas(cuentas)}</p>
        )}
        <p className="text-[12px] text-[var(--fg-muted)]">{textoDeAlcance(actor.rol)}</p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <QuickFilterInput value={tableQuery.quickFilter} onChange={tableQuery.setQuickFilter} />
      </div>

      {cargando ? (
        <LoadingSpinner />
      ) : error !== null ? (
        <EmptyState title="No se pudieron cargar las cuentas" message={error} />
      ) : cuentas.length === 0 ? (
        <EmptyState
          title="Todavía no hay cuentas"
          message="Crea la primera con «Nueva cuenta»: cada persona que cuenta entra con la suya, y es la que firma lo que carga."
        />
      ) : (
        <>
          <div className="hidden md:block md:flex-1 md:min-h-0 border border-[var(--border)] rounded-md overflow-auto">
            <table ref={layout.tableRef} className={`${layout.tableClass} text-sm`} style={layout.tableStyle}>
              <colgroup>
                <col style={{ width: `${SELECTION_COLUMN_WIDTH}px` }} />
                {visibleColumns.map((column) => (
                  <col key={column.id} style={layout.colStyle(column)} />
                ))}
                {layout.hasFiller && <col />}
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="bg-white border-b border-[var(--border)]">
                  <SelectAllHeaderCell
                    allSelected={selection.allSelected}
                    someSelected={selection.someSelected}
                    onToggleAll={selection.toggleAll}
                  />
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
                {filas.map((cuenta) => (
                  <tr
                    key={cuenta.id}
                    aria-selected={selection.isSelected(String(cuenta.id))}
                    onClick={(e) => selection.onRowClick(String(cuenta.id), e)}
                    onMouseDown={selection.onRowMouseDown}
                    className={`transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)] ${
                      selection.isSelected(String(cuenta.id)) ? 'bg-[var(--bg-rail)]' : 'hover:bg-[var(--bg-subtle)]'
                    } ${selection.isActive(String(cuenta.id)) ? 'shadow-[inset_3px_0_0_var(--focus)]' : ''}`}
                  >
                    <RowSelectCell
                      selected={selection.isSelected(String(cuenta.id))}
                      label={cuenta.nombre}
                      onToggle={() => selection.toggle(String(cuenta.id))}
                    />
                    {visibleColumns.map((column) => (
                      <td key={column.id} className={`px-2 md:px-3 truncate ${column.cellClassName ?? ''}`}>
                        {column.renderCell(cuenta)}
                      </td>
                    ))}
                    {layout.hasFiller && <td aria-hidden="true" className="p-0" />}
                  </tr>
                ))}
                {filas.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length + 1 + (layout.hasFiller ? 1 : 0)} className="py-10 text-center">
                      <NoFilterMatches onClear={limpiarFiltros} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Tarjetas en móvil. La fila se toca para elegirla: las acciones
              siguen siendo las de la barra, que es donde están sus motivos. */}
          <div className="md:hidden space-y-2">
            {filas.length === 0 && hayFiltros && <NoFilterMatches onClear={limpiarFiltros} />}
            {filas.map((cuenta) => {
              const estado = estadoDeCuenta(cuenta.activo)
              const seleccionada = selection.isSelected(String(cuenta.id))
              return (
                <button
                  key={cuenta.id}
                  type="button"
                  aria-pressed={seleccionada}
                  onClick={() => selection.toggle(String(cuenta.id))}
                  className={`w-full rounded-md border px-3 py-2 text-left ${
                    seleccionada ? 'border-[var(--focus)] bg-[var(--bg-rail)]' : 'border-[var(--border)] bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--fg)]">{cuenta.nombre}</p>
                      <p className="text-[11px] text-[var(--fg-muted)] tabular-nums">
                        {cuenta.dni} · {NOMBRE_ROL[cuenta.rol]}
                      </p>
                    </div>
                    <StatusBadge status={estado.label} label={estado.label} variant={estado.variant} />
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}

      {formulario !== null && (
        <FormularioCuenta
          actor={actor}
          cuenta={formulario === 'alta' ? null : formulario}
          sucursalDeSesion={sucursal ? { id: sucursal.id, nombre: sucursal.nombre } : null}
          sucursales={sucursales}
          onGuardada={guardada}
          onCerrar={() => setFormulario(null)}
        />
      )}

      {reseteando !== null && (
        <DialogoResetearPin
          cuenta={reseteando}
          onListo={() => setReseteando(null)}
          onCerrar={() => setReseteando(null)}
        />
      )}

      {/*
        DESHABILITAR NO ES BORRAR, y la confirmación lo dice: lo que ya contó
        esa persona sigue donde está. Es la acción reversible, y por eso es la
        que hay que ofrecer antes que eliminar.
      */}
      {porCambiarEstado !== null && (
        <ConfirmDialog
          isOpen
          title={porCambiarEstado.activo ? 'Deshabilitar la cuenta' : 'Habilitar la cuenta'}
          message={
            porCambiarEstado.activo
              ? `${porCambiarEstado.nombre} deja de poder entrar a la app, y su sesión abierta deja de servir en el siguiente pedido. Lo que ya contó no se toca, y la cuenta se puede volver a habilitar.`
              : `${porCambiarEstado.nombre} vuelve a poder entrar a la app con su PIN de siempre.`
          }
          confirmText={porCambiarEstado.activo ? 'Deshabilitar' : 'Habilitar'}
          isDestructive={porCambiarEstado.activo}
          isLoading={ejecutando}
          onConfirm={() => void cambiarEstado(porCambiarEstado)}
          onCancel={() => setPorCambiarEstado(null)}
          onClose={() => setPorCambiarEstado(null)}
        />
      )}

      {/*
        ELIMINAR NOMBRA LA CONSECUENCIA Y LA ALTERNATIVA. El servidor rechaza
        borrar una cuenta que ya cargó conteos (quedaría un conteo sin autor),
        así que deshabilitar es casi siempre lo que se quiere: se dice acá y no
        después del error.
      */}
      {porEliminar !== null && (
        <ConfirmDialog
          isOpen
          title="Eliminar la cuenta"
          message={`Se borra la cuenta de ${porEliminar.nombre} del padrón. Si ya cargó conteos no se va a poder: en ese caso, deshabilítala, que deja de entrar y conserva lo que contó.`}
          confirmText="Eliminar"
          variant="destructive"
          isDestructive
          isLoading={ejecutando}
          onConfirm={() => void eliminar(porEliminar)}
          onCancel={() => setPorEliminar(null)}
          onClose={() => setPorEliminar(null)}
        />
      )}
    </div>
  )
}

/**
 * El nombre de la tienda de una cuenta. `null` es del ADMINISTRADOR, que no
 * pertenece a ninguna: se dice así y no con un guion, que se leería como un
 * dato que falta.
 */
function nombreDeTienda(cuenta: UsuarioDto, sucursales: SucursalElegible[]): string {
  if (cuenta.sucursalId === null) return 'Todas (sistema)'
  return sucursales.find((s) => s.id === cuenta.sucursalId)?.nombre ?? `Tienda ${cuenta.sucursalId}`
}
