/**
 * QUIEN PUEDE BAJAR EL STOCK DE UN RECONTEO: administrador y coordinador, el
 * MISMO criterio que `POST /api/d365/snapshot`.
 *
 * Este router se monta en `/api/inventarios`, el mismo prefijo que
 * `inventarios.routes.ts` y `asistencia.routes.ts`. Lo que estos casos fijan es
 * justamente lo que se rompe cuando alguien "ordena" ese archivo: el rol va POR
 * RUTA y no en el router, porque un `use(requiereRol(...))` aca corre para
 * CUALQUIER path que empiece con `/api/inventarios` -- incluidos los que
 * resuelve otro router -- y le cerraria al auditor el resumen de ronda, que es
 * suyo.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ColaboradorAutenticado } from '../../shared/tipos';
import { appDePrueba, autorizacion, controllerFalso, levantar } from '../../test-utils/http-test';

vi.mock('../sesion/sesion.service', () => ({
  verificarToken: async (token: string) => {
    try {
      return JSON.parse(token) as ColaboradorAutenticado;
    } catch {
      return null;
    }
  },
}));
vi.mock('./d365.stock-ronda.controller', () => controllerFalso(['bajarStockDeRonda', 'progresoStockDeRonda']));

import { stockRondaRouter } from './d365.stock-ronda.routes';

const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: null, rol: 'auditor' };
const CONTEO: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };

const RUTA = '/api/inventarios/8078/rondas/2/stock';

let cerrar: (() => Promise<void>) | undefined;

async function pedir(metodo: 'POST' | 'GET', ruta: string, actor?: ColaboradorAutenticado): Promise<number> {
  const app = appDePrueba('/api/inventarios', stockRondaRouter);
  const levantado = await levantar(app);
  cerrar = levantado.cerrar;
  const respuesta = await fetch(levantado.baseUrl + ruta, {
    method: metodo,
    headers: actor ? autorizacion(actor) : {},
  });
  return respuesta.status;
}

afterEach(async () => {
  await cerrar?.();
  cerrar = undefined;
});

describe('POST /api/inventarios/:id/rondas/:n/stock', () => {
  it('sin sesion, 401', async () => {
    expect(await pedir('POST', RUTA)).toBe(401);
  });

  it('coordinador: pasa -- es el paso suyo, el del wizard', async () => {
    expect(await pedir('POST', RUTA, COORDINADOR)).toBe(200);
  });

  it('administrador: pasa -- da soporte, igual que en el snapshot', async () => {
    expect(await pedir('POST', RUTA, ADMIN)).toBe(200);
  });

  it('auditor: 403 aunque lea toda la cadena -- esto ESCRIBE la vara que el audita', async () => {
    expect(await pedir('POST', RUTA, AUDITOR)).toBe(403);
  });

  it('rol conteo: 403 -- quien cuenta no elige la vara', async () => {
    expect(await pedir('POST', RUTA, CONTEO)).toBe(403);
  });

  it('una ronda que no es un numero, 400 del schema y no un 500', async () => {
    expect(await pedir('POST', '/api/inventarios/8078/rondas/dos/stock', COORDINADOR)).toBe(400);
  });

  it('la ronda 1 LLEGA al service: el rechazo con su explicacion es de negocio, no de validacion', async () => {
    // El schema acepta `min(1)` a proposito. Si cortara en 2, el error diria
    // "tiene que ser >= 2" y no a donde ir a buscar el stock del primer conteo.
    expect(await pedir('POST', '/api/inventarios/8078/rondas/1/stock', COORDINADOR)).toBe(200);
  });
});

describe('GET .../stock/progreso: los MISMOS roles que el POST', () => {
  it('sin sesion, 401', async () => {
    expect(await pedir('GET', `${RUTA}/progreso`)).toBe(401);
  });

  it('coordinador: pasa', async () => {
    expect(await pedir('GET', `${RUTA}/progreso`, COORDINADOR)).toBe(200);
  });

  it('auditor: 403 -- quien no puede lanzar la descarga no tiene por que ver su avance', async () => {
    expect(await pedir('GET', `${RUTA}/progreso`, AUDITOR)).toBe(403);
  });

  it('el GET del progreso no se come el POST ni al reves: son dos rutas distintas', async () => {
    // `/stock` y `/stock/progreso` conviven en el mismo router. Si el matcheo se
    // solapara, el sondeo lanzaria descargas.
    expect(await pedir('POST', RUTA, COORDINADOR)).toBe(200);
    expect(await pedir('GET', `${RUTA}/progreso`, COORDINADOR)).toBe(200);
  });
});
