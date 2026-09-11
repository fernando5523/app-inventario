/**
 * REPORTE A GERENCIA: por inventario, los productos de EMPRESA (la
 * clasificacion efectiva al momento de liquidar, ver
 * liquidacion.reclasificacion.ts) con sus sobrantes y faltantes DETALLADOS
 * por item, separados. Es el pedido explicito del cliente: gerencia decide
 * caso por caso sobre lo que absorbe la empresa, y para eso necesita el
 * detalle -- no el monto agregado que ya muestra la Pantalla 6.
 *
 * SOLO AUDITOR (`liquidacion.permisos.ts#validarAcceso`, reusada tal cual).
 *
 * REQUIERE que el inventario este `liquidado` o `lacrado`. Antes de eso,
 * `DiferenciaItem.esEmpresa` es el default `false` que escribe el cierre del
 * conteo -- NO la clasificacion efectiva, que recien se congela al liquidar
 * (liquidacion.reclasificacion.ts#reclasificarAlLiquidar). Mostrar el reporte
 * antes reportaria "cero productos de empresa" aunque los hubiera, y un
 * reporte que puede mentir por omision es peor que uno que todavia no esta
 * disponible.
 */

import { prisma } from '../../config/database';
import { redondear } from '../historial/historial.calculos';
import { Conflicto, NoEncontrado } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { validarAcceso } from './liquidacion.permisos';

export interface FilaReporteGerencia {
  codigo: string;
  descripcion: string;
  /** Positivo siempre: unidades, sin signo -- el signo ya lo dice la lista en la que aparece. */
  unidades: number;
  /** null = el snapshot no trajo precio para este item: la unidad es un hecho, el monto no. */
  monto: number | null;
}

export interface ReporteGerenciaDto {
  inventarioId: number;
  estado: string;
  /** Faltantes de productos de empresa -- lo que la empresa absorbe, detallado. */
  faltantes: FilaReporteGerencia[];
  /** Sobrantes de productos de empresa -- no compensan al empleado (esos son de items NO empresa). */
  sobrantes: FilaReporteGerencia[];
  totalFaltante: number;
  totalSobrante: number;
}

const ESTADOS_CON_CLASIFICACION_CONGELADA = new Set(['liquidado', 'lacrado']);

export async function obtenerReporteGerencia(
  actor: ColaboradorAutenticado,
  inventarioId: number,
): Promise<ReporteGerenciaDto> {
  validarAcceso(actor);

  const inventario = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    select: { id: true, estado: true },
  });
  if (inventario === null) throw new NoEncontrado('Ese inventario no existe.');

  if (!ESTADOS_CON_CLASIFICACION_CONGELADA.has(inventario.estado)) {
    throw new Conflicto(
      'Este inventario todavia no se liquido: la clasificación empresa/empleado recién queda congelada al liquidar. ' +
        'El reporte a gerencia se puede ver una vez que la planilla se cierre.',
    );
  }

  const filas = await prisma.diferenciaItem.findMany({
    where: { inventarioId, esEmpresa: true },
    select: { codigo: true, descripcion: true, diferencia: true, montoDiferencia: true },
    orderBy: { codigo: 'asc' },
  });

  const faltantes: FilaReporteGerencia[] = [];
  const sobrantes: FilaReporteGerencia[] = [];
  let totalFaltante = 0;
  let totalSobrante = 0;

  for (const f of filas) {
    const monto = f.montoDiferencia === null ? null : f.montoDiferencia.toNumber();
    if (f.diferencia < 0) {
      faltantes.push({ codigo: f.codigo, descripcion: f.descripcion, unidades: -f.diferencia, monto: monto === null ? null : -monto });
      if (monto !== null) totalFaltante += -monto;
    } else if (f.diferencia > 0) {
      sobrantes.push({ codigo: f.codigo, descripcion: f.descripcion, unidades: f.diferencia, monto });
      if (monto !== null) totalSobrante += monto;
    }
    // diferencia === 0 no puede pasar: DiferenciaItem solo guarda items con
    // diferencia real (ver auditoria.calculos.ts#diferenciasParaPersistir).
  }

  return {
    inventarioId,
    estado: inventario.estado,
    faltantes,
    sobrantes,
    totalFaltante: redondear(totalFaltante),
    totalSobrante: redondear(totalSobrante),
  };
}
