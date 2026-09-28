import { Router } from 'express';
import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './auditoria.controller';
import { cadenaQuerySchema, listarAuditablesQuerySchema, matrizQuerySchema, parametrosInventarioSchema } from './auditoria.schema';

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

/**
 * LA CADENA: las diez tiendas de un periodo en una sola llamada.
 *
 * `coordinador` ENTRA al router pero NO a esta ruta: el recorte vive en
 * `validarAccesoALaCadena` y no acá con un `requiereRol` propio, por lo mismo
 * que el resto del modulo -- una segunda lista de roles en el archivo de rutas
 * es media regla escrita en otro lugar, la mitad que alguien actualiza sin
 * mirar la otra.
 */
auditoriaRouter.get('/cadena', validar(cadenaQuerySchema, 'query'), controller.cadena);

/**
 * EL .XLSX QUE RESPALDA ESA TABLA: el detalle por producto de los faltantes y
 * sobrantes de todas las tiendas del periodo.
 *
 * MISMA query y MISMO permiso que `/cadena` -- `cadenaQuerySchema` y
 * `validarAccesoALaCadena`, sin un recorte propio. Son la tabla y su respaldo:
 * quien puede ver una cifra puede bajar el detalle que la explica, y al reves
 * seria peor (una tabla que no se puede auditar).
 *
 * VA ARRIBA DE CUALQUIER `/cadena/:algo` QUE ALGUIEN AGREGUE. Hoy no hay
 * ninguna ruta con parametro bajo `/cadena` -- `/cadena` es exacta y no captura
 * a esta -- pero un `/cadena/:sucursalId` declarado antes se comeria
 * `/cadena/diferencias` y devolveria 400 por un "sucursalId" que es una palabra.
 */
auditoriaRouter.get(
  '/cadena/diferencias/exportar',
  validar(cadenaQuerySchema, 'query'),
  controller.exportarDiferenciasDeLaCadena,
);

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
