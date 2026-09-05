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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { limitadorIngreso } from './sesion.routes';

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
    expect(cuerpo.error).toBe('Demasiados intentos de ingreso. Volve a intentar en unos minutos.');
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
