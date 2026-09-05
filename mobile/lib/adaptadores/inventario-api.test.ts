/**
 * Tests del paso 1 del Coordinador contra el contrato real de
 * `POST /api/d365/snapshot` (backend/README.md §Dynamics).
 *
 * Lo que importa acá no es que el fetch ande: es que cada falla llegue a la
 * pantalla con el CÓDIGO correcto. El puerto define seis, y cada uno tiene
 * una salida distinta para la persona — mandar a cargar credenciales, esperar
 * a que vuelva la señal, o no mostrar nada porque canceló ella misma.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => ({}) }));

import { ErrorSnapshot } from '../puertos/repositorios';
import { recordarToken, registrarLectorDeToken } from './_http';
import { inventarioApi } from './inventario-api';

const BASE = 'http://servidor-de-prueba:3000';

function json(cuerpo: unknown, estado = 200): Response {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  } as unknown as Response;
}

/** Enruta por URL: el snapshot hace DOS pedidos (estado y snapshot). */
function fetchPorRuta(mapa: Record<string, Response | Error>) {
  const fn = vi.fn(async (url: string, _init: RequestInit): Promise<Response> => {
    const clave = Object.keys(mapa).find((k) => url.includes(k));
    const r = clave ? mapa[clave] : json({ error: 'ruta no mockeada' }, 404);
    if (r instanceof Error) throw r;
    return r;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const CONFIGURADO = json({ configurado: true });
const SNAPSHOT_OK = json({ inventarioId: 7, items: 8000, tomadoEn: '2026-09-03T14:00:00.000Z' });

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = BASE;
  recordarToken('token-de-prueba');
  registrarLectorDeToken(async () => null);
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.EXPO_PUBLIC_API_URL;
});

describe('traerSnapshot — camino feliz', () => {
  it('devuelve el inventario con el que se encadenan los pasos 2 y 3', async () => {
    fetchPorRuta({ '/api/d365/estado': CONFIGURADO, '/api/d365/snapshot': SNAPSHOT_OK });
    await expect(inventarioApi.traerSnapshot(1)).resolves.toEqual({
      inventarioId: 7,
      items: 8000,
      tomadoEn: '2026-09-03T14:00:00.000Z',
    });
  });

  it('manda sucursalId en el CUERPO, no en la URL, y no fuerza el modo', async () => {
    const fn = fetchPorRuta({ '/api/d365/estado': CONFIGURADO, '/api/d365/snapshot': SNAPSHOT_OK });
    await inventarioApi.traerSnapshot(1);

    const llamada = fn.mock.calls.find((c) => c[0].includes('/snapshot'))!;
    expect(llamada[0]).toBe(`${BASE}/api/d365/snapshot`);
    // `tipo` viaja SIEMPRE explícito aunque coincida con el default del
    // servidor: el universo que se cuenta es una decisión del Coordinador y
    // tiene que ir dicha, no asumida.
    expect(JSON.parse(llamada[1].body as string)).toEqual({ sucursalId: 1, tipo: 'mensual' });
  });

  it('el default es MENSUAL: contar el anual sin pedirlo es una jornada de once personas perdida', async () => {
    const fn = fetchPorRuta({ '/api/d365/estado': CONFIGURADO, '/api/d365/snapshot': SNAPSHOT_OK });
    await inventarioApi.traerSnapshot(1);
    const cuerpo = JSON.parse(fn.mock.calls.find((c) => c[0].includes('/snapshot'))![1].body as string);
    expect(cuerpo.tipo).toBe('mensual');
  });

  it('manda el tipo ANUAL cuando el Coordinador lo elige', async () => {
    const fn = fetchPorRuta({ '/api/d365/estado': CONFIGURADO, '/api/d365/snapshot': SNAPSHOT_OK });
    await inventarioApi.traerSnapshot(1, { tipo: 'anual' });
    const cuerpo = JSON.parse(fn.mock.calls.find((c) => c[0].includes('/snapshot'))![1].body as string);
    expect(cuerpo.tipo).toBe('anual');
  });

  it('traduce "sin almacén" a su propio código: se arregla en Tiendas, no en Configuración', async () => {
    // Es una salida DISTINTA de `dynamics-no-configurado`: ahí falta cargar
    // credenciales; acá falta asociarle el almacén de Dynamics a la tienda.
    fetchPorRuta({
      '/api/d365/estado': CONFIGURADO,
      '/api/d365/snapshot': json({ error: 'La sucursal no tiene un almacen de Dynamics asociado.' }, 400),
    });
    await expect(inventarioApi.traerSnapshot(1)).rejects.toMatchObject({ codigo: 'sin-almacen' });
  });

  it('nunca pide modo "ejemplo": sustituir datos reales en silencio arruina un inventario', async () => {
    const fn = fetchPorRuta({ '/api/d365/estado': CONFIGURADO, '/api/d365/snapshot': SNAPSHOT_OK });
    await inventarioApi.traerSnapshot(1);
    const cuerpos = fn.mock.calls.map((c) => String(c[1].body ?? ''));
    expect(cuerpos.some((c) => c.includes('ejemplo'))).toBe(false);
  });

  it('reporta avance honesto: total null al arrancar, total real al terminar', async () => {
    fetchPorRuta({ '/api/d365/estado': CONFIGURADO, '/api/d365/snapshot': SNAPSHOT_OK });
    const avances: Array<{ traidos: number; total: number | null }> = [];
    await inventarioApi.traerSnapshot(1, { onAvance: (a) => avances.push(a) });

    // Nunca se inventa un total para dibujar una barra completa antes de tiempo.
    expect(avances[0]).toEqual({ traidos: 0, total: null });
    expect(avances[avances.length - 1]).toEqual({ traidos: 8000, total: 8000 });
  });
});

describe('traerSnapshot — cada falla con su código', () => {
  async function codigoDe(promesa: Promise<unknown>): Promise<string> {
    const error = await promesa.catch((e) => e);
    expect(error).toBeInstanceOf(ErrorSnapshot);
    return (error as ErrorSnapshot).codigo;
  }

  it('sin credenciales avisa ANTES de intentar, para poder mandar a Configuración', async () => {
    const fn = fetchPorRuta({ '/api/d365/estado': json({ configurado: false }) });
    expect(await codigoDe(inventarioApi.traerSnapshot(1))).toBe('dynamics-no-configurado');
    // No gastó el pedido largo contra Dynamics sabiendo que iba a fallar.
    expect(fn.mock.calls.some((c) => c[0].includes('/snapshot'))).toBe(false);
  });

  it('un 400 por credenciales borradas entre el chequeo y el POST también se reconoce', async () => {
    fetchPorRuta({
      '/api/d365/estado': CONFIGURADO,
      '/api/d365/snapshot': json({ error: 'Dynamics no configurado: faltan D365_CLIENT_ID.' }, 400),
    });
    expect(await codigoDe(inventarioApi.traerSnapshot(1))).toBe('dynamics-no-configurado');
  });

  it('un 502 de autenticación es credenciales rechazadas, no un problema de red', async () => {
    fetchPorRuta({
      '/api/d365/estado': CONFIGURADO,
      '/api/d365/snapshot': json({ error: 'No se pudo autenticar contra Azure AD (401).' }, 502),
    });
    expect(await codigoDe(inventarioApi.traerSnapshot(1))).toBe('credenciales-rechazadas');
  });

  it('un 502 que no es de auth no acusa a las credenciales', async () => {
    fetchPorRuta({
      '/api/d365/estado': CONFIGURADO,
      '/api/d365/snapshot': json({ error: 'ReleasedProducts devolvio 500.' }, 502),
    });
    expect(await codigoDe(inventarioApi.traerSnapshot(1))).toBe('desconocido');
  });

  it('sin señal en la tienda es sin-red, no un error que asuste', async () => {
    fetchPorRuta({ '/api/d365/estado': new TypeError('Network request failed') });
    expect(await codigoDe(inventarioApi.traerSnapshot(1))).toBe('sin-red');
  });

  it('cancelar es cancelado, no un fallo: lo decidió la persona', async () => {
    const control = new AbortController();
    fetchPorRuta({ '/api/d365/estado': CONFIGURADO, '/api/d365/snapshot': SNAPSHOT_OK });
    control.abort();
    expect(await codigoDe(inventarioApi.traerSnapshot(1, { signal: control.signal }))).toBe('cancelado');
  });

  it('nunca deja escapar un ErrorApi crudo hacia la pantalla', async () => {
    fetchPorRuta({ '/api/d365/estado': CONFIGURADO, '/api/d365/snapshot': json({ error: 'vaya' }, 403) });
    const error = await inventarioApi.traerSnapshot(1).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorSnapshot);
    expect((error as ErrorSnapshot).codigo).toBe('desconocido');
  });
});

// La forma de estos cuerpos es la de rondas.service.ts (ResumenRondaDto y
// CierreDeRondaDto), leída del código del backend — no adivinada.
const RESUMEN_DTO = {
  inventarioId: 20,
  ronda: 1,
  total: 1236,
  contados: 1236,
  sinContar: 0,
  cuadrados: 1100,
  aRecontar: 130,
  sinDatoErp: 6,
  porcentajeCuadrado: 89.4,
  hojasSinFinalizar: [],
  sePuedeCerrar: true,
  siguienteRonda: 2,
  motivoSinSiguiente: null,
};

describe('resumenRonda — PREVIEW que no muta', () => {
  it('hace GET a la ruta de resumen y devuelve el embudo tal cual', async () => {
    const fn = fetchPorRuta({ '/rondas/1/resumen': json(RESUMEN_DTO) });
    const r = await inventarioApi.resumenRonda(20, 1);

    const llamada = fn.mock.calls[0];
    expect(llamada[0]).toBe(`${BASE}/api/inventarios/20/rondas/1/resumen`);
    expect((llamada[1].method ?? 'GET').toUpperCase()).toBe('GET');
    expect(r.cuadrados).toBe(1100);
    expect(r.aRecontar).toBe(130);
    expect(r.sePuedeCerrar).toBe(true);
    expect(r.siguienteRonda).toBe(2);
  });

  it('trae las hojas que bloquean el cierre, para poder decir CUÁLES', async () => {
    const conPendientes = {
      ...RESUMEN_DTO,
      sePuedeCerrar: false,
      hojasSinFinalizar: [{ id: 5, numero: '003', estado: 'en-proceso', zona: 'A', asignada: true }],
    };
    fetchPorRuta({ '/rondas/1/resumen': json(conPendientes) });
    const r = await inventarioApi.resumenRonda(20, 1);
    expect(r.sePuedeCerrar).toBe(false);
    expect(r.hojasSinFinalizar).toHaveLength(1);
    expect(r.hojasSinFinalizar[0].numero).toBe('003');
  });
});

describe('cerrarRonda', () => {
  it('hace POST con cuerpo vacío y devuelve la ronda abierta con sus hojas', async () => {
    const CIERRE_DTO = {
      inventarioId: 20,
      rondaCerrada: 1,
      resumen: { total: 1236, contados: 1236, sinContar: 0, cuadrados: 1100, aRecontar: 130, sinDatoErp: 6, porcentajeCuadrado: 89.4 },
      rondaAbierta: 2,
      motivoSinSiguiente: null,
      hojas: [{ id: 40, inventarioId: 20, numero: '001', zona: 'A', gondola: '001', tamano: 50, estado: 'pendiente', sync: 'sincronizado', asignados: [], productos: [], conteos: [] }],
    };
    const fn = fetchPorRuta({ '/rondas/1/cerrar': json(CIERRE_DTO, 201) });
    const cierre = await inventarioApi.cerrarRonda(20, 1);

    const llamada = fn.mock.calls[0];
    expect(llamada[0]).toBe(`${BASE}/api/inventarios/20/rondas/1/cerrar`);
    expect((llamada[1].method ?? '').toUpperCase()).toBe('POST');
    expect(cierre.rondaAbierta).toBe(2);
    expect(cierre.hojas).toHaveLength(1);
  });

  it('cuando el ciclo termina, rondaAbierta es null y viene el motivo (no es un error)', async () => {
    const finCiclo = {
      inventarioId: 20,
      rondaCerrada: 1,
      resumen: { total: 1236, contados: 1236, sinContar: 0, cuadrados: 1236, aRecontar: 0, sinDatoErp: 0, porcentajeCuadrado: 100 },
      rondaAbierta: null,
      motivoSinSiguiente: 'Todos los ítems cuadraron contra el ERP: no queda nada para recontar.',
      hojas: [],
    };
    fetchPorRuta({ '/rondas/1/cerrar': json(finCiclo, 201) });
    const cierre = await inventarioApi.cerrarRonda(20, 1);
    expect(cierre.rondaAbierta).toBeNull();
    expect(cierre.motivoSinSiguiente).toMatch(/cuadraron/i);
    expect(cierre.hojas).toHaveLength(0);
  });
});

/**
 * EL PROGRESO DEL SNAPSHOT.
 *
 * El bug que originó esto, medido en el emulador el 2026-09-05: la pantalla
 * mostró "0 ítems traídos…" durante 90 segundos y saltó a 951 al final, al
 * lado del cartel "puede tardar varios minutos". Se lee como "se colgó", y
 * el Coordinador toca Cancelar.
 *
 * El sondeo va EN PARALELO al POST: el POST es la operación, el sondeo solo
 * mira y reporta. Estos tests protegen sobre todo que el segundo no pueda
 * voltear al primero.
 */
describe('traerSnapshot — progreso sondeado', () => {
  /**
   * Un POST que no resuelve hasta que el test lo diga: sin esto, el snapshot
   * termina antes del primer intervalo de sondeo y no hay nada que observar.
   */
  function postControlado() {
    let resolver!: (r: Response) => void;
    const pendiente = new Promise<Response>((res) => {
      resolver = res;
    });
    return { pendiente, resolver };
  }

  /** Enruta poniendo `/progreso` PRIMERO: `includes` matchea la clave más general si va antes. */
  function fetchConProgreso(progreso: Response | Error, post: Promise<Response>) {
    const fn = vi.fn(async (url: string): Promise<Response> => {
      if (url.includes('/snapshot/progreso')) {
        if (progreso instanceof Error) throw progreso;
        return progreso;
      }
      if (url.includes('/api/d365/estado')) return CONFIGURADO;
      if (url.includes('/api/d365/snapshot')) return post;
      return json({ error: 'ruta no mockeada' }, 404);
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('arranca reportando 0 con total desconocido, no un total inventado', async () => {
    // `total: null` es lo que hace que la pantalla dibuje un spinner honesto
    // en vez de una barra completa antes de tiempo.
    fetchPorRuta({ '/api/d365/estado': CONFIGURADO, '/api/d365/snapshot': SNAPSHOT_OK });
    const avances: Array<{ traidos: number; total: number | null }> = [];
    await inventarioApi.traerSnapshot(1, { onAvance: (a) => avances.push(a) });

    expect(avances[0]).toEqual({ traidos: 0, total: null });
  });

  it('el ÚLTIMO avance es el del resultado, no el del sondeo', async () => {
    // Los dos números son ciertos y distintos: el sondeo cuenta productos
    // bajados de Dynamics (~8.000), el resultado cuenta los que entraron al
    // inventario tras el filtro. El que queda en firme es el del inventario.
    fetchPorRuta({ '/api/d365/estado': CONFIGURADO, '/api/d365/snapshot': SNAPSHOT_OK });
    const avances: Array<{ traidos: number; total: number | null }> = [];
    await inventarioApi.traerSnapshot(1, { onAvance: (a) => avances.push(a) });

    expect(avances[avances.length - 1]).toEqual({ traidos: 8000, total: 8000 });
  });

  it('reporta el avance que devuelve el sondeo mientras el POST sigue abierto', async () => {
    vi.useFakeTimers();
    const post = postControlado();
    fetchConProgreso(json({ traidos: 3200, total: 8000, fase: 'bajando', actualizadoEn: '2026-09-05T06:34:52.113Z' }), post.pendiente);

    const avances: Array<{ traidos: number; total: number | null }> = [];
    const trabajo = inventarioApi.traerSnapshot(1, { onAvance: (a) => avances.push(a) });

    // Deja correr un intervalo de sondeo con el POST todavía sin resolver.
    await vi.advanceTimersByTimeAsync(2_500);
    post.resolver(SNAPSHOT_OK);
    await trabajo;
    vi.useRealTimers();

    expect(avances).toContainEqual({ traidos: 3200, total: 8000 });
  });

  /**
   * LA REGLA QUE MÁS IMPORTA: el progreso es accesorio. Perder un snapshot de
   * 8.000 ítems porque el endpoint de progreso devolvió 500 sería cambiar
   * algo que importa por algo que no. Misma decisión que del lado backend,
   * donde un error en el callback de página no corta la bajada.
   */
  it('si el sondeo falla, el snapshot NO se cae', async () => {
    fetchConProgreso(json({ error: 'explotó' }, 500), Promise.resolve(SNAPSHOT_OK));

    await expect(inventarioApi.traerSnapshot(1, { onAvance: () => {} })).resolves.toMatchObject({
      inventarioId: 7,
      items: 8000,
    });
  });

  it('un progreso null (ya terminó, o todavía no arrancó) no rompe ni reporta nada raro', async () => {
    // El backend responde 200 con null cuando no hay snapshot en curso: es
    // una respuesta válida del sondeo, no un error.
    fetchConProgreso(json(null), Promise.resolve(SNAPSHOT_OK));
    const avances: Array<{ traidos: number; total: number | null }> = [];
    await inventarioApi.traerSnapshot(1, { onAvance: (a) => avances.push(a) });

    expect(avances.every((a) => typeof a.traidos === 'number')).toBe(true);
  });

  it('sin onAvance no sondea: no se gasta batería en un progreso que nadie mira', async () => {
    const fn = fetchPorRuta({ '/api/d365/estado': CONFIGURADO, '/api/d365/snapshot': SNAPSHOT_OK });
    await inventarioApi.traerSnapshot(1);

    expect(fn.mock.calls.some((c) => c[0].includes('/snapshot/progreso'))).toBe(false);
  });

  it('el sondeo pregunta por LA sucursal, no por otra', async () => {
    vi.useFakeTimers();
    const post = postControlado();
    const fn = fetchConProgreso(json({ traidos: 10, total: 100, fase: 'bajando', actualizadoEn: 'x' }), post.pendiente);

    const trabajo = inventarioApi.traerSnapshot(42, { onAvance: () => {} });
    await vi.advanceTimersByTimeAsync(2_500);
    post.resolver(SNAPSHOT_OK);
    await trabajo;
    vi.useRealTimers();

    const consulta = fn.mock.calls.find((c) => c[0].includes('/snapshot/progreso'));
    expect(consulta?.[0]).toContain('sucursalId=42');
  });

  it('cuando el POST termina, el sondeo deja de consultar', async () => {
    // Sin cortarlo, quedaría un loop huérfano preguntando por un snapshot que
    // ya no existe hasta agotar el presupuesto de tiempo.
    vi.useFakeTimers();
    const post = postControlado();
    const fn = fetchConProgreso(json({ traidos: 10, total: 100, fase: 'bajando', actualizadoEn: 'x' }), post.pendiente);

    const trabajo = inventarioApi.traerSnapshot(1, { onAvance: () => {} });
    await vi.advanceTimersByTimeAsync(2_500);
    post.resolver(SNAPSHOT_OK);
    await trabajo;

    const consultasAlTerminar = fn.mock.calls.filter((c) => c[0].includes('/snapshot/progreso')).length;
    await vi.advanceTimersByTimeAsync(10_000);
    vi.useRealTimers();

    expect(fn.mock.calls.filter((c) => c[0].includes('/snapshot/progreso')).length).toBe(consultasAlTerminar);
  });
});
