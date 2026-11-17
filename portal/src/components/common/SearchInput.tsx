import { HiSearch, HiX } from 'react-icons/hi'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  onClear?: () => void
  className?: string
  autoFocus?: boolean
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Buscar...',
  onClear,
  className = '',
  autoFocus,
}: SearchInputProps) {
  return (
    <div className={`relative flex-1 ${className}`}>
      <HiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--fg-subtle)]" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="gh-input pr-9"
        style={{ paddingLeft: '2.25rem' }}
        autoFocus={autoFocus}
      />
      {value && (
        <button
          onClick={() => {
            onChange('')
            onClear?.()
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-subtle)] hover:text-[var(--fg)] transition-colors"
          title="Limpiar búsqueda"
        >
          <HiX className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
