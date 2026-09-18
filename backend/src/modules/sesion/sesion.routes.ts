import type { Request, Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './sesion.controller';
import { requiereSesion } from '../../middleware/auth.middleware';
import type { RequestAutenticado } from '../../shared/tipos';
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
    error: 'Demasiados intentos de ingreso. Vuelve a intentar en unos minutos.',
    detalles: { reintentarEnSegundos: reintentarEnSegundos(req) },
  });
}

/**
 * PIN de 6 digitos = espacio chico (1.000.000 combinaciones): sin esto,
 * fuerza bruta contra un colaboradorId conocido es viable. Se limita por
 * colaborador (no por IP, que en la tienda es compartida por varios
 * telefonos en la misma WiFi).
 *
 * Una sola instancia para las dos rutas (misma ventana, mismo limite, mismo
 * 429), pero cada ruta cuenta en su propio espacio de claves:
 * - `/ingresar` -> `ingresar:<colaboradorId del body>`. Todavia no hay
 *   sesion; sin id cae a la IP, y `validar` rechaza ese body con 400 igual.
 * - `/cambiar-pin` -> `cambiar-pin:<colaboradorId de la sesion>`.
 *   `requiereSesion` corre ANTES y deja `req.colaborador`, asi que la clave
 *   sale de la sesion y NUNCA del body (mismo criterio que el controller):
 *   un colaboradorId ajeno en el body no pasa el conteo a otra cuenta.
 * El prefijo va en LAS DOS claves: si la de `/ingresar` fuera el valor del
 * body a secas, un body con `colaboradorId: "cambiar-pin:<id>"` sumaria al
 * cupo de cambio de PIN de esa persona sin tener su sesion (el limitador
 * cuenta antes de que `validar` rechace el body).
 *
 * Decision: cupos SEPARADOS, segun el plan D de backend/README.md
 * ("Endurecer el limitador": que un ataque no bloquee el cambio legitimo).
 * Lo que se gana: 8 ingresos fallidos con el id de alguien, que cualquiera
 * puede mandar sin sesion, no le bloquean el cambio de PIN. El costo
 * aceptado: quien tenga en la mano una sesion ajena abierta prueba hasta 8
 * PIN por `/cambiar-pin` ademas de los 8 por `/ingresar` en cada ventana
 * de 15 min.
 */
export const limitadorIngreso = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const deLaSesion = (req as RequestAutenticado).colaborador?.colaboradorId;
    if (deLaSesion !== undefined) return `cambiar-pin:${deLaSesion}`;
    return `ingresar:${String(req.body?.colaboradorId ?? req.ip)}`;
  },
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
 * Rate-limited igual que el ingreso, pero con su PROPIO cupo (ver
 * `limitadorIngreso`): pide el PIN actual, asi que es otra puerta por donde
 * se podria probar a fuerza bruta. `requiereSesion` va ANTES del limitador:
 * la clave sale del colaborador de la sesion, y un pedido sin sesion (401)
 * no gasta cupo de nadie.
 */
sesionRouter.post(
  '/cambiar-pin',
  requiereSesion,
  limitadorIngreso,
  validar(cambiarPinSchema, 'body'),
  controller.cambiarPin,
);
