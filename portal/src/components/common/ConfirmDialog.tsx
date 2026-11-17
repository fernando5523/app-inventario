import type { ReactNode } from 'react'
import { HiExclamationCircle } from 'react-icons/hi'
import { ResponsiveModalShell } from './ResponsiveModalShell'

interface ConfirmDialogProps {
  title: string
  /** Texto, o nodo cuando el diálogo necesita un elemento inline (p. ej. el chip de estado SUNAT del POS). */
  message: ReactNode
  onConfirm: () => void
  onCancel?: () => void
  onClose?: () => void
  isOpen?: boolean
  isLoading?: boolean
  confirmText?: string
  cancelText?: string
  isDestructive?: boolean
  isDangerous?: boolean
  variant?: 'default' | 'destructive'
}

export function ConfirmDialog({
  title,
  message,
  onConfirm,
  onCancel,
  onClose,
  isOpen = true,
  isLoading = false,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  isDestructive = false,
  isDangerous = false,
  variant = 'default',
}: ConfirmDialogProps) {
  const dangerous = isDestructive || isDangerous || variant === 'destructive'
  const handleCancel = onCancel || onClose || (() => {})

  return (
    <ResponsiveModalShell
      isOpen={isOpen}
      variant="dialog"
      onClose={handleCancel}
      title={title}
      size="sm"
      footer={
        <>
          <button
            onClick={handleCancel}
            disabled={isLoading}
            className="btn btn-default"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={dangerous ? 'btn btn-danger' : 'btn btn-primary'}
          >
            {isLoading ? 'Procesando...' : confirmText}
          </button>
        </>
      }
    >
      <div className="flex gap-3 items-start">
        <HiExclamationCircle className={`w-6 h-6 flex-shrink-0 mt-0.5 ${dangerous ? 'text-[var(--danger)]' : 'text-[var(--warning)]'}`} />
        <p className="text-sm text-[var(--fg-muted)]">{message}</p>
      </div>
    </ResponsiveModalShell>
  )
}
