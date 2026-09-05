import type { Request, Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './sesion.controller';
import { requiereSesion } from '../../middleware/auth.middleware';
import { cambiarPinSchema, ingresarSchema, parametrosSucursalSchema } from './sesion.schema';

/**
 * `express-rate-limit` (v7, `standardHeaders: true`) ya manda el header
 * `Retry-After` en el 429 -- lo hace SOLO por estar prendido ese flag, antes
 * de invocar `handler` (ver su codigo fuente, funcion que llama a
 * `setRetryAfterHeader`). Pero mobile no lo lee: `_http.ts#intentarUnaVez`
 * arma `ErrorApi` a partir del BODY de la respuesta (`{error, detalles}`,
 * mismo contrato que `error.middleware.ts`), nunca de los headers. Sin un
 * `handler` propio, el tiempo de espera existe en la respuesta pero mobile
 * no tiene como enterarse -- por eso se repite el mismo numero en
 * `detalles.reintentarEnSegundos`, en el mismo lugar donde CUALQUIER otro
 * error del backend pone su detalle.
 */
function reintentarEnSegundos(req: Request): number {
  const info = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit;
  if (!info?.resetTime) return 0;
  return Math.max(0, Math.ceil((info.resetTime.getTime() - Date.now()) / 1000));
}

function manejarLimiteExcedido(req: Request, res: Response): void {
  res.status(429).json({
    error: 'Demasiados intentos de ingreso. Volve a intentar en unos minutos.',
    detalles: { reintentarEnSegundos: reintentarEnSegundos(req) },
  });
}

/**
 * PIN de 6 digitos = espacio chico (1.000.000 combinaciones): sin esto,
 * fuerza bruta contra un colaboradorId conocido es viable. Se limita por
 * colaborador (no por IP, que en la tienda es compartida por varios
 * telefonos en la misma WiFi).
 */
export const limitadorIngreso = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.body?.colaboradorId ?? req.ip),
  handler: manejarLimiteExcedido,
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
