import { useEffect, useMemo, useState } from 'react'
import { InfoIcon } from '@primer/octicons-react'
import { ErrorNotice } from '../common/ErrorNotice'
import { FormField } from '../common/FormField'
import { SlidePanel } from '../common/SlidePanel'
import { formatoMiles, pluralizar } from '../../utils/formato'
import { MOTIVO_MINIMO, STOCK_NO_SE_CORRIGE, errorDeMotivo, ordinal, textoStockDeLaMedicion } from '../corregir/reglas'
import type { ItemDeLaMatriz } from '../corregir/tipos'
import { diferenciaDelAjuste, interpretarCantidad } from './reglas'

/**
 * ---------------------------------------------------------------------------
 * EL FORMULARIO DEL AJUSTE FINAL
 * ---------------------------------------------------------------------------
 * Un solo valor en UNIDADES, el motivo obligatorio, y LA DIFERENCIA QUE
 * DEJARÍA ESE VALOR, calculada en vivo. Esa última es la razón de que el
 * formulario exista y no se reuse el de corrección: el Auditor no está
 * cargando una cantidad, está cerrando una brecha, y ver el resultado antes
 * de guardar es su trabajo entero.
 *
 * Tres reglas que vienen del dominio y no se tocan:
 *
 * 1. EL STOCK SE VE Y NO SE TOCA (`STOCK_NO_SE_CORRIGE`). Celda inerte, no un
 *    campo deshabilitado que sugiera que algún día se va a poder: el stock ni
 *    siquiera viaja en el cuerpo del PATCH.
 * 2. EL MOTIVO ES OBLIGATORIO y queda registrado con quién y cuándo. El
 *    servidor exige 3 caracteres; acá el piso son 5, el mismo que la
 *    corrección — con un campo obligatorio y sin piso lo que se escribe es "x".
 * 3. EL VALOR VA EN UNIDADES, no en empaques (ver `reglas.ts`).
 *
 * `SlidePanel` con `isDirty`: un clic al aire o un Escape no pueden descartar
 * lo tipeado. Es la misma protección que el teléfono resuelve preguntando
 * "¿Descartar el ajuste?".
 */

interface PanelAjusteProps {
  item: ItemDeLaMatriz | null
  /**
   * `false` = este ítem no está en las hojas de la última ronda, así que el
   * ajuste no lo alcanza. No es un permiso ni un estado de carga: es el dominio
   * (ver `ajusteApi.productosDeLaUltimaRonda`). Se abre el panel igual —con el
   * conteo, el stock y la explicación— y lo único que falta es el campo.
   */
  ajustable: boolean
  /** La última ronda del inventario, para nombrarla en esa explicación. */
  ultimaRonda: number | null
  guardando: boolean
  /** El error del último intento. `null` = todavía no falló nada. */
  error: unknown
  onGuardar: (unidades: number, motivo: string) => void
  onCerrar: () => void
}

export function PanelAjuste({ item, ajustable, ultimaRonda, guardando, error, onGuardar, onCerrar }: PanelAjusteProps) {
  const [texto, setTexto] = useState('')
  const [motivo, setMotivo] = useState('')

  /**
   * Arranca con el valor ACTUAL, no vacío: acá no se carga un dato nuevo, se
   * corrige uno que ya existe, y hay que verlo para decidir cuánto moverlo.
   * Cada ítem estrena su propio motivo.
   */
  useEffect(() => {
    if (item === null) return
    setTexto(item.conteoFinal === null ? '' : String(item.conteoFinal))
    setMotivo('')
  }, [item])

  const cantidad = interpretarCantidad(texto)
  const faltaMotivo = errorDeMotivo(motivo)
  const puedeGuardar = ajustable && cantidad.ok && faltaMotivo === null && !guardando

  const medicion = item?.stockDeLaMedicion ?? null
  const notaDelStock = medicion === null ? null : textoStockDeLaMedicion(medicion)

  /** La diferencia que dejaría lo tipeado. Se recalcula con cada tecla. */
  const previsualizacion = useMemo(
    () => (item !== null && cantidad.ok ? diferenciaDelAjuste(item, cantidad.valor) : null),
    [item, cantidad.ok, cantidad.ok ? cantidad.valor : null],
  )

  const sinCambios =
    !ajustable ||
    (item !== null && texto === (item.conteoFinal === null ? '' : String(item.conteoFinal)) && motivo.trim() === '')

  const claseCampo =
    'w-full px-3 py-2 text-sm border border-[var(--border)] rounded-md bg-white text-[var(--fg)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)] disabled:bg-[var(--bg-subtle)]'

  return (
    <SlidePanel
      isOpen={item !== null}
      onClose={onCerrar}
      title="Ajustar valor"
      isDirty={!sinCambios}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCerrar} disabled={guardando} className="btn btn-default">
            {ajustable ? 'Cancelar' : 'Cerrar'}
          </button>
          {/* SIN BOTÓN DE GUARDAR cuando el ítem no es ajustable: uno
              deshabilitado promete que algo lo va a habilitar, y acá no. */}
          {ajustable && (
            <button
              type="button"
              onClick={() => cantidad.ok && onGuardar(cantidad.valor, motivo.trim())}
              disabled={!puedeGuardar}
              className="btn btn-primary"
            >
              {guardando ? 'Guardando...' : 'Guardar el ajuste'}
            </button>
          )}
        </div>
      }
    >
      {item === null ? null : (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-[var(--fg)]">{item.descripcion}</p>
            <p className="text-xs text-[var(--fg-muted)]">
              Código {item.codigo}
              {item.hoja ? ` · Hoja #${item.hoja}` : ''}
            </p>
          </div>

          {/*
            LO QUE HAY Y CONTRA QUÉ SE MIDE, antes del campo. Juntas son lo que
            permite decidir el valor nuevo; separarlas obligaría a recordar una
            mientras se lee la otra.
          */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2">
              <p className="text-[11px] text-[var(--fg-muted)]">Último conteo</p>
              <p className="text-sm font-semibold text-[var(--fg)] tabular-nums">
                {item.conteoFinal === null ? '—' : formatoMiles(item.conteoFinal)}
              </p>
            </div>
            <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2">
              {/* EL RÓTULO LLEVA LA RONDA del stock cuando no es la primera:
                  se está por fijar un valor contra este número y hay que saber
                  de qué pasada es. */}
              <p className="text-[11px] text-[var(--fg-muted)]">
                Stock del sistema
                {medicion?.rondaDelStock != null && medicion.rondaDelStock > 1
                  ? ` (${ordinal(medicion.rondaDelStock)} conteo)`
                  : ''}
              </p>
              <p className="text-sm font-semibold text-[var(--fg)] tabular-nums">
                {medicion?.stockErp == null ? '—' : formatoMiles(medicion.stockErp)}
              </p>
            </div>
          </div>

          <p className="flex items-start gap-1.5 text-[12px] text-[var(--fg-muted)]">
            <span className="mt-[2px] shrink-0" aria-hidden="true">
              <InfoIcon size={13} />
            </span>
            <span>{STOCK_NO_SE_CORRIGE}</span>
          </p>

          {/* LA CAÍDA A LA RONDA 1, DICHA CON PALABRAS: de esta resta sale un
              descuento a nómina y el Auditor está por firmarla. */}
          {notaDelStock !== null && (
            <p className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-light)] px-3 py-2 text-[12px] text-[var(--fg)]">
              {notaDelStock}
            </p>
          )}

          {/*
            EL ÍTEM QUE NO LLEGÓ A LA ÚLTIMA RONDA, dicho con palabras en vez de
            un 404 al guardar. No es una falla: el ajuste corrige el último
            conteo, y quien no está en esas hojas no tiene último conteo que
            corregir. Lo que se ve arriba (conteo, stock, diferencia) sigue
            sirviendo para leerlo.
          */}
          {!ajustable ? (
            <p className="rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-[12px] text-[var(--fg)]">
              Este ítem no entró en {ultimaRonda === null ? 'la última ronda' : `el ${ordinal(ultimaRonda)} conteo`}, que es
              sobre el que escribe el ajuste final: acá no hay valor que fijarle. Si hay que cambiarlo, se corrige la hoja de
              la ronda en la que se contó.
            </p>
          ) : (
            <>
            <FormField
              label="Valor definitivo (unidades)"
              required
              error={!cantidad.ok && texto.trim() !== '' ? cantidad.mensaje : undefined}
            >
              <input
                type="text"
                inputMode="numeric"
                className={`${claseCampo} tabular-nums`}
                value={texto}
                placeholder="—"
                disabled={guardando}
                onChange={(e) => setTexto(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </FormField>

            {/* EL RESULTADO, antes de guardar: si con este número el ítem cuadra. */}
            {previsualizacion !== null ? (
              <p className="rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-[12px] text-[var(--fg)]">
                {previsualizacion === 0
                  ? 'Con este valor el ítem cuadra contra el ERP.'
                  : `Con este valor queda ${previsualizacion < 0 ? 'un faltante' : 'un sobrante'} de ${formatoMiles(Math.abs(previsualizacion))} ${pluralizar(Math.abs(previsualizacion), 'unidad', 'unidades')}.`}
              </p>
            ) : medicion?.stockErp == null ? (
              <p className="rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-[12px] text-[var(--fg)]">
                Este ítem no tiene stock en el ERP: el valor se puede fijar igual, pero no hay contra qué compararlo.
              </p>
            ) : null}

            <FormField
              label="Motivo del cambio"
              required
              error={motivo.trim() !== '' && faltaMotivo !== null ? faltaMotivo : undefined}
              helperText={`Queda registrado con tu nombre y la hora. Al menos ${MOTIVO_MINIMO} caracteres.`}
            >
              <textarea
                rows={2}
                className={claseCampo}
                value={motivo}
                placeholder="Por qué fijas este valor"
                disabled={guardando}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </FormField>

            {/* Dentro del formulario va `ErrorNotice`, no un toast: el mensaje
                del servidor tiene que quedar al lado del campo que lo produjo. */}
            {error !== null && <ErrorNotice error={error} title="No se pudo ajustar el ítem" />}
            </>
          )}
        </div>
      )}
    </SlidePanel>
  )
}
