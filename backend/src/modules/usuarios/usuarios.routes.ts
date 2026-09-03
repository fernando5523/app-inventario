import { Router } from 'express';
import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './usuarios.controller';
import {
  actualizarEstadoSchema,
  crearUsuarioSchema,
  listarUsuariosQuerySchema,
  parametrosUsuarioSchema,
  resetearPinSchema,
} from './usuarios.schema';

/**
 * Administrador y auditor entran a TODAS estas rutas -- el recorte fino
 * (un auditor no puede tocar otro auditor, ni salir de su sucursal) vive
 * en usuarios.service.ts, no aca: este middleware solo saca a
 * coordinador/conteo, que no tienen que ver con gestion de usuarios.
 */
const rolesConAcceso = requiereRol('administrador', 'auditor');

export const usuariosRouter = Router();

usuariosRouter.use(requiereSesion, rolesConAcceso);

usuariosRouter.get('/', validar(listarUsuariosQuerySchema, 'query'), controller.listar);
usuariosRouter.post('/', validar(crearUsuarioSchema, 'body'), controller.crear);
usuariosRouter.patch(
  '/:id/estado',
  validar(parametrosUsuarioSchema, 'params'),
  validar(actualizarEstadoSchema, 'body'),
  controller.actualizarEstado,
);
usuariosRouter.post(
  '/:id/resetear-pin',
  validar(parametrosUsuarioSchema, 'params'),
  validar(resetearPinSchema, 'body'),
  controller.resetearPin,
);
