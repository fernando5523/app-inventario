import type { NextFunction, Response } from 'express';
import { NoAutorizado, Prohibido } from '../shared/errores';
import type { RequestAutenticado, Rol } from '../shared/tipos';

/**
 * Exige que el colaborador de la sesion (ya validada por requiereSesion)
 * tenga uno de los roles dados. Declarativo en la ruta -- nunca un `if` de
 * rol adentro de un controller, para que la lista de quien puede pegarle a
 * un endpoint se lea de un vistazo en el archivo de rutas, no dispersa en
 * la logica de cada handler.
 *
 * Montar SIEMPRE despues de requiereSesion: depende de req.colaborador.
 */
export function requiereRol(...roles: Rol[]) {
  return (req: RequestAutenticado, _res: Response, next: NextFunction): void => {
    if (!req.colaborador) {
      next(new NoAutorizado('Falta autenticacion.'));
      return;
    }
    if (!roles.includes(req.colaborador.rol)) {
      next(new Prohibido('Tu rol no tiene acceso a esta accion.'));
      return;
    }
    next();
  };
}
