import type { Response } from 'express';

import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as service from './inventarios.service';
import type { AsignarHojasInput, CrearHojasInput, ParametrosInventario, ParametrosSucursal } from './inventarios.schema';

/** req.colaborador siempre existe aca: requiereSesion corre antes en la ruta. */
function actorDe(req: RequestAutenticado) {
  return req.colaborador!;
}

/**
 * `null` con 200, no 404: "esta sucursal todavia no tiene inventario en
 * curso" es una respuesta valida y esperada -- es el estado normal del dia 1
 * del mes. Un 404 obligaria a la pantalla a tratar como error algo que no lo
 * es, y a distinguirlo de un 404 de verdad (sucursal inexistente).
 */
export const activo = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { sucursalId } = req.params as unknown as ParametrosSucursal;
  res.json(await service.activo(sucursalId));
});

export const crearHojas = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId } = req.params as unknown as ParametrosInventario;
  const { tamano } = req.body as CrearHojasInput;
  // 201: se crearon recursos nuevos (las hojas), no se actualizo uno.
  res.status(201).json(await service.crearHojas(actorDe(req), inventarioId, tamano));
});

export const asignarHojas = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId } = req.params as unknown as ParametrosInventario;
  const { colaboradorIds } = req.body as AsignarHojasInput;
  // 200 y no 201: las hojas ya existian, lo que cambio es a quien pertenecen.
  res.json(await service.asignarHojas(actorDe(req), inventarioId, colaboradorIds));
});
