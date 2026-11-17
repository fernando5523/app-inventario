import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { buildQueryGetters, useTableQuery } from './useTableQuery'

interface Row {
  id: number
  nombre: string
  categoria: string
  precio: number
  fecha: string
}

const rows: Row[] = [
  { id: 1, nombre: 'Aceite Vegetal 1L', categoria: 'Aceites', precio: 5.5, fecha: '2024-01-10' },
  { id: 2, nombre: 'Agua San Luis 625ml', categoria: 'Aguas', precio: 1.3, fecha: '2024-02-20' },
  { id: 3, nombre: 'Arroz Extra 5kg', categoria: 'Granos', precio: 19.9, fecha: '2024-03-05' },
]

function setup() {
  return renderHook(() =>
    useTableQuery<Row>({
      rows,
      getQuickFilterText: (r) => `${r.nombre} ${r.categoria}`,
      filterGetters: {
        nombre: (r) => r.nombre,
        categoria: (r) => r.categoria,
        precio: (r) => r.precio,
        fecha: (r) => r.fecha,
      },
      filterTypes: { nombre: 'text', categoria: 'text', precio: 'number', fecha: 'date' },
    })
  )
}

describe('useTableQuery', () => {
  it('with nothing set, returns all rows unchanged', () => {
    const { result } = setup()
    expect(result.current.rows.map((r) => r.id)).toEqual([1, 2, 3])
  })

  it('quick filter narrows across the configured text', () => {
    const { result } = setup()
    act(() => result.current.setQuickFilter('agua'))
    expect(result.current.rows.map((r) => r.id)).toEqual([2])
  })

  it('a column filter narrows the rows', () => {
    const { result } = setup()
    act(() => result.current.setColumnFilter('categoria', { type: 'text', operator: 'startsWith', value: 'A' }))
    expect(result.current.rows.map((r) => r.id)).toEqual([1, 2])
  })

  it('column filters across different columns combine with AND', () => {
    const { result } = setup()
    act(() => {
      result.current.setColumnFilter('categoria', { type: 'text', operator: 'startsWith', value: 'A' })
      result.current.setColumnFilter('precio', { type: 'number', operator: 'lt', value: '2' })
    })
    expect(result.current.rows.map((r) => r.id)).toEqual([2])
  })

  it('the quick filter combines with column filters too', () => {
    const { result } = setup()
    act(() => {
      result.current.setColumnFilter('categoria', { type: 'text', operator: 'startsWith', value: 'A' })
      result.current.setQuickFilter('vegetal')
    })
    expect(result.current.rows.map((r) => r.id)).toEqual([1])
  })

  it('clearColumnFilter removes just that column filter', () => {
    const { result } = setup()
    act(() => {
      result.current.setColumnFilter('categoria', { type: 'text', operator: 'startsWith', value: 'A' })
      result.current.setColumnFilter('precio', { type: 'number', operator: 'lt', value: '2' })
    })
    act(() => result.current.clearColumnFilter('precio'))
    expect(result.current.rows.map((r) => r.id)).toEqual([1, 2])
    expect(result.current.columnFilters.precio).toBeUndefined()
    expect(result.current.columnFilters.categoria).toBeDefined()
  })

  it('setSortColumn sorts by the chosen column and direction; only one sort column is kept', () => {
    const { result } = setup()
    act(() => result.current.setSortColumn('precio', 'asc'))
    expect(result.current.rows.map((r) => r.id)).toEqual([2, 1, 3])

    act(() => result.current.setSortColumn('nombre', 'desc'))
    expect(result.current.sort).toEqual({ columnId: 'nombre', direction: 'desc' })
    expect(result.current.rows.map((r) => r.id)).toEqual([3, 2, 1])
  })

  it('clearSort returns to the original order', () => {
    const { result } = setup()
    act(() => result.current.setSortColumn('precio', 'desc'))
    act(() => result.current.clearSort())
    expect(result.current.sort).toBeNull()
    expect(result.current.rows.map((r) => r.id)).toEqual([1, 2, 3])
  })

  it('sort respects the date filter type', () => {
    const { result } = setup()
    act(() => result.current.setSortColumn('fecha', 'desc'))
    expect(result.current.rows.map((r) => r.id)).toEqual([3, 2, 1])
  })

  it('clearAllColumnFilters drops every column filter but keeps the quick filter', () => {
    const { result } = setup()
    act(() => {
      result.current.setColumnFilter('categoria', { type: 'text', operator: 'startsWith', value: 'A' })
      result.current.setQuickFilter('vegetal')
    })
    act(() => result.current.clearAllColumnFilters())
    expect(result.current.columnFilters).toEqual({})
    expect(result.current.quickFilter).toBe('vegetal')
    expect(result.current.rows.map((r) => r.id)).toEqual([1])
  })
})

describe('buildQueryGetters', () => {
  it('derives filterGetters/filterTypes from each column\'s `filter.value`', () => {
    const { filterGetters, filterTypes } = buildQueryGetters<Row>([
      { id: 'nombre', filter: { type: 'text', value: (r) => r.nombre } },
      { id: 'precio', filter: { type: 'number', value: (r) => r.precio } },
      { id: 'fecha' }, // no filter: contributes nothing
    ])
    expect(Object.keys(filterGetters)).toEqual(['nombre', 'precio'])
    expect(filterTypes).toEqual({ nombre: 'text', precio: 'number' })
    expect(filterGetters.nombre(rows[0])).toBe('Aceite Vegetal 1L')
  })

  it('a column with its own sortValue is sortable even without a filter', () => {
    const { sortGetters } = buildQueryGetters<Row>([{ id: 'fecha', sortValue: (r) => r.fecha }])
    expect(sortGetters.fecha(rows[0])).toBe('2024-01-10')
  })

  it('sortable: true falls back to filter.value when there is no explicit sortValue', () => {
    const { sortGetters } = buildQueryGetters<Row>([
      { id: 'categoria', filter: { type: 'text', value: (r) => r.categoria }, sortable: true },
    ])
    expect(sortGetters.categoria(rows[0])).toBe('Aceites')
  })

  it('a filterable column that is not `sortable` and has no `sortValue` is not sortable', () => {
    const { sortGetters } = buildQueryGetters<Row>([{ id: 'categoria', filter: { type: 'text', value: (r) => r.categoria } }])
    expect(sortGetters.categoria).toBeUndefined()
  })
})
