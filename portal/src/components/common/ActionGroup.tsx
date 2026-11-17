import type { ReactNode } from 'react'

export interface ActionGroupItem {
  id: string
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  /** Tooltip, e.g. why the action is disabled. */
  title?: string
  tone?: 'primary' | 'danger' | 'neutral'
}

const ICON_TONE = { primary: 'text-[var(--primary)]', danger: 'text-[var(--danger)]', neutral: 'text-[var(--fg-muted)]' } as const

/**
 * Joined action buttons for a list page (D365 action pane style): [+ Nuevo | ✎ Editar | 🗑 Eliminar].
 * Actions that need a selection are disabled until the grid has one.
 */
export function ActionGroup({ items, label = 'Acciones' }: { items: ActionGroupItem[]; label?: string }) {
  return (
    <div role="toolbar" aria-label={label} className="inline-flex w-full sm:w-auto overflow-hidden rounded-md border border-[var(--border)] bg-white divide-x divide-[var(--border)]">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={item.onClick}
          disabled={item.disabled}
          title={item.title}
          className="inline-flex h-[30px] flex-1 sm:flex-none items-center justify-center gap-1.5 px-3 text-xs font-medium text-[var(--fg)] hover:bg-[var(--bg-subtle)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)] disabled:cursor-not-allowed disabled:text-[var(--fg-subtle)] disabled:hover:bg-white"
        >
          <span className={`inline-flex ${item.disabled ? 'text-[var(--fg-disabled)]' : ICON_TONE[item.tone ?? 'neutral']}`} aria-hidden="true">
            {item.icon}
          </span>
          {item.label}
        </button>
      ))}
    </div>
  )
}
