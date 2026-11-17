import toast, { type ToastOptions } from 'react-hot-toast'
import { XIcon } from '@primer/octicons-react'
import { describeApiError } from './apiError'

/**
 * A failed action outside a form (load a list, delete, refresh…): what failed (title) and the exact
 * cause the server gave, with the code / HTTP status to quote. Same content as `ErrorNotice`, as a
 * toast that stays 10 s and can be closed. Rule in the `modal` skill.
 */
export function notifyError(title: string, error: unknown, options?: ToastOptions) {
  const info = describeApiError(error)
  const detail = [info.code && `Código ${info.code}`, info.status && `HTTP ${info.status}`].filter(Boolean).join(' · ')
  return toast.error(
    (t) => (
      <div className="flex items-start gap-2 text-[13px]">
        <div className="min-w-0">
          <p className="font-semibold text-[var(--fg)]">{title}</p>
          {/* A title that already is the server's sentence is not repeated. */}
          {info.message !== title && <p className="text-[var(--fg)] break-words">{info.message}</p>}
          {detail && <p className="mt-0.5 text-xs text-[var(--fg-muted)]">{detail}</p>}
        </div>
        <button
          type="button"
          onClick={() => toast.dismiss(t.id)}
          aria-label="Cerrar mensaje de error"
          className="p-0.5 rounded text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--bg-subtle)]"
        >
          <XIcon size={14} />
        </button>
      </div>
    ),
    { duration: 10000, ...options }
  )
}
