import { Router } from 'express';
import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './historial.controller';
import {
  aprobarCierreSchema,
  comparativoQuerySchema,
  historicoItemQuerySchema,
  lacrarSchema,
  listarDiferenciasQuerySchema,
  listarInventariosQuerySchema,
  parametrosInventarioSchema,
  parametrosItemSchema,
  registrarEnErpSchema,
} from './historial.schema';

export const historialRouter = Router();

/**
 * Administrador y auditor, nadie mas.
 *
 * `coordinador` y `conteo` NO estan, y no es una omision: es la misma regla
 * de conteo ciego que sostiene todo el sistema. Un contador que puede ver el
 * resultado del mes pasado -- o el faltante que ya se detecto este mes --
 * deja de contar a ciegas y pasa a confirmar un numero que vio antes. Ellos
 * ven lo suyo del inventario en curso, nada mas.
 *
 * El recorte fino (un auditor solo su sucursal) vive en
 * historial.permisos.ts, no aca -- mismo criterio que /api/usuarios.
 */
historialRouter.use(requiereSesion, requiereRol('administrador', 'auditor'));

// -- Lectura ----------------------------------------------------------------

historialRouter.get(
  '/inventarios',
  validar(listarInventariosQuerySchema, 'query'),
  controller.listarInventarios,
);

historialRouter.get(
  '/inventarios/:id',
  validar(parametrosInventarioSchema, 'params'),
  controller.obtenerDetalle,
);

historialRouter.get(
  '/inventarios/:id/diferencias',
  validar(parametrosInventarioSchema, 'params'),
  validar(listarDiferenciasQuerySchema, 'query'),
  controller.listarDiferencias,
);

historialRouter.get(
  '/inventarios/:id/liquidacion',
  validar(parametrosInventarioSchema, 'params'),
  controller.obtenerLiquidacion,
);

/** Recalcula el hash y lo compara con el sellado -- ver historial.lacrado.ts. */
historialRouter.get(
  '/inventarios/:id/lacrado/verificacion',
  validar(parametrosInventarioSchema, 'params'),
  controller.verificarSello,
);

historialRouter.get(
  '/items/:codigo',
  validar(parametrosItemSchema, 'params'),
  validar(historicoItemQuerySchema, 'query'),
  controller.historicoDeItem,
);

historialRouter.get('/comparativo', validar(comparativoQuerySchema, 'query'), controller.comparativo);

// -- Cierre: control de dos personas ----------------------------------------

/**
 * Una firma del colaborador de la SESION. El body solo acepta `nota`: si
 * llega un `aprobadorId`, el schema devuelve 400 (`.strict()`) en vez de
 * ignorarlo -- quien intenta firmar por otro tiene que enterarse.
 */
historialRouter.post(
  '/inventarios/:id/aprobaciones',
  validar(parametrosInventarioSchema, 'params'),
  validar(aprobarCierreSchema, 'body'),
  controller.aprobarCierre,
);

/** Exige DOS aprobaciones de personas distintas. Irreversible. */
historialRouter.post(
  '/inventarios/:id/lacrado',
  validar(parametrosInventarioSchema, 'params'),
  validar(lacrarSchema, 'body'),
  controller.lacrar,
);

/** Constancia del registro MANUAL en Dynamics (fase 2, ver README). */
historialRouter.post(
  '/inventarios/:id/lacrado/registro-erp',
  validar(parametrosInventarioSchema, 'params'),
  validar(registrarEnErpSchema, 'body'),
  controller.registrarEnErp,
);
