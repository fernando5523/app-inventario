import { useCallback, useEffect, useState } from 'react'
import { AlertIcon, CheckCircleIcon, FileIcon, XCircleFillIcon } from '@primer/octicons-react'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { ErrorNotice } from '../common/ErrorNotice'
import { FormField } from '../common/FormField'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { SlidePanel } from '../common/SlidePanel'
import { StatusBadge } from '../common/StatusBadge'
import { formatoMoneda, pluralizar } from '../../utils/formato'
import { elegirArchivoXlsx, liquidacionApi, type ArchivoElegido } from './api'
import {
  MOTIVO_LINEA_MAXIMO,
  TEXTO_LINEAS_BLOQUEADAS,
  accionDeLinea,
  errorDeMotivoLinea,
  resumenPreview,
  textoImportacionConfirmada,
  textoMotivoAdvertencia,
  textoMotivoRechazo,
  textoQueSeConfirma,
  textosAccionLinea,
  tituloPreviewFallido,
  totalLineasNoExcluidas,
  vistaImportar,
  type AccionLinea,
  type LineaAjusteNegativoGuardada,
  type ListadoLineasAjustesNegativos,
  type ResultadoPreviewAjustesNegativos,
} from './ajustesNegativos'

/**
 * ---------------------------------------------------------------------------
 * EL EXCEL DE AJUSTES DE NEGATIVOS, EN DOS PASOS
 * ---------------------------------------------------------------------------
 * Elegir el archivo → PREVISUALIZAR sin escribir nada → confirmar. Nunca se
 * aplica directo: de este archivo sale el monto que baja el faltante que se le
 * descuenta al personal, y leer la pantalla después de aplicarlo no deshace
 * nada.
 *
 * Es el MISMO flujo que ya resolvió `AjustesNegativosScreen.web.tsx` en la app
 * y que copió `corregir/PanelImportacion.tsx` en este portal. Se copia a
 * propósito: dos importaciones del mismo sistema que se usan distinto obligan
 * a aprender dos veces.
 *
 * ---------------------------------------------------------------------------
 * EXCLUIR UNA LÍNEA PIDE UN MOTIVO, Y NO ES BUROCRACIA
 * ---------------------------------------------------------------------------
 * Excluir baja el monto de ajustes, o sea sube lo que se le descuenta al
 * personal. El motivo queda firmado con el nombre de quien lo escribió y es lo
 * que se audita después; sin él, esa plata se movería sin dejar rastro.
 *
 * Con el inventario ya liquidado el servidor devuelve `puedeEditar: false` y
 * acá los botones desaparecen con su explicación: no se toca la plata de algo
 * que ya se cerró.
 */

const soles = (n: number): string => `S/ ${formatoMoneda(n)}`

interface PanelAjustesNegativosProps {
  abierto: boolean
  inventarioId: number
  /** `false` con el inventario liquidado o lacrado: solo lectura. */
  onCerrar: () => void
  /** Se llama cuando el monto cambió: la pantalla de atrás quedó vieja. */
  onCambio: () => void
}

type EstadoFilaPreview = 'entra' | 'advertencia' | 'rechazada'

interface FilaPreview {
  clave: string
  fila: number
  codigo: string | null
  nombre: string | null
  importe: number | null
  estado: EstadoFilaPreview
  /** Por qué no entra, o qué tiene de raro. `null` cuando no hay nada que decir. */
  detalle: string | null
}

/**
 * Las válidas y las rechazadas EN UNA SOLA LISTA, ordenadas por su fila del
 * Excel. Dos tablas separadas obligarían a saltar entre ellas para reconstruir
 * el archivo; el número de fila es lo único que permite abrirlo y encontrarla.
 */
function filasDelPreview(preview: Extract<ResultadoPreviewAjustesNegativos, { ok: true }>): FilaPreview[] {
  const validas = preview.validas.map<FilaPreview>((v) => ({
    clave: `valida-${v.fila}`,
    fila: v.fila,
    codigo: v.codigo,
    nombre: v.nombre2,
    importe: v.importe,
    estado: v.advertencias.length > 0 ? 'advertencia' : 'entra',
    detalle: v.advertencias.length > 0 ? v.advertencias.map(textoMotivoAdvertencia).join(' ') : null,
  }))

  const rechazadas = preview.rechazadas.map<FilaPreview>((r) => ({
    clave: `rechazada-${r.fila}`,
    fila: r.fila,
    codigo: null,
    nombre: null,
    importe: null,
    estado: 'rechazada',
    detalle: textoMotivoRechazo(r.motivo),
  }))

  return [...validas, ...rechazadas].sort((a, b) => a.fila - b.fila)
}

/** Las mismas palabras que la app: "Entra a la suma" / "Suma, con aviso" / "No entra". */
const BADGE_PREVIEW: Record<EstadoFilaPreview, { label: string; variant: 'default' | 'warning' | 'danger' }> = {
  entra: { label: 'Entra a la suma', variant: 'default' },
  advertencia: { label: 'Suma, con aviso', variant: 'warning' },
  rechazada: { label: 'No entra', variant: 'danger' },
}

export function PanelAjustesNegativos({ abierto, inventarioId, onCerrar, onCambio }: PanelAjustesNegativosProps) {
  const [listado, setListado] = useState<ListadoLineasAjustesNegativos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [archivo, setArchivo] = useState<ArchivoElegido | null>(null)
  const [preview, setPreview] = useState<ResultadoPreviewAjustesNegativos | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [confirmado, setConfirmado] = useState<string | null>(null)

  const [dialogo, setDialogo] = useState<{ linea: LineaAjusteNegativoGuardada; accion: AccionLinea } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      setListado(await liquidacionApi.listarLineas(inventarioId))
      setError(null)
    } catch (e) {
      setListado(null)
      setError(e)
    } finally {
      setCargando(false)
    }
  }, [inventarioId])

  useEffect(() => {
    if (!abierto) return
    void cargar()
  }, [abierto, cargar])

  function limpiarImportacion() {
    setArchivo(null)
    setPreview(null)
    setConfirmado(null)
  }

  async function elegir() {
    setError(null)
    let elegido: ArchivoElegido | null
    try {
      elegido = await elegirArchivoXlsx()
    } catch (e) {
      setError(e)
      return
    }
    // Canceló el diálogo del navegador: no es un error y no se avisa.
    if (elegido === null) return

    setArchivo(elegido)
    setPreview(null)
    setConfirmado(null)
    setLeyendo(true)
    try {
      // NO PERSISTE NADA: el monto de atrás sigue siendo el guardado hasta que
      // se confirme.
      setPreview(await liquidacionApi.previsualizar(inventarioId, elegido.bytes))
    } catch (e) {
      setError(e)
      setArchivo(null)
    } finally {
      setLeyendo(false)
    }
  }

  async function confirmar() {
    if (archivo === null || preview?.ok !== true) return
    setConfirmando(true)
    setError(null)
    try {
      // Se manda el MISMO archivo, no lo previsualizado: el servidor relee y
      // revalida porque el estado pudo cambiar en el medio.
      const r = await liquidacionApi.confirmar(inventarioId, archivo.bytes, archivo.nombre)
      setConfirmado(
        textoImportacionConfirmada(
          { nombreArchivo: r.nombreArchivo, cantidadValidas: r.cantidadValidas, montoNegativos: r.montoNegativos },
          soles,
        ),
      )
      setArchivo(null)
      setPreview(null)
      // Se relee lo PERSISTIDO en vez de pintar lo que devolvió el POST: una
      // sola fuente de verdad para lo que está guardado.
      await cargar()
      onCambio()
    } catch (e) {
      setError(e)
    } finally {
      setConfirmando(false)
    }
  }

  function abrirDialogo(linea: LineaAjusteNegativoGuardada) {
    setDialogo({ linea, accion: accionDeLinea(linea.excluida) })
    setMotivo('')
    setErrorMotivo(null)
  }

  async function guardarMotivo() {
    if (dialogo === null) return
    const problema = errorDeMotivoLinea(dialogo.accion, motivo)
    if (problema !== null) {
      setErrorMotivo(problema)
      return
    }
    setGuardando(true)
    setError(null)
    try {
      const { linea, accion } = dialogo
      if (accion === 'excluir') await liquidacionApi.excluirLinea(inventarioId, linea.id, motivo.trim())
      else await liquidacionApi.incluirLinea(inventarioId, linea.id, motivo.trim())
      setDialogo(null)
      await cargar()
      onCambio()
    } catch (e) {
      setError(e)
    } finally {
      setGuardando(false)
    }
  }

  const vista = vistaImportar(listado?.importacion ?? null)
  const lineas = listado?.lineas ?? []
  const puedeEditar = listado?.puedeEditar ?? false
  const resumen = preview?.ok === true ? resumenPreview(preview) : null

  return (
    <>
      <SlidePanel
        isOpen={abierto}
        onClose={() => {
          limpiarImportacion()
          onCerrar()
        }}
        title={vista.titulo}
        size="lg"
        // Con un archivo previsualizado sin confirmar, un clic al aire no puede
        // tirar el trabajo de revisar la lista.
        isDirty={preview !== null}
        footer={
          preview?.ok === true ? (
            <div className="flex items-center justify-end gap-2">
              <button type="button" className="btn btn-default" onClick={limpiarImportacion} disabled={confirmando}>
                Descartar
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void confirmar()} disabled={confirmando}>
                {confirmando ? 'Confirmando...' : 'Confirmar la importación'}
              </button>
            </div>
          ) : undefined
        }
      >
        <div className="space-y-4 text-[13px]">
          {/* QUÉ HAY IMPORTADO HOY. Sin esto, "reemplazar" no dice qué se reemplaza. */}
          {cargando ? (
            <div className="py-8 flex justify-center">
              <LoadingSpinner text="Leyendo la importación vigente..." />
            </div>
          ) : (
            <>
              {vista.nota !== null && (
                <p className="rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[var(--fg-muted)]">
                  {vista.nota}
                </p>
              )}

              {confirmado !== null && (
                <p className="flex items-start gap-2 rounded-md border border-[var(--success-border)] bg-[var(--success-light)] p-3 text-[var(--fg)]">
                  <CheckCircleIcon size={14} className="mt-0.5 shrink-0" />
                  <span>{confirmado}</span>
                </p>
              )}

              <div>
                <button type="button" className="btn btn-default" onClick={() => void elegir()} disabled={leyendo}>
                  <FileIcon size={14} />
                  {leyendo ? 'Leyendo el archivo...' : vista.boton}
                </button>
              </div>

              {/* EL ARCHIVO NO SE PUDO LEER: el título dice cuál de los dos
                  problemas es, y el detalle viene del servidor tal cual. */}
              {preview?.ok === false && (
                <div className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-light)] p-3">
                  <p className="font-semibold text-[var(--fg)]">{tituloPreviewFallido(preview.motivo)}</p>
                  <p className="text-[var(--fg)]">{preview.detalle}</p>
                </div>
              )}

              {/* LA PREVISUALIZACIÓN. Lo que se lee primero es la cifra que se
                  va a guardar, porque es la que baja el descuento al personal. */}
              {preview?.ok === true && resumen !== null && (
                <div className="space-y-2">
                  <p className="rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[var(--fg)]">
                    {textoQueSeConfirma(resumen, soles)}
                  </p>
                  {resumen.conAdvertencia > 0 && (
                    <p className="flex items-start gap-2 text-[var(--fg-muted)]">
                      <AlertIcon size={14} className="mt-0.5 shrink-0" />
                      <span>
                        {resumen.conAdvertencia}{' '}
                        {pluralizar(resumen.conAdvertencia, 'línea suma con un aviso', 'líneas suman con un aviso')}:
                        míralas antes de confirmar.
                      </span>
                    </p>
                  )}
                  <TablaPreview filas={filasDelPreview(preview)} />
                </div>
              )}

              {/* LAS LÍNEAS YA GUARDADAS, con lo que de verdad suma. */}
              {listado?.importacion && (
                <div className="space-y-2 border-t border-[var(--border)] pt-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-semibold text-[var(--fg)]">Líneas de la importación vigente</h3>
                    <span className="tabular-nums text-[var(--fg-muted)]">
                      {soles(totalLineasNoExcluidas(lineas))} de {lineas.length}{' '}
                      {pluralizar(lineas.length, 'línea', 'líneas')}
                    </span>
                  </div>
                  {!puedeEditar && <p className="text-[var(--fg-muted)]">{TEXTO_LINEAS_BLOQUEADAS}</p>}
                  <TablaLineas lineas={lineas} puedeEditar={puedeEditar} onAccion={abrirDialogo} />
                </div>
              )}
            </>
          )}
        </div>
      </SlidePanel>

      {/* EL MOTIVO VA EN EL PROPIO DIÁLOGO: confirmar y escribir por qué son el
          mismo gesto, y separarlos deja la puerta a excluir sin motivo. */}
      {dialogo !== null && (
        <ConfirmDialog
          isOpen
          title={textosAccionLinea(dialogo.accion).titulo}
          isLoading={guardando}
          confirmText={textosAccionLinea(dialogo.accion).etiqueta}
          onCancel={() => setDialogo(null)}
          onClose={() => setDialogo(null)}
          onConfirm={() => void guardarMotivo()}
          message={
            <div className="space-y-3 text-left">
              <p className="text-[13px] text-[var(--fg-muted)]">
                Fila {dialogo.linea.fila} · {dialogo.linea.codigo} · {soles(dialogo.linea.importe)}
              </p>
              <FormField label="Motivo" required error={errorMotivo ?? undefined}>
                <textarea
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-[13px] text-[var(--fg)]"
                  rows={3}
                  maxLength={MOTIVO_LINEA_MAXIMO}
                  value={motivo}
                  onChange={(e) => {
                    setMotivo(e.target.value)
                    setErrorMotivo(null)
                  }}
                  placeholder={textosAccionLinea(dialogo.accion).placeholder}
                />
              </FormField>
            </div>
          }
        />
      )}

      {/* Dentro de un panel, el error va en `ErrorNotice` y no en un toast: se
          queda hasta que se lea, al lado del botón que falló. */}
      {error !== null && (
        <ErrorNotice title="No se pudo completar la operación" error={error} onDismiss={() => setError(null)} />
      )}
    </>
  )
}

/** La tabla de la previsualización: una fila del Excel por renglón. */
function TablaPreview({ filas }: { filas: FilaPreview[] }) {
  if (filas.length === 0) {
    return <p className="text-[var(--fg-muted)]">El archivo no trajo ninguna línea.</p>
  }
  return (
    <div className="max-h-80 overflow-auto rounded-md border border-[var(--border)]">
      <table className="w-full">
        <thead className="sticky top-0 bg-[var(--surface)]">
          <tr className="border-b border-[var(--border)] text-left text-[11px] font-semibold text-[var(--fg-muted)]">
            <th className="px-2 py-1.5">Fila</th>
            <th className="px-2 py-1.5">Código</th>
            <th className="px-2 py-1.5">Producto</th>
            <th className="px-2 py-1.5 text-right">Importe</th>
            <th className="px-2 py-1.5">Estado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const badge = BADGE_PREVIEW[f.estado]
            return (
              <tr key={f.clave} className="border-b border-[var(--border)] align-top last:border-0">
                <td className="px-2 py-1.5 tabular-nums text-[var(--fg)]">{f.fila}</td>
                <td className="px-2 py-1.5 tabular-nums text-[var(--fg)]">{f.codigo ?? '—'}</td>
                <td className="px-2 py-1.5 text-[var(--fg)]">
                  {f.nombre ?? '—'}
                  {/* El porqué, pegado a la fila: buscarlo en una leyenda
                      aparte obliga a cruzar dos listas. */}
                  {f.detalle !== null && <p className="text-[11px] text-[var(--fg-muted)]">{f.detalle}</p>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-[var(--fg)]">
                  {f.importe === null ? '—' : soles(f.importe)}
                </td>
                <td className="px-2 py-1.5">
                  <StatusBadge status={badge.label} label={badge.label} variant={badge.variant} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Las líneas guardadas, con el botón de excluir o volver a incluir. */
function TablaLineas({
  lineas,
  puedeEditar,
  onAccion,
}: {
  lineas: readonly LineaAjusteNegativoGuardada[]
  puedeEditar: boolean
  onAccion: (linea: LineaAjusteNegativoGuardada) => void
}) {
  if (lineas.length === 0) {
    return <p className="text-[var(--fg-muted)]">La importación vigente no dejó ninguna línea.</p>
  }
  return (
    <div className="max-h-96 overflow-auto rounded-md border border-[var(--border)]">
      <table className="w-full">
        <thead className="sticky top-0 bg-[var(--surface)]">
          <tr className="border-b border-[var(--border)] text-left text-[11px] font-semibold text-[var(--fg-muted)]">
            <th className="px-2 py-1.5">Fila</th>
            <th className="px-2 py-1.5">Código</th>
            <th className="px-2 py-1.5">Producto</th>
            <th className="px-2 py-1.5 text-right">Importe</th>
            <th className="px-2 py-1.5">Estado</th>
            {puedeEditar && <th className="px-2 py-1.5" />}
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => (
            <tr key={l.id} className="border-b border-[var(--border)] align-top last:border-0">
              <td className="px-2 py-1.5 tabular-nums text-[var(--fg)]">{l.fila}</td>
              <td className="px-2 py-1.5 tabular-nums text-[var(--fg)]">{l.codigo}</td>
              <td className="px-2 py-1.5 text-[var(--fg)]">
                {l.descripcion}
                {/* EL MOTIVO SE MUESTRA, no se esconde: es lo que se audita. */}
                {l.excluida && l.motivoExclusion !== null && (
                  <p className="text-[11px] text-[var(--fg-muted)]">Excluida: {l.motivoExclusion}</p>
                )}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-[var(--fg)]">{soles(l.importe)}</td>
              <td className="px-2 py-1.5">
                {l.excluida ? (
                  <StatusBadge status="Excluida" label="Excluida" variant="default" />
                ) : (
                  <StatusBadge status="Suma" label="Suma" variant="success" />
                )}
              </td>
              {puedeEditar && (
                <td className="px-2 py-1.5 text-right">
                  <button type="button" className="btn btn-default" onClick={() => onAccion(l)}>
                    {l.excluida ? <CheckCircleIcon size={14} /> : <XCircleFillIcon size={14} />}
                    {textosAccionLinea(accionDeLinea(l.excluida)).etiqueta}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
