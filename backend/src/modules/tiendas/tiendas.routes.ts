import { Router } from 'express';
import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './tiendas.controller';
import { actualizarTiendaSchema, crearTiendaSchema, parametrosTiendaSchema } from './tiendas.schema';

export const tiendasRouter = Router();

/** Solo administrador -- gestion de tiendas no es parte del alcance del auditor. */
tiendasRouter.use(requiereSesion, requiereRol('administrador'));

tiendasRouter.get('/', controller.listar);
tiendasRouter.post('/', validar(crearTiendaSchema, 'body'), controller.crear);
tiendasRouter.patch(
  '/:id',
  validar(parametrosTiendaSchema, 'params'),
  validar(actualizarTiendaSchema, 'body'),
  controller.actualizar,
);
