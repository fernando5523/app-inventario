import { Router } from 'express';
import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './config.controller';
import { actualizarConfigSchema, parametrosConfigSchema } from './config.schema';

export const configRouter = Router();

/** Solo administrador -- configuracion del sistema no es alcance del auditor. */
configRouter.use(requiereSesion, requiereRol('administrador'));

configRouter.get('/', controller.listar);
configRouter.put(
  '/:clave',
  validar(parametrosConfigSchema, 'params'),
  validar(actualizarConfigSchema, 'body'),
  controller.actualizar,
);
