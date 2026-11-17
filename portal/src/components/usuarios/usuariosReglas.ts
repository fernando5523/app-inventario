import type { SearchableSelectOption } from '../common/SearchableSelect'
import { LARGO_PIN } from '../common/CampoPin'
import { pluralizar } from '../../utils/formato'
import type { Rol } from '../../tipos'
import type { Actor, CuerpoDeAlta, CuerpoDeEdicion, UsuarioDto } from './usuariosTipos'

/**
 * ---------------------------------------------------------------------------
 * LAS REGLAS DE "USUARIOS DE MI SUCURSAL", SIN REACT
 * ---------------------------------------------------------------------------
 * Puras a propósito, igual que `backend/src/modules/usuarios/usuarios.permisos.ts`:
 * la regla más sensible de la pantalla (que un auditor no se fabrique un
 * administrador) tiene que poder testearse sin montar nada.
 *
 * NINGUNA DE ESTAS FUNCIONES AUTORIZA NADA. La que manda es la del servidor,
 * que saca a quien pide la acción del TOKEN y nunca del cuerpo. Acá se decide
 * solo qué se OFRECE y qué se explica: no mostrar un camino que el servidor va
 * a rechazar, y cuando un control no se puede usar, decir por qué con las
 * mismas palabras que diría el servidor.
 *
 * Los textos de rechazo se copian de `usuarios.permisos.ts` y
 * `usuarios.service.ts` (archivo y línea en cada constante): si el servidor
 * llega a contestar, dice lo mismo que la pantalla ya había dicho.
 */

/** Los nombres que ve la persona. Los mismos de `UsuariosScreen.tsx` en el teléfono. */
export const NOMBRE_ROL: Record<Rol, string> = {
  administrador: 'Administrador',
  auditor: 'Auditor',
  coordinador: 'Coordinador',
  conteo: 'Conteo',
}

/** El orden en que se listan en el selector: de más a menos alcance, como el teléfono. */
export const ORDEN_DE_ROLES: Rol[] = ['administrador', 'auditor', 'coordinador', 'conteo']

/**
 * Los únicos roles que un auditor crea o gestiona. Copia de
 * `usuarios.permisos.ts#ROLES_GESTIONABLES_POR_AUDITOR` (línea 26).
 */
export const ROLES_GESTIONABLES_POR_AUDITOR: Rol[] = ['coordinador', 'conteo']

/**
 * QUÉ ROLES PUEDE ASIGNAR QUIEN ESTÁ USANDO LA PANTALLA.
 *
 * NO es un ranking "igual o inferior": el auditor es un caso aparte. Un
 * administrador asigna cualquiera, incluido otro administrador; un auditor
 * solo coordinador y conteo, NUNCA otro auditor (su propio rol) ni un
 * administrador. Coordinador y conteo no gestionan cuentas: lista vacía (el
 * router ya los saca con 403 antes de llegar a ninguna regla).
 *
 * Es la misma tabla que `mobile/lib/dominio/roles.ts#rolesQuePuedeCrear` y que
 * `validarPermisoDeAlta` en el servidor.
 */
export function rolesQuePuedeAsignar(actor: Rol): Rol[] {
  if (actor === 'administrador') return [...ORDEN_DE_ROLES]
  if (actor === 'auditor') return [...ROLES_GESTIONABLES_POR_AUDITOR]
  return []
}

export function puedeAsignarRol(actor: Rol, rol: Rol): boolean {
  return rolesQuePuedeAsignar(actor).includes(rol)
}

/** `usuarios.permisos.ts:39` y `:65`: coordinador y conteo no tocan cuentas. */
export const MOTIVO_ROL_SIN_GESTION = 'Tu rol no puede dar de alta usuarios.'

/** Al lado de cada opción que el auditor ve pero no puede elegir. */
export const MOTIVO_ROL_RESERVADO = 'Solo un administrador puede asignar este rol.'

/** `usuarios.permisos.ts:42`: el rechazo del alta cuando el rol no está permitido. */
export const MOTIVO_ROL_NO_PERMITIDO_EN_ALTA =
  'Un auditor solo puede crear coordinador o conteo, nunca auditor ni administrador.'

/** `usuarios.service.ts:162`: el mismo rechazo, en la edición. */
export const MOTIVO_ROL_NO_PERMITIDO_EN_EDICION = 'Un auditor solo puede asignar roles coordinador o conteo.'

/**
 * LAS CUATRO OPCIONES DEL SELECTOR, con las que no se pueden asignar
 * DESHABILITADAS y con el motivo al lado — no escondidas. Un auditor que no ve
 * "Auditor" en la lista no sabe si es un olvido de la pantalla o una regla; si
 * la ve apagada con "Solo un administrador puede asignar este rol", sabe a
 * quién pedírselo.
 */
export function opcionesDeRol(actor: Rol): SearchableSelectOption[] {
  const motivo = rolesQuePuedeAsignar(actor).length === 0 ? MOTIVO_ROL_SIN_GESTION : MOTIVO_ROL_RESERVADO
  return ORDEN_DE_ROLES.map((rol) => {
    const puede = puedeAsignarRol(actor, rol)
    return { value: rol, label: NOMBRE_ROL[rol], disabled: !puede, ...(puede ? {} : { sublabel: motivo }) }
  })
}

/**
 * La línea de ayuda debajo del selector de rol: qué puede crear quien está
 * usando la pantalla, y por qué no más. Es la regla del cliente dicha una vez,
 * en vez de dejar que se descubra a fuerza de rechazos.
 */
export function textoDeAlcance(actor: Rol): string {
  if (actor === 'administrador') return 'Como administrador puedes asignar cualquier rol, en cualquier sucursal.'
  if (actor === 'auditor') {
    return 'Como auditor puedes crear cuentas de Coordinador o Conteo, y solo de tu sucursal. Nunca otro auditor ni un administrador: esos dos roles los asigna solo un administrador.'
  }
  return MOTIVO_ROL_SIN_GESTION
}

/** `usuarios.permisos.ts:68`: el rechazo de cualquier gestión fuera de alcance. */
export const MOTIVO_FUERA_DE_ALCANCE = 'Un auditor solo gestiona coordinador/conteo de su propia sucursal.'

/** `usuarios.service.ts:214`. Solo le pasa al administrador: el auditor ni siquiera llega acá. */
export const MOTIVO_PROPIA_CUENTA = 'No puedes eliminar tu propia cuenta.'

type CuentaGestionable = Pick<UsuarioDto, 'id' | 'rol' | 'sucursalId'>

/**
 * POR QUÉ ESTA CUENTA NO SE PUEDE EDITAR, HABILITAR, DESHABILITAR NI
 * RESETEAR. `null` = se puede.
 *
 * Es `usuarios.permisos.ts#validarAlcanceDeGestion` del lado de la pantalla,
 * con el motivo un poco más concreto que el del servidor: el servidor dice la
 * regla, la pantalla además dice QUÉ tiene esta cuenta que la deja afuera.
 *
 * LA PROPIA CUENTA DEL AUDITOR CAE ACÁ, y no es un descuido: es de rol
 * auditor, y un auditor no gestiona auditores. Para su PIN hay otro camino, y
 * se nombra.
 */
export function motivoSinGestion(actor: Actor, cuenta: CuentaGestionable): string | null {
  if (actor.rol === 'administrador') return null
  if (actor.rol !== 'auditor') return MOTIVO_ROL_SIN_GESTION
  if (cuenta.id === actor.id) {
    return 'Es tu propia cuenta: un auditor no gestiona cuentas de auditor, tampoco la suya. Tu PIN lo cambias tú con «Cambiar mi PIN», en el menú de tu nombre.'
  }
  if (cuenta.sucursalId !== actor.sucursalId) return `Es de otra sucursal. ${MOTIVO_FUERA_DE_ALCANCE}`
  if (!ROLES_GESTIONABLES_POR_AUDITOR.includes(cuenta.rol)) {
    return `Es una cuenta de ${NOMBRE_ROL[cuenta.rol]}. ${MOTIVO_FUERA_DE_ALCANCE}`
  }
  return null
}

/**
 * Lo mismo para BORRAR, más la única regla que el servidor agrega en el
 * borrado: nadie elimina su propia cuenta.
 */
export function motivoSinEliminar(actor: Actor, cuenta: CuentaGestionable): string | null {
  if (cuenta.id === actor.id) return MOTIVO_PROPIA_CUENTA
  return motivoSinGestion(actor, cuenta)
}

/**
 * Las acciones de la barra son de a UNA cuenta. Sin esto, un botón apagado no
 * diría por qué.
 */
export function motivoSinSeleccion(cuantas: number): string | null {
  if (cuantas === 0) return 'Elige una cuenta de la lista.'
  if (cuantas > 1) return 'Elige una sola cuenta: estas acciones son de a una.'
  return null
}

/** Habilitada / Deshabilitada, con las palabras del teléfono y su color neutro para la apagada. */
export function estadoDeCuenta(activo: boolean): { label: string; variant: 'success' | 'default' } {
  return activo ? { label: 'Habilitada', variant: 'success' } : { label: 'Deshabilitada', variant: 'default' }
}

/** "5 cuentas · 4 habilitadas", como la barra del teléfono. */
export function resumenDeCuentas(cuentas: Pick<UsuarioDto, 'activo'>[]): string {
  const habilitadas = cuentas.filter((c) => c.activo).length
  return `${cuentas.length} ${pluralizar(cuentas.length, 'cuenta', 'cuentas')} · ${habilitadas} ${pluralizar(habilitadas, 'habilitada', 'habilitadas')}`
}

/**
 * ---------------------------------------------------------------------------
 * EL PIN
 * ---------------------------------------------------------------------------
 * Lo que la pantalla dice cada vez que alguien pone un PIN, al crear o al
 * resetear. "Con argon2, que no se puede revertir" y no "cifrado": argon2 es
 * un hash de un solo sentido (`backend/src/shared/pin.ts`), no un cifrado que
 * alguien con la clave pueda abrir — y esa diferencia es justamente la
 * promesa de que nadie lo puede ver.
 */
export const TEXTO_PIN_ILEGIBLE =
  'El PIN se guarda con argon2, que no se puede revertir: nadie puede verlo, ni el auditor ni el administrador. Solo se puede poner uno nuevo.'

/**
 * Quien resetea ELIGE el PIN, así que lo conoce: un PIN que saben dos personas
 * no identifica a ninguna (`backend/src/modules/sesion/sesion.pin.ts`). El
 * reseteo es el punto de partida; el camino normal es que cada uno ponga el
 * suyo, y en la app eso está en «Mi cuenta» para los cuatro roles.
 */
export const TEXTO_PIN_LO_CONOCE =
  'Quien lo pone lo conoce: pídele a la persona que lo cambie por uno propio desde «Mi cuenta» en la app.'

/**
 * ---------------------------------------------------------------------------
 * EL FORMULARIO DE ALTA Y DE EDICIÓN
 * ---------------------------------------------------------------------------
 */

/** `''` = todavía no eligió rol: es el valor vacío de `SearchableSelect`. */
export interface DatosDelFormulario {
  nombre: string
  dni: string
  rol: Rol | ''
  /** La que eligió el administrador. El auditor no elige: va la suya. */
  sucursalId: number | null
  /** Solo en el alta. En la edición el PIN no se toca: para eso está "Resetear PIN". */
  pin: string
  pinRepetido: string
}

export type CampoDelFormulario = 'nombre' | 'dni' | 'rol' | 'sucursal' | 'pin' | 'pinRepetido'
export type ErroresDelFormulario = Partial<Record<CampoDelFormulario, string>>

export const FORMULARIO_VACIO: DatosDelFormulario = {
  nombre: '',
  dni: '',
  rol: '',
  sucursalId: null,
  pin: '',
  pinRepetido: '',
}

/** Los datos de una cuenta existente, para abrir la edición con lo que HAY. */
export function datosDeCuenta(cuenta: UsuarioDto): DatosDelFormulario {
  return { ...FORMULARIO_VACIO, nombre: cuenta.nombre, dni: cuenta.dni, rol: cuenta.rol, sucursalId: cuenta.sucursalId }
}

/** El DNI son de 4 a 8 dígitos (`usuarios.schema.ts:11`): se descarta todo lo demás al tipear. */
export const LARGO_MAXIMO_DNI = 8

export function soloDigitos(texto: string, largoMaximo: number): string {
  return texto.replace(/\D/g, '').slice(0, largoMaximo)
}

/** `usuarios.schema.ts:43`. */
export function errorDeNombre(nombre: string): string | null {
  return nombre.trim().length === 0 ? 'El nombre es obligatorio.' : null
}

/**
 * `usuarios.schema.ts:11`: de 4 a 8 dígitos. No se fuerzan 8 aunque un DNI
 * peruano real los tenga: el servidor acepta el rango para no romper las
 * cuentas sembradas, y la pantalla no puede ser más estricta que él sin
 * dejar fuera cuentas que el servidor sí acepta.
 */
export function errorDeDni(dni: string): string | null {
  return /^\d{4,8}$/.test(dni) ? null : 'El DNI debe tener entre 4 y 8 dígitos.'
}

/**
 * `usuarios.schema.ts:4`: seis dígitos exactos. Los PIN triviales (123456,
 * 111111) también los rechaza el servidor, pero esa regla NO se copia acá: su
 * mensaje ya dice qué está mal y cómo salir, y una segunda copia es la forma
 * más barata de que algún día las dos digan cosas distintas.
 */
export function errorDePin(pin: string): string | null {
  return new RegExp(`^\\d{${LARGO_PIN}}$`).test(pin) ? null : `El PIN debe tener ${LARGO_PIN} dígitos.`
}

/**
 * Solo el administrador elige sucursal, y solo para los roles que la tienen.
 * Un administrador nuevo no pertenece a ninguna: el servidor rechaza el alta
 * si se la mandan.
 */
export function requiereElegirSucursal(actor: Rol, rol: Rol | ''): boolean {
  return actor === 'administrador' && rol !== '' && rol !== 'administrador'
}

/**
 * QUÉ SUCURSAL VIAJA EN EL CUERPO. El punto donde "la sucursal del auditor no
 * se elige" se vuelve código:
 *
 * - rol administrador → ninguna (se OMITE; el servidor rechaza si viene).
 * - quien crea es administrador → la que eligió.
 * - quien crea es auditor → la SUYA, la de la sesión, siempre. Aunque el
 *   formulario trajera otra (una cuenta abierta para editar, por ejemplo), se
 *   pisa con la de la sesión: es la única que el servidor le acepta.
 */
export function sucursalDelCuerpo(actor: Actor, rol: Rol, elegida: number | null): number | undefined {
  if (rol === 'administrador') return undefined
  if (actor.rol === 'administrador') return elegida ?? undefined
  return actor.sucursalId ?? undefined
}

/**
 * LO QUE LE FALTA AL FORMULARIO PARA PODER MANDARSE, campo por campo. Vacío =
 * se puede mandar. Son las validaciones de forma del servidor
 * (`usuarios.schema.ts`) más la matriz de roles, para que el rechazo llegue
 * antes del viaje y pegado al campo que lo causa.
 */
export function erroresDelFormulario(
  actor: Actor,
  datos: DatosDelFormulario,
  modo: 'alta' | 'edicion',
): ErroresDelFormulario {
  const errores: ErroresDelFormulario = {}

  const nombre = errorDeNombre(datos.nombre)
  if (nombre) errores.nombre = nombre
  const dni = errorDeDni(datos.dni)
  if (dni) errores.dni = dni

  if (datos.rol === '') {
    errores.rol = 'Elige un rol.'
  } else if (!puedeAsignarRol(actor.rol, datos.rol)) {
    errores.rol =
      actor.rol !== 'auditor'
        ? MOTIVO_ROL_SIN_GESTION
        : modo === 'alta'
          ? MOTIVO_ROL_NO_PERMITIDO_EN_ALTA
          : MOTIVO_ROL_NO_PERMITIDO_EN_EDICION
  }

  if (requiereElegirSucursal(actor.rol, datos.rol) && datos.sucursalId === null) {
    errores.sucursal = 'Elige una sucursal.'
  }
  // Un auditor sin sucursal en la sesión no debería existir. Si pasa, el
  // cuerpo saldría sin sucursal y el servidor contestaría un 400 que no
  // explica nada: mejor decir dónde está el problema.
  if (actor.rol === 'auditor' && actor.sucursalId === null) {
    errores.sucursal = 'Tu sesión no tiene sucursal: vuelve a iniciar sesión.'
  }

  if (modo === 'alta') {
    const pin = errorDePin(datos.pin)
    if (pin) errores.pin = pin
    else if (datos.pinRepetido !== datos.pin) errores.pinRepetido = 'Los dos PIN no coinciden.'
  }

  return errores
}

function rolElegido(datos: DatosDelFormulario): Rol {
  if (datos.rol === '') throw new Error('El formulario se mandó sin rol: falta validarlo antes.')
  return datos.rol
}

/** `POST /api/usuarios`. Se llama con el formulario ya validado. */
export function cuerpoDeAlta(actor: Actor, datos: DatosDelFormulario): CuerpoDeAlta {
  const rol = rolElegido(datos)
  const sucursalId = sucursalDelCuerpo(actor, rol, datos.sucursalId)
  return {
    nombre: datos.nombre.trim(),
    dni: datos.dni,
    rol,
    ...(sucursalId === undefined ? {} : { sucursalId }),
    pin: datos.pin,
  }
}

/**
 * `PATCH /api/usuarios/:id`. Manda los cuatro campos, como el teléfono, y
 * `sucursalId` con la misma regla que el alta.
 */
export function cuerpoDeEdicion(actor: Actor, datos: DatosDelFormulario): CuerpoDeEdicion {
  const rol = rolElegido(datos)
  const sucursalId = sucursalDelCuerpo(actor, rol, datos.sucursalId)
  return {
    nombre: datos.nombre.trim(),
    dni: datos.dni,
    rol,
    ...(sucursalId === undefined ? {} : { sucursalId }),
  }
}

/** Si el formulario de edición cambió algo respecto de la cuenta guardada. */
export function edicionConCambios(cuenta: UsuarioDto, datos: DatosDelFormulario): boolean {
  return (
    datos.nombre !== cuenta.nombre ||
    datos.dni !== cuenta.dni ||
    datos.rol !== cuenta.rol ||
    datos.sucursalId !== cuenta.sucursalId
  )
}

/** Si el formulario de alta tiene algo tipeado (para no perderlo con un clic al aire). */
export function altaConDatos(datos: DatosDelFormulario): boolean {
  return (
    datos.nombre !== '' ||
    datos.dni !== '' ||
    datos.rol !== '' ||
    datos.sucursalId !== null ||
    datos.pin !== '' ||
    datos.pinRepetido !== ''
  )
}

/** El nombre del campo en el 400 del servidor → el campo del formulario donde se muestra. */
const CAMPO_DEL_SERVIDOR: Record<string, CampoDelFormulario> = {
  nombre: 'nombre',
  dni: 'dni',
  rol: 'rol',
  sucursalId: 'sucursal',
  pin: 'pin',
}

/**
 * EL 400 DEL SERVIDOR, CAMPO POR CAMPO.
 *
 * Un cuerpo que no pasa el schema vuelve como
 * `{ error: 'Solicitud invalida.', detalles: { fieldErrors: { dni: [...] } } }`
 * (`error.middleware.ts`, el `flatten()` de zod). "Solicitud inválida" solo no
 * dice qué corregir; el detalle sí, y va debajo del campo que lo causó.
 */
export function erroresDelServidor(error: unknown): ErroresDelFormulario {
  const datos = (error as { response?: { data?: unknown } } | null)?.response?.data as
    | { detalles?: { fieldErrors?: Record<string, unknown> } }
    | undefined
  const porCampo = datos?.detalles?.fieldErrors
  if (!porCampo || typeof porCampo !== 'object') return {}

  const errores: ErroresDelFormulario = {}
  for (const [clave, mensajes] of Object.entries(porCampo)) {
    const campo = CAMPO_DEL_SERVIDOR[clave]
    const primero = Array.isArray(mensajes) ? mensajes.find((m) => typeof m === 'string' && m.trim() !== '') : undefined
    if (campo && typeof primero === 'string') errores[campo] = primero
  }
  return errores
}
