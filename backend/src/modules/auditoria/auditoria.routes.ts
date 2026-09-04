import { Router } from 'express';
import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './auditoria.controller';
import { listarAuditablesQuerySchema, matrizQuerySchema, parametrosInventarioSchema } from './auditoria.schema';

/**
 * La matriz de auditoria: ERP contra los 3 conteos.
 *
 * EL ROL `conteo` NO ENTRA A ESTE ROUTER. No es una configuracion de
 * permisos que se pueda revisar mas adelante: esta pantalla contiene
 * `stockErp`, que es exactamente el numero que los 3 conteos cruzados
 * existen para no conocer. Un contador que lo ve deja de contar lo que hay
 * y pasa a confirmar lo que el sistema espera.
 *
 * `coordinador` SI entra al router, pero con un recorte que vive en
 * auditoria.permisos.ts porque depende del INVENTARIO y no solo del rol:
 * ve la matriz de inventarios ya cerrados, nunca la del que esta en curso.
 * El razonamiento completo esta en el comentario de
 * `validarAccesoALaMatriz` -- vale la pena leerlo antes de tocarlo.
 */
export const auditoriaRouter = Router();

auditoriaRouter.use(requiereSesion, requiereRol('administrador', 'auditor', 'coordinador'));

auditoriaRouter.get('/inventarios', validar(listarAuditablesQuerySchema, 'query'), controller.listarAuditables);

auditoriaRouter.get(
  '/inventarios/:inventarioId/resumen',
  validar(parametrosInventarioSchema, 'params'),
  controller.resumen,
);

auditoriaRouter.get(
  '/inventarios/:inventarioId/matriz',
  validar(parametrosInventarioSchema, 'params'),
  validar(matrizQuerySchema, 'query'),
  controller.matriz,
);
