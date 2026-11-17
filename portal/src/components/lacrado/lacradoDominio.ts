import { pluralizar } from '../../utils/formato'
import type { EstadoLacrado, InventarioDelHistorial } from './lacradoTipos'

/**
 * LAS REGLAS Y LOS TEXTOS DEL LACRADO, fuera del JSX para poder probarlos.
 *
 * NINGUNO DE ESTOS TEXTOS ES NUEVO: salen de `mobile/app/auditor/lacrado.web.tsx`
 * y de `mobile/lib/dominio/texto-firmas.ts`, donde se discutieron con el
 * cliente. Portarlos cambiados sería reabrir decisiones ya cerradas, y el peor
 * lugar para hacerlo es la pantalla del punto de no retorno.
 *
 * TODO SALE DE `aprobacionesRequeridas`, que viaja desde el servidor -- nunca
 * de un 2 escrito a mano. Hoy la configuración es 1, y los textos se leen bien
 * con 1, con 2 y con 3.
 */

/** El mínimo que se asume mientras el estado no llegó. Solo para no romper el layout. */
const REQUERIDAS_POR_DEFECTO = 2

export type TonoCartel = 'ok' | 'atencion' | 'neutro'

export interface CartelDelCierre {
  titulo: string
  detalle: string
  tono: TonoCartel
}

/**
 * EN QUÉ PUNTO DEL CIERRE ESTÁ, derivado del estado real y no de un texto
 * fijo.
 *
 * El tono NO incluye peligro a propósito: en esta pantalla el rojo es el botón
 * de lacrar. Un cartel rojo al lado le sacaría el único lugar donde significa
 * "esto no se deshace".
 */
export function cartelDelCierre(estado: EstadoLacrado | null): CartelDelCierre {
  if (estado === null) {
    return {
      titulo: 'Sin inventario para lacrar',
      detalle: 'Esta tienda no tiene un inventario con el conteo cerrado.',
      tono: 'neutro',
    }
  }
  if (estado.lacrado) {
    return { titulo: 'Lacrado', detalle: 'Cerrado y sellado: no se toca más.', tono: 'ok' }
  }
  const hechas = estado.aprobaciones.length
  const requeridas = estado.aprobacionesRequeridas
  if (hechas < requeridas) {
    return {
      titulo: pluralizar(requeridas, 'Falta la firma', 'Faltan firmas'),
      detalle: `${hechas} de ${requeridas} ${pluralizar(requeridas, 'firma de auditoría registrada', 'firmas de auditoría registradas')}.`,
      tono: 'atencion',
    }
  }
  if (!estado.todoSincronizado) {
    return {
      titulo: 'Falta sincronizar',
      detalle: `${requeridas === 1 ? 'La firma está registrada' : 'Las firmas están registradas'}, pero falta Dynamics.`,
      tono: 'atencion',
    }
  }
  return { titulo: 'Listo para lacrar', detalle: 'Falta ejecutar el lacrado, y no se puede deshacer.', tono: 'atencion' }
}

/**
 * EL INVENTARIO A LACRAR de una sucursal: el más reciente que ya cerró el
 * conteo y todavía no está lacrado.
 *
 * NO sale de `inventarios/activo`: ese devuelve el inventario ABIERTO, que es
 * exactamente el único que NO se puede sellar. El listado del historial viene
 * del más nuevo al más viejo, así que el primero que calce es el que toca.
 *
 * `liquidado` entra igual que `conteo_cerrado`: liquidar no sella. Un
 * inventario ya `lacrado` no entra -- no hay nada que hacerle, y la pantalla
 * del estado se ve igual porque `estadoLacrado` lo informa.
 */
export function inventarioALacrar(inventarios: readonly InventarioDelHistorial[]): InventarioDelHistorial | null {
  return inventarios.find((i) => i.estado === 'conteo_cerrado' || i.estado === 'liquidado') ?? null
}

/**
 * El aviso cuando NO hay suficientes cuentas de Auditor para el lacrado.
 * Portado de `mobile/lib/dominio/texto-firmas.ts#textoAuditoresInsuficientes`.
 *
 * `hay` cuenta los auditores DEL SISTEMA, no los de una tienda: el auditor ya
 * no pertenece a ninguna sucursal (audita toda la cadena), así que contar "los
 * de esta sucursal" da 0 y le pediría al usuario dar de alta cuentas que no
 * necesita.
 *
 * Con `requeridas === 1` NO menciona "personas distintas": eso es lenguaje de
 * la DOBLE firma y no tiene sentido cuando alcanza con una.
 */
export function textoAuditoresInsuficientes(hay: number, requeridas: number): string {
  const tiene = hay === 1 ? 'una sola cuenta de Auditor cargada' : `solo ${hay} cuentas de Auditor cargadas`
  const faltan = requeridas - hay
  const altas = faltan === 1 ? 'una cuenta más' : `${faltan} cuentas más`
  const distintas = requeridas === 1 ? '' : ' — tienen que ser personas distintas, no toques repetidos'
  return `El sistema tiene ${tiene}, y el lacrado exige ${requeridas}. Hace falta dar de alta ${altas} de Auditor (en Usuarios)${distintas}.`
}

export interface ContextoDeFirmas {
  estado: EstadoLacrado | null
  /** Cuántas cuentas de Auditor existen en el sistema. */
  auditores: number
  /** `true` = quien está en sesión ya firmó. */
  firmoElDeLaSesion: boolean
  /** Los otros auditores que todavía no firmaron, por nombre. */
  nombresPendientes: string[]
}

/**
 * EL AVISO MÁS IMPORTANTE DE LA PANTALLA: dice con todas las letras qué falta
 * y quién lo tiene que poner. `null` = no hay nada que avisar (ya está lacrado,
 * o todavía no se sabe).
 *
 * El caso que más importa es el último: cuando quien mira ya firmó y falta otro,
 * el texto dice que SOLO esa persona puede ponerla y cómo. Sin eso, el auditor
 * se queda esperando delante de un botón que nunca se le va a habilitar.
 */
export function avisoDeFirmas(ctx: ContextoDeFirmas): string | null {
  const { estado, auditores, firmoElDeLaSesion, nombresPendientes } = ctx
  if (estado === null || estado.lacrado) return null

  const hechas = estado.aprobaciones.length
  const requeridas = estado.aprobacionesRequeridas
  const nombres = nombresPendientes.join(' y ')

  if (auditores < requeridas) return textoAuditoresInsuficientes(auditores, requeridas)

  if (hechas >= requeridas) {
    if (firmoElDeLaSesion && requeridas === 1) return 'Tu firma quedó registrada. Ya se puede ejecutar el lacrado.'
    return `${pluralizar(requeridas, 'La firma quedó registrada', `Las ${requeridas} firmas quedaron registradas`)}. Ya se puede ejecutar el lacrado.`
  }

  if (!firmoElDeLaSesion && hechas === 0) {
    if (requeridas === 1) return 'Puedes registrar tu firma ahora: con esa alcanza para habilitar el lacrado.'
    return `Todavía no hay ninguna firma. Puedes registrar la tuya ahora; ${nombresPendientes.length === 1 ? 'la siguiente la tiene que registrar' : 'las siguientes las tienen que registrar'} ${nombres}, ingresando con su propio PIN.`
  }

  if (!firmoElDeLaSesion) {
    return `Ya hay ${hechas === 1 ? 'una firma registrada' : `${hechas} firmas registradas`}. Falta la tuya para completar la validación.`
  }

  return `Tu firma ya quedó registrada. ${nombresPendientes.length === 1 ? 'Falta la de' : 'Faltan las de'} ${nombres}, y solo esa persona puede ponerla: tiene que ingresar con su propio PIN, desde otro equipo o cerrando esta sesión.`
}

/**
 * QUÉ FALTA PARA PODER LACRAR, en la tarjeta del sello. `null` cuando ya está
 * lacrado: ahí se muestra el resultado (el hash), no este texto.
 */
export function textoDelLacrado(estado: EstadoLacrado | null): string | null {
  if (estado === null || estado.lacrado) return null

  const hechas = estado.aprobaciones.length
  const requeridas = estado.aprobacionesRequeridas

  if (hechas < requeridas) {
    return `${pluralizar(requeridas, 'Falta la firma', 'Faltan firmas')} de auditoría (${hechas} de ${requeridas}). El lacrado se habilita recién con ${pluralizar(requeridas, 'esa firma', 'todas ellas')}, y también hace falta sincronización con Dynamics.`
  }
  if (!estado.todoSincronizado) {
    return `${requeridas === 1 ? 'La firma está registrada' : 'Las firmas están registradas'}, pero falta sincronización con Dynamics (WiFi de tienda) para poder lacrar.`
  }
  return `Todo listo: ${requeridas === 1 ? 'la firma está registrada' : 'las firmas están registradas'} y hay sincronización con Dynamics.`
}

/**
 * SI SE PUEDE EJECUTAR EL LACRADO. Las tres condiciones que el servidor exige,
 * resueltas acá para que el botón que la pantalla habilita sea el que el
 * servidor va a aceptar.
 */
export function sePuedeLacrar(estado: EstadoLacrado | null): boolean {
  if (estado === null || estado.lacrado) return false
  return estado.aprobaciones.length >= estado.aprobacionesRequeridas && estado.todoSincronizado
}

/** Cuántas firmas se exigen. Con el estado sin llegar, el default solo sostiene el layout. */
export function firmasRequeridas(estado: EstadoLacrado | null): number {
  return estado?.aprobacionesRequeridas ?? REQUERIDAS_POR_DEFECTO
}

/**
 * "17/10/2026, 14:32". `Intl` del navegador, que acá sí está garantizado -- el
 * teléfono lo evita porque Hermes puede no traer los datos de es-PE, y esa
 * razón no aplica en una PC.
 *
 * Devuelve la cadena cruda si no es una fecha válida: inventar un "—" sobre un
 * dato que el servidor sí mandó escondería un problema real.
 */
export function fechaHora(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return iso
  return fecha.toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
