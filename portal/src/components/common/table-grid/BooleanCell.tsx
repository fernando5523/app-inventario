import { CheckIcon } from '@primer/octicons-react'

/**
 * Read-only checkbox for a boolean field in a grid (D365 shows booleans as checkboxes, not
 * badges). It is an indicator, not a control: the row's selection circle is the only checkbox.
 */
export function BooleanCell({ value, label }: { value: boolean; label: string }) {
  return (
    <span
      role="img"
      aria-label={`${label}: ${value ? 'Sí' : 'No'}`}
      className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border align-middle ${
        value ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--fg-subtle)] bg-white'
      }`}
    >
      {value && <CheckIcon size={10} />}
    </span>
  )
}
