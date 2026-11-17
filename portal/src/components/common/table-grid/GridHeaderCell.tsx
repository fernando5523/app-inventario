import type { ReactNode } from 'react'
import type { useColumnDrag } from './useColumnDrag'
import type { useColumnLayout } from './useColumnLayout'

const KEYBOARD_STEP = 16

/** The D365 "::" grip: four dots, two columns by two rows. */
function GripDots() {
  return (
    <svg width="6" height="8" viewBox="0 0 6 8" fill="currentColor" aria-hidden="true">
      <circle cx="1.25" cy="2" r="1" />
      <circle cx="4.75" cy="2" r="1" />
      <circle cx="1.25" cy="6" r="1" />
      <circle cx="4.75" cy="6" r="1" />
    </svg>
  )
}

interface GridHeaderCellProps {
  column: { id: string; label: string; width: number }
  /** th classes (padding, typography, alignment). */
  className?: string
  ariaSort?: 'ascending' | 'descending'
  layout: ReturnType<typeof useColumnLayout>
  drag: ReturnType<typeof useColumnDrag>
  movable?: boolean
  resizable?: boolean
  /** The header content (usually `ColumnHeaderCell`). */
  children: ReactNode
}

/**
 * A table header cell with the D365 grid affordances around its content: on hover the
 * whole header lights up and a vertical grip box ("::") appears on its left edge, before
 * the label, to drag the column to another position; and a
 * resize handle on its right border (drag to resize, double click resets the width,
 * Arrow keys resize from the keyboard).
 */
export function GridHeaderCell({
  column,
  className = '',
  ariaSort,
  layout,
  drag,
  movable = true,
  resizable = true,
  children,
}: GridHeaderCellProps) {
  const { id: columnId, label } = column
  const side = drag.dropSide(columnId)
  const dropLine =
    side === 'before' ? 'shadow-[inset_2px_0_0_var(--primary)]' : side === 'after' ? 'shadow-[inset_-2px_0_0_var(--primary)]' : ''
  const dragging = drag.draggingId === columnId

  return (
    <th
      scope="col"
      data-column-id={columnId}
      aria-sort={ariaSort}
      className={`relative group/th select-none text-left hover:bg-[var(--bg-rail)] ${className} ${dropLine} ${dragging ? 'opacity-50' : ''}`}
      {...(movable ? drag.headerDropProps(columnId) : {})}
    >
      {movable && (
        <span
          {...drag.gripProps(columnId)}
          title="Arrastrar para mover la columna"
          aria-hidden="true"
          className="absolute inset-y-0 left-0 flex w-2.5 cursor-grab items-center justify-center bg-[var(--border)] text-[var(--fg-muted)] opacity-0 group-hover/th:opacity-100 hover:bg-[var(--border-strong)] hover:text-[var(--fg)] active:cursor-grabbing"
        >
          <GripDots />
        </span>
      )}
      {children}
      {resizable && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Ancho de columna ${label}`}
          aria-valuenow={layout.widthPx(column)}
          tabIndex={0}
          title="Arrastrar para cambiar el ancho (doble clic: ancho original)"
          onPointerDown={(e) => layout.startResize(columnId, e)}
          // Without this the browser selects the neighbouring cells' text on drag/double click.
          onMouseDown={(e) => e.preventDefault()}
          onDoubleClick={() => layout.resetWidth(columnId)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault()
              layout.resizeBy(columnId, e.key === 'ArrowRight' ? KEYBOARD_STEP : -KEYBOARD_STEP, e.currentTarget)
            }
          }}
          className="group/resize absolute -right-1 top-0 z-[1] h-full w-2 cursor-col-resize focus:outline-none"
        >
          {/* No visible line on hover (the col-resize cursor is the cue, like D365); only keyboard focus shows it. */}
          <span className="absolute inset-y-1 left-1/2 w-0.5 -translate-x-1/2 rounded bg-transparent group-focus-visible/resize:bg-[var(--primary)]" />
        </div>
      )}
    </th>
  )
}
