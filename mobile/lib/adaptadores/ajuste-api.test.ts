/**
 * Lo que estos tests protegen no es el JSON: es la RUTA, el método y que
 * ninguna de estas escrituras se reintente sola.
 *
 * El reintento es lo delicado. `pedir()` reintenta las lecturas y las
 * escrituras marcadas idempotentes; ninguna de estas lo es. Dos intentos de
 * `rondas/abrir` son DOS rondas -- once personas mandadas a recontar de nuevo
 * por un corte de WiFi -- y dos correcciones idénticas son dos asientos en la
 * bitácora que defiende a la persona.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => ({}) }));

import { recordarToken } from './_http';
import { ajusteApi } from './ajuste-api';

function json(cuerpo: unknown, estado = 200): Response {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  } as unknown as Response;
}

const CORRECCION = { empaques: [{ empaqueNombre: 'Caja', cantidad: 2 }], sueltas: 3, motivo: 'Contó una caja de más' };

beforeEach(() => {
  recordarToken('token-de-prueba');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ajusteApi.corregirConteo — el coordinador', () => {
  it('manda PATCH a la hoja y el producto, con empaques, sueltas y motivo', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({}, 200));
    vi.stubGlobal('fetch', fetchMock);

    await ajusteApi.corregirConteo(4012, 77, CORRECCION);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/hojas/4012/conteos/77/corregir');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual(CORRECCION);
  });

  /**
   * Cada intento escribe una entrada en la bitácora de auditoría: tres
   * asientos "cambió 12 -> 14" por un timeout convierten el rastro que
   * defiende a la persona en ruido que alguien tiene que explicar.
   */
  it('NO se reintenta sola ante una falla de red', async () => {
    const fetchMock = vi.fn<() => Promise<Response>>().mockRejectedValue(new TypeError('Network request failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(ajusteApi.corregirConteo(4012, 77, CORRECCION)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('ajusteApi — las cuatro del auditor', () => {
  it('abrirRondaExtra: POST a /rondas/abrir, sin cuerpo', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({}, 201));
    vi.stubGlobal('fetch', fetchMock);

    await ajusteApi.abrirRondaExtra(8039);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/inventarios/8039/rondas/abrir');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
  });

  /** Dos intentos serían dos rondas, y una ronda de más es una jornada perdida. */
  it('abrirRondaExtra NO se reintenta sola: no es idempotente en absoluto', async () => {
    const fetchMock = vi.fn<() => Promise<Response>>().mockRejectedValue(new TypeError('Network request failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(ajusteApi.abrirRondaExtra(8039)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('iniciarAjuste y cerrarAjuste pegan en sus propias rutas', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({}, 200));
    vi.stubGlobal('fetch', fetchMock);

    await ajusteApi.iniciarAjuste(8039);
    await ajusteApi.cerrarAjuste(8039);

    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/inventarios/8039/ajuste/iniciar');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/inventarios/8039/ajuste/cerrar');
  });

  it('ajustarItem: PATCH al ítem dentro del ajuste, con el mismo cuerpo que la corrección', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({}, 200));
    vi.stubGlobal('fetch', fetchMock);

    await ajusteApi.ajustarItem(8039, 77, CORRECCION);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/inventarios/8039/ajuste/77');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual(CORRECCION);
  });

  /**
   * El 409 del servidor dice algo verdadero ("el ajuste ya está en curso") y
   * tiene que llegar a la pantalla tal cual: un mensaje genérico borraría
   * justo lo que explica por qué el botón no hizo nada.
   */
  it('el mensaje del servidor sube sin traducir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'El ajuste final de este inventario ya está en curso.' }, 409)),
    );

    await expect(ajusteApi.iniciarAjuste(8039)).rejects.toThrow(/ya está en curso/);
  });
});
