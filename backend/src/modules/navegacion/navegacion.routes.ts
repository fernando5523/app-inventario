import { Router } from 'express';
import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './navegacion.controller';
import { guardarNavegacionSchema, parametrosRolSchema, restablecerSchema } from './navegacion.schema';

/**
 * La navegacion configurable: las tarjetas del home y la barra de abajo.
 *
 * DOS PUERTAS DISTINTAS, y la diferencia es el punto:
 *
 *  - `/mia` la abre CUALQUIER rol con sesion: es la propia, y la app la pide
 *    al iniciar sesion para armar su home. Negarsela a alguien seria dejarlo
 *    sin pantalla.
 *  - todo lo demas es SOLO del Administrador: es quien configura.
 *
 * Y lo que se configura es PRESENTACION, no autorizacion: esconder una
 * tarjeta es una comodidad, mostrarla no es un permiso. El `requiereRol` de
 * cada router y los `*.permisos.ts` siguen decidiendo lo mismo que antes.
 */
export const navegacionRouter = Router();

navegacionRouter.use(requiereSesion);

navegacionRouter.get('/mia', controller.mia);

const soloAdministrador = requiereRol('administrador');

navegacionRouter.get(
  '/config/:rol',
  soloAdministrador,
  validar(parametrosRolSchema, 'params'),
  controller.verConfiguracion,
);

/**
 * PUT y no PATCH: se manda la lista ENTERA y en orden, no un cambio suelto.
 * Reordenar es justamente la operacion donde un diff se rompe -- ver
 * `navegacion.service.ts#guardar`.
 */
navegacionRouter.put(
  '/config/:rol',
  soloAdministrador,
  validar(parametrosRolSchema, 'params'),
  validar(guardarNavegacionSchema, 'body'),
  controller.guardar,
);

/** La salida cuando alguien se equivoca reordenando: vuelve a fabrica. */
navegacionRouter.post(
  '/config/:rol/restablecer',
  soloAdministrador,
  validar(parametrosRolSchema, 'params'),
  validar(restablecerSchema, 'body'),
  controller.restablecer,
);
