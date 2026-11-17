import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronDownIcon, SearchIcon, XIcon, CheckIcon } from '@primer/octicons-react'

export interface SearchableSelectOption {
  value: string
  label: string
  sublabel?: string
  disabled?: boolean
}

interface SearchableSelectProps {
  options: SearchableSelectOption[]
  value: string
  onChange: (value: string) => void
  /** Text shown when nothing is selected. Replaces the old empty <option>. */
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  /** Shows the inline clear button. Off for fields that must always hold a value. */
  clearable?: boolean
  /** Paints the invalid border. Pair it with the form's own error message. */
  error?: boolean
  /** Applied to the wrapper: use it for layout (w-full, flex-1). */
  className?: string
  /** Applied to the trigger: use it for type scale overrides. */
  triggerClassName?: string
  /**
   * Option count below which the search box is hidden. Defaults to 0 — always
   * searchable, like Select2. Raise it only for a control that is provably
   * never worth typing into.
   */
  searchThreshold?: number
  ariaLabel?: string
}

const DROPDOWN_GAP = 4
const MAX_DROPDOWN_HEIGHT = 280
const MIN_DROPDOWN_HEIGHT = 140
/** Long lists stay responsive by rendering a slice; search narrows the rest. */
const RENDER_CAP = 100

type Placement = 'top' | 'bottom'

interface DropdownPosition {
  top: number
  left: number
  width: number
  maxHeight: number
  placement: Placement
}

/** Strips diacritics so "categoria" matches "Categoría". */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

function computePosition(trigger: HTMLElement): DropdownPosition {
  const rect = trigger.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom - 8
  const spaceAbove = rect.top - 8
  const placeTop = spaceBelow < MIN_DROPDOWN_HEIGHT && spaceAbove > spaceBelow

  return {
    top: placeTop ? rect.top - DROPDOWN_GAP : rect.bottom + DROPDOWN_GAP,
    left: rect.left,
    width: rect.width,
    maxHeight: Math.max(
      MIN_DROPDOWN_HEIGHT,
      Math.min(MAX_DROPDOWN_HEIGHT, placeTop ? spaceAbove : spaceBelow)
    ),
    placement: placeTop ? 'top' : 'bottom',
  }
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Seleccionar...',
  searchPlaceholder = 'Buscar...',
  emptyMessage = 'No se encontraron resultados',
  disabled = false,
  clearable = false,
  error = false,
  className = '',
  triggerClassName = '',
  searchThreshold = 0,
  ariaLabel,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [position, setPosition] = useState<DropdownPosition | null>(null)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const listId = useId()
  const optionIdPrefix = useId()

  // The API hands back numeric ids even where the TS types say string, and a
  // native <select> stringifies everything through the DOM. Comparing and
  // emitting as strings keeps this a true drop-in for the element it replaces.
  const selectedValue = value == null ? '' : String(value)

  const selectedOption = useMemo(
    () => options.find((o) => String(o.value) === selectedValue),
    [options, selectedValue]
  )

  const showSearch = options.length >= searchThreshold

  const filtered = useMemo(() => {
    const term = search.trim()
    if (!term) return options
    const needle = normalize(term)
    return options.filter(
      (o) =>
        normalize(o.label).includes(needle) ||
        (o.sublabel ? normalize(o.sublabel).includes(needle) : false)
    )
  }, [options, search])

  const visible = filtered.length > RENDER_CAP ? filtered.slice(0, RENDER_CAP) : filtered
  const hiddenCount = filtered.length - visible.length

  const close = useCallback((refocus: boolean) => {
    setIsOpen(false)
    setSearch('')
    setActiveIndex(-1)
    setPosition(null)
    if (refocus) triggerRef.current?.focus()
  }, [])

  const open = useCallback(
    (seed?: string) => {
      if (disabled) return
      setSearch(seed ?? '')
      setIsOpen(true)
    },
    [disabled]
  )

  const commit = useCallback(
    (option: SearchableSelectOption) => {
      if (option.disabled) return
      onChange(String(option.value))
      close(true)
    },
    [onChange, close]
  )

  // Position before paint so the dropdown never flashes in the wrong spot.
  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return
    setPosition(computePosition(triggerRef.current))
  }, [isOpen])

  // Follow the trigger while any ancestor scrolls (slide panels, table bodies).
  useEffect(() => {
    if (!isOpen) return
    const reposition = () => {
      if (triggerRef.current) setPosition(computePosition(triggerRef.current))
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [isOpen])

  // Point the highlight at the current selection when the list opens.
  useEffect(() => {
    if (!isOpen) return
    const selectedIndex = filtered.findIndex((o) => String(o.value) === selectedValue)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    // Only on open: later keystrokes drive activeIndex through the reset below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // A new search means the old highlight index points at a different option.
  useEffect(() => {
    if (isOpen && search) setActiveIndex(0)
  }, [search, isOpen])

  // Opening takes two commits: the first sets `position`, the second mounts the
  // portal. Focus has to wait for the second, or the refs are still null and
  // every keystroke keeps going to the trigger instead of the list.
  const isDropdownMounted = isOpen && position !== null

  useEffect(() => {
    if (!isDropdownMounted) return
    if (showSearch) searchRef.current?.focus()
    else listRef.current?.focus()
  }, [isDropdownMounted, showSearch])

  useEffect(() => {
    if (!isDropdownMounted || activeIndex < 0) return
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, isDropdownMounted])

  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      close(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [isOpen, close])

  const moveActive = useCallback(
    (delta: number) => {
      if (visible.length === 0) return
      setActiveIndex((current) => {
        let next = current
        for (let step = 0; step < visible.length; step += 1) {
          next = (next + delta + visible.length) % visible.length
          if (!visible[next].disabled) return next
        }
        return current
      })
    },
    [visible]
  )

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open()
      return
    }
    // Typing jumps straight into search, like a native select's typeahead.
    if (showSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      open(e.key)
    }
  }

  const handleDropdownKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        moveActive(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        moveActive(-1)
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(visible.length - 1)
        break
      case 'Enter':
        e.preventDefault()
        if (activeIndex >= 0 && visible[activeIndex]) commit(visible[activeIndex])
        break
      case 'Escape':
        e.preventDefault()
        close(true)
        break
      case 'Tab':
        close(false)
        break
      default:
        break
    }
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('')
  }

  const activeOptionId = activeIndex >= 0 ? `${optionIdPrefix}-${activeIndex}` : undefined

  const dropdown =
    isOpen && position ? (
      <div
        ref={dropdownRef}
        // Marks a floating layer rendered in a portal: popovers that close on an outside
        // click (e.g. a grid header menu holding this select) must not treat it as outside.
        data-floating-layer
        className="fixed z-[80] bg-white border border-[var(--border)] rounded-lg shadow-lg overflow-hidden animate-fade-in"
        style={{
          top: position.top,
          left: position.left,
          width: position.width,
          minWidth: 200,
          transform: position.placement === 'top' ? 'translateY(-100%)' : undefined,
        }}
        onKeyDown={handleDropdownKeyDown}
      >
        {showSearch && (
          <div className="p-1.5 border-b border-[var(--border)]">
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none">
                <SearchIcon size={12} />
              </span>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="gh-input gh-combobox-search"
                aria-label={searchPlaceholder}
                aria-controls={listId}
                aria-activedescendant={activeOptionId}
                autoComplete="off"
              />
            </div>
          </div>
        )}

        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={showSearch ? -1 : 0}
          aria-activedescendant={activeOptionId}
          className="overflow-y-auto focus:outline-none"
          style={{ maxHeight: position.maxHeight - (showSearch ? 44 : 0) }}
        >
          {visible.length > 0 ? (
            visible.map((option, index) => {
              const isSelected = String(option.value) === selectedValue
              const isActive = index === activeIndex
              return (
                <div
                  key={option.value}
                  id={`${optionIdPrefix}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  onClick={() => commit(option)}
                  onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                  className={`px-3 py-1.5 text-xs flex items-start gap-2 transition-colors ${
                    option.disabled
                      ? 'text-[var(--fg-subtle)] cursor-not-allowed'
                      : 'cursor-pointer text-[var(--fg)]'
                  } ${isActive && !option.disabled ? 'bg-[var(--primary-light)]' : ''} ${
                    isSelected ? 'font-medium text-[var(--primary)]' : ''
                  }`}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.sublabel && (
                      <span className="block text-[10px] text-[var(--fg-muted)] truncate">
                        {option.sublabel}
                      </span>
                    )}
                  </span>
                  {isSelected && (
                    <span className="text-[var(--primary)] shrink-0 mt-0.5">
                      <CheckIcon size={12} />
                    </span>
                  )}
                </div>
              )
            })
          ) : (
            <div className="px-3 py-4 text-xs text-[var(--fg-muted)] text-center">{emptyMessage}</div>
          )}

          {hiddenCount > 0 && (
            <div className="px-3 py-2 text-[10px] text-[var(--fg-subtle)] text-center border-t border-[var(--border)]">
              +{hiddenCount} resultados mas. Refina tu busqueda.
            </div>
          )}
        </div>
      </div>
    ) : null

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        disabled={disabled}
        data-open={isOpen}
        data-invalid={error}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={isOpen ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => (isOpen ? close(false) : open())}
        onKeyDown={handleTriggerKeyDown}
        className={`gh-combobox ${triggerClassName}`}
      >
        <span className="flex-1 min-w-0 truncate">
          {selectedOption ? (
            <>
              {selectedOption.label}
              {selectedOption.sublabel && (
                <span className="text-[var(--fg-muted)] ml-1">{selectedOption.sublabel}</span>
              )}
            </>
          ) : (
            <span className="text-[var(--fg-subtle)]">{placeholder}</span>
          )}
        </span>

        {clearable && selectedValue && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Limpiar seleccion"
            onClick={handleClear}
            className="shrink-0 p-0.5 rounded text-[var(--fg-muted)] hover:bg-[var(--bg-rail)] hover:text-[var(--fg)]"
          >
            <XIcon size={12} />
          </span>
        )}
        <span
          className={`shrink-0 text-[var(--fg-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          <ChevronDownIcon size={12} />
        </span>
      </button>

      {dropdown && createPortal(dropdown, document.body)}
    </div>
  )
}

/**
 * Adapter for forms that share one `handleChange(e)` across fields.
 * Lets a call site keep its existing handler:
 *   onChange={(v) => handleChange(selectEvent('branchId', v))}
 */
export function selectEvent(name: string, value: string) {
  // `type` is carried because those handlers branch on it
  // (`type === 'checkbox'` / `'number'`); a native select reports 'select-one'.
  const target = { name, value, type: 'select-one' }
  return {
    target,
    currentTarget: target,
  } as unknown as React.ChangeEvent<HTMLSelectElement>
}
