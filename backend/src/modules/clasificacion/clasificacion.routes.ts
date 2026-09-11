import { Router } from 'express';
import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './clasificacion.controller';
import { buscarQuerySchema, clasificarSchema, parametrosCodigoSchema } from './clasificacion.schema';

/**
 * SOLO el Auditor -- ni el administrador. La clasificacion empresa/empleado
 * mueve plata en la liquidacion y es decision del Auditor (el recorte no tiene
 * matiz por sucursal: la clasificacion es por codigo, cross-tienda). El
 * cinturon del service (clasificacion.permisos.ts) repite la regla sin Prisma.
 */
export const clasificacionRouter = Router();

clasificacionRouter.use(requiereSesion, requiereRol('auditor'));

clasificacionRouter.get('/', validar(buscarQuerySchema, 'query'), controller.buscar);
clasificacionRouter.put(
  '/:codigo',
  validar(parametrosCodigoSchema, 'params'),
  validar(clasificarSchema, 'body'),
  controller.clasificar,
);
clasificacionRouter.delete('/:codigo', validar(parametrosCodigoSchema, 'params'), controller.desclasificar);
