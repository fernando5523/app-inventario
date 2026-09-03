import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as service from './config.service';
import type { ActualizarConfigInput, ParametrosConfig } from './config.schema';

export const listar = asyncHandler(async (_req: RequestAutenticado, res: Response) => {
  res.json(await service.listar());
});

export const actualizar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { clave } = req.params as unknown as ParametrosConfig;
  const { valor } = req.body as ActualizarConfigInput;
  res.json(await service.actualizar(req.colaborador!, clave, valor));
});
