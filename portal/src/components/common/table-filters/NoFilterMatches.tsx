interface NoFilterMatchesProps {
  onClear: () => void
  message?: string
}

/**
 * Empty body of a filtered grid. It goes INSIDE the table (or the card list), never in
 * place of it: the column headers hold the only way to change or clear a column filter.
 */
export function NoFilterMatches({ onClear, message = 'Ningún registro coincide con los filtros aplicados' }: NoFilterMatchesProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-6" role="status">
      <p className="text-[13px] text-[var(--fg-muted)]">{message}</p>
      <button
        type="button"
        onClick={onClear}
        className="text-xs px-3 py-1 rounded-md border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--bg-subtle)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
      >
        Borrar filtros
      </button>
    </div>
  )
}
