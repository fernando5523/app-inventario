import { useCallback, useMemo } from 'react'
import { selectTableConfig, useUIStore } from '../../../store/uiStore'
import type { ResolvedColumn, SavedTableQuery, TableColumnDef, TableColumnsConfig } from './types'

interface ColumnMeta {
  id: string
  locked?: boolean
  defaultVisible?: boolean
}

/**
 * Combina las definiciones actuales con lo que el usuario guardó:
 *
 * - Ids guardados que ya no existen se ignoran.
 * - Columnas nuevas (no están en el orden guardado) entran junto a la columna que las
 *   precede en las definiciones (no al final), visibles salvo que su definición diga
 *   `defaultVisible: false`.
 * - Una columna bloqueada siempre queda visible, diga lo que diga lo guardado.
 * - Sin nada guardado: orden y visibilidad de las definiciones.
 */
export function resolveColumnConfig(
  definitions: ColumnMeta[],
  saved: Partial<TableColumnsConfig> | null | undefined
): TableColumnsConfig {
  const known = new Map(definitions.map((d) => [d.id, d]))
  const savedOrder = Array.isArray(saved?.order) ? saved.order : []
  const savedHidden = new Set(Array.isArray(saved?.hidden) ? saved.hidden : [])

  const order: string[] = []
  for (const id of savedOrder) {
    if (known.has(id) && !order.includes(id)) order.push(id)
  }
  const mentioned = new Set(order)
  definitions.forEach((d, i) => {
    if (order.includes(d.id)) return
    const previous = definitions.slice(0, i).reverse().find((p) => order.includes(p.id))
    order.splice(previous ? order.indexOf(previous.id) + 1 : 0, 0, d.id)
  })

  const hidden = order.filter((id) => {
    const def = known.get(id)!
    if (def.locked) return false
    if (!saved || !mentioned.has(id)) return def.defaultVisible === false
    return savedHidden.has(id)
  })

  // Solo anchos de columnas que existen y con un valor razonable (lo guardado viene del servidor).
  const widths: Record<string, number> = {}
  const savedWidths = saved?.widths
  if (savedWidths && typeof savedWidths === 'object' && !Array.isArray(savedWidths)) {
    for (const [id, px] of Object.entries(savedWidths)) {
      if (known.has(id) && typeof px === 'number' && Number.isFinite(px) && px >= MIN_COLUMN_WIDTH && px <= MAX_COLUMN_WIDTH) {
        widths[id] = Math.round(px)
      }
    }
  }

  const query = sanitizeQuery(saved?.query, known)
  return {
    order,
    hidden,
    ...(Object.keys(widths).length ? { widths } : {}),
    ...(query ? { query } : {}),
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Keeps only well-formed filters/sort of columns that still exist (the value comes from the server). */
function sanitizeQuery(raw: unknown, known: Map<string, unknown>): SavedTableQuery | null {
  if (!isObject(raw)) return null
  const out: SavedTableQuery = {}
  if (isObject(raw.filters)) {
    const filters: NonNullable<SavedTableQuery['filters']> = {}
    for (const [id, f] of Object.entries(raw.filters)) {
      if (known.has(id) && isObject(f) && typeof f.type === 'string' && typeof f.operator === 'string') {
        filters[id] = f as unknown as NonNullable<SavedTableQuery['filters']>[string]
      }
    }
    if (Object.keys(filters).length) out.filters = filters
  }
  if (isObject(raw.sort) && typeof raw.sort.columnId === 'string' && known.has(raw.sort.columnId) && (raw.sort.direction === 'asc' || raw.sort.direction === 'desc')) {
    out.sort = { columnId: raw.sort.columnId, direction: raw.sort.direction }
  }
  if (typeof raw.quick === 'string' && raw.quick.trim() && raw.quick.length <= 200) out.quick = raw.quick
  return Object.keys(out).length ? out : null
}

/** Límites del ancho de una columna redimensionada, en px. */
export const MIN_COLUMN_WIDTH = 48
export const MAX_COLUMN_WIDTH = 1200

export function defaultColumnConfig(definitions: ColumnMeta[]): TableColumnsConfig {
  return resolveColumnConfig(definitions, null)
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i])

export interface UseTableColumnsOptions {
  /**
   * Mínimo de columnas visibles (contando las bloqueadas). Con 2, en Productos
   * siempre queda Código y al menos otra: una tabla con solo el código y el menú
   * de acciones no sirve para reconocer ningún producto.
   */
  minVisible?: number
}

/**
 * Orden y visibilidad de las columnas de una tabla, guardados por usuario en sus
 * preferencias de UI (`preferences.tables[tableId]`).
 *
 * Las definiciones pueden rehacerse en cada render (sus `renderCell` cierran sobre
 * el estado de la pantalla): el orden se recalcula solo si cambian los ids.
 */
export function useTableColumns<Row>(
  tableId: string,
  definitions: TableColumnDef<Row>[],
  { minVisible = 2 }: UseTableColumnsOptions = {}
) {
  const saved = useUIStore(useMemo(() => selectTableConfig(tableId), [tableId]))
  const setTableConfig = useUIStore((s) => s.setTableConfig)

  // Los ids son identificadores simples (sin ':' ni '|'); la clave cambia solo si
  // cambian las columnas, no cada vez que se rehacen sus funciones de dibujo.
  const idsKey = definitions.map((d) => `${d.id}:${d.locked ? 1 : 0}:${d.defaultVisible === false ? 0 : 1}`).join('|')
  const metas = useMemo<ColumnMeta[]>(
    () =>
      idsKey
        .split('|')
        .filter(Boolean)
        .map((part) => {
          const [id, locked, visible] = part.split(':')
          return { id, locked: locked === '1', defaultVisible: visible === '1' }
        }),
    [idsKey]
  )

  const config = useMemo(() => resolveColumnConfig(metas, saved), [metas, saved])
  const defaults = useMemo(() => defaultColumnConfig(metas), [metas])
  const hiddenSet = useMemo(() => new Set(config.hidden), [config])

  const byId = new Map(definitions.map((d) => [d.id, d]))
  const visibleColumns = config.order.filter((id) => !hiddenSet.has(id)).map((id) => byId.get(id)!)
  const columns: ResolvedColumn[] = config.order.map((id) => {
    const def = byId.get(id)!
    return { id, label: def.label, visible: !hiddenSet.has(id), locked: Boolean(def.locked) }
  })

  const visibleCount = config.order.length - config.hidden.length

  const persist = useCallback(
    (next: TableColumnsConfig) => setTableConfig(tableId, next),
    [setTableConfig, tableId]
  )

  const canHide = useCallback(
    (id: string) => {
      const def = metas.find((m) => m.id === id)
      return Boolean(def && !def.locked && !hiddenSet.has(id) && visibleCount - 1 >= minVisible)
    },
    [metas, hiddenSet, visibleCount, minVisible]
  )

  const toggle = useCallback(
    (id: string) => {
      if (hiddenSet.has(id)) {
        persist({ ...config, hidden: config.hidden.filter((h) => h !== id) })
      } else if (canHide(id)) {
        persist({ ...config, hidden: [...config.hidden, id] })
      }
    },
    [hiddenSet, canHide, persist, config]
  )

  /** Pone `activeId` en la posición que ocupa `overId`, como un arrastre de dnd-kit. */
  const move = useCallback(
    (activeId: string, overId: string) => {
      const from = config.order.indexOf(activeId)
      const to = config.order.indexOf(overId)
      if (from < 0 || to < 0 || from === to) return
      const order = [...config.order]
      order.splice(to, 0, order.splice(from, 1)[0])
      persist({ ...config, order })
    },
    [config, persist]
  )

  /**
   * Guarda los anchos en px (redimensionar una columna fija también las demás visibles,
   * medidas en ese momento, para que nada salte). `null` en una columna vuelve a su ancho
   * por defecto.
   */
  const setWidths = useCallback(
    (next: Record<string, number | null>) => {
      const widths = { ...(config.widths ?? {}) }
      for (const [id, px] of Object.entries(next)) {
        if (px === null) delete widths[id]
        else widths[id] = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(px)))
      }
      const { widths: _old, ...rest } = config
      persist(Object.keys(widths).length ? { ...rest, widths } : rest)
    },
    [config, persist]
  )

  /** Guarda filtros/orden/filtro rápido junto con el resto de la configuración de la tabla. */
  const setQuery = useCallback(
    (query: SavedTableQuery) => {
      const { query: _old, ...rest } = config
      const empty = !query.filters && !query.sort && !query.quick
      persist(empty ? rest : { ...rest, query })
    },
    [config, persist]
  )

  const reset = useCallback(() => setTableConfig(tableId, null), [setTableConfig, tableId])

  const isDefault =
    sameList(config.order, defaults.order) && sameList(config.hidden, defaults.hidden) && !config.widths

  return {
    /** Todas las columnas en el orden del usuario, con su visibilidad (para el popover). */
    columns,
    /** Definiciones visibles, en orden: lo único que la tabla necesita para dibujarse. */
    visibleColumns,
    isVisible: (id: string) => !hiddenSet.has(id),
    canHide,
    toggle,
    move,
    /** Anchos guardados por el usuario (px), por id de columna. */
    widths: config.widths ?? {},
    setWidths,
    /** Filtros, orden y filtro rápido guardados (o `null`). */
    query: config.query ?? null,
    setQuery,
    reset,
    isDefault,
  }
}
