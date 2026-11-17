import { useEffect, useRef } from 'react'

/** `focus` y `visibilitychange` llegan juntos al volver a la ventana: una sola lectura. */
const MIN_INTERVAL_MS = 1500

/**
 * Vuelve a leer de la base las LISTAS de un formulario cada vez que la ventana recupera el
 * foco: lo que se creó o cambió en otra ventana (una marca, un proveedor, un método de
 * pago, una caja abierta) aparece sin cerrar el formulario ni recargar la página.
 *
 * El formulario ya las lee al abrirse; esto cubre el que se queda abierto mientras se
 * trabaja en otra ventana. El callback debe ser silencioso (sin spinner) y no tocar lo que
 * el usuario está escribiendo: solo opciones de listas.
 */
export function useRefreshOnFocus(refresh: () => unknown, enabled = true) {
  const latest = useRef(refresh)
  latest.current = refresh

  useEffect(() => {
    if (!enabled) return
    // Recién abierto ya leyó: no se repite si el foco llega enseguida.
    let last = Date.now()
    const run = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - last < MIN_INTERVAL_MS) return
      last = Date.now()
      Promise.resolve()
        .then(() => latest.current())
        .catch(() => {
          // Sin conexión: se queda con lo que ya tenía y lo intenta en el próximo foco.
        })
    }
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', run)
    return () => {
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', run)
    }
  }, [enabled])
}
