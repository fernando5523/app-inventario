import { Router } from 'express';
import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './config-dynamics.controller';
import { guardarConfigDynamicsSchema } from './config-dynamics.schema';

/**
 * Credenciales de Dynamics (pantalla de Configuracion del Administrador).
 *
 * SOLO `administrador`, sin excepciones -- ni siquiera el auditor. Son las
 * llaves de la integracion con el ERP de la empresa: quien las cambia puede
 * apuntar todo el sistema a otro Dynamics, y quien las lee (si pudiera) se
 * lleva el acceso al ERP entero. Es el alcance mas chico posible.
 *
 * Router aparte de /api/config y no dos claves mas de la tabla
 * `Configuracion`: el secreto necesita un tratamiento que las otras configs
 * no tienen (se cifra al guardar, nunca se devuelve) y `probar` hace una
 * llamada de red real, no una lectura local. Son razones concretas para
 * aislarlo, no una config mas -- el mismo criterio con el que el puerto del
 * front lo separo de RepositorioConfig.
 */
export const configDynamicsRouter = Router();

configDynamicsRouter.use(requiereSesion, requiereRol('administrador'));

configDynamicsRouter.get('/', controller.obtener);

configDynamicsRouter.put('/', validar(guardarConfigDynamicsSchema, 'body'), controller.guardar);

configDynamicsRouter.post('/probar', controller.probarConexion);
