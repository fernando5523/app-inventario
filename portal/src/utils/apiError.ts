/**
 * What went wrong in an API call, in words the user can act on. The server answers every error as
 * `{ error, code? }` (server/src/middleware/errorHandler.ts); `message` is only a fallback for
 * other APIs. Without a response the request never reached the server.
 */
export interface ApiErrorInfo {
  /** Exact cause, ready to show. */
  message: string
  /** Server code (`BARCODE_TAKEN`, `P2011`…), when there is one. */
  code?: string
  /** HTTP status, when the server answered. */
  status?: number
}

const STATUS_MESSAGES: Record<number, string> = {
  400: 'El servidor rechazó los datos enviados',
  401: 'Tu sesión expiró. Vuelve a iniciar sesión',
  403: 'No tienes permiso para realizar esta acción',
  404: 'No se encontró el registro: puede que otra persona lo haya eliminado',
  409: 'El registro entra en conflicto con otro que ya existe',
  413: 'El archivo o los datos enviados son demasiado grandes',
  500: 'Error interno del servidor',
  502: 'El servidor no está disponible en este momento',
  503: 'El servidor no está disponible en este momento',
  504: 'El servidor tardó demasiado en responder',
}

type AxiosLike = {
  code?: string
  message?: string
  response?: { status?: number; data?: unknown }
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

export function describeApiError(error: unknown): ApiErrorInfo {
  if (typeof error === 'string') return { message: error }
  const err = (error ?? {}) as AxiosLike

  if (err.response) {
    const status = err.response.status
    const data = (err.response.data ?? {}) as Record<string, unknown>
    const message =
      text(data.error) ??
      text(data.message) ??
      (typeof err.response.data === 'string' ? text(err.response.data) : undefined) ??
      (status ? STATUS_MESSAGES[status] ?? (status >= 500 ? STATUS_MESSAGES[500] : undefined) : undefined) ??
      'El servidor respondió con un error'
    return { message, code: text(data.code), status }
  }

  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
    return { message: 'El servidor tardó demasiado en responder. Inténtalo de nuevo.', code: err.code }
  }
  if (err.code === 'ERR_NETWORK' || err.message === 'Network Error') {
    return { message: 'No se pudo conectar con el servidor. Revisa tu conexión o que el servidor esté encendido.', code: err.code }
  }
  return { message: text(err.message) ?? 'Ocurrió un error inesperado' }
}

/** The exact cause as one line (for a toast). */
export const apiErrorMessage = (error: unknown) => describeApiError(error).message

/**
 * For a screen that already words its own context ("No se pudo guardar la caja"): the server's
 * message when it sent one, otherwise that context plus the cause (no connection, HTTP status…).
 */
export function apiErrorText(error: unknown, context: string): string {
  const data = ((error ?? {}) as AxiosLike).response?.data as Record<string, unknown> | undefined
  const server = text(data?.error) ?? text(data?.message)
  return server ?? `${context}: ${describeApiError(error).message}`
}
