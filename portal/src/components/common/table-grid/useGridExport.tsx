import { useCallback, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Modal } from '../Modal'
import { notifyError } from '../../../utils/notifyError'

/** Below this the dialog never shows: a small export finishes before it would just flicker. */
const SHOW_AFTER_MS = 300

type Phase = 'fetching' | 'building'

interface ExportState {
  phase: Phase
  done: number
  total: number
}

interface RunOptions<Row> {
  /** One server page of the rows to export (with the grid's current filters and sort). */
  fetchPage: (page: number, size: number) => Promise<{ rows: Row[]; total: number }>
  /** Builds and downloads the file; returns the number of rows written. */
  write: (rows: Row[]) => number
  pageSize?: number
}

const fmt = (n: number) => n.toLocaleString('es-PE')

/**
 * Export with progress, D365 style: rows are fetched page by page from the server and a blocking
 * dialog shows "1.500 de 4.230" with a bar and a Cancelar button. Small exports never show it.
 */
export function useGridExport() {
  const [state, setState] = useState<ExportState | null>(null)
  const [visible, setVisible] = useState(false)
  const cancelledRef = useRef(false)
  const runningRef = useRef(false)

  const run = useCallback(async <Row,>({ fetchPage, write, pageSize = 500 }: RunOptions<Row>) => {
    if (runningRef.current) return
    runningRef.current = true
    cancelledRef.current = false
    setState({ phase: 'fetching', done: 0, total: 0 })
    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS)
    try {
      const rows: Row[] = []
      let total = 0
      for (let page = 1; ; page++) {
        const result = await fetchPage(page, pageSize)
        if (cancelledRef.current) {
          toast('Exportación cancelada')
          return
        }
        rows.push(...result.rows)
        total = result.total
        setState({ phase: 'fetching', done: rows.length, total })
        if (result.rows.length === 0 || rows.length >= total) break
      }
      setState({ phase: 'building', done: rows.length, total: rows.length })
      // Let the dialog paint "Generando archivo…" before the synchronous build.
      await new Promise((resolve) => setTimeout(resolve, 30))
      if (cancelledRef.current) {
        toast('Exportación cancelada')
        return
      }
      const n = write(rows)
      toast.success(`${fmt(n)} ${n === 1 ? 'fila exportada' : 'filas exportadas'}`)
    } catch (error: any) {
      notifyError('No se pudo exportar', error)
    } finally {
      clearTimeout(timer)
      setVisible(false)
      setState(null)
      runningRef.current = false
    }
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
  }, [])

  const percent = state && state.total > 0 ? Math.min(100, Math.round((state.done / state.total) * 100)) : 0

  const dialog =
    state && visible ? (
      // isDirty: a stray backdrop click or Escape must not hide a running export; only Cancelar stops it.
      <Modal onClose={() => {}} isDirty size="sm" ariaLabel="Exportando a Excel">
        <div className="p-4 space-y-3" aria-busy="true">
          <h2 className="text-sm font-semibold text-[var(--fg)]">Exportando a Excel</h2>
          <p className="text-xs text-[var(--fg-muted)]">
            {state.phase === 'fetching' ? 'Obteniendo registros…' : 'Generando archivo…'}
          </p>
          <div
            role="progressbar"
            aria-label="Progreso de la exportación"
            aria-valuemin={0}
            aria-valuemax={state.total || undefined}
            aria-valuenow={state.total ? state.done : undefined}
            // Until the total is known the track pulses with an empty bar; from then on the bar only grows.
            className={`h-2 w-full overflow-hidden rounded-full bg-[var(--border-muted)] ${state.total ? '' : 'animate-pulse'}`}
          >
            <div className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-200" style={{ width: `${percent}%` }} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--fg)] tabular-nums" aria-live="polite">
              {state.total ? `${fmt(state.done)} de ${fmt(state.total)} registros` : 'Calculando…'}
            </span>
            <button
              type="button"
              onClick={cancel}
              disabled={cancelledRef.current}
              className="text-xs px-3 py-1 rounded-md border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--bg-subtle)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
            >
              Cancelar
            </button>
          </div>
        </div>
      </Modal>
    ) : null

  return { run, dialog, isExporting: state !== null }
}
