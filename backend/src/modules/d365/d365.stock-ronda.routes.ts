import { Router } from 'express';

import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './d365.stock-ronda.controller';
import { parametrosStockRondaSchema } from './d365.schema';

/**
 * LA DESCARGA DE STOCK DE UN RECONTEO.
 *
 * Cuelga de `/api/inventarios/:inventarioId` -- el MISMO prefijo que
 * `inventarios.routes.ts` -- y vive en un router aparte por lo mismo que
 * `asistencia.routes.ts` y `liquidacion.reporte-gerencia.routes.ts`: es otro
 * tema (la conversacion con el ERP, que es de este modulo) y dos personas
 * tocando un solo archivo de rutas se pisan. Concretamente: min-1 esta
 * cambiando el ciclo de rondas en paralelo.
 *
 * Que la ruta cuelgue del inventario y el codigo viva en `modules/d365/` no es
 * una inconsistencia: es la misma division que ya existe entre
 * `POST /api/d365/snapshot` -- la descarga del catalogo, que es el paso 1 del
 * wizard del Coordinador pero vive con la integracion -- y los pasos 2 y 3, que
 * viven en `inventarios/`. Esto es el snapshot de una ronda.
 *
 * EL ROL VA POR RUTA Y NO EN EL ROUTER, y aca eso no es estilo sino necesidad.
 * Dos routers montados en el mismo prefijo se recorren en orden, y un
 * `requiereRol` a nivel de router corre para CUALQUIER path que empiece con
 * `/api/inventarios` -- incluidos los que resuelve otro router. Con
 * `requiereRol('administrador', 'coordinador')` arriba, un auditor pidiendo
 * `/api/inventarios/8078/rondas/2/resumen` (ruta suya, de otro router) se
 * comeria un 403 si este llegara a mirarla primero. Es la misma trampa que ya
 * documentan `asistencia.routes.ts` e `inventarios.routes.ts`.
 */
export const stockRondaRouter = Router();

stockRondaRouter.use(requiereSesion);

/**
 * COORDINADOR Y ADMINISTRADOR: el MISMO criterio que `POST /api/d365/snapshot`,
 * reusado y no inventado. Es la misma operacion vista desde otra ronda -- traer
 * la vara del ERP -- y quien puede bajar el catalogo entero al preparar el
 * inventario tiene que poder bajar el stock de un reconteo.
 *
 * El auditor NO, aunque lea toda la cadena: esto ESCRIBE el stock contra el que
 * se va a medir, y el auditor es quien despues audita contra ese numero. El rol
 * `conteo` tampoco: quien cuenta no elige la vara.
 */
const puedeBajarStock = requiereRol('administrador', 'coordinador');

stockRondaRouter.post(
  '/:inventarioId/rondas/:numeroConteo/stock',
  puedeBajarStock,
  validar(parametrosStockRondaSchema, 'params'),
  controller.bajarStockDeRonda,
);

/**
 * Progreso de la descarga en curso. MISMOS roles que el POST: es su contracara,
 * y quien no puede lanzarla no tiene por que ver su avance (mismo criterio que
 * `GET /api/d365/snapshot/progreso`).
 *
 * Va DESPUES del POST en el archivo pero es un GET a otra ruta: no hay
 * ambiguedad de matcheo.
 */
stockRondaRouter.get(
  '/:inventarioId/rondas/:numeroConteo/stock/progreso',
  puedeBajarStock,
  validar(parametrosStockRondaSchema, 'params'),
  controller.progresoStockDeRonda,
);
