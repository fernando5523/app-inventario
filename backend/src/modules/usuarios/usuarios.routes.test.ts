/**
 * Quién entra a la gestión de cuentas.
 *
 * OJO CON LA EXPECTATIVA: no es "solo el administrador". El middleware es
 * `requiereRol('administrador', 'auditor')` y eso es DELIBERADO — el auditor
 * gestiona las cuentas de SU sucursal (la pantalla se llama "Usuarios de mi
 * sucursal"). El recorte fino —que no pueda tocar a otro auditor ni salir de
 * su tienda— vive en `usuarios.service.ts`, no en la ruta.
 *
 * Estos tests prueban lo único que la ruta decide: que coordinador y conteo
 * queden afuera. Lo otro tiene sus propios tests, sin Prisma.
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
vi.mock('./usuarios.controller', () =>
  controllerFalso(['listar', 'crear', 'editar', 'eliminar', 'actualizarEstado', 'resetearPin']),
);

import { usuariosRouter } from './usuarios.routes';

const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
const CONTEO: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };

let cerrar: () => Promise<void>;
let baseUrl: string;

async function iniciar(): Promise<void> {
  const app = appDePrueba('/api/usuarios', usuariosRouter);
  ({ baseUrl, cerrar } = await levantar(app));
}

afterEach(async () => {
  await cerrar?.();
});

const json = (actor: ColaboradorAutenticado) => ({
  ...autorizacion(actor),
  'Content-Type': 'application/json',
});

describe('GET /api/usuarios: quién ve el padrón de cuentas', () => {
  it('sin sesión, 401', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/usuarios`)).status).toBe(401);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/usuarios`, { headers: autorizacion(ADMIN) })).status).toBe(200);
  });

  it('auditor, pasa el middleware -- gestiona las cuentas de SU sucursal', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/usuarios`, { headers: autorizacion(AUDITOR) })).status).toBe(200);
  });

  it('coordinador, 403 -- reparte hojas, no crea cuentas', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/usuarios`, { headers: autorizacion(COORDINADOR) })).status).toBe(403);
  });

  it('conteo, 403', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/usuarios`, { headers: autorizacion(CONTEO) })).status).toBe(403);
  });
});

describe('POST /api/usuarios: crear una cuenta', () => {
  it('coordinador, 403', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/usuarios`, {
      method: 'POST',
      headers: json(COORDINADOR),
      // Body VÁLIDO a propósito: si el schema lo rechazara con 400, el test
      // pasaría por el motivo equivocado (400 también significa "el rol pasó
      // el middleware"). Con un body válido, 200 dice lo que queremos.
      body: JSON.stringify({ nombre: 'Ana Villanueva', dni: '45265662', rol: 'conteo', sucursalId: 1, pin: '000000' }),
    });
    expect(r.status).toBe(403);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/usuarios`, {
      method: 'POST',
      headers: json(ADMIN),
      // Body VÁLIDO a propósito: si el schema lo rechazara con 400, el test
      // pasaría por el motivo equivocado (400 también significa "el rol pasó
      // el middleware"). Con un body válido, 200 dice lo que queremos.
      body: JSON.stringify({ nombre: 'Ana Villanueva', dni: '45265662', rol: 'conteo', sucursalId: 1, pin: '000000' }),
    });
    expect(r.status).toBe(200);
  });
});

/**
 * Resetear un PIN es entregarle a otra persona la llave de una cuenta: si el
 * middleware dejara pasar a un coordinador, podría quedarse con la sesión de
 * cualquiera de su equipo — incluido el auditor que después firma el lacrado.
 */
describe('POST /api/usuarios/:id/resetear-pin: la llave de la cuenta de otro', () => {
  it('conteo, 403', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/usuarios/5/resetear-pin`, {
      method: 'POST',
      headers: json(CONTEO),
      body: JSON.stringify({ pin: '123456' }),
    });
    expect(r.status).toBe(403);
  });

  it('coordinador, 403', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/usuarios/5/resetear-pin`, {
      method: 'POST',
      headers: json(COORDINADOR),
      body: JSON.stringify({ pin: '123456' }),
    });
    expect(r.status).toBe(403);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/usuarios/5/resetear-pin`, {
      method: 'POST',
      headers: json(ADMIN),
      body: JSON.stringify({ pin: '123456' }),
    });
    expect(r.status).toBe(200);
  });
});

describe('DELETE /api/usuarios/:id: borrar una cuenta', () => {
  it('coordinador, 403', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/usuarios/5`, { method: 'DELETE', headers: autorizacion(COORDINADOR) });
    expect(r.status).toBe(403);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/usuarios/5`, { method: 'DELETE', headers: autorizacion(ADMIN) });
    expect(r.status).toBe(200);
  });
});
