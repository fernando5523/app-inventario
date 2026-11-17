import { useEffect, useState, type ReactNode } from 'react'
import { DownloadIcon, ShieldCheckIcon } from '@primer/octicons-react'
import { ErrorNotice } from '../common/ErrorNotice'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { SlidePanel } from '../common/SlidePanel'
import { StatusBadge } from '../common/StatusBadge'
import { downloadXlsx } from '../../utils/xlsx'
import { notifyError } from '../../utils/notifyError'
import { MESES_CORTOS, formatoMiles, formatoMoneda, formatoPct, pluralizar } from '../../utils/formato'
import { historialApi } from './historialApi'
import {
  ESTADOS,
  conteoAbierto,
  estadoExportacion,
  fecha,
  fechaHora,
  motivoSinNeto,
  nombreArchivoCuadros,
  nombreArchivoDiferencias,
  motivoSinResumenDePlanilla,
  porPlata,
  rolCapitalizado,
  sinResultado,
  textoFirmas,
  textoSinLacrar,
} from './historialDominio'
import type {
  DetalleInventarioHistorico,
  DiferenciaHistorica,
  InventarioHistorico,
  LiquidacionInventario,
} from './historialTipos'
import { PanelHistoricoItem } from './PanelHistoricoItem'

/**
 * ---------------------------------------------------------------------------
 * EL DETALLE DE UN INVENTARIO DEL HISTÓRICO
 * ---------------------------------------------------------------------------
 * Todo lo que se puede decir de un inventario cerrado: cómo quedó el ciclo,
 * qué diferencias dejó, cuánto se le descontó a quién, quién lo firmó y si el
 * sello sigue intacto.
 *
 * CADA BLOQUE DICE POR QUÉ CUANDO NO PUEDE DECIR EL DATO. Ninguno desaparece
 * ni muestra un guion: "no está" y "todavía no" se ven igual cuando no hay
 * nada en pantalla, y la diferencia entre las dos es lo único que esta
 * pantalla tiene para dar. Los textos salen de `historialDominio.ts`, donde
 * están probados uno por uno.
 *
 * SOLO LECTURA. Firmar, lacrar y marcar el registro en Dynamics viven en
 * "Aprobación y lacrado".
 */

/** Sin dato es guion, NUNCA un 0: un cero afirma que se midió y dio cero. */
const SIN_DATO = '—'

function Dato({ etiqueta, valor }: { etiqueta: string; valor: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--border)] py-1.5 last:border-b-0">
      <span className="text-[12px] text-[var(--fg-muted)]">{etiqueta}</span>
      {/* En la tinta normal, sin verde ni rojo por signo: el rojo es acción. */}
      <span className="text-right text-xs font-medium text-[var(--fg)] tabular-nums">{valor}</span>
    </div>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-muted)]">{titulo}</h3>
      <div className="rounded-md border border-[var(--border)] bg-white px-3 py-2">{children}</div>
    </section>
  )
}

function SinDatos({ children }: { children: ReactNode }) {
  return <p className="py-1 text-[12px] text-[var(--fg-muted)]">{children}</p>
}

export function PanelDetalle({
  inventario,
  onCerrar,
}: {
  /** `null` = cerrado. Es la fila de la grilla; el detalle completo se pide al abrir. */
  inventario: InventarioHistorico | null
  onCerrar: () => void
}) {
  const [detalle, setDetalle] = useState<DetalleInventarioHistorico | null>(null)
  const [diferencias, setDiferencias] = useState<DiferenciaHistorica[]>([])
  const [liquidacion, setLiquidacion] = useState<LiquidacionInventario | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [exportando, setExportando] = useState<'diferencias' | 'cuadros' | null>(null)
  const [codigoEnHistoria, setCodigoEnHistoria] = useState<string | null>(null)

  useEffect(() => {
    if (inventario === null) return
    let vigente = true
    setCargando(true)
    setError(null)
    setDetalle(null)
    setDiferencias([])
    setLiquidacion(null)
    /**
     * LAS TRES LECTURAS EN PARALELO, y las dos del cierre toleran su propio
     * fallo: un inventario recién cerrado puede no tener planilla todavía, y
     * eso no es un error que deba tapar el detalle entero. El detalle sí: sin
     * él no hay nada que dibujar.
     */
    void (async () => {
      try {
        const [d, dif, liq] = await Promise.all([
          historialApi.detalle(inventario.id),
          historialApi.diferencias(inventario.id).catch(() => [] as DiferenciaHistorica[]),
          historialApi.liquidacion(inventario.id).catch(() => null),
        ])
        if (!vigente) return
        setDetalle(d)
        setDiferencias(porPlata(dif))
        setLiquidacion(liq)
      } catch (e) {
        if (vigente) setError(e)
      } finally {
        if (vigente) setCargando(false)
      }
    })()
    return () => {
      vigente = false
    }
  }, [inventario])

  const exportar = async (cual: 'diferencias' | 'cuadros') => {
    if (detalle === null) return
    setExportando(cual)
    try {
      // El respaldo del nombre se arma acá porque es acá donde están la
      // tienda y el período; el bueno sigue siendo el del servidor.
      const archivo =
        cual === 'diferencias'
          ? await historialApi.exportarDiferencias(
              detalle.id,
              nombreArchivoDiferencias(detalle.sucursal.nombre, detalle.periodoAnio, detalle.periodoMes, detalle.id),
            )
          : await historialApi.exportarCuadros(
              detalle.id,
              nombreArchivoCuadros(detalle.sucursal.nombre, detalle.periodoAnio, detalle.periodoMes, detalle.id),
            )
      downloadXlsx(archivo.nombreArchivo, archivo.bytes)
    } catch (e) {
      notifyError('No se pudo exportar', e)
    } finally {
      setExportando(null)
    }
  }

  const exportacion = detalle === null ? null : estadoExportacion(detalle.estado, diferencias.length)

  return (
    <>
      <SlidePanel
        isOpen={inventario !== null}
        onClose={onCerrar}
        title={inventario === null ? 'Detalle' : `${MESES_CORTOS[inventario.periodoMes - 1]} ${inventario.periodoAnio} · ${inventario.sucursalNombre}`}
        size="lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onCerrar} className="btn btn-default">
              Cerrar
            </button>
          </div>
        }
      >
        {cargando ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner text="Leyendo el inventario..." />
          </div>
        ) : error !== null ? (
          <ErrorNotice error={error} title="No se pudo cargar el detalle" />
        ) : detalle === null ? null : (
          <div className="space-y-4">
            <div className="rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--fg)]">
                  Inventario {detalle.id} · {detalle.sucursal.nombre}
                </p>
                <StatusBadge
                  status={ESTADOS[detalle.estado].etiqueta}
                  label={ESTADOS[detalle.estado].etiqueta}
                  variant={ESTADOS[detalle.estado].variante}
                />
              </div>
              <p className="text-[12px] text-[var(--fg-muted)]">
                Creado el {fecha(detalle.abiertoEn)} · {formatoMiles(detalle.snapshotItems)}{' '}
                {pluralizar(detalle.snapshotItems, 'ítem', 'ítems')}
                {detalle.tamanoHoja ? ` · hojas de ${detalle.tamanoHoja}` : ''}
                {detalle.cerradoEn ? ` · conteo cerrado el ${fecha(detalle.cerradoEn)}` : ' · conteo todavía abierto'}
                {detalle.cerradoPor ? ` por ${detalle.cerradoPor.nombre}` : ''}
              </p>
            </div>

            <Seccion titulo="Resultado del ciclo">
              {detalle.resultado === null ? (
                <SinDatos>{sinResultado(detalle.estado)}</SinDatos>
              ) : (
                <>
                  <Dato etiqueta="Ítems totales" valor={formatoMiles(detalle.resultado.itemsTotales)} />
                  <Dato
                    etiqueta="Ítems cuadrados"
                    valor={`${formatoMiles(detalle.resultado.itemsCuadrados)} (${formatoPct(detalle.resultado.porcentajeCuadrado)}%)`}
                  />
                  <Dato etiqueta="Ítems con diferencia" valor={formatoMiles(detalle.resultado.itemsConDiferencia)} />
                  {detalle.resultado.itemsSegundoConteo !== undefined && (
                    <Dato etiqueta="Fueron a 2do conteo" valor={formatoMiles(detalle.resultado.itemsSegundoConteo)} />
                  )}
                  {detalle.resultado.itemsTercerConteo !== undefined && (
                    <Dato etiqueta="Fueron a 3er conteo" valor={formatoMiles(detalle.resultado.itemsTercerConteo)} />
                  )}
                  {detalle.resultado.unidadesFaltantes !== undefined && (
                    <Dato etiqueta="Unidades faltantes" valor={formatoMiles(detalle.resultado.unidadesFaltantes)} />
                  )}
                  {detalle.resultado.unidadesSobrantes !== undefined && (
                    <Dato etiqueta="Unidades sobrantes" valor={formatoMiles(detalle.resultado.unidadesSobrantes)} />
                  )}
                  <Dato etiqueta="Faltante bruto" valor={`S/ ${formatoMoneda(detalle.resultado.montoFaltanteBruto)}`} />
                  {/* `null` NO es 0: "todavía no se liquidó" y "no falta nada"
                      son cosas distintas, y acá eso decide plata. */}
                  <Dato
                    etiqueta="Faltante neto"
                    valor={
                      detalle.resultado.montoFaltanteNeto === null ? (
                        <span className="font-normal text-[var(--fg-muted)]">{motivoSinNeto(detalle.resultado)}</span>
                      ) : (
                        `S/ ${formatoMoneda(detalle.resultado.montoFaltanteNeto)}`
                      )
                    }
                  />
                  <Dato
                    etiqueta="Cuota por colaborador"
                    valor={
                      detalle.resultado.cuotaBase === null ? (
                        <span className="font-normal text-[var(--fg-muted)]">{motivoSinNeto(detalle.resultado)}</span>
                      ) : (
                        `S/ ${formatoMoneda(detalle.resultado.cuotaBase)}`
                      )
                    }
                  />
                </>
              )}
            </Seccion>

            {/*
              LA SECCIÓN SE MUESTRA SIEMPRE, incluso con el conteo abierto.
              Antes desaparecía entera y quien entraba a exportar no veía ni el
              botón ni una explicación (hallazgo del cliente, 2026-09-08).
            */}
            <Seccion titulo={`Diferencias${diferencias.length > 0 ? ` (${formatoMiles(diferencias.length)})` : ''}`}>
              {exportacion !== null && !exportacion.puedeExportar ? (
                <SinDatos>{exportacion.motivo}</SinDatos>
              ) : (
                <div className="-mx-1 max-h-[22rem] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-[var(--border)] text-[11px] text-[var(--fg-muted)]">
                        <th className="px-1 py-1 text-left font-semibold">Código</th>
                        <th className="px-1 py-1 text-left font-semibold">Descripción</th>
                        <th className="px-1 py-1 text-right font-semibold">ERP</th>
                        <th className="px-1 py-1 text-right font-semibold">Contado</th>
                        <th className="px-1 py-1 text-right font-semibold">Unidades</th>
                        <th className="px-1 py-1 text-right font-semibold">Monto</th>
                        <th className="px-1 py-1 text-left font-semibold">Tipo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diferencias.map((d) => (
                        <tr
                          key={d.codigo}
                          onClick={() => setCodigoEnHistoria(d.codigo)}
                          title="Ver la historia de este ítem"
                          className="cursor-pointer border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-subtle)]"
                        >
                          <td className="px-1 py-1 font-semibold text-[var(--fg)]">{d.codigo}</td>
                          <td className="max-w-[14rem] truncate px-1 py-1 text-[var(--fg)]">{d.descripcion}</td>
                          <td className="px-1 py-1 text-right text-[var(--fg)] tabular-nums">{formatoMiles(d.stockSistema)}</td>
                          <td className="px-1 py-1 text-right text-[var(--fg)] tabular-nums">{formatoMiles(d.conteoFinal)}</td>
                          <td className="px-1 py-1 text-right text-[var(--fg)] tabular-nums">{formatoMiles(d.diferencia)}</td>
                          <td className="px-1 py-1 text-right text-[var(--fg)] tabular-nums">
                            {/* Sin precio NO es S/ 0,00: el snapshot no trajo
                                con qué valorizarlo, que es otra cosa. */}
                            {d.montoDiferencia === null ? (
                              <span className="text-[var(--fg-muted)]">Sin precio</span>
                            ) : (
                              `S/ ${formatoMoneda(Math.abs(d.montoDiferencia))}`
                            )}
                          </td>
                          <td className="px-1 py-1 text-[var(--fg)]">
                            {d.tipo === 'faltante' ? 'Faltante' : 'Sobrante'} · {d.resueltoEnConteo}º
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Seccion>

            {/*
              Los dos .xlsx son FORMATOS DISTINTOS del mismo hecho, no uno el
              reemplazo del otro: el de diferencias es la tabla plana que se
              manda por WhatsApp, y el de cuadros es la planilla con el formato
              del cliente. Solo aparecen cuando hay algo que exportar: con cero
              diferencias saldría un archivo de solo encabezados, y un archivo
              vacío mandado por WhatsApp es peor que no tener el botón.
            */}
            {exportacion?.puedeExportar && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void exportar('diferencias')} disabled={exportando !== null} className="btn btn-default">
                  <DownloadIcon size={13} />
                  <span className="ml-1.5">{exportando === 'diferencias' ? 'Exportando...' : 'Diferencias a Excel'}</span>
                </button>
                <button type="button" onClick={() => void exportar('cuadros')} disabled={exportando !== null} className="btn btn-default">
                  <DownloadIcon size={13} />
                  <span className="ml-1.5">{exportando === 'cuadros' ? 'Exportando...' : 'Cuadros a Excel'}</span>
                </button>
              </div>
            )}

            {/* Se liquida ANTES de lacrar (regla del cliente): un conteo recién
                cerrado puede no tener planilla todavía, y la sección lo dice en
                vez de esconderse. */}
            {!conteoAbierto(detalle.estado) && (
              <Seccion titulo="Planilla de liquidación">
                {liquidacion === null || liquidacion.planilla.length === 0 ? (
                  <SinDatos>Todavía no se liquidó este inventario.</SinDatos>
                ) : (
                  <>
                    {liquidacion.resumen === null ? (
                      // null NO es un resumen con ceros: falta un dato de
                      // captura, no falta plata.
                      <SinDatos>{motivoSinResumenDePlanilla(liquidacion)}</SinDatos>
                    ) : (
                      <>
                        <Dato etiqueta="Faltante neto a repartir" valor={`S/ ${formatoMoneda(liquidacion.resumen.montoFaltanteNeto)}`} />
                        <Dato etiqueta="Cuota base por colaborador" valor={`S/ ${formatoMoneda(liquidacion.resumen.cuotaBase)}`} />
                        {liquidacion.resumen.faltantes > 0 && (
                          <Dato
                            etiqueta={`Multa por inasistencia (${liquidacion.resumen.faltantes})`}
                            valor={`S/ ${formatoMoneda(liquidacion.resumen.fondoMultas)}`}
                          />
                        )}
                      </>
                    )}
                    <div className="mt-2 max-h-72 overflow-auto">
                      {liquidacion.planilla.map((p) => (
                        <div
                          key={p.colaboradorId}
                          className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-1.5 last:border-b-0"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs text-[var(--fg)]">{p.nombre}</p>
                            <p className="truncate text-[11px] text-[var(--fg-muted)]">
                              {rolCapitalizado(p.rol)} · {p.asistio ? 'Asistió' : 'Faltó'}
                              {/* El nombre de HOY cuando cambió: la planilla
                                  dice lo que se firmó, y con el de hoy se lo
                                  encuentra. */}
                              {p.nombreActual !== p.nombre ? ` · ahora: ${p.nombreActual}` : ''}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs font-medium text-[var(--fg)] tabular-nums">
                            S/ {formatoMoneda(p.totalDescuento)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Seccion>
            )}

            <Seccion titulo="Hojas de conteo">
              {detalle.hojas.length === 0 ? (
                <SinDatos>Este inventario no tiene el detalle de hojas guardado.</SinDatos>
              ) : (
                <div className="max-h-56 overflow-auto">
                  {detalle.hojas.map((h) => (
                    <div
                      key={h.id}
                      className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-1 last:border-b-0"
                    >
                      <span className="truncate text-xs text-[var(--fg)]">
                        Hoja #{h.numero} · {h.numeroConteo}º conteo
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--fg-muted)]">
                        {h.contados}/{h.productos} · {h.asignados.map((a) => a.nombre).join(', ') || 'Sin asignar'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Seccion>

            {/*
              Que este bloque exista o no es, en sí mismo, la señal más fuerte
              de la pantalla: con sello, el inventario ya es historia; sin
              sello, todavía se puede modificar.
            */}
            {detalle.lacrado === null ? (
              <Seccion titulo="Lacrado">
                <div className="flex items-center justify-between gap-2 pb-1">
                  <span className="text-xs font-semibold text-[var(--fg)]">Todavía no está lacrado</span>
                  <StatusBadge
                    status="firmas"
                    label={textoFirmas(detalle.aprobaciones.length, detalle.aprobacionesRequeridas)}
                    variant={detalle.aprobaciones.length >= detalle.aprobacionesRequeridas ? 'success' : 'default'}
                  />
                </div>
                <SinDatos>{textoSinLacrar(detalle.estado, detalle.aprobaciones.length, detalle.aprobacionesRequeridas)}</SinDatos>
              </Seccion>
            ) : (
              <>
                <Seccion titulo="Lacrado">
                  <Dato etiqueta="Folio" valor={detalle.lacrado.folio} />
                  <Dato etiqueta="Lacrado el" valor={fechaHora(detalle.lacrado.lacradoEn)} />
                  <Dato etiqueta="Lacrado por" valor={detalle.lacrado.lacradoPor.nombre} />
                  {/* EL HASH COMPLETO, sin recortar: es lo que permite
                      verificar el sello contra otra copia, y la mitad de un
                      hash no sirve para nada. */}
                  <Dato
                    etiqueta="Sello"
                    valor={<span className="break-all font-mono text-[10px]">{detalle.lacrado.hash}</span>}
                  />
                  <p className="flex items-start gap-1.5 pt-2 text-[12px] text-[var(--fg-muted)]">
                    <span className="mt-[2px] shrink-0" aria-hidden="true">
                      <ShieldCheckIcon size={13} />
                    </span>
                    <span>
                      La verificación del sello —recalcular el hash y comparar— vive en "Aprobación y lacrado": acá el
                      histórico solo lee.
                    </span>
                  </p>
                </Seccion>

                <Seccion titulo="Doble validación">
                  {detalle.aprobaciones.length === 0 ? (
                    <SinDatos>Este inventario se lacró sin firmas registradas.</SinDatos>
                  ) : (
                    detalle.aprobaciones.map((a) => (
                      <div key={`${a.aprobadorId}-${a.aprobadoEn}`} className="border-b border-[var(--border)] py-1.5 last:border-b-0">
                        <p className="text-xs font-medium text-[var(--fg)]">{a.aprobadorNombre}</p>
                        <p className="text-[11px] text-[var(--fg-muted)]">
                          {/* El rol CONGELADO al firmar, no el de hoy: si
                              después cambió de puesto, la firma sigue siendo
                              la del rol que firmó. */}
                          {rolCapitalizado(a.rolAlAprobar)} al firmar · {fechaHora(a.aprobadoEn)}
                        </p>
                        {a.nota && <p className="text-[11px] italic text-[var(--fg-muted)]">“{a.nota}”</p>}
                      </div>
                    ))
                  )}
                </Seccion>

                <Seccion titulo="Registro en Dynamics">
                  <SinDatos>
                    {detalle.lacrado.registroErp
                      ? `Registrado a mano en Dynamics por ${detalle.lacrado.registroErp.registradoPor.nombre} el ${fecha(detalle.lacrado.registroErp.registradoEn)} · referencia ${detalle.lacrado.registroErp.referencia}.`
                      : 'Todavía no se registró en Dynamics. El ajuste automático es fase 2: por ahora lo carga TI a mano.'}
                  </SinDatos>
                </Seccion>
              </>
            )}

            {detalle.snapshotTomadoEn !== null && (
              <p className="text-[11px] text-[var(--fg-muted)]">
                Snapshot de Dynamics tomado el {fechaHora(detalle.snapshotTomadoEn)}. Es la foto del stock contra la que
                se midió todo este inventario.
              </p>
            )}
            {detalle.snapshotTomadoEn === null && <p className="text-[11px] text-[var(--fg-muted)]">Sin snapshot de Dynamics: {SIN_DATO}</p>}
          </div>
        )}
      </SlidePanel>

      <PanelHistoricoItem codigo={codigoEnHistoria} onCerrar={() => setCodigoEnHistoria(null)} />
    </>
  )
}
