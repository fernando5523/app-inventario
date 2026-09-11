import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import { obtenerReporteGerencia } from './liquidacion.reporte-gerencia';
import * as exportacion from './liquidacion.reporte-gerencia.exportar';
import type { ParametrosInventario } from './liquidacion.schema';

export const reporteGerencia = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId } = req.params as unknown as ParametrosInventario;
  res.json(await obtenerReporteGerencia(req.colaborador!, inventarioId));
});

/** El .xlsx del reporte -- mismos headers que historial.controller.ts#exportarDiferencias. */
export const exportarReporteGerencia = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId } = req.params as unknown as ParametrosInventario;
  const { buffer, nombreArchivo } = await exportacion.exportarReporteGerencia(req.colaborador!, inventarioId);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  res.send(buffer);
});
