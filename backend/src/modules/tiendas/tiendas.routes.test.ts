/**
 * Dar de alta una tienda es configuración del SISTEMA, no operación de una:
 * `tiendasRouter.use(requiereSesion, requiereRol('administrador'))`. Ni el
 * coordinador ni el auditor de una sucursal crean sucursales.
 *
 * Importa más de lo que parece: la tienda lleva el ALMACÉN de Dynamics, y de
 * ese almacén sale el stock contra el que se audita todo el mes. Quien puede
 * editarlo puede hacer que una tienda cuente contra el stock de otra —
 * números que parecen válidos y no fallan hasta fin de mes.
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
vi.mock('./tiendas.controller', () => controllerFalso(['listar', 'crear', 'actualizar']));

import { tiendasRouter } from './tiendas.routes';

const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
const CONTEO: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };

let cerrar: () => Promise<void>;
let baseUrl: string;

async function iniciar(): Promise<void> {
  const app = appDePrueba('/api/tiendas', tiendasRouter);
  ({ baseUrl, cerrar } = await levantar(app));
}

afterEach(async () => {
  await cerrar?.();
});

describe('GET /api/tiendas: solo el administrador', () => {
  it('sin sesión, 401', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/tiendas`)).status).toBe(401);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/tiendas`, { headers: autorizacion(ADMIN) });
    expect(r.status).toBe(200);
  });

  it('auditor, 403 -- audita SU tienda, no administra el padrón de tiendas', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/tiendas`, { headers: autorizacion(AUDITOR) });
    expect(r.status).toBe(403);
  });

  it('coordinador, 403', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/tiendas`, { headers: autorizacion(COORDINADOR) });
    expect(r.status).toBe(403);
  });

  it('conteo, 403', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/tiendas`, { headers: autorizacion(CONTEO) });
    expect(r.status).toBe(403);
  });
});

describe('POST /api/tiendas: crear una tienda (con su almacén de Dynamics)', () => {
  it('coordinador, 403 -- el almacén define contra qué stock se audita el mes', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/tiendas`, {
      method: 'POST',
      headers: { ...autorizacion(COORDINADOR), 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Market Nuevo' }),
    });
    expect(r.status).toBe(403);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/tiendas`, {
      method: 'POST',
      headers: { ...autorizacion(ADMIN), 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Market Nuevo' }),
    });
    expect(r.status).toBe(200);
  });
});

describe('PATCH /api/tiendas/:id: editar (incluido el almacén)', () => {
  it('auditor, 403 -- cambiarle el almacén a una tienda cambia todo su inventario', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/tiendas/1`, {
      method: 'PATCH',
      headers: { ...autorizacion(AUDITOR), 'Content-Type': 'application/json' },
      body: JSON.stringify({ almacenId: 'MD01_LUZ' }),
    });
    expect(r.status).toBe(403);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/tiendas/1`, {
      method: 'PATCH',
      headers: { ...autorizacion(ADMIN), 'Content-Type': 'application/json' },
      body: JSON.stringify({ almacenId: 'MD01_LUZ' }),
    });
    expect(r.status).toBe(200);
  });
});
