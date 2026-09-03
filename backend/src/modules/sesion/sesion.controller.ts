import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import * as service from './sesion.service';
import type { IngresarInput, ParametrosSucursal } from './sesion.schema';

export const sucursales = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await service.listarSucursales());
});

export const colaboradores = asyncHandler(async (req: Request, res: Response) => {
  const { sucursalId } = req.params as unknown as ParametrosSucursal;
  res.json(await service.listarColaboradores(sucursalId));
});

export const ingresar = asyncHandler(async (req: Request, res: Response) => {
  const { colaboradorId, pin } = req.body as IngresarInput;
  res.json(await service.ingresar(colaboradorId, pin));
});
