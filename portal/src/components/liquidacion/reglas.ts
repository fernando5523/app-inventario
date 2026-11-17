/**
 * LAS REGLAS DE LA LIQUIDACIÓN: las mismas palabras y los mismos criterios que
 * la pantalla del teléfono, portados de `mobile/app/auditor/liquidacion.web.tsx`,
 * `mobile/lib/dominio/ajustes-formulario.ts`, `reparto-visible.ts`,
 * `reporte-gerencia.ts` y `asistencia.ts`.
 *
 * ---------------------------------------------------------------------------
 * EL NETO NO SE CALCULA ACÁ, Y NINGUNA OTRA CIFRA DE PLATA TAMPOCO
 * ---------------------------------------------------------------------------
 * `monto` (lo que se le descuenta a cada persona), `faltanteNeto`, `cuotaBase`,
 * `bonoAsistencia` y `fondoMultas` vienen HECHOS del servidor
 * (`liquidacion.cierre.ts`). Acá solo se formatean.
 *
 * La única cuenta que este archivo hace es la MULTA DE UNA FILA, con
 * `multaPorInasistencia`, que es la misma función y el mismo nombre que usa el
 * servidor. No es una segunda copia de la regla del neto: es el desglose que
 * explica el monto, puesto al lado del monto para que se vea si alguna vez no
 * coinciden.
 */

import type { AdvertenciaLiquidacion, DetalleLiquidacion, Liquidacion, ReporteGerencia, FilaReporteGerencia } from './tipos'

/** Sin dato es "—", nunca un 0: un cero es una afirmación, el guion es "no sé". */
export const SIN_DATO = '—'

export function pluralizar(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural
}

// ---------------------------------------------------------------------------
// Por qué una cifra no se puede calcular
// ---------------------------------------------------------------------------

/**
 * POR QUÉ UN MONTO VINO EN `null`: nunca "cero", nunca un guión sin explicar.
 * Son los dos datos que la planilla no puede inventar.
 */
export function motivoSinCalcular(advertencia: AdvertenciaLiquidacion): string {
  const razones: string[] = []
  if (advertencia.asistenciaSinRegistrar) razones.push('falta registrar la asistencia')
  if (advertencia.ajustesSinRegistrar) razones.push('faltan los ajustes del mes')
  return razones.length > 0 ? `No se puede calcular: ${razones.join(' y ')}.` : 'No se puede calcular todavía.'
}

/** Igual criterio, para el monto que depende ÚNICAMENTE de los ajustes del mes. */
export const MOTIVO_SIN_AJUSTES = 'No se puede calcular: faltan los ajustes del mes.'

/**
 * La tienda todavía no cerró ningún ciclo. NO es un error: es el estado normal
 * de una tienda mientras se está contando, o sea la mayor parte del mes.
 */
export const SIN_CICLO_CERRADO =
  'Todavía no hay un inventario con el conteo cerrado en esta tienda. Cuando el auditor cierre el ajuste final en Ciclo de conteos, vuelve aquí.'

// ---------------------------------------------------------------------------
// La asistencia y la multa
// ---------------------------------------------------------------------------

/** Cuántos días faltó: los del inventario menos los que marcó, nunca negativo. */
export function diasFaltados(diasDelInventario: number, diasAsistidos: number): number {
  return Math.max(0, diasDelInventario - diasAsistidos)
}

/**
 * LA MULTA: `días faltados × tarifa por día`. Nunca negativa.
 *
 * Espeja `multaPorInasistencia` de `backend/src/dominio/asistencia.ts`, con la
 * misma firma y el mismo nombre. Si esta cuenta y el `monto` de la fila alguna
 * vez no coincidieran, se vería en la propia fila: la multa está al lado del
 * monto, no en otra pantalla.
 */
export function multaPorInasistencia(diasInventario: number, diasAsistidos: number, tarifaPorDia: number): number {
  return diasFaltados(diasInventario, diasAsistidos) * tarifaPorDia
}

/**
 * DÍAS ASISTIDOS SOBRE DÍAS DEL INVENTARIO, los dos juntos. Nunca el numerador
 * solo: 2 de 2 y 2 de 5 son la diferencia entre cobrar bono y pagar tres días
 * de multa, y quien firma el descuento tiene derecho a ver de dónde sale.
 */
export function textoDiasAsistidos(diasAsistidos: number | null, diasDelInventario: number | null): string {
  if (diasAsistidos === null || diasDelInventario === null) return SIN_DATO
  if (diasDelInventario === 0) return 'Sin días registrados'
  return `${diasAsistidos} de ${diasDelInventario} ${pluralizar(diasDelInventario, 'día', 'días')}`
}

/**
 * EN QUÉ RÉGIMEN se cobró la multa de este cierre. Decide cómo se REDACTA el
 * fondo y cada fila — nunca cuánto es.
 *
 *   `sin-asistencia` → la asistencia de este inventario no se registró.
 *   `multa-fija`     → cierre con la REGLA VIEJA: monto fijo por persona
 *                      ausente, ya congelado en la planilla. NO es "duró cero
 *                      días".
 *   `multa-por-dia`  → multa por día faltado.
 */
export type Regimen = 'sin-asistencia' | 'multa-fija' | 'multa-por-dia'

export function regimenDeLaMulta(liquidacion: Pick<Liquidacion, 'diasDelInventario'>): Regimen {
  if (liquidacion.diasDelInventario === null) return 'sin-asistencia'
  return liquidacion.diasDelInventario > 0 ? 'multa-por-dia' : 'multa-fija'
}

/**
 * ESTA PERSONA TIENE FALTAS Y SE SABE. `asistio` solo afirma algo si hay
 * asistencia registrada: con el régimen `sin-asistencia` un `false` no quiere
 * decir que faltó, quiere decir que nadie marcó nada.
 */
export function tieneFaltas(fila: DetalleLiquidacion, liquidacion: Pick<Liquidacion, 'diasDelInventario'>): boolean {
  return !fila.asistio && regimenDeLaMulta(liquidacion) !== 'sin-asistencia'
}

/**
 * LA MULTA DE ESA FILA, ya formateada, o '—' cuando no se puede afirmar nada.
 *
 * El '—' no es decorativo: sin asistencia registrada no se afirma nada sobre
 * esta persona, y con `diasAsistidos` en null no se sabe cuántos días faltó
 * aunque el inventario sí tenga días. Un 0 ahí diría "no se le cobró nada".
 */
export function multaDeLaFila(
  fila: DetalleLiquidacion,
  liquidacion: Pick<Liquidacion, 'diasDelInventario' | 'multaInasistencia'>,
  soles: (n: number) => string,
): string {
  const regimen = regimenDeLaMulta(liquidacion)
  if (regimen === 'sin-asistencia') return SIN_DATO
  if (fila.asistio) return soles(0)
  // REGLA VIEJA: la multa fue un monto fijo por persona y ese cierre ya se
  // firmó así. No hay días que multiplicar.
  if (regimen === 'multa-fija') return `+${soles(liquidacion.multaInasistencia)}`
  if (fila.diasAsistidos === null) return SIN_DATO
  const multa = multaPorInasistencia(liquidacion.diasDelInventario!, fila.diasAsistidos, liquidacion.multaInasistencia)
  return multa > 0 ? `+${soles(multa)}` : soles(0)
}

/**
 * EL BONO DE ESA FILA: el piso del reparto del fondo, con el signo de lo que
 * hace (baja el descuento). A algunos asistentes les toca un centavo más que
 * este piso; la tarjeta del fondo lo aclara cuando pasa.
 */
export function bonoDeLaFila(
  fila: DetalleLiquidacion,
  liquidacion: Pick<Liquidacion, 'bonoAsistencia'>,
  soles: (n: number) => string,
): string {
  if (liquidacion.bonoAsistencia === null) return SIN_DATO
  if (!fila.asistio) return soles(0)
  return liquidacion.bonoAsistencia > 0 ? `–${soles(liquidacion.bonoAsistencia)}` : soles(0)
}

// ---------------------------------------------------------------------------
// El reparto visible
// ---------------------------------------------------------------------------

export interface AsistenciaVisible {
  alcanzados: number
  asistieron: number
  faltaron: number
}

/**
 * QUIÉN ASISTIÓ ES UN HECHO POR FILA, no una diferencia.
 *
 * Garantiza que ninguno de los dos números sea negativo y que sumen el
 * universo: era `planilla.length - totalFaltas` y con la planilla vacía daba
 * "-2 colaboradores" en pantalla.
 */
export function resumirAsistencia(alcanzados: number, asistieron: number): AsistenciaVisible {
  const universo = Math.max(0, alcanzados)
  const vinieron = Math.min(Math.max(0, asistieron), universo)
  return { alcanzados: universo, asistieron: vinieron, faltaron: universo - vinieron }
}

/**
 * A CUÁNTOS ASISTENTES LES TOCÓ EL CENTAVO EXTRA del reparto.
 *
 * Cuando el fondo no divide exacto, a algunos les toca un centavo más para que
 * la suma dé el fondo exacto (S/80 entre 7 = seis de 11,43 y uno de 11,42). Sin
 * decirlo, quien compare el encabezado contra la planilla ve dos números
 * distintos y piensa que el sistema calcula mal.
 */
export function asistentesConCentavoExtra(
  planilla: readonly { asistio: boolean; monto: number }[],
  cuotaBase: number,
  bonoPiso: number,
): number {
  const pisoEnCentavos = Math.round(bonoPiso * 100)
  return planilla.filter((p) => {
    if (!p.asistio) return false
    const bonoDeEstaPersona = Math.round((cuotaBase - p.monto) * 100)
    return bonoDeEstaPersona > pisoEnCentavos
  }).length
}

// ---------------------------------------------------------------------------
// Los ajustes del mes
// ---------------------------------------------------------------------------

export interface EstadoAjustesNegativos {
  texto: string
  bloqueaLiquidacion: boolean
  boton: string
}

export function estadoAjustesNegativos(
  montoNegativos: number | null,
  soles: (n: number) => string,
): EstadoAjustesNegativos {
  if (montoNegativos === null) {
    return {
      texto: 'Todavía no se importó el Excel de ajustes (bloquea liquidar)',
      bloqueaLiquidacion: true,
      boton: 'Importar el Excel de ajustes',
    }
  }
  return { texto: `Importado: ${soles(montoNegativos)}`, bloqueaLiquidacion: false, boton: 'Ver el Excel importado' }
}

/**
 * El faltante de empresa es CALCULADO y de solo lectura: ya no se tipea. Se
 * dice de dónde sale para que nadie busque dónde corregirlo.
 */
export function notaFaltanteEmpresa(proyectada: boolean): string {
  return proyectada
    ? 'Lo calcula la clasificación de productos; el monto definitivo queda fijo al liquidar.'
    : 'Lo calculó la clasificación de productos al liquidar.'
}

// ---------------------------------------------------------------------------
// Cerrar la planilla
// ---------------------------------------------------------------------------

export interface PuedeLiquidar {
  puede: boolean
  /** Qué falta hacer. `null` cuando sí se puede. */
  motivo: string | null
}

/**
 * LAS TRES CONDICIONES QUE EL BACKEND EXIGE, chequeadas acá para no ofrecer un
 * botón que se toca y devuelve 409 — un botón así enseña a ignorar los errores.
 *
 * "Hay asistencia registrada" NO es "hay al menos un asistente": con la
 * asistencia por día, `asistio` significa "vino todos los días", así que un
 * inventario donde todos faltaron alguna jornada daría cero asistentes y
 * bloquearía una liquidación perfectamente válida — una en la que TODOS
 * trabajaron.
 */
export function puedeLiquidar(liquidacion: Liquidacion, montoNegativos: number | null): PuedeLiquidar {
  const ajustesListos = montoNegativos !== null
  const calculable = liquidacion.faltanteNeto !== null && liquidacion.cuotaBase !== null
  const asistenciaRegistrada =
    liquidacion.diasDelInventario !== null && liquidacion.diasDelInventario > 0 && liquidacion.planilla.length > 0

  if (!ajustesListos) {
    return {
      puede: false,
      motivo:
        'Primero importa el Excel de ajustes del mes, arriba. Sin eso no se puede calcular lo que se le descuenta a cada persona.',
    }
  }
  if (!asistenciaRegistrada) {
    return {
      puede: false,
      motivo:
        'Este inventario no tiene ningún día de asistencia registrado: sin días no hay con qué medir las faltas ni a quién repartir el faltante. El Coordinador la marca en «Asistencia del inventario», día por día.',
    }
  }
  if (!calculable) {
    return { puede: false, motivo: 'Todavía no se puede calcular la planilla: revisa las advertencias de arriba.' }
  }
  return { puede: true, motivo: null }
}

// ---------------------------------------------------------------------------
// El reporte a gerencia
// ---------------------------------------------------------------------------

export const MOTIVO_SIN_LIQUIDAR =
  'El reporte a gerencia se arma al liquidar: recién ahí queda fijo qué productos son de la empresa. Cuando cierres la planilla, aparece aquí.'

export const MOTIVO_SIN_PRODUCTOS =
  'No hubo productos de la empresa con sobrantes ni faltantes en este inventario.'

export type VistaReporteGerencia =
  | { tipo: 'no-liquidado'; motivo: string }
  | { tipo: 'cargando' }
  | { tipo: 'error'; motivo: string }
  | { tipo: 'sin-productos'; motivo: string }
  | {
      tipo: 'con-datos'
      faltantes: FilaReporteGerencia[]
      sobrantes: FilaReporteGerencia[]
      totalFaltante: number
      totalSobrante: number
      /** Cuántos productos no tienen precio: están en la lista pero no suman al total. */
      sinPrecio: number
    }

/**
 * QUÉ MOSTRAR EN LA TARJETA DEL REPORTE. Nunca dos listas vacías: siempre el
 * motivo real de por qué no hay nada.
 */
export function vistaReporteGerencia({
  proyectada,
  reporte,
  error,
}: {
  proyectada: boolean
  reporte: ReporteGerencia | null
  error: string | null
}): VistaReporteGerencia {
  // Primero, y gana sobre todo lo demás: sin liquidar no hay reporte, aunque
  // haya quedado uno en memoria de la tienda anterior.
  if (proyectada) return { tipo: 'no-liquidado', motivo: MOTIVO_SIN_LIQUIDAR }
  if (error !== null) return { tipo: 'error', motivo: error }
  if (reporte === null) return { tipo: 'cargando' }
  if (reporte.faltantes.length === 0 && reporte.sobrantes.length === 0) {
    return { tipo: 'sin-productos', motivo: MOTIVO_SIN_PRODUCTOS }
  }
  return {
    tipo: 'con-datos',
    faltantes: reporte.faltantes,
    sobrantes: reporte.sobrantes,
    totalFaltante: reporte.totalFaltante,
    totalSobrante: reporte.totalSobrante,
    sinPrecio: [...reporte.faltantes, ...reporte.sobrantes].filter((f) => f.monto === null).length,
  }
}

/** "Sin precio" es un hecho, no un 0: el producto está pero no suma al total. */
export function textoMontoReporte(monto: number | null, soles: (n: number) => string): string {
  return monto === null ? 'Sin precio' : soles(monto)
}

export function textoSinPrecioReporte(cantidad: number): string {
  return cantidad === 1
    ? '1 producto no tiene precio en Dynamics: está en la lista pero no suma al total.'
    : `${cantidad} productos no tienen precio en Dynamics: están en la lista pero no suman al total.`
}

export function textoUnidadesReporte(
  tipo: 'faltante' | 'sobrante',
  unidades: number,
  miles: (n: number) => string,
): string {
  return `${tipo === 'faltante' ? '-' : '+'}${miles(unidades)} und`
}
