import type { Response } from 'express';

import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as ajuste from './ajuste.service';
import * as rondas from './rondas.service';
import * as service from './inventarios.service';
import type {
  AjustarConteoInput,
  AsignarHojasInput,
  CrearHojasInput,
  ParametrosInventario,
  ParametrosAjuste,
  ParametrosRonda,
  ParametrosSucursal,
} from './inventarios.schema';

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

// --- Ciclo de 3 conteos ----------------------------------------------------

/** PREVIEW del cierre: no muta nada. Ver rondas.service.ts#resumen. */
export const resumenRonda = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId, ronda } = req.params as unknown as ParametrosRonda;
  res.json(await rondas.resumen(req.colaborador!, inventarioId, ronda));
});

/** Cierra la ronda y abre la siguiente SOLO con lo que no cuadro. */
export const cerrarRonda = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId, ronda } = req.params as unknown as ParametrosRonda;
  res.status(201).json(await rondas.cerrar(req.colaborador!, inventarioId, ronda));
});

// --- El tramo del Auditor: rondas extra y ajuste final -------------------

/**
 * 201: se crearon hojas nuevas. Mismo criterio que `crearHojas` -- lo que
 * devuelve son recursos que antes no existian.
 */
export const abrirRondaExtra = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId } = req.params as unknown as ParametrosInventario;
  res.status(201).json(await rondas.abrirRondaExtra(actorDe(req), inventarioId));
});

/** 200: no crea nada, mueve el estado del inventario. */
export const iniciarAjuste = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId } = req.params as unknown as ParametrosInventario;
  res.json(await rondas.iniciarAjuste(actorDe(req), inventarioId));
});

/**
 * ESTA RESPUESTA LLEVA `stockErp`, y es la unica del flujo de conteo que lo
 * hace. La ruta la deja pasar solo al Auditor (`ajuste.permisos.ts`): es su
 * trabajo comparar contra el ERP.
 */
export const ajustarConteo = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId, productoId } = req.params as unknown as ParametrosAjuste;
  const input = req.body as AjustarConteoInput;
  res.json(await ajuste.ajustarConteo(actorDe(req), inventarioId, productoId, input));
});

/** Cierra el ajuste y con el, el conteo: de aca sigue liquidacion. */
export const cerrarAjuste = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { inventarioId } = req.params as unknown as ParametrosInventario;
  res.json(await rondas.cerrarAjuste(actorDe(req), inventarioId));
});
