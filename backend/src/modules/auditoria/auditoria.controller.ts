import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as service from './auditoria.service';
import type { CadenaQuery, ListarAuditablesQuery, MatrizQuery, ParametrosInventario } from './auditoria.schema';

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

export const cadena = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  res.json(await service.cadena(req.colaborador!, req.query as unknown as CadenaQuery));
});

/**
 * El .xlsx con el DETALLE POR PRODUCTO que respalda la tabla de `/cadena` --
 * ver auditoria.service.ts#exportarDiferenciasDeLaCadena.
 *
 * EL NOMBRE DEL ARCHIVO LO MANDA EL SERVIDOR y no el front: sin `anio`/`mes` en
 * la query el periodo lo resuelve el servidor con su propio reloj, asi que el
 * front no sabe de que mes es el archivo que acaba de bajar.
 */
export const exportarDiferenciasDeLaCadena = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { buffer, nombreArchivo } = await service.exportarDiferenciasDeLaCadena(
    req.colaborador!,
    req.query as unknown as CadenaQuery,
  );
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  res.send(buffer);
});
