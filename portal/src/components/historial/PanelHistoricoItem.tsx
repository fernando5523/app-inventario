import { useEffect, useState } from 'react'
import { ErrorNotice } from '../common/ErrorNotice'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { SlidePanel } from '../common/SlidePanel'
import { MESES_CORTOS, formatoMiles, formatoMoneda, pluralizar } from '../../utils/formato'
import { historialApi } from './historialApi'
import type { HistoricoItem } from './historialTipos'

/**
 * ---------------------------------------------------------------------------
 * LA HISTORIA DE UN ÍTEM
 * ---------------------------------------------------------------------------
 * "Este producto, cuántas veces dio diferencia" — la pregunta textual del
 * cliente. Un ítem que aparece todos los meses con faltante no es un error de
 * conteo: es una merma sistemática, o algo peor. Eso solo se ve mirando el
 * histórico completo, nunca un mes suelto.
 *
 * Se abre desde una fila de Diferencias y vuelve al detalle, no a la lista:
 * quien mira la historia de un ítem está en medio de revisar ese inventario.
 */

/** Sin dato es guion, NUNCA un 0. */
const SIN_DATO = '—'

export function PanelHistoricoItem({ codigo, onCerrar }: { codigo: string | null; onCerrar: () => void }) {
  const [historia, setHistoria] = useState<HistoricoItem | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (codigo === null) return
    let vigente = true
    setCargando(true)
    setError(null)
    setHistoria(null)
    historialApi
      .historicoDeItem(codigo)
      .then((h) => {
        if (vigente) setHistoria(h)
      })
      .catch((e) => {
        if (vigente) setError(e)
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })
    return () => {
      vigente = false
    }
  }, [codigo])

  const r = historia?.resumen ?? null

  return (
    <SlidePanel
      isOpen={codigo !== null}
      onClose={onCerrar}
      title={codigo === null ? 'Historia del ítem' : `Historia de ${codigo}`}
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCerrar} className="btn btn-default">
            Volver al inventario
          </button>
        </div>
      }
    >
      {cargando ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner text="Buscando este código en los inventarios cerrados..." />
        </div>
      ) : error !== null ? (
        <ErrorNotice error={error} title="No se pudo cargar la historia del ítem" />
      ) : historia === null || r === null ? null : (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-[var(--fg)]">{historia.descripcion ?? historia.codigo}</p>
            <p className="text-xs text-[var(--fg-muted)]">Código {historia.codigo}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2">
              <p className="text-[11px] text-[var(--fg-muted)]">Apareció con diferencia</p>
              <p className="text-sm font-semibold text-[var(--fg)] tabular-nums">
                {r.veces} {r.veces === 1 ? 'vez' : 'veces'}
              </p>
            </div>
            <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2">
              <p className="text-[11px] text-[var(--fg-muted)]">Monto acumulado</p>
              <p className="text-sm font-semibold text-[var(--fg)] tabular-nums">
                {/* EN CONTRA / A FAVOR dicho con palabras, no con color: el
                    rojo es acción y el signo solo no alcanza para saber de
                    qué lado cae la plata. */}
                S/ {formatoMoneda(Math.abs(r.montoAcumulado))}
                {r.montoAcumulado < 0 ? ' en contra' : r.montoAcumulado > 0 ? ' a favor' : ''}
              </p>
            </div>
            <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2">
              <p className="text-[11px] text-[var(--fg-muted)]">Como faltante</p>
              <p className="text-sm font-semibold text-[var(--fg)] tabular-nums">
                {r.vecesFaltante} · {formatoMiles(r.unidadesFaltantes)} und
              </p>
            </div>
            <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2">
              <p className="text-[11px] text-[var(--fg-muted)]">Como sobrante</p>
              <p className="text-sm font-semibold text-[var(--fg)] tabular-nums">
                {r.vecesSobrante} · {formatoMiles(r.unidadesSobrantes)} und
              </p>
            </div>
          </div>

          {r.peorPeriodo !== null && (
            <p className="rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-[12px] text-[var(--fg)]">
              Peor diferencia: {formatoMiles(Math.abs(r.peorPeriodo.diferencia))}{' '}
              {pluralizar(Math.abs(r.peorPeriodo.diferencia), 'unidad', 'unidades')} en{' '}
              {MESES_CORTOS[r.peorPeriodo.mes - 1]} {r.peorPeriodo.anio}.
            </p>
          )}

          <section className="space-y-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-muted)]">Apariciones por período</h3>
            <div className="rounded-md border border-[var(--border)] bg-white px-3 py-2">
              {historia.apariciones.length === 0 ? (
                <p className="py-1 text-[12px] text-[var(--fg-muted)]">
                  Este código no tuvo diferencias en ningún inventario cerrado anterior.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[11px] text-[var(--fg-muted)]">
                      <th className="px-1 py-1 text-left font-semibold">Período</th>
                      <th className="px-1 py-1 text-left font-semibold">Sucursal</th>
                      <th className="px-1 py-1 text-right font-semibold">ERP</th>
                      <th className="px-1 py-1 text-right font-semibold">Contado</th>
                      <th className="px-1 py-1 text-right font-semibold">Unidades</th>
                      <th className="px-1 py-1 text-right font-semibold">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* El servidor las manda cronológicas ascendentes; se
                        invierten para leer del mes más reciente hacia atrás,
                        que es como se busca un patrón. */}
                    {[...historia.apariciones].reverse().map((a) => (
                      <tr key={a.inventarioId} className="border-b border-[var(--border)] last:border-b-0">
                        <td className="px-1 py-1 font-semibold text-[var(--fg)]">
                          {MESES_CORTOS[a.periodoMes - 1]} {a.periodoAnio}
                        </td>
                        <td className="max-w-[10rem] truncate px-1 py-1 text-[var(--fg)]">{a.sucursalNombre}</td>
                        <td className="px-1 py-1 text-right text-[var(--fg)] tabular-nums">{formatoMiles(a.stockSistema)}</td>
                        <td className="px-1 py-1 text-right text-[var(--fg)] tabular-nums">{formatoMiles(a.conteoFinal)}</td>
                        <td className="px-1 py-1 text-right text-[var(--fg)] tabular-nums">{formatoMiles(a.diferencia)}</td>
                        <td className="px-1 py-1 text-right text-[var(--fg)] tabular-nums">
                          {a.montoDiferencia === null ? (
                            <span className="text-[var(--fg-muted)]">{SIN_DATO}</span>
                          ) : (
                            `S/ ${formatoMoneda(Math.abs(a.montoDiferencia))}`
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      )}
    </SlidePanel>
  )
}
