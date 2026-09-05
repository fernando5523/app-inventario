import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import { d365AuthService } from './d365-auth.service';
import * as catalogoService from './d365-catalogo.service';
import type { CrearSnapshotInput, ProgresoSnapshotQuery } from './d365.schema';

export const estado = asyncHandler(async (_req: RequestAutenticado, res: Response) => {
  res.json({ configurado: await d365AuthService.isConfigured() });
});

export const snapshot = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { sucursalId, modo, tipo, almacen } = req.body as CrearSnapshotInput;
  res.json(await catalogoService.crearSnapshot(sucursalId, modo, tipo, almacen, req.colaborador!.colaboradorId));
});

/**
 * Progreso del snapshot EN CURSO de esa sucursal.
 *
 * Responde `200` con `null` -- no `404` -- cuando no hay ninguno corriendo:
 * "todavia no arranco" o "ya termino" son respuestas validas del sondeo, no
 * errores, y un 404 obligaria al front a tratar el caso normal como falla
 * (mismo criterio que `GET /api/liquidacion/sucursales/:id`).
 *
 * Se sondea MIENTRAS el POST del snapshot sigue abierto, asi que no puede
 * compartir su rate limit ni su timeout: es una lectura de un Map en
 * memoria, no toca Dynamics ni la base.
 */
export const progresoSnapshot = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { sucursalId } = req.query as unknown as ProgresoSnapshotQuery;
  res.json(catalogoService.progresoDeSnapshot(sucursalId));
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
