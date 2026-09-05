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

/**
 * "NO HAY CICLO CERRADO" NO ES UN ERROR, venga como venga.
 *
 * El bug que originó estos tests (visto en la app el 2026-09-05): una tienda
 * con el inventario EN CURSO —el estado normal la mayor parte del mes— veía
 * "No se pudo cargar la liquidación / Intentá de nuevo" con un botón
 * Reintentar que no arreglaba nada.
 *
 * El backend lo dice con `200` + `null`, pero un `404` significa lo mismo y
 * llegaba como excepción. Los dos caminos tienen que terminar en `null`.
 */
describe('sin ciclo cerrado: null, no excepción', () => {
  it('un 404 se traduce a null, no explota', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'No existe' }, 404)));

    await expect(liquidacionApi.deSucursal(1)).resolves.toBeNull();
  });

  it('en conciliacion también', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'No existe' }, 404)));

    await expect(liquidacionApi.conciliacion(1)).resolves.toBeNull();
  });

  /**
   * La contracara, y es la que evita que el arreglo tape fallas reales: un
   * error de verdad SIGUE subiendo. Si un 500 se tragara como `null`, la
   * pantalla diría "todavía no hay nada que liquidar" cuando el servidor está
   * roto — y nadie iría a mirar.
   */
  it('un 500 SÍ sube como error: no se confunde con "todavía no hay"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'boom' }, 500)));

    await expect(liquidacionApi.deSucursal(1)).rejects.toThrow();
  });

  it('un fallo de red SÍ sube como error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
    );

    await expect(liquidacionApi.deSucursal(1)).rejects.toThrow();
  });

  it('una sesión vencida SÍ sube: se arregla ingresando de nuevo, no esperando', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'sin sesión' }, 401)));

    await expect(liquidacionApi.deSucursal(1)).rejects.toThrow();
  });
});

/**
 * LOS AJUSTES DEL MES. Lo que este adaptador no puede confundir:
 * `montoEmpresa` omitido CONSERVA el calculado al cerrar el conteo, y
 * `montoEmpresa: 0` lo pisa con cero. Son dos cosas distintas y las dos
 * mueven plata.
 */
describe('ajustes del mes', () => {
  const AJUSTES = {
    inventarioId: 29,
    registrado: true,
    montoNegativos: 380,
    montoFaltanteEmpresa: 170,
    nota: 'Mermas documentadas de agosto.',
    registradoPor: { id: 101, nombre: 'Nancy Quispe' },
    registradoEn: '2026-09-05T12:00:00.000Z',
  };

  it('`ajustes` pega al inventario, no a la sucursal', async () => {
    // Con la firma de `fetch` declarada: sin los parámetros, `mock.calls` se
    // tipa como tupla vacía y `calls[0][1]` no compila.
    const fn = vi.fn(async (_url: string, _init: RequestInit) => json(AJUSTES));
    vi.stubGlobal('fetch', fn);

    await liquidacionApi.ajustes(29);

    expect(fn.mock.calls[0]![0]).toContain('/api/liquidacion/inventarios/29/ajustes');
  });

  it('sin cargar todavía devuelve registrado:false, NO null', async () => {
    // A diferencia de deSucursal/conciliacion, acá el null no existe: la
    // pantalla tiene que poder decir "falta cargarlos", no "no hay nada".
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...AJUSTES, registrado: false, montoNegativos: null })));

    const a = await liquidacionApi.ajustes(29);

    expect(a.registrado).toBe(false);
    expect(a.montoNegativos).toBeNull();
  });

  it('`registrarAjustes` usa PUT: es idempotente y se puede corregir', async () => {
    // Con la firma de `fetch` declarada: sin los parámetros, `mock.calls` se
    // tipa como tupla vacía y `calls[0][1]` no compila.
    const fn = vi.fn(async (_url: string, _init: RequestInit) => json(AJUSTES));
    vi.stubGlobal('fetch', fn);

    await liquidacionApi.registrarAjustes(29, { montoNegativos: 380, nota: 'Mermas.' });

    expect(fn.mock.calls[0]![1].method).toBe('PUT');
  });

  it('un 0 viaja en el cuerpo: no se cae por falsy', async () => {
    const fn = vi.fn(async (_url: string, _init: RequestInit) => json({ ...AJUSTES, montoNegativos: 0 }));
    vi.stubGlobal('fetch', fn);

    await liquidacionApi.registrarAjustes(29, { montoNegativos: 0, nota: 'No hubo.' });

    const cuerpo = JSON.parse(fn.mock.calls[0]![1].body as string);
    expect(cuerpo.montoNegativos).toBe(0);
  });

  it('sin montoEmpresa, la clave NO viaja -- así el backend conserva el calculado', async () => {
    // Con la firma de `fetch` declarada: sin los parámetros, `mock.calls` se
    // tipa como tupla vacía y `calls[0][1]` no compila.
    const fn = vi.fn(async (_url: string, _init: RequestInit) => json(AJUSTES));
    vi.stubGlobal('fetch', fn);

    await liquidacionApi.registrarAjustes(29, { montoNegativos: 380, nota: 'x' });

    const cuerpo = JSON.parse(fn.mock.calls[0]![1].body as string);
    expect(cuerpo).not.toHaveProperty('montoEmpresa');
  });

  it('con montoEmpresa en 0, la clave SÍ viaja -- pisar con cero es distinto de omitir', async () => {
    // Con la firma de `fetch` declarada: sin los parámetros, `mock.calls` se
    // tipa como tupla vacía y `calls[0][1]` no compila.
    const fn = vi.fn(async (_url: string, _init: RequestInit) => json(AJUSTES));
    vi.stubGlobal('fetch', fn);

    await liquidacionApi.registrarAjustes(29, { montoNegativos: 380, montoEmpresa: 0, nota: 'x' });

    const cuerpo = JSON.parse(fn.mock.calls[0]![1].body as string);
    expect(cuerpo.montoEmpresa).toBe(0);
  });

  it('la nota viaja tal cual', async () => {
    // Con la firma de `fetch` declarada: sin los parámetros, `mock.calls` se
    // tipa como tupla vacía y `calls[0][1]` no compila.
    const fn = vi.fn(async (_url: string, _init: RequestInit) => json(AJUSTES));
    vi.stubGlobal('fetch', fn);

    await liquidacionApi.registrarAjustes(29, { montoNegativos: 380, nota: 'Mermas documentadas de agosto.' });

    const cuerpo = JSON.parse(fn.mock.calls[0]![1].body as string);
    expect(cuerpo.nota).toBe('Mermas documentadas de agosto.');
  });
});

/**
 * LIQUIDAR: el paso que la app no tenía.
 *
 * `POST /liquidacion/inventarios/:id/liquidar` existía en el backend desde
 * 381e6b6 y ninguna pantalla lo llamaba, así que desde el teléfono el
 * inventario nunca llegaba a `liquidado` — y sin eso el lacrado, que exige
 * ese estado, era inalcanzable.
 */
describe('liquidar', () => {
  const CIERRE = {
    inventarioId: 29,
    estado: 'liquidado' as const,
    colaboradores: 3,
    cuotaBase: 126.36,
    bonoAsistencia: 11.42,
    faltantes: 1,
    totalDescontado: 390.14,
  };

  it('hace POST al inventario', async () => {
    const fn = vi.fn(async (_url: string, _init: RequestInit) => json(CIERRE, 201));
    vi.stubGlobal('fetch', fn);

    await liquidacionApi.liquidar(29);

    expect(fn.mock.calls[0]![0]).toContain('/api/liquidacion/inventarios/29/liquidar');
    expect(fn.mock.calls[0]![1].method).toBe('POST');
  });

  /**
   * SIN CUERPO: quien liquida sale del TOKEN, igual que quien firma el
   * lacrado. No hay nada que el teléfono pueda mandar que cambie de quién es
   * la firma.
   */
  it('no manda cuerpo: quién liquida sale del token, no del body', async () => {
    const fn = vi.fn(async (_url: string, _init: RequestInit) => json(CIERRE, 201));
    vi.stubGlobal('fetch', fn);

    await liquidacionApi.liquidar(29);

    expect(fn.mock.calls[0]![1].body).toBeUndefined();
  });

  it('devuelve el resumen de lo que quedó firme', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(CIERRE, 201)));

    await expect(liquidacionApi.liquidar(29)).resolves.toMatchObject({
      estado: 'liquidado',
      colaboradores: 3,
      totalDescontado: 390.14,
    });
  });

  /**
   * EL 409 SE MUESTRA TAL CUAL. Sus mensajes dicen QUÉ falta —los ajustes
   * del mes, que nadie registró conteos, que ya se liquidó— y son lo único
   * accionable que recibe quien lo lee. Traducirlos a un genérico borraría
   * justo eso.
   */
  it('un 409 sube con el mensaje del backend, sin traducir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(
          {
            error:
              'Ningún colaborador registró conteos en este inventario: no hay asistencia deducible ni a quién repartir el faltante.',
          },
          409,
        ),
      ),
    );

    const error = await liquidacionApi.liquidar(29).catch((e) => e);
    expect(error.message).toContain('Ningún colaborador registró conteos');
  });

  it('el 409 de "ya se cerró" también llega entero', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'La planilla de este inventario ya se cerró.' }, 409)));

    const error = await liquidacionApi.liquidar(29).catch((e) => e);
    expect(error.message).toContain('ya se cerró');
  });

  it('un 403 sube como error: el auditor no liquida', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'sin permiso' }, 403)));

    await expect(liquidacionApi.liquidar(29)).rejects.toThrow();
  });
});

/**
 * LA PLANILLA PROYECTADA. `LiquidacionColaborador` se llena AL liquidar, así
 * que antes de eso el backend devuelve las filas que VA a persistir,
 * calculadas con la misma función y sin escribir nada.
 *
 * Sin esto, la pantalla veía una planilla vacía y el botón "Liquidar" —que
 * se habilitaba con `planilla.length > 0`— nunca se habilitaba: un candado
 * que pedía su propia llave.
 */
describe('planilla proyectada vs firme', () => {
  const base = {
    inventarioId: 29,
    periodo: 'Septiembre 2026',
    faltanteBruto: 1500,
    negativosDelMes: 0,
    faltanteEmpresa: 10,
    faltanteNeto: 1490,
    cuotaBase: 496.67,
    multaInasistencia: 20,
    bonoAsistencia: 13.33,
    totalFaltas: 2,
    advertencia: { itemsSinPrecio: 0, asistenciaSinRegistrar: false, ajustesSinRegistrar: false, mensaje: null },
  };

  it('antes de liquidar, la planilla viene CON filas y marcada como proyectada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...base,
          proyectada: true,
          planilla: [{ colaboradorId: 1, nombre: 'Conteo', rol: 'conteo', asistio: true, monto: 483.34 }],
        }),
      ),
    );

    const l = await liquidacionApi.deSucursal(1);
    expect(l?.proyectada).toBe(true);
    expect(l?.planilla).toHaveLength(1);
  });

  it('después de liquidar viene con proyectada:false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...base,
          proyectada: false,
          planilla: [{ colaboradorId: 1, nombre: 'Conteo', rol: 'conteo', asistio: true, monto: 483.34 }],
        }),
      ),
    );

    const l = await liquidacionApi.deSucursal(1);
    expect(l?.proyectada).toBe(false);
  });
});
