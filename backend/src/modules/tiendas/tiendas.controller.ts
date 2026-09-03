import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as service from './tiendas.service';
import type { ActualizarTiendaInput, CrearTiendaInput, ParametrosTienda } from './tiendas.schema';

export const listar = asyncHandler(async (_req: RequestAutenticado, res: Response) => {
  res.json(await service.listar());
});

export const crear = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const input = req.body as CrearTiendaInput;
  res.status(201).json(await service.crear(req.colaborador!, input));
});

export const actualizar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { id } = req.params as unknown as ParametrosTienda;
  const input = req.body as ActualizarTiendaInput;
  res.json(await service.actualizar(req.colaborador!, id, input));
});
