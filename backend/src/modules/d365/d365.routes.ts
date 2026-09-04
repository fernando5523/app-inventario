import { Router } from 'express';
import { requiereSesion } from '../../middleware/auth.middleware';
import { requiereRol } from '../../middleware/autorizacion.middleware';
import { validar } from '../../middleware/validation.middleware';
import * as controller from './d365.controller';
import { crearSnapshotSchema } from './d365.schema';

export const d365Router = Router();

d365Router.use(requiereSesion);

/** Cualquier rol autenticado puede consultar si Dynamics esta configurado (ej. para avisar en la UI). */
d365Router.get('/estado', controller.estado);

/** Paso 1 del Coordinador -- administrador tambien puede, coordinador/conteo/auditor no. */
/**
 * Solo Administrador: alimenta el selector de almacen al crear una tienda.
 * Un coordinador no da de alta sucursales.
 */
d365Router.get('/almacenes', requiereRol('administrador'), controller.almacenes);

d365Router.post('/snapshot', requiereRol('administrador', 'coordinador'), validar(crearSnapshotSchema, 'body'), controller.snapshot);
