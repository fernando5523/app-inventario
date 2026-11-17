import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { OperatorPicker } from './OperatorPicker'
import { SearchableSelect } from '../SearchableSelect'
import { DateInput } from '../DateInput'
import {
  defaultOperator,
  getOperators,
  operatorNeedsRange,
  operatorNeedsValue,
  sortLabels,
  type ColumnFilterValue,
  type FilterOperator,
  type FilterType,
  type SortDirection,
} from './operators'

export interface ColumnFilterOption {
  value: string
  label: string
}

export interface Position {
  top: number
  left: number
}

interface ColumnHeaderMenuProps {
  label: string
  /** When set, the sort section ("Ordenar...") renders at the top. */
  sortable?: boolean
  currentSort?: SortDirection | null
  onSort: (direction: SortDirection) => void
  /** When set, the filter section (operator + value + Aplicar/Borrar) renders. */
  filterType?: FilterType
  /** Restricts the operator dropdown to the ones this column can express correctly (see `getOperators`). */
  operators?: FilterOperator[]
  options?: ColumnFilterOption[]
  currentFilter?: ColumnFilterValue | null
  onApply: (filter: ColumnFilterValue) => void
  onClear: () => void
  /** `returnFocus` is true on Escape and after Aplicar/Borrar, false on an outside click. */
  onClose: (returnFocus: boolean) => void
  anchorEl: HTMLElement | null
}

const MENU_WIDTH = 224
const GAP = 4
const MARGIN = 8

function computePosition(anchor: HTMLElement): Position {
  const rect = anchor.getBoundingClientRect()
  const left = Math.min(Math.max(MARGIN, rect.left), window.innerWidth - MENU_WIDTH - MARGIN)
  const spaceBelow = window.innerHeight - rect.bottom - GAP - MARGIN
  const below = spaceBelow >= 180 || spaceBelow >= rect.top - GAP - MARGIN
  const top = below ? rect.bottom + GAP : Math.max(MARGIN, rect.top - GAP - 180)
  return { top, left }
}

/**
 * Header menu popover: anchored under the header button, left-aligned.
 * Mirrors `TableSettingsButton`'s popover mechanics (portal, fixed position,
 * close on outside click / Escape / resize / scroll) so every table popover
 * in the app behaves the same way.
 */
export function ColumnHeaderMenu({
  label,
  sortable,
  currentSort,
  onSort,
  filterType,
  operators,
  options,
  currentFilter,
  onApply,
  onClear,
  onClose,
  anchorEl,
}: ColumnHeaderMenuProps) {
  const [position, setPosition] = useState<Position | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const hasFocusedRef = useRef(false)

  const initialOperator: FilterOperator = currentFilter?.operator ?? (filterType ? defaultOperator(filterType, operators) : 'startsWith')
  const [operator, setOperator] = useState<FilterOperator>(initialOperator)
  const [value, setValue] = useState(currentFilter?.value ?? '')
  const [valueTo, setValueTo] = useState(currentFilter?.valueTo ?? '')

  useEffect(() => {
    if (!anchorEl) return
    setPosition(computePosition(anchorEl))
  }, [anchorEl])

  useEffect(() => {
    if (!position || hasFocusedRef.current) return
    hasFocusedRef.current = true
    // Like D365: the caret lands in the value box so the user can type right away;
    // without a value control (blanks operators, sort-only columns) fall back to the operator.
    const valueField = panelRef.current?.querySelector<HTMLElement>('[data-menu-value], [role="combobox"]')
    const target = valueField ?? panelRef.current?.querySelector<HTMLElement>('button, select, input')
    target?.focus()
  }, [position])

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || anchorEl?.contains(target)) return
      // A SearchableSelect list lives in its own portal: picking a value there is not "outside".
      if ((target as Element).closest?.('[data-floating-layer]')) return
      onClose(false)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      onClose(true)
    }
    const reposition = () => anchorEl && setPosition(computePosition(anchorEl))

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [anchorEl, onClose])

  if (!position) return null

  const needsValue = filterType ? operatorNeedsValue(operator) : false
  const needsRange = filterType ? operatorNeedsRange(operator) : false
  const canApply = !needsValue || (needsRange ? value.trim() !== '' && valueTo.trim() !== '' : value.trim() !== '')

  const handleApply = () => {
    if (!filterType || !canApply) return
    onApply({ type: filterType, operator, value: needsValue ? value : undefined, valueTo: needsRange ? valueTo : undefined })
    onClose(true)
  }

  const handleClear = () => {
    onClear()
    onClose(true)
  }

  const handleSort = (direction: SortDirection) => {
    onSort(direction)
    onClose(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleApply()
  }

  const valueControl = () => {
    if (!filterType || !needsValue) return null
    // A list of values (enum, or a text column with known values and an exact operator) is a
    // SearchableSelect: the list can grow (categories, brands) and must be searchable.
    const pickFromList = filterType === 'enum' || (filterType === 'text' && options?.length && (operator === 'equals' || operator === 'notEquals'))
    if (pickFromList) {
      return (
        <SearchableSelect
          options={(options ?? []).map((opt) => ({ value: opt.value, label: opt.label }))}
          value={value}
          onChange={setValue}
          placeholder="Seleccionar..."
          ariaLabel={`Valor para ${label}`}
          className="w-full"
          triggerClassName="text-xs"
        />
      )
    }
    if (filterType === 'date') {
      // Our own picker (dd/mm/aaaa, Spanish calendar): the native one follows the OS locale.
      if (needsRange) {
        const span = { from: value, to: valueTo }
        return (
          <div className="flex flex-col gap-1">
            <DateInput value={value} onChange={setValue} range={span} ariaLabel={`Valor desde para ${label}`} data-menu-value />
            <span className="text-[11px] text-[var(--fg-muted)]">y</span>
            <DateInput value={valueTo} onChange={setValueTo} range={span} ariaLabel={`Valor hasta para ${label}`} />
          </div>
        )
      }
      return <DateInput value={value} onChange={setValue} ariaLabel={`Valor para ${label}`} data-menu-value />
    }
    const inputType = filterType === 'number' ? 'number' : 'text'
    const inputClass = 'w-full text-xs px-2 py-1 bg-white border border-[var(--border)] rounded text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:outline-none focus:border-[var(--primary)]'
    if (needsRange) {
      return (
        <div className="flex items-center gap-1.5">
          <input
            type={inputType}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label={`Valor desde para ${label}`}
            data-menu-value
            className={inputClass}
          />
          <span className="text-[11px] text-[var(--fg-muted)]">y</span>
          <input
            type={inputType}
            value={valueTo}
            onChange={(e) => setValueTo(e.target.value)}
            aria-label={`Valor hasta para ${label}`}
            className={inputClass}
          />
        </div>
      )
    }
    return (
      <input
        type={inputType}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={`Valor para ${label}`}
        data-menu-value
        className={inputClass}
      />
    )
  }

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      className="fixed z-[70] bg-white rounded-lg shadow-lg border border-[var(--border)] py-1.5 animate-fade-in"
      style={{ top: position.top, left: position.left, width: MENU_WIDTH }}
    >
      <form onSubmit={handleSubmit}>
        {sortable && (
          <>
            <div className="px-1.5 flex flex-col">
              <button
                type="button"
                onClick={() => handleSort('asc')}
                aria-pressed={currentSort === 'asc'}
                className={`text-left px-1.5 py-1 text-xs rounded-sm hover:bg-[var(--bg-subtle)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)] text-[var(--fg)] ${currentSort === 'asc' ? 'font-semibold' : ''}`}
              >
                {sortLabels.asc}
              </button>
              <button
                type="button"
                onClick={() => handleSort('desc')}
                aria-pressed={currentSort === 'desc'}
                className={`text-left px-1.5 py-1 text-xs rounded-sm hover:bg-[var(--bg-subtle)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)] text-[var(--fg)] ${currentSort === 'desc' ? 'font-semibold' : ''}`}
              >
                {sortLabels.desc}
              </button>
            </div>
            {filterType && <hr className="my-1.5 border-[var(--border)]" />}
          </>
        )}

        {filterType && (
          <div className="px-2.5 flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-[var(--fg)]">{label}</span>

            <OperatorPicker
              label={label}
              value={operator}
              options={getOperators(filterType, operators)}
              onChange={setOperator}
            />

            {valueControl()}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={!canApply}
                className="px-2.5 py-1 text-xs font-medium rounded-md bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
              >
                Aplicar
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="px-2.5 py-1 text-xs font-medium rounded-md border border-[var(--border)] text-[var(--fg)] hover:bg-[var(--bg-subtle)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
              >
                Borrar
              </button>
            </div>
          </div>
        )}
      </form>
    </div>,
    document.body
  )
}
