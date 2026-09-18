import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as service from './asistencia.service';
import type {
  BorrarMarcaQuery,
  MarcarAsistenciaInput,
  ParametrosInventario,
  ParametrosMarca,
} from './asistencia.schema';

export const listar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId } = req.params as unknown as ParametrosInventario;
  res.json(await service.listar(req.colaborador!, inventarioId));
});

/**
 * 201 si la marca se creó, 200 si ya estaba: el POST es idempotente (lo
 * garantiza el `@@unique` de la tabla) y el código lo dice, para que la
 * pantalla pueda distinguir "listo, quedó" de "ya lo habías marcado" sin
 * adivinar. El cuerpo es el mismo en los dos casos -- el estado completo de la
 * asistencia -- porque lo que la pantalla necesita después de marcar es
 * repintar, no enterarse de qué fila cambió.
 */
export const marcar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId } = req.params as unknown as ParametrosInventario;
  const { colaboradorId, dia } = req.body as MarcarAsistenciaInput;
  const { creada, asistencia } = await service.marcar(req.colaborador!, inventarioId, colaboradorId, dia);
  res.status(creada ? 201 : 200).json(asistencia);
});

/**
 * 200 con el estado completo, no 204 sin cuerpo: la pantalla tiene que
 * repintar igual que al marcar, y un 204 la obligaría a un GET de vuelta.
 */
export const borrar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId, colaboradorId } = req.params as unknown as ParametrosMarca;
  const { dia } = req.query as unknown as BorrarMarcaQuery;
  res.json(await service.borrar(req.colaborador!, inventarioId, colaboradorId, dia));
});
