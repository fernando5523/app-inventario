/**
 * `liquidacionRouter` tiene DOS niveles de rol distintos, y es justo la
 * asimetría que un test a nivel de router no vería (liquidacion.routes.ts):
 *   - los GET (deSucursal, conciliación) los ven administrador, auditor Y
 *     coordinador -- es plata y nómina, no contiene `stockErp`, no hay
 *     conteo ciego que romper.
 *   - POST /inventarios/:id/liquidar tiene un `requiereRol` PROPIO, más
 *     estricto, SIN el auditor: el auditor es quien firma el lacrado
 *     después, y si pudiera liquidar y lacrar el control de dos personas
 *     se completaría solo.
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
vi.mock('./liquidacion.controller', () => controllerFalso(['deSucursal', 'conciliacion', 'liquidar']));

import { liquidacionRouter } from './liquidacion.routes';

const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
const CONTEO: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };

let cerrar: () => Promise<void>;
let baseUrl: string;

async function iniciar(): Promise<void> {
  const app = appDePrueba('/api/liquidacion', liquidacionRouter);
  ({ baseUrl, cerrar } = await levantar(app));
}

afterEach(async () => {
  await cerrar?.();
});

describe('GET /api/liquidacion/sucursales/:id: administrador, auditor y coordinador ven la liquidación', () => {
  it('sin sesión, 401', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/liquidacion/sucursales/1`);
    expect(r.status).toBe(401);
  });

  it('conteo, 403 -- el descuento de cada compañero no es asunto de quien cuenta', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/liquidacion/sucursales/1`, { headers: autorizacion(CONTEO) });
    expect(r.status).toBe(403);
  });

  it('coordinador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/liquidacion/sucursales/1`, { headers: autorizacion(COORDINADOR) });
    expect(r.status).toBe(200);
  });

  it('auditor, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/liquidacion/sucursales/1`, { headers: autorizacion(AUDITOR) });
    expect(r.status).toBe(200);
  });
});

describe('POST /api/liquidacion/inventarios/:id/liquidar: quién puede cerrar la planilla', () => {
  it('auditor, 403 -- si pudiera liquidar Y lacrar, el control de dos personas se completa solo', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/liquidacion/inventarios/1/liquidar`, {
      method: 'POST',
      headers: autorizacion(AUDITOR),
    });
    expect(r.status).toBe(403);
  });

  it('conteo, 403', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/liquidacion/inventarios/1/liquidar`, {
      method: 'POST',
      headers: autorizacion(CONTEO),
    });
    expect(r.status).toBe(403);
  });

  it('coordinador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/liquidacion/inventarios/1/liquidar`, {
      method: 'POST',
      headers: autorizacion(COORDINADOR),
    });
    expect(r.status).toBe(200);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/liquidacion/inventarios/1/liquidar`, {
      method: 'POST',
      headers: autorizacion(ADMIN),
    });
    expect(r.status).toBe(200);
  });
});
