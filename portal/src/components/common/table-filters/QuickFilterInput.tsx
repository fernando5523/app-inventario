import { HiSearch } from 'react-icons/hi'

interface QuickFilterInputProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

/**
 * D365-style quick filter box: magnifier inside on the left, compact
 * (~28-30px tall), placeholder "Filtro". Goes at the left of the list
 * toolbar. If a list already had a search box, that box becomes this one —
 * same input, same behavior (server or client search), this styling.
 */
export function QuickFilterInput({ value, onChange, className = '' }: QuickFilterInputProps) {
  return (
    <div className={`relative ${className}`}>
      <HiSearch className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--fg-muted)]" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filtro"
        aria-label="Filtro"
        className="h-[30px] w-full sm:w-[240px] pl-7 pr-2 text-xs sm:text-[13px] bg-white border border-[var(--border)] rounded text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:outline-none focus:border-[var(--primary)]"
      />
    </div>
  )
}
