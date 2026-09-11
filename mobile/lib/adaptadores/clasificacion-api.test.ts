/**
 * Tests del adaptador HTTP de clasificación contra la forma REAL del backend
 * (backend/src/modules/clasificacion, commit ccf6052). Lo que se prueba: que
 * arme bien la URL/paginado/filtros, que mande el cuerpo correcto al
 * clasificar/desclasificar, y que los DOS datos (Dynamics y Auditor) lleguen a
 * la pantalla por separado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => ({}) }));

import { recordarToken, registrarLectorDeToken } from './_http';
import { clasificacionApi } from './clasificacion-api';

const BASE = 'http://servidor-de-prueba:3000';

function json(cuerpo: unknown, estado = 200): Response {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  } as unknown as Response;
}

function stubFetch(respuesta: Response) {
  const fn = vi.fn(async (_url: string, _init: RequestInit): Promise<Response> => respuesta);
  vi.stubGlobal('fetch', fn);
  return fn;
}

const PRODUCTO = {
  codigo: 'CERV-001',
  descripcion: 'Cerveza Pilsen 620ml',
  categoria: 'CERVEZAS',
  responsableDynamics: 'empleado',
  clasificacion: {
    codigo: 'CERV-001',
    esEmpresa: true,
    nota: 'Robo: la asume la empresa',
    clasificadoPorId: 103,
    clasificadoEn: '2026-09-11T12:00:00.000Z',
  },
};

const PAGINA = { total: 11800, limite: 50, desplazamiento: 0, productos: [PRODUCTO] };

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = BASE;
  recordarToken('token-de-prueba');
  registrarLectorDeToken(async () => null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.EXPO_PUBLIC_API_URL;
});

describe('buscar', () => {
  it('devuelve la página con los DOS datos separados: responsableDynamics Y clasificacion', async () => {
    stubFetch(json(PAGINA));
    const pagina = await clasificacionApi.buscar({ limite: 50, desplazamiento: 0 });
    expect(pagina.total).toBe(11800);
    expect(pagina.productos[0]!.responsableDynamics).toBe('empleado');
    expect(pagina.productos[0]!.clasificacion).toMatchObject({ esEmpresa: true, nota: 'Robo: la asume la empresa' });
  });

  it('arma la query con q, limite y desplazamiento; q va URL-encoded', async () => {
    const fn = stubFetch(json(PAGINA));
    await clasificacionApi.buscar({ q: 'cerveza pilsen', limite: 25, desplazamiento: 50 });
    const url = fn.mock.calls[0]![0];
    expect(url).toContain('/api/clasificacion?');
    expect(url).toContain('q=cerveza%20pilsen');
    expect(url).toContain('limite=25');
    expect(url).toContain('desplazamiento=50');
  });

  it('soloClasificados=true viaja solo cuando está prendido (nunca "false")', async () => {
    const fn = stubFetch(json(PAGINA));
    await clasificacionApi.buscar({ soloClasificados: true });
    expect(fn.mock.calls[0]![0]).toContain('soloClasificados=true');

    fn.mockClear();
    await clasificacionApi.buscar({ soloClasificados: false });
    expect(fn.mock.calls[0]![0]).not.toContain('soloClasificados');
  });

  it('sin filtro: GET /api/clasificacion, sin query', async () => {
    const fn = stubFetch(json(PAGINA));
    await clasificacionApi.buscar();
    expect(fn.mock.calls[0]![0]).toBe(`${BASE}/api/clasificacion`);
  });
});

describe('clasificar', () => {
  it('PUT /api/clasificacion/:codigo con { esEmpresa, nota } y devuelve la clasificación', async () => {
    const fn = stubFetch(json(PRODUCTO.clasificacion));
    const clas = await clasificacionApi.clasificar('CERV-001', { esEmpresa: true, nota: 'Robo: la asume la empresa' });

    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/clasificacion/CERV-001`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ esEmpresa: true, nota: 'Robo: la asume la empresa' });
    expect(clas.esEmpresa).toBe(true);
  });

  it('sin nota: no manda la clave nota', async () => {
    const fn = stubFetch(json({ ...PRODUCTO.clasificacion, nota: null }));
    await clasificacionApi.clasificar('CERV-001', { esEmpresa: true });
    expect(JSON.parse(fn.mock.calls[0]![1].body as string)).toEqual({ esEmpresa: true });
  });

  it('codigo con caracteres especiales va URL-encoded en la ruta', async () => {
    const fn = stubFetch(json(PRODUCTO.clasificacion));
    await clasificacionApi.clasificar('A/B 1', { esEmpresa: false });
    expect(fn.mock.calls[0]![0]).toBe(`${BASE}/api/clasificacion/A%2FB%201`);
  });
});

describe('desclasificar', () => {
  it('DELETE /api/clasificacion/:codigo (204, sin cuerpo)', async () => {
    const fn = stubFetch(json('', 204));
    await clasificacionApi.desclasificar('CERV-001');
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/clasificacion/CERV-001`);
    expect(init.method).toBe('DELETE');
  });
});
