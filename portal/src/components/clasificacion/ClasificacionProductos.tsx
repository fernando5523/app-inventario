import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HiRefresh } from 'react-icons/hi'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { SearchableSelect } from '../common/SearchableSelect'
import { StatusBadge } from '../common/StatusBadge'
import { TableSettingsButton } from '../common/table-settings/TableSettingsButton'
import { useTableColumns } from '../common/table-settings/useTableColumns'
import type { TableColumnDef } from '../common/table-settings/types'
import { QuickFilterInput } from '../common/table-filters'
import { GridHeaderCell, useColumnDrag, useColumnLayout } from '../common/table-grid'
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus'
import { notifyError } from '../../utils/notifyError'
import { formatoMiles, pluralizar } from '../../utils/formato'
import { clasificacionApi } from './api'
import { PanelExcepcion } from './PanelExcepcion'
import {
  aplicarClasificacion,
  badgeDelAuditor,
  hayMasPorCargar,
  soloConClasificacion,
  textoClase,
  textoResponsableDynamics,
} from './reglas'
import type { ExcepcionAGuardar, ProductoClasificable } from './tipos'

/**
 * ---------------------------------------------------------------------------
 * CLASIFICACIÓN DE PRODUCTOS
 * ---------------------------------------------------------------------------
 * Define si el faltante de cada producto lo asume la empresa, se mide contra
 * el empaque de compra, o se le descuenta entero al personal. Solo la tercera
 * llega al sueldo de alguien, así que esta pantalla decide plata.
 *
 * Es el port de `mobile/components/pantallas/ClasificacionScreen.web.tsx` con
 * sus mismos criterios y sus mismos textos; las reglas se copiaron tal cual a
 * `reglas.ts` (con sus pruebas). Lo único que cambia es la carpintería: la
 * grilla, los selects y el panel lateral son los del portal.
 *
 * LA PREGUNTA QUE RESPONDE —"¿dónde el sistema y yo no coincidimos?"— es la
 * que manda en la forma: dos columnas enfrentadas, lo que hace el sistema y lo
 * que decidió el Auditor. Fundirlas escondería justo dónde no coinciden.
 *
 * ---------------------------------------------------------------------------
 * LA BÚSQUEDA Y EL FILTRO SON DEL SERVIDOR, NO DE LA GRILLA
 * ---------------------------------------------------------------------------
 * El catálogo son ~11.800 códigos y acá entran de a 40. Los filtros por
 * columna y el ordenamiento de `useTableQuery` trabajan sobre las filas que
 * están EN MEMORIA, así que contestarían sobre la página y no sobre el
 * catálogo: "Sin resultados" sería falso con el producto en el servidor. Por
 * eso el buscador manda `q` al backend —que pega contra código, descripción y
 * categoría— y las columnas no abren menú de filtro. Lo que sí queda es
 * elegir, mover y ensanchar columnas, que no afirma nada sobre los datos.
 */

/** Cuántos productos trae cada página. El mismo número que el teléfono. */
const TAMANO_PAGINA = 40

/**
 * CUÁNDO SE APLICA LO QUE SE MARCA ACÁ. Va en el encabezado y no escondido en
 * una ayuda: un inventario ya liquidado no se recalcula, y quien marca un
 * producto esperando arreglar el mes pasado tiene que enterarse antes.
 */
const AVISO_CUANDO_APLICA =
  'Lo que marques aquí cuenta para los inventarios que todavía no se liquidaron. Los ya liquidados no cambian.'

/** El respiro entre tecla y tecla antes de ir al servidor. */
const ESPERA_BUSQUEDA = 350

const HEADER_CELL_CLASS = 'px-2 md:px-3 py-1.5 text-[11px] md:text-xs font-semibold text-[var(--fg-muted)]'

export function ClasificacionProductos() {
  const [q, setQ] = useState('')
  const [soloClasificados, setSoloClasificados] = useState(false)

  const [productos, setProductos] = useState<ProductoClasificable[]>([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [refrescando, setRefrescando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [abierto, setAbierto] = useState<ProductoClasificable | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [errorAlGuardar, setErrorAlGuardar] = useState<unknown>(null)

  const filtroActual = useCallback(
    (desplazamiento: number, limite = TAMANO_PAGINA) => ({
      q: q.trim(),
      soloClasificados,
      limite,
      desplazamiento,
    }),
    [q, soloClasificados],
  )

  /**
   * Cuántos hay cargados, en un ref: `cargar` no puede depender de la lista
   * sin rehacerse en cada carga, y de ahí sale un bucle de pedidos.
   */
  const cargadosRef = useRef(0)
  cargadosRef.current = productos.length

  const cargar = useCallback(async () => {
    setError(null)
    try {
      // Todas las páginas que ya estaban, no solo la primera: quien cargó 120
      // productos y vuelve a la pantalla no puede encontrarse con 40. El tope
      // del servidor son 100 por pedido.
      const cuantos = Math.min(Math.max(TAMANO_PAGINA, cargadosRef.current), 100)
      const pagina = await clasificacionApi.buscar(filtroActual(0, cuantos))
      setProductos(pagina.productos)
      setTotal(pagina.total)
    } catch (e) {
      // Sin esto, un fallo sin red deja el spinner girando para siempre.
      setError(e instanceof Error ? e.message : 'No se pudo cargar el catálogo.')
      notifyError('No se pudo cargar el catálogo', e)
    } finally {
      setCargando(false)
    }
  }, [filtroActual])

  async function cargarMas() {
    if (cargandoMas) return
    setCargandoMas(true)
    try {
      const pagina = await clasificacionApi.buscar(filtroActual(productos.length))
      setProductos((actuales) => [...actuales, ...pagina.productos])
      setTotal(pagina.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron traer más productos.')
      notifyError('No se pudieron traer más productos', e)
    } finally {
      setCargandoMas(false)
    }
  }

  /**
   * Cambió la búsqueda o el filtro: se recarga desde la primera página, con un
   * respiro para no pegarle al backend en cada tecla.
   */
  useEffect(() => {
    const id = setTimeout(() => {
      setCargando(true)
      void cargar()
    }, ESPERA_BUSQUEDA)
    return () => clearTimeout(id)
  }, [cargar])

  // Volver a la ventana relee: la clasificación es por CÓDIGO y cross-tienda,
  // así que otro auditor puede estar tocando la misma fila. Pausado con el
  // panel abierto: un refresco a mitad de tipear borraría el borrador.
  useRefreshOnFocus(() => cargar(), abierto === null && !guardando)

  const refrescar = async () => {
    setRefrescando(true)
    try {
      await cargar()
    } finally {
      setRefrescando(false)
    }
  }

  /**
   * RELEE ESTE PRODUCTO AL ABRIRLO. La copia de la lista puede tener horas, y
   * de ella sale la frase que decide todo ("Hoy va a Unidad; al guardar pasa a
   * Paquete"): con la copia vencida esa frase afirma un "hoy" que ya no es.
   *
   * No bloquea el panel: si falla, se sigue con lo que hay en la lista.
   */
  async function abrir(p: ProductoClasificable) {
    setAbierto(p)
    setErrorAlGuardar(null)
    try {
      // `q` pega contra código, descripción y categoría, así que un código
      // puede traer vecinos: se busca la coincidencia EXACTA.
      const pagina = await clasificacionApi.buscar({ q: p.codigo, soloClasificados: false, limite: 20, desplazamiento: 0 })
      const fresco = pagina.productos.find((x) => x.codigo === p.codigo)
      if (fresco === undefined) return
      setProductos((actuales) => aplicarClasificacion(actuales, p.codigo, fresco.clasificacion))
      // Si ya cerró o abrió otro mientras esto viajaba, no se pisa nada.
      setAbierto((actual) => (actual !== null && actual.codigo === p.codigo ? fresco : actual))
    } catch {
      /* se sigue con la copia de la lista: ver arriba */
    }
  }

  async function guardar(cuerpo: ExcepcionAGuardar) {
    if (abierto === null) return
    setGuardando(true)
    setErrorAlGuardar(null)
    try {
      const clasificacion = await clasificacionApi.clasificar(abierto.codigo, cuerpo)
      // Actualiza SOLO esa fila, sin volver a pedir las ~11.800.
      setProductos((actuales) => aplicarClasificacion(actuales, abierto.codigo, clasificacion))
      setAbierto(null)
    } catch (e) {
      setErrorAlGuardar(e)
    } finally {
      setGuardando(false)
    }
  }

  async function quitar() {
    if (abierto === null) return
    setGuardando(true)
    setErrorAlGuardar(null)
    try {
      await clasificacionApi.desclasificar(abierto.codigo)
      setProductos((actuales) => {
        const actualizada = aplicarClasificacion(actuales, abierto.codigo, null)
        // Bajo "solo clasificados", el que perdió la excepción sale de la lista.
        return soloClasificados ? soloConClasificacion(actualizada) : actualizada
      })
      setAbierto(null)
    } catch (e) {
      setErrorAlGuardar(e)
    } finally {
      setGuardando(false)
    }
  }

  /**
   * LAS CINCO COLUMNAS. La separación entre "lo que hace el sistema" y "tu
   * excepción" es el punto de la pantalla.
   */
  const columnas: TableColumnDef<ProductoClasificable>[] = useMemo(
    () => [
      {
        id: 'codigo',
        label: 'Código',
        width: 12,
        locked: true,
        cellClassName: 'py-1.5 text-xs text-[var(--fg-muted)] tabular-nums',
        renderCell: (p) => p.codigo,
        exportValue: (p) => p.codigo,
      },
      {
        id: 'descripcion',
        label: 'Descripción',
        width: 30,
        cellClassName: 'py-1.5 text-xs font-medium text-[var(--fg)]',
        renderCell: (p) => p.descripcion,
        exportValue: (p) => p.descripcion,
      },
      {
        id: 'categoria',
        label: 'Categoría',
        width: 20,
        cellClassName: 'py-1.5 text-xs text-[var(--fg-muted)]',
        renderCell: (p) => p.categoria ?? 'Sin categoría',
        exportValue: (p) => p.categoria ?? '',
      },
      {
        id: 'sistema',
        label: 'Lo que hace el sistema',
        width: 22,
        cellClassName: 'py-1.5 text-xs text-[var(--fg-muted)]',
        renderCell: (p) => `${textoResponsableDynamics(p.responsableDynamics)} · ${textoClase(p.claseDynamics)}`,
        exportValue: (p) => `${textoResponsableDynamics(p.responsableDynamics)} · ${textoClase(p.claseDynamics)}`,
      },
      {
        id: 'excepcion',
        label: 'Tu excepción',
        width: 22,
        cellClassName: 'py-1.5 text-xs',
        renderCell: (p) => {
          const badge = badgeDelAuditor(p)
          return badge === null ? (
            <span className="text-[var(--fg-subtle)]">Sin excepción</span>
          ) : (
            <StatusBadge status={badge.label} label={badge.label} variant={badge.variant} />
          )
        },
        exportValue: (p) => badgeDelAuditor(p)?.label ?? 'Sin excepción',
      },
    ],
    [],
  )

  const tableColumns = useTableColumns('clasificacion-productos', columnas)
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

  /**
   * EL TOTAL ES EL DEL CATÁLOGO, no el de lo que se trajo. Decir "40 de 40"
   * sobre 11.800 sería el cero que miente de siempre con otro disfraz.
   */
  const cifras = `${formatoMiles(total)} ${
    soloClasificados ? pluralizar(total, 'excepción', 'excepciones') : pluralizar(total, 'producto', 'productos')
  }`

  return (
    <div className="space-y-3 md:space-y-0 md:flex md:flex-col md:gap-4 md:h-[calc(100vh_-_var(--app-header-h)_-_1px_-_2*var(--app-content-pad))]">
      {/* Panel de acciones: esta pantalla NO tiene una acción de página -- se
          clasifica de a un producto, abriendo su fila. A la derecha, [⟳][⚙]. */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => void refrescar()}
          disabled={refrescando || cargando}
          className="p-[7px] border border-[var(--border)] rounded-md bg-white text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)] disabled:opacity-50 transition-colors"
          title="Volver a leer el catálogo"
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

      <div>
        <h1 className="text-sm md:text-[13px] font-semibold text-[var(--fg)]">Clasificación de productos</h1>
        <p className="text-[12px] text-[var(--fg-muted)]">{AVISO_CUANDO_APLICA}</p>
        <p className="text-[12px] text-[var(--fg-muted)]">
          Abre un producto para decidir a qué cuadro va su faltante. Solo el de unidad se le descuenta al personal.
        </p>
      </div>

      {/* El buscador va al servidor (ver el comentario de arriba). Nunca un
          <select> nativo: el filtro es un selector buscable. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <QuickFilterInput value={q} onChange={setQ} />
        <SearchableSelect
          options={[
            { value: 'todos', label: 'Todos los productos' },
            { value: 'clasificados', label: 'Solo los que clasifiqué' },
          ]}
          value={soloClasificados ? 'clasificados' : 'todos'}
          onChange={(v) => setSoloClasificados(v === 'clasificados')}
          className="w-full sm:w-[220px]"
        />
        <p className="text-[12px] text-[var(--fg-muted)] sm:ml-auto">
          {cargando ? cifras : `Mostrando ${formatoMiles(productos.length)} de ${cifras}`}
        </p>
      </div>

      {cargando ? (
        <LoadingSpinner />
      ) : error !== null ? (
        /* SIN RELLENO: si falla, la tabla desaparece y se dice por qué. Una
           lista vacía se leería como "no hay productos", que es falso. */
        <div className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-light)] px-3 py-3">
          <p className="text-[13px] text-[var(--fg)]">{error}</p>
          <button
            type="button"
            className="btn btn-default mt-2"
            onClick={() => {
              setCargando(true)
              void cargar()
            }}
          >
            Reintentar
          </button>
        </div>
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
              <thead className="sticky top-0 z-10">
                <tr className="bg-white border-b border-[var(--border)]">
                  {visibleColumns.map((column) => (
                    <GridHeaderCell
                      key={column.id}
                      column={column}
                      className={HEADER_CELL_CLASS}
                      layout={layout}
                      drag={columnDrag}
                    >
                      {column.label}
                    </GridHeaderCell>
                  ))}
                  {layout.hasFiller && <th aria-hidden="true" className="p-0" />}
                </tr>
              </thead>
              <tbody>
                {productos.map((p) => (
                  <tr
                    key={p.codigo}
                    onClick={() => void abrir(p)}
                    title={`Clasificar ${p.descripcion}`}
                    className="cursor-pointer transition-colors hover:bg-[var(--bg-subtle)]"
                  >
                    {visibleColumns.map((column) => (
                      <td key={column.id} className={`px-2 md:px-3 truncate ${column.cellClassName ?? ''}`}>
                        {column.renderCell(p)}
                      </td>
                    ))}
                    {layout.hasFiller && <td aria-hidden="true" className="p-0" />}
                  </tr>
                ))}
                {productos.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length + (layout.hasFiller ? 1 : 0)} className="py-10 text-center">
                      <p className="text-sm font-medium text-[var(--fg)]">
                        {soloClasificados ? 'Todavía no hay excepciones' : 'Sin resultados'}
                      </p>
                      <p className="text-[12px] text-[var(--fg-muted)]">
                        {soloClasificados
                          ? 'Cuando marques un producto como empresa, paquete o unidad, va a aparecer aquí.'
                          : 'Prueba con otro código, descripción o categoría.'}
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Tarjetas en móvil: cinco columnas no entran en un teléfono. */}
          <div className="md:hidden space-y-2">
            {productos.map((p) => {
              const badge = badgeDelAuditor(p)
              return (
                <button
                  key={p.codigo}
                  type="button"
                  onClick={() => void abrir(p)}
                  className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-left"
                >
                  <p className="text-sm font-medium text-[var(--fg)]">{p.descripcion}</p>
                  <p className="text-[11px] text-[var(--fg-muted)] tabular-nums">
                    {p.codigo}
                    {p.categoria ? ` · ${p.categoria}` : ''}
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--fg-muted)]">
                    El sistema: {textoResponsableDynamics(p.responsableDynamics)} · {textoClase(p.claseDynamics)}
                  </p>
                  <div className="mt-1">
                    {badge === null ? (
                      <span className="text-[12px] text-[var(--fg-subtle)]">Sin excepción</span>
                    ) : (
                      <StatusBadge status={badge.label} label={badge.label} variant={badge.variant} />
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/*
            "CARGAR MÁS" TRAE DEL SERVIDOR las que todavía no llegaron. Sin
            esto, 40 productos serían el techo de la pantalla sobre un catálogo
            de ~11.800.
          */}
          {hayMasPorCargar(productos.length, total) && (
            <div className="flex justify-center">
              <button type="button" className="btn btn-default" disabled={cargandoMas} onClick={() => void cargarMas()}>
                {cargandoMas ? 'Trayendo...' : 'Cargar más'}
              </button>
            </div>
          )}
        </>
      )}

      <PanelExcepcion
        producto={abierto}
        guardando={guardando}
        error={errorAlGuardar}
        onDescartarError={() => setErrorAlGuardar(null)}
        onGuardar={(cuerpo) => void guardar(cuerpo)}
        onQuitar={() => void quitar()}
        onCerrar={() => {
          setAbierto(null)
          setErrorAlGuardar(null)
        }}
      />
    </div>
  )
}
