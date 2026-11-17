import { useCallback, useState, type DragEvent } from 'react'

const DRAG_TYPE = 'application/x-pdv-column'

/**
 * Drag a column header (by its grip) onto another header to move the column there,
 * like D365. `move(activeId, overId)` puts the dragged column in the slot of the one it
 * was dropped on (same contract as `useTableColumns().move`).
 */
export function useColumnDrag(move: (activeId: string, overId: string) => void, order: string[]) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const end = useCallback(() => {
    setDragId(null)
    setOverId(null)
  }, [])

  const gripProps = (columnId: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.stopPropagation()
      e.dataTransfer.setData(DRAG_TYPE, columnId)
      e.dataTransfer.effectAllowed = 'move'
      // The whole header follows the cursor, not just the small grip.
      const th = (e.currentTarget as HTMLElement).closest('th')
      if (th) e.dataTransfer.setDragImage(th, 12, th.offsetHeight / 2)
      setDragId(columnId)
    },
    onDragEnd: end,
  })

  const headerDropProps = (columnId: string) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!dragId || !e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (overId !== columnId) setOverId(columnId)
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      const activeId = e.dataTransfer.getData(DRAG_TYPE) || dragId
      e.preventDefault()
      end()
      if (activeId && activeId !== columnId) move(activeId, columnId)
    },
  })

  /** Where the dragged column would land relative to `columnId`, to draw the insert line. */
  const dropSide = (columnId: string): 'before' | 'after' | null => {
    if (!dragId || overId !== columnId || dragId === columnId) return null
    return order.indexOf(dragId) < order.indexOf(columnId) ? 'after' : 'before'
  }

  return { gripProps, headerDropProps, dropSide, draggingId: dragId }
}
