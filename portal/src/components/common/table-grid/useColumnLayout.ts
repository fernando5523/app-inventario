import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from '../table-settings/useTableColumns'

interface LayoutColumn {
  id: string
  /** Weight; only used for a column that has neither a saved nor a measured width. */
  width: number
}

interface UseColumnLayoutOptions {
  visibleColumns: LayoutColumn[]
  /** Saved px widths (from `useTableColumns().widths`). */
  widths: Record<string, number>
  /** Persists px widths (`null` resets a column). */
  setWidths: (next: Record<string, number | null>) => void
  /** Fixed px column(s) before the configurable ones (e.g. the selection circle). */
  leadingPx?: number
  /** The rows are on screen (measuring an empty, still-loading table would fit only the headers). */
  ready?: boolean
}

const clamp = (px: number) => Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(px)))
/** A fitted column never starts wider than this; longer text ends in "…" until the user widens it. */
const AUTO_FIT_MAX = 400
const fallbackPx = (column: LayoutColumn) => Math.round(column.width * 10)

/**
 * Column widths for a configurable table, D365 style.
 *
 * By default every column fits its content: the table is drawn once with its natural
 * width (headers and loaded cells), measured before paint, and frozen in px; spare space
 * stays on the right, taken by a filler column so the header line reaches the card edge.
 * A resize saves the px widths of every visible column (nothing jumps) in the user's
 * preferences, and those win over the fitted ones from then on.
 */
export function useColumnLayout({ visibleColumns, widths, setWidths, leadingPx = 0, ready = true }: UseColumnLayoutOptions) {
  // Widths while a drag is in progress: rendered live, persisted once on release.
  const [live, setLive] = useState<Record<string, number> | null>(null)
  const liveRef = useRef<Record<string, number> | null>(null)
  // A callback ref, so the fit also runs for a table that mounts after the rows are ready (an
  // empty list shows an EmptyState instead of the table; a line grid may appear with its first line).
  const [tableEl, setTableEl] = useState<HTMLTableElement | null>(null)
  const tableRef = useCallback((el: HTMLTableElement | null) => setTableEl(el), [])

  const columnsKey = visibleColumns.map((column) => column.id).join('|')
  const [fitted, setFitted] = useState<{ key: string; widths: Record<string, number> } | null>(null)
  const autoWidths = fitted?.key === columnsKey ? fitted.widths : null
  const hasSaved = Object.keys(widths).length > 0
  const measuring = !live && !hasSaved && !autoWidths

  useLayoutEffect(() => {
    if (!measuring || !ready || !tableEl) return
    const measured: Record<string, number> = {}
    tableEl.querySelectorAll<HTMLElement>('thead th[data-column-id]').forEach((th) => {
      // The header label may shrink (it truncates inside its button), so add what it lacks
      // to show in full: a fitted column never cuts its own header.
      const label = th.querySelector<HTMLElement>('.truncate')
      const labelMissing = label ? Math.max(0, label.scrollWidth - label.clientWidth) : 0
      measured[th.dataset.columnId!] = Math.min(AUTO_FIT_MAX, clamp(th.getBoundingClientRect().width + labelMissing + 2))
    })
    setFitted({ key: columnsKey, widths: measured })
    // Measured while a web font face was still loading (the semibold headers are a separate
    // file): the text grows when it arrives and the header would end in "…". Fit again then.
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    if (fonts && fonts.status === 'loading') {
      fonts.ready.then(() => setFitted((current) => (current?.key === columnsKey ? null : current)))
    }
  }, [measuring, ready, columnsKey, tableEl])

  const widthPx = (column: LayoutColumn) =>
    live?.[column.id] ?? widths[column.id] ?? autoWidths?.[column.id] ?? fallbackPx(column)

  const colStyle = (column: LayoutColumn): CSSProperties => (measuring ? {} : { width: `${widthPx(column)}px` })

  const tableStyle: CSSProperties | undefined = measuring
    ? undefined
    : { width: `${leadingPx + visibleColumns.reduce((sum, column) => sum + widthPx(column), 0)}px`, minWidth: '100%' }
  /** Natural (shrink-to-fit) layout while measuring, fixed px widths afterwards. */
  const tableClass = measuring ? 'table-auto w-auto' : 'table-fixed'

  /** Current rendered width of every visible header of the row that holds `el`. */
  const measure = (el: Element): Record<string, number> => {
    const row = el.closest('tr')
    const measured: Record<string, number> = {}
    row?.querySelectorAll<HTMLElement>('th[data-column-id]').forEach((th) => {
      measured[th.dataset.columnId!] = clamp(th.getBoundingClientRect().width)
    })
    return measured
  }

  const startResize = useCallback(
    (columnId: string, event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const start = measure(event.currentTarget)
      const startX = event.clientX
      const startWidth = start[columnId] ?? MIN_COLUMN_WIDTH
      liveRef.current = start
      setLive(start)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMove = (e: PointerEvent) => {
        const next = { ...liveRef.current!, [columnId]: clamp(startWidth + e.clientX - startX) }
        liveRef.current = next
        setLive(next)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        const final = liveRef.current
        liveRef.current = null
        setLive(null)
        if (final) setWidths(final)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setWidths]
  )

  /** Keyboard resize (Arrow keys on the separator): same measuring rule as the drag. */
  const resizeBy = useCallback(
    (columnId: string, delta: number, el: Element) => {
      const start = measure(el)
      setWidths({ ...start, [columnId]: clamp((start[columnId] ?? MIN_COLUMN_WIDTH) + delta) })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setWidths]
  )

  /** Double click on the border: back to the fitted width of that column. */
  const resetWidth = useCallback((columnId: string) => setWidths({ [columnId]: null }), [setWidths])

  return {
    tableRef,
    colStyle,
    tableStyle,
    tableClass,
    /** Render a trailing `<col/>`, `<th/>` and `<td/>` without width (see `tableStyle`). */
    hasFiller: !measuring,
    startResize,
    resizeBy,
    resetWidth,
    widthPx,
    isResizing: live !== null,
  }
}
