import { useState } from 'react'
import toast from 'react-hot-toast'
import { InfoIcon } from '@primer/octicons-react'
import { CampoPin, LARGO_PIN } from '../common/CampoPin'
import { ErrorNotice } from '../common/ErrorNotice'
import { Modal } from '../common/Modal'
import { usuariosApi } from './usuariosApi'
import { TEXTO_PIN_ILEGIBLE, TEXTO_PIN_LO_CONOCE, errorDePin } from './usuariosReglas'
import type { UsuarioDto } from './usuariosTipos'

/**
 * ---------------------------------------------------------------------------
 * PONERLE UN PIN NUEVO A UNA CUENTA
 * ---------------------------------------------------------------------------
 * NO ES "VER EL PIN", y la pantalla lo dice antes de que alguien lo pregunte:
 * el PIN se guarda con argon2, que no se puede revertir, así que nadie puede
 * leerlo —ni el auditor ni el administrador— y lo único que existe es
 * REEMPLAZARLO. Es la pregunta que la gente hace de verdad ("¿me puedes decir
 * mi PIN?"), y contestarla acá evita que alguien la haga por teléfono.
 *
 * Y LA SEGUNDA MITAD, que importa igual: quien pone el PIN lo CONOCE. Un PIN
 * que saben dos personas no identifica a ninguna, y en esta app el PIN es la
 * firma de quien cuenta. Por eso el texto manda a que la persona lo cambie por
 * uno propio desde «Mi cuenta».
 *
 * Se repite dos veces por lo mismo que en el alta: son seis dígitos
 * enmascarados, y un dedo corrido deja a alguien afuera de su propia cuenta.
 */

interface DialogoResetearPinProps {
  cuenta: UsuarioDto
  onListo: () => void
  onCerrar: () => void
}

export function DialogoResetearPin({ cuenta, onListo, onCerrar }: DialogoResetearPinProps) {
  const [pin, setPin] = useState('')
  const [repetido, setRepetido] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const errorDeForma = pin === '' ? null : errorDePin(pin)
  const noCoinciden = repetido !== '' && repetido !== pin ? 'Los dos PIN no son iguales.' : null
  const puedeGuardar =
    pin.length === LARGO_PIN && repetido === pin && errorDeForma === null && !guardando

  async function guardar() {
    if (!puedeGuardar) return
    setGuardando(true)
    setError(null)
    try {
      await usuariosApi.resetearPin(cuenta.id, pin)
      // El toast nombra la cuenta y lo que hay que hacer después: el reseteo
      // no termina cuando el servidor contesta, termina cuando la persona
      // puede entrar.
      toast.success(`Listo. Dale el PIN nuevo a ${cuenta.nombre} y pídele que lo cambie por uno propio.`)
      onListo()
    } catch (e) {
      setError(e)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal onClose={onCerrar} size="sm" isDirty={pin !== '' || repetido !== ''} ariaLabel="Poner un PIN nuevo">
      <div className="p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--fg)]">Poner un PIN nuevo</h2>
          <p className="text-[12px] text-[var(--fg-muted)]">
            {cuenta.nombre} · {cuenta.dni}
          </p>
        </div>

        <p className="flex items-start gap-1.5 rounded-md bg-[var(--bg-subtle)] px-3 py-2 text-[12px] text-[var(--fg)]">
          <span className="mt-[2px] shrink-0 text-[var(--fg-muted)]" aria-hidden="true">
            <InfoIcon size={13} />
          </span>
          <span>
            {TEXTO_PIN_ILEGIBLE} {TEXTO_PIN_LO_CONOCE}
          </span>
        </p>

        <CampoPin etiqueta="PIN nuevo" value={pin} onChange={setPin} autoFocus disabled={guardando} />
        {errorDeForma && <p className="text-[12px] text-[var(--danger)]">{errorDeForma}</p>}

        <CampoPin
          etiqueta="Repite el PIN nuevo"
          value={repetido}
          onChange={setRepetido}
          disabled={guardando}
          onSubmit={() => void guardar()}
        />
        {noCoinciden && <p className="text-[12px] text-[var(--danger)]">{noCoinciden}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" className="btn btn-default" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={!puedeGuardar}>
            {guardando ? 'Guardando...' : 'Poner el PIN nuevo'}
          </button>
        </div>
      </div>

      {error != null && (
        <ErrorNotice title="No se pudo poner el PIN nuevo" error={error} onDismiss={() => setError(null)} />
      )}
    </Modal>
  )
}
