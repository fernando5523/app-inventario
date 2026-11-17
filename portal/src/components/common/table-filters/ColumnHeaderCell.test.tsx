import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ColumnHeaderCell, type ColumnHeaderCellProps } from './ColumnHeaderCell'
import type { ColumnFilterValue, SortDirection } from './operators'

function TextHeader(props: Partial<ColumnHeaderCellProps> = {}) {
  const [sort, setSort] = useState<SortDirection | null>(null)
  const [filter, setFilter] = useState<ColumnFilterValue | null>(null)
  return (
    <table>
      <thead>
        <tr>
          <th>
            <ColumnHeaderCell
              label="Ubicación"
              sortable
              currentSort={sort}
              onSort={setSort}
              filterType="text"
              currentFilter={filter}
              onApplyFilter={setFilter}
              onClearFilter={() => setFilter(null)}
              {...props}
            />
          </th>
        </tr>
      </thead>
    </table>
  )
}

async function chooseOperator(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, label: string, option: string) {
  await user.click(within(dialog).getByRole('button', { name: `Operador para ${label}` }))
  await user.click(within(screen.getByRole('listbox', { name: `Operadores de ${label}` })).getByRole('option', { name: option }))
}

describe('ColumnHeaderCell — plain header', () => {
  it('a column without sort or filter renders a plain span, no button', () => {
    render(
      <table>
        <thead>
          <tr>
            <th>
              <ColumnHeaderCell label="Precio" onSort={vi.fn()} onApplyFilter={vi.fn()} onClearFilter={vi.fn()} />
            </th>
          </tr>
        </thead>
      </table>
    )
    expect(screen.getByText('Precio').tagName).toBe('SPAN')
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('ColumnHeaderCell — header button', () => {
  it('has the expected aria attributes, closed by default', () => {
    render(<TextHeader />)
    const button = screen.getByRole('button', { name: 'Opciones de columna Ubicación' })
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the menu on click; aria-expanded flips and the dialog appears', async () => {
    const user = userEvent.setup()
    render(<TextHeader />)
    const button = screen.getByRole('button', { name: 'Opciones de columna Ubicación' })

    await user.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: 'Ubicación' })).toBeInTheDocument()
  })
})

describe('ColumnHeaderCell — sort', () => {
  it('shows the text sort labels and sorts immediately on click, closing the menu', async () => {
    const user = userEvent.setup()
    render(<TextHeader />)
    await user.click(screen.getByRole('button', { name: 'Opciones de columna Ubicación' }))

    const dialog = screen.getByRole('dialog', { name: 'Ubicación' })
    expect(within(dialog).getByRole('button', { name: '↑ Ordenar de A a Z' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '↓ Ordenar de Z a A' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '↑ Ordenar de A a Z' }))

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('number columns use the same A a Z / Z a A wording as every column', async () => {
    const user = userEvent.setup()
    render(
      <table>
        <thead>
          <tr>
            <th>
              <ColumnHeaderCell label="Precio" sortable currentSort={null} onSort={vi.fn()} filterType="number" onApplyFilter={vi.fn()} onClearFilter={vi.fn()} />
            </th>
          </tr>
        </thead>
      </table>
    )
    await user.click(screen.getByRole('button', { name: 'Opciones de columna Precio' }))
    const dialog = screen.getByRole('dialog', { name: 'Precio' })
    expect(within(dialog).getByRole('button', { name: '↑ Ordenar de A a Z' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '↓ Ordenar de Z a A' })).toBeInTheDocument()
  })
})

describe('ColumnHeaderCell — operator and value', () => {
  it('defaults to "empieza por" and changing the operator updates the select', async () => {
    const user = userEvent.setup()
    render(<TextHeader />)
    await user.click(screen.getByRole('button', { name: 'Opciones de columna Ubicación' }))
    const dialog = screen.getByRole('dialog', { name: 'Ubicación' })
    const operator = within(dialog).getByRole('button', { name: 'Operador para Ubicación' })

    expect(operator).toHaveTextContent('empieza por')
    await chooseOperator(user, dialog, 'Ubicación', 'contiene')
    expect(operator).toHaveTextContent('contiene')
    // The list closed and the header menu is still open.
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Ubicación' })).toBeInTheDocument()
  })

  it('blank operators hide the value control', async () => {
    const user = userEvent.setup()
    render(<TextHeader />)
    await user.click(screen.getByRole('button', { name: 'Opciones de columna Ubicación' }))
    const dialog = screen.getByRole('dialog', { name: 'Ubicación' })

    await chooseOperator(user, dialog, 'Ubicación', 'está en blanco')
    expect(within(dialog).queryByLabelText('Valor para Ubicación')).toBeNull()
  })

  it('"entre" shows two value inputs', async () => {
    const user = userEvent.setup()
    render(
      <table>
        <thead>
          <tr>
            <th>
              <ColumnHeaderCell label="Precio" sortable currentSort={null} onSort={vi.fn()} filterType="number" onApplyFilter={vi.fn()} onClearFilter={vi.fn()} />
            </th>
          </tr>
        </thead>
      </table>
    )
    await user.click(screen.getByRole('button', { name: 'Opciones de columna Precio' }))
    const dialog = screen.getByRole('dialog', { name: 'Precio' })
    await chooseOperator(user, dialog, 'Precio', 'entre')

    expect(within(dialog).getByLabelText('Valor desde para Precio')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Valor hasta para Precio')).toBeInTheDocument()
  })

  it('`operators` restricts the operator dropdown (e.g. a server-equality-only enum column)', async () => {
    const user = userEvent.setup()
    render(
      <table>
        <thead>
          <tr>
            <th>
              <ColumnHeaderCell
                label="Categoría"
                filterType="enum"
                operators={['equals']}
                options={[{ value: 'Aceites', label: 'Aceites' }]}
                onSort={vi.fn()}
                onApplyFilter={vi.fn()}
                onClearFilter={vi.fn()}
              />
            </th>
          </tr>
        </thead>
      </table>
    )
    await user.click(screen.getByRole('button', { name: 'Opciones de columna Categoría' }))
    const dialog = screen.getByRole('dialog', { name: 'Categoría' })
    await user.click(within(dialog).getByRole('button', { name: 'Operador para Categoría' }))
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['es exactamente'])
  })

  it('an enum column picks its value from a searchable list (no native select)', async () => {
    const user = userEvent.setup()
    render(
      <table>
        <thead>
          <tr>
            <th>
              <ColumnHeaderCell
                label="Estado"
                filterType="enum"
                options={[{ value: 'Activo', label: 'Activo' }, { value: 'Inactivo', label: 'Inactivo' }]}
                onSort={vi.fn()}
                onApplyFilter={vi.fn()}
                onClearFilter={vi.fn()}
              />
            </th>
          </tr>
        </thead>
      </table>
    )
    await user.click(screen.getByRole('button', { name: 'Opciones de columna Estado' }))
    const dialog = screen.getByRole('dialog', { name: 'Estado' })
    expect(dialog.querySelector('select')).toBeNull()
    await user.click(within(dialog).getByRole('combobox', { name: 'Valor para Estado' }))
    const list = await screen.findByRole('listbox')
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Activo', 'Inactivo'])
    // Picking a value inside the select's portal does not close the header menu.
    await user.click(within(list).getByRole('option', { name: 'Inactivo' }))
    expect(screen.getByRole('dialog', { name: 'Estado' })).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: 'Valor para Estado' })).toHaveTextContent('Inactivo')
  })
})

describe('ColumnHeaderCell — Aplicar / Borrar', () => {
  it('Aplicar calls onApplyFilter with the chosen operator and value, and closes', async () => {
    const user = userEvent.setup()
    const onApplyFilter = vi.fn()
    render(<TextHeader onApplyFilter={onApplyFilter} />)
    await user.click(screen.getByRole('button', { name: 'Opciones de columna Ubicación' }))
    const dialog = screen.getByRole('dialog', { name: 'Ubicación' })

    await user.type(within(dialog).getByLabelText('Valor para Ubicación'), 'GAF')
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar' }))

    expect(onApplyFilter).toHaveBeenCalledWith({ type: 'text', operator: 'startsWith', value: 'GAF', valueTo: undefined })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Aplicar is disabled until a value-requiring operator has a value', async () => {
    const user = userEvent.setup()
    render(<TextHeader />)
    await user.click(screen.getByRole('button', { name: 'Opciones de columna Ubicación' }))
    const dialog = screen.getByRole('dialog', { name: 'Ubicación' })

    expect(within(dialog).getByRole('button', { name: 'Aplicar' })).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Valor para Ubicación'), 'x')
    expect(within(dialog).getByRole('button', { name: 'Aplicar' })).toBeEnabled()
  })

  it('Borrar calls onClearFilter and closes', async () => {
    const user = userEvent.setup()
    const onClearFilter = vi.fn()
    render(<TextHeader currentFilter={{ type: 'text', operator: 'startsWith', value: 'GAF' }} onClearFilter={onClearFilter} />)
    await user.click(screen.getByRole('button', { name: 'Opciones de columna Ubicación' }))
    const dialog = screen.getByRole('dialog', { name: 'Ubicación' })

    await user.click(within(dialog).getByRole('button', { name: 'Borrar' }))

    expect(onClearFilter).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a column with an active filter shows the filter glyph on its header', () => {
    render(<TextHeader currentFilter={{ type: 'text', operator: 'startsWith', value: 'GAF' }} />)
    expect(screen.getByRole('button', { name: 'Opciones de columna Ubicación' }).querySelector('svg')).toBeInTheDocument()
  })
})

describe('ColumnHeaderCell — Enter / Esc / outside click', () => {
  it('Enter in the value input applies the filter', async () => {
    const user = userEvent.setup()
    const onApplyFilter = vi.fn()
    render(<TextHeader onApplyFilter={onApplyFilter} />)
    await user.click(screen.getByRole('button', { name: 'Opciones de columna Ubicación' }))
    const dialog = screen.getByRole('dialog', { name: 'Ubicación' })

    await user.type(within(dialog).getByLabelText('Valor para Ubicación'), 'GAF{Enter}')

    expect(onApplyFilter).toHaveBeenCalledWith({ type: 'text', operator: 'startsWith', value: 'GAF', valueTo: undefined })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Esc closes the menu and returns focus to the header button', async () => {
    const user = userEvent.setup()
    render(<TextHeader />)
    const button = screen.getByRole('button', { name: 'Opciones de columna Ubicación' })
    await user.click(button)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(button).toHaveFocus()
  })

  it('a click outside the menu closes it without applying', async () => {
    const user = userEvent.setup()
    const onApplyFilter = vi.fn()
    render(<TextHeader onApplyFilter={onApplyFilter} />)
    await user.click(screen.getByRole('button', { name: 'Opciones de columna Ubicación' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(document.body)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onApplyFilter).not.toHaveBeenCalled()
  })
})

describe('OperatorPicker — keyboard', () => {
  it('ArrowDown opens the list, arrows move, Enter chooses; Escape closes only the list', async () => {
    const user = userEvent.setup()
    render(<TextHeader />)
    await user.click(screen.getByRole('button', { name: 'Opciones de columna Ubicación' }))
    const dialog = screen.getByRole('dialog', { name: 'Ubicación' })
    const operator = within(dialog).getByRole('button', { name: 'Operador para Ubicación' })

    operator.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toHaveFocus()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(operator).toHaveTextContent('contiene')

    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Ubicación' })).toBeInTheDocument()
  })
})
