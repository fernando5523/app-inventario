/**
 * Lo que la pantalla de liquidación necesita saber sobre el reparto del fondo
 * de multas, para poder explicarlo.
 *
 * Vive acá y no dentro del componente porque es una regla, no presentación:
 * se puede probar sin montar la pantalla (ver reparto-visible.test.ts).
 *
 * ---------------------------------------------------------------------------
 * EL PROBLEMA QUE RESUELVE
 * ---------------------------------------------------------------------------
 * `Liquidacion.bonoAsistencia` es el PISO del reparto, y algunas filas de la
 * planilla llevan un centavo más — es así para que la suma de los bonos dé el
 * fondo exacto (S/80 entre 7 = seis de 11.43 y uno de 11.42).
 *
 * Quien mire el encabezado ("−S/11.42 para cada asistente") y después la
 * planilla (11.43 en seis filas) ve dos números distintos. Sin una línea que
 * lo explique, la conclusión razonable es que el sistema calcula mal — que es
 * exactamente lo que este reparto vino a evitar. Peor: alguien "arregla" el
 * reparto para que los números coincidan, y vuelve el descuadre.
 */

/** Lo mínimo de un renglón de la planilla para poder despejar su bono. */
export interface FilaConMonto {
  asistio: boolean;
  /** Descuento final: para un asistente es `cuotaBase − bono`. */
  monto: number;
}

/**
 * A cuántos asistentes les tocó el centavo extra.
 *
 * El bono de cada persona no viene suelto en la planilla -- viene su `monto`
 * final -- así que se despeja restando de la cuota base, y se compara contra
 * el piso del reparto.
 *
 * Se compara en CENTAVOS ENTEROS y no en soles: `126.36 − 114.93` no da
 * exactamente `11.43` en punto flotante, y una comparación directa marcaría
 * diferencias donde no las hay. Ese es justamente el tipo de error que
 * pondría el cartel del centavo en una planilla donde el reparto fue parejo.
 */
export function asistentesConCentavoExtra(
  planilla: readonly FilaConMonto[],
  cuotaBase: number,
  bonoPiso: number,
): number {
  const pisoEnCentavos = Math.round(bonoPiso * 100);
  return planilla.filter((p) => {
    if (!p.asistio) return false;
    const bonoDeEstaPersona = Math.round((cuotaBase - p.monto) * 100);
    return bonoDeEstaPersona > pisoEnCentavos;
  }).length;
}
