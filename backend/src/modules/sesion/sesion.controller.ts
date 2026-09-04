import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as service from './sesion.service';
import type { CambiarPinInput, IngresarInput, ParametrosSucursal } from './sesion.schema';

export const sucursales = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await service.listarSucursales());
});

export const colaboradores = asyncHandler(async (req: Request, res: Response) => {
  const { sucursalId } = req.params as unknown as ParametrosSucursal;
  res.json(await service.listarColaboradores(sucursalId));
});

export const administradores = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await service.listarAdministradores());
});

export const ingresar = asyncHandler(async (req: Request, res: Response) => {
  const { colaboradorId, pin } = req.body as IngresarInput;
  res.json(await service.ingresar(colaboradorId, pin));
});

/**
 * Cambia el PIN de quien esta en sesion. El colaboradorId sale del token,
 * NUNCA del body -- misma regla que gobierna la aprobacion del lacrado:
 * lo que manda el cliente no define quien es.
 */
export const cambiarPin = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { pinActual, pinNuevo } = req.body as CambiarPinInput;
  await service.cambiarPinPropio(req.colaborador!.colaboradorId, pinActual, pinNuevo);
  res.status(204).end();
});
