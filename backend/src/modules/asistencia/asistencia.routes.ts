import { Router } from 'express';
import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './asistencia.controller';
import {
  borrarMarcaQuerySchema,
  justificarFaltaSchema,
  marcarAsistenciaSchema,
  parametrosInventarioSchema,
  parametrosMarcaSchema,
  quitarJustificacionQuerySchema,
} from './asistencia.schema';

/**
 * La lista de asistencia del inventario (pantalla del Coordinador).
 *
 * Cuelga de `/api/inventarios/:inventarioId`, el MISMO prefijo que
 * `inventarios.routes.ts`, y va en un router aparte por lo mismo que
 * `liquidacion.reporte-gerencia.routes.ts`: son dos temas distintos y dos
 * personas tocando un solo archivo de rutas se pisan.
 *
 * EL ROL VA POR RUTA, NO EN EL ROUTER, y acá eso no es estilo sino necesidad.
 * Dos routers montados en el mismo prefijo se recorren en orden, y un
 * `requiereRol` a nivel de router corre para CUALQUIER path que empiece con
 * `/api/inventarios` -- incluidos los que resuelve el otro router. Con
 * `requiereRol('administrador', 'coordinador')` arriba, un auditor pidiendo
 * `/api/inventarios/8021/rondas/2/resumen` (ruta suya, de otro router) se
 * comería un 403 si este router llegara a mirarla primero. El rol por ruta no
 * puede caerse en esa trampa. Es además lo que ya documenta
 * `inventarios.routes.ts` para su propio caso.
 */
export const asistenciaRouter = Router();

asistenciaRouter.use(requiereSesion);

/**
 * Coordinador y administrador. El auditor NO, y el rol `conteo` tampoco: el
 * porqué -- que es de negocio, no de configuración -- está en
 * `asistencia.permisos.ts`. Este `requiereRol` es la primera barrera; el
 * service vuelve a validar rol, sucursal y estado del inventario.
 */
const puedePasarLista = requiereRol('administrador', 'coordinador');

/**
 * LEER incluye al auditor, ESCRIBIR no. Desde que el auditor puede justificar
 * faltas necesita ver la lista para saber a quién le perdona qué día; pasar
 * lista sigue sin ser suyo (el porqué está en `asistencia.permisos.ts`).
 */
const puedeVerLaLista = requiereRol('administrador', 'coordinador', 'auditor');

/**
 * JUSTIFICAR es del auditor y de nadie más -- ni del administrador, que para
 * pasar lista sí entra por soporte. Perdonar una multa es una decisión de
 * negocio sobre la plata de una persona, no una tarea que haya que destrabar.
 */
const puedeJustificar = requiereRol('auditor');

asistenciaRouter.get(
  '/:inventarioId/asistencia',
  puedeVerLaLista,
  validar(parametrosInventarioSchema, 'params'),
  controller.listar,
);

asistenciaRouter.post(
  '/:inventarioId/asistencia',
  puedePasarLista,
  validar(parametrosInventarioSchema, 'params'),
  validar(marcarAsistenciaSchema, 'body'),
  controller.marcar,
);

/**
 * El día va en la query y no en el path: se borra UNA marca (persona + día),
 * nunca la asistencia entera de alguien. `borrarMarcaQuerySchema` lo exige, así
 * que un DELETE sin `?dia=` es un 400, no un borrado masivo silencioso.
 */
asistenciaRouter.delete(
  '/:inventarioId/asistencia/:colaboradorId',
  puedePasarLista,
  validar(parametrosMarcaSchema, 'params'),
  validar(borrarMarcaQuerySchema, 'query'),
  controller.borrar,
);

/**
 * JUSTIFICAR UNA FALTA (auditor). `motivo` es obligatorio y lo exige
 * `justificarFaltaSchema`: un perdón sin motivo es un descuento menos que
 * nadie puede explicar seis meses después.
 */
asistenciaRouter.post(
  '/:inventarioId/justificaciones',
  puedeJustificar,
  validar(parametrosInventarioSchema, 'params'),
  validar(justificarFaltaSchema, 'body'),
  controller.justificar,
);

/**
 * Dar de baja UNA justificación. El día va en la query por lo mismo que al
 * borrar una marca: se levanta el perdón de un día, nunca todos los de una
 * persona de una sola vez.
 */
asistenciaRouter.delete(
  '/:inventarioId/justificaciones/:colaboradorId',
  puedeJustificar,
  validar(parametrosMarcaSchema, 'params'),
  validar(quitarJustificacionQuerySchema, 'query'),
  controller.quitarJustificacion,
);
