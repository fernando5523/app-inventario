import { useEffect, useRef, useState } from 'react'
import { AlertIcon } from '@primer/octicons-react'
import { ErrorNotice } from '../common/ErrorNotice'
import { SlidePanel } from '../common/SlidePanel'
import {
  ADVERTENCIA_SIN_EMPAQUE,
  CLASES,
  consecuenciaDeEmpaque,
  empaqueTecleado,
  errorDeEmpaque,
  explicacionClase,
  textoClase,
  textoEmpaqueCompra,
  textoExcepcionActual,
  textoResponsableDynamics,
} from './reglas'
import type { ClaseItem, ExcepcionAGuardar, ProductoClasificable } from './tipos'

/**
 * ---------------------------------------------------------------------------
 * LA EXCEPCIÓN DE UN PRODUCTO: EL FORMULARIO QUE DECIDE PLATA
 * ---------------------------------------------------------------------------
 * Acá se decide si el faltante de un producto se le descuenta a alguien del
 * personal o lo asume la empresa. Es el mismo formulario del teléfono
 * (`mobile/components/pantallas/ClasificacionScreen.web.tsx`), texto por texto
 * y con los mismos criterios: cada párrafo salió de un hallazgo —el empaque
 * que no se podía corregir solo, el Paquete sin efecto, el cierre que
 * descartaba lo tecleado—, así que rediseñarlo sería reabrir esas decisiones.
 *
 * LAS DOS COSAS QUE SE GUARDAN SON INDEPENDIENTES, y eso es el centro:
 *
 * 1. FORZAR EL CUADRO es OPCIONAL. Solo si el sistema se equivoca en ESTE
 *    producto.
 * 2. CORREGIR EL EMPAQUE DE COMPRA alcanza solo. Es la frase de Gilmer —"así
 *    evitamos estar corrigiendo 1:1"—: un producto que Dynamics trae con
 *    empaque 1 y viene en display de 12 pasa a Paquete con la corrección, sin
 *    forzar nada.
 *
 * Y LA CONSECUENCIA SE DICE ANTES DE GUARDAR ("Hoy va a Unidad; al guardar
 * pasa a Paquete"), no después de que el faltante salga distinto.
 */

interface PanelExcepcionProps {
  producto: ProductoClasificable | null
  guardando: boolean
  /** El error del último intento. `null` = todavía no falló nada. */
  error: unknown
  onDescartarError: () => void
  onGuardar: (cuerpo: ExcepcionAGuardar) => void
  onQuitar: () => void
  onCerrar: () => void
}

export function PanelExcepcion({
  producto,
  guardando,
  error,
  onDescartarError,
  onGuardar,
  onQuitar,
  onCerrar,
}: PanelExcepcionProps) {
  const [clase, setClase] = useState<ClaseItem | null>(null)
  const [empaqueTexto, setEmpaqueTexto] = useState('')
  const [nota, setNota] = useState('')

  /**
   * Los campos se siembran con LO QUE ESTÁ GUARDADO cuando se abre otro
   * producto, y no en cada render: sembrarlos de nuevo mientras se teclea
   * pisaría lo escrito con lo viejo.
   */
  const codigoAbierto = useRef<string | null>(null)
  useEffect(() => {
    if (producto === null) {
      codigoAbierto.current = null
      return
    }
    if (codigoAbierto.current === producto.codigo) return
    codigoAbierto.current = producto.codigo
    setClase(producto.clasificacion?.clase ?? null)
    setEmpaqueTexto(
      producto.clasificacion?.empaqueCompraCorregido == null
        ? ''
        : String(producto.clasificacion.empaqueCompraCorregido),
    )
    setNota(producto.clasificacion?.nota ?? '')
  }, [producto])

  const errorEmpaque = errorDeEmpaque(empaqueTexto)
  const correccion = empaqueTecleado(empaqueTexto)
  /** Hay ALGO que guardar: un cuadro forzado, o una corrección de empaque. */
  const hayAlgoQueGuardar = clase !== null || correccion !== null

  const hayCambios =
    producto !== null &&
    (clase !== (producto.clasificacion?.clase ?? null) ||
      empaqueTexto.trim() !==
        (producto.clasificacion?.empaqueCompraCorregido == null
          ? ''
          : String(producto.clasificacion.empaqueCompraCorregido)) ||
      nota.trim() !== (producto.clasificacion?.nota ?? ''))

  const consecuencia =
    producto !== null && errorEmpaque === null && hayAlgoQueGuardar
      ? consecuenciaDeEmpaque(producto, clase, correccion)
      : null

  const empaqueDelErp = producto ? textoEmpaqueCompra(producto.empaqueCompra, producto.empaqueCompraSimbolo) : null
  const esExcepcionVieja = producto?.clasificacion != null && producto.clasificacion.clase === null

  function enviar() {
    if (producto === null || !hayAlgoQueGuardar || errorEmpaque !== null) return
    onGuardar({
      // SOLO la clase: `esEmpresa` lo deriva el servidor, y por eso no pueden
      // discrepar.
      clase,
      // `null` cuando el campo quedó vacío: es el deshacer, y tiene que viajar
      // explícito para que el servidor borre la corrección anterior.
      empaqueCompraCorregido: correccion,
      ...(nota.trim() ? { nota: nota.trim() } : {}),
    })
  }

  const claseCampo =
    'w-full rounded-md border border-[var(--border)] bg-white px-2 py-1.5 text-sm text-[var(--fg)] focus:outline-none focus:border-[var(--primary)]'

  return (
    <SlidePanel
      isOpen={producto !== null}
      onClose={onCerrar}
      title="Clasificar el producto"
      isDirty={hayCambios}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCerrar} disabled={guardando} className="btn btn-default">
            Cancelar
          </button>
          <button
            type="button"
            onClick={enviar}
            disabled={!hayAlgoQueGuardar || errorEmpaque !== null || guardando}
            className="btn btn-primary"
          >
            {guardando ? 'Guardando...' : producto?.clasificacion ? 'Guardar el cambio' : 'Guardar la excepción'}
          </button>
        </div>
      }
    >
      {producto === null ? null : (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-[var(--fg)]">{producto.descripcion}</p>
            <p className="text-xs text-[var(--fg-muted)]">
              {producto.codigo}
              {producto.categoria ? ` · ${producto.categoria}` : ''}
            </p>
          </div>

          {/*
            LO QUE HACE EL SISTEMA Y LO QUE DECIDISTE TÚ, separados y a la par.
            Es el pedido explícito: fundirlos escondería justamente dónde no
            coinciden, que es lo único que esta pantalla viene a responder.
          */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2">
              <p className="text-[11px] text-[var(--fg-muted)]">El sistema hace</p>
              <p className="text-sm font-semibold text-[var(--fg)]">
                {textoResponsableDynamics(producto.responsableDynamics)} · {textoClase(producto.claseDynamics)}
              </p>
            </div>
            <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2">
              <p className="text-[11px] text-[var(--fg-muted)]">Tu excepción</p>
              <p className="text-sm font-semibold text-[var(--fg)]">{textoExcepcionActual(producto)}</p>
            </div>
          </div>

          {esExcepcionVieja && (
            <p className="rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-[12px] text-[var(--fg)]">
              Esta excepción se cargó antes de que existieran las tres vías, así que solo dice si la asume la empresa.
              Elige una vía para dejarla completa.
            </p>
          )}

          <div>
            <div className="flex items-baseline gap-2">
              <p className="text-[13px] font-semibold text-[var(--fg)]">Forzar el cuadro</p>
              <span className="text-[11px] text-[var(--fg-muted)]">opcional</span>
            </div>
            <SelectorClase valor={clase} onElegir={setClase} disabled={guardando} />
            {clase !== null && (
              <button
                type="button"
                onClick={() => setClase(null)}
                disabled={guardando}
                className="mt-1.5 text-[12px] text-[var(--fg-muted)] underline underline-offset-2 hover:text-[var(--fg)]"
              >
                Quitar el cuadro forzado — que lo decida el sistema
              </button>
            )}
            {clase !== null ? (
              <p className="mt-1.5 text-[12px] text-[var(--fg-muted)]">{explicacionClase(clase)}</p>
            ) : (
              /* Sin ninguno elegido se explican LAS TRES: el Auditor no tiene
                 por qué acordarse de lo que se dijo en una reunión de agosto. */
              <div className="mt-1.5 space-y-1">
                <p className="text-[12px] text-[var(--fg-muted)]">
                  Sin forzar nada, el cuadro lo decide el sistema con el empaque de abajo. Fuerza uno solo si el sistema
                  se equivoca en ESTE producto.
                </p>
                {CLASES.map((c) => (
                  <p key={c} className="text-[12px] text-[var(--fg-muted)]">
                    <span className="font-semibold text-[var(--fg)]">{textoClase(c)}: </span>
                    {explicacionClase(c)}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-[13px] font-semibold text-[var(--fg)]">Empaque de compra</p>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2">
                <p className="text-[11px] text-[var(--fg-muted)]">El ERP dice</p>
                {/* `—` y no un 1: sin el dato no hay denominador, y un 1
                    inventado afirmaría "se compra suelto". */}
                <p className="text-sm font-semibold text-[var(--fg)] tabular-nums">{empaqueDelErp ?? '—'}</p>
              </div>
              <div>
                <label htmlFor="empaque-corregido" className="text-[11px] text-[var(--fg-muted)]">
                  Tu corrección
                </label>
                <input
                  id="empaque-corregido"
                  inputMode="numeric"
                  value={empaqueTexto}
                  onChange={(e) => setEmpaqueTexto(e.target.value)}
                  disabled={guardando}
                  placeholder="sin corregir"
                  className={`${claseCampo} tabular-nums ${errorEmpaque ? 'border-[var(--danger)]' : ''}`}
                />
              </div>
            </div>
            {errorEmpaque && <p className="mt-1 text-[12px] text-[var(--danger)]">{errorEmpaque}</p>}
            {producto.empaqueCompra === null && empaqueTexto.trim() === '' && (
              <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-[var(--warning-border)] bg-[var(--warning-light)] px-3 py-2 text-[12px] text-[var(--fg)]">
                <span className="mt-[2px] shrink-0 text-[var(--warning)]" aria-hidden="true">
                  <AlertIcon size={13} />
                </span>
                <span>{ADVERTENCIA_SIN_EMPAQUE}</span>
              </p>
            )}
            <p className="mt-1.5 text-[12px] text-[var(--fg-muted)]">
              Cuántas unidades trae el empaque con el que se COMPRA. Déjalo vacío para usar el del ERP; un 1 significa
              que se compra suelto, y con eso nunca va al cuadro de paquetes.
            </p>
          </div>

          {/* QUÉ VA A PASAR SI GUARDA. Lo más útil que puede mostrar esta
              pantalla: sin esto se teclea un número a ciegas sobre el sueldo
              de alguien. */}
          {consecuencia && (
            <div
              className={`rounded-md border px-3 py-2 ${
                consecuencia.cambia
                  ? 'border-[var(--warning-border)] bg-[var(--warning-light)]'
                  : 'border-[var(--border)] bg-[var(--bg-subtle)]'
              }`}
            >
              <p className="text-[12px] font-semibold text-[var(--fg)]">
                Qué va a pasar con los faltantes de este producto
              </p>
              <p className="text-[12px] text-[var(--fg)]">
                {consecuencia.cambia ? (
                  <>
                    Hoy va a <span className="font-semibold">{textoClase(consecuencia.claseAntes)}</span>; al guardar
                    pasa a <span className="font-semibold">{textoClase(consecuencia.claseDespues)}</span>.{' '}
                    {explicacionClase(consecuencia.claseDespues)}
                  </>
                ) : (
                  <>
                    Sigue en <span className="font-semibold">{textoClase(consecuencia.claseDespues)}</span>.{' '}
                    {explicacionClase(consecuencia.claseDespues)}
                  </>
                )}
              </p>
              {consecuencia.paqueteSinEfecto && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-[var(--fg)]">
                  <span className="mt-[2px] shrink-0 text-[var(--warning)]" aria-hidden="true">
                    <AlertIcon size={13} />
                  </span>
                  <span>
                    Marcaste Paquete, pero con un empaque de{' '}
                    {consecuencia.empaqueDespues === null ? 'ninguno' : consecuencia.empaqueDespues} el sistema lo trata
                    como Unidad igual. Corrige el empaque arriba para que Paquete tenga efecto.
                  </span>
                </p>
              )}
            </div>
          )}

          <div>
            <label htmlFor="nota-excepcion" className="text-[11px] text-[var(--fg-muted)]">
              Nota (opcional)
            </label>
            <input
              id="nota-excepcion"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              disabled={guardando}
              maxLength={500}
              placeholder="Por qué la clasificas así"
              className={claseCampo}
            />
          </div>

          {!hayAlgoQueGuardar && (
            <p className="text-[12px] text-[var(--fg-muted)]">
              Corrige el empaque o fuerza un cuadro: por ahora no hay nada que guardar.
            </p>
          )}

          {/*
            QUITAR LA EXCEPCIÓN NO BORRA EL PRODUCTO, y hay que decirlo con
            esas palabras: lo que se borra es TU decisión, y el producto vuelve
            a lo que hace el sistema. Se nombra el cuadro al que vuelve y qué
            significa, para que no haya que ir a buscarlo.
          */}
          {producto.clasificacion && (
            <div className="rounded-md border border-[var(--border)] px-3 py-2">
              <p className="text-[12px] text-[var(--fg)]">
                Quitar la excepción no borra el producto: lo devuelve a lo que hace el sistema,{' '}
                <span className="font-semibold">{textoClase(producto.claseDynamics)}</span>.{' '}
                {explicacionClase(producto.claseDynamics)}
                {producto.clasificacion.empaqueCompraCorregido !== null
                  ? ` También se borra tu corrección del empaque (${producto.clasificacion.empaqueCompraCorregido}): vuelve al del ERP.`
                  : ''}
              </p>
              <button
                type="button"
                onClick={onQuitar}
                disabled={guardando}
                className="btn btn-default mt-2 w-full sm:w-auto"
              >
                Quitar la excepción
              </button>
            </div>
          )}
        </div>
      )}

      {/* Dentro de un formulario el error va acá y no en un toast: el mensaje
          del servidor dice qué regla se topó y tiene que seguir a la vista. */}
      {error != null && (
        <ErrorNotice title="No se pudo guardar la clasificación" error={error} onDismiss={onDescartarError} />
      )}
    </SlidePanel>
  )
}

/**
 * Las tres vías. Son `<button>` reales y no celdas inertes porque acá SÍ hay
 * una elección, y es la más cara de esta pantalla: mueve el faltante de un
 * cuadro a otro de la liquidación.
 *
 * `aria-pressed` y no un `role="radio"`: la elección se puede DESHACER (el
 * enlace de abajo la quita), así que son tres interruptores, no un radio que
 * una vez puesto no se puede sacar.
 */
function SelectorClase({
  valor,
  onElegir,
  disabled,
}: {
  valor: ClaseItem | null
  onElegir: (clase: ClaseItem) => void
  disabled: boolean
}) {
  return (
    <div role="group" aria-label="Forzar el cuadro" className="mt-1.5 inline-flex w-full overflow-hidden rounded-md border border-[var(--border)] divide-x divide-[var(--border)]">
      {CLASES.map((clase) => {
        const activo = valor === clase
        return (
          <button
            key={clase}
            type="button"
            onClick={() => onElegir(clase)}
            disabled={disabled}
            aria-pressed={activo}
            title={explicacionClase(clase)}
            className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              activo
                ? 'bg-[var(--primary)] text-white'
                : 'bg-white text-[var(--fg)] hover:bg-[var(--bg-subtle)]'
            }`}
          >
            {textoClase(clase)}
          </button>
        )
      })}
    </div>
  )
}
