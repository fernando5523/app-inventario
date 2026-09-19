import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as service from './hojas.service';
import type {
  CorregirConteoInput,
  GuardarConteoInput,
  ListarHojasQuery,
  ParametrosBarras,
  ParametrosConteo,
  ParametrosHoja,
} from './hojas.schema';

/** req.colaborador siempre existe aca: requiereSesion corre antes en la ruta. */
function actorDe(req: RequestAutenticado) {
  return req.colaborador!;
}

export const listar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  res.json(await service.listar(actorDe(req), req.query as unknown as ListarHojasQuery));
});

export const detalle = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { id } = req.params as unknown as ParametrosHoja;
  res.json(await service.detalle(actorDe(req), id));
});

export const productos = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { id } = req.params as unknown as ParametrosHoja;
  res.json(await service.productosDeHoja(actorDe(req), id));
});

export const productoPorBarras = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { id, codigo } = req.params as unknown as ParametrosBarras;
  res.json(await service.productoPorCodigoBarras(actorDe(req), id, codigo));
});

export const guardarConteo = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { id, productoId } = req.params as unknown as ParametrosConteo;
  const input = req.body as GuardarConteoInput;
  res.json(await service.guardarConteo(actorDe(req), id, productoId, input));
});

export const finalizar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { id } = req.params as unknown as ParametrosHoja;
  res.json(await service.finalizar(actorDe(req), id));
});

/**
 * LA CORRECCION DEL COORDINADOR. PATCH y no PUT: cambia el valor de un
 * conteo que YA existe -- `PUT /:id/conteos/:productoId` es el que lo crea o
 * lo reemplaza desde la gondola. Dos verbos para dos operaciones que escriben
 * la misma fila con permisos, ventanas y reglas distintas.
 *
 * La respuesta NO lleva stock: ver `hojas.service.ts#corregirConteo`.
 */
export const corregirConteo = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { id, productoId } = req.params as unknown as ParametrosConteo;
  const input = req.body as CorregirConteoInput;
  res.json(await service.corregirConteo(actorDe(req), id, productoId, input));
});
