/**
 * Las credenciales del ERP son del SISTEMA, no de una tienda:
 * `configDynamicsRouter.use(requiereSesion, requiereRol('administrador'))`.
 *
 * Un coordinador con acceso acá podría apuntar el backend entero a otro
 * tenant de Dynamics — y el snapshot del mes siguiente saldría de un ERP que
 * no es el de la empresa, sin que nada falle.
 *
 * La garantía de que el `clientSecret` no vuelve en ninguna respuesta se
 * prueba aparte, contra el service real: ver config-dynamics.secreto.test.ts.
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
vi.mock('./config-dynamics.controller', () => controllerFalso(['obtener', 'guardar', 'probarConexion']));

import { configDynamicsRouter } from './config-dynamics.routes';

const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
const CONTEO: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };

let cerrar: () => Promise<void>;
let baseUrl: string;

async function iniciar(): Promise<void> {
  const app = appDePrueba('/api/config-dynamics', configDynamicsRouter);
  ({ baseUrl, cerrar } = await levantar(app));
}

afterEach(async () => {
  await cerrar?.();
});

describe('GET /api/config-dynamics: solo el administrador', () => {
  it('sin sesión, 401', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/config-dynamics`)).status).toBe(401);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/config-dynamics`, { headers: autorizacion(ADMIN) })).status).toBe(200);
  });

  it('auditor, 403 -- las credenciales del ERP no son de una sucursal', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/config-dynamics`, { headers: autorizacion(AUDITOR) })).status).toBe(403);
  });

  it('coordinador, 403', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/config-dynamics`, { headers: autorizacion(COORDINADOR) })).status).toBe(403);
  });

  it('conteo, 403', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/config-dynamics`, { headers: autorizacion(CONTEO) })).status).toBe(403);
  });
});

describe('PUT /api/config-dynamics: cambiar a qué ERP apunta el sistema', () => {
  it('coordinador, 403 -- apuntar a otro tenant no falla: devuelve datos de otra empresa', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/config-dynamics`, {
      method: 'PUT',
      headers: { ...autorizacion(COORDINADOR), 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: 'x', clientId: 'y', urlBase: 'https://z' }),
    });
    expect(r.status).toBe(403);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/config-dynamics`, {
      method: 'PUT',
      headers: { ...autorizacion(ADMIN), 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: 'x', clientId: 'y', urlBase: 'https://z' }),
    });
    expect(r.status).toBe(200);
  });
});

describe('POST /api/config-dynamics/probar: usa el secreto guardado', () => {
  it('auditor, 403', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/config-dynamics/probar`, {
      method: 'POST',
      headers: autorizacion(AUDITOR),
    });
    expect(r.status).toBe(403);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/config-dynamics/probar`, {
      method: 'POST',
      headers: autorizacion(ADMIN),
    });
    expect(r.status).toBe(200);
  });
});
