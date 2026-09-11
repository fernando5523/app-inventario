/**
 * Los ajustes del mes en la Liquidación del Auditor: qué dice la pantalla
 * sobre ellos. El nombre del archivo es histórico -- ya NO hay formulario:
 *
 *  - Los ajustes a favor del personal (`montoNegativos`) entran por el Excel
 *    de Dynamics que importa el Auditor (backend e39b370, pantalla
 *    app/auditor/ajustes-negativos.tsx). Un monto escrito a mano se ignoraba.
 *  - El faltante de empresa lo calcula la clasificación de productos al
 *    liquidar (backend 48899bc).
 *  - La nota de PUT /ajustes se quedó sin nada que documentar (ver
 *    app/auditor/liquidacion.tsx#TarjetaAjustesDelMes), así que tampoco hay
 *    campo para ella.
 *
 * La regla que sigue gobernando todo: `montoNegativos: null` significa "nadie
 * importó el Excel" y bloquea la liquidación; un `0` significa "se importó y
 * no había" y la destraba. Son dos carteles distintos, nunca el mismo.
 */

export interface EstadoAjustesNegativos {
  texto: string;
  bloqueaLiquidacion: boolean;
  /** La etiqueta del botón que lleva a la pantalla del Excel. */
  boton: string;
}

export function estadoAjustesNegativos(montoNegativos: number | null, soles: (n: number) => string): EstadoAjustesNegativos {
  if (montoNegativos === null) {
    return {
      texto: 'Todavía no se importó el Excel de ajustes (bloquea liquidar)',
      bloqueaLiquidacion: true,
      boton: 'Importar el Excel de ajustes',
    };
  }
  return { texto: `Importado: ${soles(montoNegativos)}`, bloqueaLiquidacion: false, boton: 'Ver el Excel importado' };
}

/**
 * La aclaración pegada al faltante de empresa en el resumen. Ese monto YA NO
 * SE TIPEA: lo calcula la clasificación de productos, y el definitivo es el
 * que queda al liquidar. Mostrarlo sin decir de dónde sale invitaría a buscar
 * dónde corregirlo.
 */
export function notaFaltanteEmpresa(proyectada: boolean): string {
  return proyectada
    ? 'Lo calcula la clasificación de productos; el monto definitivo queda fijo al liquidar.'
    : 'Lo calculó la clasificación de productos al liquidar.';
}
