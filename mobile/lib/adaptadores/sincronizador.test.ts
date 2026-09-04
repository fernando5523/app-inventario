/**
 * Tests del disparador de sincronización -- SOLO la lógica propia de este
 * archivo (el lock contra solapamiento, la notificación de estado, y la
 * traducción de `hojasApi` a `ResultadoEnvio`). No prueba de nuevo el
 * contrato de red real ni el motor SQLite: eso ya lo cubre
 * hojas-sincronizacion.test.ts contra piezas reales. Acá `hojas-sqlite.ts`
 * y `hojas-api.ts` están mockeados a propósito -- lo que se verifica es
 * la ORQUESTACIÓN (¿se solapan dos pasadas? ¿el estado dice la verdad?),
 * no que SQLite/fetch funcionen (ya probado en otro lado).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `react-native` (AppState) y `expo-constants` (los usa `_http.ts` para
// resolver la URL base) no parsean bajo Node -- se mockean con factory
// ANTES de importar nada que dependa de ellos, mismo patrón que
// hojas-sincronizacion.test.ts.
vi.mock('react-native', () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  Platform: { OS: 'android' }, // lo usa _http.ts para resolver la URL base.
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-network', () => ({
  getNetworkStateAsync: vi.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: vi.fn(() => ({ remove: vi.fn() })),
}));

const hojasSqliteMock = vi.hoisted(() => ({
  procesarColaDeSincronizacion: vi.fn(async (): Promise<void> => undefined),
  estadoDeLaCola: vi.fn(async () => ({ pendientes: 0, enError: 0 })),
}));
vi.mock('./hojas-sqlite', () => hojasSqliteMock);

const hojasApiMock = vi.hoisted(() => ({
  hojasApi: { guardarConteo: vi.fn(), finalizar: vi.fn() },
}));
vi.mock('./hojas-api', () => hojasApiMock);

import type { ItemCola } from './sqlite-cola';
import { ErrorApi } from './_http';
import { enviarPorRed, estaConectado, sincronizadorReal } from './sincronizador';
import type { Conteo, HojaConteo } from '../dominio/tipos';
import type { EstadoCola } from '../puertos/repositorios';

beforeEach(() => {
  vi.clearAllMocks();
  hojasSqliteMock.procesarColaDeSincronizacion.mockResolvedValue(undefined);
  hojasSqliteMock.estadoDeLaCola.mockResolvedValue({ pendientes: 0, enError: 0 });
});

// ---------------------------------------------------------------------------

describe('sincronizar(): nunca se solapan dos pasadas', () => {
  it('una segunda llamada mientras la primera sigue en curso NO arranca una pasada nueva -- devuelve la misma promesa', async () => {
    let resolverPrimera!: () => void;
    hojasSqliteMock.procesarColaDeSincronizacion.mockImplementationOnce(() => new Promise<void>((r) => (resolverPrimera = r)));

    const p1 = sincronizadorReal.sincronizar();
    const p2 = sincronizadorReal.sincronizar(); // disparada MIENTRAS la primera sigue en curso.

    expect(hojasSqliteMock.procesarColaDeSincronizacion).toHaveBeenCalledTimes(1);

    resolverPrimera();
    await Promise.all([p1, p2]);

    expect(hojasSqliteMock.procesarColaDeSincronizacion).toHaveBeenCalledTimes(1);
  });

  it('una vez terminada la pasada, la SIGUIENTE llamada sí dispara una pasada nueva', async () => {
    await sincronizadorReal.sincronizar();
    await sincronizadorReal.sincronizar();

    expect(hojasSqliteMock.procesarColaDeSincronizacion).toHaveBeenCalledTimes(2);
  });
});

describe('estado()/suscribir(): la banda tiene que decir la verdad', () => {
  it('tras una pasada sin nada en error: ultimaSync se llena, error queda null', async () => {
    hojasSqliteMock.estadoDeLaCola.mockResolvedValue({ pendientes: 2, enError: 0 });

    await sincronizadorReal.sincronizar();

    const estado = sincronizadorReal.estado();
    expect(estado.pendientes).toBe(2);
    expect(estado.error).toBeNull();
    expect(estado.ultimaSync).not.toBeNull();
  });

  it('si quedan items en error, el mensaje lo dice explícito -- NUNCA "sincronizado" con la cola llena', async () => {
    hojasSqliteMock.estadoDeLaCola.mockResolvedValue({ pendientes: 3, enError: 3 });

    await sincronizadorReal.sincronizar();

    const estado = sincronizadorReal.estado();
    expect(estado.pendientes).toBe(3);
    expect(estado.error).toContain('3');
  });

  it('notifica a quien se suscribió, y deja de hacerlo tras desuscribirse', async () => {
    const recibidos: EstadoCola[] = [];
    const desuscribir = sincronizadorReal.suscribir((e) => recibidos.push(e));

    await sincronizadorReal.sincronizar();
    const cantidadTrasElPrimero = recibidos.length;
    expect(cantidadTrasElPrimero).toBeGreaterThan(0);

    desuscribir();
    await sincronizadorReal.sincronizar();

    expect(recibidos.length).toBe(cantidadTrasElPrimero); // no llegó ninguna notificación más.
  });
});

describe('enviarPorRed: traduce hojasApi (resuelve o tira ErrorApi) a ResultadoEnvio', () => {
  const CONTEO: Conteo = { productoId: 1, empaques: [], sueltas: 3, confirmadoPorEscaner: false, contadoEn: 't' };
  const HOJA = { conteos: [CONTEO] } as HojaConteo;

  const itemConteo: ItemCola = { id: 1, hojaId: 7, tipo: 'conteo', productoId: 1, creadoEn: 't', intentos: 0, estado: 'pendiente' };
  const itemFinalizar: ItemCola = { id: 2, hojaId: 7, tipo: 'finalizar', productoId: 0, creadoEn: 't', intentos: 0, estado: 'pendiente' };

  it('éxito -> { ok: true }', async () => {
    hojasApiMock.hojasApi.guardarConteo.mockResolvedValueOnce(undefined);
    await expect(enviarPorRed(itemConteo, HOJA)).resolves.toEqual({ ok: true });
    expect(hojasApiMock.hojasApi.guardarConteo).toHaveBeenCalledWith(7, CONTEO);
  });

  it('ErrorApi "sin-red" -> motivo "sin-red" (reintentable en el próximo disparo)', async () => {
    hojasApiMock.hojasApi.guardarConteo.mockRejectedValueOnce(new ErrorApi('sin-red'));
    await expect(enviarPorRed(itemConteo, HOJA)).resolves.toEqual({ ok: false, motivo: 'sin-red' });
  });

  it('ErrorApi "conflicto" (409 real: la hoja ya la finalizó otro) -> motivo "rechazado", NO "sin-red"', async () => {
    hojasApiMock.hojasApi.guardarConteo.mockRejectedValueOnce(new ErrorApi('conflicto', { estado: 409 }));
    await expect(enviarPorRed(itemConteo, HOJA)).resolves.toEqual({ ok: false, motivo: 'rechazado' });
  });

  it('ErrorApi "sesion-vencida" (401) -> motivo "rechazado": no se va a arreglar solo insistiendo', async () => {
    hojasApiMock.hojasApi.guardarConteo.mockRejectedValueOnce(new ErrorApi('sesion-vencida'));
    await expect(enviarPorRed(itemConteo, HOJA)).resolves.toEqual({ ok: false, motivo: 'rechazado' });
  });

  it('item tipo "finalizar" llama a hojasApi.finalizar, no a guardarConteo', async () => {
    hojasApiMock.hojasApi.finalizar.mockResolvedValueOnce({} as HojaConteo);
    await expect(enviarPorRed(itemFinalizar, HOJA)).resolves.toEqual({ ok: true });
    expect(hojasApiMock.hojasApi.finalizar).toHaveBeenCalledWith(7);
    expect(hojasApiMock.hojasApi.guardarConteo).not.toHaveBeenCalled();
  });

  it('un item de conteo cuyo producto ya no está en la hoja se descarta como rechazado -- nunca reintenta algo inexistente', async () => {
    const itemHuerfano: ItemCola = { ...itemConteo, productoId: 999 };
    await expect(enviarPorRed(itemHuerfano, HOJA)).resolves.toEqual({ ok: false, motivo: 'rechazado' });
    expect(hojasApiMock.hojasApi.guardarConteo).not.toHaveBeenCalled();
  });
});

describe('estaConectado', () => {
  it.each([
    [{ isConnected: true, isInternetReachable: true }, true],
    [{ isConnected: true, isInternetReachable: undefined }, true], // "no se sabe" no es "no hay internet": se asume conectado.
    [{ isConnected: true, isInternetReachable: false }, false],
    [{ isConnected: false, isInternetReachable: true }, false],
    [{ isConnected: undefined, isInternetReachable: true }, false],
  ] as const)('%o -> %s', (estado, esperado) => {
    expect(estaConectado(estado)).toBe(esperado);
  });
});
