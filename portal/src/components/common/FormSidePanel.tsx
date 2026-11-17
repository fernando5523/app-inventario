import { useEffect, useRef, type ReactNode } from 'react'
import { XIcon } from '@primer/octicons-react'

interface PanelRowProps {
  label: string
  htmlFor?: string
  required?: boolean
  error?: string
  children: ReactNode
}

/** Label | field row of a `FormSidePanel`, like the summary of the Soporte › Dispositivos panel. */
export function PanelRow({ label, htmlFor, required, error, children }: PanelRowProps) {
  return (
    <div className="flex gap-3 text-[13px]">
      <label htmlFor={htmlFor} className="w-36 flex-shrink-0 pt-[6px] text-[var(--fg-muted)]">
        {label}
        {required && <span className="text-[var(--danger)] ml-0.5">*</span>}
      </label>
      <div className="flex-1 min-w-0">
        {children}
        {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
      </div>
    </div>
  )
}

export interface FormSidePanelTab {
  id: string
  label: string
  /** A field of this tab failed validation: the tab shows a red dot. */
  hasError?: boolean
}

interface FormSidePanelProps {
  ariaLabel: string
  title: ReactNode
  /** Line under the title (badges, RUC…), e.g. when editing. */
  subtitle?: ReactNode
  /** Single section heading under the header, kept like a tab title without tabs. */
  section?: string
  /** Real tabs instead of `section` (a long form split so no tab needs scrolling). */
  tabs?: FormSidePanelTab[]
  activeTab?: string
  onTabChange?: (id: string) => void
  isDirty: boolean
  /** Backdrop click and Escape. Called only while the form is clean. */
  onDismiss: () => void
  /** The ✕ button: the form's own close, which asks first when there are unsaved changes. */
  onRequestClose: () => void
  footer: ReactNode
  children: ReactNode
  /** Desktop width; wider for forms with a line grid (Producto › Unidades). */
  widthClassName?: string
  /** Save error of the form (`ErrorNotice`, which floats over the screen on its own). */
  notice?: ReactNode
}

/**
 * A form in a panel that slides in from the right (Configuración › Empresa, Sucursales).
 *
 * Rule 0 of the `modal` skill: with unsaved changes a backdrop click or Escape does nothing;
 * the ✕ and Cancelar go through the form's own close, which asks before discarding.
 */
export function FormSidePanel({ ariaLabel, title, subtitle, section, tabs, activeTab, onTabChange, isDirty, onDismiss, onRequestClose, footer, children, widthClassName = 'md:w-[620px]', notice }: FormSidePanelProps) {
  // Read through a ref: the Escape listener is not rebuilt on every keystroke.
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // An open SearchableSelect consumes its own Escape.
      if (e.key !== 'Escape' || e.defaultPrevented || isDirtyRef.current) return
      onDismiss()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onDismiss])

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40 animate-fade-in"
        onClick={() => {
          if (!isDirtyRef.current) onDismiss()
        }}
      />

      <div
        role="dialog"
        aria-label={ariaLabel}
        className={`fixed inset-y-0 right-0 w-full ${widthClassName} bg-white shadow-2xl z-50 flex flex-col animate-slide-in-right`}
      >
        <div className="sticky top-0 bg-white border-b border-[var(--border)] px-4 py-3 flex items-center justify-between flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-[var(--fg)] truncate">{title}</h2>
            {subtitle && <div className="mt-1 flex items-center gap-2">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onRequestClose}
            aria-label="Cerrar"
            className="p-1 hover:bg-[var(--bg-subtle)] rounded-md text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            <XIcon size={16} />
          </button>
        </div>

        {tabs ? (
          <div role="tablist" aria-label={`Secciones de ${ariaLabel}`} className="flex border-b border-[var(--border)] px-4 flex-shrink-0">
            {tabs.map((tab) => {
              const selected = tab.id === activeTab
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => onTabChange?.(tab.id)}
                  className={`px-3 py-2 text-[12px] border-b-2 -mb-px flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] rounded-t-sm ${
                    selected ? 'border-[var(--primary)] text-[var(--fg)] font-semibold' : 'border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]'
                  }`}
                >
                  {tab.label}
                  {tab.hasError && <span className="w-1.5 h-1.5 rounded-full bg-[var(--danger)]" aria-label="tiene errores" />}
                </button>
              )
            })}
          </div>
        ) : (
          section && (
            <div className="flex border-b border-[var(--border)] px-4 flex-shrink-0">
              <span className="px-3 py-2 text-[12px] border-b-2 -mb-px border-[var(--primary)] text-[var(--fg)] font-semibold">{section}</span>
            </div>
          )
        )}

        {children}

        {notice}

        <div className="sticky bottom-0 bg-white border-t border-[var(--border)] px-4 py-3 flex flex-wrap gap-2">{footer}</div>
      </div>
    </>
  )
}
