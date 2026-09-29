import type { Response } from 'express';

import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import type { ParametrosStockRonda } from './d365.schema';
import * as servicio from './d365.stock-ronda.service';

/**
 * Baja el stock de HOY de los items que arrastra ese reconteo. Ver la cabecera
 * de `d365.stock-ronda.service.ts` para el por que del cambio y los tiempos
 * medidos.
 */
export const bajarStockDeRonda = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId, numeroConteo } = req.params as unknown as ParametrosStockRonda;
  res.json(await servicio.bajarStockDeLaRonda(req.colaborador!, inventarioId, numeroConteo));
});

/**
 * Progreso de la descarga EN CURSO. Se sondea MIENTRAS el POST sigue abierto,
 * asi que -- igual que `GET /api/d365/snapshot/progreso` -- no puede compartir
 * su timeout: es una lectura de un Map en memoria, no toca Dynamics ni la base.
 *
 * `200` con `null` cuando no hay ninguna corriendo, nunca `404`.
 */
export const progresoStockDeRonda = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId, numeroConteo } = req.params as unknown as ParametrosStockRonda;
  res.json(servicio.progresoDeLaDescarga(inventarioId, numeroConteo));
});
