import { pluralizar } from '../../utils/formato'
import type { EstadoInventario } from '../../tipos'
import type { DiferenciaHistorica, InventarioHistorico, ResultadoInventario } from './historialTipos'

/**
 * Las reglas del Historial que no son de presentación.
 *
 * Casi todas son TEXTOS, y eso no las hace cosméticas: cada una dice qué se
 * puede afirmar sobre un inventario y qué no. "Cuadró contra el ERP" y
 * "todavía no cerró" se ven parecidas en pantalla y son afirmaciones
 * distintas sobre la plata de alguien; la diferencia entre las dos es el
 * trabajo de este archivo, y por eso son funciones puras con test y no
 * ternarios metidos en el JSX, donde ninguna rama se puede probar.
 *
 * Vienen de `mobile/lib/dominio/exportar-diferencias.ts`,
 * `texto-firmas.ts` y de las funciones sueltas de `HistorialScreen.web.tsx`.
 * No se reescribieron: son los textos que ya se discutieron con el cliente uno
 * por uno.
 */

/** Cada estado del ciclo con lo único que importa a nivel visual: si ya es historia. */
export const ESTADOS: Record<EstadoInventario, { etiqueta: string; variante: 'default' | 'success' | 'warning'; sellado: boolean }> = {
  en_curso: { etiqueta: 'En curso', variante: 'warning', sellado: false },
  // Sigue ABIERTO, no cerrado: el auditor está cambiando valores. Lleva la
  // misma variante que "En curso" a propósito -- son la misma cosa para quien
  // mira el historial (todavía no hay resultado), y pintarlo de otro color
  // sugeriría un cierre que no ocurrió.
  ajuste_auditor: { etiqueta: 'Ajuste del auditor', variante: 'warning', sellado: false },
  conteo_cerrado: { etiqueta: 'Conteo cerrado', variante: 'default', sellado: false },
  liquidado: { etiqueta: 'Liquidado', variante: 'default', sellado: false },
  lacrado: { etiqueta: 'Lacrado', variante: 'success', sellado: true },
  anulado: { etiqueta: 'Anulado', variante: 'default', sellado: false },
}

/**
 * Si el conteo todavía se puede tocar. Espeja `conteoAbierto` del móvil.
 *
 * `ajuste_auditor` ENTRA: el auditor está cambiando valores, así que no hay
 * planilla ni resultado definitivo que mostrar.
 */
export function conteoAbierto(estado: EstadoInventario): boolean {
  return estado === 'en_curso' || estado === 'ajuste_auditor'
}

/** Por qué este inventario no tiene resultado. Nunca un guion: un guion no explica nada. */
export function sinResultado(estado: EstadoInventario): string {
  if (estado === 'en_curso') return 'Conteo en marcha: los resultados se calculan al cerrar el ciclo.'
  if (estado === 'ajuste_auditor') return 'El auditor está haciendo el ajuste final: los resultados se calculan cuando lo cierre.'
  if (estado === 'conteo_cerrado') return 'Conteo cerrado, pero este inventario es de antes de que se calculara el resultado al cierre.'
  if (estado === 'anulado') return 'Inventario anulado: no produjo resultados.'
  return 'Sin resultados calculados.'
}

/**
 * Por qué `montoFaltanteNeto`/`cuotaBase` son null CON el resto del bloque ya
 * real (itemsTotales, montoFaltanteBruto).
 *
 * Son DOS razones distintas que no se pueden confundir bajo un mismo "sin
 * liquidar todavía": el inventario en curso —eso ya lo cubre `sinResultado`—
 * y el conteo ya cerrado pero sin asistencia o sin los ajustes capturados,
 * que es lo que este texto explica.
 */
export function motivoSinNeto(r: ResultadoInventario): string {
  const razones: string[] = []
  if (r.asistenciaSinRegistrar) razones.push('falta registrar la asistencia')
  if (r.ajustesSinRegistrar) razones.push('faltan los ajustes del mes')
  return razones.length > 0 ? `No se puede calcular: ${razones.join(' y ')}.` : 'No se puede calcular todavía.'
}

/** La misma razón, corta, para una celda de la grilla. Nunca un guion ni un "Sin liquidar" genérico. */
export function motivoSinNetoCorto(r: ResultadoInventario): string {
  if (r.asistenciaSinRegistrar && r.ajustesSinRegistrar) return 'Falta asistencia y ajustes'
  if (r.asistenciaSinRegistrar) return 'Falta asistencia'
  if (r.ajustesSinRegistrar) return 'Faltan ajustes'
  return 'No calculado'
}

/** Por qué la planilla no se puede resumir todavía. Mismo criterio que `motivoSinNeto`. */
export function motivoSinResumenDePlanilla(falta: { asistenciaSinRegistrar: boolean; ajustesSinRegistrar: boolean }): string {
  if (falta.asistenciaSinRegistrar && falta.ajustesSinRegistrar) {
    return 'Falta registrar la asistencia y los ajustes del mes: el resumen no se puede calcular todavía.'
  }
  if (falta.asistenciaSinRegistrar) return 'Falta registrar la asistencia: el resumen no se puede calcular todavía.'
  return 'Faltan los ajustes del mes: el resumen no se puede calcular todavía.'
}

export type EstadoExportacion = { puedeExportar: true } | { puedeExportar: false; motivo: string }

/**
 * ¿Hay algo que exportar, y si no, qué decirle a quien vino a exportar?
 *
 * El motivo NUNCA es genérico: "todavía no cerró el conteo" y "cerró y no hubo
 * diferencias" son dos situaciones distintas — una se destraba sola con el
 * tiempo y la otra no se destraba nunca porque no hay nada roto. Un solo texto
 * para las dos obligaría a averiguar en cuál se está.
 *
 * Nace de dos huecos que el cliente vio el 2026-09-08: con cero diferencias el
 * botón generaba un .xlsx de solo encabezados (y un archivo vacío mandado por
 * WhatsApp es peor que no tener el botón), y con el conteo abierto la sección
 * desaparecía entera sin decir nada — "no está" y "todavía no" se ven igual
 * cuando no hay nada en pantalla.
 */
export function estadoExportacion(estado: EstadoInventario, cantidadDiferencias: number): EstadoExportacion {
  if (estado === 'ajuste_auditor') {
    // NO cae en la rama de "cuadró" de abajo: eso sería afirmar un resultado
    // que todavía no existe, justo el error que esta función vino a evitar.
    return {
      puedeExportar: false,
      motivo:
        'El auditor está haciendo el ajuste final: está cambiando valores contra el stock. Las diferencias definitivas salen cuando cierre el ajuste.',
    }
  }
  if (estado === 'en_curso') {
    return {
      puedeExportar: false,
      motivo: 'El conteo sigue abierto: las diferencias se calculan al cerrar el ciclo. Vas a poder exportar cuando esté cerrado.',
    }
  }
  if (estado === 'anulado') {
    return {
      puedeExportar: false,
      motivo: 'Este inventario se anuló antes de cerrar el conteo, así que no tiene diferencias calculadas para exportar.',
    }
  }
  if (cantidadDiferencias === 0) {
    // Cerrado y sin diferencias es una BUENA noticia, no un bloqueo: no hay
    // nada que destrabar ni que esperar. El texto lo dice así.
    return { puedeExportar: false, motivo: 'Este inventario cuadró contra el ERP: no hay diferencias que exportar.' }
  }
  return { puedeExportar: true }
}

/**
 * POR PLATA, NO POR UNIDADES, y el que no tiene precio va al final.
 *
 * El servidor las ordena por `diferencia` ascendente, que son UNIDADES: 300
 * sorbetes mueven más unidades que 3 whiskys y mucha menos plata. Lo que se
 * mira primero es lo que más cuesta. Es la misma regla del móvil
 * (`historial-api.ts#aDiferencias`), y no una preferencia de esta pantalla.
 */
export function porPlata(diferencias: readonly DiferenciaHistorica[]): DiferenciaHistorica[] {
  return [...diferencias].sort((a, b) => Math.abs(b.montoDiferencia ?? 0) - Math.abs(a.montoDiferencia ?? 0))
}

/** "0 / 1 firma" · "1 / 2 firmas" — inventario sin lacrar todavía. */
export function textoFirmas(hechas: number, requeridas: number): string {
  return `${hechas} / ${requeridas} firma${requeridas === 1 ? '' : 's'}`
}

/**
 * Qué falta para poder lacrar, en un inventario que ya no se recuenta y
 * todavía no está sellado.
 *
 * TODO SALE DEL MÍNIMO CONFIGURABLE que manda el servidor, nunca de un 2
 * escrito a mano: con el mínimo de hoy (1) la pantalla decía "faltan 1 de las
 * 1 firma". Y `faltan === 0` es un estado real —ya firmaron todos, falta
 * ejecutar el lacrado— que no se puede seguir contando como firmas pendientes.
 */
export function textoFirmasPendientes(hechas: number, requeridas: number): string {
  const faltan = Math.max(requeridas - hechas, 0)
  if (faltan === 0) {
    return pluralizar(
      requeridas,
      'la firma ya está registrada y solo falta ejecutar el lacrado',
      `las ${requeridas} firmas ya están registradas y solo falta ejecutar el lacrado`,
    )
  }
  return pluralizar(
    requeridas,
    'falta la firma de auditoría',
    `${pluralizar(faltan, 'falta', 'faltan')} ${faltan} de las ${requeridas} firmas de auditoría`,
  )
}

/** Qué decir cuando el inventario todavía no está lacrado. */
export function textoSinLacrar(estado: EstadoInventario, hechas: number, requeridas: number): string {
  if (estado === 'en_curso') {
    const firmas = requeridas === 1 ? 'la firma' : `las ${requeridas} firmas`
    return `El conteo sigue abierto: este inventario todavía se puede modificar. El lacrado llega al final del ciclo, con ${firmas} de auditoría.`
  }
  return `Este inventario ya no se recuenta, pero todavía no está sellado: ${textoFirmasPendientes(hechas, requeridas)}. Hasta que se lacre, sigue siendo modificable.`
}

/**
 * Años que se ofrecen para filtrar por período.
 *
 * No hay un endpoint que diga "qué años tienen inventarios", así que se ofrece
 * el actual y los tres anteriores — rango razonable para un sistema que recién
 * empezó a operar.
 */
export function aniosDisponibles(hoy = new Date()): number[] {
  const actual = hoy.getFullYear()
  return [actual, actual - 1, actual - 2, actual - 3]
}

/**
 * El período que conviene mostrar al entrar: el del inventario más reciente.
 *
 * Arrancar en "el mes actual" deja la pantalla vacía los primeros días del
 * mes, cuando todavía no se abrió ninguno — y una lista vacía se lee como "no
 * hay historial", que es lo contrario de lo que esta pantalla vino a decir.
 * `null` cuando no hay ninguno: ahí no se filtra por período.
 */
export function periodoMasReciente(inventarios: readonly InventarioHistorico[]): { anio: number; mes: number } | null {
  let mejor: { anio: number; mes: number } | null = null
  for (const inv of inventarios) {
    if (mejor === null || inv.periodoAnio > mejor.anio || (inv.periodoAnio === mejor.anio && inv.periodoMes > mejor.mes)) {
      mejor = { anio: inv.periodoAnio, mes: inv.periodoMes }
    }
  }
  return mejor
}

/** El rol congelado al firmar, capitalizado para mostrar. */
export function rolCapitalizado(rol: string): string {
  return rol.charAt(0).toUpperCase() + rol.slice(1)
}

/**
 * "17/10/2026" y "17/10/2026, 14:32". `Intl` del navegador, que acá sí está
 * garantizado — el teléfono lo evita porque Hermes puede no traer los datos de
 * es-PE, y esa razón no aplica en una PC.
 *
 * Devuelven la cadena cruda si no es una fecha válida: inventar un "—" sobre
 * un dato que el servidor sí mandó escondería un problema real.
 */
export function fecha(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function fechaHora(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ---------------------------------------------------------------------------
// El nombre de los .xlsx
// ---------------------------------------------------------------------------

/**
 * ---------------------------------------------------------------------------
 * EL NOMBRE LO MANDA EL SERVIDOR, Y ESTOS SON EL RESPALDO
 * ---------------------------------------------------------------------------
 * Los tres archivos vienen con su `Content-Disposition`, y ese nombre es el
 * bueno. Pero el navegador NO puede leer esa cabecera cuando el portal y la
 * API están en orígenes distintos: `cors()` del backend no declara
 * `Access-Control-Expose-Headers`, así que en desarrollo (portal :5181, API
 * :3000) la cabecera llega y es invisible. En producción el backend sirve la
 * web, es el mismo origen y sí se lee.
 *
 * Sin respaldo, en desarrollo las cinco exportaciones del mismo día se
 * llamarían todas igual — justo lo que el nombre vino a evitar. Estos repiten
 * el formato del backend (`historial.exportar.ts`), verificado contra el
 * servidor vivo el 2026-10-17: SIN espacios ni acentos, porque es lo que se
 * manda por WhatsApp y un nombre con "í" puede llegar recodificado distinto
 * según el cliente de mensajería del otro lado.
 */
function slug(texto: string): string {
  return (
    texto
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'sucursal'
  )
}

function periodoDeArchivo(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}`
}

export function nombreArchivoDiferencias(sucursal: string, anio: number, mes: number, inventarioId: number): string {
  return `diferencias-${slug(sucursal)}-${periodoDeArchivo(anio, mes)}-inv${inventarioId}.xlsx`
}

export function nombreArchivoCuadros(sucursal: string, anio: number, mes: number, inventarioId: number): string {
  return `inventario-cuadros-${slug(sucursal)}-${periodoDeArchivo(anio, mes)}-inv${inventarioId}.xlsx`
}

/**
 * Sin nombre de sucursal ni de inventario: mezcla N tiendas, así que ninguno
 * de los dos identificaría el contenido. La columna `Sucursal` de la tabla sí
 * lo hace, fila por fila.
 */
export function nombreArchivoConsolidado(anio: number, mes: number): string {
  return `diferencias-consolidado-${periodoDeArchivo(anio, mes)}.xlsx`
}

/**
 * ---------------------------------------------------------------------------
 * LOS ESTADOS QUE SE PUEDEN PEDIR AL SERVIDOR — Y POR QUÉ NO SON LOS SEIS
 * ---------------------------------------------------------------------------
 * `ajuste_auditor` NO ESTÁ, y no es un olvido: el schema del backend
 * (`historial.schema.ts#ESTADOS_INVENTARIO`) es una lista de cinco que quedó
 * de antes de que ese estado existiera, así que `?estado=ajuste_auditor`
 * responde 400 "Invalid enum value". El listado SÍ devuelve inventarios en ese
 * estado y la columna Estado los muestra; lo único que no se puede es filtrar
 * por él desde el servidor.
 *
 * Verificado contra el backend vivo el 2026-10-17. Ofrecerlo igual sería un
 * control que falla al tocarlo; mientras tanto el filtro de la columna Estado
 * permite acotar lo que ya está cargado. El día que el backend agregue el
 * estado a su enum, esta lista vuelve a ser `Object.keys(ESTADOS)`.
 */
export const ESTADOS_FILTRABLES: EstadoInventario[] = ['en_curso', 'conteo_cerrado', 'liquidado', 'lacrado', 'anulado']
