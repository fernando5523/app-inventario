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
let escuchaDeRed: ((estado: { isConnected: boolean; isInternetReachable: boolean }) => void) | null = null;
vi.mock('expo-network', () => ({
  getNetworkStateAsync: vi.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: vi.fn((cb: (estado: { isConnected: boolean; isInternetReachable: boolean }) => void) => {
    escuchaDeRed = cb;
    return { remove: vi.fn() };
  }),
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

import * as Network from 'expo-network';

import type { ItemCola } from './sqlite-cola';
import { ErrorApi } from './_http';
import { enviarPorRed, estaConectado, iniciarSincronizador, sincronizadorReal } from './sincronizador';
import type { Conteo, HojaConteo } from '../dominio/tipos';
import type { EstadoCola } from '../puertos/repositorios';

beforeEach(() => {
  vi.clearAllMocks();
  hojasSqliteMock.procesarColaDeSincronizacion.mockResolvedValue(undefined);
  hojasSqliteMock.estadoDeLaCola.mockResolvedValue({ pendientes: 0, enError: 0 });
  escuchaDeRed = null;
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

describe('iniciarSincronizador: la banda tiene que saber que está sin red YA, sin esperar una pasada', () => {
  // Caso real reportado por el cliente: guardar un conteo no dispara
  // ninguna pasada de sincronización (ni con red), así que si `sinRed`
  // solo se actualizara dentro de una pasada, alguien sin señal contando
  // su primer producto no vería ningún aviso -- la banda seguiría
  // mostrando el último estado conocido (a veces "Sincronizado").

  it('la app se abre YA sin señal: sinRed queda en true desde la lectura inicial, sin esperar ningún evento', async () => {
    vi.mocked(Network.getNetworkStateAsync).mockResolvedValueOnce({ isConnected: false, isInternetReachable: false } as never);

    const limpiar = iniciarSincronizador();
    await vi.waitFor(() => expect(sincronizadorReal.estado().sinRed).toBe(true));
    limpiar();
  });

  it('perder la señal notifica a quien está suscrito de inmediato, sin correr ninguna pasada de sync', async () => {
    const limpiar = iniciarSincronizador();
    await vi.waitFor(() => expect(escuchaDeRed).not.toBeNull());

    const recibidos: EstadoCola[] = [];
    sincronizadorReal.suscribir((e) => recibidos.push(e));
    const llamadasAntes = hojasSqliteMock.procesarColaDeSincronizacion.mock.calls.length;

    escuchaDeRed!({ isConnected: false, isInternetReachable: false });

    expect(sincronizadorReal.estado().sinRed).toBe(true);
    expect(recibidos.some((e) => e.sinRed)).toBe(true);
    // Perder la señal no es la transición que dispara sincronizar() -- eso
    // sigue siendo solo al RECUPERARLA (ver el disparador #1 documentado
    // arriba).
    expect(hojasSqliteMock.procesarColaDeSincronizacion.mock.calls.length).toBe(llamadasAntes);

    limpiar();
  });

  it('recuperar la señal apaga sinRed Y dispara sincronizar() -- los dos efectos de la misma transición', async () => {
    vi.mocked(Network.getNetworkStateAsync).mockResolvedValueOnce({ isConnected: false, isInternetReachable: false } as never);

    // Controlo A MANO cuándo termina la pasada inicial ("por si quedó algo
    // pendiente de la sesión anterior", disparada sola al final de
    // iniciarSincronizador) -- el estado del módulo (`ultimaSync`, etc.)
    // persiste ENTRE tests de este archivo, así que esperar "ya no es
    // null" puede pasar de arrastre por un valor de un test anterior sin
    // que la pasada de ESTE test haya terminado todavía. Con la promesa
    // controlada, el lock contra pasadas solapadas se libera en un
    // momento que el test conoce con certeza.
    let resolverPrimeraPasada!: () => void;
    hojasSqliteMock.procesarColaDeSincronizacion.mockImplementationOnce(() => new Promise<void>((r) => (resolverPrimeraPasada = r)));

    const limpiar = iniciarSincronizador();
    await vi.waitFor(() => expect(sincronizadorReal.estado().sinRed).toBe(true));

    resolverPrimeraPasada();
    await vi.waitFor(() => expect(hojasSqliteMock.procesarColaDeSincronizacion).toHaveBeenCalledTimes(1));
    // `resolverPrimeraPasada()` solo hace que la promesa mockeada resuelva
    // -- falta toda la cadena posterior de `ejecutarSincronizacion`
    // (actualizarEstadoDesdeLaCola, y recién en el `.finally()` se suelta
    // el lock). Un solo microtask no alcanza; un macrotask sí deja que se
    // procese toda la cadena antes de seguir.
    await new Promise((r) => setTimeout(r, 0));

    escuchaDeRed!({ isConnected: true, isInternetReachable: true });

    expect(sincronizadorReal.estado().sinRed).toBe(false);
    await vi.waitFor(() => expect(hojasSqliteMock.procesarColaDeSincronizacion).toHaveBeenCalledTimes(2));

    limpiar();
  });
});
