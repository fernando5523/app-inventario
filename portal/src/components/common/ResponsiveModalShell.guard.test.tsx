import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResponsiveModalShell } from './ResponsiveModalShell'

/**
 * Covers only the unsaved-changes guard. Layout and responsive behaviour are
 * covered by src/__tests__/ResponsiveModalShell.test.tsx.
 */

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

/** The backdrop is the outermost fixed layer; the panel sits inside it. */
function backdrop(): HTMLElement {
  const el = document.querySelector('.fixed.inset-0')
  if (!el) throw new Error('backdrop not rendered')
  return el as HTMLElement
}

describe('ResponsiveModalShell — unsaved changes guard', () => {
  // Typed explicitly: an untyped vi.fn() widens to Mock<Procedure> and stops
  // satisfying the shell's () => void prop.
  let onClose: () => void

  beforeEach(() => {
    onClose = vi.fn()
    setViewport(1024)
  })

  afterEach(() => {
    document.body.style.overflow = ''
  })

  const base = (extra: Record<string, unknown> = {}) => ({
    isOpen: true,
    onClose,
    title: 'Nuevo Cliente',
    children: <p>contenido</p>,
    ...extra,
  })

  it('closes on a backdrop click when there is nothing to lose', () => {
    render(<ResponsiveModalShell {...base()} />)

    fireEvent.click(backdrop())

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores a backdrop click while the form has unsaved changes', () => {
    render(<ResponsiveModalShell {...base({ isDirty: true })} />)

    fireEvent.click(backdrop())

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('contenido')).toBeInTheDocument()
  })

  it('closes on Escape when clean', async () => {
    const user = userEvent.setup()
    render(<ResponsiveModalShell {...base()} />)

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores Escape while dirty', async () => {
    const user = userEvent.setup()
    render(<ResponsiveModalShell {...base({ isDirty: true })} />)

    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()
  })

  it('still closes from the X button while dirty', async () => {
    // A deliberate close must keep working: the form owns the confirmation.
    const user = userEvent.setup()
    render(<ResponsiveModalShell {...base({ isDirty: true })} />)

    await user.click(screen.getByTitle('Cerrar'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('never closes from a click inside the panel', async () => {
    const user = userEvent.setup()
    render(
      <ResponsiveModalShell
        {...base({ children: <button type="button">Guardar</button> })}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('honours a dirty flag that flips after mount', async () => {
    // The Escape listener is bound once and reads isDirty through a ref, so a
    // stale closure would let the very first keystroke discard the work.
    const user = userEvent.setup()

    function Host() {
      const [dirty, setDirty] = useState(false)
      return (
        <ResponsiveModalShell isOpen onClose={onClose} title="Nuevo Cliente">
          <input aria-label="nombre" onChange={() => setDirty(true)} />
          <span>{dirty ? 'sucio' : 'limpio'}</span>
        </ResponsiveModalShell>
      )
    }
    // isDirty is threaded by the form in real usage; here the host re-renders
    // the shell with the new flag, which is the same code path.
    function HostWithFlag() {
      const [dirty, setDirty] = useState(false)
      return (
        <ResponsiveModalShell isOpen onClose={onClose} title="Nuevo Cliente" isDirty={dirty}>
          <input aria-label="nombre" onChange={() => setDirty(true)} />
        </ResponsiveModalShell>
      )
    }
    void Host

    render(<HostWithFlag />)

    await user.type(screen.getByLabelText('nombre'), 'a')
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(backdrop())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('guards the mobile layout too', () => {
    setViewport(500)
    render(<ResponsiveModalShell {...base({ isDirty: true })} />)

    // The mobile sheet has no backdrop, so Escape is the only accidental exit.
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
  })
})
