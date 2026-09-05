/**
 * Tests de historialApi... no, de liquidacionApi -- el método nuevo,
 * `conciliacion`. `deSucursal` no se prueba acá: no se tocó en esta tarea y
 * el propio adaptador documenta por qué no hace falta (el DTO calza exacto
 * con el puerto).
 *
 * La forma de abajo sale de leer liquidacion.service.ts#conciliacion
 * directamente (no se adivinó): es un `Record<string, unknown>` con dos
 * formas según `calculable`, que acá se tipa como unión discriminada.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => ({}) }));

import { recordarToken } from './_http';
import { liquidacionApi } from './liquidacion-api';

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

describe('liquidacionApi.conciliacion', () => {
  it('pega contra /sucursales/:id/conciliacion y pasa el caso calculable tal cual', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({
        periodo: 'Julio 2026',
        calculable: true,
        faltanteNeto: 1550,
        sumaPlanilla: 1549.96,
        diferenciaPorRedondeo: 0.04,
        colaboradores: 11,
        asistieron: 9,
        faltaron: 2,
        fondoDeMultas: { recaudado: 40, repartido: 40, diferencia: 0, cierra: true },
        advertencia: { itemsSinPrecio: 0, asistenciaSinRegistrar: false, ajustesSinRegistrar: false, mensaje: null },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const c = await liquidacionApi.conciliacion(1);

    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/liquidacion/sucursales/1/conciliacion');
    expect(c?.calculable).toBe(true);
    if (c?.calculable) {
      expect(c.diferenciaPorRedondeo).toBe(0.04);
      expect(c.fondoDeMultas.cierra).toBe(true);
    }
  });

  it('el fondo de multas que NO cierra viaja tal cual -- no se esconde ni se redondea a 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          periodo: 'Julio 2026',
          calculable: true,
          faltanteNeto: 1550,
          sumaPlanilla: 1550,
          diferenciaPorRedondeo: 0,
          colaboradores: 11,
          asistieron: 9,
          faltaron: 2,
          fondoDeMultas: { recaudado: 40, repartido: 39.99, diferencia: -0.01, cierra: false },
          advertencia: { itemsSinPrecio: 0, asistenciaSinRegistrar: false, ajustesSinRegistrar: false, mensaje: null },
        }),
      ),
    );

    const c = await liquidacionApi.conciliacion(1);

    if (c?.calculable) {
      expect(c.fondoDeMultas.cierra).toBe(false);
      expect(c.fondoDeMultas.diferencia).toBe(-0.01);
    } else {
      throw new Error('esperaba calculable: true');
    }
  });

  it('calculable: false NO trae los campos numéricos -- se corta antes de calcular con un valor inventado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          periodo: 'Julio 2026',
          calculable: false,
          advertencia: { itemsSinPrecio: 3, asistenciaSinRegistrar: true, ajustesSinRegistrar: false, mensaje: 'Falta registrar la asistencia.' },
        }),
      ),
    );

    const c = await liquidacionApi.conciliacion(1);

    expect(c?.calculable).toBe(false);
    expect(c).not.toHaveProperty('faltanteNeto');
    if (!c?.calculable) {
      expect(c?.advertencia.mensaje).toBe('Falta registrar la asistencia.');
    }
  });

  it('null cuando la sucursal todavía no tiene ningún ciclo cerrado -- mismo caso que deSucursal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(null)));

    const c = await liquidacionApi.conciliacion(1);

    expect(c).toBeNull();
  });
});
