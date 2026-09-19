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
  claseDynamics: 'unidad',
  empaqueCompra: 12,
  empaqueCompraSimbolo: 'Emp.12',
  clasificacion: {
    codigo: 'CERV-001',
    esEmpresa: true,
    clase: 'empresa',
    empaqueCompraCorregido: null,
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
  it('PUT /api/clasificacion/:codigo con { clase, nota } y devuelve la clasificación', async () => {
    const fn = stubFetch(json(PRODUCTO.clasificacion));
    const clas = await clasificacionApi.clasificar('CERV-001', { clase: 'empresa', nota: 'Robo: la asume la empresa' });

    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/clasificacion/CERV-001`);
    expect(init.method).toBe('PUT');
    // `empaqueCompraCorregido` viaja SIEMPRE, aunque sea null: es un PUT y el
    // cuerpo declara la excepción entera. Omitirlo cuando el Auditor borró la
    // corrección dejaría viva la anterior.
    expect(JSON.parse(init.body as string)).toEqual({
      clase: 'empresa',
      empaqueCompraCorregido: null,
      nota: 'Robo: la asume la empresa',
    });
    expect(clas.clase).toBe('empresa');
    expect(clas.esEmpresa).toBe(true);
  });

  /**
   * `esEmpresa` NO VIAJA en el cuerpo: lo deriva el servidor de la clase. Es
   * lo que impide que las dos columnas discrepen -- si la app mandara las dos,
   * un bug de la pantalla podría escribir `paquete` con `esEmpresa: true` y la
   * liquidación quedaría mirando una cosa distinta de la auditoría.
   */
  it('NUNCA manda esEmpresa: la invariante se cumple porque solo hay una fuente', async () => {
    const fn = stubFetch(json(PRODUCTO.clasificacion));
    await clasificacionApi.clasificar('CERV-001', { clase: 'paquete' });
    expect(JSON.parse(fn.mock.calls[0]![1].body as string)).not.toHaveProperty('esEmpresa');
  });

  it.each(['empresa', 'paquete', 'unidad'] as const)('manda la clase %s tal cual', async (clase) => {
    const fn = stubFetch(json({ ...PRODUCTO.clasificacion, clase }));
    await clasificacionApi.clasificar('CERV-001', { clase });
    expect(JSON.parse(fn.mock.calls[0]![1].body as string)).toEqual({ clase, empaqueCompraCorregido: null });
  });

  it('sin nota: no manda la clave nota', async () => {
    const fn = stubFetch(json({ ...PRODUCTO.clasificacion, nota: null }));
    await clasificacionApi.clasificar('CERV-001', { clase: 'empresa' });
    expect(JSON.parse(fn.mock.calls[0]![1].body as string)).toEqual({ clase: 'empresa', empaqueCompraCorregido: null });
  });

  /** Una excepción vieja llega con `clase: null` y SE PASA ASÍ: no se rellena. */
  it('una clasificación con clase null llega sin reinterpretarse', async () => {
    stubFetch(json({ ...PRODUCTO.clasificacion, clase: null }));
    const clas = await clasificacionApi.clasificar('CERV-001', { clase: 'empresa' });
    expect(clas.clase).toBeNull();
  });

  it('codigo con caracteres especiales va URL-encoded en la ruta', async () => {
    const fn = stubFetch(json(PRODUCTO.clasificacion));
    await clasificacionApi.clasificar('A/B 1', { clase: 'unidad' });
    expect(fn.mock.calls[0]![0]).toBe(`${BASE}/api/clasificacion/A%2FB%201`);
  });

  /**
   * EL EMPAQUE CORREGIDO viaja al servidor y vuelve en el DTO. CORREGIR EL
   * EMPAQUE NO ES CORREGIR EL STOCK: no hay ningún campo de stock en este
   * cuerpo, y no lo va a haber.
   */
  it('manda el empaque corregido y lo devuelve en la clasificación', async () => {
    const fn = stubFetch(json({ ...PRODUCTO.clasificacion, clase: 'paquete', empaqueCompraCorregido: 12 }));

    const clas = await clasificacionApi.clasificar('105621', { clase: 'paquete', empaqueCompraCorregido: 12 });

    expect(JSON.parse(fn.mock.calls[0]![1].body as string)).toMatchObject({ empaqueCompraCorregido: 12 });
    expect(clas.empaqueCompraCorregido).toBe(12);
  });

  it('el cuerpo nunca lleva stock: el del ERP no se edita desde ningún lado', async () => {
    const fn = stubFetch(json(PRODUCTO.clasificacion));
    await clasificacionApi.clasificar('105621', { clase: 'paquete', empaqueCompraCorregido: 12 });
    const cuerpo = JSON.parse(fn.mock.calls[0]![1].body as string);
    expect(Object.keys(cuerpo)).toEqual(['clase', 'empaqueCompraCorregido']);
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
