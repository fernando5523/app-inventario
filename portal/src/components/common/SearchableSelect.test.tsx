import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchableSelect, selectEvent } from './SearchableSelect'

const CATEGORIES = [
  { value: '1', label: 'Leche' },
  { value: '2', label: 'Categoría de Limpieza' },
  { value: '3', label: 'Panadería' },
  { value: '4', label: 'Bebidas' },
  { value: '5', label: 'Abarrotes' },
  { value: '6', label: 'Congelados' },
  { value: '7', label: 'Licores' },
  { value: '8', label: 'Ferretería' },
  { value: '9', label: 'Electrodomésticos' },
]

const FEW = CATEGORIES.slice(0, 3)

function renderSelect(props: Partial<React.ComponentProps<typeof SearchableSelect>> = {}) {
  const onChange = vi.fn()
  render(
    <SearchableSelect options={CATEGORIES} value="" onChange={onChange} {...props} />
  )
  return { onChange }
}

const combobox = () => screen.getByRole('combobox')
const options = () => within(screen.getByRole('listbox')).getAllByRole('option')

describe('SearchableSelect', () => {
  it('shows the placeholder until something is selected', () => {
    renderSelect({ placeholder: 'Seleccionar categoría' })
    expect(combobox()).toHaveTextContent('Seleccionar categoría')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('renders the dropdown in a portal so overflow containers cannot clip it', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <div style={{ overflow: 'hidden' }}>
        <SearchableSelect options={CATEGORIES} value="" onChange={() => {}} />
      </div>
    )
    await user.click(screen.getByRole('combobox'))

    const listbox = screen.getByRole('listbox')
    expect(listbox).toBeInTheDocument()
    // The list must live outside the clipping ancestor React rendered into.
    expect(container.contains(listbox)).toBe(false)
    expect(document.body.contains(listbox)).toBe(true)
  })

  it('filters options by typed text', async () => {
    const user = userEvent.setup()
    renderSelect()
    await user.click(combobox())

    await user.type(screen.getByPlaceholderText('Buscar...'), 'lic')

    expect(options()).toHaveLength(1)
    expect(options()[0]).toHaveTextContent('Licores')
  })

  it('matches accented labels when the user types without accents', async () => {
    const user = userEvent.setup()
    renderSelect()
    await user.click(combobox())

    await user.type(screen.getByPlaceholderText('Buscar...'), 'panaderia')

    expect(options()).toHaveLength(1)
    expect(options()[0]).toHaveTextContent('Panadería')
  })

  it('matches unaccented labels when the user types with accents', async () => {
    const user = userEvent.setup()
    renderSelect()
    await user.click(combobox())

    await user.type(screen.getByPlaceholderText('Buscar...'), 'léche')

    expect(options()).toHaveLength(1)
    expect(options()[0]).toHaveTextContent('Leche')
  })

  it('reports when nothing matches', async () => {
    const user = userEvent.setup()
    renderSelect()
    await user.click(combobox())

    await user.type(screen.getByPlaceholderText('Buscar...'), 'zzzz')

    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No se encontraron resultados')).toBeInTheDocument()
  })

  it('offers the search box by default even for a one-option list', async () => {
    // Regression: a default threshold of 8 hid the search box on real data,
    // where a fresh install has a single category. Searchable is the default.
    const user = userEvent.setup()
    render(
      <SearchableSelect
        options={[{ value: '1', label: 'Leche' }]}
        value=""
        onChange={() => {}}
      />
    )
    await user.click(screen.getByRole('combobox'))

    expect(screen.getByPlaceholderText('Buscar...')).toBeInTheDocument()
  })

  it('focuses the search box on open so the user can type straight away', async () => {
    const user = userEvent.setup()
    renderSelect()

    await user.click(combobox())

    expect(screen.getByPlaceholderText('Buscar...')).toHaveFocus()
  })

  it('honours an explicit threshold that opts out of searching', async () => {
    const user = userEvent.setup()
    render(<SearchableSelect options={FEW} value="" onChange={() => {}} searchThreshold={99} />)

    await user.click(screen.getByRole('combobox'))

    expect(screen.queryByPlaceholderText('Buscar...')).not.toBeInTheDocument()
  })

  it('opens and seeds the search when a character is typed on the closed trigger', async () => {
    const user = userEvent.setup()
    renderSelect()

    await user.tab()
    await user.keyboard('f')

    expect(screen.getByPlaceholderText('Buscar...')).toHaveValue('f')
    expect(options()).toHaveLength(1)
    expect(options()[0]).toHaveTextContent('Ferretería')
  })

  it('emits the chosen value and closes', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelect()
    await user.click(combobox())

    await user.click(screen.getByRole('option', { name: /Bebidas/ }))

    expect(onChange).toHaveBeenCalledWith('4')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('selects with the keyboard alone', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelect()

    await user.tab()
    expect(combobox()).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await user.keyboard('{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('2')
  })

  it('closes on Escape without emitting and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelect()
    await user.click(combobox())

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(combobox()).toHaveFocus()
  })

  it('treats a numeric id from the API as equal to its string form', () => {
    // The API returns { id: 51 } while the TS type claims string; a native
    // <select> hid that by stringifying through the DOM.
    const numericOptions = [{ value: 51 as unknown as string, label: 'Leche' }]
    render(
      <SearchableSelect options={numericOptions} value={51 as unknown as string} onChange={() => {}} />
    )
    expect(screen.getByRole('combobox')).toHaveTextContent('Leche')
  })

  it('emits a string even when the option value arrived as a number', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const numericOptions = [{ value: 51 as unknown as string, label: 'Leche' }]
    render(<SearchableSelect options={numericOptions} value="" onChange={onChange} />)

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /Leche/ }))

    expect(onChange).toHaveBeenCalledWith('51')
    expect(typeof onChange.mock.calls[0][0]).toBe('string')
  })

  it('does not open when disabled', async () => {
    const user = userEvent.setup()
    renderSelect({ disabled: true })

    await user.click(combobox())

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('skips disabled options during keyboard navigation', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SearchableSelect
        options={[
          { value: 'a', label: 'Alfa' },
          { value: 'b', label: 'Beta', disabled: true },
          { value: 'c', label: 'Gamma' },
        ]}
        value=""
        onChange={onChange}
      />
    )
    await user.click(screen.getByRole('combobox'))

    await user.keyboard('{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('clears the selection through the clear affordance', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SearchableSelect options={CATEGORIES} value="1" onChange={onChange} clearable />
    )

    await user.click(screen.getByRole('button', { name: 'Limpiar seleccion' }))

    expect(onChange).toHaveBeenCalledWith('')
  })

  it('caps how many options it paints and says how many it withheld', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 250 }, (_, i) => ({
      value: String(i),
      label: `Cuenta ${i}`,
    }))
    render(<SearchableSelect options={many} value="" onChange={() => {}} />)

    await user.click(screen.getByRole('combobox'))

    expect(screen.getAllByRole('option')).toHaveLength(100)
    expect(screen.getByText(/\+150 resultados mas/)).toBeInTheDocument()
  })

  it('drives a parent that stores the selection', async () => {
    const user = userEvent.setup()
    function Host() {
      const [value, setValue] = useState('')
      return <SearchableSelect options={CATEGORIES} value={value} onChange={setValue} />
    }
    render(<Host />)

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /Abarrotes/ }))

    expect(screen.getByRole('combobox')).toHaveTextContent('Abarrotes')
  })
})

describe('selectEvent', () => {
  it('feeds a shared handleChange the shape a native select would', () => {
    const handleChange = vi.fn()
    handleChange(selectEvent('branchId', '7'))

    const event = handleChange.mock.calls[0][0]
    expect(event.target.name).toBe('branchId')
    expect(event.target.value).toBe('7')
    // Handlers branch on type for checkbox/number; a select must not match those.
    expect(event.target.type).toBe('select-one')
  })
})
