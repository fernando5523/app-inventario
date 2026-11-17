import { type ReactNode, useEffect, useCallback, useRef } from 'react'
import { HiX } from 'react-icons/hi'
import { XIcon } from '@primer/octicons-react'
import { useIsMobile } from '../../hooks/useMediaQuery'

export interface ResponsiveModalShellProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /**
   * While true, an ACCIDENTAL dismissal does nothing: clicking the backdrop and
   * pressing Escape are ignored, because a stray click must never discard typed
   * work. The X button still calls onClose, so a DELIBERATE close keeps whatever
   * unsaved-changes confirmation the form already owns.
   */
  isDirty?: boolean
  /**
   * `panel` (default): the create/edit form slides in from the right, like Configuración › Empresa.
   * `dialog`: centred, only for confirmations and short prompts (ConfirmDialog, change password).
   */
  variant?: 'panel' | 'dialog'
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
}

const panelWidths = {
  sm: 'md:w-[620px]',
  md: 'md:w-[620px]',
  lg: 'md:w-[960px]',
}

/**
 * The forms pass [Cancelar][Guardar] with `flex-1`; in the panel they read like the other side
 * panels: natural width, left aligned, the main action first.
 */
const PANEL_FOOTER_CLASS =
  'border-t border-[var(--border)] px-4 py-3 flex flex-wrap gap-2 flex-shrink-0 [&>*]:!flex-none [&>.btn-primary]:-order-1 [&>.btn-danger]:-order-1'

export function ResponsiveModalShell({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  isDirty = false,
  variant = 'panel',
}: ResponsiveModalShellProps) {
  const isMobile = useIsMobile()

  // Read through a ref: depending on isDirty would tear down and rebuild the
  // key listener on every keystroke of the form inside.
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Something inside already consumed this Escape (an open SearchableSelect
      // closes its list with preventDefault): it is not a request to close us.
      if (e.defaultPrevented) return
      if (isDirtyRef.current) return
      onClose()
    },
    [onClose]
  )

  const handleBackdropClick = () => {
    if (isDirty) return
    onClose()
  }

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white animate-slide-up" role="dialog" aria-modal="true" aria-label={title}>
        {/* Header */}
        <div className="border-b border-[var(--border)] px-4 py-3 flex items-center justify-between flex-shrink-0">
          <h2 className="text-sm font-semibold text-[var(--fg)] truncate pr-2">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[var(--bg-subtle)] rounded-md transition-colors flex-shrink-0"
            title="Cerrar"
          >
            <HiX className="w-5 h-5 text-[var(--fg-muted)]" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="border-t border-[var(--border)] px-4 py-3 flex justify-end gap-2 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    )
  }

  if (variant === 'panel') {
    return (
      <>
        <div className="fixed inset-0 bg-black/40 z-40 animate-fade-in" onClick={handleBackdropClick} />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={`fixed inset-y-0 right-0 w-full ${panelWidths[size]} bg-white shadow-2xl z-50 flex flex-col animate-slide-in-right`}
        >
          <div className="border-b border-[var(--border)] px-4 py-3 flex items-center justify-between flex-shrink-0">
            <h2 className="text-[13px] font-semibold text-[var(--fg)] truncate pr-2">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              title="Cerrar"
              className="p-1 hover:bg-[var(--bg-subtle)] rounded-md text-[var(--fg-muted)] hover:text-[var(--fg)]"
            >
              <XIcon size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">{children}</div>

          {footer && <div className={PANEL_FOOTER_CLASS}>{footer}</div>}
        </div>
      </>
    )
  }

  // Desktop dialog: centered with backdrop
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={handleBackdropClick}
    >
      {/* The dialog role lives on the panel, not the backdrop (same as Modal). */}
      <div
        className={`bg-white rounded-xl shadow-xl w-full ${sizeClasses[size]} max-h-[90vh] flex flex-col overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Header */}
        <div className="border-b border-[var(--border)] px-6 py-4 flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-semibold text-[var(--fg)]">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[var(--bg-subtle)] rounded-md transition-colors"
            title="Cerrar"
          >
            <HiX className="w-5 h-5 text-[var(--fg-muted)]" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="border-t border-[var(--border)] px-6 py-3 flex justify-end gap-2 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
