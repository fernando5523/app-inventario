import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as service from './historial.service';
import type {
  AprobarCierreInput,
  ComparativoQuery,
  HistoricoItemQuery,
  ListarDiferenciasQuery,
  ListarInventariosQuery,
  ParametrosInventario,
  ParametrosItem,
  RegistrarEnErpInput,
} from './historial.schema';

/**
 * Traduce req/res y nada mas -- ni Prisma ni logica de negocio (regla de
 * capas, backend/README.md). `req.colaborador!` sale de auth.middleware.ts:
 * requiereSesion ya corrio y garantiza que esta.
 */

export const listarInventarios = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  res.json(await service.listarInventarios(req.colaborador!, req.query as unknown as ListarInventariosQuery));
});

export const obtenerDetalle = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { id } = req.params as unknown as ParametrosInventario;
  res.json(await service.obtenerDetalle(req.colaborador!, id));
});

export const listarDiferencias = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { id } = req.params as unknown as ParametrosInventario;
  res.json(await service.listarDiferencias(req.colaborador!, id, req.query as unknown as ListarDiferenciasQuery));
});

export const obtenerLiquidacion = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { id } = req.params as unknown as ParametrosInventario;
  res.json(await service.obtenerLiquidacion(req.colaborador!, id));
});

/** Lo que consume la pantalla 7 -- espeja EstadoLacrado del puerto del front. */
export const estadoLacrado = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { id } = req.params as unknown as ParametrosInventario;
  res.json(await service.estadoLacrado(req.colaborador!, id));
});

export const verificarSello = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { id } = req.params as unknown as ParametrosInventario;
  res.json(await service.verificarSello(req.colaborador!, id));
});

export const historicoDeItem = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { codigo } = req.params as unknown as ParametrosItem;
  res.json(await service.historicoDeItem(req.colaborador!, codigo, req.query as unknown as HistoricoItemQuery));
});

export const comparativo = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  res.json(await service.comparativo(req.colaborador!, req.query as unknown as ComparativoQuery));
});

/**
 * Fijate que NO se lee ningun aprobadorId del request: quien aprueba es
 * `req.colaborador`, el de la sesion. historial.schema.ts ademas rechaza con
 * 400 el body que traiga una identidad, asi que un intento de firmar por
 * otro falla ruidosamente en vez de ignorarse en silencio.
 */
export const aprobarCierre = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { id } = req.params as unknown as ParametrosInventario;
  res.status(201).json(await service.aprobarCierre(req.colaborador!, id, req.body as AprobarCierreInput));
});

export const lacrar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { id } = req.params as unknown as ParametrosInventario;
  res.status(201).json(await service.lacrar(req.colaborador!, id));
});

export const registrarEnErp = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { id } = req.params as unknown as ParametrosInventario;
  res.status(201).json(await service.registrarEnErp(req.colaborador!, id, req.body as RegistrarEnErpInput));
});
