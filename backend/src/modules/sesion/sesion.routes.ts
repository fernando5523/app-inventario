import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './sesion.controller';
import { requiereSesion } from '../../middleware/auth.middleware';
import { cambiarPinSchema, ingresarSchema, parametrosSucursalSchema } from './sesion.schema';

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
// Camino aparte para el rol=administrador: no tiene sucursal (ver
// sesion.service.ts#listarAdministradores), asi que no puede salir de la
// ruta de arriba.
sesionRouter.get('/administradores', controller.administradores);
sesionRouter.post('/ingresar', limitadorIngreso, validar(ingresarSchema, 'body'), controller.ingresar);

/**
 * Cambio de PIN propio. Requiere sesion pero NINGUN rol: cualquiera cambia
 * el suyo, incluido el rol `conteo`. Es el unico camino por el que un PIN
 * pasa a ser conocido solo por su dueno -- el reseteo del administrador,
 * por definicion, deja el PIN en manos de dos personas.
 *
 * Rate-limited igual que el ingreso: pide el PIN actual, asi que es otra
 * puerta por donde se podria probar a fuerza bruta.
 */
sesionRouter.post(
  '/cambiar-pin',
  limitadorIngreso,
  requiereSesion,
  validar(cambiarPinSchema, 'body'),
  controller.cambiarPin,
);
