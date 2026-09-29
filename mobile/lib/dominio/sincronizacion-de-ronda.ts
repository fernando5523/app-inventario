/**
 * ---------------------------------------------------------------------------
 * CADA RONDA TRAE SU PROPIO STOCK, ASÍ QUE EL PASO 1 VUELVE
 * ---------------------------------------------------------------------------
 * Confirmado con el cliente (Gilmer) el 2026-09-29: **cada reconteo trae el
 * stock nuevo del ERP, y solo para los productos faltantes y sobrantes que
 * arrastra esa ronda**. El primer conteo se hace el 22 y los reconteos los días
 * siguientes; entre uno y otro el stock real se movió -- ventas, transferencias
 * y los ajustes que hoy se parchan a mano.
 *
 * Hasta este cambio, la pantalla de armado daba el paso 1 por hecho para
 * siempre en cuanto existía el inventario (`paso1Hecho = inventarioId !== null`).
 * Eso era correcto mientras el stock se bajaba una sola vez. Ahora, abrir un
 * reconteo NO es solo armar las hojas: primero hay que sincronizar, igual que
 * cuando se arma el primer conteo.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ES UNA FUNCIÓN Y NO UN `if` EN LA PANTALLA
 * ---------------------------------------------------------------------------
 * De esto depende que se pueda o no crear las hojas de una ronda, y el error
 * caro no es que la pantalla se vea mal: es dejar armar un reconteo contra el
 * stock del día anterior sin que nadie se entere. Acá tiene tests; adentro del
 * JSX no los tendría.
 *
 * ---------------------------------------------------------------------------
 * LA RONDA 1 NO ES UN CASO ESPECIAL, ES OTRO ALCANCE
 * ---------------------------------------------------------------------------
 * Las dos rondas sincronizan; lo que cambia es CUÁNTO traen. La ronda 1 baja el
 * catálogo entero del almacén (los ~11.863 ítems del ERP); un reconteo baja
 * solo lo que arrastra -- decenas o cientos. Por eso `alcance` viaja aparte de
 * `hecho`: la pantalla dice cosas distintas y el botón llama a endpoints
 * distintos, pero el paso es el mismo paso y se numera igual.
 */

/** Qué universo baja esta sincronización. */
export type AlcanceSincronizacion = 'catalogo' | 'arrastre';

export interface EstadoSincronizacion {
  /** ¿La ronda que se está armando ya tiene su stock del día? */
  hecho: boolean;
  alcance: AlcanceSincronizacion;
  /** El título del paso 1, que cambia con el alcance. */
  titulo: string;
  /**
   * Qué decirle a quien mira el paso. Nunca un texto genérico: "todavía no
   * bajaste el catálogo" y "esta ronda todavía no tiene el stock de hoy" se
   * destraban igual pero significan cosas distintas, y el Coordinador tiene
   * que saber en cuál está.
   */
  texto: string;
}

export interface DatosDeSincronizacion {
  /**
   * La ronda que se está armando. `null` = todavía no hay ninguna, o sea que
   * se está preparando el inventario (ver `RepositorioInventario.activo`).
   */
  ronda: number | null;
  /** `null` = el inventario todavía no existe: nunca se tomó el catálogo. */
  inventarioId: number | null;
  /** Cuántos ítems bajó la sincronización de ESTA ronda. `null` = no bajó. */
  items: number | null;
  /**
   * Cuándo se bajó el stock de ESTA ronda. `null` = todavía no.
   *
   * `null` significa "esta ronda no sincronizó", NUNCA "bajó 0 ítems": una
   * ronda que arrastró cero productos y sincronizó igual trae `0` con su fecha,
   * y tiene que contar como hecha. Si no, la pantalla se traba pidiendo una
   * descarga que ya ocurrió.
   */
  tomadoEn: string | null;
}

/**
 * ¿Está hecho el paso 1 para la ronda que se está armando, y qué se dice?
 *
 * `formatoFechaHora` y `formatoMiles` vienen inyectados, como en
 * `avance-snapshot.ts`: el dominio no formatea números ni fechas -- los datos
 * de es-PE no están garantizados en Hermes.
 */
export function sincronizacionDeRonda(
  datos: DatosDeSincronizacion,
  formatoMiles: (n: number) => string,
  formatoFechaHora: (iso: string) => string,
): EstadoSincronizacion {
  const esReconteo = datos.ronda !== null && datos.ronda > 1;
  const alcance: AlcanceSincronizacion = esReconteo ? 'arrastre' : 'catalogo';

  if (esReconteo) {
    // EL INVENTARIO YA EXISTE, pero eso no dice nada sobre esta ronda. La
    // única prueba de que la ronda tiene su vara es su propia descarga.
    const hecho = datos.tomadoEn !== null;
    return {
      hecho,
      alcance,
      titulo: `Stock de hoy para la ronda ${datos.ronda}`,
      texto: hecho
        ? `${formatoMiles(datos.items ?? 0)} ${plural(datos.items ?? 0, 'ítem', 'ítems')} con stock actualizado · ${formatoFechaHora(datos.tomadoEn!)}. La ronda ${datos.ronda} se compara contra este stock, no contra el del primer conteo.`
        : `Trae de Dynamics el stock de hoy de los productos que quedaron faltantes y sobrantes. Sin esto, el reconteo se compararía contra el stock del primer conteo, y entre un día y otro hubo ventas y movimientos.`,
    };
  }

  // Ronda 1 (o todavía sin ronda): el paso de siempre, el catálogo entero.
  // `inventarioId` y no `tomadoEn` decide, y es a propósito: sin red hay
  // inventario local pero todavía no llegaron `items`/`tomadoEn`, y ahí el
  // botón tiene que seguir mandando a crear hojas y no a traer el catálogo de
  // nuevo. Es el mismo desempate que ya hacía `paso1Confirmado`.
  const hecho = datos.inventarioId !== null;
  return {
    hecho,
    alcance,
    titulo: 'Catálogo de Dynamics',
    texto:
      hecho && datos.items !== null && datos.tomadoEn !== null
        ? `${formatoMiles(datos.items)} ${plural(datos.items, 'ítem', 'ítems')} traídos de Dynamics · ${formatoFechaHora(datos.tomadoEn)}. Es una lectura del catálogo — no escribe ni ajusta nada en Dynamics.`
        : 'Trae de Dynamics los productos con stock en el almacén de esta sucursal: es la foto contra la que se compara el primer conteo. Es una lectura — no escribe ni ajusta nada en Dynamics.',
  };
}

/**
 * ¿Se puede confirmar el paso con un check verde?
 *
 * Separado de `hecho` por la misma razón de honestidad que ya tenía la
 * pantalla (bug de 2026-09-10): no se pinta "Hecho" sin poder mostrar CON QUÉ
 * datos -- cuántos ítems y en qué instante -- se respalda esa afirmación.
 */
export function sincronizacionConfirmada(estado: EstadoSincronizacion, datos: DatosDeSincronizacion): boolean {
  return estado.hecho && datos.items !== null && datos.tomadoEn !== null;
}

function plural(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}
