import type { EstadoInventario } from '../../tipos'
import { pluralizar } from '../../utils/formato'

/**
 * ---------------------------------------------------------------------------
 * LAS REGLAS DEL CICLO DE CONTEOS. PORTADAS, NO REESCRITAS
 * ---------------------------------------------------------------------------
 * Cada función de este archivo es una COPIA de su gemela en la app del
 * teléfono, con el mismo nombre y el mismo comportamiento:
 *
 *   `ordinal` / `ORDINAL` / `RONDA_MAX` / `estadoDePaso`
 *        <- mobile/lib/dominio/texto-cierre-ronda.ts
 *   `comparativoDeRonda`
 *        <- mobile/lib/dominio/comparativo-ronda.ts
 *   `faseDeCierre` / `elAuditorPuedeDecidir`
 *        <- mobile/lib/dominio/ajuste-final.ts
 *   `inventarioDelCiclo` / `puedeConsultarHistorial`
 *        <- mobile/lib/dominio/inventario-del-ciclo.ts
 *
 * Están duplicadas y no importadas porque `portal/` y `mobile/` son dos
 * paquetes sin nada compartido entre ellos. Se conservan los NOMBRES exactos
 * a propósito: es lo que hace que un cambio en una se encuentre en la otra.
 * Cada una de estas reglas se discutió con el cliente y se arregló contra un
 * bug real; los comentarios de cada bug viven en el archivo del teléfono y no
 * se repiten acá, salvo el resumen que explica por qué la regla NO es la
 * obvia.
 *
 * SI UNA REGLA DE ACÁ CAMBIA, cambia en las dos o en ninguna: si difieren, el
 * Auditor ve un número en el portal y otro en el teléfono y no hay forma de
 * saber cuál era el bueno.
 */

/** "1er", "2do", "3er"… Responde para CUALQUIER ronda: el Auditor abre un 4to y un 5to. */
const ORDINALES_IRREGULARES: Record<number, string> = { 1: '1er', 2: '2do', 3: '3er', 4: '4to', 5: '5to', 6: '6to' }

export function ordinal(ronda: number): string {
  return ORDINALES_IRREGULARES[ronda] ?? `${ronda}°`
}

/**
 * LAS PASADAS DEL CICLO AUTOMÁTICO. Cerrar la 3ra ya NO termina el inventario:
 * lo deja esperando al Auditor, que decide si abre otro conteo o arranca el
 * ajuste final. Es el techo del ciclo que se cierra solo, no el techo de
 * cuántas rondas puede tener un inventario.
 */
export const RONDA_MAX = 3

/**
 * Estado de un PASO del embudo, comparando su número con la ronda ACTIVA del
 * backend -- NUNCA un literal. Ese era el bug del teléfono: el Paso 2 decía
 * "En curso" fijo aunque el inventario ya estuviera en la 3ra.
 */
export type EstadoPaso = 'cerrado' | 'en-curso' | 'pendiente' | 'sin-datos'

export function estadoDePaso(rondaPaso: number, rondaActiva: number | null, tieneDatos: boolean): EstadoPaso {
  // Sin ronda activa = el conteo del inventario ya se cerró. Lo que corrió
  // quedó cerrado; lo que nunca se abrió no tiene nada que mostrar.
  if (rondaActiva === null) return tieneDatos ? 'cerrado' : 'sin-datos'
  if (rondaPaso < rondaActiva) return 'cerrado'
  if (rondaPaso > rondaActiva) return 'pendiente'
  // La ronda activa: en curso si ya se contó algo; pendiente si se abrió pero
  // todavía no entró ni una hoja.
  return tieneDatos ? 'en-curso' : 'pendiente'
}

/**
 * El nombre y el tono de cada estado de paso. Los cuatro textos son los del
 * teléfono (`badgeDePaso`); el tono se traduce a las variantes de
 * `StatusBadge`, que es el badge del portal.
 *
 * 'pendiente' y 'sin-datos' caen los dos en `default` -- el portal no tiene
 * una quinta variante -- pero sus ETIQUETAS son distintas, que es lo que
 * separa "todavía no se abrió" de "nunca corrió porque cuadró antes".
 */
export function badgeDePaso(estado: EstadoPaso): { label: string; variant: 'default' | 'success' | 'warning' } {
  switch (estado) {
    case 'cerrado':
      return { label: 'Cerrado', variant: 'success' }
    case 'en-curso':
      return { label: 'En curso', variant: 'warning' }
    case 'pendiente':
      return { label: 'Pendiente', variant: 'default' }
    case 'sin-datos':
      return { label: 'Sin datos todavía', variant: 'default' }
  }
}

// ---------------------------------------------------------------------------
// El comparativo contra Dynamics de una ronda
// ---------------------------------------------------------------------------

/** Lo mínimo de `ResumenRonda` que necesita el comparativo. */
export interface ResumenParaMostrar {
  total: number
  cuadrados: number
  aRecontar: number
  sinContar: number
  sinDatoErp: number
}

export interface ComparativoVisible {
  avance: { pct: number; texto: string }
  detalle: string
  /** Ítems sobre los que SE PUEDE afirmar algo: `total - sinDatoErp`. */
  auditables: number
}

/**
 * `null` cuando la ronda todavía no existe (el endpoint responde 404 y quien
 * llama pasa `null`) o cuando no entró ningún ítem.
 *
 * La distinción importa: "todavía no empezó" NO es lo mismo que "no lo podemos
 * calcular". Decir lo segundo cuando pasa lo primero hace creer que el sistema
 * está roto justo cuando funciona como debe.
 *
 * ESTO NO ROMPE EL CONTEO CIEGO: trabaja sobre AGREGADOS (cuántos cuadraron,
 * cuántos pasan a recontar), nunca el stock de un ítem puntual.
 */
export function comparativoDeRonda(
  r: ResumenParaMostrar | null,
  formatoNumero: (n: number) => string,
  formatoPct: (n: number) => string,
): ComparativoVisible | null {
  if (r === null || r.total === 0) return null

  // El porcentaje se calcula sobre los AUDITABLES, no sobre el total: un ítem
  // sin stock en el ERP no puede cuadrar ni dejar de cuadrar, y meterlo en el
  // denominador haría que el ciclo parezca peor de lo que está.
  const auditables = r.total - r.sinDatoErp
  const pct = auditables === 0 ? 0 : (r.cuadrados / auditables) * 100

  // Solo se nombra lo que NO es cero: "0 sin contar" es ruido que compite con
  // las cifras que sí importan. El VERBO concuerda con su cifra: en la 2da y
  // la 3ra pasada cualquiera de estas puede dar 1.
  const partes = [`${formatoNumero(r.cuadrados)} ${pluralizar(r.cuadrados, 'cuadró', 'cuadraron')} contra Dynamics`]
  if (r.aRecontar > 0)
    partes.push(`${formatoNumero(r.aRecontar)} ${pluralizar(r.aRecontar, 'pasa', 'pasan')} al siguiente conteo`)
  if (r.sinContar > 0) partes.push(`${formatoNumero(r.sinContar)} sin contar`)
  if (r.sinDatoErp > 0) partes.push(`${formatoNumero(r.sinDatoErp)} sin stock en el ERP`)

  return {
    avance: {
      pct,
      // El sustantivo concuerda con N, el TOTAL de auditables: en la 3ra
      // pasada pueden ser uno solo.
      texto: `${formatoNumero(r.cuadrados)} de ${formatoNumero(auditables)} ${pluralizar(auditables, 'ítem cuadrado', 'ítems cuadrados')} (${formatoPct(pct)}%)`,
    },
    detalle: `${partes.join(' · ')}.`,
    auditables,
  }
}

// ---------------------------------------------------------------------------
// En qué punto del cierre está el inventario
// ---------------------------------------------------------------------------

/**
 *   'sin-hojas'        el catálogo se trajo pero TODAVÍA NO HAY HOJAS. No es
 *                      que el conteo haya terminado -- no empezó.
 *   'contando'         hay una ronda abierta: se cuenta y se corrige.
 *   'rondas-cerradas'  la última ronda cerró y el ajuste todavía no arrancó.
 *                      Es la ventana del Coordinador, y donde el Auditor
 *                      decide entre abrir otra ronda o ajustar.
 *   'ajuste'           el Auditor está ajustando: el Coordinador quedó afuera.
 *   'cerrado'          el conteo cerró: nadie toca nada, sigue la liquidación.
 */
export type FaseDeCierre = 'sin-hojas' | 'contando' | 'rondas-cerradas' | 'ajuste' | 'cerrado'

/**
 * `activo()` DEVUELVE ADEMÁS `admiteConteo`, Y ACÁ NO SE USA. No es un olvido:
 * la app del teléfono tomó esa decisión y está anotada en
 * `mobile/lib/dominio/ajuste-final.ts` -- usarlo haría alcanzable la fase
 * `'rondas-cerradas'` por primera vez y cambiaría el comportamiento de ocho
 * pantallas, que es un lote aparte. El portal se porta con la MISMA lectura
 * que el teléfono: si una de las dos cambiara de criterio, la misma tienda
 * mostraría dos fases distintas según por dónde se la mire.
 *
 * `totalHojas` y no `rondaActiva === null` para el caso nuevo: ese `null`
 * cubría dos situaciones opuestas -- "todavía no hay rondas porque no se
 * crearon las hojas" y "no hay ronda abierta porque se cerraron todas" -- y
 * las trataba a las dos como la segunda.
 */
export function faseDeCierre(
  estado: EstadoInventario,
  rondaActiva: number | null,
  totalHojas: number,
  ultimaRondaCerrada: number | null,
): FaseDeCierre {
  if (estado === 'ajuste_auditor') return 'ajuste'
  if (estado !== 'en_curso') return 'cerrado'
  // Antes que nada: sin hojas no hay conteo que haya terminado ni ronda que
  // cerrar. Va primero para que ninguna de las dos ramas de abajo lo reclame.
  if (totalHojas === 0) return 'sin-hojas'
  if (rondaActiva === null) return 'rondas-cerradas'
  // LA MARCA PROPIA DEL CIERRE: `rondaActiva` es `max(numeroConteo)` y sigue
  // siendo un número después de cerrar. Cuando queda algo para recontar el
  // cierre crea la ronda siguiente y esa ronda hacía de marca implícita; con
  // TODO cuadrado no se crea ninguna y el cierre no dejaba huella.
  if (ultimaRondaCerrada !== null && ultimaRondaCerrada >= rondaActiva) return 'rondas-cerradas'
  return 'contando'
}

/**
 * SI SE LE OFRECEN AL AUDITOR sus dos decisiones: abrir otra ronda, o empezar
 * el ajuste. NO es la misma pregunta que "la última ronda ya cerró".
 *
 * El candado está en lo que SÍ se sabe -- el inventario está abierto y el
 * ajuste no empezó -- porque la precondición real (que no quede una ronda
 * abierta) la sostiene el servidor, que responde 409 con el motivo escrito. Un
 * botón que puede recibir un 409 explicado es mucho mejor que no tener ninguna
 * salida, que es lo que había cuando el candado era `'rondas-cerradas'`.
 */
export function elAuditorPuedeDecidir(fase: FaseDeCierre): boolean {
  return fase === 'contando' || fase === 'rondas-cerradas'
}

// ---------------------------------------------------------------------------
// Qué inventario muestra la pantalla
// ---------------------------------------------------------------------------

/**
 * QUIÉN PUEDE PEDIR EL HISTÓRICO. Espeja
 * `historial.permisos.ts#ROLES_CON_ACCESO_AL_HISTORICO` del backend.
 *
 * En el portal entran el auditor y el administrador, así que hoy esto siempre
 * da `true`. Se porta igual porque el fallback al histórico es la parte de
 * esta pantalla que ya produjo un bug (el Coordinador leía "Tu rol no tiene
 * acceso a esta acción" en una pantalla que SÍ es suya): si mañana el portal
 * recibe otro rol, la regla ya está escrita en vez de descubrirse con un 403.
 */
const ROLES_CON_HISTORICO = ['administrador', 'auditor'] as const

export function puedeConsultarHistorial(rol: string): boolean {
  return (ROLES_CON_HISTORICO as readonly string[]).includes(rol)
}

/** El inventario cuyo ciclo se muestra. */
export interface InventarioDelCiclo {
  inventarioId: number
  /** Ítems del snapshot: alimenta el encabezado. */
  items: number
  tamanoHoja: number | null
  /**
   * La ronda que HOY admite cierre (la activa del backend), o `null` si el
   * ciclo ya cerró. `null` NO es 1: con un inventario cerrado el embudo se
   * muestra igual, pero no hay ronda que cerrar.
   */
  rondaActiva: number | null
  /** Cuántas hojas tiene el inventario EN TOTAL. `null` cuando viene del histórico. */
  totalHojas: number | null
}

/** Lo mínimo de `activo()` que usa la resolución. */
export interface ActivoParaCiclo {
  inventarioId: number
  items: number
  tamanoHoja: number | null
  rondaActiva: number | null
  totalHojas: number
}

/** Lo mínimo de una fila del histórico. */
export interface HistoricoParaCiclo {
  id: number
  estado: EstadoInventario
  tamanoHoja: number | null
  snapshotItems: number
}

/**
 * Los estados de un inventario que YA terminó de contar: su ciclo está
 * completo y su embudo es historia real, aunque no haya ronda activa.
 *
 * `en_curso` y `ajuste_auditor` NO están acá, y no es un olvido: los dos los
 * trae `activo()`, así que se resuelven por la rama de arriba con su ronda y
 * su estado reales. Meter `ajuste_auditor` mandaría a buscar al histórico y la
 * pantalla mostraría el ciclo del mes ANTERIOR mientras el auditor ajusta el
 * de este. `anulado` nunca tuvo ciclo que mostrar.
 */
const CERRADOS: ReadonlySet<EstadoInventario> = new Set(['conteo_cerrado', 'liquidado', 'lacrado'])

/**
 * `activo()` devuelve `null` cuando el inventario ya cerró (filtra
 * `estado: en_curso`), y la pantalla se quedaba EN BLANCO: los pasos "sin
 * datos", el cierre "no hay ningún conteo cargado". Todo falso -- el ciclo
 * terminó CON sus pasadas contadas, están en el servidor.
 *
 * @param historial las filas del histórico, YA ordenadas del más nuevo al más
 *                  viejo (así las devuelve el backend), así que el primero
 *                  cerrado es el último ciclo de la sucursal.
 */
export function inventarioDelCiclo(
  activo: ActivoParaCiclo | null,
  historial: readonly HistoricoParaCiclo[],
): InventarioDelCiclo | null {
  if (activo) {
    return {
      inventarioId: activo.inventarioId,
      items: activo.items,
      tamanoHoja: activo.tamanoHoja,
      rondaActiva: activo.rondaActiva,
      totalHojas: activo.totalHojas,
    }
  }
  const cerrado = historial.find((i) => CERRADOS.has(i.estado))
  if (!cerrado) return null
  return {
    inventarioId: cerrado.id,
    items: cerrado.snapshotItems,
    tamanoHoja: cerrado.tamanoHoja,
    rondaActiva: null,
    totalHojas: null,
  }
}

// ---------------------------------------------------------------------------
// Las filas del embudo: una por pasada
// ---------------------------------------------------------------------------

/**
 * EL TÍTULO Y LA DESCRIPCIÓN DE CADA PASADA, textuales de la pantalla del
 * teléfono. No se reescriben: ya los leyó el cliente, y dos redacciones para
 * el mismo paso crearían dos nombres para la misma cosa.
 *
 * El Paso 3 dice "auditados directamente por ti" porque el portal es del
 * Auditor -- es la rama `rol === 'auditor'` del texto del teléfono.
 */
const PASOS_DEL_CICLO: Record<number, { titulo: string; descripcion: string; notaSinDato: string }> = {
  1: {
    titulo: 'Paso 1 · 1er Conteo General',
    descripcion: '100% del catálogo, comparado contra el stock de Dynamics a medida que se cuenta.',
    notaSinDato: 'El 1er conteo todavía no tiene hojas con datos para esta sucursal.',
  },
  2: {
    titulo: 'Paso 2 · 2do Reconteo',
    descripcion: 'Solo los ítems que no coincidieron con el stock de Dynamics en el 1er conteo.',
    notaSinDato:
      'El 2do conteo todavía no empezó: se abre al cerrar el 1ero, y entra solo con los ítems que no cuadraron.',
  },
  3: {
    titulo: 'Paso 3 · 3er Reconteo',
    // DECÍA "no hay un 4to conteo", y dejó de ser cierto: el Auditor abre los
    // que hagan falta. La frase vieja hacía cerrar la 3ra creyendo que ese
    // número ya era el definitivo.
    descripcion:
      'Los ítems que persistieron tras la 2da pasada, auditados directamente por ti. Al cerrarlo, el auditor decide: otro conteo, o el ajuste final.',
    notaSinDato: 'El 3er conteo todavía no empezó: se abre al cerrar el 2do, y solo si quedan ítems sin cuadrar.',
  },
}

/** Una pasada del ciclo, lista para dibujar como fila de la tabla. */
export interface FilaDeRonda {
  ronda: number
  titulo: string
  /** Qué entra en esta pasada, o -- si todavía no corrió -- por qué no. */
  descripcion: string
  estado: EstadoPaso
  /** `null` = esta ronda todavía no existe: todas sus cifras van en guion, nunca en 0. */
  comparativo: ComparativoVisible | null
  resumen: ResumenParaMostrar | null
}

/**
 * LAS FILAS DEL EMBUDO.
 *
 * Las tres primeras SIEMPRE están: son el ciclo automático, y una ronda que
 * todavía no se abrió es información ("se abre al cerrar la anterior"), no un
 * hueco. De la 4ta en adelante solo entran las que EXISTEN de verdad --
 * tienen resumen del servidor -- porque una ronda dibujada "por las dudas"
 * sería un paso que nadie abrió, y un paso vacío se lee como "acá no cuadró
 * nada", que es una afirmación.
 */
export function filasDelCiclo(
  resumenPorRonda: Record<number, ResumenParaMostrar | null>,
  rondaQueAdmiteConteo: number | null,
  formatoNumero: (n: number) => string,
  formatoPct: (n: number) => string,
): FilaDeRonda[] {
  const extra = Object.keys(resumenPorRonda)
    .map(Number)
    .filter((ronda) => ronda > RONDA_MAX && resumenPorRonda[ronda] != null)
    .sort((a, b) => a - b)

  const rondas = [...Array.from({ length: RONDA_MAX }, (_, i) => i + 1), ...extra]

  return rondas.map((ronda) => {
    const resumen = resumenPorRonda[ronda] ?? null
    const comparativo = comparativoDeRonda(resumen, formatoNumero, formatoPct)
    const paso = PASOS_DEL_CICLO[ronda]
    const titulo = paso?.titulo ?? `Paso ${ronda} · ${ordinal(ronda)} Conteo`
    const descripcion =
      comparativo === null && paso
        ? paso.notaSinDato
        : (paso?.descripcion ??
          `Conteo extra abierto por el auditor, solo con los ítems que seguían sin cuadrar tras el ${ordinal(ronda - 1)}.`)
    return {
      ronda,
      titulo,
      descripcion,
      estado: estadoDePaso(ronda, rondaQueAdmiteConteo, comparativo != null),
      comparativo,
      resumen,
    }
  })
}

/**
 * LA RONDA QUE ADMITE CONTEO -- la única que puede estar "en curso".
 *
 * `rondaActiva` es `max(numeroConteo)`, así que sigue devolviendo 3 mientras
 * el Auditor ajusta, y `estadoDePaso` lo leería como la ronda activa: el Paso
 * 3 decía "En curso" con la ronda 3 ya cerrada (bug real, inventario 8040).
 * Solo en la fase `contando` hay una ronda abierta.
 */
export function rondaQueAdmiteConteo(fase: FaseDeCierre | null, rondaActiva: number | null): number | null {
  if (fase === null) return rondaActiva
  return fase === 'contando' ? rondaActiva : null
}

/**
 * CUÁNTAS PASADAS CORRIERON de verdad: las que tienen resumen del servidor. No
 * es `RONDA_MAX` ni `rondaActiva`, y la diferencia importa en los dos sentidos
 * -- un inventario que cuadró en la 1ra tuvo UNA pasada, y uno al que el
 * Auditor le abrió un 4to tuvo cuatro.
 */
export function pasadasCorridas(resumenPorRonda: Record<number, ResumenParaMostrar | null>): number {
  return Object.values(resumenPorRonda).filter((r) => r != null).length
}

/**
 * LA ÚLTIMA PASADA CON DATOS: es la que dice dónde quedó el ciclo. No se suman
 * las pasadas -- un ítem que pasó de la 1 a la 2 está en las dos, y sumarlas lo
 * contaría dos veces.
 */
export function ultimaPasadaConDatos(filas: readonly FilaDeRonda[]): FilaDeRonda | null {
  for (let i = filas.length - 1; i >= 0; i -= 1) {
    const fila = filas[i]
    if (fila.comparativo !== null) return fila
  }
  return null
}
