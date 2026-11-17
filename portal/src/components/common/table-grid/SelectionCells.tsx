import { CheckIcon, DashIcon } from '@primer/octicons-react'

/** Width of the leading selection column, in px. */
export const SELECTION_COLUMN_WIDTH = 36

type IndicatorState = 'off' | 'on' | 'partial'

/**
 * The D365 selection circle: blue filled circle with a check when selected, a dash when
 * only some rows are. An unselected row shows nothing until hover (then the empty ring);
 * the header always shows the ring.
 */
function Indicator({ state, alwaysVisible }: { state: IndicatorState; alwaysVisible?: boolean }) {
  if (state === 'on' || state === 'partial') {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--primary)] text-white">
        {state === 'on' ? <CheckIcon size={12} /> : <DashIcon size={12} />}
      </span>
    )
  }
  if (alwaysVisible) {
    return <span className="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--fg-subtle)]" />
  }
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--fg-subtle)] text-[var(--fg-subtle)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
      <CheckIcon size={10} />
    </span>
  )
}

const BUTTON_CLASS =
  'flex h-full w-full items-center justify-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]'

export function SelectAllHeaderCell({
  allSelected,
  someSelected,
  onToggleAll,
}: {
  allSelected: boolean
  someSelected: boolean
  onToggleAll: () => void
}) {
  return (
    <th scope="col" className="p-0 align-middle">
      <button
        type="button"
        role="checkbox"
        aria-checked={allSelected ? true : someSelected ? 'mixed' : false}
        aria-label="Seleccionar todo"
        onClick={onToggleAll}
        className={`${BUTTON_CLASS} py-1.5`}
      >
        <Indicator state={allSelected ? 'on' : someSelected ? 'partial' : 'off'} alwaysVisible />
      </button>
    </th>
  )
}

export function RowSelectCell({
  selected,
  label,
  onToggle,
}: {
  selected: boolean
  /** Accessible name of the row, e.g. its code. */
  label: string
  onToggle: () => void
}) {
  return (
    <td className="p-0 align-middle">
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Seleccionar ${label}`}
        onClick={(e) => {
          // The circle toggles on its own; it must not also run the row's "select only" click.
          e.stopPropagation()
          onToggle()
        }}
        className={`${BUTTON_CLASS} py-1.5`}
      >
        <Indicator state={selected ? 'on' : 'off'} />
      </button>
    </td>
  )
}
