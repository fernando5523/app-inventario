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
vi.mock('./liquidacion.controller', () =>
  controllerFalso(['deSucursal', 'conciliacion', 'liquidar', 'registrarAjustes', 'estadoAjustes']),
);

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

/**
 * LOS AJUSTES DEL MES: mismos roles que liquidar, y por la misma razón.
 * Cargar los ajustes es decidir cuánta plata NO se le descuenta al personal;
 * el auditor queda afuera porque es quien después firma el sello que incluye
 * esos montos.
 */
describe('PUT /api/liquidacion/inventarios/:id/ajustes: quién carga los ajustes', () => {
  const cargar = (actor?: ColaboradorAutenticado, cuerpo: unknown = { montoNegativos: 380, nota: 'Mermas.' }) => ({
    method: 'PUT',
    headers: {
      ...(actor ? autorizacion(actor) : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  });

  it('sin sesión, 401', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/liquidacion/inventarios/1/ajustes`, cargar())).status).toBe(401);
  });

  it('auditor, 403 -- firma el sello que incluye estos montos', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/liquidacion/inventarios/1/ajustes`, cargar(AUDITOR))).status).toBe(403);
  });

  it('conteo, 403', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/liquidacion/inventarios/1/ajustes`, cargar(CONTEO))).status).toBe(403);
  });

  it('coordinador, pasa el middleware', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/liquidacion/inventarios/1/ajustes`, cargar(COORDINADOR))).status).toBe(200);
  });

  it('administrador, pasa el middleware', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/liquidacion/inventarios/1/ajustes`, cargar(ADMIN))).status).toBe(200);
  });

  /** EL CASO QUE DESTRABA EL MES: 0 es un monto válido, no un campo vacío. */
  it('montoNegativos en 0 pasa la validación: "alguien miró y no había"', async () => {
    await iniciar();
    const r = await fetch(
      `${baseUrl}/api/liquidacion/inventarios/1/ajustes`,
      cargar(COORDINADOR, { montoNegativos: 0, nota: 'Revisado con Jocelyn: no hubo ajustes.' }),
    );
    expect(r.status).toBe(200);
  });

  it('sin nota, 400 -- un ajuste sin explicación no se puede auditar después', async () => {
    await iniciar();
    const r = await fetch(
      `${baseUrl}/api/liquidacion/inventarios/1/ajustes`,
      cargar(COORDINADOR, { montoNegativos: 380 }),
    );
    expect(r.status).toBe(400);
  });

  it('con nota vacía, 400', async () => {
    await iniciar();
    const r = await fetch(
      `${baseUrl}/api/liquidacion/inventarios/1/ajustes`,
      cargar(COORDINADOR, { montoNegativos: 380, nota: '   ' }),
    );
    expect(r.status).toBe(400);
  });

  it('monto negativo, 400 -- un ajuste que sube el faltante no es un ajuste', async () => {
    await iniciar();
    const r = await fetch(
      `${baseUrl}/api/liquidacion/inventarios/1/ajustes`,
      cargar(COORDINADOR, { montoNegativos: -100, nota: 'x' }),
    );
    expect(r.status).toBe(400);
  });
});

describe('GET /api/liquidacion/inventarios/:id/ajustes: ver qué hay cargado', () => {
  it('conteo, 403', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/liquidacion/inventarios/1/ajustes`, { headers: autorizacion(CONTEO) });
    expect(r.status).toBe(403);
  });

  it('coordinador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/liquidacion/inventarios/1/ajustes`, { headers: autorizacion(COORDINADOR) });
    expect(r.status).toBe(200);
  });
});
