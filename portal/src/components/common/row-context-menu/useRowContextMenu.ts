import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type TouchEvent } from 'react'
import type { RowMenuAnchor } from './types'

/** Tiempo de pulsación larga que abre el menú en pantallas táctiles. */
export const LONG_PRESS_MS = 500
/** Si el dedo se mueve más que esto (scroll, arrastre), la pulsación larga se cancela. */
export const LONG_PRESS_MOVE_TOLERANCE = 10

export interface RowMenuState<T> {
  row: T
  key: string
  anchor: RowMenuAnchor
  /** Elemento con el foco al abrir, para devolvérselo al cerrar con Escape. */
  returnFocus: HTMLElement | null
}

/**
 * Estado y disparadores del menú de acciones de las filas de una tabla. Una sola
 * instancia por tabla, así nunca hay dos menús abiertos: abrir otro lo reemplaza.
 *
 * - `getRowProps(row, { enabled })` va en el `<tr>` del cuerpo: clic derecho,
 *   pulsación larga (~500 ms, se cancela si el dedo se mueve >10 px) y Shift+F10
 *   / tecla Menú sobre un elemento enfocado de la fila.
 * - `isOpenFor(row)` sirve para resaltar la fila mientras el menú está abierto.
 */
export function useRowContextMenu<T>(getKey: (row: T) => string) {
  const [state, setState] = useState<RowMenuState<T> | null>(null)
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; fired: boolean } | null>(null)
  const getKeyRef = useRef(getKey)
  getKeyRef.current = getKey

  const open = useCallback((row: T, anchor: RowMenuAnchor) => {
    setState({
      row,
      key: String(getKeyRef.current(row)),
      anchor,
      returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    })
  }, [])

  const close = useCallback(() => setState(null), [])

  const clearLongPressTimer = () => {
    if (longPress.current?.timer) clearTimeout(longPress.current.timer)
    if (longPress.current) longPress.current.timer = null
  }

  useEffect(() => () => clearLongPressTimer(), [])

  /**
   * `enabled: false` es para una fila sin acciones visibles (p.ej. sin permisos):
   * el clic derecho no hace nada, ni siquiera el menú del navegador, y la
   * pulsación larga y Shift+F10 / tecla Menú no abren nada.
   */
  const getRowProps = (row: T, { enabled = true }: { enabled?: boolean } = {}) => ({
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      e.preventDefault()
      if (enabled) open(row, { x: e.clientX, y: e.clientY })
    },
    onTouchStart: (e: TouchEvent<HTMLElement>) => {
      clearLongPressTimer()
      if (!enabled || e.touches.length !== 1) {
        longPress.current = null
        return
      }
      const { clientX: x, clientY: y } = e.touches[0]
      const entry = { x, y, fired: false, timer: null as ReturnType<typeof setTimeout> | null }
      entry.timer = setTimeout(() => {
        entry.fired = true
        entry.timer = null
        open(row, { x, y })
      }, LONG_PRESS_MS)
      longPress.current = entry
    },
    onTouchMove: (e: TouchEvent<HTMLElement>) => {
      const entry = longPress.current
      if (!entry || entry.fired || !entry.timer) return
      const touch = e.touches[0]
      if (!touch) return
      if (Math.hypot(touch.clientX - entry.x, touch.clientY - entry.y) > LONG_PRESS_MOVE_TOLERANCE) {
        clearLongPressTimer()
        longPress.current = null
      }
    },
    onTouchEnd: (e: TouchEvent<HTMLElement>) => {
      // Tras una pulsación larga el dedo se levanta sobre la fila: sin esto el
      // navegador dispararía además el clic (p.ej. el enlace del código).
      if (longPress.current?.fired) e.preventDefault()
      clearLongPressTimer()
      longPress.current = null
    },
    onTouchCancel: () => {
      clearLongPressTimer()
      longPress.current = null
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (!enabled || (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10'))) return
      e.preventDefault()
      const rect = e.currentTarget.getBoundingClientRect()
      open(row, { x: rect.left + 16, y: rect.bottom, flipY: rect.top })
    },
  })

  const isOpenFor = (row: T) => state !== null && state.key === String(getKey(row))

  return { state, close, getRowProps, isOpenFor }
}
