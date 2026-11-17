import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as service from './correcciones.service';
import type { ConfirmarCorreccionesQuery, ExportarCorreccionesQuery } from './correcciones.schema';

/** Traduce req/res y nada mas -- ni Prisma ni logica de negocio (regla de capas, backend/README.md). */

/** El .xlsx -- mismas cabeceras que el resto de los export del backend. */
export const exportar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const query = req.query as unknown as ExportarCorreccionesQuery;
  const { buffer, nombreArchivo } = await service.exportarCorrecciones(req.colaborador!, {
    anio: query.anio,
    mes: query.mes,
    soloSinCuadrar: query.soloSinCuadrar,
    ...(query.sucursalId === undefined ? {} : { sucursalId: query.sucursalId }),
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  res.send(buffer);
});

/** Vista previa: clasifica cada fila contra la base. NUNCA escribe. */
export const previsualizar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  res.json(await service.previsualizarCorrecciones(req.colaborador!, req.body as Buffer));
});

export const confirmar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { nombreArchivo } = req.query as unknown as ConfirmarCorreccionesQuery;
  res.json(await service.confirmarCorrecciones(req.colaborador!, req.body as Buffer, nombreArchivo));
});
