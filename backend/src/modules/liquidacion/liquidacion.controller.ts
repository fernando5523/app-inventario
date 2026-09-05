import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as cierre from './liquidacion.cierre';
import * as service from './liquidacion.service';
import type { ParametrosInventario, ParametrosSucursal } from './liquidacion.schema';

/**
 * Traduce req/res y nada mas (regla de capas, backend/README.md).
 *
 * `null` viaja como 200 con body `null`, NO como 404: el puerto del front
 * declara `Promise<Liquidacion | null>` y "esta tienda todavia no cerro
 * ningun ciclo" es una respuesta valida, no un error. Un 404 obligaria a la
 * pantalla a tratar un estado normal como una falla.
 */
export const deSucursal = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { sucursalId } = req.params as unknown as ParametrosSucursal;
  res.json(await service.deSucursal(req.colaborador!, sucursalId));
});

export const conciliacion = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { sucursalId } = req.params as unknown as ParametrosSucursal;
  res.json(await service.conciliacion(req.colaborador!, sucursalId));
});

/**
 * 201, no 200: cerrar la planilla CREA las filas de LiquidacionColaborador,
 * que es el documento que despues se firma. Mismo criterio que
 * POST /aprobaciones y POST /lacrado en historial.routes.ts.
 *
 * Quien liquida sale del TOKEN, nunca del body -- igual que quien aprueba el
 * lacrado (historial.permisos.ts#validarPuedeAprobar). Por eso el endpoint no
 * tiene body validado: no hay nada que el cliente pueda mandar que cambie
 * quien cerro la planilla.
 */
export const liquidar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId } = req.params as unknown as ParametrosInventario;
  res.status(201).json(await cierre.liquidar(req.colaborador!, inventarioId));
});
