import type { Response } from 'express';

import { NoEncontrado } from '../../shared/errores';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAprobador } from './consumo-interno.auth';
import { emitirTokenDev, ingresoDevHabilitado } from './consumo-interno.dev';
import type { DecisionInput, HistorialInput, ParametrosLinea, ParametrosSolicitud } from './consumo-interno.schema';
import * as service from './consumo-interno.service';

/**
 * Ingreso de desarrollo (ver consumo-interno.dev.ts). Con el candado cerrado
 * responde 404 -- como si la ruta no existiera -- para no anunciar que hay
 * una puerta.
 */
export const sesionDev = asyncHandler(async (_req: RequestAprobador, res: Response) => {
  if (!ingresoDevHabilitado()) throw new NoEncontrado('No existe la ruta.');
  const { token, identidad, venceEn } = emitirTokenDev();
  res.json({ token, aprobador: { ...identidad, origen: 'desarrollo' }, venceEn });
});

export const yo = asyncHandler(async (req: RequestAprobador, res: Response) => {
  res.json({ aprobador: req.aprobador });
});

export const pendientes = asyncHandler(async (_req: RequestAprobador, res: Response) => {
  res.json(await service.listarPendientes());
});

export const historial = asyncHandler(async (req: RequestAprobador, res: Response) => {
  const filtros = req.query as unknown as HistorialInput;
  res.json({ solicitudes: await service.listarHistorial(filtros) });
});

export const detalle = asyncHandler(async (req: RequestAprobador, res: Response) => {
  const { id } = req.params as unknown as ParametrosSolicitud;
  res.json(await service.obtener(id));
});

export const decidirLinea = asyncHandler(async (req: RequestAprobador, res: Response) => {
  const { id, linea } = req.params as unknown as ParametrosLinea;
  const decision = req.body as DecisionInput;
  res.json(await service.decidirLinea(id, linea, decision, req.aprobador!));
});

export const decidirPendientes = asyncHandler(async (req: RequestAprobador, res: Response) => {
  const { id } = req.params as unknown as ParametrosSolicitud;
  const decision = req.body as DecisionInput;
  res.json(await service.decidirPendientes(id, decision, req.aprobador!));
});
