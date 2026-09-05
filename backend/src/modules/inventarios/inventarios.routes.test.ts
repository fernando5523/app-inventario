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

/**
 * LOS PASOS 2 Y 3 DEL WIZARD: partir el catálogo en hojas y repartirlas.
 *
 * Quien reparte decide QUIÉN CUENTA QUÉ. Un contador que pudiera repartirse
 * las suyas elegiría las góndolas fáciles; el auditor tampoco, porque audita
 * lo que otros contaron y no arma el lote.
 *
 * OJO CON EL ALCANCE DE ESTOS TESTS: la ruta solo mira el ROL. Que un
 * coordinador no pueda tocar el inventario de OTRA sucursal lo resuelve
 * `inventarios.service.ts#inventarioDelActor` (compara
 * `inventario.sucursalId !== actor.sucursalId`, con el administrador exento
 * por no pertenecer a ninguna). Eso tiene sus propios tests, sin Prisma —
 * acá un coordinador de la sucursal 1 pasa el middleware aunque el
 * inventario 9 sea de otra tienda, y está bien que así sea.
 */
describe('POST /api/inventarios/:id/hojas: crear las hojas de conteo', () => {
  async function iniciar(): Promise<void> {
    const app = appDePrueba('/api/inventarios', inventariosRouter);
    ({ baseUrl, cerrar } = await levantar(app));
  }

  const crear = (actor?: ColaboradorAutenticado) => ({
    method: 'POST',
    headers: {
      ...(actor ? autorizacion(actor) : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tamano: 50 }),
  });

  it('sin sesión, 401', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/inventarios/9/hojas`, crear())).status).toBe(401);
  });

  it('conteo, 403 -- quien cuenta no se arma su propio lote', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/inventarios/9/hojas`, crear(CONTEO))).status).toBe(403);
  });

  it('auditor, 403 -- audita lo que otros contaron, no arma el lote', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/inventarios/9/hojas`, crear(AUDITOR))).status).toBe(403);
  });

  it('coordinador, pasa el middleware', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/inventarios/9/hojas`, crear(COORDINADOR))).status).toBe(200);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/inventarios/9/hojas`, crear(ADMIN))).status).toBe(200);
  });
});

describe('POST /api/inventarios/:id/hojas/asignar: repartir entre los contadores', () => {
  async function iniciar(): Promise<void> {
    const app = appDePrueba('/api/inventarios', inventariosRouter);
    ({ baseUrl, cerrar } = await levantar(app));
  }

  const asignar = (actor?: ColaboradorAutenticado) => ({
    method: 'POST',
    headers: {
      ...(actor ? autorizacion(actor) : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ colaboradorIds: [102, 104] }),
  });

  it('sin sesión, 401', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/inventarios/9/hojas/asignar`, asignar())).status).toBe(401);
  });

  it('conteo, 403 -- elegiría las góndolas fáciles', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/inventarios/9/hojas/asignar`, asignar(CONTEO))).status).toBe(403);
  });

  it('auditor, 403', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/inventarios/9/hojas/asignar`, asignar(AUDITOR))).status).toBe(403);
  });

  it('coordinador, pasa el middleware', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/inventarios/9/hojas/asignar`, asignar(COORDINADOR))).status).toBe(200);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/inventarios/9/hojas/asignar`, asignar(ADMIN))).status).toBe(200);
  });
});
