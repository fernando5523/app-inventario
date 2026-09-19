import { Router } from 'express';

import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './inventarios.controller';
import {
  ajustarConteoSchema,
  asignarHojasSchema,
  crearHojasSchema,
  parametrosAjusteSchema,
  parametrosInventarioSchema,
  parametrosRondaSchema,
  parametrosSucursalSchema,
} from './inventarios.schema';

/**
 * Pasos 2 y 3 del wizard del Coordinador. El paso 1 (traer el catalogo) vive
 * en `/api/d365/snapshot`, que es donde esta la integracion con el ERP.
 *
 * ESCRIBIR (crear/repartir hojas, cerrar ronda) es SOLO Coordinador y
 * administrador (que da soporte): quien reparte las hojas decide QUIEN cuenta
 * QUE, y un Contador que pudiera repartirse las suyas elegiria las gondolas
 * faciles. LEER el resumen de una ronda (el embudo del ciclo) lo puede hacer
 * TAMBIEN el Auditor -- audita lo que otros contaron, y necesita ver ese
 * embudo, incluso con el inventario ya cerrado. Por eso el rol va POR RUTA,
 * no a nivel del router.
 */
export const inventariosRouter = Router();

inventariosRouter.use(requiereSesion);

const puedeEscribir = requiereRol('administrador', 'coordinador');
const puedeLeerResumen = requiereRol('administrador', 'coordinador', 'auditor');

/** PASO 2: parte el inventario en hojas del tamaño elegido. Destructivo si no se conto nada todavia. */
inventariosRouter.post(
  '/:inventarioId/hojas',
  puedeEscribir,
  validar(parametrosInventarioSchema, 'params'),
  validar(crearHojasSchema, 'body'),
  controller.crearHojas,
);

/** PASO 3: reparte las hojas SIN asignar entre los presentes. */
inventariosRouter.post(
  '/:inventarioId/hojas/asignar',
  puedeEscribir,
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
  puedeLeerResumen,
  validar(parametrosRondaSchema, 'params'),
  controller.resumenRonda,
);

/** Cierra la ronda y abre la siguiente SOLO con los items que no cuadraron. */
inventariosRouter.post(
  '/:inventarioId/rondas/:ronda/cerrar',
  puedeEscribir,
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

// ---------------------------------------------------------------------------
// EL TRAMO DEL AUDITOR: rondas extra y ajuste final
//
// Cuatro rutas nuevas que existen porque cerrar la ultima ronda ya NO cierra
// el conteo: el inventario queda esperando una decision del Auditor.
//
// NINGUNA lleva `requiereRol`, y es deliberado. El rol solo no alcanza para
// decidir ninguna de las cuatro: todas dependen ADEMAS del estado del
// inventario (`en_curso` contra `ajuste_auditor`), y esas ventanas viven
// juntas en `ajuste.permisos.ts` para que no se contradigan. Un `requiereRol`
// aca seria media regla escrita en otro archivo -- la mitad que alguien
// actualizaria sin mirar la otra. Los rechazos igual salen con el 403 y el
// mensaje correctos, desde el service.
// ---------------------------------------------------------------------------

/** Un 4to conteo, un 5to: los abre el Auditor, de a uno, cuando hace falta. */
inventariosRouter.post(
  '/:inventarioId/rondas/abrir',
  validar(parametrosInventarioSchema, 'params'),
  controller.abrirRondaExtra,
);

/**
 * ARRANCA EL AJUSTE. Es un boton y no un automatismo al cerrar la ultima
 * ronda: esa espera es la ventana en la que el Coordinador todavia corrige
 * (ver ajuste.permisos.ts). A partir de aca queda bloqueado.
 */
inventariosRouter.post(
  '/:inventarioId/ajuste/iniciar',
  validar(parametrosInventarioSchema, 'params'),
  controller.iniciarAjuste,
);

/** Cambia un valor del ultimo conteo. LA UNICA respuesta que trae stockErp. */
inventariosRouter.patch(
  '/:inventarioId/ajuste/:productoId',
  validar(parametrosAjusteSchema, 'params'),
  validar(ajustarConteoSchema, 'body'),
  controller.ajustarConteo,
);

/** Cierra el ajuste y con el, el conteo: `ajuste_auditor` -> `conteo_cerrado`. */
inventariosRouter.post(
  '/:inventarioId/ajuste/cerrar',
  validar(parametrosInventarioSchema, 'params'),
  controller.cerrarAjuste,
);
