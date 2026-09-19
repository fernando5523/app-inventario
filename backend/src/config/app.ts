import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { errorMiddleware } from '../middleware/error.middleware';
import { asistenciaRouter } from '../modules/asistencia';
import { auditoriaRouter } from '../modules/auditoria';
import { clasificacionRouter } from '../modules/clasificacion';
import { configRouter } from '../modules/config';
import { configDynamicsRouter } from '../modules/config-dynamics';
import { hojasRouter } from '../modules/hojas';
import { d365Router } from '../modules/d365';
import { historialRouter } from '../modules/historial';
import { liquidacionRouter, reporteGerenciaRouter } from '../modules/liquidacion';
import { navegacionRouter } from '../modules/navegacion';
import { sesionRouter } from '../modules/sesion';
import { tiendasRouter } from '../modules/tiendas';
import { usuariosRouter } from '../modules/usuarios';
import { inventariosRouter, sucursalesInventariosRouter } from '../modules/inventarios';

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
  app.use('/api/navegacion', navegacionRouter);
  app.use('/api/hojas', hojasRouter);
  // Pasos 2 y 3 del wizard del Coordinador. Van juntos y en dos monturas
  // porque `activo` cuelga de /api/sucursales/:id, no de /api/inventarios.
  app.use('/api/inventarios', inventariosRouter);
  app.use('/api/sucursales', sucursalesInventariosRouter);
  // La lista de asistencia cuelga del MISMO prefijo que inventariosRouter, en
  // un router propio (mismo criterio que liquidacion.reporte-gerencia.routes.ts:
  // otro tema, otro archivo, dos personas sin pisarse). Por eso su rol va por
  // ruta y no a nivel del router -- ver asistencia.routes.ts.
  app.use('/api/inventarios', asistenciaRouter);
  app.use('/api/d365', d365Router);
  app.use('/api/historial', historialRouter);
  app.use('/api/auditoria', auditoriaRouter);
  app.use('/api/clasificacion', clasificacionRouter);
  app.use('/api/liquidacion', liquidacionRouter);
  app.use('/api/liquidacion', reporteGerenciaRouter);
  app.use('/api/config-dynamics', configDynamicsRouter);

  // Siempre al final: error.middleware.ts traduce lo que tiren las capas anteriores.
  app.use(errorMiddleware);

  return app;
}
