import { Router } from 'express';
import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './liquidacion.reporte-gerencia.controller';
import { parametrosInventarioSchema } from './liquidacion.schema';

/**
 * Reporte a gerencia (liquidacion v2): sobrantes y faltantes DETALLADOS de
 * productos de empresa, por inventario. Archivo APARTE de liquidacion.routes.ts
 * a proposito -- ese router esta en desarrollo activo (Excel de ajustes,
 * min-5) y montar esta ruta ahi habria significado dos personas tocando el
 * mismo archivo a la vez. Mismo permiso (`auditor`), reusado sin modificar
 * liquidacion.permisos.ts.
 */
export const reporteGerenciaRouter = Router();

reporteGerenciaRouter.use(requiereSesion, requiereRol('auditor'));

reporteGerenciaRouter.get(
  '/inventarios/:inventarioId/reporte-gerencia',
  validar(parametrosInventarioSchema, 'params'),
  controller.reporteGerencia,
);

/**
 * El MISMO reporte en .xlsx, para compartir por WhatsApp/correo. Mismos
 * guardas (auditor; liquidado o lacrado) porque sale de la misma funcion --
 * ver liquidacion.reporte-gerencia.exportar.ts.
 */
reporteGerenciaRouter.get(
  '/inventarios/:inventarioId/reporte-gerencia/exportar',
  validar(parametrosInventarioSchema, 'params'),
  controller.exportarReporteGerencia,
);
