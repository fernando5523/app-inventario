/**
 * El control de dos personas de verdad: la regla vive en
 * historial.permisos.ts#validarPuedeAprobar (ya testeada sin Prisma en
 * historial.permisos.test.ts) — lo que ESTE archivo prueba es que la ruta
 * HTTP real (POST /inventarios/:id/aprobaciones -> historial.controller ->
 * historial.service) efectivamente la invoca con los datos correctos. Es la
 * diferencia entre "la función hace lo correcto" y "el endpoint la llama".
 *
 * A diferencia de historial.routes.test.ts, acá el controller NO se mockea:
 * hace falta que corra de verdad para llegar hasta la regla de negocio. Lo
 * que se mockea es Prisma, con lo mínimo que el camino recorrido necesita.
 */

import type { ColaboradorAutenticado } from '../../shared/tipos';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appDePrueba, autorizacion, levantar } from '../../test-utils/http-test';

vi.mock('../sesion/sesion.service', () => ({
  verificarToken: async (token: string) => {
    try {
      return JSON.parse(token) as ColaboradorAutenticado;
    } catch {
      return null;
    }
  },
}));

vi.mock('../../config/database', () => ({
  prisma: {
    inventario: { findUnique: vi.fn() },
    aprobacionCierre: { create: vi.fn(), findMany: vi.fn() },
    registroAuditoria: { create: vi.fn() },
  },
}));

import { prisma } from '../../config/database';
import { historialRouter } from './historial.routes';

const AUDITOR: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const OTRO_AUDITOR: ColaboradorAutenticado = { colaboradorId: 106, sucursalId: 1, rol: 'auditor' };

/** Inventario liquidado (único estado aprobable, ver ESTADOS_APROBABLES) de la sucursal 1. */
function inventarioLiquidado(aprobaciones: { aprobadorId: number }[]) {
  return { id: 1, sucursalId: 1, estado: 'liquidado', aprobaciones };
}

let cerrar: () => Promise<void>;
let baseUrl: string;

beforeEach(async () => {
  vi.mocked(prisma.inventario.findUnique).mockReset();
  vi.mocked(prisma.aprobacionCierre.create).mockReset();
  vi.mocked(prisma.aprobacionCierre.findMany).mockReset();
  vi.mocked(prisma.registroAuditoria.create).mockReset();

  const app = appDePrueba('/api/historial', historialRouter);
  ({ baseUrl, cerrar } = await levantar(app));
});

afterEach(async () => {
  await cerrar();
});

async function aprobar(actor: ColaboradorAutenticado): Promise<Response> {
  return fetch(`${baseUrl}/api/historial/inventarios/1/aprobaciones`, {
    method: 'POST',
    headers: { ...autorizacion(actor), 'Content-Type': 'application/json' },
    body: '{}',
  });
}

describe('POST /api/historial/inventarios/:id/aprobaciones: la misma persona no completa el par', () => {
  it('quien ya aprobó, 409 -- un control de dos personas que una sola puede completar no es un control', async () => {
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue(inventarioLiquidado([{ aprobadorId: AUDITOR.colaboradorId }]) as never);

    const r = await aprobar(AUDITOR);

    expect(r.status).toBe(409);
    const cuerpo = (await r.json()) as { error: string };
    expect(cuerpo.error).toContain('Ya aprobaste el cierre');
  });

  /**
   * DECISION DEL CLIENTE (2026-09-10): "por ahora" el lacrado se firma con
   * UNA sola firma -- hoy hay un solo auditor real (Gilmer) y exigir dos
   * bloqueaba el cierre para siempre. `APROBACIONES_REQUERIDAS` (leida de
   * `LACRADO_APROBACIONES_REQUERIDAS`, ver historial.lacrado.ts) sin la
   * variable seteada -- que es como corre esta suite -- da 1. Con UNA firma
   * ya registrada, una SEGUNDA persona que intente aprobar se encuentra el
   * par ya completo: exactamente el mismo control de dos personas de
   * siempre, con el minimo bajado a uno. La configurabilidad del NUMERO en
   * si (1 vs 2 vs N) ya esta probada sin HTTP en historial.permisos.test.ts
   * y historial.lacrado.test.ts -- esto solo confirma que la ruta real usa
   * la constante configurada, no un 2 propio.
   */
  it('con el minimo de hoy (1, sin variable seteada): una SEGUNDA persona ya encuentra el par completo', async () => {
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue(inventarioLiquidado([{ aprobadorId: AUDITOR.colaboradorId }]) as never);

    const r = await aprobar(OTRO_AUDITOR);

    expect(r.status).toBe(409);
    const cuerpo = (await r.json()) as { error: string };
    expect(cuerpo.error).toContain('Ya hay una firma registrada');
  });

  it('con el minimo de hoy (1): la PRIMERA firma ya alcanza -- 201, sin esperar una segunda persona', async () => {
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue(inventarioLiquidado([]) as never);
    vi.mocked(prisma.aprobacionCierre.create).mockResolvedValue({
      id: 1,
      inventarioId: 1,
      aprobadorId: AUDITOR.colaboradorId,
      rolAlAprobar: 'auditor',
      nota: null,
      aprobadoEn: new Date(),
      aprobador: { id: AUDITOR.colaboradorId, nombre: 'Gilmer Quispe' },
    } as never);
    vi.mocked(prisma.aprobacionCierre.findMany).mockResolvedValue([{ aprobadorId: AUDITOR.colaboradorId }] as never);
    vi.mocked(prisma.registroAuditoria.create).mockResolvedValue({} as never);

    const r = await aprobar(AUDITOR);

    expect(r.status).toBe(201);
    const cuerpo = (await r.json()) as { listoParaLacrar: boolean };
    expect(cuerpo.listoParaLacrar).toBe(true);
  });
});
