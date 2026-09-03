import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as service from './config-dynamics.service';
import type { GuardarConfigDynamicsInput } from './config-dynamics.schema';

/**
 * Traduce req/res y nada mas (regla de capas, backend/README.md).
 *
 * Ninguno de estos handlers toca el `clientSecret`: entra por el body, va
 * derecho al service y no vuelve en ninguna respuesta. Ni siquiera se lo
 * loguea -- ver el comentario de cabecera del service.
 */

export const obtener = asyncHandler(async (_req: RequestAutenticado, res: Response) => {
  res.json(await service.obtener());
});

export const guardar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  res.json(await service.guardar(req.colaborador!, req.body as GuardarConfigDynamicsInput));
});

export const probarConexion = asyncHandler(async (_req: RequestAutenticado, res: Response) => {
  // Siempre 200: un `ok: false` por credenciales rechazadas es el resultado
  // de la prueba, no un fallo del endpoint. La pantalla lo muestra sin catch.
  res.json(await service.probarConexion());
});
