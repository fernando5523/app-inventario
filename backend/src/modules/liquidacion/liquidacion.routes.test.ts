/**
 * `liquidacionRouter` ENTERO es del auditor -- decisión del cliente
 * (2026-09-11): "el Coordinador deja de ver la liquidacion y ejecutarlo, ahora
 * lo realiza el auditor".
 *
 * Antes había dos niveles (los GET para administrador/auditor/coordinador, las
 * escrituras sin el auditor). Ahora hay uno solo, y se prueba ENDPOINT POR
 * ENDPOINT: un `requiereRol` propio que quedó colgado en una ruta es justo lo
 * que un test a nivel de router no vería.
 *
 * El coordinador recibe 403 TAMBIÉN en las lecturas: lo que pidió Gilmer es
 * que no vea el resultado, no solo que no lo ejecute.
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

interface Endpoint {
  nombre: string;
  metodo: 'GET' | 'PUT' | 'POST';
  ruta: string;
  cuerpo?: unknown;
}

const ENDPOINTS: Endpoint[] = [
  { nombre: 'GET /sucursales/:id', metodo: 'GET', ruta: '/api/liquidacion/sucursales/1' },
  { nombre: 'GET /sucursales/:id/conciliacion', metodo: 'GET', ruta: '/api/liquidacion/sucursales/1/conciliacion' },
  { nombre: 'GET /inventarios/:id/ajustes', metodo: 'GET', ruta: '/api/liquidacion/inventarios/1/ajustes' },
  {
    nombre: 'PUT /inventarios/:id/ajustes',
    metodo: 'PUT',
    ruta: '/api/liquidacion/inventarios/1/ajustes',
    cuerpo: { montoNegativos: 380, nota: 'Mermas.' },
  },
  { nombre: 'POST /inventarios/:id/liquidar', metodo: 'POST', ruta: '/api/liquidacion/inventarios/1/liquidar' },
];

function pedir(e: Endpoint, actor?: ColaboradorAutenticado, cuerpo: unknown = e.cuerpo): Promise<Response> {
  return fetch(`${baseUrl}${e.ruta}`, {
    method: e.metodo,
    headers: {
      ...(actor ? autorizacion(actor) : {}),
      ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
  });
}

describe.each(ENDPOINTS)('$nombre: solo el auditor', (e) => {
  it('sin sesión, 401', async () => {
    await iniciar();
    expect((await pedir(e)).status).toBe(401);
  });

  it('auditor, pasa el middleware', async () => {
    await iniciar();
    expect((await pedir(e, AUDITOR)).status).toBe(200);
  });

  it('coordinador, 403 -- tampoco para mirar: el resultado del inventario no es asunto suyo', async () => {
    await iniciar();
    expect((await pedir(e, COORDINADOR)).status).toBe(403);
  });

  it('administrador, 403 -- es técnico, no participa del proceso de inventario', async () => {
    await iniciar();
    expect((await pedir(e, ADMIN)).status).toBe(403);
  });

  it('conteo, 403 -- el descuento de cada compañero no es asunto de quien cuenta', async () => {
    await iniciar();
    expect((await pedir(e, CONTEO)).status).toBe(403);
  });
});

describe('PUT /api/liquidacion/inventarios/:id/ajustes: el cuerpo', () => {
  const ajustes = ENDPOINTS.find((e) => e.metodo === 'PUT')!;

  /** EL CASO QUE DESTRABA EL MES: 0 es un monto válido, no un campo vacío. */
  it('montoNegativos en 0 pasa la validación: "alguien miró y no había"', async () => {
    await iniciar();
    const r = await pedir(ajustes, AUDITOR, { montoNegativos: 0, nota: 'Revisado con Jocelyn: no hubo ajustes.' });
    expect(r.status).toBe(200);
  });

  it('sin nota, 400 -- un ajuste sin explicación no se puede auditar después', async () => {
    await iniciar();
    expect((await pedir(ajustes, AUDITOR, { montoNegativos: 380 })).status).toBe(400);
  });

  it('con nota vacía, 400', async () => {
    await iniciar();
    expect((await pedir(ajustes, AUDITOR, { montoNegativos: 380, nota: '   ' })).status).toBe(400);
  });

  it('monto negativo, 400 -- un ajuste que sube el faltante no es un ajuste', async () => {
    await iniciar();
    expect((await pedir(ajustes, AUDITOR, { montoNegativos: -100, nota: 'x' })).status).toBe(400);
  });
});
