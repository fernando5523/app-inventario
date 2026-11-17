import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildPredicate, compareValues, normalizeText, type CellValue, type ColumnFilterValue, type FilterType, type SortDirection } from './operators'

export interface SortState {
  columnId: string
  direction: SortDirection
}

/** Minimal shape of a `TableColumnDef` that `buildQueryGetters` needs — kept structural to avoid importing `table-settings/types.ts` (which imports this module). */
export interface QueryColumnLike<Row> {
  id: string
  filter?: { type: FilterType; value?: (row: Row) => CellValue }
  sortValue?: (row: Row) => CellValue
  sortable?: boolean
}

/**
 * Derives `useTableQuery`'s `filterGetters` / `filterTypes` / `sortGetters`
 * straight from a table's `TableColumnDef[]`, so a table only declares
 * `filter` / `sortValue` / `sortable` once on each column and does not also
 * hand-write these maps. A column is sortable when it has its own
 * `sortValue`, or `sortable: true` with a `filter.value` to fall back to.
 */
export function buildQueryGetters<Row>(columns: QueryColumnLike<Row>[]) {
  const filterGetters: Record<string, (row: Row) => CellValue> = {}
  const filterTypes: Record<string, FilterType> = {}
  const sortGetters: Record<string, (row: Row) => CellValue> = {}

  for (const column of columns) {
    if (column.filter?.value) {
      filterGetters[column.id] = column.filter.value
      filterTypes[column.id] = column.filter.type
    }
    const sortGetter = column.sortValue ?? (column.sortable ? column.filter?.value : undefined)
    if (sortGetter) sortGetters[column.id] = sortGetter
  }

  return { filterGetters, filterTypes, sortGetters }
}

export interface UseTableQueryOptions<Row> {
  /** Rows to derive from, for a client-side list. A server-side list can pass `[]` and ignore `rows` on the way out. */
  rows: Row[]
  /** Text the quick filter box matches against (normally the visible text columns, joined). Omit to skip quick filtering. */
  getQuickFilterText?: (row: Row) => string
  /** columnId -> value accessor, for every column that can carry a column filter. */
  filterGetters?: Record<string, (row: Row) => CellValue>
  /** columnId -> filter type, needed to parse/compare that column's values. */
  filterTypes?: Record<string, FilterType>
  /** columnId -> value accessor, for every sortable column. Falls back to `filterGetters[columnId]` when omitted. */
  sortGetters?: Record<string, (row: Row) => CellValue>
  /**
   * Saved state (per user, e.g. `useTableColumns().query` / `.setQuery`): the hook starts from it,
   * adopts it when it arrives late (preferences load after a page reload) and saves every change.
   */
  /**
   * The server filters and sorts (a paginated list): the hook only holds and persists the
   * state, and `rows` are returned untouched.
   */
  serverSide?: boolean
  persisted?: {
    value: { filters?: Record<string, ColumnFilterValue>; sort?: SortState | null; quick?: string } | null
    onChange: (next: { filters?: Record<string, ColumnFilterValue>; sort?: SortState | null; quick?: string }) => void
  }
}

/**
 * Holds the quick filter text, the per-column filters and the single sort
 * column, and derives the filtered + sorted rows for a client-side list.
 *
 * A server-side list ignores the derived `rows` this hook returns and instead
 * reads `quickFilter` / `columnFilters` / `sort` to build its own query — the
 * state management (open/apply/clear a column filter, replace the sort
 * column) is identical either way.
 */
export function useTableQuery<Row>({ rows, getQuickFilterText, filterGetters, filterTypes, sortGetters, persisted, serverSide = false }: UseTableQueryOptions<Row>) {
  const [quickFilter, setQuickFilterState] = useState(persisted?.value?.quick ?? '')
  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilterValue>>(persisted?.value?.filters ?? {})
  const [sort, setSort] = useState<SortState | null>(persisted?.value?.sort ?? null)

  // Saved state that arrives (or changes) after mount wins over the local one, once per change.
  const savedKey = JSON.stringify(persisted?.value ?? null)
  const lastWrittenRef = useRef(savedKey)
  useEffect(() => {
    if (!persisted || savedKey === lastWrittenRef.current) return
    lastWrittenRef.current = savedKey
    const v = persisted.value
    setQuickFilterState(v?.quick ?? '')
    setColumnFilters(v?.filters ?? {})
    setSort(v?.sort ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey])

  // Every local change is saved (the store debounces the PUT to the server).
  const onChangeRef = useRef(persisted?.onChange)
  onChangeRef.current = persisted?.onChange
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (!onChangeRef.current) return
    const next = {
      ...(Object.keys(columnFilters).length ? { filters: columnFilters } : {}),
      ...(sort ? { sort } : {}),
      ...(quickFilter.trim() ? { quick: quickFilter } : {}),
    }
    const key = JSON.stringify(Object.keys(next).length ? next : null)
    if (key === lastWrittenRef.current) return
    lastWrittenRef.current = key
    onChangeRef.current(next)
  }, [quickFilter, columnFilters, sort])

  const setQuickFilter = useCallback((value: string) => setQuickFilterState(value), [])

  const setColumnFilter = useCallback((columnId: string, filter: ColumnFilterValue) => {
    setColumnFilters((prev) => ({ ...prev, [columnId]: filter }))
  }, [])

  const clearColumnFilter = useCallback((columnId: string) => {
    setColumnFilters((prev) => {
      if (!(columnId in prev)) return prev
      const next = { ...prev }
      delete next[columnId]
      return next
    })
  }, [])

  const clearAllColumnFilters = useCallback(() => setColumnFilters({}), [])

  const setSortColumn = useCallback((columnId: string, direction: SortDirection) => {
    setSort({ columnId, direction })
  }, [])

  const clearSort = useCallback(() => setSort(null), [])

  const filteredRows = useMemo(() => {
    const activeFilters = Object.entries(columnFilters)
    const quickNeedle = normalizeText(quickFilter)
    if (serverSide || (!quickNeedle && activeFilters.length === 0)) return rows

    const predicates = activeFilters.map(([columnId, filter]) => {
      const getter = filterGetters?.[columnId]
      return { getter, predicate: buildPredicate(filter) }
    })

    return rows.filter((row) => {
      if (quickNeedle && getQuickFilterText && !normalizeText(getQuickFilterText(row)).includes(quickNeedle)) {
        return false
      }
      for (const { getter, predicate } of predicates) {
        if (!getter) continue
        if (!predicate(getter(row))) return false
      }
      return true
    })
  }, [rows, quickFilter, columnFilters, filterGetters, getQuickFilterText, serverSide])

  const sortedRows = useMemo(() => {
    if (!sort || serverSide) return filteredRows
    const getter = sortGetters?.[sort.columnId] ?? filterGetters?.[sort.columnId]
    if (!getter) return filteredRows
    const type = filterTypes?.[sort.columnId] ?? 'text'
    return [...filteredRows].sort((a, b) => compareValues(getter(a), getter(b), type, sort.direction))
  }, [filteredRows, sort, sortGetters, filterGetters, filterTypes, serverSide])

  return {
    quickFilter,
    setQuickFilter,
    columnFilters,
    setColumnFilter,
    clearColumnFilter,
    clearAllColumnFilters,
    sort,
    setSortColumn,
    clearSort,
    /** Filtered + sorted rows — for a client-side list. Server-side lists read the state above instead. */
    rows: sortedRows,
  }
}
