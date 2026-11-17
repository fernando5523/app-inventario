import { describe, expect, it } from 'vitest'
import {
  buildPredicate,
  compareValues,
  defaultOperator,
  getOperators,
  normalizeText,
  operatorNeedsRange,
  operatorNeedsValue,
  type ColumnFilterValue,
} from './operators'

describe('getOperators / defaultOperator', () => {
  it('text: empieza por is the default and first option', () => {
    expect(defaultOperator('text')).toBe('startsWith')
    expect(getOperators('text')[0]).toEqual({ value: 'startsWith', label: 'empieza por' })
    expect(getOperators('text').map((o) => o.value)).toEqual([
      'startsWith',
      'contains',
      'notContains',
      'equals',
      'notEquals',
      'isBlank',
      'isNotBlank',
    ])
  })

  it('number: es igual a is the default', () => {
    expect(defaultOperator('number')).toBe('eq')
    expect(getOperators('number').map((o) => o.value)).toEqual(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between'])
  })

  it('date: es igual a is the default', () => {
    expect(defaultOperator('date')).toBe('eq')
    expect(getOperators('date').map((o) => o.value)).toEqual(['eq', 'before', 'after', 'between'])
  })

  it('enum: es exactamente is the default', () => {
    expect(defaultOperator('enum')).toBe('equals')
    expect(getOperators('enum').map((o) => o.value)).toEqual(['equals', 'notEquals'])
  })
})

describe('getOperators / defaultOperator — restricted to what a column can express', () => {
  it('narrows the menu to the allowed operators, keeping catalog order', () => {
    expect(getOperators('enum', ['equals']).map((o) => o.value)).toEqual(['equals'])
    expect(defaultOperator('enum', ['equals'])).toBe('equals')
  })

  it('an allowed list matching nothing falls back to the full catalog', () => {
    expect(getOperators('text', ['between' as any]).map((o) => o.value)).toEqual(
      getOperators('text').map((o) => o.value)
    )
  })

  it('an empty allowed list is treated as "no restriction"', () => {
    expect(getOperators('text', []).map((o) => o.value)).toEqual(getOperators('text').map((o) => o.value))
  })
})

describe('operatorNeedsValue / operatorNeedsRange', () => {
  it('blank operators need no value control', () => {
    expect(operatorNeedsValue('isBlank')).toBe(false)
    expect(operatorNeedsValue('isNotBlank')).toBe(false)
    expect(operatorNeedsValue('contains')).toBe(true)
  })

  it('only "between" needs a second value control', () => {
    expect(operatorNeedsRange('between')).toBe(true)
    expect(operatorNeedsRange('eq')).toBe(false)
  })
})

describe('normalizeText', () => {
  it('lowercases, trims and folds vowel accents', () => {
    expect(normalizeText('  Ubicación  ')).toBe('ubicacion')
    expect(normalizeText('ÁÉÍÓÚñ')).toBe('aeiouñ') // ñ is a letter of its own, not folded to "n"
  })

  it('treats null/undefined as empty', () => {
    expect(normalizeText(null)).toBe('')
    expect(normalizeText(undefined)).toBe('')
  })
})

describe('buildPredicate — text', () => {
  const run = (filter: ColumnFilterValue, raw: string | null) => buildPredicate(filter)(raw)

  it('startsWith is case- and accent-insensitive', () => {
    const f: ColumnFilterValue = { type: 'text', operator: 'startsWith', value: 'alm' }
    expect(run(f, 'Almacén Central')).toBe(true)
    expect(run(f, 'ALMACEN norte')).toBe(true)
    expect(run(f, 'Depósito')).toBe(false)
  })

  it('contains / notContains', () => {
    expect(run({ type: 'text', operator: 'contains', value: 'cen' }, 'Almacén Central')).toBe(true)
    expect(run({ type: 'text', operator: 'notContains', value: 'cen' }, 'Almacén Central')).toBe(false)
    expect(run({ type: 'text', operator: 'notContains', value: 'zzz' }, 'Almacén Central')).toBe(true)
  })

  it('equals / notEquals compare the whole normalized value', () => {
    expect(run({ type: 'text', operator: 'equals', value: 'Almacén' }, 'almacen')).toBe(true)
    expect(run({ type: 'text', operator: 'equals', value: 'Almacén' }, 'almacen norte')).toBe(false)
    expect(run({ type: 'text', operator: 'notEquals', value: 'Almacén' }, 'almacen norte')).toBe(true)
  })

  it('isBlank / isNotBlank', () => {
    expect(run({ type: 'text', operator: 'isBlank' }, '')).toBe(true)
    expect(run({ type: 'text', operator: 'isBlank' }, '   ')).toBe(true)
    expect(run({ type: 'text', operator: 'isBlank' }, null)).toBe(true)
    expect(run({ type: 'text', operator: 'isBlank' }, 'x')).toBe(false)
    expect(run({ type: 'text', operator: 'isNotBlank' }, 'x')).toBe(true)
    expect(run({ type: 'text', operator: 'isNotBlank' }, '')).toBe(false)
  })
})

describe('buildPredicate — enum', () => {
  it('equals / notEquals, case-insensitive', () => {
    expect(buildPredicate({ type: 'enum', operator: 'equals', value: 'Activo' })('activo')).toBe(true)
    expect(buildPredicate({ type: 'enum', operator: 'equals', value: 'Activo' })('Inactivo')).toBe(false)
    expect(buildPredicate({ type: 'enum', operator: 'notEquals', value: 'Activo' })('Inactivo')).toBe(true)
  })
})

describe('buildPredicate — number', () => {
  const run = (filter: ColumnFilterValue, raw: number | string | null) => buildPredicate(filter)(raw)

  it('eq / neq', () => {
    expect(run({ type: 'number', operator: 'eq', value: '10' }, 10)).toBe(true)
    expect(run({ type: 'number', operator: 'eq', value: '10' }, 11)).toBe(false)
    expect(run({ type: 'number', operator: 'neq', value: '10' }, 11)).toBe(true)
  })

  it('gt / gte / lt / lte', () => {
    expect(run({ type: 'number', operator: 'gt', value: '10' }, 11)).toBe(true)
    expect(run({ type: 'number', operator: 'gt', value: '10' }, 10)).toBe(false)
    expect(run({ type: 'number', operator: 'gte', value: '10' }, 10)).toBe(true)
    expect(run({ type: 'number', operator: 'lt', value: '10' }, 9)).toBe(true)
    expect(run({ type: 'number', operator: 'lte', value: '10' }, 10)).toBe(true)
  })

  it('between is inclusive and order-independent', () => {
    const f: ColumnFilterValue = { type: 'number', operator: 'between', value: '10', valueTo: '20' }
    expect(run(f, 10)).toBe(true)
    expect(run(f, 20)).toBe(true)
    expect(run(f, 15)).toBe(true)
    expect(run(f, 9)).toBe(false)
    const reversed: ColumnFilterValue = { type: 'number', operator: 'between', value: '20', valueTo: '10' }
    expect(run(reversed, 15)).toBe(true)
  })

  it('a non-numeric raw value never matches', () => {
    expect(run({ type: 'number', operator: 'gte', value: '0' }, null)).toBe(false)
    expect(run({ type: 'number', operator: 'gte', value: '0' }, 'abc')).toBe(false)
  })
})

describe('buildPredicate — date', () => {
  const run = (filter: ColumnFilterValue, raw: string | Date | null) => buildPredicate(filter)(raw)

  it('eq compares by calendar day, ignoring time-of-day', () => {
    const f: ColumnFilterValue = { type: 'date', operator: 'eq', value: '2024-03-15' }
    expect(run(f, new Date('2024-03-15T23:59:00Z'))).toBe(true)
    expect(run(f, '2024-03-15')).toBe(true)
    expect(run(f, '2024-03-16')).toBe(false)
  })

  it('before / after', () => {
    expect(run({ type: 'date', operator: 'before', value: '2024-03-15' }, '2024-03-14')).toBe(true)
    expect(run({ type: 'date', operator: 'before', value: '2024-03-15' }, '2024-03-15')).toBe(false)
    expect(run({ type: 'date', operator: 'after', value: '2024-03-15' }, '2024-03-16')).toBe(true)
  })

  it('between is inclusive and order-independent', () => {
    const f: ColumnFilterValue = { type: 'date', operator: 'between', value: '2024-03-01', valueTo: '2024-03-31' }
    expect(run(f, '2024-03-01')).toBe(true)
    expect(run(f, '2024-03-31')).toBe(true)
    expect(run(f, '2024-02-28')).toBe(false)
  })

  it('an unparsable raw value never matches', () => {
    expect(run({ type: 'date', operator: 'eq', value: '2024-03-15' }, 'not-a-date')).toBe(false)
    expect(run({ type: 'date', operator: 'eq', value: '2024-03-15' }, null)).toBe(false)
  })
})

describe('compareValues — text, nulls last', () => {
  it('sorts accent-insensitively with the es locale', () => {
    expect(compareValues('Álamo', 'Banco', 'text', 'asc')).toBeLessThan(0)
    expect(compareValues('ávila', 'avila', 'text', 'asc')).toBe(0)
  })

  it('nulls sort last in both directions', () => {
    expect(compareValues(null, 'a', 'text', 'asc')).toBeGreaterThan(0)
    expect(compareValues('a', null, 'text', 'asc')).toBeLessThan(0)
    expect(compareValues(null, 'a', 'text', 'desc')).toBeGreaterThan(0)
    expect(compareValues('a', null, 'text', 'desc')).toBeLessThan(0)
    expect(compareValues(null, null, 'text', 'asc')).toBe(0)
  })

  it('desc flips the non-null order', () => {
    expect(compareValues('a', 'b', 'text', 'desc')).toBeGreaterThan(0)
  })
})

describe('compareValues — number, nulls last', () => {
  it('compares numerically, not lexicographically', () => {
    expect(compareValues(2, 10, 'number', 'asc')).toBeLessThan(0)
  })

  it('blank/NaN values sort last', () => {
    expect(compareValues(null, 5, 'number', 'asc')).toBeGreaterThan(0)
    expect(compareValues('abc', 5, 'number', 'asc')).toBeGreaterThan(0)
  })
})

describe('compareValues — date, nulls last', () => {
  it('compares by calendar day', () => {
    expect(compareValues('2024-01-01', '2024-12-31', 'date', 'asc')).toBeLessThan(0)
    expect(compareValues(new Date('2024-06-01T00:00:00Z'), '2024-01-01', 'date', 'asc')).toBeGreaterThan(0)
  })

  it('unparsable/blank values sort last', () => {
    expect(compareValues(null, '2024-01-01', 'date', 'asc')).toBeGreaterThan(0)
    expect(compareValues('not-a-date', '2024-01-01', 'date', 'asc')).toBeGreaterThan(0)
  })
})
