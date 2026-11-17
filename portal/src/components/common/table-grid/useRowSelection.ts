import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'

/**
 * Row selection for a grid, D365 style:
 * - the row's circle toggles that row (multi-select),
 * - a plain click on the row selects only that row,
 * - Ctrl/Cmd + click toggles the row, Shift + click selects the range from the anchor,
 * - the header circle selects / clears every visible row.
 * Selection is pruned to the rows currently shown, so a filter never leaves hidden rows selected.
 */
export function useRowSelection<Row>(rows: Row[], getId: (row: Row) => string) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const anchorRef = useRef<string | null>(null)
  const getIdRef = useRef(getId)
  getIdRef.current = getId

  const ids = useMemo(() => rows.map((row) => getIdRef.current(row)), [rows])
  const idsKey = ids.join('|')

  useEffect(() => {
    const visible = new Set(ids)
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
    setActiveId((prev) => (prev && visible.has(prev) ? prev : null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    anchorRef.current = id
    setActiveId(id)
  }, [])

  const selectRange = useCallback(
    (id: string) => {
      const anchor = anchorRef.current ?? id
      const from = ids.indexOf(anchor)
      const to = ids.indexOf(id)
      if (from < 0 || to < 0) return
      const [start, end] = from <= to ? [from, to] : [to, from]
      setSelected(new Set(ids.slice(start, end + 1)))
      setActiveId(id)
    },
    [ids]
  )

  /** Row click handler: plain = only this row, Ctrl/Cmd = toggle, Shift = range. */
  const onRowClick = useCallback(
    (id: string, event: MouseEvent) => {
      if (event.shiftKey) {
        // Shift+click would also extend a text selection; the row range is what the user wants.
        window.getSelection()?.removeAllRanges()
        selectRange(id)
      } else if (event.ctrlKey || event.metaKey) {
        toggle(id)
      } else {
        // A plain click that ends a text-selection drag keeps the selected text (copy) instead.
        if (window.getSelection()?.toString()) return
        setSelected(new Set([id]))
        anchorRef.current = id
        setActiveId(id)
      }
    },
    [selectRange, toggle]
  )

  /** Stops Shift+mousedown from starting a text selection across the rows. */
  const onRowMouseDown = useCallback((event: MouseEvent) => {
    if (event.shiftKey) event.preventDefault()
  }, [])

  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id))
  const someSelected = !allSelected && ids.some((id) => selected.has(id))

  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(ids))
  }, [allSelected, ids])

  /** Right-click on a row outside the selection marks only that row (D365). */
  const selectIfNotSelected = useCallback((id: string) => {
    setSelected((prev) => (prev.has(id) ? prev : new Set([id])))
    anchorRef.current = id
    setActiveId(id)
  }, [])

  const clear = useCallback(() => {
    setSelected(new Set())
    setActiveId(null)
  }, [])

  return {
    selectedIds: selected,
    count: selected.size,
    isSelected: (id: string) => selected.has(id),
    isActive: (id: string) => activeId === id,
    toggle,
    onRowClick,
    onRowMouseDown,
    toggleAll,
    selectIfNotSelected,
    allSelected,
    someSelected,
    clear,
  }
}
