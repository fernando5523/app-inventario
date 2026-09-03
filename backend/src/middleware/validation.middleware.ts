import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

type Fuente = 'body' | 'params' | 'query';

/**
 * Valida `req[fuente]` contra un schema Zod y reemplaza `req[fuente]` por el
 * resultado parseado (con los defaults/coerciones que el schema declare).
 * Si falla, deja que error.middleware.ts traduzca el ZodError.
 */
export function validar(schema: ZodType, fuente: Fuente = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req[fuente] = schema.parse(req[fuente]);
      next();
    } catch (err) {
      next(err);
    }
  };
}
