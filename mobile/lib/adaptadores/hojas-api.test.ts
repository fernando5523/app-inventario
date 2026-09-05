/**
 * Tests del adaptador HTTP de hojas: que la QUERY que sale a `GET /api/hojas`
 * lleve `alcance` y `ronda` en su lugar. Es la hipótesis 2 del bug de min-5,
 * y el tipo de error que TypeScript NO atrapa: `RUTAS.listar(inventarioId,
 * alcance, ronda, numero?)` recibe dos `number` seguidos, así que mandar el
 * número de hoja donde va la ronda (`?ronda=011`) compila igual y haría que el
 * Contador pida la ronda 11 cuando quiere la hoja #011. Solo un test que mire
 * la URL real lo cierra.
 *
 * `fetch` mockeado (como _http.test.ts); `react-native`/`expo-constants` con
 * factory porque `_http.ts` los importa para la URL base y Node no los parsea.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

import { hojasApi } from './hojas-api';
import { recordarToken } from './_http';

const BASE = 'http://servidor-de-prueba:3000';

function fetchQueDevuelve(cuerpo: unknown) {
  const fn = vi.fn(
    async (_url: string, _init: RequestInit): Promise<Response> =>
      ({
        ok: true,
        status: 200,
        json: async () => cuerpo,
        text: async () => JSON.stringify(cuerpo),
      }) as unknown as Response,
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

const queryDe = (url: string): URLSearchParams => new URL(url).searchParams;

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = BASE;
  recordarToken('token-de-prueba');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.EXPO_PUBLIC_API_URL;
});

describe('hojasApi: la query lleva alcance y ronda EN SU LUGAR', () => {
  it('mias → alcance=mias y la ronda pedida, sin numero', async () => {
    const fn = fetchQueDevuelve([]);
    await hojasApi.mias(42, 2);
    const q = queryDe(fn.mock.calls[0][0]);
    expect(q.get('inventarioId')).toBe('42');
    expect(q.get('alcance')).toBe('mias');
    expect(q.get('ronda')).toBe('2');
    expect(q.get('numero')).toBeNull();
  });

  it('todas → alcance=todas y la ronda pedida', async () => {
    const fn = fetchQueDevuelve([]);
    await hojasApi.todas(42, 3);
    const q = queryDe(fn.mock.calls[0][0]);
    expect(q.get('alcance')).toBe('todas');
    expect(q.get('ronda')).toBe('3');
    expect(q.get('numero')).toBeNull();
  });

  it('porNumero → la RONDA va en ronda y el NÚMERO en numero, nunca el número en la ronda', async () => {
    const fn = fetchQueDevuelve([]);
    await hojasApi.porNumero(42, '011', 2);
    const q = queryDe(fn.mock.calls[0][0]);
    expect(q.get('alcance')).toBe('mias'); // un Contador jamás pide 'todas'.
    expect(q.get('ronda')).toBe('2'); // la RONDA, no '011'.
    expect(q.get('numero')).toBe('011'); // el número, en su propio lugar.
  });
});
