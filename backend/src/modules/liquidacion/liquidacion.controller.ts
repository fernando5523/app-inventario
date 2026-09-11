import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as ajustes from './liquidacion.ajustes';
import * as ajustesNegativos from './liquidacion.ajustes-negativos';
import * as cierre from './liquidacion.cierre';
import * as service from './liquidacion.service';
import type {
  ConfirmarAjustesNegativosQuery,
  MotivoLineaAjusteInput,
  ParametrosInventario,
  ParametrosLineaAjuste,
  ParametrosSucursal,
} from './liquidacion.schema';

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

/** El estado de los ajustes del mes -- solo lectura (el PUT se borró el 2026-09-14, ver liquidacion.ajustes.ts). */
export const estadoAjustes = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId } = req.params as unknown as ParametrosInventario;
  res.json(await ajustes.estadoDeAjustes(req.colaborador!, inventarioId));
});

/** Vista previa del Excel de ajustes: `req.body` es el archivo crudo (`express.raw`, ver liquidacion.routes.ts). Nunca persiste. */
export const previsualizarAjustesNegativos = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId } = req.params as unknown as ParametrosInventario;
  res.json(await ajustesNegativos.previsualizarAjustesNegativos(req.colaborador!, inventarioId, req.body as Buffer));
});

/** 201: confirmar CREA la importación (y sus líneas) que pasa a ser la vigente. */
export const confirmarAjustesNegativos = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId } = req.params as unknown as ParametrosInventario;
  const { nombreArchivo } = req.query as unknown as ConfirmarAjustesNegativosQuery;
  res
    .status(201)
    .json(await ajustesNegativos.confirmarAjustesNegativos(req.colaborador!, inventarioId, req.body as Buffer, nombreArchivo));
});

/** Las líneas de la importación vigente -- lectura, se puede consultar aunque el inventario ya esté liquidado. */
export const listarLineasAjustesNegativos = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId } = req.params as unknown as ParametrosInventario;
  res.json(await ajustesNegativos.listarLineasAjusteNegativo(req.colaborador!, inventarioId));
});

export const excluirLineaAjusteNegativo = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId, lineaId } = req.params as unknown as ParametrosLineaAjuste;
  const { motivo } = req.body as MotivoLineaAjusteInput;
  res.json(await ajustesNegativos.excluirLineaAjusteNegativo(req.colaborador!, inventarioId, lineaId, motivo));
});

export const incluirLineaAjusteNegativo = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId, lineaId } = req.params as unknown as ParametrosLineaAjuste;
  const { motivo } = req.body as MotivoLineaAjusteInput;
  res.json(await ajustesNegativos.incluirLineaAjusteNegativo(req.colaborador!, inventarioId, lineaId, motivo));
});
