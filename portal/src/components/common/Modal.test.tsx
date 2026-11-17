import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from './Modal'

/** The backdrop is the only full-viewport element; the panel sits inside it. */
function backdrop(): HTMLElement {
  const el = document.querySelector('.fixed.inset-0')
  if (!el) throw new Error('backdrop not rendered')
  return el as HTMLElement
}

describe('Modal', () => {
  it('closes on a backdrop click when there is nothing to lose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal onClose={onClose}>
        <p>contenido</p>
      </Modal>
    )

    await user.click(backdrop())

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores a backdrop click while the form has unsaved changes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal onClose={onClose} isDirty>
        <p>contenido</p>
      </Modal>
    )

    await user.click(backdrop())

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('contenido')).toBeInTheDocument()
  })

  it('never closes from a click inside the panel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal onClose={onClose}>
        <button type="button">Guardar</button>
      </Modal>
    )

    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape when clean', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Modal onClose={onClose}>contenido</Modal>)

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores Escape while dirty', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal onClose={onClose} isDirty>
        contenido
      </Modal>
    )

    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()
  })

  it('honours a dirty flag that flips after mount', async () => {
    // The Escape listener is bound once and reads isDirty through a ref, so a
    // stale closure here would let the very first keystroke discard the work.
    const user = userEvent.setup()
    const onClose = vi.fn()

    function Host() {
      const [dirty, setDirty] = useState(false)
      return (
        <Modal onClose={onClose} isDirty={dirty}>
          <input aria-label="nombre" onChange={() => setDirty(true)} />
        </Modal>
      )
    }
    render(<Host />)

    await user.type(screen.getByLabelText('nombre'), 'a')
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()

    await user.click(backdrop())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stops listening for Escape once unmounted', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { unmount } = render(<Modal onClose={onClose}>contenido</Modal>)

    unmount()
    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()
  })

  it('applies the size that matches its Tailwind name', () => {
    const { container } = render(
      <Modal onClose={() => {}} size="2xl">
        contenido
      </Modal>
    )
    expect(container.querySelector('.max-w-2xl')).toBeTruthy()
  })
})
