import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './sesion.controller';
import { ingresarSchema, parametrosSucursalSchema } from './sesion.schema';

/**
 * PIN de 6 digitos = espacio chico (1.000.000 combinaciones): sin esto,
 * fuerza bruta contra un colaboradorId conocido es viable. Se limita por
 * colaborador (no por IP, que en la tienda es compartida por varios
 * telefonos en la misma WiFi).
 */
const limitadorIngreso = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.body?.colaboradorId ?? req.ip),
  message: { error: 'Demasiados intentos de ingreso. Volve a intentar en unos minutos.' },
});

export const sesionRouter = Router();

sesionRouter.get('/sucursales', controller.sucursales);
sesionRouter.get(
  '/sucursales/:sucursalId/colaboradores',
  validar(parametrosSucursalSchema, 'params'),
  controller.colaboradores,
);
sesionRouter.post('/ingresar', limitadorIngreso, validar(ingresarSchema, 'body'), controller.ingresar);
