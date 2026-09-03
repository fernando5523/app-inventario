import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as service from './usuarios.service';
import type {
  ActualizarEstadoInput,
  CrearUsuarioInput,
  ListarUsuariosQuery,
  ParametrosUsuario,
  ResetearPinInput,
} from './usuarios.schema';

/** req.colaborador siempre existe aca: requiereSesion corre antes en la ruta. */
function actorDe(req: RequestAutenticado) {
  return req.colaborador!;
}

export const listar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { sucursalId } = req.query as unknown as ListarUsuariosQuery;
  res.json(await service.listar(actorDe(req), sucursalId));
});

export const crear = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const input = req.body as CrearUsuarioInput;
  res.status(201).json(await service.crear(actorDe(req), input));
});

export const actualizarEstado = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { id } = req.params as unknown as ParametrosUsuario;
  const { activo } = req.body as ActualizarEstadoInput;
  res.json(await service.actualizarEstado(actorDe(req), id, activo));
});

export const resetearPin = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { id } = req.params as unknown as ParametrosUsuario;
  const { pin } = req.body as ResetearPinInput;
  await service.resetearPin(actorDe(req), id, pin);
  res.status(204).send();
});
