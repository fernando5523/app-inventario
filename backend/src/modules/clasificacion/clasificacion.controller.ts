import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as service from './clasificacion.service';
import type { BuscarQuery, ClasificarInput, ParametrosCodigo } from './clasificacion.schema';

/** req.colaborador siempre existe aca: requiereSesion corre antes en la ruta. */
function actorDe(req: RequestAutenticado) {
  return req.colaborador!;
}

export const buscar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const query = req.query as unknown as BuscarQuery;
  res.json(await service.buscar(actorDe(req), query));
});

export const clasificar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { codigo } = req.params as unknown as ParametrosCodigo;
  const input = req.body as ClasificarInput;
  res.json(await service.clasificar(actorDe(req), codigo, input));
});

export const desclasificar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { codigo } = req.params as unknown as ParametrosCodigo;
  await service.desclasificar(actorDe(req), codigo);
  res.status(204).send();
});
