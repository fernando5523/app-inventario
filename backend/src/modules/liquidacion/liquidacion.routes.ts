import express, { Router } from 'express';
import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './liquidacion.controller';
import {
  confirmarAjustesNegativosQuerySchema,
  motivoLineaAjusteSchema,
  parametrosInventarioSchema,
  parametrosLineaAjusteSchema,
  parametrosSucursalSchema,
  registrarAjustesSchema,
} from './liquidacion.schema';

/**
 * Liquidacion y nomina (pantalla 6).
 *
 * SOLO el `auditor`, en TODOS los endpoints: leer la planilla y la
 * conciliacion, cargar los ajustes y cerrarla. Decision del cliente
 * (2026-09-11); el razonamiento -- y lo que deja abierto sobre el control de
 * dos personas -- esta en liquidacion.permisos.ts.
 *
 * Una sola barrera para todo el router y no un `requiereRol` por ruta: con un
 * permiso unico, uno propio en cada ruta es una copia mas que alguien se
 * olvida de actualizar. El service vuelve a chequear (`validarAcceso`): este
 * `requiereRol` es la primera barrera, no la unica.
 */
export const liquidacionRouter = Router();

liquidacionRouter.use(requiereSesion, requiereRol('auditor'));

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

/** Cerrar la planilla del inventario y dejarlo en `liquidado`. */
liquidacionRouter.post(
  '/inventarios/:inventarioId/liquidar',
  validar(parametrosInventarioSchema, 'params'),
  controller.liquidar,
);

/**
 * Los ajustes del mes: el paso que faltaba para poder liquidar. Cargarlos es
 * decidir cuanta plata NO se le descuenta al personal -- es parte de la
 * liquidacion, asi que el mismo permiso.
 */
liquidacionRouter.put(
  '/inventarios/:inventarioId/ajustes',
  validar(parametrosInventarioSchema, 'params'),
  validar(registrarAjustesSchema, 'body'),
  controller.registrarAjustes,
);

liquidacionRouter.get(
  '/inventarios/:inventarioId/ajustes',
  validar(parametrosInventarioSchema, 'params'),
  controller.estadoAjustes,
);

/**
 * EL EXCEL DE AJUSTES DE DYNAMICS (2026-09-11): reemplaza el monto de
 * negativos que se tipeaba a mano por la importación del archivo que ya
 * arma el área de negativos.
 *
 * El cuerpo es el .xlsx CRUDO, no JSON: `express.json()` (config/app.ts) es
 * global pero solo consume requests con Content-Type `application/json` y
 * deja pasar cualquier otro sin tocar el stream -- por eso este parser propio,
 * acotado a estas dos rutas, puede leer el archivo entero. El cliente NO debe
 * mandar `Content-Type: application/json` en estos dos POST.
 */
const cuerpoExcel = express.raw({ type: () => true, limit: '15mb' });

/** Vista previa: corre el lector y devuelve válidas/rechazadas/advertencias. NUNCA persiste. */
liquidacionRouter.post(
  '/inventarios/:inventarioId/ajustes-negativos/preview',
  validar(parametrosInventarioSchema, 'params'),
  cuerpoExcel,
  controller.previsualizarAjustesNegativos,
);

/** Confirmar: relee el mismo archivo y, si es válido, persiste la importación y recalcula montoNegativos. */
liquidacionRouter.post(
  '/inventarios/:inventarioId/ajustes-negativos/confirmar',
  validar(parametrosInventarioSchema, 'params'),
  validar(confirmarAjustesNegativosQuerySchema, 'query'),
  cuerpoExcel,
  controller.confirmarAjustesNegativos,
);

/** Excluir o reincluir una línea puntual de la importación vigente -- motivo obligatorio, recalcula montoNegativos. */
liquidacionRouter.patch(
  '/inventarios/:inventarioId/ajustes-negativos/lineas/:lineaId/excluir',
  validar(parametrosLineaAjusteSchema, 'params'),
  validar(motivoLineaAjusteSchema, 'body'),
  controller.excluirLineaAjusteNegativo,
);

liquidacionRouter.patch(
  '/inventarios/:inventarioId/ajustes-negativos/lineas/:lineaId/incluir',
  validar(parametrosLineaAjusteSchema, 'params'),
  validar(motivoLineaAjusteSchema, 'body'),
  controller.incluirLineaAjusteNegativo,
);
