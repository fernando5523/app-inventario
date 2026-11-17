import { useEffect, useMemo, useState } from 'react'
import { AlertIcon, InfoIcon } from '@primer/octicons-react'
import { ErrorNotice } from '../common/ErrorNotice'
import { FormField } from '../common/FormField'
import { SlidePanel } from '../common/SlidePanel'
import { formatoMiles } from '../../utils/formato'
import { MOTIVO_MINIMO, STOCK_NO_SE_CORRIGE, errorDeMotivo, ordinal, textoStockDeLaMedicion, totalUnidades } from './reglas'
import type { FilaCorregible, LineaEmpaque } from './tipos'

/**
 * ---------------------------------------------------------------------------
 * EL FORMULARIO DE CORRECCIÓN
 * ---------------------------------------------------------------------------
 * Un campo por cada empaque del producto, las unidades sueltas, el total en
 * vivo, y el motivo obligatorio. Es el equivalente del `ModalConteo` que usan
 * las dos apps móviles, con las MISMAS tres reglas que están discutidas con el
 * cliente:
 *
 * 1. EL STOCK SE VE Y NO SE TOCA. Es una celda inerte con su explicación
 *    (`STOCK_NO_SE_CORRIGE`): corregir lo CONTADO no es corregir el STOCK. No
 *    es solo que el campo esté deshabilitado — el stock no viaja en el cuerpo
 *    del PATCH, y el backend no tiene ningún endpoint que lo edite.
 * 2. EL MOTIVO ES OBLIGATORIO y queda registrado con el nombre de quien
 *    corrige y la hora. El servidor exige 3 caracteres; acá el piso son 5,
 *    porque con un campo obligatorio y sin piso lo que se escribe es "x".
 * 3. EL TOTAL SE CALCULA, nunca se tipea: es la misma cuenta que usó quien
 *    contó (`totalUnidades`). Un total a mano al lado de sus partes es
 *    garantizar que algún día no coincidan.
 *
 * `SlidePanel` y no `Modal`: el formulario tiene tantos campos como empaques
 * tenga el producto más el motivo, y el panel lateral no tiene que pelear con
 * el alto de la ventana. Con `isDirty`, un clic al aire o un Escape no pueden
 * descartar lo tipeado.
 */

interface PanelCorreccionProps {
  fila: FilaCorregible | null
  guardando: boolean
  /** El error del último intento de guardar. `null` = todavía no falló nada. */
  error: unknown
  onDescartarError: () => void
  onGuardar: (cuerpo: { empaques: LineaEmpaque[]; sueltas: number; motivo: string }) => void
  onCerrar: () => void
}

export function PanelCorreccion({ fila, guardando, error, onDescartarError, onGuardar, onCerrar }: PanelCorreccionProps) {
  /**
   * Las cantidades como TEXTO mientras se tipea, no como número.
   *
   * Un "1" a medio escribir camino a "12" no puede convertirse en un total
   * mostrado con un valor a medias, y "12a" no puede tirar la cuenta a NaN en
   * silencio. El número sale recién al armar el cuerpo.
   */
  const [cantidades, setCantidades] = useState<Record<string, string>>({})
  const [sueltas, setSueltas] = useState('')
  const [motivo, setMotivo] = useState('')
  const [intentoGuardar, setIntentoGuardar] = useState(false)

  const producto = fila?.producto ?? null

  /**
   * Al abrir, los campos arrancan con lo que HAY GUARDADO. No es un default
   * que nadie mira: es el valor actual, y hay que verlo para decidir a dónde
   * moverlo. El motivo arranca vacío a propósito: es la explicación de ESTE
   * cambio, no la del anterior.
   */
  useEffect(() => {
    if (fila === null) return
    const iniciales: Record<string, string> = {}
    for (const linea of fila.conteo?.empaques ?? []) iniciales[linea.empaqueNombre] = String(linea.cantidad)
    setCantidades(iniciales)
    setSueltas(fila.conteo === null ? '' : String(fila.conteo.sueltas))
    setMotivo('')
    setIntentoGuardar(false)
  }, [fila])

  const soloDigitos = (texto: string) => texto.replace(/[^0-9]/g, '')

  /** Las líneas con algo cargado: un conteo no lista un empaque en 0. */
  const empaques: LineaEmpaque[] = useMemo(() => {
    if (producto === null) return []
    return producto.empaques
      .map((e) => ({ empaqueNombre: e.nombre, cantidad: Number(cantidades[e.nombre] ?? '') || 0 }))
      .filter((l) => l.cantidad > 0)
  }, [producto, cantidades])

  const sueltasNumero = Number(sueltas) || 0
  const total = producto === null ? 0 : totalUnidades({ empaques, sueltas: sueltasNumero }, producto.empaques)

  const medicion = fila?.item?.stockDeLaMedicion ?? null
  const stockDeReferencia = medicion?.stockErp ?? null
  const notaDelStock = medicion === null ? null : textoStockDeLaMedicion(medicion)
  /** La diferencia que dejaría ESTE valor, contra el mismo stock que usa la fila. */
  const diferenciaResultante = stockDeReferencia === null ? null : total - stockDeReferencia

  const problemaMotivo = errorDeMotivo(motivo)
  /** Sin conteo previo esto no es una corrección: sería cargar un conteo a nombre de nadie. */
  const sinConteoPrevio = fila !== null && fila.conteo === null
  const puedeGuardar = problemaMotivo === null && !guardando && !sinConteoPrevio
  const hayCambios = motivo.trim() !== '' || (fila !== null && total !== (fila.contado ?? 0))

  const enviar = () => {
    setIntentoGuardar(true)
    if (!puedeGuardar) return
    onGuardar({ empaques, sueltas: sueltasNumero, motivo: motivo.trim() })
  }

  const claseCampo =
    'w-full px-3 py-2 text-sm border border-[var(--border)] rounded-md bg-white text-[var(--fg)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)] disabled:bg-[var(--bg-subtle)]'
  /** `tabular-nums` solo en las cifras: en el motivo desalinea el texto. */
  const claseNumero = `${claseCampo} tabular-nums`

  return (
    <SlidePanel
      isOpen={fila !== null}
      onClose={onCerrar}
      title="Corregir lo contado"
      isDirty={hayCambios}
      footer={
        <div className="flex items-center justify-end gap-2">
          {/* `btn btn-default` / `btn btn-primary`: las clases del portal, las
              mismas que usa `ConfirmDialog`. Nada de hex ni de tokens
              inventados -- el primario acaba de pasar de rojo a negro y esto
              lo sigue solo. */}
          <button type="button" onClick={onCerrar} disabled={guardando} className="btn btn-default">
            Cancelar
          </button>
          <button type="button" onClick={enviar} disabled={!puedeGuardar} className="btn btn-primary">
            {guardando ? 'Guardando...' : 'Guardar la corrección'}
          </button>
        </div>
      }
    >
      {fila === null || producto === null ? null : (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-[var(--fg)]">{producto.descripcion}</p>
            <p className="text-xs text-[var(--fg-muted)]">
              {producto.codigo} · Hoja #{fila.numeroHoja}
              {/* La categoría del PRODUCTO. Ver el comentario de la columna en
                  CorregirConteos: `zona` es la del bloque y pintaba un vino
                  como detergente. */}
              {fila.producto.categoria ? ` · ${fila.producto.categoria}` : ''}
            </p>
          </div>

          {/*
            LO QUE HAY HOY Y CONTRA QUÉ SE MIDE, antes de los campos. Las dos
            cifras juntas son lo que permite decidir el valor nuevo; separarlas
            obligaría a recordar una mientras se lee la otra.

            EL STOCK ES UNA CELDA INERTE, no un campo deshabilitado que
            sugiera que algún día se podrá escribir.
          */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2">
              <p className="text-[11px] text-[var(--fg-muted)]">Contado hoy</p>
              <p className="text-sm font-semibold text-[var(--fg)] tabular-nums">
                {fila.contado === null ? '—' : formatoMiles(fila.contado)}
              </p>
            </div>
            <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2">
              <p className="text-[11px] text-[var(--fg-muted)]">
                Stock del sistema
                {medicion?.rondaDelStock != null && medicion.rondaDelStock > 1
                  ? ` (${ordinal(medicion.rondaDelStock)} conteo)`
                  : ''}
              </p>
              <p className="text-sm font-semibold text-[var(--fg)] tabular-nums">
                {stockDeReferencia === null ? '—' : formatoMiles(stockDeReferencia)}
              </p>
            </div>
          </div>

          <p className="flex items-start gap-1.5 text-[12px] text-[var(--fg-muted)]">
            <span className="mt-[2px] shrink-0" aria-hidden="true">
              <InfoIcon size={13} />
            </span>
            <span>{STOCK_NO_SE_CORRIGE}</span>
          </p>

          {notaDelStock !== null && (
            <p className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-light)] px-3 py-2 text-[12px] text-[var(--fg)]">
              {notaDelStock}
            </p>
          )}

          {sinConteoPrevio && (
            <p className="flex items-start gap-1.5 rounded-md border border-[var(--warning-border)] bg-[var(--warning-light)] px-3 py-2 text-[12px] text-[var(--fg)]">
              <span className="mt-[2px] shrink-0 text-[var(--warning)]" aria-hidden="true">
                <AlertIcon size={13} />
              </span>
              <span>
                Este producto todavía no tiene conteo, así que no hay nada que corregir: un 0 significa "lo vi y no
                había" y lo tiene que afirmar quien fue a la góndola. Si falta contarlo, se cuenta.
              </span>
            </p>
          )}

          {/* UN CAMPO POR EMPAQUE, con su nombre tal cual lo da el sistema
              ("Emp.12"): no se le antepone ninguna palabra nuestra ni se
              inventa la presentación. */}
          {producto.empaques.map((empaque) => (
            <FormField key={empaque.nombre} label={`${empaque.nombre} (${empaque.factor} por empaque)`}>
              <input
                type="text"
                inputMode="numeric"
                className={claseNumero}
                value={cantidades[empaque.nombre] ?? ''}
                placeholder="0"
                disabled={guardando || sinConteoPrevio}
                onChange={(e) => setCantidades((act) => ({ ...act, [empaque.nombre]: soloDigitos(e.target.value) }))}
              />
            </FormField>
          ))}

          <FormField label="Unidades sueltas">
            <input
              type="text"
              inputMode="numeric"
              className={claseNumero}
              value={sueltas}
              placeholder="0"
              disabled={guardando || sinConteoPrevio}
              onChange={(e) => setSueltas(soloDigitos(e.target.value))}
            />
          </FormField>

          {/*
            LA CONVERSIÓN A LA VISTA: la cuenta que se MUESTRA es la que se
            GUARDA. Sin el desglose, un total de 93 no se puede verificar
            contra lo que se tipeó.
          */}
          <div className="rounded-md border border-[var(--border)] px-3 py-2">
            <p className="text-[11px] text-[var(--fg-muted)]">Nuevo total</p>
            <p className="text-base font-semibold text-[var(--fg)] tabular-nums">{formatoMiles(total)} und</p>
            <p className="mt-0.5 text-[11px] text-[var(--fg-muted)]">
              {[
                ...empaques.map((l) => {
                  const factor = producto.empaques.find((e) => e.nombre === l.empaqueNombre)?.factor ?? 0
                  return `${l.cantidad} ${l.empaqueNombre} × ${factor} = ${l.cantidad * factor}`
                }),
                `${sueltasNumero} sueltas`,
              ].join(' + ')}
            </p>
            {diferenciaResultante !== null && (
              <p className="mt-1 text-[12px] text-[var(--fg)]">
                {diferenciaResultante === 0
                  ? 'Con este valor el producto cuadra contra el stock del sistema.'
                  : `Con este valor quedaría una diferencia de ${diferenciaResultante > 0 ? '+' : ''}${formatoMiles(diferenciaResultante)} contra el stock del sistema.`}
              </p>
            )}
          </div>

          <FormField
            label="Motivo del cambio"
            required
            error={intentoGuardar && problemaMotivo !== null ? problemaMotivo : undefined}
            helperText={`Queda registrado con tu nombre y la hora. Al menos ${MOTIVO_MINIMO} caracteres.`}
          >
            <textarea
              className={`${claseCampo} min-h-[72px]`}
              value={motivo}
              maxLength={200}
              placeholder="Por qué cambia este valor"
              disabled={guardando || sinConteoPrevio}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </FormField>
        </div>
      )}

      {/* Dentro de un formulario el error va en `ErrorNotice`, no en un toast:
          el mensaje del servidor dice qué regla se topó y tiene que seguir a la
          vista mientras se decide qué hacer. */}
      {error !== null && <ErrorNotice title="No se pudo corregir el conteo" error={error} onDismiss={onDescartarError} />}
    </SlidePanel>
  )
}
