import { useCallback, useRef, useState } from 'react'
import { ColumnHeaderButton } from './ColumnHeaderButton'
import { ColumnHeaderMenu, type ColumnFilterOption } from './ColumnHeaderMenu'
import type { ColumnFilterValue, FilterOperator, FilterType, SortDirection } from './operators'

export interface ColumnHeaderCellProps {
  label: string
  align?: 'left' | 'right' | 'center'
  sortable?: boolean
  currentSort?: SortDirection | null
  onSort: (direction: SortDirection) => void
  filterType?: FilterType
  operators?: FilterOperator[]
  options?: ColumnFilterOption[]
  currentFilter?: ColumnFilterValue | null
  onApplyFilter: (filter: ColumnFilterValue) => void
  onClearFilter: () => void
}

/**
 * Stateful wiring between `ColumnHeaderButton` (the trigger) and
 * `ColumnHeaderMenu` (its popover): who is open, and the anchor element the
 * menu positions itself under. A column with neither `sortable` nor
 * `filterType` renders a plain header instead — nothing to open.
 */
export function ColumnHeaderCell({
  label,
  align = 'left',
  sortable,
  currentSort,
  onSort,
  filterType,
  operators,
  options,
  currentFilter,
  onApplyFilter,
  onClearFilter,
}: ColumnHeaderCellProps) {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = useCallback((returnFocus: boolean) => {
    setIsOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  if (!sortable && !filterType) {
    return <span className="truncate block">{label}</span>
  }

  return (
    <>
      <ColumnHeaderButton
        ref={triggerRef}
        label={label}
        align={align}
        sortDirection={currentSort}
        hasFilter={Boolean(currentFilter)}
        isOpen={isOpen}
        onToggle={() => setIsOpen((v) => !v)}
      />
      {isOpen && (
        <ColumnHeaderMenu
          label={label}
          sortable={sortable}
          currentSort={currentSort}
          onSort={onSort}
          filterType={filterType}
          operators={operators}
          options={options}
          currentFilter={currentFilter}
          onApply={onApplyFilter}
          onClear={onClearFilter}
          onClose={close}
          anchorEl={triggerRef.current}
        />
      )}
    </>
  )
}
