import { Router } from 'express';
import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './liquidacion.controller';
import { parametrosInventarioSchema, parametrosSucursalSchema, registrarAjustesSchema } from './liquidacion.schema';

/**
 * Liquidacion y nomina (pantalla 6).
 *
 * El `coordinador` SI entra -- al reves que en /api/auditoria, y a
 * proposito: la liquidacion es plata y nomina, no contiene `stockErp` y por
 * lo tanto no hay conteo ciego que romper. El razonamiento completo esta en
 * liquidacion.permisos.ts; vale la pena leerlo junto con el de auditoria.
 *
 * El rol `conteo` no entra: el descuento de cada companero no es asunto de
 * quien cuenta. Cada persona ve el suyo en el recibo, no la planilla de los once.
 *
 * El recorte por sucursal vive en liquidacion.permisos.ts, no aca.
 */
export const liquidacionRouter = Router();

liquidacionRouter.use(requiereSesion, requiereRol('administrador', 'auditor', 'coordinador'));

liquidacionRouter.get(
  '/sucursales/:sucursalId',
  validar(parametrosSucursalSchema, 'params'),
  controller.deSucursal,
);

liquidacionRouter.get(
  '/sucursales/:sucursalId/conciliacion',
  validar(parametrosSucursalSchema, 'params'),
  controller.conciliacion,
);

/**
 * Cerrar la planilla del inventario y dejarlo en `liquidado`.
 *
 * SIN el auditor, al reves que los dos GET de arriba: el auditor es quien
 * FIRMA el lacrado, y el sello incluye la planilla. Si pudiera cerrarla y
 * despues firmarla, el control de dos personas se completa solo. El recorte
 * fino vive en liquidacion.permisos.ts#validarPuedeLiquidar; este
 * `requiereRol` es la primera barrera, no la unica.
 */
liquidacionRouter.post(
  '/inventarios/:inventarioId/liquidar',
  requiereRol('administrador', 'coordinador'),
  validar(parametrosInventarioSchema, 'params'),
  controller.liquidar,
);

/**
 * Los ajustes del mes: el paso que faltaba para poder liquidar.
 *
 * MISMOS roles que liquidar y por la misma razón -- cargar los ajustes es
 * decidir cuánta plata NO se le descuenta al personal, y el auditor queda
 * afuera porque es quien después firma el sello que incluye esos montos.
 *
 * El GET también: quien no puede cargarlos tampoco necesita verlos, y el
 * estado ya viaja dentro de `GET /liquidacion/sucursales/:id` para las
 * pantallas que solo miran.
 */
liquidacionRouter.put(
  '/inventarios/:inventarioId/ajustes',
  requiereRol('administrador', 'coordinador'),
  validar(parametrosInventarioSchema, 'params'),
  validar(registrarAjustesSchema, 'body'),
  controller.registrarAjustes,
);

liquidacionRouter.get(
  '/inventarios/:inventarioId/ajustes',
  requiereRol('administrador', 'coordinador'),
  validar(parametrosInventarioSchema, 'params'),
  controller.estadoAjustes,
);
