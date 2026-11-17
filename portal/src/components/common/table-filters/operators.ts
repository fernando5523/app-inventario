/**
 * Pure logic for the D365-style column filters: operator catalogs, the
 * predicate builder that turns a column filter into a `(value) => boolean`
 * check, and the comparator used for sorting. No React here, so it is cheap
 * to unit test on its own — see `operators.test.ts`.
 */

export type FilterType = 'text' | 'number' | 'date' | 'enum'

export type TextOperator =
  | 'startsWith'
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEquals'
  | 'isBlank'
  | 'isNotBlank'

export type NumberOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'

export type DateOperator = 'eq' | 'before' | 'after' | 'between'

export type EnumOperator = 'equals' | 'notEquals'

export type FilterOperator = TextOperator | NumberOperator | DateOperator | EnumOperator

/** What a value of a filterable column may hold, and what a sortable column reads from a row. */
export type CellValue = string | number | Date | null | undefined

export interface ColumnFilterValue {
  type: FilterType
  operator: FilterOperator
  /** String from the control (text/enum: the raw text; number/date: the first value, as typed). */
  value?: string
  /** Second bound, only meaningful for the "entre" / "between" operators. */
  valueTo?: string
}

export type SortDirection = 'asc' | 'desc'

interface OperatorOption {
  value: FilterOperator
  label: string
}

const TEXT_OPERATORS: OperatorOption[] = [
  { value: 'startsWith', label: 'empieza por' },
  { value: 'contains', label: 'contiene' },
  { value: 'notContains', label: 'no contiene' },
  { value: 'equals', label: 'es exactamente' },
  { value: 'notEquals', label: 'no es exactamente' },
  { value: 'isBlank', label: 'está en blanco' },
  { value: 'isNotBlank', label: 'no está en blanco' },
]

const NUMBER_OPERATORS: OperatorOption[] = [
  { value: 'eq', label: 'es igual a' },
  { value: 'neq', label: 'no es igual a' },
  { value: 'gt', label: 'mayor que' },
  { value: 'gte', label: 'mayor o igual que' },
  { value: 'lt', label: 'menor que' },
  { value: 'lte', label: 'menor o igual que' },
  { value: 'between', label: 'entre' },
]

const DATE_OPERATORS: OperatorOption[] = [
  { value: 'eq', label: 'es igual a' },
  { value: 'before', label: 'antes de' },
  { value: 'after', label: 'después de' },
  { value: 'between', label: 'entre' },
]

const ENUM_OPERATORS: OperatorOption[] = [
  { value: 'equals', label: 'es exactamente' },
  { value: 'notEquals', label: 'no es exactamente' },
]

const OPERATORS_BY_TYPE: Record<FilterType, OperatorOption[]> = {
  text: TEXT_OPERATORS,
  number: NUMBER_OPERATORS,
  date: DATE_OPERATORS,
  enum: ENUM_OPERATORS,
}

/**
 * Operators offered for a column type, in menu order (the first one is the
 * default). Pass `allowed` to restrict the menu to the operators a given
 * column can express correctly — e.g. a column routed to a server filter
 * that only supports equality offers just "es exactamente". An `allowed`
 * list that matches nothing falls back to the full catalog.
 */
export function getOperators(type: FilterType, allowed?: FilterOperator[]): OperatorOption[] {
  const all = OPERATORS_BY_TYPE[type]
  if (!allowed || allowed.length === 0) return all
  const allowedSet = new Set(allowed)
  const filtered = all.filter((o) => allowedSet.has(o.value))
  return filtered.length > 0 ? filtered : all
}

export function defaultOperator(type: FilterType, allowed?: FilterOperator[]): FilterOperator {
  return getOperators(type, allowed)[0].value
}

/** Operators with no value control ("está en blanco" / "no está en blanco"). */
export function operatorNeedsValue(operator: FilterOperator): boolean {
  return operator !== 'isBlank' && operator !== 'isNotBlank'
}

export function operatorNeedsRange(operator: FilterOperator): boolean {
  return operator === 'between'
}

// Only the vowels fold: "ñ" is its own Spanish letter, not an accented "n" —
// generic NFD stripping would turn it into "n" (ñ decomposes to n + ◌̃) and
// wrongly match unrelated words ("año" / "ano").
const ACCENT_FOLD: Record<string, string> = {
  á: 'a', à: 'a', ä: 'a', â: 'a',
  é: 'e', è: 'e', ë: 'e', ê: 'e',
  í: 'i', ì: 'i', ï: 'i', î: 'i',
  ó: 'o', ò: 'o', ö: 'o', ô: 'o',
  ú: 'u', ù: 'u', ü: 'u', û: 'u',
}

/** Lowercase, trimmed, vowel-accents folded — case- and accent-insensitive text compare. */
export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[áàäâéèëêíìïîóòöôúùüû]/g, (ch) => ACCENT_FOLD[ch] ?? ch)
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** Calendar-day key ("YYYY-MM-DD") so day-only compares never drift with time-of-day or TZ. */
function toDayKey(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(d.getTime())) return null
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isBlankText(value: unknown): boolean {
  return String(value ?? '').trim() === ''
}

/** Builds the `(rawValue) => boolean` check for one column filter. */
export function buildPredicate(filter: ColumnFilterValue): (raw: CellValue) => boolean {
  const { type, operator } = filter

  if (type === 'text') {
    if (operator === 'isBlank') return (raw) => isBlankText(raw)
    if (operator === 'isNotBlank') return (raw) => !isBlankText(raw)
    const needle = normalizeText(filter.value)
    switch (operator as TextOperator) {
      case 'contains':
        return (raw) => normalizeText(raw).includes(needle)
      case 'notContains':
        return (raw) => !normalizeText(raw).includes(needle)
      case 'equals':
        return (raw) => normalizeText(raw) === needle
      case 'notEquals':
        return (raw) => normalizeText(raw) !== needle
      case 'startsWith':
      default:
        return (raw) => normalizeText(raw).startsWith(needle)
    }
  }

  if (type === 'enum') {
    const needle = normalizeText(filter.value)
    return operator === 'notEquals'
      ? (raw) => normalizeText(raw) !== needle
      : (raw) => normalizeText(raw) === needle
  }

  if (type === 'number') {
    const value = parseNumber(filter.value)
    const valueTo = parseNumber(filter.valueTo)
    return (raw) => {
      const n = parseNumber(raw)
      if (n === null) return false
      switch (operator as NumberOperator) {
        case 'eq':
          return value !== null && n === value
        case 'neq':
          return value !== null && n !== value
        case 'gt':
          return value !== null && n > value
        case 'gte':
          return value !== null && n >= value
        case 'lt':
          return value !== null && n < value
        case 'lte':
          return value !== null && n <= value
        case 'between':
          return value !== null && valueTo !== null && n >= Math.min(value, valueTo) && n <= Math.max(value, valueTo)
        default:
          return true
      }
    }
  }

  // date
  const key = toDayKey(filter.value)
  const keyTo = toDayKey(filter.valueTo)
  return (raw) => {
    const k = toDayKey(raw)
    if (k === null) return false
    switch (operator as DateOperator) {
      case 'eq':
        return key !== null && k === key
      case 'before':
        return key !== null && k < key
      case 'after':
        return key !== null && k > key
      case 'between': {
        if (key === null || keyTo === null) return false
        const [lo, hi] = key <= keyTo ? [key, keyTo] : [keyTo, key]
        return k >= lo && k <= hi
      }
      default:
        return true
    }
  }
}

function isEmptyForSort(value: CellValue, type: FilterType): boolean {
  if (value === null || value === undefined) return true
  if (type === 'number') return parseNumber(value) === null
  if (type === 'date') return toDayKey(value) === null
  return String(value).trim() === ''
}

/**
 * Compares two cell values for sorting. Nulls/blank/unparsable values always
 * sort after every real value, in both directions — "nulls last" regardless
 * of ascending or descending.
 */
export function compareValues(a: CellValue, b: CellValue, type: FilterType, direction: SortDirection = 'asc'): number {
  const aEmpty = isEmptyForSort(a, type)
  const bEmpty = isEmptyForSort(b, type)
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1

  let result: number
  if (type === 'number') {
    result = (parseNumber(a) as number) - (parseNumber(b) as number)
  } else if (type === 'date') {
    const ka = toDayKey(a) as string
    const kb = toDayKey(b) as string
    result = ka < kb ? -1 : ka > kb ? 1 : 0
  } else {
    result = normalizeText(a).localeCompare(normalizeText(b), 'es')
  }
  return direction === 'asc' ? result : -result
}

/** Same wording for every column type (texts, numbers, dates): the app-wide standard. */
export const sortLabels = { asc: '↑ Ordenar de A a Z', desc: '↓ Ordenar de Z a A' } as const
