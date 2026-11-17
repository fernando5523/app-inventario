import { useCallback, useEffect, useState } from 'react'
import { CheckIcon, LockIcon, ShieldCheckIcon, UploadIcon, VerifiedIcon } from '@primer/octicons-react'
import { HiRefresh } from 'react-icons/hi'
import { ActionGroup } from '../common/ActionGroup'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { EmptyState } from '../common/EmptyState'
import { ErrorNotice } from '../common/ErrorNotice'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { SearchableSelect } from '../common/SearchableSelect'
import { StatusBadge } from '../common/StatusBadge'
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus'
import { sesionApi } from '../../services/api'
import { formatoMiles, pluralizar } from '../../utils/formato'
import { useAuthStore } from '../../store/authStore'
import type { Colaborador, Sucursal } from '../../tipos'
import { lacradoApi } from './lacradoApi'
import type { EstadoLacrado, VerificacionDelSello } from './lacradoTipos'
import {
  avisoDeFirmas,
  cartelDelCierre,
  fechaHora,
  firmasRequeridas,
  inventarioALacrar,
  sePuedeLacrar,
  textoDelLacrado,
  type TonoCartel,
} from './lacradoDominio'

/**
 * ===========================================================================
 * APROBACIÓN Y LACRADO: la firma y el cierre definitivo del inventario
 * ===========================================================================
 * Port de `mobile/app/auditor/lacrado.web.tsx`. Las decisiones de negocio NO
 * se reinventaron: están ahí, discutidas con el cliente, y acá se respetan una
 * por una. Las reglas y los textos viven en `lacradoDominio.ts` (con tests);
 * este archivo solo los dibuja.
 *
 * ---------------------------------------------------------------------------
 * ES EL PUNTO DE NO RETORNO MÁS FUERTE DEL SISTEMA
 * ---------------------------------------------------------------------------
 * Una vez lacrado, el período queda sellado: no hay forma de deshacerlo ni de
 * editar los conteos. De ahí salen tres decisiones de layout que se ven raras
 * si no se sabe por qué están:
 *
 * 1. LO QUE HAY QUE LEER ESTÁ AL LADO DEL BOTÓN, no arriba. Quién firmó, qué
 *    falta y qué queda congelado se ven AL MISMO TIEMPO que el botón rojo. En
 *    el teléfono son cuatro tarjetas y se baja con el dedo; en un monitor,
 *    bajar para firmar es exactamente cómo se firma sin haber leído.
 * 2. LA CITA DE LA REUNIÓN VIAJA DENTRO DE LA TARJETA DEL SELLO, pegada al
 *    botón, por lo mismo.
 * 3. EL BOTÓN DE LACRAR QUEDA APAGADO Y A LA VISTA cuando no se puede, nunca
 *    escondido: un botón que desaparece deja a la persona buscando algo que
 *    vio ayer.
 *
 * ---------------------------------------------------------------------------
 * LOS ERRORES NO SE PUEDEN PERDER, Y POR ESO NO VAN EN UN TOAST
 * ---------------------------------------------------------------------------
 * Los tres fallos de esta pantalla (aprobar, lacrar, marcar el registro) traen
 * el motivo escrito por el servidor -- "Ya aprobaste el cierre de este
 * inventario. La segunda aprobacion la tiene que dar OTRA persona", "quedan
 * hojas sin sincronizar" -- y ese texto hay que poder leerlo dos veces
 * mientras se decide qué hacer. Va en `ErrorNotice`, que flota y se queda
 * hasta que alguien lo cierra, y no en `notifyError`, que se va solo. Es el
 * mismo criterio que `CicloConteos` ya aplica a las decisiones del Auditor.
 */

/** Cómo se ve el punto del cierre en el badge de la casa. */
const VARIANTE_BADGE: Record<TonoCartel, 'success' | 'warning' | 'default'> = {
  ok: 'success',
  atencion: 'warning',
  neutro: 'default',
}

type AccionEnVuelo = 'aprobar' | 'lacrar' | 'registro' | 'verificar' | null

/** Lo que falló, con el título en las palabras de la pantalla. */
interface FalloDeAccion {
  titulo: string
  error: unknown
}

export function AprobacionYLacrado() {
  const { colaborador, sucursal: sucursalDeSesion } = useAuthStore()

  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [sucursalElegida, setSucursalElegida] = useState<number | null>(null)
  const [auditores, setAuditores] = useState<Colaborador[]>([])

  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inventarioId, setInventarioId] = useState<number | null>(null)
  const [periodo, setPeriodo] = useState<string | null>(null)
  const [items, setItems] = useState<number | null>(null)
  const [estado, setEstado] = useState<EstadoLacrado | null>(null)

  const [accion, setAccion] = useState<AccionEnVuelo>(null)
  const [fallo, setFallo] = useState<FalloDeAccion | null>(null)
  const [confirmarLacrado, setConfirmarLacrado] = useState(false)
  const [verificacion, setVerificacion] = useState<VerificacionDelSello | null>(null)

  /**
   * El auditor audita TODA la cadena, así que elige la tienda. Arranca en la de
   * su ficha solo como punto de partida -- `sucursalEnFoco` del teléfono hace
   * lo mismo. No hay store compartido en el portal todavía, así que la elección
   * es local a esta pantalla.
   */
  const sucursalId = sucursalElegida ?? sucursalDeSesion?.id ?? null
  const nombreSucursal = sucursales.find((s) => s.id === sucursalId)?.nombre ?? sucursalDeSesion?.nombre ?? null

  useEffect(() => {
    sesionApi
      .sucursales()
      .then(setSucursales)
      .catch(() => {
        // El padrón solo resuelve el NOMBRE de la tienda para el encabezado y
        // la confirmación. Sin él la pantalla funciona: el id ya está.
      })
  }, [])

  const cargar = useCallback(async () => {
    if (sucursalId === null) {
      setCargando(false)
      return
    }
    setError(null)
    try {
      const [listado, sinTienda] = await Promise.all([
        lacradoApi.historial(sucursalId),
        /**
         * LOS FIRMANTES SON LOS AUDITORES DEL SISTEMA, no los de la tienda:
         * contar "los de esta sucursal" da 0 desde que el auditor dejó de
         * pertenecer a una. Vienen del grupo "administradores" del login,
         * filtrado a rol auditor.
         */
        sesionApi.administradores(),
      ])

      setAuditores(sinTienda.filter((c) => c.rol === 'auditor'))

      const pendiente = inventarioALacrar(listado.inventarios)
      if (pendiente === null) {
        setInventarioId(null)
        setPeriodo(null)
        setItems(null)
        setEstado(null)
        return
      }
      setInventarioId(pendiente.id)
      setPeriodo(pendiente.periodo)
      setItems(pendiente.snapshotItems)
      setEstado(await lacradoApi.estado(pendiente.id))
    } catch (e) {
      // Sin esto, un fallo sin red deja el spinner girando para siempre.
      setError(e instanceof Error ? e.message : 'No se pudo cargar el estado del lacrado.')
    } finally {
      setCargando(false)
    }
  }, [sucursalId])

  // Cambió la tienda: se limpia lo que se ve ANTES de recargar. El encabezado
  // ya dice el nombre nuevo, y mostrar el inventario de la anterior sería un
  // número con el apellido equivocado.
  useEffect(() => {
    setInventarioId(null)
    setPeriodo(null)
    setItems(null)
    setEstado(null)
    setVerificacion(null)
    setFallo(null)
    setCargando(true)
    void cargar()
  }, [cargar])

  /**
   * Las firmas las dan dos personas distintas, en dos equipos, y quien espera
   * la del otro tiene esta pantalla abierta mirando. PAUSADO con el diálogo
   * abierto o una acción en vuelo: aprobar y lacrar son irreversibles.
   */
  useRefreshOnFocus(() => cargar(), accion === null && !confirmarLacrado)

  /** Las tres escrituras comparten forma: el estado nuevo lo devuelve el api. */
  async function ejecutar(cual: Exclude<AccionEnVuelo, null | 'verificar'>): Promise<void> {
    if (inventarioId === null) return
    setAccion(cual)
    setFallo(null)
    try {
      const nuevo =
        cual === 'aprobar'
          ? await lacradoApi.aprobar(inventarioId)
          : cual === 'lacrar'
            ? await lacradoApi.lacrar(inventarioId)
            : await lacradoApi.marcarRegistradoEnErp(inventarioId)
      setEstado(nuevo)
    } catch (e) {
      setFallo({
        titulo:
          cual === 'aprobar' ? 'No se pudo aprobar' : cual === 'lacrar' ? 'No se pudo lacrar' : 'No se pudo registrar',
        error: e,
      })
    } finally {
      setAccion(null)
    }
  }

  /** Recalcula el hash en el servidor y lo compara con el sellado. */
  async function verificar(): Promise<void> {
    if (inventarioId === null) return
    setAccion('verificar')
    setFallo(null)
    try {
      setVerificacion(await lacradoApi.verificacion(inventarioId))
    } catch (e) {
      setFallo({ titulo: 'No se pudo verificar el sello', error: e })
    } finally {
      setAccion(null)
    }
  }

  const requeridas = firmasRequeridas(estado)
  const hechas = estado?.aprobaciones.length ?? 0
  const yo = colaborador?.id ?? null
  const miFirma = estado?.aprobaciones.some((a) => a.colaboradorId === yo) ?? false
  const pendientes = auditores.filter(
    (a) => a.id !== yo && !(estado?.aprobaciones.some((x) => x.colaboradorId === a.id) ?? false),
  )
  const cartel = cartelDelCierre(estado)
  const puedeLacrar = sePuedeLacrar(estado)
  const aviso = avisoDeFirmas({
    estado,
    auditores: auditores.length,
    firmoElDeLaSesion: miFirma,
    nombresPendientes: pendientes.map((a) => a.nombre),
  })
  const detalleDelSello = textoDelLacrado(estado)
  const yaLacrado = estado?.lacrado ?? false

  return (
    <div className="space-y-3 md:space-y-0 md:flex md:flex-col md:gap-4">
      {/* Panel de acciones: las dos del cierre a la izquierda, [⟳] a la derecha. */}
      <div className="flex items-center justify-between gap-2">
        <ActionGroup
          items={[
            {
              id: 'lacrar',
              label: accion === 'lacrar' ? 'Lacrando...' : 'Ejecutar lacrado digital',
              icon: <LockIcon size={14} />,
              // El ÚNICO primario de la pantalla. Dos acciones destacadas a la
              // vez es un formulario donde no se sabe cuál toca -- y acá una de
              // las dos no se deshace.
              tone: 'primary',
              disabled: !puedeLacrar || accion !== null,
              title: puedeLacrar
                ? 'Sella el inventario del mes. No se puede deshacer'
                : 'Hacen falta las firmas de auditoría y sincronización con Dynamics',
              onClick: () => setConfirmarLacrado(true),
            },
            {
              id: 'registro',
              label:
                accion === 'registro'
                  ? 'Registrando...'
                  : (estado?.registradoManualmenteEnDynamics ?? false)
                    ? 'Registrado por TI'
                    : 'Marcar como registrado manualmente',
              icon: <UploadIcon size={14} />,
              disabled: !yaLacrado || (estado?.registradoManualmenteEnDynamics ?? false) || accion !== null,
              title: yaLacrado
                ? 'Deja constancia de que TI cargó el resultado en el ERP a mano'
                : 'Primero hay que lacrar el inventario',
              onClick: () => void ejecutar('registro'),
            },
          ]}
        />
        <button
          onClick={() => void cargar()}
          disabled={accion !== null}
          className="p-[7px] border border-[var(--border)] rounded-md bg-white text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)] disabled:opacity-50 transition-colors"
          title="Volver a leer el estado del lacrado"
        >
          <HiRefresh className={`w-3.5 h-3.5 ${cargando ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="space-y-0.5">
        <h1 className="text-sm md:text-[13px] font-semibold text-[var(--fg)]">
          Aprobación y lacrado
          {nombreSucursal !== null && <span className="ml-2 font-normal text-[var(--fg-muted)]">{nombreSucursal}</span>}
        </h1>
        <p className="text-[12px] text-[var(--fg-muted)]">
          La doble validación de auditoría y el sello inmutable del inventario del mes.
        </p>
      </div>

      {/* El auditor elige la tienda. Siempre visible, para poder cambiarla
          aunque la actual no tenga nada que lacrar. Nunca un <select>. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <SearchableSelect
          options={sucursales.map((s) => ({ value: String(s.id), label: s.nombre }))}
          value={sucursalId === null ? '' : String(sucursalId)}
          onChange={(v) => setSucursalElegida(Number(v))}
          placeholder="Elige la sucursal a lacrar"
          ariaLabel="Sucursal a lacrar"
          className="sm:w-72"
        />
        <StatusBadge status={cartel.titulo} label={cartel.titulo} variant={VARIANTE_BADGE[cartel.tono]} />
        <span className="text-[12px] text-[var(--fg-muted)]">{cartel.detalle}</span>
      </div>

      {sucursalId === null ? (
        <EmptyState
          title="Elige una sucursal"
          message={`${colaborador?.nombre ?? 'El auditor'} audita toda la cadena: el lacrado es de un inventario, así que hay que elegir de qué tienda.`}
        />
      ) : cargando ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner text="Leyendo el estado del lacrado..." />
        </div>
      ) : error !== null ? (
        <EmptyState
          title="No se pudo cargar el lacrado"
          message={error}
          action={{ label: 'Volver a intentar', onClick: () => void cargar() }}
        />
      ) : inventarioId === null ? (
        <EmptyState
          title="Todavía no hay nada que lacrar"
          message="No hay ningún inventario listo para lacrar en esta sucursal. El lacrado llega cuando el conteo del ciclo ya cerró: mientras las cantidades todavía se pueden recontar, no hay nada que sellar."
        />
      ) : (
        <>
          {/* EL INVENTARIO: el contexto de todo lo de abajo. Sin esto, dos
              tarjetas de firmas no dicen de qué inventario hablan. */}
          <div className="rounded-md border border-[var(--border)] bg-white px-3 py-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-[12px] text-[var(--fg-muted)]">Inventario a lacrar</span>
            <span className="text-[13px] font-semibold text-[var(--fg)]">{nombreSucursal ?? 'Sin tienda'}</span>
            {periodo !== null && <span className="text-[12px] text-[var(--fg)] tabular-nums">{periodo}</span>}
            {/* "ítems del inventario", no "ítems auditados": es el total del
                snapshot, no lo que de verdad se comparó contra Dynamics. */}
            {items !== null && (
              <span className="text-[12px] text-[var(--fg-muted)] tabular-nums">
                {formatoMiles(items)} ítems del inventario
              </span>
            )}
            {!(estado?.todoSincronizado ?? true) && (
              <StatusBadge status="Pendiente de sincronizar" label="Pendiente de sincronizar" variant="warning" />
            )}
          </div>

          <div className="grid gap-3 md:gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            {/* LAS FIRMAS: la columna ancha. Es la lista que hay que leer antes
                de decidir, y crece con la cantidad de auditores. */}
            <section className="rounded-md border border-[var(--border)] bg-white p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <ShieldCheckIcon size={16} className="text-[var(--fg-muted)]" aria-hidden="true" />
                  <h2 className="text-[13px] font-semibold text-[var(--fg)]">
                    {requeridas === 1 ? 'Validación de auditoría' : 'Doble validación'}
                  </h2>
                </div>
                <span className="text-[12px] text-[var(--fg-muted)] tabular-nums shrink-0">
                  {hechas} de {requeridas} {pluralizar(requeridas, 'firma', 'firmas')}
                </span>
              </div>

              <p className="text-[12px] text-[var(--fg-muted)]">
                {requeridas === 1 ? (
                  <>
                    Hace falta la firma de <span className="font-semibold text-[var(--fg)]">un auditor</span>, desde su
                    propia sesión.
                  </>
                ) : (
                  <>
                    Hacen falta las firmas de{' '}
                    <span className="font-semibold text-[var(--fg)]">{requeridas} auditores distintos</span>, cada uno
                    desde su propia sesión.
                  </>
                )}{' '}
                Nadie puede aprobar en nombre de otro: la única fila con botón es la de quien está en sesión.
              </p>

              <ul className="divide-y divide-[var(--border-muted)]">
                {auditores.map((auditor) => {
                  const aprobacion = estado?.aprobaciones.find((a) => a.colaboradorId === auditor.id)
                  const esMiFila = auditor.id === yo
                  return (
                    <li key={auditor.id} className="flex items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p className="text-[13px] text-[var(--fg)] truncate">{auditor.nombre}</p>
                        <p className="text-[11px] text-[var(--fg-muted)]">
                          {aprobacion ? `Firmó el ${fechaHora(aprobacion.fecha)}` : 'Auditor'}
                          {esMiFila ? ' · sesión actual' : ''}
                        </p>
                      </div>
                      {aprobacion ? (
                        <StatusBadge status="Aprobado" label="Aprobado" variant="success" />
                      ) : esMiFila ? (
                        /* El único botón de acción que no es el primario: el
                           destacado de esta pantalla es lacrar.

                           QUEDA HABILITADO AUNQUE EL SERVIDOR PUEDA RECHAZARLO:
                           `historial.permisos.ts#ESTADOS_APROBABLES` es
                           `['liquidado']`, así que con el conteo cerrado y sin
                           liquidar el 409 llega igual. Es la regla del teléfono
                           y no se cambió acá; el motivo del servidor explica
                           qué falta ("cerrar la planilla en Liquidación") y se
                           queda en pantalla. Marcado para el orquestador. */
                        <button
                          type="button"
                          onClick={() => void ejecutar('aprobar')}
                          disabled={yaLacrado || accion !== null}
                          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--bg-subtle)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <CheckIcon size={14} />
                          {accion === 'aprobar' ? 'Aprobando...' : 'Aprobar'}
                        </button>
                      ) : (
                        /* Sin botón a propósito: la fila se ve para que se
                           entienda quién falta, pero no la puede tocar quien no
                           es esa persona. */
                        <StatusBadge status="Falta su firma" label="Falta su firma" variant="default" />
                      )}
                    </li>
                  )
                })}
              </ul>

              {aviso !== null && <p className="text-[12px] text-[var(--fg)]">{aviso}</p>}
            </section>

            <div className="space-y-3 md:space-y-4">
              {/* EL SELLO */}
              <section className="rounded-md border border-[var(--border)] bg-white p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <LockIcon size={16} className="text-[var(--fg-muted)]" aria-hidden="true" />
                  <h2 className="text-[13px] font-semibold text-[var(--fg)]">Lacrado digital</h2>
                  <StatusBadge
                    status={yaLacrado ? 'Lacrado' : 'Bloqueado'}
                    label={yaLacrado ? 'Lacrado' : 'Bloqueado'}
                    variant={yaLacrado ? 'success' : 'default'}
                  />
                </div>

                {/* LA CITA VA PEGADA AL BOTÓN: es lo que hay que haber leído
                    antes de firmar. En el teléfono está cuatro tarjetas arriba. */}
                <blockquote className="border-l-2 border-[var(--border-strong)] pl-2.5 space-y-0.5">
                  <p className="text-[12px] italic text-[var(--fg)]">
                    “Cierras el mes, firmas, sellas y lacras. El inventario queda grabado de forma inmutable; cualquier
                    ajuste posterior entra en el siguiente período.”
                  </p>
                  <p className="text-[11px] text-[var(--fg-muted)]">— acordado en la reunión de requisitos</p>
                </blockquote>

                {yaLacrado ? (
                  <div className="space-y-1.5">
                    <p className="text-[12px] text-[var(--fg)]">
                      Inventario lacrado
                      {estado?.lacradoEn != null ? ` el ${fechaHora(estado.lacradoEn)}` : ''}. Los{' '}
                      {items !== null ? formatoMiles(items) : ''} ítems quedan grabados de forma inmutable; cualquier
                      ajuste entra en el período siguiente.
                    </p>
                    {estado?.hash != null && (
                      <p className="text-[11px] text-[var(--fg-muted)] break-all">
                        Hash ID: <span className="font-mono text-[var(--fg)]">{estado.hash}</span>
                      </p>
                    )}
                  </div>
                ) : (
                  detalleDelSello !== null && <p className="text-[12px] text-[var(--fg-muted)]">{detalleDelSello}</p>
                )}
              </section>

              {/* LA VERIFICACIÓN DEL SELLO: solo con el inventario lacrado.
                  Antes no hay nada que verificar, y ofrecerlo igual sería un
                  botón que solo puede contestar que no hay sello. */}
              {yaLacrado && (
                <section className="rounded-md border border-[var(--border)] bg-white p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <VerifiedIcon size={16} className="text-[var(--fg-muted)]" aria-hidden="true" />
                    <h2 className="text-[13px] font-semibold text-[var(--fg)]">Verificación del sello</h2>
                    {verificacion !== null && (
                      <StatusBadge
                        status={verificacion.valido ? 'Sello íntegro' : 'Sello alterado'}
                        label={verificacion.valido ? 'Sello íntegro' : 'Sello alterado'}
                        variant={verificacion.valido ? 'success' : 'danger'}
                      />
                    )}
                  </div>
                  <p className="text-[12px] text-[var(--fg-muted)]">
                    Recalcula el contenido sellado y lo compara con el hash guardado. Responde si alguien tocó este
                    inventario después de lacrarlo.
                  </p>
                  {verificacion !== null && verificacion.motivo !== null && (
                    <p className="text-[12px] text-[var(--fg)]">{verificacion.motivo}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => void verificar()}
                    disabled={accion !== null}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--bg-subtle)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <VerifiedIcon size={14} />
                    {accion === 'verificar' ? 'Verificando...' : 'Verificar el sello'}
                  </button>
                </section>
              )}

              {/* EL REGISTRO EN EL ERP: un marcador manual, y el texto lo dice
                  con todas las letras. El backend NO escribe en Dynamics. */}
              <section className="rounded-md border border-[var(--border)] bg-white p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <UploadIcon size={16} className="text-[var(--fg-muted)]" aria-hidden="true" />
                  <h2 className="text-[13px] font-semibold text-[var(--fg)]">Registro en Dynamics</h2>
                  <StatusBadge
                    status={(estado?.registradoManualmenteEnDynamics ?? false) ? 'Registrado manualmente' : 'Pendiente'}
                    label={(estado?.registradoManualmenteEnDynamics ?? false) ? 'Registrado manualmente' : 'Pendiente'}
                    variant={(estado?.registradoManualmenteEnDynamics ?? false) ? 'success' : 'default'}
                  />
                </div>
                <p className="text-[12px] text-[var(--fg-muted)]">
                  El ajuste automático a Dynamics es una funcionalidad de{' '}
                  <span className="font-semibold text-[var(--fg)]">fase 2</span>. Por ahora, el equipo de TI registra
                  manualmente el resultado lacrado en el ERP, y este botón solo deja constancia de que ya lo hizo: el
                  sistema no lo envía.
                </p>
              </section>
            </div>
          </div>
        </>
      )}

      {/*
        LA CONFIRMACIÓN NOMBRA LA CONSECUENCIA Y LA CIFRA, no pregunta "¿estás
        seguro?". El texto es el mismo del teléfono, palabra por palabra: dice
        qué queda sellado, que no hay forma de deshacerlo ni de editar los
        conteos, y a dónde va cualquier ajuste posterior.
      */}
      {confirmarLacrado && (
        <ConfirmDialog
          title="Confirmar lacrado"
          message={
            <>
              Se va a lacrar el inventario de{' '}
              <span className="font-semibold">{nombreSucursal ?? 'esta tienda'}</span>
              {items !== null ? ` (${formatoMiles(items)} ítems)` : ''}. A partir de este momento el inventario del mes
              queda <span className="font-semibold">congelado de forma inmutable</span>: no hay forma de deshacerlo ni
              de editar los conteos. Cualquier ajuste posterior entra en el período siguiente.
            </>
          }
          confirmText="Confirmar lacrado"
          cancelText="Cancelar"
          variant="destructive"
          isLoading={accion === 'lacrar'}
          onConfirm={() => {
            setConfirmarLacrado(false)
            void ejecutar('lacrar')
          }}
          onCancel={() => setConfirmarLacrado(false)}
          onClose={() => setConfirmarLacrado(false)}
        />
      )}

      {fallo !== null && (
        <ErrorNotice title={fallo.titulo} error={fallo.error} onDismiss={() => setFallo(null)} />
      )}
    </div>
  )
}
