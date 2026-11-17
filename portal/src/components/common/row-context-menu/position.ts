import type { RowMenuAnchor } from './types'

/** Margen mínimo entre el menú y el borde de la ventana. */
export const VIEWPORT_MARGIN = 8

/**
 * Coloca el menú dentro de la ventana: se abre hacia la derecha y hacia abajo del
 * punto de apertura y, si no cabe, se voltea hacia la izquierda o hacia arriba.
 * Si ni así cabe (ventana diminuta), se pega al margen.
 */
export function computeMenuPosition(
  anchor: RowMenuAnchor,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number } {
  const { width, height } = size
  const maxLeft = viewport.width - VIEWPORT_MARGIN - width
  const maxTop = viewport.height - VIEWPORT_MARGIN - height

  let left = anchor.align === 'end' ? anchor.x - width : anchor.x
  if (left > maxLeft) left = anchor.x - width
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft))

  let top = anchor.y
  if (top > maxTop) top = (anchor.flipY ?? anchor.y) - height
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop))

  return { left, top }
}
