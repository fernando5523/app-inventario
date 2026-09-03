import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as service from './liquidacion.service';
import type { ParametrosSucursal } from './liquidacion.schema';

/**
 * Traduce req/res y nada mas (regla de capas, backend/README.md).
 *
 * `null` viaja como 200 con body `null`, NO como 404: el puerto del front
 * declara `Promise<Liquidacion | null>` y "esta tienda todavia no cerro
 * ningun ciclo" es una respuesta valida, no un error. Un 404 obligaria a la
 * pantalla a tratar un estado normal como una falla.
 */
export const deSucursal = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { sucursalId } = req.params as unknown as ParametrosSucursal;
  res.json(await service.deSucursal(req.colaborador!, sucursalId));
});

export const conciliacion = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { sucursalId } = req.params as unknown as ParametrosSucursal;
  res.json(await service.conciliacion(req.colaborador!, sucursalId));
});
