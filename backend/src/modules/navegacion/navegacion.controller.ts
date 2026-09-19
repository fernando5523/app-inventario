import type { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import type { RequestAutenticado } from '../../shared/tipos';
import * as service from './navegacion.service';
import type { GuardarNavegacionInput, ParametrosRol, RestablecerInput } from './navegacion.schema';

/**
 * LA QUE PIDE LA APP AL INICIAR SESION: la navegacion DEL ROL DE QUIEN LLAMA,
 * no la de un rol que venga por parametro.
 *
 * Que salga de la sesion y no de la URL no es comodidad: si viniera por
 * parametro, cualquiera con sesion podria leer el home de otro rol. No es un
 * secreto grave, pero tampoco hay razon para ofrecerlo -- y el dia que un
 * acceso lleve un subtitulo revelador, ya estaria expuesto.
 */
export const mia = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  res.json(await service.navegacionDe(req.colaborador!.rol));
});

/** La configuracion completa de un rol, apagados incluidos. Solo Administrador. */
export const verConfiguracion = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { rol } = req.params as unknown as ParametrosRol;
  res.json(await service.configuracionDe(rol));
});

export const guardar = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { rol } = req.params as unknown as ParametrosRol;
  const { tipo, elementos } = req.body as GuardarNavegacionInput;
  res.json(await service.guardar(req.colaborador!, rol, tipo, elementos));
});

/** Vuelve al valor de fabrica ese rol y tipo. */
export const restablecer = asyncHandler(async (req: RequestAutenticado, res: Response) => {
  const { rol } = req.params as unknown as ParametrosRol;
  const { tipo } = req.body as RestablecerInput;
  res.json(await service.restablecer(req.colaborador!, rol, tipo));
});
