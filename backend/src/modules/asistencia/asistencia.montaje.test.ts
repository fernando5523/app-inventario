/**
 * EL MONTAJE, que es lo frágil de este módulo.
 *
 * `asistenciaRouter` cuelga del MISMO prefijo que `inventariosRouter`
 * (`/api/inventarios`), así que Express los recorre en orden y el primero que
 * no resuelve la ruta se la pasa al siguiente. La trampa: un `requiereRol` a
 * nivel de router corre para CUALQUIER path del prefijo, incluidos los del
 * otro router. Si este módulo pusiera su rol arriba en vez de por ruta, un
 * auditor pidiendo el resumen de una ronda -- ruta suya, de otro router -- se
 * comería un 403 según de qué lado del `app.use` quedara montado.
 *
 * Por eso el test monta LOS DOS routers en el mismo orden que `config/app.ts`
 * y prueba los cuatro cruces. No es paranoia: es un 403 que aparecería solo al
 * reordenar dos líneas de app.ts, sin que fallara ningún test del otro módulo.
 */
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { errorMiddleware } from '../../middleware/error.middleware';
import { autorizacion, controllerFalso, levantar } from '../../test-utils/http-test';

vi.mock('../../modules/sesion/sesion.service', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  verificarToken: async (t: string) => { try { return JSON.parse(t); } catch { return null; } },
}));
vi.mock('../../modules/inventarios/inventarios.controller', () =>
  controllerFalso(['crearHojas', 'asignarHojas', 'resumenRonda', 'cerrarRonda', 'activo']));
vi.mock('./asistencia.controller', () => controllerFalso(['listar', 'marcar', 'borrar']));

import { inventariosRouter } from '../../modules/inventarios/inventarios.routes';
import { asistenciaRouter } from './asistencia.routes';

const AUDITOR: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: null, rol: 'auditor' };
const COORD: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };

let cerrar: () => Promise<void>; let baseUrl: string;
afterEach(async () => { await cerrar?.(); });

async function iniciar() {
  const app = express();
  app.use(express.json());
  // EL MISMO ORDEN QUE config/app.ts
  app.use('/api/inventarios', inventariosRouter);
  app.use('/api/inventarios', asistenciaRouter);
  app.use(errorMiddleware);
  ({ baseUrl, cerrar } = await levantar(app));
}

describe('dos routers en /api/inventarios', () => {
  it('el auditor SIGUE entrando al resumen de ronda (no se come el 403 de asistencia)', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/inventarios/8021/rondas/2/resumen`, { headers: autorizacion(AUDITOR) });
    expect(r.status).toBe(200);
  });

  it('el coordinador llega a la asistencia atravesando el router de inventarios', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/inventarios/8021/asistencia`, { headers: autorizacion(COORD) });
    expect(r.status).toBe(200);
  });

  it('el auditor sigue SIN entrar a la asistencia', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/inventarios/8021/asistencia`, { headers: autorizacion(AUDITOR) });
    expect(r.status).toBe(403);
  });

  it('una ruta que no existe en ninguno de los dos sigue siendo 404', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/inventarios/8021/nada`, { headers: autorizacion(COORD) });
    expect(r.status).toBe(404);
  });
});
