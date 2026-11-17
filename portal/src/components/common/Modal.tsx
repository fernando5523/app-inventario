import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'

// Named after the Tailwind class each one produces, so a size can be read off
// the old markup without a lookup and without silently resizing a panel.
type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl'

interface ModalProps {
  /**
   * Runs only when an accidental dismissal is allowed to close the modal.
   * Deliberate closes (the X button, Cancel) stay owned by the form, which
   * keeps its own unsaved-changes confirmation.
   */
  onClose: () => void
  /**
   * While true, clicking the backdrop and pressing Escape do nothing at all.
   * A stray click must never be able to discard typed work.
   */
  isDirty?: boolean
  size?: ModalSize
  /** Extra classes for the white panel. */
  className?: string
  /**
   * Accessible name of the dialog. Without it (and without ariaLabelledBy) the
   * panel is named after the first heading it contains.
   */
  ariaLabel?: string
  /** Id of the element that names the dialog, usually its title. */
  ariaLabelledBy?: string
  /**
   * `dialog` (default): centred, for confirmations and short prompts. `panel`: a create/edit form
   * or a detail view, which slides in from the right like the other forms (Configuración › Empresa).
   */
  variant?: 'dialog' | 'panel'
  children: ReactNode
}

/** Wide content (line grids, details) gets the wide panel. */
const PANEL_WIDTH: Record<ModalSize, string> = {
  sm: 'md:w-[620px]',
  md: 'md:w-[620px]',
  lg: 'md:w-[620px]',
  xl: 'md:w-[620px]',
  '2xl': 'md:w-[960px]',
  '4xl': 'md:w-[960px]',
}

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
}

export function Modal({
  onClose,
  isDirty = false,
  size = 'md',
  className = '',
  ariaLabel,
  ariaLabelledBy,
  variant = 'dialog',
  children,
}: ModalProps) {
  // Read through a ref inside the key handler: binding the listener to isDirty
  // would tear it down and rebuild it on every keystroke of the form.
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Something inside already consumed this Escape (an open SearchableSelect
      // closes its list with preventDefault): it is not a request to close us.
      if (e.defaultPrevented) return
      if (isDirtyRef.current) return
      onCloseRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Every caller renders its own title as a heading inside the panel, so the
  // dialog takes its accessible name from there unless one is given explicitly.
  // Runs after every render: the title can be swapped (Nuevo -> Editar).
  const panelRef = useRef<HTMLDivElement>(null)
  const fallbackTitleId = useId()
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel || ariaLabel || ariaLabelledBy) return
    const heading = panel.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6')
    if (!heading) {
      panel.removeAttribute('aria-labelledby')
      return
    }
    if (!heading.id) heading.id = fallbackTitleId
    panel.setAttribute('aria-labelledby', heading.id)
  })

  const handleBackdropClick = () => {
    if (isDirty) return
    onClose()
  }

  if (variant === 'panel') {
    return (
      <>
        <div className="fixed inset-0 bg-black/40 z-40 animate-fade-in" onClick={handleBackdropClick} />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          // A form root fills the height so its footer sits at the bottom, as in FormSidePanel.
          className={`fixed inset-y-0 right-0 w-full ${PANEL_WIDTH[size]} bg-white shadow-2xl z-50 flex flex-col overflow-hidden animate-slide-in-right [&>form]:flex-1 [&>form]:min-h-0 ${className}`}
        >
          {children}
        </div>
      </>
    )
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={`bg-white rounded-xl shadow-xl w-full ${SIZE_CLASS[size]} max-h-[90vh] flex flex-col overflow-hidden ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
