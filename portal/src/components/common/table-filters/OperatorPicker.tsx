import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { CheckIcon, ChevronDownIcon } from '@primer/octicons-react'
import type { FilterOperator } from './operators'

interface OperatorPickerProps {
  /** Column label, for the accessible names. */
  label: string
  value: FilterOperator
  options: { value: FilterOperator; label: string }[]
  onChange: (value: FilterOperator) => void
}

/**
 * The operator of a column filter as a blue link ("empieza por ˅") that opens a compact
 * list, like D365. It replaces a native <select>, whose popup the OS draws (blue text,
 * wide rows) and CSS cannot style. Escape closes only the list, not the header menu.
 */
export function OperatorPicker({ label, value, options, onChange }: OperatorPickerProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const current = options.find((op) => op.value === value)

  useEffect(() => {
    if (!open) return
    listRef.current?.focus()
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const openList = () => {
    setActive(Math.max(0, options.findIndex((op) => op.value === value)))
    setOpen(true)
  }

  const choose = (index: number) => {
    const op = options[index]
    if (op) onChange(op.value)
    setOpen(false)
    buttonRef.current?.focus()
  }

  const onButtonKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      openList()
    }
  }

  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(options.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      choose(active)
    } else if (e.key === 'Escape') {
      // preventDefault tells the header menu (document listener) to stay open.
      e.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative w-fit">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Operador para ${label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onButtonKeyDown}
        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline focus:outline-none focus-visible:underline"
      >
        {current?.label ?? value}
        <ChevronDownIcon size={12} aria-hidden="true" />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={`Operadores de ${label}`}
          aria-activedescendant={`${listId}-${active}`}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className="absolute left-0 top-full z-[1] mt-1 min-w-[160px] rounded-md border border-[var(--border)] bg-white py-1 shadow-lg focus:outline-none"
        >
          {options.map((op, index) => (
            <li
              key={op.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={op.value === value}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(index)}
              className={`flex cursor-pointer items-center gap-1.5 px-2.5 py-0.5 text-xs text-[var(--fg)] ${index === active ? 'bg-[var(--bg-subtle)]' : ''}`}
            >
              <span className="inline-flex w-3 shrink-0" aria-hidden="true">
                {op.value === value && <CheckIcon size={12} />}
              </span>
              {op.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
