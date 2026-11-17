import { createPortal } from 'react-dom'
import { XCircleFillIcon, XIcon } from '@primer/octicons-react'
import { describeApiError, type ApiErrorInfo } from '../../utils/apiError'

interface ErrorNoticeProps {
  /** What failed, in the form's words: "No se pudo guardar la marca". */
  title: string
  /** The caught error (axios or not), an already described one, or a plain text. */
  error: unknown
  onDismiss?: () => void
}

const isDescribed = (e: unknown): e is ApiErrorInfo =>
  typeof e === 'object' && e !== null && 'message' in e && !('response' in e) && !('isAxiosError' in e) && !(e instanceof Error)

/**
 * Floating error of a form: what failed (title), the exact cause the server gave, and the code /
 * HTTP status to quote when reporting it. It floats over the screen (portal, bottom right, near the
 * Guardar the user just clicked) so any form can render it anywhere in its JSX — side panel, modal
 * or page — without making room for it. It stays until dismissed or the next save, unlike a toast
 * that vanishes before it is read. Rule in the `modal` skill.
 */
export function ErrorNotice({ title, error, onDismiss }: ErrorNoticeProps) {
  const info = isDescribed(error) ? error : describeApiError(error)
  const detail = [info.code && `Código ${info.code}`, info.status && `HTTP ${info.status}`].filter(Boolean).join(' · ')

  return createPortal(
    <div
      role="alert"
      className="fixed z-[60] bottom-[72px] right-4 left-4 sm:left-auto sm:w-[420px] flex items-start gap-2 rounded-md border border-[var(--danger-border)] bg-[var(--danger-light)] px-3 py-2 text-[13px] shadow-[0_8px_24px_var(--shadow-ring)] animate-slide-up"
    >
      <XCircleFillIcon size={16} className="mt-[1px] flex-shrink-0 text-[var(--danger)]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[var(--fg)]">{title}</p>
        <p className="text-[var(--fg)] break-words">{info.message}</p>
        {detail && <p className="mt-0.5 text-xs text-[var(--fg-muted)]">{detail}</p>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cerrar mensaje de error"
          className="p-0.5 rounded text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--danger-light-hover)]"
        >
          <XIcon size={14} />
        </button>
      )}
    </div>,
    document.body
  )
}
