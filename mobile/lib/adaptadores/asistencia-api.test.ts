/**
 * Lo que estos tests protegen no es el JSON: es la URL, el método y el
 * cuerpo. Una marca que sale contra el inventario equivocado, o un DELETE
 * sin el `dia`, borra la jornada de otra persona — y del otro lado no hay
 * forma de notarlo hasta que la planilla le descuenta un día de más a
 * alguien.
 *
 * El GET no traduce nada (el DTO calza exacto con `AsistenciaInventario`),
 * así que lo que se verifica de él es que pegue donde tiene que pegar y que
 * pase la respuesta entera, `dias` incluidos.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => ({}) }));

import { recordarToken } from './_http';
import { asistenciaApi } from './asistencia-api';

function json(cuerpo: unknown, estado = 200): Response {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  } as unknown as Response;
}

beforeEach(() => {
  recordarToken('token-de-prueba');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('asistenciaApi.deInventario', () => {
  it('pega contra /api/inventarios/:id/asistencia y pasa la respuesta tal cual', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({
        dias: ['2026-09-14', '2026-09-15'],
        marcas: [{ colaboradorId: 302, dia: '2026-09-14', registradoEn: '2026-09-14T13:02:00.000Z' }],
        personal: [{ id: 302, nombre: 'Silvia Huerta', rol: 'conteo' }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const asistencia = await asistenciaApi.deInventario(8021);

    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/inventarios/8021/asistencia');
    expect(asistencia.dias).toEqual(['2026-09-14', '2026-09-15']);
    expect(asistencia.marcas[0].registradoEn).toBe('2026-09-14T13:02:00.000Z');
    expect(asistencia.personal[0].nombre).toBe('Silvia Huerta');
  });

  /** Un inventario sin marcas devuelve listas vacías: es un dato, no un error. */
  it('sin ninguna marca no truena: las tres listas vacías son la respuesta correcta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ dias: [], marcas: [], personal: [] })));

    await expect(asistenciaApi.deInventario(8021)).resolves.toMatchObject({ dias: [], marcas: [] });
  });
});

describe('asistenciaApi.marcar', () => {
  it('manda POST con colaboradorId y día en el cuerpo', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({}, 201));
    vi.stubGlobal('fetch', fetchMock);

    await asistenciaApi.marcar(8021, 302, '2026-09-15');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/inventarios/8021/asistencia');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ colaboradorId: 302, dia: '2026-09-15' });
  });

  /**
   * El `@@unique` del servidor hace que el segundo POST no cree una segunda
   * marca: por eso se declara idempotente y SE REINTENTA. Sin esto, un
   * timeout después de que el servidor ya guardó dejaría al Coordinador
   * marcando de nuevo a mano para averiguar quién entró.
   */
  it('reintenta ante una falla de red: es idempotente, repetirla no duplica la marca', async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(json({}, 201));
    vi.stubGlobal('fetch', fetchMock);

    await asistenciaApi.marcar(8021, 302, '2026-09-15');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('asistenciaApi.quitar', () => {
  /**
   * El día va en la query, y sin él el servidor no sabría CUÁL marca borrar:
   * la ruta solo identifica a la persona. Es la diferencia entre sacar un día
   * mal tipeado y sacarle la jornada entera a alguien.
   */
  it('manda DELETE con el colaborador en la ruta y el día en la query', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({}, 204));
    vi.stubGlobal('fetch', fetchMock);

    await asistenciaApi.quitar(8021, 302, '2026-09-15');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/inventarios/8021/asistencia/302');
    expect(String(url)).toContain('dia=2026-09-15');
    expect(init?.method).toBe('DELETE');
  });
});
