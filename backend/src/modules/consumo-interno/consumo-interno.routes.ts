import { Router } from 'express';

import { validar } from '../../middleware/validation.middleware';
import { requiereAprobador } from './consumo-interno.auth';
import * as controller from './consumo-interno.controller';
import { decisionSchema, historialSchema, parametrosLineaSchema, parametrosSolicitudSchema } from './consumo-interno.schema';

/**
 * Aprobacion de consumo interno desde el telefono (pedido 4 del proyecto de
 * negativos). La aprobadora entra con Entra ID, no con el PIN del inventario:
 * por eso este router no usa `requiereSesion` / `requiereRol`.
 */
export const consumoInternoRouter = Router();

// Unica ruta sin token: emite uno de desarrollo, y solo con el doble candado abierto.
consumoInternoRouter.post('/sesion-dev', controller.sesionDev);

consumoInternoRouter.use(requiereAprobador);

consumoInternoRouter.get('/yo', controller.yo);
consumoInternoRouter.get('/solicitudes/pendientes', controller.pendientes);
consumoInternoRouter.get('/solicitudes/historial', validar(historialSchema, 'query'), controller.historial);
consumoInternoRouter.get('/solicitudes/:id', validar(parametrosSolicitudSchema, 'params'), controller.detalle);
consumoInternoRouter.post(
  '/solicitudes/:id/lineas/:linea/decision',
  validar(parametrosLineaSchema, 'params'),
  validar(decisionSchema, 'body'),
  controller.decidirLinea,
);
consumoInternoRouter.post(
  '/solicitudes/:id/decision',
  validar(parametrosSolicitudSchema, 'params'),
  validar(decisionSchema, 'body'),
  controller.decidirPendientes,
);
