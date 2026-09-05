/**
 * QUIEN ASISTIO AL INVENTARIO. Regla del cliente, aislada acá y sin Prisma
 * por la misma razón que `ciclo-conteos.ts#conteoQueManda`: es una decisión
 * de negocio, no una consecuencia del modelo de datos, y el día que cambie
 * se toca esta función y nada más.
 *
 * ---------------------------------------------------------------------------
 * LA REGLA, TEXTUAL
 * ---------------------------------------------------------------------------
 * Asistió quien tiene al menos UNA hoja asignada (como titular o como
 * segundo) con al menos UN conteo cargado, en CUALQUIERA de las tres rondas.
 *
 * Se deduce de las hojas: CERO carga manual. Nadie pasa lista, nadie marca
 * presente. El sistema ya sabe quién contó porque tiene los conteos.
 *
 * ---------------------------------------------------------------------------
 * EL COSTO DE LA REGLA, QUE EL CLIENTE ACEPTO EXPLICITAMENTE
 * ---------------------------------------------------------------------------
 * QUIEN VINO Y NO LLEGO A CONTAR FIGURA COMO AUSENTE. Alguien que fue a la
 * tienda, se le asignó una hoja y no alcanzó a cargar ni un renglón --
 * porque lo mandaron a otra cosa, porque el teléfono no andaba, porque
 * terminó la jornada -- va a aparecer con multa por inasistencia.
 *
 * Esto NO es un bug ni un caso que haya que arreglar despues: es el precio
 * acordado de no tener carga manual, y el cliente lo eligió sabiéndolo. Si
 * alguna vez se revierte, se revierte acá.
 *
 * Y tiene consecuencia en plata: la multa por inasistencia se le descuenta
 * del sueldo, y además no cobra el bono de redistribución. Quien lea esto en
 * seis meses y encuentre un reclamo de alguien que "sí vino", que sepa que
 * el sistema no se equivocó -- respondió lo único que puede saber.
 *
 * ---------------------------------------------------------------------------
 * POR QUE "CUALQUIER RONDA" Y NO SOLO LA PRIMERA
 * ---------------------------------------------------------------------------
 * El reconteo de la ronda 2 lo suele hacer OTRA persona, a propósito (ver
 * `rondas.service.ts`: las hojas nuevas nacen sin asignar justamente para
 * que el Coordinador pueda dárselas a alguien distinto). Mirar solo la
 * ronda 1 dejaría afuera a quien vino especialmente a recontar.
 */

/** Lo mínimo de una hoja que la regla necesita. */
export interface HojaParaAsistencia {
  /** Titular de la hoja. `null` = nunca se asignó. */
  asignadoAId: number | null;
  /** Segunda persona (conteo de a dos). `null` = no hay. */
  asignadoA2Id: number | null;
  /** Si la hoja tiene AL MENOS un conteo cargado. */
  tieneConteos: boolean;
}

/**
 * Los ids de quienes asistieron. Un `Set` y no una lista: la pregunta que
 * hace quien llama es "¿esta persona asistió?", y con una lista esa
 * respuesta cuesta un recorrido por cada colaborador.
 *
 * Una hoja SIN conteos no cuenta para ninguno de sus dos asignados: es
 * exactamente el caso de "vino y no llegó a contar" que la regla resuelve
 * como ausencia.
 *
 * Las dos personas de una hoja con conteos asistieron LAS DOS. No se puede
 * saber cuál de las dos cargó cada renglón -- `Conteo` no guarda autor -- y
 * en el conteo de a dos ambas están ahí: una canta y la otra anota. Atribuir
 * la hoja a una sola sería inventar un dato que no existe, y le costaría una
 * multa a la otra.
 */
export function quienesAsistieron(hojas: readonly HojaParaAsistencia[]): Set<number> {
  const asistieron = new Set<number>();

  for (const hoja of hojas) {
    if (!hoja.tieneConteos) continue;
    if (hoja.asignadoAId !== null) asistieron.add(hoja.asignadoAId);
    if (hoja.asignadoA2Id !== null) asistieron.add(hoja.asignadoA2Id);
  }

  return asistieron;
}

/**
 * La consulta de Prisma que alimenta a `quienesAsistieron`, EN UN SOLO LUGAR.
 *
 * La usan el cierre del conteo (para `ResultadoInventario.colaboradoresAsistieron`,
 * que es CUANTOS) y el cierre de la planilla (para `LiquidacionColaborador.asistio`,
 * que es QUIENES). Si cada uno armara su propia query, un dia una filtraria
 * por ronda o por estado de hoja y la otra no, y la planilla tendria 7
 * asistentes mientras el resultado dice 8. Ese numero lo firma alguien.
 *
 * No filtra por ronda ni por estado de la hoja a proposito: la regla dice
 * "cualquier ronda", y una hoja `en-proceso` con conteos ya prueba que la
 * persona estuvo -- que no la haya finalizado es otro problema, y el cierre
 * ya lo bloquea por su cuenta.
 */
export const SELECT_ASISTENCIA = {
  asignadoAId: true,
  asignadoA2Id: true,
  _count: { select: { conteos: true } },
} as const;

/** Traduce la fila de Prisma a lo que la regla entiende. */
export function aHojaParaAsistencia(fila: {
  asignadoAId: number | null;
  asignadoA2Id: number | null;
  _count: { conteos: number };
}): HojaParaAsistencia {
  return {
    asignadoAId: fila.asignadoAId,
    asignadoA2Id: fila.asignadoA2Id,
    tieneConteos: fila._count.conteos > 0,
  };
}
