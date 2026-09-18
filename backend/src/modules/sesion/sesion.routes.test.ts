/**
 * El 429 del limitador de ingreso: cuántos segundos faltan para poder
 * reintentar.
 *
 * `express-rate-limit` ya manda el header `Retry-After`, pero mobile lee el
 * cuerpo (`{error, detalles}`, ver `_http.ts#intentarUnaVez`), nunca los
 * headers -- así que lo que importa para el cliente real es que
 * `detalles.reintentarEnSegundos` también esté. Se prueba montando SOLO el
 * limitador sobre una ruta mínima, sin tocar Prisma ni el resto del router:
 * lo que se verifica es el comportamiento del rate limit, no el login.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { appDePrueba, autorizacion, controllerFalso, levantar } from '../../test-utils/http-test';

vi.mock('./sesion.service', () => ({
  verificarToken: async (token: string) => {
    try {
      return JSON.parse(token) as ColaboradorAutenticado;
    } catch {
      return null;
    }
  },
}));
vi.mock('./sesion.controller', () =>
  controllerFalso(['sucursales', 'colaboradores', 'administradores', 'ingresar', 'cambiarPin']),
);

import { limitadorIngreso, sesionRouter } from './sesion.routes';

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  const app = express();
  app.use(express.json());
  app.post('/ingresar', limitadorIngreso, (req, res) => {
    res.status(200).json({ ok: true });
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Los 8 permitidos, para dejar al colaborador justo al límite. */
async function agotarIntentos(colaboradorId: number): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await fetch(`${baseUrl}/ingresar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colaboradorId }),
    });
  }
}

describe('limitadorIngreso: el 429', () => {
  it('trae el header Retry-After', async () => {
    await agotarIntentos(101);

    const respuesta = await fetch(`${baseUrl}/ingresar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colaboradorId: 101 }),
    });

    expect(respuesta.status).toBe(429);
    const retryAfter = Number(respuesta.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
  });

  it('trae detalles.reintentarEnSegundos en el body -- lo unico que mobile lee', async () => {
    await agotarIntentos(102);

    const respuesta = await fetch(`${baseUrl}/ingresar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colaboradorId: 102 }),
    });

    expect(respuesta.status).toBe(429);
    const cuerpo = (await respuesta.json()) as { error: string; detalles?: { reintentarEnSegundos?: number } };
    expect(cuerpo.error).toBe('Demasiados intentos de ingreso. Vuelve a intentar en unos minutos.');
    expect(cuerpo.detalles?.reintentarEnSegundos).toBeGreaterThan(0);
    expect(cuerpo.detalles?.reintentarEnSegundos).toBeLessThanOrEqual(15 * 60);
  });

  it('el numero del body coincide con el del header -- misma cuenta, dos lugares', async () => {
    await agotarIntentos(103);

    const respuesta = await fetch(`${baseUrl}/ingresar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colaboradorId: 103 }),
    });

    const retryAfter = Number(respuesta.headers.get('retry-after'));
    const cuerpo = (await respuesta.json()) as { detalles?: { reintentarEnSegundos?: number } };
    // No exactamente igual: cada uno se calcula con un Date.now() propio a
    // milisegundos de distancia. 1 segundo de margen alcanza sobrando.
    expect(Math.abs(retryAfter - (cuerpo.detalles?.reintentarEnSegundos ?? -999))).toBeLessThanOrEqual(1);
  });

  it('un colaborador distinto no hereda el límite de otro -- se cuenta por colaboradorId', async () => {
    await agotarIntentos(104);

    const respuesta = await fetch(`${baseUrl}/ingresar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colaboradorId: 999 }),
    });

    expect(respuesta.status).toBe(200);
  });
});

const ALGUIEN: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };

describe('POST /api/sesion/cambiar-pin: exige sesión', () => {
  let cerrarRouter: () => Promise<void>;
  let baseUrlRouter: string;

  beforeEach(async () => {
    const app = appDePrueba('/api/sesion', sesionRouter);
    ({ baseUrl: baseUrlRouter, cerrar: cerrarRouter } = await levantar(app));
  });

  afterEach(async () => {
    await cerrarRouter();
  });

  it('sin token, 401 -- ni siquiera llega a leer el body', async () => {
    const r = await fetch(`${baseUrlRouter}/api/sesion/cambiar-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinActual: '111111', pinNuevo: '222222' }),
    });
    expect(r.status).toBe(401);
  });

  it('token invalido (sesión vencida o inexistente), 401', async () => {
    const r = await fetch(`${baseUrlRouter}/api/sesion/cambiar-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer esto-no-es-json' },
      body: JSON.stringify({ pinActual: '111111', pinNuevo: '222222' }),
    });
    expect(r.status).toBe(401);
  });

  it('con sesión válida, cualquier rol pasa el middleware -- cambiar el PIN propio no exige un rol especial', async () => {
    const r = await fetch(`${baseUrlRouter}/api/sesion/cambiar-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...autorizacion(ALGUIEN) },
      body: JSON.stringify({ pinActual: '111111', pinNuevo: '222222' }),
    });
    expect(r.status).toBe(200);
  });
});

/**
 * El cupo de /cambiar-pin es por el colaborador de la SESIÓN, no por IP, y
 * va aparte del de /ingresar. Todas las requests de estos tests salen de
 * 127.0.0.1: justo el caso de la tienda (varios teléfonos detrás de la
 * misma WiFi). Con la clave vieja (`req.ip`, porque el body de cambiar-pin
 * no trae colaboradorId) todos compartían un único cupo de 8.
 *
 * No se resetea el limitador entre tests (mismo criterio que arriba): cada
 * test usa colaboradorIds propios que ningún otro toca.
 */
describe('POST /api/sesion/cambiar-pin: cupo por colaborador de la sesión', () => {
  let cerrarRouter: () => Promise<void>;
  let baseUrlRouter: string;

  beforeEach(async () => {
    const app = appDePrueba('/api/sesion', sesionRouter);
    ({ baseUrl: baseUrlRouter, cerrar: cerrarRouter } = await levantar(app));
  });

  afterEach(async () => {
    await cerrarRouter();
  });

  const sesionDe = (colaboradorId: number): Record<string, string> =>
    autorizacion({ colaboradorId, sucursalId: 1, rol: 'conteo' });

  function cambiarPin(encabezados: Record<string, string>, extra: Record<string, unknown> = {}): Promise<Response> {
    return fetch(`${baseUrlRouter}/api/sesion/cambiar-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...encabezados },
      body: JSON.stringify({ pinActual: '111111', pinNuevo: '222222', ...extra }),
    });
  }

  /** `colaboradorId` sin tipar a propósito: un test manda texto en su lugar. */
  function ingresar(colaboradorId: unknown): Promise<Response> {
    return fetch(`${baseUrlRouter}/api/sesion/ingresar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colaboradorId, pin: '111111' }),
    });
  }

  /** `veces` pedidos seguidos; devuelve los status en orden. */
  async function repetir(veces: number, pedido: () => Promise<Response>): Promise<number[]> {
    const estados: number[] = [];
    for (let i = 0; i < veces; i++) estados.push((await pedido()).status);
    return estados;
  }

  it('el mismo colaborador que se pasa de 8 recibe 429, con el contrato de siempre', async () => {
    expect(await repetir(8, () => cambiarPin(sesionDe(301)))).toEqual(Array(8).fill(200));

    const r = await cambiarPin(sesionDe(301));
    expect(r.status).toBe(429);
    const cuerpo = (await r.json()) as { error: string; detalles?: { reintentarEnSegundos?: number } };
    expect(cuerpo.error).toBe('Demasiados intentos de ingreso. Vuelve a intentar en unos minutos.');
    expect(cuerpo.detalles?.reintentarEnSegundos).toBeGreaterThan(0);
    expect(cuerpo.detalles?.reintentarEnSegundos).toBeLessThanOrEqual(15 * 60);
  });

  it('dos colaboradores desde la MISMA IP no comparten el cupo', async () => {
    await repetir(8, () => cambiarPin(sesionDe(302)));
    expect((await cambiarPin(sesionDe(302))).status).toBe(429);

    // Mismo 127.0.0.1, otra persona: con la clave por IP, esto era 429.
    expect((await cambiarPin(sesionDe(303))).status).toBe(200);
  });

  // Cupos separados, según el plan D de backend/README.md: 8 ingresos
  // fallidos con el id de alguien no le bloquean el cambio de PIN legítimo.
  it('agotar /ingresar de un colaborador no le bloquea el /cambiar-pin', async () => {
    await repetir(8, () => ingresar(304));
    expect((await ingresar(304)).status).toBe(429);

    expect((await cambiarPin(sesionDe(304))).status).toBe(200);
  });

  it('y al revés: agotar /cambiar-pin de un colaborador no le bloquea el /ingresar', async () => {
    await repetir(8, () => cambiarPin(sesionDe(308)));
    expect((await cambiarPin(sesionDe(308))).status).toBe(429);

    expect((await ingresar(308)).status).toBe(200);
  });

  it('un body de /ingresar no puede sumar al cupo de /cambiar-pin de nadie', async () => {
    // Si la clave de /ingresar fuera el valor del body a secas, este texto
    // caería justo en la clave de cambio de PIN de 309. `validar` lo rechaza
    // con 400, pero el limitador corre antes y ya contó.
    expect(await repetir(8, () => ingresar('cambiar-pin:309'))).toEqual(Array(8).fill(400));

    expect((await cambiarPin(sesionDe(309))).status).toBe(200);
  });

  it('sin sesión da 401 y no consume cupo', async () => {
    // 10 > 8 a propósito: si el limitador contara estos pedidos (bajo
    // cualquier clave, la IP incluida), los últimos saldrían 429.
    const sinSesionValida: Array<Record<string, string>> = [
      ...Array.from({ length: 5 }, () => ({})),
      ...Array.from({ length: 5 }, () => ({ Authorization: 'Bearer esto-no-es-json' })),
    ];
    for (const encabezados of sinSesionValida) {
      const r = await cambiarPin(encabezados);
      expect(r.status).toBe(401);
      // El limitador ni corrió: no dejó sus headers.
      expect(r.headers.get('ratelimit-remaining')).toBeNull();
    }

    // El primer pedido CON sesión, desde la misma IP, arranca con el cupo entero.
    const r = await cambiarPin(sesionDe(305));
    expect(r.status).toBe(200);
    expect(r.headers.get('ratelimit-remaining')).toBe('7');
  });

  it('la clave sale de la sesión, no del body: un colaboradorId ajeno no gasta el cupo de otro', async () => {
    // `.strict()` rechaza este body con 400, pero el limitador corre antes
    // y ya contó: tiene que haberle contado a 306, que es quien tiene la sesión.
    expect(await repetir(8, () => cambiarPin(sesionDe(306), { colaboradorId: 307 }))).toEqual(Array(8).fill(400));

    expect((await cambiarPin(sesionDe(306))).status).toBe(429);
    expect((await cambiarPin(sesionDe(307))).status).toBe(200);
  });
});
