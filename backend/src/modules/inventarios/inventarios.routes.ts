import { Router } from 'express';

import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './inventarios.controller';
import {
  asignarHojasSchema,
  crearHojasSchema,
  parametrosInventarioSchema,
  parametrosRondaSchema,
  parametrosSucursalSchema,
} from './inventarios.schema';

/**
 * Pasos 2 y 3 del wizard del Coordinador. El paso 1 (traer el catalogo) vive
 * en `/api/d365/snapshot`, que es donde esta la integracion con el ERP.
 *
 * SOLO COORDINADOR (y administrador, que da soporte). No es un detalle de
 * permisos: quien reparte las hojas decide QUIEN cuenta QUE, y un Contador
 * que pudiera repartirse las suyas elegiria las gondolas faciles. Tampoco el
 * Auditor -- audita lo que otros contaron, no arma el lote.
 */
export const inventariosRouter = Router();

inventariosRouter.use(requiereSesion, requiereRol('administrador', 'coordinador'));

/** PASO 2: parte el inventario en hojas del tamaño elegido. Destructivo si no se conto nada todavia. */
inventariosRouter.post(
  '/:inventarioId/hojas',
  validar(parametrosInventarioSchema, 'params'),
  validar(crearHojasSchema, 'body'),
  controller.crearHojas,
);

/** PASO 3: reparte las hojas SIN asignar entre los presentes. */
inventariosRouter.post(
  '/:inventarioId/hojas/asignar',
  validar(parametrosInventarioSchema, 'params'),
  validar(asignarHojasSchema, 'body'),
  controller.asignarHojas,
);

/**
 * PASO 4: el CICLO DE 3 CONTEOS.
 *
 * El resumen es un PREVIEW y no muta nada: cerrar una ronda es una decision,
 * no un tramite. Si de 1.236 items quedan 12 por recontar la ronda 2 es media
 * hora; si quedan 900, algo se conto mal y hay que mirar eso ANTES de mandar
 * a once personas a recontar.
 */
inventariosRouter.get(
  '/:inventarioId/rondas/:ronda/resumen',
  validar(parametrosRondaSchema, 'params'),
  controller.resumenRonda,
);

/** Cierra la ronda y abre la siguiente SOLO con los items que no cuadraron. */
inventariosRouter.post(
  '/:inventarioId/rondas/:ronda/cerrar',
  validar(parametrosRondaSchema, 'params'),
  controller.cerrarRonda,
);

/**
 * El inventario en curso de una sucursal. Va en un router propio porque
 * cuelga de `/api/sucursales/:sucursalId`, no de `/api/inventarios`.
 *
 * Lo lee tambien el Contador y el Auditor: necesitan saber si hay un
 * inventario abierto para mostrar la pantalla correcta. Lo que NO pueden es
 * crear ni repartir hojas, que son las rutas de arriba.
 */
export const sucursalesInventariosRouter = Router();

sucursalesInventariosRouter.use(requiereSesion, requiereRol('administrador', 'coordinador', 'conteo', 'auditor'));

sucursalesInventariosRouter.get(
  '/:sucursalId/inventarios/activo',
  validar(parametrosSucursalSchema, 'params'),
  controller.activo,
);
