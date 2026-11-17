import { useState } from 'react'
import toast from 'react-hot-toast'
import { InfoIcon, LockIcon } from '@primer/octicons-react'
import { CampoPin } from '../common/CampoPin'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { ErrorNotice } from '../common/ErrorNotice'
import { FormField } from '../common/FormField'
import { SearchableSelect } from '../common/SearchableSelect'
import { SlidePanel } from '../common/SlidePanel'
import type { Rol } from '../../tipos'
import { usuariosApi } from './usuariosApi'
import {
  FORMULARIO_VACIO,
  LARGO_MAXIMO_DNI,
  TEXTO_PIN_ILEGIBLE,
  TEXTO_PIN_LO_CONOCE,
  altaConDatos,
  cuerpoDeAlta,
  cuerpoDeEdicion,
  datosDeCuenta,
  edicionConCambios,
  erroresDelFormulario,
  erroresDelServidor,
  opcionesDeRol,
  requiereElegirSucursal,
  soloDigitos,
  textoDeAlcance,
  type CampoDelFormulario,
  type DatosDelFormulario,
  type ErroresDelFormulario,
} from './usuariosReglas'
import type { Actor, SucursalElegible, UsuarioDto } from './usuariosTipos'

/**
 * ---------------------------------------------------------------------------
 * EL FORMULARIO DE UNA CUENTA: ALTA Y EDICIÓN
 * ---------------------------------------------------------------------------
 * Un solo componente para las dos, como el teléfono resuelve "Nueva cuenta" y
 * "Editar cuenta" con los mismos campos. La única diferencia es el PIN: se
 * define al crear y NUNCA se edita acá; para cambiarlo está "Resetear PIN",
 * que es otra acción con su propio registro en el servidor.
 *
 * Las tres decisiones que sostienen la regla del cliente:
 *
 * 1. EL ROL SE ELIGE DE UNA LISTA QUE YA VIENE RECORTADA. Las cuatro opciones
 *    se ven; las que quien está usando la pantalla no puede asignar aparecen
 *    APAGADAS y con el motivo al lado (`opcionesDeRol`). Esconderlas haría
 *    que el auditor no sepa si falta una opción o si es una regla.
 * 2. LA SUCURSAL DEL AUDITOR NO SE ELIGE: es la suya. Se muestra como un dato
 *    inerte, no como un campo deshabilitado que sugiera que algún día se va a
 *    poder cambiar. El cuerpo la saca de la sesión (`sucursalDelCuerpo`).
 * 3. EL SERVIDOR TIENE LA ÚLTIMA PALABRA. Si igual rechaza (403, 409, 400), su
 *    texto se muestra tal cual en `ErrorNotice`, y si el 400 trae el detalle
 *    por campo, va debajo del campo que lo causó.
 *
 * EL BOTÓN DE GUARDAR NO SE APAGA POR UN CAMPO INCOMPLETO. Un botón gris sin
 * explicación es justo lo que la regla del usuario prohíbe ("decir por qué
 * cuando un control no se puede usar"): se deja apretar y cada campo dice qué
 * le falta. Se apaga solo mientras se guarda.
 *
 * `SlidePanel` y no un diálogo centrado: son cinco o seis campos con su ayuda,
 * y el panel lateral no pelea con el alto de la ventana. Con `isDirty`, un
 * clic al aire o un Escape no pueden descartar lo tipeado; la ✕ y "Cancelar"
 * preguntan antes (regla 0 de los formularios del portal, la misma de
 * `CambiarPinModal`).
 */

interface FormularioCuentaProps {
  actor: Actor
  /** `null` = alta. Con una cuenta, edición de esa cuenta. */
  cuenta: UsuarioDto | null
  /** La tienda de la sesión, para mostrarle al auditor dónde se crea la cuenta. */
  sucursalDeSesion: SucursalElegible | null
  /** Solo el administrador las usa: el auditor no elige sucursal. */
  sucursales: SucursalElegible[]
  onGuardada: (cuenta: UsuarioDto) => void
  onCerrar: () => void
}

/** La clase de los campos de texto: la misma de `CampoPin`, para que el formulario se lea parejo. */
const CLASE_CAMPO = 'gh-input'

/** Un dato que se ve y no se toca (la sucursal del auditor). Mismo trato que el stock en `PanelCorreccion`. */
function DatoInerte({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2 text-[13px] text-[var(--fg)] flex items-center gap-2">
      <span className="text-[var(--fg-muted)]" aria-hidden="true">
        <LockIcon size={13} />
      </span>
      {children}
    </div>
  )
}

export function FormularioCuenta({
  actor,
  cuenta,
  sucursalDeSesion,
  sucursales,
  onGuardada,
  onCerrar,
}: FormularioCuentaProps) {
  const modo = cuenta === null ? 'alta' : 'edicion'
  const [datos, setDatos] = useState<DatosDelFormulario>(() =>
    cuenta === null ? FORMULARIO_VACIO : datosDeCuenta(cuenta),
  )
  const [intentoGuardar, setIntentoGuardar] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [erroresServidor, setErroresServidor] = useState<ErroresDelFormulario>({})
  const [confirmarSalida, setConfirmarSalida] = useState(false)

  const errores = erroresDelFormulario(actor, datos, modo)
  const sucio = cuenta === null ? altaConDatos(datos) : edicionConCambios(cuenta, datos)

  /**
   * El error de un campo: el del servidor si lo dio (es el que de verdad
   * rechazó), si no el propio — y el propio solo después del primer intento,
   * para no recibir a nadie con el formulario en rojo.
   */
  const errorDe = (campo: CampoDelFormulario): string | undefined =>
    erroresServidor[campo] ?? (intentoGuardar ? errores[campo] : undefined)

  /** Cambiar un campo borra el rechazo del servidor sobre ESE campo: ya no habla del valor que hay. */
  const cambiar = (campo: CampoDelFormulario, parche: Partial<DatosDelFormulario>) => {
    setDatos((actual) => ({ ...actual, ...parche }))
    if (erroresServidor[campo] !== undefined) {
      setErroresServidor((actual) => {
        const resto = { ...actual }
        delete resto[campo]
        return resto
      })
    }
  }

  const cerrar = () => (sucio && !guardando ? setConfirmarSalida(true) : onCerrar())

  const guardar = async () => {
    setIntentoGuardar(true)
    if (Object.keys(errores).length > 0) return
    setError(null)
    setErroresServidor({})
    setGuardando(true)
    try {
      const guardada =
        cuenta === null
          ? await usuariosApi.crear(cuerpoDeAlta(actor, datos))
          : await usuariosApi.editar(cuenta.id, cuerpoDeEdicion(actor, datos))
      // Los textos del teléfono: "Cuenta editada / Se actualizaron los datos
      // de ...". El alta en el teléfono no avisaba porque la lista se ve
      // debajo del formulario; acá el panel la tapa, así que se dice.
      toast.success(
        cuenta === null
          ? `Cuenta creada para ${guardada.nombre}.`
          : `Cuenta editada. Se actualizaron los datos de ${guardada.nombre}.`,
      )
      onGuardada(guardada)
    } catch (e) {
      setError(e)
      setErroresServidor(erroresDelServidor(e))
    } finally {
      setGuardando(false)
    }
  }

  const opcionesSucursal = sucursales.map((s) => ({ value: String(s.id), label: s.nombre }))
  const eligeSucursal = requiereElegirSucursal(actor.rol, datos.rol)

  const pie = (
    <>
      <button type="button" onClick={cerrar} disabled={guardando} className="btn btn-default text-[13px]">
        Cancelar
      </button>
      <button type="button" onClick={() => void guardar()} disabled={guardando} className="btn btn-primary text-[13px]">
        {guardando ? 'Guardando...' : cuenta === null ? 'Crear cuenta' : 'Guardar cambios'}
      </button>
    </>
  )

  return (
    <SlidePanel
      isOpen
      onClose={cerrar}
      title={cuenta === null ? 'Nueva cuenta' : 'Editar cuenta'}
      isDirty={sucio}
      footer={pie}
    >
      <div>
        <FormField label="Nombre completo" required error={errorDe('nombre')}>
          <input
            type="text"
            aria-label="Nombre completo"
            className={CLASE_CAMPO}
            value={datos.nombre}
            // Sin un nombre de ejemplo: el del teléfono podría ser el de una
            // persona real, y un placeholder lo repetiría en cada pantalla.
            placeholder="Nombre y apellidos"
            autoComplete="off"
            autoFocus
            disabled={guardando}
            onChange={(e) => cambiar('nombre', { nombre: e.target.value })}
          />
        </FormField>

        <FormField label="DNI" required error={errorDe('dni')} helperText="Entre 4 y 8 dígitos.">
          <input
            type="text"
            inputMode="numeric"
            aria-label="DNI"
            className={`${CLASE_CAMPO} tabular-nums`}
            value={datos.dni}
            autoComplete="off"
            maxLength={LARGO_MAXIMO_DNI}
            disabled={guardando}
            // Se descarta todo lo que no sea dígito al tipear (pegar un DNI con
            // puntos o espacios entra igual), como hace la edición del teléfono.
            onChange={(e) => cambiar('dni', { dni: soloDigitos(e.target.value, LARGO_MAXIMO_DNI) })}
          />
        </FormField>

        <FormField label="Rol" required error={errorDe('rol')} helperText={textoDeAlcance(actor.rol)}>
          <SearchableSelect
            options={opcionesDeRol(actor.rol)}
            value={datos.rol}
            placeholder="Elige un rol"
            ariaLabel="Rol de la cuenta"
            // Son cuatro opciones: una caja de búsqueda no le ahorra nada a nadie.
            searchThreshold={10}
            disabled={guardando}
            error={errorDe('rol') !== undefined}
            onChange={(valor) => {
              const rol = valor as Rol
              // Un administrador no pertenece a ninguna sucursal: si se elige
              // ese rol, la que estaba elegida se suelta (como el teléfono).
              cambiar('rol', rol === 'administrador' ? { rol, sucursalId: null } : { rol })
            }}
          />
        </FormField>

        {actor.rol === 'auditor' ? (
          <FormField
            label="Sucursal"
            error={errorDe('sucursal')}
            helperText="Es la tuya: un auditor solo crea y gestiona cuentas de su propia sucursal."
          >
            <DatoInerte>{sucursalDeSesion?.nombre ?? 'Sin sucursal en la sesión'}</DatoInerte>
          </FormField>
        ) : eligeSucursal ? (
          <FormField label="Sucursal" required error={errorDe('sucursal')}>
            <SearchableSelect
              options={opcionesSucursal}
              value={datos.sucursalId === null ? '' : String(datos.sucursalId)}
              placeholder="Elige una sucursal"
              ariaLabel="Sucursal de la cuenta"
              disabled={guardando}
              error={errorDe('sucursal') !== undefined}
              onChange={(valor) => cambiar('sucursal', { sucursalId: valor === '' ? null : Number(valor) })}
            />
          </FormField>
        ) : datos.rol === 'administrador' ? (
          <FormField label="Sucursal">
            <DatoInerte>Un administrador no pertenece a ninguna sucursal: gestiona todas.</DatoInerte>
          </FormField>
        ) : null}

        {modo === 'alta' && (
          <div className="space-y-3">
            <CampoPin
              etiqueta="PIN inicial"
              value={datos.pin}
              disabled={guardando}
              onChange={(pin) => cambiar('pin', { pin })}
            />
            {errorDe('pin') && <p className="-mt-2 text-xs text-[var(--danger)]">{errorDe('pin')}</p>}
            <CampoPin
              etiqueta="Repetir el PIN inicial"
              value={datos.pinRepetido}
              disabled={guardando}
              onChange={(pinRepetido) => cambiar('pinRepetido', { pinRepetido })}
              onSubmit={() => void guardar()}
            />
            {errorDe('pinRepetido') && <p className="-mt-2 text-xs text-[var(--danger)]">{errorDe('pinRepetido')}</p>}
            <p className="flex items-start gap-1.5 text-[12px] text-[var(--fg-muted)]">
              <span className="mt-[2px] shrink-0" aria-hidden="true">
                <InfoIcon size={13} />
              </span>
              <span>
                {TEXTO_PIN_ILEGIBLE} {TEXTO_PIN_LO_CONOCE}
              </span>
            </p>
          </div>
        )}
      </div>

      {/* Dentro de un formulario el error va en `ErrorNotice`, no en un toast:
          el texto del servidor dice qué regla se topó (un rol que no se puede
          asignar, un DNI repetido en la sucursal) y tiene que seguir a la
          vista mientras se corrige. */}
      {error !== null && (
        <ErrorNotice
          title={cuenta === null ? 'No se pudo crear la cuenta' : 'No se pudo editar la cuenta'}
          error={error}
          onDismiss={() => setError(null)}
        />
      )}

      <ConfirmDialog
        isOpen={confirmarSalida}
        title="Cambios sin guardar"
        message="Hay datos que no guardaste. Si cierras ahora se pierden. ¿Continuar?"
        confirmText="Descartar"
        cancelText="Seguir editando"
        isDestructive
        onConfirm={() => {
          setConfirmarSalida(false)
          onCerrar()
        }}
        onCancel={() => setConfirmarSalida(false)}
      />
    </SlidePanel>
  )
}
