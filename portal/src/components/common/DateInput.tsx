import { useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from '@primer/octicons-react'

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const WEEKDAYS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do']
const CALENDAR_WIDTH = 232
const CALENDAR_HEIGHT = 290
const GAP = 4
const MARGIN = 8

interface Ymd {
  y: number
  /** 0-based, like `Date`. */
  m: number
  d: number
}

const pad = (n: number) => String(n).padStart(2, '0')
const toIso = ({ y, m, d }: Ymd) => `${y}-${pad(m + 1)}-${pad(d)}`

/** Calendar math runs in UTC so no timezone or DST can shift a day. */
function fromUtc(date: Date): Ymd {
  return { y: date.getUTCFullYear(), m: date.getUTCMonth(), d: date.getUTCDate() }
}

function parseIso(iso: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const ymd = { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) }
  // Date.UTC rolls 31/02 over to March: a round trip that changes the date means it doesn't exist.
  return toIso(fromUtc(new Date(Date.UTC(ymd.y, ymd.m, ymd.d)))) === iso ? ymd : null
}

function addDays(ymd: Ymd, days: number): Ymd {
  return fromUtc(new Date(Date.UTC(ymd.y, ymd.m, ymd.d + days)))
}

/** Same day in another month, clamped to that month's last day (31/01 + 1 month = 28/02). */
function addMonths(ymd: Ymd, months: number): Ymd {
  const lastDay = new Date(Date.UTC(ymd.y, ymd.m + months + 1, 0)).getUTCDate()
  return fromUtc(new Date(Date.UTC(ymd.y, ymd.m + months, Math.min(ymd.d, lastDay))))
}

function today(): Ymd {
  const now = new Date()
  return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() }
}

/** 'YYYY-MM-DD' → 'dd/mm/aaaa'; anything else → ''. */
export function isoToDisplay(iso: string): string {
  const ymd = parseIso(iso)
  return ymd ? `${pad(ymd.d)}/${pad(ymd.m + 1)}/${ymd.y}` : ''
}

/** 'dd/mm/aaaa' → 'YYYY-MM-DD' when it is a real calendar date, else ''. */
export function displayToIso(text: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim())
  if (!match) return ''
  const iso = `${match[3]}-${match[2]}-${match[1]}`
  return parseIso(iso) ? iso : ''
}

/** Keeps only digits and puts the slashes in: "01102026" → "01/10/2026". */
function maskDate(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8)
  let out = digits.slice(0, 2)
  if (digits.length > 2) out += `/${digits.slice(2, 4)}`
  if (digits.length > 4) out += `/${digits.slice(4)}`
  return out
}

function computePosition(anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect()
  const left = Math.min(Math.max(MARGIN, rect.left), window.innerWidth - CALENDAR_WIDTH - MARGIN)
  const spaceBelow = window.innerHeight - rect.bottom - GAP - MARGIN
  const below = spaceBelow >= CALENDAR_HEIGHT || spaceBelow >= rect.top - GAP - MARGIN
  const top = below ? rect.bottom + GAP : Math.max(MARGIN, rect.top - GAP - CALENDAR_HEIGHT)
  return { top, left }
}

export interface DateInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'defaultValue' | 'className'> {
  /** 'YYYY-MM-DD', or '' when empty or while the typed text is not a valid date yet. */
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
  /** Shades the days between both ends (a "between" filter shows its whole span). */
  range?: { from: string; to: string }
  className?: string
}

/**
 * Date field shown as dd/mm/aaaa with a Spanish, Monday-first calendar.
 *
 * The browser's `<input type="date">` follows the OS locale (mm/dd/yyyy and an English
 * calendar on many machines), so the field and the calendar are our own. The value stays
 * ISO 'YYYY-MM-DD', the same contract as the native control.
 *
 * The calendar is a portal marked `data-floating-layer`, like SearchableSelect's list, so a
 * popover hosting this field (the column header menu) doesn't treat a click on it as outside.
 * Escape closes only the calendar: it is consumed with preventDefault before the host sees it.
 */
export function DateInput({ value, onChange, ariaLabel, range, className = '', disabled, ...inputProps }: DateInputProps) {
  const [text, setText] = useState(() => isoToDisplay(value))
  const [prevValue, setPrevValue] = useState(value)
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [focused, setFocused] = useState<Ymd>(() => parseIso(value) ?? today())
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const calendarRef = useRef<HTMLDivElement>(null)
  const focusGridRef = useRef(false)

  // A value set from outside (calendar pick, "Borrar" in the host) replaces the text,
  // but half-typed text that still means "no date" is left alone.
  if (value !== prevValue) {
    setPrevValue(value)
    if (value !== displayToIso(text)) setText(isoToDisplay(value))
  }

  const open = (focusGrid: boolean) => {
    if (disabled) return
    focusGridRef.current = focusGrid
    setFocused(parseIso(value) ?? today())
    setIsOpen(true)
  }

  const close = (refocus: boolean) => {
    setIsOpen(false)
    setPosition(null)
    if (refocus) inputRef.current?.focus()
  }

  const select = (ymd: Ymd | null) => {
    const iso = ymd ? toIso(ymd) : ''
    setText(isoToDisplay(iso))
    onChange(iso)
    close(true)
  }

  useLayoutEffect(() => {
    if (isOpen && wrapperRef.current) setPosition(computePosition(wrapperRef.current))
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const reposition = () => wrapperRef.current && setPosition(computePosition(wrapperRef.current))
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (wrapperRef.current?.contains(target) || calendarRef.current?.contains(target)) return
      close(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [isOpen])

  // The roving tab stop follows the keyboard; focus moves only once the grid is mounted.
  const focusedIso = toIso(focused)
  useEffect(() => {
    if (!position || !focusGridRef.current) return
    calendarRef.current?.querySelector<HTMLElement>(`[data-date="${focusedIso}"]`)?.focus()
  }, [position, focusedIso])

  const handleTextChange = (raw: string) => {
    const masked = maskDate(raw)
    setText(masked)
    const iso = displayToIso(masked)
    onChange(iso)
    const ymd = parseIso(iso)
    if (!ymd) return
    setFocused(ymd)
    // A full date typed by hand needs no calendar, and it would cover what comes next (Aplicar).
    if (isOpen) close(false)
  }

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && (e.altKey || isOpen)) {
      e.preventDefault()
      if (isOpen) {
        focusGridRef.current = true
        calendarRef.current?.querySelector<HTMLElement>(`[data-date="${focusedIso}"]`)?.focus()
      } else {
        open(true)
      }
    } else if (e.key === 'Escape' && isOpen) {
      e.preventDefault()
      close(true)
    }
  }

  const moveFocus = (next: Ymd) => {
    focusGridRef.current = true
    setFocused(next)
  }

  const handleGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const weekday = (new Date(Date.UTC(focused.y, focused.m, focused.d)).getUTCDay() + 6) % 7
    const moves: Record<string, () => Ymd> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      Home: () => addDays(focused, -weekday),
      End: () => addDays(focused, 6 - weekday),
      PageUp: () => addMonths(focused, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, e.shiftKey ? 12 : 1),
    }
    const move = moves[e.key]
    if (!move) return
    e.preventDefault()
    moveFocus(move())
  }

  const handleCalendarKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    close(true)
  }

  const isoValue = parseIso(value) ? value : ''
  const todayIso = toIso(today())
  const isInvalid = text.length === 10 && !displayToIso(text)
  const rangeFrom = range && parseIso(range.from) ? range.from : ''
  const rangeTo = range && parseIso(range.to) ? range.to : ''
  const [spanStart, spanEnd] = rangeFrom && rangeTo && rangeFrom > rangeTo ? [rangeTo, rangeFrom] : [rangeFrom, rangeTo]

  // Six full weeks starting on Monday: the calendar keeps its height from month to month.
  const firstWeekday = (new Date(Date.UTC(focused.y, focused.m, 1)).getUTCDay() + 6) % 7
  const gridStart = addDays({ y: focused.y, m: focused.m, d: 1 }, -firstWeekday)
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))

  const navButtonClass =
    'w-6 h-6 rounded-md flex items-center justify-center text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]'

  const calendar = isOpen && position && (
    <div
      ref={calendarRef}
      data-floating-layer
      role="dialog"
      aria-label={ariaLabel ? `Calendario: ${ariaLabel}` : 'Calendario'}
      onKeyDown={handleCalendarKeyDown}
      className="fixed z-[80] bg-white rounded-lg shadow-lg border border-[var(--border)] p-2 animate-fade-in"
      style={{ top: position.top, left: position.left, width: CALENDAR_WIDTH }}
    >
      <div className="flex items-center justify-between mb-1">
        <button
          type="button"
          aria-label="Mes anterior"
          onClick={() => moveFocus(addMonths(focused, -1))}
          className={navButtonClass}
        >
          <ChevronLeftIcon size={16} />
        </button>
        <span aria-live="polite" className="text-[13px] font-semibold text-[var(--fg)]">
          {MONTHS[focused.m]} {focused.y}
        </span>
        <button
          type="button"
          aria-label="Mes siguiente"
          onClick={() => moveFocus(addMonths(focused, 1))}
          className={navButtonClass}
        >
          <ChevronRightIcon size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7" aria-hidden="true">
        {WEEKDAYS.map((day) => (
          <span key={day} className="h-6 leading-6 text-center text-[10px] font-semibold text-[var(--fg-muted)] uppercase">
            {day}
          </span>
        ))}
      </div>

      <div role="group" aria-label={`${MONTHS[focused.m]} ${focused.y}`} onKeyDown={handleGridKeyDown} className="grid grid-cols-7 gap-y-0.5">
        {days.map((day) => {
          const iso = toIso(day)
          const isSelected = iso === isoValue
          const isToday = iso === todayIso
          const inMonth = day.m === focused.m
          const inSpan = Boolean(spanStart && spanEnd && iso >= spanStart && iso <= spanEnd)
          const tone = isSelected
            ? 'bg-[var(--primary)] text-white font-semibold hover:bg-[var(--primary-hover)]'
            : `${inSpan ? 'bg-[var(--primary-light)]' : ''} ${inMonth ? 'text-[var(--fg)]' : 'text-[var(--fg-subtle)]'} hover:bg-[var(--primary-light)] ${
                isToday ? 'font-semibold ring-1 ring-inset ring-[var(--primary)]' : ''
              }`
          return (
            <button
              key={iso}
              type="button"
              data-date={iso}
              tabIndex={iso === focusedIso ? 0 : -1}
              aria-label={`${day.d} de ${MONTHS[day.m].toLowerCase()} de ${day.y}`}
              aria-pressed={isSelected}
              aria-current={isToday ? 'date' : undefined}
              onClick={() => select(day)}
              className={`h-7 text-xs tabular-nums rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${tone}`}
            >
              {day.d}
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-[var(--border)]">
        <button
          type="button"
          onClick={() => select(today())}
          className="px-1.5 py-0.5 text-xs font-medium text-[var(--primary)] rounded-md hover:bg-[var(--primary-light)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
        >
          Hoy
        </button>
        <button
          type="button"
          onClick={() => select(null)}
          className="px-1.5 py-0.5 text-xs font-medium text-[var(--fg-muted)] rounded-md hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
        >
          Borrar
        </button>
      </div>
    </div>
  )

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <input
        {...inputProps}
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/aaaa"
        maxLength={10}
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={isInvalid || undefined}
        onChange={(e) => handleTextChange(e.target.value)}
        onKeyDown={handleInputKeyDown}
        onClick={() => !isOpen && open(false)}
        className="w-full text-xs pl-2 pr-7 py-1 tabular-nums bg-white border border-[var(--border)] rounded text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:outline-none focus:border-[var(--primary)] aria-[invalid=true]:border-[var(--danger)] disabled:bg-[var(--bg-subtle)] disabled:cursor-not-allowed"
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label={ariaLabel ? `Abrir calendario: ${ariaLabel}` : 'Abrir calendario'}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? close(true) : open(true))}
        className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-[var(--fg-muted)] hover:text-[var(--primary)] disabled:cursor-not-allowed"
      >
        <CalendarIcon size={14} />
      </button>
      {calendar && createPortal(calendar, document.body)}
    </div>
  )
}
