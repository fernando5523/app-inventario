import type { NextFunction, Request, Response } from 'express';

/**
 * Express 4 no reenvia el rechazo de una promesa a error.middleware.ts por
 * si solo: sin esto, cada controller repetiria el mismo try/catch(next).
 * Un solo lugar sabe como reenviar el error, igual que auth.middleware.ts
 * ya centraliza como se valida un token.
 */
export function asyncHandler<Req extends Request = Request>(
  manejador: (req: Req, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Req, res: Response, next: NextFunction): void => {
    manejador(req, res, next).catch(next);
  };
}
