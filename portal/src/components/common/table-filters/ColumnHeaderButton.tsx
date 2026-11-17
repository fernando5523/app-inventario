import { forwardRef } from 'react'
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon } from '@primer/octicons-react'
import { HiOutlineFilter } from 'react-icons/hi'
import type { SortDirection } from './operators'

interface ColumnHeaderButtonProps {
  label: string
  align?: 'left' | 'right' | 'center'
  sortDirection?: SortDirection | null
  hasFilter?: boolean
  isOpen: boolean
  onToggle: () => void
}

const ALIGN_CLASS = { left: 'justify-start', right: 'justify-end', center: 'justify-center' } as const

/**
 * A sortable/filterable column header: the label, and at the right edge the sort
 * arrow and the funnel (when sorted / filtered) that turn into a chevron on hover/open. Opens `ColumnHeaderMenu` anchored under it.
 *
 * A column with neither `sortable` nor `filter` renders a plain `<span>`
 * instead (see `ColumnHeaderCell`) — this component is only used when there
 * is a menu to open.
 */
export const ColumnHeaderButton = forwardRef<HTMLButtonElement, ColumnHeaderButtonProps>(
  ({ label, align = 'left', sortDirection, hasFilter, isOpen, onToggle }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onToggle}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`Opciones de columna ${label}`}
        className={`group/header flex w-full items-center gap-1 rounded-sm px-1 -mx-1 py-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${
          isOpen ? 'bg-[var(--bg-rail)]' : 'hover:bg-[var(--bg-rail)]'
        }`}
      >
        {/* The label keeps the column alignment. The right edge holds the state, like D365:
            at rest the sort arrow (↑/↓) and the funnel when filtered; on hover or while the
            menu is open, the chevron. */}
        <span className={`flex min-w-0 flex-1 items-center ${ALIGN_CLASS[align]}`}>
          <span className="truncate">{label}</span>
        </span>
        <span className="relative flex h-3.5 min-w-3 shrink-0 items-center justify-end gap-0.5" aria-hidden="true">
          <span className={`flex items-center gap-0.5 text-[var(--fg-muted)] ${isOpen ? 'opacity-0' : 'opacity-100 group-hover/header:opacity-0'}`}>
            {sortDirection === 'asc' && <ArrowUpIcon size={12} />}
            {sortDirection === 'desc' && <ArrowDownIcon size={12} />}
            {/* Funnel = this column is filtered. */}
            {hasFilter && <HiOutlineFilter className="h-3.5 w-3.5" />}
          </span>
          <span className={`absolute right-0 text-[var(--fg-muted)] ${isOpen ? 'opacity-100' : 'opacity-0 group-hover/header:opacity-100'}`}>
            <ChevronDownIcon size={12} />
          </span>
        </span>
      </button>
    )
  }
)
ColumnHeaderButton.displayName = 'ColumnHeaderButton'
