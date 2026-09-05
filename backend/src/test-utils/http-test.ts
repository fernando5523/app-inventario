/**
 * Helper compartido por los tests de rutas HTTP (`*.routes.test.ts`).
 *
 * El objetivo de esos tests es UNA cosa: que el middleware de rol de cada
 * ruta (`requiereSesion` + `requiereRol`, declarado en el archivo de rutas)
 * deje pasar a quien corresponde y corte a quien no -- no que el controller
 * haga lo correcto (eso lo cubren los tests de `*.service.ts`/`*.permisos.ts`,
 * sin Prisma). Por eso cada archivo de test mockea el controller del modulo
 * con un handler trivial: si la request LLEGA a ejecutarse es porque el
 * middleware la dejo pasar.
 */

import type { Router } from 'express';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { errorMiddleware } from '../middleware/error.middleware';
import type { ColaboradorAutenticado } from '../shared/tipos';

/** App Express minima: JSON + el router bajo prueba, montado en `prefijo` + el manejador de errores REAL. */
export function appDePrueba(prefijo: string, router: Router): express.Express {
  const app = express();
  app.use(express.json());
  app.use(prefijo, router);
  app.use(errorMiddleware);
  return app;
}

/** Levanta `app` en un puerto efimero y devuelve la URL base + como cerrarlo. */
export async function levantar(app: express.Express): Promise<{ baseUrl: string; cerrar: () => Promise<void> }> {
  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    cerrar: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * El "token" es el propio colaborador, serializado. Cada archivo de test
 * mockea `sesion.service#verificarToken` para leerlo tal cual -- así se
 * simula "sesión por rol" sin tocar Prisma ni argon2.
 */
export function autorizacion(actor: ColaboradorAutenticado): Record<string, string> {
  return { Authorization: `Bearer ${JSON.stringify(actor)}` };
}

/**
 * Handlers triviales para reemplazar TODO un `*.controller.ts` real vía
 * `vi.mock`. Si la request llega a ejecutarse (200) es porque el middleware
 * de la ruta la dejó pasar -- eso es lo único que estos tests verifican.
 *
 * Se listan los nombres a mano (no un `Proxy` genérico): Vitest sintetiza el
 * namespace ESM del módulo mockeado enumerando las claves del objeto que
 * devuelve el factory, y un `Proxy` sin `ownKeys` no expone nada para
 * enumerar -- el import real (`import * as controller from './x.controller'`)
 * termina con `controller.loQueSea` vacío.
 */
export function controllerFalso(nombres: string[]): Record<string, (req: express.Request, res: express.Response) => void> {
  const handler = (_req: express.Request, res: express.Response): void => {
    res.status(200).json({ ok: true });
  };
  return Object.fromEntries(nombres.map((nombre) => [nombre, handler]));
}
