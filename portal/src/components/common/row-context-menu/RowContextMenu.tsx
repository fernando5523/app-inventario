import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { computeMenuPosition } from './position'
import type { RowMenuAnchor, RowMenuItem } from './types'

interface RowContextMenuProps {
  items: RowMenuItem[]
  anchor: RowMenuAnchor
  onClose: () => void
  /** Adónde vuelve el foco al cerrar con Escape (el elemento que tenía el foco al abrir). */
  returnFocus?: HTMLElement | null
  ariaLabel?: string
}

const ITEM_CLASS = 'w-full text-left px-3 py-[4px] text-[11px] flex items-center gap-2 transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent'
const ITEM_TONE = {
  default: 'text-[var(--fg)] hover:bg-[var(--bg-rail)] focus:bg-[var(--bg-rail)]',
  danger: 'text-[var(--danger)] hover:bg-[var(--danger-light)] focus:bg-[var(--danger-light)]',
}

/**
 * Menú de acciones de una fila, con el estilo de dropdown del sistema. Se pinta
 * en un portal con posición fija dentro de la ventana y se cierra con clic afuera,
 * Escape (salvo que otro componente ya lo atendiera), scroll, cambio de tamaño o
 * al elegir una acción. Accesible como `menu`: el foco entra al primer ítem y las
 * flechas recorren los habilitados.
 */
export function RowContextMenu({ items, anchor, onClose, returnFocus, ariaLabel = 'Acciones' }: RowContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const noteId = useId()
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const visibleItems = items.filter((item) => !item.hidden)
  const isEmpty = visibleItems.length === 0
  // Motivos de los ítems deshabilitados, sin repetir: se explican al pie del menú.
  const disabledReasons = Array.from(
    new Set(visibleItems.filter((item) => item.disabled && item.disabledReason).map((item) => item.disabledReason!))
  )

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Sin acciones visibles no hay menú (ni uno vacío): se cierra solo.
  useEffect(() => {
    if (isEmpty) onCloseRef.current()
  }, [isEmpty])

  const enabledItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])

  // Se mide ya renderizado (oculto) y se coloca antes de pintar: sin salto visible.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPosition(
      computeMenuPosition(anchor, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight })
    )
  }, [anchor.x, anchor.y, anchor.align, anchor.flipY])

  useEffect(() => {
    if (position) enabledItems()[0]?.focus({ preventScroll: true })
  }, [position === null])

  useEffect(() => {
    const handlePointerDown = (e: Event) => {
      const target = e.target as Element | null
      if (!target || menuRef.current?.contains(target)) return
      onCloseRef.current()
    }
    // Mismo criterio que los modales (T-013): si otro componente ya atendió el
    // Escape, no es para este menú.
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      onCloseRef.current()
    }
    const handleDismiss = () => onCloseRef.current()

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleDismiss)
    window.addEventListener('scroll', handleDismiss, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleDismiss)
      window.removeEventListener('scroll', handleDismiss, true)
    }
  }, [])

  const handleMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = enabledItems()
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement)
    const focusAt = (i: number) => enabled[(i + enabled.length) % enabled.length]?.focus()

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusAt(index + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        focusAt(index <= 0 ? enabled.length - 1 : index - 1)
        break
      case 'Home':
        e.preventDefault()
        focusAt(0)
        break
      case 'End':
        e.preventDefault()
        focusAt(enabled.length - 1)
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        returnFocus?.focus?.()
        break
      case 'Tab':
        onClose()
        break
    }
  }

  if (isEmpty) return null

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      onKeyDown={handleMenuKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[70] bg-white rounded-lg border border-[var(--border)] shadow-md w-32 py-0.5 animate-fade-in overflow-hidden"
      style={{
        top: position?.top ?? anchor.y,
        left: position?.left ?? anchor.x,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {visibleItems.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          tabIndex={-1}
          disabled={item.disabled}
          title={item.disabled ? item.disabledReason : undefined}
          aria-describedby={
            item.disabled && item.disabledReason ? `${noteId}-${disabledReasons.indexOf(item.disabledReason)}` : undefined
          }
          onClick={() => {
            onClose()
            item.onSelect()
          }}
          className={`${ITEM_CLASS} ${item.danger ? ITEM_TONE.danger : ITEM_TONE.default}`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
      {/* Nota visual; los lectores la reciben por aria-describedby del ítem deshabilitado. */}
      {disabledReasons.map((reason, index) => (
        <p
          key={reason}
          id={`${noteId}-${index}`}
          aria-hidden="true"
          className="px-3 py-1 text-[10px] text-[var(--fg-muted)] border-t border-[var(--border)]"
        >
          {reason}
        </p>
      ))}
    </div>,
    document.body
  )
}
