import React from 'react'
import { HiInbox } from 'react-icons/hi'

interface EmptyStateProps {
  title?: string
  message?: string
  icon?: React.ReactNode
  action?: {
    label: string
    onClick: () => void
  }
}

export function EmptyState({
  title = 'Sin resultados',
  message = 'No hay datos para mostrar',
  icon = <HiInbox className="w-12 h-12 text-[var(--border)]" />,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="mb-4">{icon}</div>
      <h3 className="text-base font-semibold text-[var(--fg)] mb-2">{title}</h3>
      <p className="text-sm text-[var(--fg-muted)] text-center max-w-sm mb-6">{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="btn btn-primary"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
