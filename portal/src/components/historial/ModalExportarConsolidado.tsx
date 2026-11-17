import { useState } from 'react'
import { CheckIcon } from '@primer/octicons-react'
import { Modal } from '../common/Modal'
import { MESES } from '../../utils/formato'
import type { Sucursal } from '../../tipos'

/**
 * Selector de tiendas para el consolidado — pedido del cliente del
 * 2026-09-09: una tienda, varias, o todas.
 *
 * El control es un CHECKLIST, no un desplegable de un solo valor: la lista de
 * tiendas es chica y cerrada, y lo que se pide es un subconjunto. Orden
 * alfabético en español, y SOLO las tiendas reales que el padrón trajo —
 * nunca una opción inventada.
 *
 * NADA MARCADO = TODAS, y es el default explícito: al abrir se arranca
 * limpio, nunca con la selección de una apertura anterior que ya no aplica.
 * Sin tiendas en el padrón el checklist se saca del medio en vez de mostrar
 * una lista vacía (puede pasar mientras el padrón todavía carga).
 *
 * EL RECORTE REAL LO HACE EL SERVIDOR (`resolverSucursalesConsultables`):
 * esta lista sirve para pedir menos, nunca para autorizar más.
 */
export function ModalExportarConsolidado({
  tiendas,
  periodoAnio,
  periodoMes,
  exportando,
  onExportar,
  onCerrar,
}: {
  tiendas: readonly Sucursal[]
  periodoAnio: number
  periodoMes: number
  exportando: boolean
  /** Lista vacía = sin selección puntual, o sea todas las de arriba. */
  onExportar: (sucursalIds: number[]) => void
  onCerrar: () => void
}) {
  const [marcadas, setMarcadas] = useState<Set<number>>(new Set())

  const ordenadas = [...tiendas].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  const todas = marcadas.size === 0
  const sinSelector = tiendas.length === 0

  const alternar = (id: number) => {
    setMarcadas((previas) => {
      const siguiente = new Set(previas)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  return (
    <Modal onClose={onCerrar} size="md" ariaLabel="Exportar el consolidado del período">
      <div className="flex flex-col max-h-[80vh]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-[var(--fg)]">Exportar el consolidado</h2>
          <p className="text-[12px] text-[var(--fg-muted)]">
            {MESES[periodoMes - 1]} {periodoAnio} · una sola tabla con las diferencias de las tiendas que marques.
          </p>
        </div>

        <div className="px-5 py-3 text-[12px] text-[var(--fg-muted)]">
          {sinSelector
            ? 'Se exporta el período elegido de tu tienda.'
            : todas
              ? 'Sin ninguna marcada: se exportan TODAS las tiendas.'
              : `${marcadas.size} ${marcadas.size === 1 ? 'tienda marcada' : 'tiendas marcadas'}.`}
        </div>

        {!sinSelector && (
          <div className="flex-1 min-h-0 overflow-auto px-5 pb-3 space-y-1">
            {ordenadas.map((tienda) => {
              const activa = marcadas.has(tienda.id)
              return (
                <button
                  key={tienda.id}
                  type="button"
                  role="checkbox"
                  aria-checked={activa}
                  onClick={() => alternar(tienda.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-subtle)]"
                >
                  <span
                    className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      activa ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border)] bg-white'
                    }`}
                    aria-hidden="true"
                  >
                    {activa && <CheckIcon size={12} />}
                  </span>
                  <span className="truncate text-xs text-[var(--fg)]">{tienda.nombre}</span>
                </button>
              )
            })}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          {!sinSelector && (
            <button type="button" onClick={() => setMarcadas(new Set())} disabled={todas} className="btn btn-default">
              Todas
            </button>
          )}
          <button type="button" onClick={onCerrar} disabled={exportando} className="btn btn-default">
            Cancelar
          </button>
          <button type="button" onClick={() => onExportar([...marcadas])} disabled={exportando} className="btn btn-primary">
            {exportando ? 'Exportando...' : 'Exportar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
