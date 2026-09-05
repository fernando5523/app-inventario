/**
 * El histórico es territorio de conteo ciego: `coordinador` y `conteo` NO
 * pueden verlo, ni de refilón, porque ver el resultado del mes pasado (o el
 * faltante ya detectado de este) deja de ser contar a ciegas. La regla vive
 * en `historialRouter.use(requiereRol('administrador', 'auditor'))`
 * (historial.routes.ts) -- acá se prueba que el middleware realmente corta,
 * no que la intención esté documentada.
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
vi.mock('./historial.controller', () =>
  controllerFalso([
    'listarInventarios',
    'obtenerDetalle',
    'listarDiferencias',
    'obtenerLiquidacion',
    'estadoLacrado',
    'verificarSello',
    'historicoDeItem',
    'comparativo',
    'aprobarCierre',
    'lacrar',
    'registrarEnErp',
  ]),
);

import { historialRouter } from './historial.routes';

const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
const CONTEO: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };

let cerrar: () => Promise<void>;
let baseUrl: string;

async function iniciar(): Promise<void> {
  const app = appDePrueba('/api/historial', historialRouter);
  ({ baseUrl, cerrar } = await levantar(app));
}

afterEach(async () => {
  await cerrar?.();
});

describe('GET /api/historial/inventarios: quién ve el histórico', () => {
  it('sin sesión, 401', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/historial/inventarios`);
    expect(r.status).toBe(401);
  });

  it('coordinador, 403 -- el conteo ciego no le permite ver el histórico', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/historial/inventarios`, { headers: autorizacion(COORDINADOR) });
    expect(r.status).toBe(403);
  });

  it('conteo, 403 -- mismo motivo que coordinador', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/historial/inventarios`, { headers: autorizacion(CONTEO) });
    expect(r.status).toBe(403);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/historial/inventarios`, { headers: autorizacion(ADMIN) });
    expect(r.status).toBe(200);
  });

  it('auditor, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/historial/inventarios`, { headers: autorizacion(AUDITOR) });
    expect(r.status).toBe(200);
  });
});

describe('POST /api/historial/inventarios/:id/aprobaciones: quién puede firmar el cierre', () => {
  it('coordinador, 403 -- firma quien va a lacrar, coordinador no lacra', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/historial/inventarios/1/aprobaciones`, {
      method: 'POST',
      headers: { ...autorizacion(COORDINADOR), 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(r.status).toBe(403);
  });

  it('conteo, 403', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/historial/inventarios/1/aprobaciones`, {
      method: 'POST',
      headers: { ...autorizacion(CONTEO), 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(r.status).toBe(403);
  });

  it('auditor, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/historial/inventarios/1/aprobaciones`, {
      method: 'POST',
      headers: { ...autorizacion(AUDITOR), 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(r.status).toBe(200);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/historial/inventarios/1/aprobaciones`, {
      method: 'POST',
      headers: { ...autorizacion(ADMIN), 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(r.status).toBe(200);
  });
});

describe('POST /api/historial/inventarios/:id/lacrado: quién puede lacrar', () => {
  it('coordinador, 403', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/historial/inventarios/1/lacrado`, {
      method: 'POST',
      headers: { ...autorizacion(COORDINADOR), 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(r.status).toBe(403);
  });

  it('conteo, 403', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/historial/inventarios/1/lacrado`, {
      method: 'POST',
      headers: { ...autorizacion(CONTEO), 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(r.status).toBe(403);
  });

  it('auditor, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/historial/inventarios/1/lacrado`, {
      method: 'POST',
      headers: { ...autorizacion(AUDITOR), 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(r.status).toBe(200);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/historial/inventarios/1/lacrado`, {
      method: 'POST',
      headers: { ...autorizacion(ADMIN), 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(r.status).toBe(200);
  });
});
