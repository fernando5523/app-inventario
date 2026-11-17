import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { QuickFilterInput } from './QuickFilterInput'

describe('QuickFilterInput', () => {
  it('renders with the "Filtro" placeholder and aria-label', () => {
    render(<QuickFilterInput value="" onChange={vi.fn()} />)
    const input = screen.getByRole('textbox', { name: 'Filtro' })
    expect(input).toHaveAttribute('placeholder', 'Filtro')
  })

  it('reports every keystroke through onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<QuickFilterInput value="" onChange={onChange} />)

    await user.type(screen.getByRole('textbox', { name: 'Filtro' }), 'ace')

    expect(onChange).toHaveBeenCalledTimes(3)
    expect(onChange).toHaveBeenLastCalledWith('e')
  })

  it('shows the controlled value', () => {
    render(<QuickFilterInput value="arroz" onChange={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'Filtro' })).toHaveValue('arroz')
  })
})
