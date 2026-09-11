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
  controllerFalso([
    'deSucursal',
    'conciliacion',
    'liquidar',
    'registrarAjustes',
    'estadoAjustes',
    'previsualizarAjustesNegativos',
    'confirmarAjustesNegativos',
    'excluirLineaAjusteNegativo',
    'incluirLineaAjusteNegativo',
  ]),
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
  metodo: 'GET' | 'PUT' | 'POST' | 'PATCH';
  ruta: string;
  cuerpo?: unknown;
  /** El .xlsx crudo (bytes), no JSON -- ver `cuerpoExcel` en liquidacion.routes.ts. */
  crudo?: Buffer;
}

const ENDPOINTS: Endpoint[] = [
  { nombre: 'GET /sucursales/:id', metodo: 'GET', ruta: '/api/liquidacion/sucursales/1' },
  { nombre: 'GET /sucursales/:id/conciliacion', metodo: 'GET', ruta: '/api/liquidacion/sucursales/1/conciliacion' },
  { nombre: 'GET /inventarios/:id/ajustes', metodo: 'GET', ruta: '/api/liquidacion/inventarios/1/ajustes' },
  {
    nombre: 'PUT /inventarios/:id/ajustes',
    metodo: 'PUT',
    ruta: '/api/liquidacion/inventarios/1/ajustes',
    cuerpo: { nota: 'Mermas.' },
  },
  { nombre: 'POST /inventarios/:id/liquidar', metodo: 'POST', ruta: '/api/liquidacion/inventarios/1/liquidar' },
  {
    nombre: 'POST /inventarios/:id/ajustes-negativos/preview',
    metodo: 'POST',
    ruta: '/api/liquidacion/inventarios/1/ajustes-negativos/preview',
    crudo: Buffer.from('excel falso'),
  },
  {
    nombre: 'POST /inventarios/:id/ajustes-negativos/confirmar',
    metodo: 'POST',
    ruta: '/api/liquidacion/inventarios/1/ajustes-negativos/confirmar?nombreArchivo=ajustes.xlsx',
    crudo: Buffer.from('excel falso'),
  },
  {
    nombre: 'PATCH /inventarios/:id/ajustes-negativos/lineas/:id/excluir',
    metodo: 'PATCH',
    ruta: '/api/liquidacion/inventarios/1/ajustes-negativos/lineas/1/excluir',
    cuerpo: { motivo: 'El área de negativos puso mal el motivo.' },
  },
  {
    nombre: 'PATCH /inventarios/:id/ajustes-negativos/lineas/:id/incluir',
    metodo: 'PATCH',
    ruta: '/api/liquidacion/inventarios/1/ajustes-negativos/lineas/1/incluir',
    cuerpo: { motivo: 'Me equivoqué, sí corresponde.' },
  },
];

function pedir(e: Endpoint, actor?: ColaboradorAutenticado, cuerpo: unknown = e.cuerpo): Promise<Response> {
  if (e.crudo !== undefined) {
    return fetch(`${baseUrl}${e.ruta}`, {
      method: e.metodo,
      headers: { ...(actor ? autorizacion(actor) : {}) },
      body: e.crudo,
    });
  }
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

  it('sin nota, 400 -- un ajuste sin explicación no se puede auditar después', async () => {
    await iniciar();
    expect((await pedir(ajustes, AUDITOR, {})).status).toBe(400);
  });

  it('con nota vacía, 400', async () => {
    await iniciar();
    expect((await pedir(ajustes, AUDITOR, { nota: '   ' })).status).toBe(400);
  });

  /**
   * montoEmpresa YA NO se acepta (2026-09-14): la fuente de verdad del
   * faltante de empresa pasó a ser la clasificación que evalúa
   * `liquidacion.cierre.ts#liquidar` (ClasificacionProducto), no un monto
   * tipeado acá -- ver liquidacion.ajustes.ts. Sin `.strict()` a propósito:
   * un cliente viejo (mobile todavía sin actualizar) que lo siga mandando no
   * se tiene que romper -- Zod lo descarta solo, y el 200 lo prueba.
   */
  it('montoEmpresa YA NO se acepta: viaja igual (cliente viejo) pero el servidor lo ignora en silencio', async () => {
    await iniciar();
    expect((await pedir(ajustes, AUDITOR, { montoEmpresa: -100, nota: 'x' })).status).toBe(200);
  });

  it('solo nota, sin montoEmpresa, pasa: montoNegativos ya no se carga acá', async () => {
    await iniciar();
    expect((await pedir(ajustes, AUDITOR, { nota: 'Revisado, sin cambios en el monto de empresa.' })).status).toBe(
      200,
    );
  });
});

describe('POST /ajustes-negativos/confirmar: falta nombreArchivo', () => {
  it('sin el query nombreArchivo, 400', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/liquidacion/inventarios/1/ajustes-negativos/confirmar`, {
      method: 'POST',
      headers: { ...autorizacion(AUDITOR) },
      body: Buffer.from('excel falso'),
    });
    expect(r.status).toBe(400);
  });
});

describe('PATCH .../lineas/:id/excluir|incluir: motivo obligatorio', () => {
  it('sin motivo, 400', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/liquidacion/inventarios/1/ajustes-negativos/lineas/1/excluir`, {
      method: 'PATCH',
      headers: { ...autorizacion(AUDITOR), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });

  it('motivo vacío, 400', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/liquidacion/inventarios/1/ajustes-negativos/lineas/1/incluir`, {
      method: 'PATCH',
      headers: { ...autorizacion(AUDITOR), 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: '   ' }),
    });
    expect(r.status).toBe(400);
  });
});
