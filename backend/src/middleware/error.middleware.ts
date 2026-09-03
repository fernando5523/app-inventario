import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorHttp } from '../shared/errores';

/** Debe ser el ULTIMO middleware montado en app.ts. */
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof ErrorHttp) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Solicitud invalida.', detalles: err.flatten() });
    return;
  }

  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
}
