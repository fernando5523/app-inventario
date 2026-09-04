import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as service from './auditoria.service';
import type { ListarAuditablesQuery, MatrizQuery, ParametrosInventario } from './auditoria.schema';

/**
 * Traduce req/res y nada mas -- ni Prisma ni logica de negocio (regla de
 * capas, backend/README.md). `req.colaborador!` sale de auth.middleware.ts:
 * requiereSesion ya corrio y garantiza que esta.
 */

export const listarAuditables = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  res.json(await service.listarAuditables(req.colaborador!, req.query as unknown as ListarAuditablesQuery));
});

export const matriz = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId } = req.params as unknown as ParametrosInventario;
  res.json(await service.matriz(req.colaborador!, inventarioId, req.query as unknown as MatrizQuery));
});

export const resumen = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId } = req.params as unknown as ParametrosInventario;
  res.json(await service.resumen(req.colaborador!, inventarioId));
});
