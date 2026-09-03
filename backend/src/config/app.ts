import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { errorMiddleware } from '../middleware/error.middleware';
import { auditoriaRouter } from '../modules/auditoria';
import { configRouter } from '../modules/config';
import { configDynamicsRouter } from '../modules/config-dynamics';
import { hojasRouter } from '../modules/hojas';
import { d365Router } from '../modules/d365';
import { historialRouter } from '../modules/historial';
import { liquidacionRouter } from '../modules/liquidacion';
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
  app.use('/api/hojas', hojasRouter);
  app.use('/api/d365', d365Router);
  app.use('/api/historial', historialRouter);
  app.use('/api/auditoria', auditoriaRouter);
  app.use('/api/liquidacion', liquidacionRouter);
  app.use('/api/config-dynamics', configDynamicsRouter);

  // Siempre al final: error.middleware.ts traduce lo que tiren las capas anteriores.
  app.use(errorMiddleware);

  return app;
}
