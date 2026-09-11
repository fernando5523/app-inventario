import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import { obtenerReporteGerencia } from './liquidacion.reporte-gerencia';
import type { ParametrosInventario } from './liquidacion.schema';

export const reporteGerencia = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId } = req.params as unknown as ParametrosInventario;
  res.json(await obtenerReporteGerencia(req.colaborador!, inventarioId));
});
