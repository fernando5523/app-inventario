import { Router } from 'express';
import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './hojas.controller';
import {
  guardarConteoSchema,
  listarHojasQuerySchema,
  parametrosBarrasSchema,
  parametrosConteoSchema,
  parametrosHojaSchema,
} from './hojas.schema';

/**
 * Hojas y conteos: el nucleo del negocio.
 *
 * Los 4 roles entran a este router -- hasta el administrador, que no cuenta
 * pero da soporte. El recorte fino NO vive aca: quien ve que hoja, quien
 * puede pedir el lote entero y quien puede escribir se decide en
 * hojas.permisos.ts, porque depende de la HOJA (si esta asignada a quien
 * pide, de que sucursal es), no solo del rol. Este middleware solo garantiza
 * que haya una sesion valida detras.
 *
 * La excepcion es `alcance=todas`, que se valida en el service con
 * `validarAlcance` apenas se conoce el parametro: un Contador nunca ve el
 * lote entero (conteo ciego).
 */
export const hojasRouter = Router();

hojasRouter.use(requiereSesion, requiereRol('administrador', 'coordinador', 'conteo', 'auditor'));

// --- Lectura ---------------------------------------------------------------

hojasRouter.get('/', validar(listarHojasQuerySchema, 'query'), controller.listar);

hojasRouter.get('/:id', validar(parametrosHojaSchema, 'params'), controller.detalle);

hojasRouter.get('/:id/productos', validar(parametrosHojaSchema, 'params'), controller.productos);

hojasRouter.get(
  '/:id/productos/barras/:codigo',
  validar(parametrosBarrasSchema, 'params'),
  controller.productoPorBarras,
);

// --- Escritura -------------------------------------------------------------

/**
 * PUT y no POST: el conteo de un producto en una hoja es UN recurso con
 * identidad propia (hoja + producto), no un renglon nuevo por cada envio.
 * Es lo que hace que la cola offline pueda reintentar sin duplicar -- con
 * POST a una coleccion, cada reintento crearia otra fila.
 */
hojasRouter.put(
  '/:id/conteos/:productoId',
  validar(parametrosConteoSchema, 'params'),
  validar(guardarConteoSchema, 'body'),
  controller.guardarConteo,
);

hojasRouter.post('/:id/finalizar', validar(parametrosHojaSchema, 'params'), controller.finalizar);
