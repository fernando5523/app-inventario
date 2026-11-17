import { useState } from 'react'
import { AlertIcon, CheckCircleIcon, FileIcon, XCircleFillIcon } from '@primer/octicons-react'
import { ErrorNotice } from '../common/ErrorNotice'
import { SlidePanel } from '../common/SlidePanel'
import { formatoMiles, pluralizar } from '../../utils/formato'
import { corregirApi } from './api'
import { elegirArchivoXlsx, textoDeAdvertencia } from './reglas'
import type { ArchivoElegido, ResultadoConfirmacion, VistaPreviaImportacion } from './tipos'

/**
 * ---------------------------------------------------------------------------
 * CORRECCIÓN MASIVA POR EXCEL, EN DOS PASOS
 * ---------------------------------------------------------------------------
 * Elegir el archivo → PREVISUALIZAR sin escribir nada → confirmar. Nunca se
 * aplica directo, y no es una cortesía: un archivo con 985 renglones puede
 * mover el conteo de un inventario entero, y leer la pantalla después de que
 * pasó no deshace nada.
 *
 * Es la misma forma que ya resolvió `AjustesNegativosScreen.web.tsx` para la
 * importación de ajustes, y se copió a propósito: dos importaciones del mismo
 * sistema que se usan distinto obligan a aprender dos veces.
 *
 * ---------------------------------------------------------------------------
 * LO QUE VA ADELANTE SON LAS RECHAZADAS Y LAS ADVERTENCIAS
 * ---------------------------------------------------------------------------
 * El resumen podría leerse como "42 sin cambio" y quedarse tranquilo. Lo que
 * el auditor tiene que ver primero es lo que NO va a pasar y lo que va a pasar
 * raro: una fila rechazada es trabajo suyo que se pierde si no la mira, y
 * `motivo-sin-cambio` casi siempre significa que escribió el motivo y se
 * olvidó de cambiar el número — o sea, una corrección que creía hecha.
 *
 * CADA FILA LLEVA SU NÚMERO DE FILA DEL EXCEL, que es lo único que le permite
 * abrir el archivo y encontrarla. Sin eso, "la fila del código 100150" es una
 * búsqueda a mano sobre mil renglones.
 */

interface PanelImportacionProps {
  abierto: boolean
  onCerrar: () => void
  /** Se llama después de confirmar: la tabla de atrás quedó vieja. */
  onAplicado: (resultado: ResultadoConfirmacion) => void
}

type Paso = 'elegir' | 'previsualizado' | 'aplicado'

export function PanelImportacion({ abierto, onCerrar, onAplicado }: PanelImportacionProps) {
  const [archivo, setArchivo] = useState<ArchivoElegido | null>(null)
  const [preview, setPreview] = useState<VistaPreviaImportacion | null>(null)
  const [aplicado, setAplicado] = useState<ResultadoConfirmacion | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const paso: Paso = aplicado !== null ? 'aplicado' : preview !== null ? 'previsualizado' : 'elegir'

  function limpiar() {
    setArchivo(null)
    setPreview(null)
    setAplicado(null)
    setError(null)
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
    setAplicado(null)
    setLeyendo(true)
    try {
      // NO PERSISTE NADA. Lo que está en la tabla de atrás sigue siendo lo
      // guardado hasta que se confirme.
      setPreview(await corregirApi.previsualizarCorrecciones(elegido.bytes))
    } catch (e) {
      setError(e)
      setArchivo(null)
    } finally {
      setLeyendo(false)
    }
  }

  async function confirmar() {
    if (archivo === null) return
    setConfirmando(true)
    setError(null)
    try {
      // Se manda el MISMO archivo, no lo previsualizado: el servidor relee y
      // reclasifica porque el estado pudo cambiar en el medio.
      const resultado = await corregirApi.confirmarCorrecciones(archivo.bytes, archivo.nombre)
      setAplicado(resultado)
      onAplicado(resultado)
    } catch (e) {
      setError(e)
    } finally {
      setConfirmando(false)
    }
  }

  const resultado = aplicado ?? preview

  return (
    <SlidePanel
      isOpen={abierto}
      onClose={() => {
        limpiar()
        onCerrar()
      }}
      title="Corregir con un Excel"
      size="lg"
      // Con un archivo previsualizado sin confirmar, un clic al aire no puede
      // tirar el trabajo de revisar la lista.
      isDirty={paso === 'previsualizado'}
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-[var(--fg-muted)]">
            {paso === 'previsualizado' ? 'Todavía no se escribió nada.' : ''}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-default"
              disabled={leyendo || confirmando}
              onClick={() => {
                limpiar()
                onCerrar()
              }}
            >
              {paso === 'aplicado' ? 'Cerrar' : 'Cancelar'}
            </button>
            {paso === 'previsualizado' && (
              <button type="button" className="btn btn-primary" disabled={confirmando} onClick={() => void confirmar()}>
                {confirmando
                  ? 'Aplicando...'
                  : `Aplicar ${formatoMiles(preview?.resumen.aCorregir ?? 0)} ${pluralizar(preview?.resumen.aCorregir ?? 0, 'corrección', 'correcciones')}`}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {paso === 'elegir' && (
          <>
            <p className="text-sm text-[var(--fg)]">
              Baja la plantilla con el botón de la pantalla, edita las columnas <strong>Nuevo valor</strong> y{' '}
              <strong>Motivo</strong>, y vuelve a subirla aquí.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-[12px] text-[var(--fg-muted)]">
              <li>El valor va en unidades, no en empaques.</li>
              <li>
                No cambies la columna <strong>Contado</strong>: es contra la que se compara, y además es lo que detecta
                un archivo viejo.
              </li>
              <li>Las filas que dejes igual no se tocan. El motivo es obligatorio en las que cambies.</li>
            </ul>
            <button type="button" className="btn btn-primary" disabled={leyendo} onClick={() => void elegir()}>
              <FileIcon size={14} />
              <span className="ml-1.5">{leyendo ? 'Leyendo el archivo...' : 'Elegir el archivo'}</span>
            </button>
          </>
        )}

        {resultado !== null && (
          <>
            {archivo !== null && (
              <p className="text-[12px] text-[var(--fg-muted)]">
                {archivo.nombre}
                {paso === 'previsualizado' && ' · nada escrito todavía'}
              </p>
            )}

            {aplicado !== null && (
              <div className="rounded-md border border-[var(--success-border)] bg-[var(--success-light)] px-3 py-2 text-[13px]">
                <p className="flex items-center gap-1.5 font-semibold text-[var(--fg)]">
                  <span className="text-[var(--success)]" aria-hidden="true">
                    <CheckCircleIcon size={14} />
                  </span>
                  Se aplicaron {formatoMiles(aplicado.resumen.aplicadas)}{' '}
                  {pluralizar(aplicado.resumen.aplicadas, 'corrección', 'correcciones')}
                </p>
                {/*
                  EL LOTE NO ES ATÓMICO A PROPÓSITO: una fila que falla no corta
                  el resto. Se dice porque cambia lo que hay que hacer después —
                  volver a subir el archivo entero repetiría lo que ya entró.
                */}
                {aplicado.resumen.fallidas > 0 && (
                  <p className="mt-1 text-[var(--fg)]">
                    {formatoMiles(aplicado.resumen.fallidas)}{' '}
                    {pluralizar(aplicado.resumen.fallidas, 'fila falló', 'filas fallaron')} y el resto sí entró:
                    las correcciones se aplican una por una, no todo o nada. Corrige solo esas filas y vuelve a subir.
                  </p>
                )}
              </div>
            )}

            {/* PRIMERO LO QUE NO VA A PASAR. */}
            {resultado.rechazadas.length > 0 && (
              <Bloque
                titulo={`${formatoMiles(resultado.rechazadas.length)} ${pluralizar(resultado.rechazadas.length, 'fila rechazada', 'filas rechazadas')}`}
                tono="danger"
                sub="No se van a aplicar. El número es la fila del Excel."
              >
                {resultado.rechazadas.map((r) => (
                  <li key={`r-${r.fila}`} className="flex gap-2">
                    <span className="shrink-0 font-semibold tabular-nums text-[var(--fg)]">Fila {r.fila}</span>
                    <span className="min-w-0">
                      <span className="font-medium text-[var(--fg)]">{r.codigo}</span> · {r.detalle || r.motivo}
                    </span>
                  </li>
                ))}
              </Bloque>
            )}

            {/* DESPUÉS LO QUE VA A PASAR RARO. */}
            {resultado.resumen.conAdvertencia > 0 && (
              <Bloque
                titulo={`${formatoMiles(resultado.resumen.conAdvertencia)} ${pluralizar(resultado.resumen.conAdvertencia, 'fila con advertencia', 'filas con advertencia')}`}
                tono="warning"
                sub="Se leyeron bien, pero conviene mirarlas antes de aplicar."
              >
                {resultado.sinCambio
                  .filter((s) => s.advertencias.length > 0)
                  .map((s) => (
                    <li key={`a-${s.fila}`} className="flex gap-2">
                      <span className="shrink-0 font-semibold tabular-nums text-[var(--fg)]">Fila {s.fila}</span>
                      <span className="min-w-0">
                        <span className="font-medium text-[var(--fg)]">{s.codigo}</span> ·{' '}
                        {s.advertencias.map(textoDeAdvertencia).join(' · ')}
                      </span>
                    </li>
                  ))}
              </Bloque>
            )}

            {/* Y AL FINAL LO QUE SÍ. */}
            {preview !== null && aplicado === null && preview.aCorregir.length > 0 && (
              <Bloque
                titulo={`${formatoMiles(preview.aCorregir.length)} ${pluralizar(preview.aCorregir.length, 'corrección', 'correcciones')} por aplicar`}
                tono="neutral"
                sub="Cada una queda registrada con tu nombre, la hora y su motivo."
              >
                {preview.aCorregir.map((c) => (
                  <li key={`c-${c.fila}`} className="flex gap-2">
                    <span className="shrink-0 font-semibold tabular-nums text-[var(--fg)]">Fila {c.fila}</span>
                    <span className="min-w-0">
                      <span className="font-medium text-[var(--fg)]">{c.codigo}</span> · {c.sucursal} · hoja #{c.hoja} ·{' '}
                      <span className="tabular-nums">
                        {formatoMiles(c.contadoActual)} → {formatoMiles(c.nuevoValor)}
                      </span>{' '}
                      · {c.motivo}
                    </span>
                  </li>
                ))}
              </Bloque>
            )}

            {/*
              DESPUÉS DE APLICAR SE MUESTRA OTRA LISTA, no la misma: los valores
              son los que el servidor GUARDÓ (`valorAnterior`/`valorNuevo`), no
              los que el archivo pedía. Si una fila entró con otro número —otra
              persona la tocó en el medio— acá se ve, y en la lista de la vista
              previa no se habría visto nunca.
            */}
            {aplicado !== null && aplicado.aplicadas.length > 0 && (
              <Bloque
                titulo={`${formatoMiles(aplicado.aplicadas.length)} ${pluralizar(aplicado.aplicadas.length, 'corrección aplicada', 'correcciones aplicadas')}`}
                tono="neutral"
                sub="Cada una quedó registrada con tu nombre, la hora y su motivo."
              >
                {aplicado.aplicadas.map((a) => (
                  <li key={`ap-${a.fila}`} className="flex gap-2">
                    <span className="shrink-0 font-semibold tabular-nums text-[var(--fg)]">Fila {a.fila}</span>
                    <span className="min-w-0">
                      <span className="font-medium text-[var(--fg)]">{a.codigo}</span> · {a.sucursal} · hoja #{a.hoja} ·{' '}
                      <span className="tabular-nums">
                        {formatoMiles(a.valorAnterior)} → {formatoMiles(a.valorNuevo)}
                      </span>
                      {/* Es la frase del cliente: "corrígelo para que ya no salga en mi segundo conteo". */}
                      {a.salioDeLaRondaSiguiente && ' · cuadró y salió del siguiente conteo'}
                    </span>
                  </li>
                ))}
              </Bloque>
            )}

            {resultado.resumen.sinCambio > 0 && (
              <p className="text-[12px] text-[var(--fg-muted)]">
                {formatoMiles(resultado.resumen.sinCambio)}{' '}
                {pluralizar(resultado.resumen.sinCambio, 'fila quedó igual', 'filas quedaron igual')} y no se tocan.
              </p>
            )}

            {paso === 'previsualizado' && preview !== null && preview.aCorregir.length === 0 && (
              <p className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-light)] px-3 py-2 text-[12px] text-[var(--fg)]">
                Este archivo no cambia ningún conteo: no hay nada que aplicar. Revisa que hayas editado la columna
                <strong> Nuevo valor</strong> y guardado el archivo.
              </p>
            )}
          </>
        )}
      </div>

      {/* Dentro de un formulario el error va acá y no en un toast: el detalle
          del servidor dice qué columna falta o qué fila no se pudo leer, y
          tiene que seguir a la vista mientras se arregla el archivo. */}
      {error !== null && (
        <ErrorNotice
          title={paso === 'previsualizado' ? 'No se pudo aplicar la corrección' : 'No se pudo leer el archivo'}
          error={error}
          onDismiss={() => setError(null)}
        />
      )}
    </SlidePanel>
  )
}

/** Un bloque de la previsualización: título, qué significa, y sus filas. */
function Bloque({
  titulo,
  sub,
  tono,
  children,
}: {
  titulo: string
  sub: string
  tono: 'danger' | 'warning' | 'neutral'
  children: React.ReactNode
}) {
  const borde =
    tono === 'danger' ? 'border-[var(--danger-border)]' : tono === 'warning' ? 'border-[var(--warning-border)]' : 'border-[var(--border)]'
  const icono =
    tono === 'danger' ? (
      <span className="text-[var(--danger)]" aria-hidden="true">
        <XCircleFillIcon size={14} />
      </span>
    ) : tono === 'warning' ? (
      <span className="text-[var(--warning)]" aria-hidden="true">
        <AlertIcon size={14} />
      </span>
    ) : null

  return (
    <div className={`rounded-md border ${borde} px-3 py-2`}>
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--fg)]">
        {icono}
        {titulo}
      </p>
      <p className="text-[11px] text-[var(--fg-muted)]">{sub}</p>
      {/* Alto acotado: una lista de 985 renglones deja el botón de confirmar a
          media hora de scroll. */}
      <ul className="mt-1.5 max-h-56 space-y-1 overflow-auto text-[12px] text-[var(--fg-muted)]">{children}</ul>
    </div>
  )
}
