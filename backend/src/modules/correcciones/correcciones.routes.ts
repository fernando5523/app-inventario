import express, { Router } from 'express';
import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './correcciones.controller';
import { confirmarCorreccionesQuerySchema, exportarCorreccionesQuerySchema } from './correcciones.schema';

/**
 * CORRECCIÓN MASIVA DE CONTEOS POR EXCEL: exportar, corregir en Excel, volver
 * a importar.
 *
 * `requiereRol` con los TRES que corrigen, como primera barrera -- pero el
 * recorte real lo hace `ajuste.permisos.ts#validarCorreccion` desde el
 * service, por inventario: depende del ESTADO y de la SUCURSAL, no solo del
 * rol. Esta lista es la puerta de calle, no la regla.
 */
export const correccionesRouter = Router();

correccionesRouter.use(requiereSesion, requiereRol('administrador', 'auditor', 'coordinador'));

/** El .xlsx con lo contado del período, listo para corregir y volver a subir. */
correccionesRouter.get(
  '/exportar',
  validar(exportarCorreccionesQuerySchema, 'query'),
  controller.exportar,
);

/**
 * El cuerpo es el .xlsx CRUDO, no JSON: `express.json()` (config/app.ts) es
 * global pero solo consume requests con Content-Type `application/json` y deja
 * pasar cualquier otro sin tocar el stream -- por eso este parser propio,
 * acotado a estas dos rutas. El cliente NO debe mandar
 * `Content-Type: application/json` en estos dos POST.
 *
 * Mismo criterio y mismo límite que las dos rutas del Excel de negativos.
 */
const cuerpoExcel = express.raw({ type: () => true, limit: '15mb' });

/** Paso 1: clasificar cada fila. No escribe nada. */
correccionesRouter.post('/preview', cuerpoExcel, controller.previsualizar);

/** Paso 2: aplicar, fila por fila, por `hojas.service.ts#corregirConteo`. */
correccionesRouter.post(
  '/confirmar',
  validar(confirmarCorreccionesQuerySchema, 'query'),
  cuerpoExcel,
  controller.confirmar,
);
