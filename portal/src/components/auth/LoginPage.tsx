import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SearchableSelect, type SearchableSelectOption } from '../common/SearchableSelect'
import { ErrorNotice } from '../common/ErrorNotice'
import { CampoPin, LARGO_PIN } from '../common/CampoPin'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { sesionApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import type { Colaborador, Sucursal } from '../../tipos'

/**
 * EL INGRESO, EN TRES PASOS: tienda -> persona -> PIN.
 *
 * Es el mismo flujo que la app del teléfono (`mobile/app/index.tsx`), portado a
 * los controles de app_pdv, no el mismo código. Que sean tres pasos y no un
 * usuario con contraseña es una decisión del cliente, y la razón se ve en la
 * tienda: el contador no tiene usuario propio que recuerde, se busca en la
 * lista de su tienda y marca seis dígitos.
 *
 * LO QUE SE CONSERVA DEL TELÉFONO:
 *
 * - El ORDEN. La persona no se puede elegir antes que la tienda, porque la
 *   lista de personas ES la de esa tienda (`GET /sesion/sucursales/:id/
 *   colaboradores`). El select de persona queda deshabilitado hasta entonces y
 *   lo dice.
 * - El MODO ADMINISTRADOR. El administrador no cuelga de ninguna tienda
 *   (`sesion.sucursal` es null para ese rol), así que no puede salir de la
 *   lista de una tienda: tiene su propio endpoint. Meterlo en el combo de una
 *   tienda cualquiera lo haría aparecer en el padrón de las once a la vez.
 * - El RESETEO del PIN al cambiar de persona. Dejar tecleado el PIN de alguien
 *   y cambiar de nombre es la forma de gastarle intentos a otro: el servidor
 *   limita a 8 por colaborador cada 15 minutos.
 *
 * LO QUE NO SE PORTA: el teclado numérico en pantalla. Ver `CampoPin`.
 *
 * El rol que vale es el del PADRÓN, no el del grupo por el que se eligió: un
 * auditor puede elegirse dentro de su tienda (decisión del cliente, 2026-09-22)
 * y el servidor igual emite la sesión con rol `auditor`.
 */

const textoColaboradores = (s: Sucursal): string =>
  `${s.colaboradores} ${s.colaboradores === 1 ? 'colaborador' : 'colaboradores'}`

export function LoginPage() {
  const navigate = useNavigate()
  const ingresar = useAuthStore((s) => s.ingresar)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  const [modoAdmin, setModoAdmin] = useState(false)
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [cargandoSucursales, setCargandoSucursales] = useState(true)
  const [personas, setPersonas] = useState<Colaborador[]>([])
  const [cargandoPersonas, setCargandoPersonas] = useState(false)

  const [sucursalId, setSucursalId] = useState('')
  const [personaId, setPersonaId] = useState('')
  const [pin, setPin] = useState('')
  const [ingresando, setIngresando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  // Ya hay sesión (se recargó la página con el token guardado): no se muestra
  // el formulario, se entra.
  useEffect(() => {
    if (isAuthenticated) navigate('/auditoria', { replace: true })
  }, [isAuthenticated, navigate])

  useEffect(() => {
    let vigente = true
    setCargandoSucursales(true)
    sesionApi
      .sucursales()
      .then((lista) => {
        if (vigente) setSucursales(lista)
      })
      .catch((e) => {
        if (vigente) setError(e)
      })
      .finally(() => {
        if (vigente) setCargandoSucursales(false)
      })
    return () => {
      vigente = false
    }
  }, [])

  /**
   * Las personas se piden cuando ya hay por quién preguntar, no al abrir la
   * pantalla: once tiendas son once llamadas que nadie pidió. Los
   * administradores, igual, recién al prender el modo.
   */
  useEffect(() => {
    if (!modoAdmin && sucursalId === '') {
      setPersonas([])
      return
    }
    let vigente = true
    setCargandoPersonas(true)
    const pedido = modoAdmin ? sesionApi.administradores() : sesionApi.colaboradores(Number(sucursalId))
    pedido
      .then((lista) => {
        if (vigente) setPersonas(lista)
      })
      .catch((e) => {
        if (vigente) setError(e)
      })
      .finally(() => {
        if (vigente) setCargandoPersonas(false)
      })
    return () => {
      vigente = false
    }
  }, [modoAdmin, sucursalId])

  const opcionesSucursal = useMemo<SearchableSelectOption[]>(
    () => sucursales.map((s) => ({ value: String(s.id), label: s.nombre, sublabel: textoColaboradores(s) })),
    [sucursales],
  )

  const opcionesPersona = useMemo<SearchableSelectOption[]>(
    // Del DNI solo los últimos dígitos, igual que en el teléfono: alcanza para
    // distinguir dos homónimos sin publicar el documento de nadie en una
    // pantalla que se mira entre varios.
    () => personas.map((p) => ({ value: String(p.id), label: p.nombre, sublabel: `DNI ••••${p.dni} · ${p.rol}` })),
    [personas],
  )

  const puedeIngresar =
    (modoAdmin || sucursalId !== '') && personaId !== '' && pin.length === LARGO_PIN && !ingresando

  const cambiarPersona = (valor: string) => {
    setPersonaId(valor)
    // El PIN tecleado NO se arrastra a otra persona: ver el comentario de
    // arriba sobre el límite de intentos por colaborador.
    setPin('')
    setError(null)
  }

  const cambiarSucursal = (valor: string) => {
    setSucursalId(valor)
    setPersonaId('')
    setPin('')
    setError(null)
  }

  const entrar = async () => {
    if (!puedeIngresar) return
    setError(null)
    setIngresando(true)
    try {
      await ingresar(Number(personaId), pin)
      navigate('/auditoria', { replace: true })
    } catch (e) {
      // El PIN se limpia para que el próximo intento sea deliberado, pero la
      // persona elegida se queda: lo que estuvo mal fue la clave, no el nombre.
      setPin('')
      setError(e)
    } finally {
      setIngresando(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-subtle)] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-full bg-[var(--primary)] flex items-center justify-center mb-3">
            <span className="text-white text-base font-bold leading-none">MT</span>
          </div>
          <h1 className="text-lg font-semibold text-[var(--fg)]">Portal del Auditor</h1>
          <p className="text-[13px] text-[var(--fg-muted)]">Market Trujillo · Inventario</p>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4 shadow-sm">
          {cargandoSucursales ? (
            <div className="py-6 flex justify-center">
              <LoadingSpinner text="Cargando tiendas..." />
            </div>
          ) : (
            <>
              {!modoAdmin && (
                <div>
                  <label className="block text-[13px] font-medium text-[var(--fg)] mb-1.5">Tienda</label>
                  <SearchableSelect
                    options={opcionesSucursal}
                    value={sucursalId}
                    onChange={cambiarSucursal}
                    placeholder="Selecciona una tienda"
                    searchPlaceholder="Buscar tienda"
                    emptyMessage="No hay tiendas activas"
                    ariaLabel="Tienda"
                    className="w-full"
                  />
                </div>
              )}

              <div>
                <label className="block text-[13px] font-medium text-[var(--fg)] mb-1.5">
                  {modoAdmin ? 'Administrador' : 'Persona'}
                </label>
                <SearchableSelect
                  options={opcionesPersona}
                  value={personaId}
                  onChange={cambiarPersona}
                  disabled={(!modoAdmin && sucursalId === '') || cargandoPersonas}
                  placeholder={
                    cargandoPersonas
                      ? 'Cargando...'
                      : !modoAdmin && sucursalId === ''
                        ? 'Elige primero la tienda'
                        : 'Selecciona tu nombre'
                  }
                  searchPlaceholder="Buscar por nombre"
                  emptyMessage={modoAdmin ? 'No hay administradores' : 'Esta tienda no tiene personas para elegir'}
                  ariaLabel={modoAdmin ? 'Administrador' : 'Persona'}
                  className="w-full"
                />
              </div>

              <CampoPin
                etiqueta="PIN"
                value={pin}
                onChange={setPin}
                disabled={personaId === ''}
                onSubmit={() => void entrar()}
              />

              <button
                type="button"
                onClick={() => void entrar()}
                disabled={!puedeIngresar}
                className="btn btn-primary w-full !h-9 text-[13px]"
              >
                {ingresando ? 'Entrando...' : 'Entrar'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setModoAdmin((v) => !v)
                  setSucursalId('')
                  setPersonaId('')
                  setPin('')
                  setError(null)
                }}
                className="w-full text-center text-[12px] text-[var(--primary)] hover:underline"
              >
                {modoAdmin ? 'Volver a entrar por una tienda' : 'Entrar como administrador'}
              </button>
            </>
          )}
        </div>

        {error !== null && (
          <ErrorNotice title="No se pudo entrar" error={error} onDismiss={() => setError(null)} />
        )}
      </div>
    </div>
  )
}
