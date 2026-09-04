import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import { d365AuthService } from './d365-auth.service';
import * as catalogoService from './d365-catalogo.service';
import type { CrearSnapshotInput } from './d365.schema';

export const estado = asyncHandler(async (_req: RequestAutenticado, res: Response) => {
  res.json({ configurado: await d365AuthService.isConfigured() });
});

export const snapshot = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { sucursalId, modo, tipo, almacen } = req.body as CrearSnapshotInput;
  res.json(await catalogoService.crearSnapshot(sucursalId, modo, tipo, almacen, req.colaborador!.colaboradorId));
});

/**
 * Lista de almacenes de Dynamics. Solo Administrador: es dato de
 * configuracion del sistema, igual que /api/tiendas.
 */
export const almacenes = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  // `?todos=1` para el alta de una tienda cuyo almacen todavia no esta
  // habilitado. Por defecto SIEMPRE filtrado: el caso raro se pide explicito.
  const todos = req.query.todos === '1' || req.query.todos === 'true';
  res.json(await catalogoService.listarAlmacenes({ todos }));
});
