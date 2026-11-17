import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HiCog } from 'react-icons/hi'
import { GrabberIcon } from '@primer/octicons-react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ResolvedColumn } from './types'

interface TableSettingsButtonProps {
  columns: ResolvedColumn[]
  canHide: (id: string) => boolean
  onToggle: (id: string) => void
  onMove: (activeId: string, overId: string) => void
  onReset: () => void
  isDefault: boolean
}

const GAP = 4
const MARGIN = 8
const PANEL_WIDTH = 240
const MAX_PANEL_HEIGHT = 360

// Pestañas del popover. Para agregar "Densidad" basta sumar una entrada aquí y su
// panel junto a `ColumnsPanel`; el encabezado ya recorre esta lista.
const TABS = [{ id: 'columns', label: 'Columnas' }] as const
type TabId = (typeof TABS)[number]['id']

interface Position {
  top: number
  left: number
  maxHeight: number
}

/** Abajo del botón si cabe; si no, arriba. Siempre dentro de la ventana. */
function computePosition(trigger: HTMLElement): Position {
  const rect = trigger.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom - GAP - MARGIN
  const spaceAbove = rect.top - GAP - MARGIN
  const below = spaceBelow >= Math.min(MAX_PANEL_HEIGHT, 200) || spaceBelow >= spaceAbove
  const maxHeight = Math.max(160, Math.min(MAX_PANEL_HEIGHT, below ? spaceBelow : spaceAbove))
  const left = Math.min(Math.max(MARGIN, rect.right - PANEL_WIDTH), window.innerWidth - PANEL_WIDTH - MARGIN)
  const top = below ? rect.bottom + GAP : Math.max(MARGIN, rect.top - GAP - maxHeight)
  return { top, left, maxHeight }
}

/**
 * Engranaje de "Configuración de tabla": mostrar u ocultar columnas y cambiar su
 * orden arrastrando (mouse, touch o teclado). No sabe nada de la tabla: recibe el
 * estado y las acciones de `useTableColumns`.
 */
export function TableSettingsButton({ columns, canHide, onToggle, onMove, onReset, isDefault }: TableSettingsButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<Position | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('columns')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Mientras se arrastra con teclado, Escape cancela el arrastre, no cierra el panel.
  const isDraggingRef = useRef(false)

  const close = useCallback((returnFocus: boolean) => {
    setIsOpen(false)
    setPosition(null)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return
    setPosition(computePosition(triggerRef.current))
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (e: PointerEvent | MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    // Mismo criterio que los modales: si otro componente ya atendió el Escape
    // (lo marcó con preventDefault), no se cierra nada. Y al atenderlo aquí se marca,
    // para que un modal que contenga la tabla no se cierre también.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isDraggingRef.current) return
      e.preventDefault()
      close(true)
    }
    const reposition = () => triggerRef.current && setPosition(computePosition(triggerRef.current))

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [isOpen, close])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (isOpen ? close(false) : setIsOpen(true))}
        aria-label="Configurar columnas"
        title="Configurar columnas"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className={`inline-flex items-center justify-center w-[30px] h-[30px] rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${
          isOpen
            ? 'bg-[var(--bg-rail)] border-[var(--border)] text-[var(--fg)]'
            : 'bg-white border-[var(--border)] text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]'
        }`}
      >
        <HiCog className="w-3.5 h-3.5" />
      </button>

      {isOpen &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Configuración de tabla"
            className="fixed z-[70] bg-white rounded-lg shadow-lg border border-[var(--border)] py-1 flex flex-col animate-fade-in"
            style={{ top: position.top, left: position.left, width: PANEL_WIDTH, maxHeight: position.maxHeight }}
          >
            <div className="flex items-center justify-between px-3 pt-1.5 pb-1">
              <span className="text-[13px] font-semibold text-[var(--fg)]">Configuración de tabla</span>
              <button
                type="button"
                onClick={onReset}
                disabled={isDefault}
                className="text-xs text-[var(--primary)] hover:underline disabled:text-[var(--fg-subtle)] disabled:no-underline disabled:cursor-default rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
              >
                Restablecer
              </button>
            </div>

            <div role="tablist" className="flex gap-3 px-3 border-b border-[var(--border)]">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
                    activeTab === tab.id
                      ? 'border-[var(--primary)] text-[var(--primary)]'
                      : 'border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto py-1 min-h-0">
              {activeTab === 'columns' && (
                <ColumnsPanel
                  columns={columns}
                  canHide={canHide}
                  onToggle={onToggle}
                  onMove={onMove}
                  onDragStateChange={(dragging) => {
                    isDraggingRef.current = dragging
                  }}
                />
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

interface ColumnsPanelProps {
  columns: ResolvedColumn[]
  canHide: (id: string) => boolean
  onToggle: (id: string) => void
  onMove: (activeId: string, overId: string) => void
  onDragStateChange: (dragging: boolean) => void
}

function ColumnsPanel({ columns, canHide, onToggle, onMove, onDragStateChange }: ColumnsPanelProps) {
  const sensors = useSensors(
    // La distancia mínima evita que un clic en la manija se tome como arrastre. La
    // manija lleva `touch-none`, así que en pantallas táctiles se arrastra directo.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const labelOf = (id: string | number) => columns.find((c) => c.id === String(id))?.label ?? String(id)
  const positionOf = (id: string | number) => columns.findIndex((c) => c.id === String(id)) + 1

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Tomaste la columna ${labelOf(active.id)}, en la posición ${positionOf(active.id)} de ${columns.length}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `La columna ${labelOf(active.id)} pasa a la posición ${positionOf(over.id)} de ${columns.length}.`
        : `La columna ${labelOf(active.id)} está fuera de la lista.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Soltaste la columna ${labelOf(active.id)} en la posición ${positionOf(over.id)} de ${columns.length}.`
        : `Soltaste la columna ${labelOf(active.id)}.`,
    onDragCancel: ({ active }) => `Se canceló el movimiento de la columna ${labelOf(active.id)}.`,
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    onDragStateChange(false)
    if (over && active.id !== over.id) onMove(String(active.id), String(over.id))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={() => onDragStateChange(true)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => onDragStateChange(false)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'Para mover una columna, presiona espacio o Enter para tomarla, usa las flechas arriba y abajo para cambiar su posición y presiona espacio o Enter para soltarla. Escape cancela.',
        },
      }}
    >
      <SortableContext items={columns.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul aria-label="Columnas de la tabla">
          {columns.map((column) => (
            <SortableColumnRow
              key={column.id}
              column={column}
              disabled={column.locked || (column.visible && !canHide(column.id))}
              isLastExtraColumn={column.visible && !column.locked && !canHide(column.id)}
              onToggle={onToggle}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

interface SortableColumnRowProps {
  column: ResolvedColumn
  disabled: boolean
  isLastExtraColumn: boolean
  onToggle: (id: string) => void
}

function SortableColumnRow({ column, disabled, isLastExtraColumn, onToggle }: SortableColumnRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
  })
  const checkboxId = `table-settings-column-${column.id}`
  const hint = column.locked
    ? 'Esta columna siempre se muestra'
    : isLastExtraColumn
      ? 'Debe quedar al menos una columna además de las fijas'
      : undefined

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-1.5 px-2 py-1 ${isDragging ? 'relative z-10 bg-[var(--bg-subtle)] shadow-sm rounded' : ''}`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Mover columna ${column.label}`}
        className="p-0.5 rounded text-[var(--fg-subtle)] hover:text-[var(--fg)] cursor-grab active:cursor-grabbing touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
      >
        <GrabberIcon size={14} />
      </button>
      <input
        id={checkboxId}
        type="checkbox"
        checked={column.visible}
        disabled={disabled}
        onChange={() => onToggle(column.id)}
        className="w-4 h-4 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)] disabled:opacity-50"
      />
      <label
        htmlFor={checkboxId}
        title={hint}
        className={`flex-1 text-xs select-none ${disabled ? 'text-[var(--fg-muted)]' : 'text-[var(--fg)] cursor-pointer'}`}
      >
        {column.label}
      </label>
    </li>
  )
}
