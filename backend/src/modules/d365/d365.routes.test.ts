/**
 * `/api/d365` NO tiene un rol único: cada ruta decide el suyo, y las
 * diferencias son deliberadas.
 *
 *   · `/estado`             → cualquier sesión. Es un booleano ("¿hay
 *                             credenciales?") que la UI usa para avisar antes
 *                             de que alguien intente y falle.
 *   · `/almacenes`          → solo administrador. Alimenta el alta de tiendas.
 *   · `/snapshot`           → administrador y coordinador (paso 1 del wizard).
 *   · `/snapshot/progreso`  → los MISMOS que el POST: quien no puede lanzarlo
 *                             no tiene por qué ver su avance.
 *
 * Que estén en el mismo router y con roles distintos es justo lo que hace
 * falta fijar con tests: un `use(requiereRol(...))` agregado de más arriba
 * cerraría `/estado` para todos y nadie lo notaría hasta que la pantalla del
 * Coordinador dejara de avisar que faltan credenciales.
 */

import type { ColaboradorAutenticado } from '../../shared/tipos';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('./d365.controller', () => controllerFalso(['estado', 'snapshot', 'progresoSnapshot', 'almacenes']));

import { d365Router } from './d365.routes';

const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
const CONTEO: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };

let cerrar: () => Promise<void>;
let baseUrl: string;

async function iniciar(): Promise<void> {
  const app = appDePrueba('/api/d365', d365Router);
  ({ baseUrl, cerrar } = await levantar(app));
}

afterEach(async () => {
  await cerrar?.();
});

const post = (actor: ColaboradorAutenticado, cuerpo: unknown) => ({
  method: 'POST',
  headers: { ...autorizacion(actor), 'Content-Type': 'application/json' },
  body: JSON.stringify(cuerpo),
});

describe('GET /api/d365/estado: cualquier sesión', () => {
  it('sin sesión, 401 -- abierto a los roles, no a cualquiera', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/d365/estado`)).status).toBe(401);
  });

  it('conteo, pasa el middleware -- es solo "¿hay credenciales?"', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/d365/estado`, { headers: autorizacion(CONTEO) })).status).toBe(200);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/d365/estado`, { headers: autorizacion(ADMIN) })).status).toBe(200);
  });
});

describe('GET /api/d365/almacenes: solo el administrador', () => {
  it('coordinador, 403 -- un coordinador no da de alta sucursales', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/d365/almacenes`, { headers: autorizacion(COORDINADOR) })).status).toBe(403);
  });

  it('auditor, 403', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/d365/almacenes`, { headers: autorizacion(AUDITOR) })).status).toBe(403);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/d365/almacenes`, { headers: autorizacion(ADMIN) })).status).toBe(200);
  });
});

describe('POST /api/d365/snapshot: el paso 1 del Coordinador', () => {
  it('sin sesión, 401', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/d365/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sucursalId: 1 }),
    });
    expect(r.status).toBe(401);
  });

  it('conteo, 403 -- quien cuenta no abre el inventario', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/d365/snapshot`, post(CONTEO, { sucursalId: 1 }))).status).toBe(403);
  });

  it('auditor, 403 -- audita lo que otros contaron, no arma el universo', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/d365/snapshot`, post(AUDITOR, { sucursalId: 1 }))).status).toBe(403);
  });

  it('coordinador, pasa el middleware', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/d365/snapshot`, post(COORDINADOR, { sucursalId: 1 }))).status).toBe(200);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/d365/snapshot`, post(ADMIN, { sucursalId: 1 }))).status).toBe(200);
  });
});

/**
 * El progreso tiene que aceptar EXACTAMENTE a los mismos que el POST: es su
 * contracara. Si aceptara a más, cualquiera podría enterarse de que la
 * competencia... no, de que otra tienda está inventariando; si aceptara a
 * menos, el propio Coordinador que lanzó la bajada no podría ver su avance,
 * que es el bug que este endpoint vino a arreglar.
 */
describe('GET /api/d365/snapshot/progreso: los mismos que el POST', () => {
  it('sin sesión, 401', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/d365/snapshot/progreso?sucursalId=1`)).status).toBe(401);
  });

  it('coordinador, pasa el middleware -- es quien está esperando la barra', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/d365/snapshot/progreso?sucursalId=1`, {
      headers: autorizacion(COORDINADOR),
    });
    expect(r.status).toBe(200);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/d365/snapshot/progreso?sucursalId=1`, { headers: autorizacion(ADMIN) });
    expect(r.status).toBe(200);
  });

  it('conteo, 403 -- mismo rol que el POST, ni uno más', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/d365/snapshot/progreso?sucursalId=1`, { headers: autorizacion(CONTEO) });
    expect(r.status).toBe(403);
  });

  it('auditor, 403', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/d365/snapshot/progreso?sucursalId=1`, { headers: autorizacion(AUDITOR) });
    expect(r.status).toBe(403);
  });

  it('sin sucursalId, 400 -- no se sondea "el progreso" en abstracto', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/d365/snapshot/progreso`, { headers: autorizacion(COORDINADOR) });
    expect(r.status).toBe(400);
  });
});
