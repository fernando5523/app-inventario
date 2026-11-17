import type { ReactNode } from 'react'

/**
 * Una acción de fila, para el menú contextual (clic derecho / pulsación larga /
 * Shift+F10). Cada tabla arma su lista en un solo lugar.
 */
export interface RowMenuItem {
  id: string
  label: string
  icon?: ReactNode
  /** Acción destructiva: texto y hover en rojo de la paleta. */
  danger?: boolean
  /** No se muestra (p.ej. falta el permiso). */
  hidden?: boolean
  /** Se muestra pero no se puede elegir. */
  disabled?: boolean
  /** Por qué está deshabilitado: va como `title` del ítem y como nota al pie del menú. */
  disabledReason?: string
  onSelect: () => void
}

/**
 * Dónde abrir el menú. `x`/`y` es el punto de apertura (el cursor, el dedo o el
 * borde de la fila). `align: 'end'` alinea el borde DERECHO del menú con `x` (p.ej.
 * un botón disparador). `flipY` es el borde desde el que se abre hacia arriba
 * cuando abajo no cabe; por defecto el mismo `y`.
 */
export interface RowMenuAnchor {
  x: number
  y: number
  align?: 'start' | 'end'
  flipY?: number
}
