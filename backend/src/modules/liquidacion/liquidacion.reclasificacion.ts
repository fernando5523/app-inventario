/**
 * RECLASIFICACION AL LIQUIDAR (liquidacion v2).
 *
 * Decision del cliente, correccion sobre el diseno original: la
 * clasificacion empresa/empleado de un item se evalua AL LIQUIDAR, no al
 * abrir ni al cerrar el conteo. Motivo textual: la liquidacion la hace el
 * Auditor, y si reclasifica un producto (ej. "las cervezas ahora son
 * empresa") DESPUES de que el conteo ya cerro, tiene que aplicarse igual --
 * lo que el Auditor ve en pantalla al liquidar es lo que se liquida, y el
 * lacrado lo sella tal cual quedo en ese momento.
 *
 * Por eso ESTE archivo, y no `rondas.service.ts#cerrar` (que sigue sin
 * tocarse), es quien decide `DiferenciaItem.esEmpresa` de verdad. Lo que
 * escribe el cierre del conteo (el default `false` de la columna) es
 * PROVISORIO: se pisa aca, una sola vez, en el mismo momento en que se
 * congela el resto de la planilla.
 *
 * ---------------------------------------------------------------------------
 * DOS FUNCIONES QUE NO SE MUEVEN DOS VECES A LA VEZ EL MISMO MONTO
 * ---------------------------------------------------------------------------
 * `ResultadoInventario.montoFaltanteBruto` (congelado al cerrar el conteo, en
 * rondas.service.ts) YA INCLUYE el faltante de productos de empresa -- es
 * `resumirAuditoria(...).valorFaltante`, la suma de TODOS los faltantes, sin
 * filtrar por `esEmpresa`. La formula de `historial.calculos.ts` resta
 * `montoFaltanteEmpresa` UNA sola vez para sacarlo de ahi:
 *
 *   montoFaltanteNeto = bruto - negativos - empresa - sobranteEmpleado
 *
 * Si `montoFaltanteEmpresa` (el que devuelve `reclasificarAlLiquidar` de
 * aca) se calculara EXCLUYENDO empresa del bruto en vez de like un monto
 * APARTE que se resta, la empresa se descontaria dos veces. Por eso esta
 * funcion devuelve el faltante de empresa como un monto en positivo, para
 * restar, y nunca toca `montoFaltanteBruto`.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { redondear } from '../historial/historial.calculos';

// ---------------------------------------------------------------------------
// PURO -- sin Prisma, testeable sin base (ver liquidacion.reclasificacion.test.ts)
// ---------------------------------------------------------------------------

/**
 * Una fila de `DiferenciaItem`, con la clasificacion que tenia su
 * `CatalogoItem` (la de Dynamics de ESE inventario, sin la excepcion del
 * Auditor todavia aplicada).
 */
export interface FilaDiferenciaParaReclasificar {
  codigo: string;
  /** conteoFinal - stockSistema. Negativo = faltante, positivo = sobrante. */
  diferencia: number;
  /** null = el item no tenia precio: no se puede valorizar, pero SI se clasifica. */
  montoDiferencia: number | null;
  /** `CatalogoItem.esEmpresa` (Dynamics), congelado en el snapshot de este inventario. */
  esEmpresaCatalogo: boolean;
}

export interface ResultadoReclasificacion {
  /**
   * codigo -> clasificacion efectiva. Es lo que hay que escribir en
   * `DiferenciaItem.esEmpresa` para CADA fila (incluidas las que no
   * valorizaron: la clasificacion no depende del precio).
   */
  esEmpresaPorCodigo: Map<string, boolean>;
  /** Faltante de productos de empresa, en positivo -- para restar en la formula. */
  montoFaltanteEmpresa: number;
  /** Sobrante de productos NO empresa, a favor del empleado -- para restar en la formula. */
  montoSobranteEmpleado: number;
}

/**
 * La excepcion del Auditor manda; si no hay excepcion para ese codigo, manda
 * Dynamics. Es la MISMA regla que documenta `CatalogoItem.esEmpresaManual`
 * en el schema, aplicada aca contra la clasificacion VIGENTE (no la
 * congelada), porque se evalua al liquidar.
 */
export function esEmpresaEfectivo(
  codigo: string,
  esEmpresaCatalogo: boolean,
  clasificacionManualPorCodigo: ReadonlyMap<string, boolean>,
): boolean {
  return clasificacionManualPorCodigo.get(codigo) ?? esEmpresaCatalogo;
}

/**
 * El calculo central de esta funcionalidad: recorre las diferencias
 * CONGELADAS del cierre (nunca vuelve a consultar Dynamics ni a recontar
 * nada) y aplica la clasificacion vigente HOY para decidir, por item, si su
 * faltante lo absorbe la empresa o si su sobrante compensa al empleado.
 */
export function reclasificarAlLiquidar(
  filas: readonly FilaDiferenciaParaReclasificar[],
  clasificacionManualPorCodigo: ReadonlyMap<string, boolean>,
): ResultadoReclasificacion {
  const esEmpresaPorCodigo = new Map<string, boolean>();
  let montoFaltanteEmpresa = 0;
  let montoSobranteEmpleado = 0;

  for (const fila of filas) {
    const esEmpresa = esEmpresaEfectivo(fila.codigo, fila.esEmpresaCatalogo, clasificacionManualPorCodigo);
    esEmpresaPorCodigo.set(fila.codigo, esEmpresa);

    if (fila.montoDiferencia === null || fila.diferencia === 0) continue;

    if (fila.diferencia < 0) {
      // Faltante: `montoDiferencia` ya viene negativo (ver
      // auditoria.calculos.ts#diferenciaValor); se acumula en positivo, como
      // el resto de los montos de la formula.
      if (esEmpresa) montoFaltanteEmpresa += -fila.montoDiferencia;
    } else {
      // Sobrante: `montoDiferencia` ya viene positivo.
      if (!esEmpresa) montoSobranteEmpleado += fila.montoDiferencia;
    }
  }

  return {
    esEmpresaPorCodigo,
    montoFaltanteEmpresa: redondear(montoFaltanteEmpresa),
    montoSobranteEmpleado: redondear(montoSobranteEmpleado),
  };
}

// ---------------------------------------------------------------------------
// IMPURO -- Prisma. Punto de enganche para liquidacion.cierre.ts#liquidar
// (ver el comentario de cabecera de ese archivo y el reporte de esta tarea:
// NO SE TOCA liquidacion.cierre.ts desde aca, min-5 lo cablea).
// ---------------------------------------------------------------------------

/**
 * Las diferencias congeladas de un inventario, con la clasificacion que
 * tenia su `CatalogoItem` en ESE snapshot (join por `codigo`, mismo
 * inventario -- nunca el catalogo de HOY, que puede ser de otro mes).
 */
export async function datosParaReclasificar(inventarioId: number): Promise<FilaDiferenciaParaReclasificar[]> {
  const [diferencias, catalogo] = await Promise.all([
    prisma.diferenciaItem.findMany({
      where: { inventarioId },
      select: { codigo: true, diferencia: true, montoDiferencia: true },
    }),
    prisma.catalogoItem.findMany({
      where: { inventarioId },
      select: { codigo: true, esEmpresa: true },
    }),
  ]);

  const esEmpresaCatalogoPorCodigo = new Map(catalogo.map((c) => [c.codigo, c.esEmpresa]));

  return diferencias.map((d) => ({
    codigo: d.codigo,
    diferencia: d.diferencia,
    montoDiferencia: d.montoDiferencia === null ? null : d.montoDiferencia.toNumber(),
    // Sin fila de catalogo para ese codigo no deberia pasar (la diferencia
    // sale del mismo snapshot), pero `false` (nunca empresa) es el default
    // seguro si pasara: no le regala a nadie una exclusion que Dynamics no dio.
    esEmpresaCatalogo: esEmpresaCatalogoPorCodigo.get(d.codigo) ?? false,
  }));
}

/** La excepcion VIGENTE del Auditor, por codigo -- ver ClasificacionProducto en el schema. */
export async function clasificacionManualVigente(): Promise<Map<string, boolean>> {
  const filas = await prisma.clasificacionProducto.findMany({ select: { codigo: true, esEmpresa: true } });
  return new Map(filas.map((f) => [f.codigo, f.esEmpresa]));
}

/**
 * Las operaciones de escritura de `DiferenciaItem.esEmpresa`, UNA por
 * codigo, listas para entrar al `$transaction` de `liquidar()` junto con el
 * resto (la planilla y el cambio de estado) -- ver el comentario de
 * `liquidacion.cierre.ts#liquidar` sobre por que planilla y estado van
 * juntos o ninguno. No ejecuta nada: devuelve la lista para que quien
 * arma la transaccion la agregue a su propio array.
 */
export function operacionesDeEscrituraClasificacion(
  inventarioId: number,
  esEmpresaPorCodigo: ReadonlyMap<string, boolean>,
): Prisma.PrismaPromise<Prisma.BatchPayload>[] {
  return [...esEmpresaPorCodigo.entries()].map(([codigo, esEmpresa]) =>
    prisma.diferenciaItem.updateMany({ where: { inventarioId, codigo }, data: { esEmpresa } }),
  );
}
