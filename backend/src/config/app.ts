import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { errorMiddleware } from '../middleware/error.middleware';
import { configRouter } from '../modules/config';
import { d365Router } from '../modules/d365';
import { sesionRouter } from '../modules/sesion';
import { tiendasRouter } from '../modules/tiendas';
import { usuariosRouter } from '../modules/usuarios';

export function crearApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.get('/salud', (_req, res) => res.json({ ok: true }));

  app.use('/api/sesion', sesionRouter);
  app.use('/api/usuarios', usuariosRouter);
  app.use('/api/tiendas', tiendasRouter);
  app.use('/api/config', configRouter);
  app.use('/api/d365', d365Router);

  // Siempre al final: error.middleware.ts traduce lo que tiren las capas anteriores.
  app.use(errorMiddleware);

  return app;
}
