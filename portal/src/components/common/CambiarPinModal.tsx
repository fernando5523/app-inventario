import { useState } from 'react'
import toast from 'react-hot-toast'
import { ResponsiveModalShell } from './ResponsiveModalShell'
import { ConfirmDialog } from './ConfirmDialog'
import { ErrorNotice } from './ErrorNotice'
import { CampoPin, LARGO_PIN } from './CampoPin'
import { sesionApi } from '../../services/api'

/**
 * Cambiar el PIN propio. Es el `ChangePasswordModal` de app_pdv, pero el dato
 * no es una contraseña: son SEIS DÍGITOS, ni uno más ni uno menos (el servidor
 * valida `/^\d{6}$/` y contesta 400 con cualquier otra cosa).
 *
 * Por eso no se porta el "mínimo 6 caracteres" de app_pdv ni el ojito de
 * mostrar/ocultar texto: con un largo fijo y solo dígitos, el campo se valida
 * contándolos, y el enmascarado lo da `CampoPin`.
 *
 * El error va con `ErrorNotice` y no con `notifyError`: esto es un formulario,
 * y la regla de app_pdv es que el error de un formulario se queda a la vista
 * hasta que se corrija, no que pase como un aviso que desaparece.
 */
interface CambiarPinModalProps {
  onClose: () => void
}

export function CambiarPinModal({ onClose }: CambiarPinModalProps) {
  const [pinActual, setPinActual] = useState('')
  const [pinNuevo, setPinNuevo] = useState('')
  const [pinRepetido, setPinRepetido] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [sucio, setSucio] = useState(false)
  const [confirmarSalida, setConfirmarSalida] = useState(false)

  const completo =
    pinActual.length === LARGO_PIN && pinNuevo.length === LARGO_PIN && pinRepetido.length === LARGO_PIN

  const cerrar = () => (sucio ? setConfirmarSalida(true) : onClose())

  const enviar = async () => {
    setError(null)

    if (pinNuevo !== pinRepetido) {
      setError('Los dos PIN nuevos no coinciden.')
      return
    }
    if (pinNuevo === pinActual) {
      setError('El PIN nuevo tiene que ser distinto del actual.')
      return
    }

    setGuardando(true)
    try {
      await sesionApi.cambiarPin(pinActual, pinNuevo)
      toast.success('PIN actualizado')
      setSucio(false)
      onClose()
    } catch (e) {
      setError(e)
    } finally {
      setGuardando(false)
    }
  }

  const pie = (
    <>
      <button type="button" onClick={cerrar} className="btn btn-default text-[13px]" disabled={guardando}>
        Cancelar
      </button>
      <button
        type="button"
        onClick={() => void enviar()}
        className="btn btn-primary text-[13px]"
        disabled={guardando || !completo}
      >
        {guardando ? 'Guardando...' : 'Cambiar PIN'}
      </button>
    </>
  )

  return (
    <ResponsiveModalShell
      isOpen
      variant="dialog"
      onClose={cerrar}
      isDirty={sucio}
      title="Cambiar mi PIN"
      size="sm"
      footer={pie}
    >
      <div className="space-y-4">
        <p className="text-[12px] text-[var(--fg-muted)]">
          Son seis dígitos. Es el único camino por el que tu PIN pasa a ser conocido solo por ti: el
          reseteo que hace un administrador, por definición, lo deja en manos de dos personas.
        </p>

        <CampoPin
          etiqueta="PIN actual"
          value={pinActual}
          onChange={(v) => {
            setPinActual(v)
            setSucio(true)
          }}
          autoFocus
        />
        <CampoPin
          etiqueta="PIN nuevo"
          value={pinNuevo}
          onChange={(v) => {
            setPinNuevo(v)
            setSucio(true)
          }}
        />
        <CampoPin
          etiqueta="Repetir el PIN nuevo"
          value={pinRepetido}
          onChange={(v) => {
            setPinRepetido(v)
            setSucio(true)
          }}
        />
      </div>

      {error !== null && (
        <ErrorNotice title="No se pudo cambiar el PIN" error={error} onDismiss={() => setError(null)} />
      )}

      <ConfirmDialog
        isOpen={confirmarSalida}
        title="Cambios sin guardar"
        message="Escribiste un PIN y no lo guardaste. Si cierras ahora se pierde. ¿Continuar?"
        confirmText="Descartar"
        cancelText="Seguir editando"
        isDestructive
        onConfirm={() => {
          setConfirmarSalida(false)
          onClose()
        }}
        onCancel={() => setConfirmarSalida(false)}
      />
    </ResponsiveModalShell>
  )
}
