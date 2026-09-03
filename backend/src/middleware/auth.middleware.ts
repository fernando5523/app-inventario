import type { NextFunction, Response } from 'express';
import { verificarToken } from '../modules/sesion/sesion.service';
import { NoAutorizado } from '../shared/errores';
import type { RequestAutenticado } from '../shared/tipos';

/**
 * No es un controller (no hay regla de capas que lo prohiba tocar datos),
 * pero igual delega en sesion.service en vez de importar PrismaClient aca:
 * un solo lugar sabe como se valida un token.
 */
export async function requiereSesion(
  req: RequestAutenticado,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const encabezado = req.header('authorization') ?? '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice('Bearer '.length) : null;
  if (!token) {
    next(new NoAutorizado('Falta el token de sesion.'));
    return;
  }

  const colaborador = await verificarToken(token);
  if (!colaborador) {
    next(new NoAutorizado('Sesion invalida o vencida.'));
    return;
  }

  req.colaborador = colaborador;
  next();
}
