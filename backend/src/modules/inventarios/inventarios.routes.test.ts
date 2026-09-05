/**
 * inventarios.routes.ts expone DOS routers con acceso distinto:
 *   - `inventariosRouter` (crear/repartir hojas, cerrar ronda): SOLO
 *     administrador y coordinador -- quien reparte decide QUIÉN cuenta QUÉ,
 *     y el auditor audita lo que otros ya contaron, no arma el lote.
 *   - `sucursalesInventariosRouter` (inventario activo): los 4 roles. El
 *     Contador y el Auditor necesitan saber si hay un inventario abierto
 *     para elegir la pantalla correcta -- lo que NO pueden es crear ni
 *     repartir, que son las rutas del otro router.
 *
 * Cerrar la ronda es la decisión más grave de las dos (recuenta a ONCE
 * personas si se equivoca), así que es el caso que se prueba acá.
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
vi.mock('./inventarios.controller', () =>
  controllerFalso(['activo', 'crearHojas', 'asignarHojas', 'resumenRonda', 'cerrarRonda']),
);

import { inventariosRouter, sucursalesInventariosRouter } from './inventarios.routes';

const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
const CONTEO: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };

let cerrar: () => Promise<void>;
let baseUrl: string;

afterEach(async () => {
  await cerrar?.();
});

describe('POST /api/inventarios/:id/rondas/:ronda/cerrar: quién puede cerrar la ronda', () => {
  async function iniciar(): Promise<void> {
    const app = appDePrueba('/api/inventarios', inventariosRouter);
    ({ baseUrl, cerrar } = await levantar(app));
  }

  it('sin sesión, 401', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/inventarios/1/rondas/1/cerrar`, { method: 'POST' });
    expect(r.status).toBe(401);
  });

  it('auditor, 403 -- audita lo que otros contaron, no decide el reparto del recuento', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/inventarios/1/rondas/1/cerrar`, {
      method: 'POST',
      headers: autorizacion(AUDITOR),
    });
    expect(r.status).toBe(403);
  });

  it('conteo, 403', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/inventarios/1/rondas/1/cerrar`, {
      method: 'POST',
      headers: autorizacion(CONTEO),
    });
    expect(r.status).toBe(403);
  });

  it('coordinador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/inventarios/1/rondas/1/cerrar`, {
      method: 'POST',
      headers: autorizacion(COORDINADOR),
    });
    expect(r.status).toBe(200);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/inventarios/1/rondas/1/cerrar`, {
      method: 'POST',
      headers: autorizacion(ADMIN),
    });
    expect(r.status).toBe(200);
  });
});

describe('GET /api/sucursales/:id/inventarios/activo: los 4 roles operativos entran', () => {
  async function iniciar(): Promise<void> {
    const app = appDePrueba('/api/sucursales', sucursalesInventariosRouter);
    ({ baseUrl, cerrar } = await levantar(app));
  }

  it('sin sesión, 401', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/sucursales/1/inventarios/activo`);
    expect(r.status).toBe(401);
  });

  it('conteo, pasa el middleware -- necesita saber si hay inventario abierto para elegir su pantalla', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/sucursales/1/inventarios/activo`, { headers: autorizacion(CONTEO) });
    expect(r.status).toBe(200);
  });

  it('auditor, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/sucursales/1/inventarios/activo`, { headers: autorizacion(AUDITOR) });
    expect(r.status).toBe(200);
  });

  it('coordinador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/sucursales/1/inventarios/activo`, { headers: autorizacion(COORDINADOR) });
    expect(r.status).toBe(200);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/sucursales/1/inventarios/activo`, { headers: autorizacion(ADMIN) });
    expect(r.status).toBe(200);
  });
});
