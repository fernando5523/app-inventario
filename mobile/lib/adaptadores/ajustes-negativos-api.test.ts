/**
 * Tests del adaptador HTTP de la importación de ajustes de Dynamics, contra
 * la forma REAL del backend (backend/src/modules/liquidacion/liquidacion.ajustes-negativos.ts,
 * commit e39b370). Lo que se prueba: que el archivo viaje CRUDO (no JSON), que
 * la query/params se arme bien, y que exclude/incluye manden el motivo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

import { recordarToken, registrarLectorDeToken } from './_http';
import { ajustesNegativosApi } from './ajustes-negativos-api';

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

describe('estado', () => {
  it('GET /inventarios/:id/ajustes y devuelve montoNegativos tal cual (null incluido)', async () => {
    const fn = stubFetch(
      json({ inventarioId: 9, registrado: false, montoNegativos: null, montoFaltanteEmpresa: 170, nota: null, registradoPor: null, registradoEn: null }),
    );
    const estado = await ajustesNegativosApi.estado(9);
    expect(fn.mock.calls[0]![0]).toBe(`${BASE}/api/liquidacion/inventarios/9/ajustes`);
    expect(estado.montoNegativos).toBeNull();
  });

  it('con un monto ya importado (0 incluido), lo devuelve sin convertirlo en null', async () => {
    stubFetch(json({ inventarioId: 9, registrado: true, montoNegativos: 0, montoFaltanteEmpresa: 170, nota: 'x', registradoPor: null, registradoEn: null }));
    const estado = await ajustesNegativosApi.estado(9);
    expect(estado.montoNegativos).toBe(0);
  });
});

describe('previsualizar', () => {
  it('POST .../preview con el archivo CRUDO (no JSON), Content-Type de xlsx', async () => {
    const fn = stubFetch(json({ ok: true, validas: [], rechazadas: [], totalImporte: 0 }));
    const bytes = new Uint8Array([80, 75, 3, 4]);
    await ajustesNegativosApi.previsualizar(9, bytes);

    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/liquidacion/inventarios/9/ajustes-negativos/preview`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(bytes);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('devuelve ok:true con validas/rechazadas/totalImporte tal cual', async () => {
    const resultado = {
      ok: true,
      validas: [{ fila: 2, codigo: '101131', nombre2: 'Yogurt', importe: 30, motivoAjuste: 'x', responsable: 'Empleado', advertencias: [] }],
      rechazadas: [{ fila: 5, motivo: 'otra-tienda' }],
      totalImporte: 30,
    };
    stubFetch(json(resultado));
    await expect(ajustesNegativosApi.previsualizar(9, new Uint8Array([1]))).resolves.toEqual(resultado);
  });

  it('devuelve ok:false con motivo y detalle tal cual (columna faltante)', async () => {
    const resultado = { ok: false, motivo: 'columna-faltante', detalle: 'Faltan estas columnas: Importe.' };
    stubFetch(json(resultado));
    await expect(ajustesNegativosApi.previsualizar(9, new Uint8Array([1]))).resolves.toEqual(resultado);
  });
});

describe('confirmar', () => {
  it('POST .../confirmar?nombreArchivo=... con el archivo crudo, nombre URL-encoded', async () => {
    const fn = stubFetch(
      json({ importacionId: 42, inventarioId: 9, nombreArchivo: 'ajustes agosto.xlsx', importadoEn: '2026-09-14T10:00:00.000Z', cantidadValidas: 1, cantidadRechazadas: 0, montoNegativos: 30 }),
    );
    const bytes = new Uint8Array([80, 75, 3, 4]);
    const resultado = await ajustesNegativosApi.confirmar(9, bytes, 'ajustes agosto.xlsx');

    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/liquidacion/inventarios/9/ajustes-negativos/confirmar?nombreArchivo=ajustes%20agosto.xlsx`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(bytes);
    expect(resultado.montoNegativos).toBe(30);
    expect(resultado.importacionId).toBe(42);
  });

  it('0 líneas útiles: montoNegativos 0 explícito en la respuesta', async () => {
    stubFetch(
      json({ importacionId: 43, inventarioId: 9, nombreArchivo: 'vacio.xlsx', importadoEn: '2026-09-14T10:00:00.000Z', cantidadValidas: 0, cantidadRechazadas: 0, montoNegativos: 0 }),
    );
    const resultado = await ajustesNegativosApi.confirmar(9, new Uint8Array([1]), 'vacio.xlsx');
    expect(resultado.montoNegativos).toBe(0);
    expect(resultado.cantidadValidas).toBe(0);
  });
});

describe('excluirLinea / incluirLinea', () => {
  it('excluirLinea: PATCH .../lineas/:id/excluir con { motivo }, devuelve montoNegativos recalculado', async () => {
    const fn = stubFetch(
      json({
        montoNegativos: 15,
        linea: { id: 100, fila: 2, codigo: '101131', descripcion: 'Ajuste', importe: 30, excluida: true, motivoExclusion: 'El área se equivocó.', excluidaPor: { id: 5, nombre: 'Gilmer' }, excluidaEn: '2026-09-14T10:00:00.000Z' },
      }),
    );
    const resultado = await ajustesNegativosApi.excluirLinea(9, 100, 'El área se equivocó.');

    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/liquidacion/inventarios/9/ajustes-negativos/lineas/100/excluir`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ motivo: 'El área se equivocó.' });
    expect(resultado.montoNegativos).toBe(15);
    expect(resultado.linea.excluida).toBe(true);
  });

  it('incluirLinea: PATCH .../lineas/:id/incluir con { motivo }', async () => {
    const fn = stubFetch(
      json({
        montoNegativos: 30,
        linea: { id: 100, fila: 2, codigo: '101131', descripcion: 'Ajuste', importe: 30, excluida: false, motivoExclusion: null, excluidaPor: null, excluidaEn: null },
      }),
    );
    const resultado = await ajustesNegativosApi.incluirLinea(9, 100, 'Me equivoqué, sí corresponde.');

    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/liquidacion/inventarios/9/ajustes-negativos/lineas/100/incluir`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ motivo: 'Me equivoqué, sí corresponde.' });
    expect(resultado.linea.excluida).toBe(false);
  });
});
