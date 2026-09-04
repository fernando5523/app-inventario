/**
 * El ciclo offline de punta a punta, contra piezas REALES en cada capa
 * que se puede ejercitar sin Postgres:
 *
 *   - SQLite: motor real (node:sqlite), mismo patrón que
 *     hojas-sqlite.test.ts (ver ese archivo para el porqué: expo-sqlite
 *     no se puede ni importar bajo vitest).
 *   - Red: `_http.ts`/`hojas-api.ts` REALES -- no un mock de `fetch` --
 *     contra un servidor HTTP de verdad que este archivo levanta y que
 *     habla el contrato exacto de `hojas.service.ts` (mismo shape de
 *     éxito/409/500 que el backend real; verificado contra
 *     `error.middleware.ts` y `hojas.controller.ts`).
 *
 * Lo que NO prueba: que el backend real, con Postgres de verdad, persista
 * el conteo. Eso se verificó por separado a mano contra
 * http://localhost:3000 (ver el reporte de esta tarea) -- un test que
 * dependiera de que Postgres esté corriendo rompería `npm test` para
 * cualquiera que lo corra sin esa base levantada, ella incluida la CI.
 * Este archivo prueba la ORQUESTACIÓN completa (SQLite -> cola -> red ->
 * reconciliación) con piezas de producción de verdad en cada eslabón
 * salvo Postgres mismo, y es 100% hermético: no necesita nada corriendo.
 *
 * DATO IMPORTANTE que esta tarea encontró (no un bug de este archivo, un
 * hallazgo): HOY no existe ningún `sincronizador.ts` que llame a
 * `procesarColaDeSincronizacion` con la red real -- ni un temporizador,
 * ni un listener de reconexión, ni nada al reabrir la app (confirmado:
 * la única mención de `procesarColaDeSincronizacion` fuera de tests es un
 * comentario en contenedor.ts). `enviarViaApiReal`, acá abajo, es
 * exactamente el trabajo que ESE módulo tendría que hacer el día que
 * exista -- este archivo prueba que la pieza funciona extremo a extremo,
 * no que hoy se dispare sola en la app.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// `react-native`/`expo-constants` son las dos únicas dependencias nativas
// de `_http.ts` (las usa solo para resolver la URL base) -- Node ni
// siquiera parsea el `react-native` real (sintaxis Flow), así que se
// mockean con factory ANTES de importar nada que dependa de `_http.ts`
// (`hojas-api.ts`, acá abajo). Mismo patrón que `_http.test.ts`. A
// diferencia de ese archivo, acá NO se mockea `fetch`: es justo lo que
// se quiere real, contra el servidor de prueba de este archivo.
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('./sesion-api', () => ({
  sesionApi: { sesionActiva: async () => null },
}));

import { avance } from '../dominio/hoja';
import type { Conteo } from '../dominio/tipos';
import { esErrorApi, esFallaDeRed, recordarToken } from './_http';
import { hojasApi } from './hojas-api';
import { migrarSqlite } from './sqlite-esquema';

// ---------------------------------------------------------------------------
// Servidor HTTP controlable -- NO es un mock de fetch, es un server real
// escuchando en un puerto de verdad, para que `hojasApi` haga un `fetch`
// real de punta a punta (DNS/TCP/HTTP incluidos) contra algo que responde
// con el contrato exacto del backend.
// ---------------------------------------------------------------------------

interface PeticionRecibida {
  metodo: string;
  ruta: string;
  cuerpo: unknown;
}

interface RespuestaControlada {
  status: number;
  cuerpo: unknown;
}

function crearServidorControlable() {
  const peticiones: PeticionRecibida[] = [];
  let responder: (peticion: PeticionRecibida) => RespuestaControlada = () => ({ status: 200, cuerpo: {} });

  const servidor = http.createServer((req, res) => {
    const trozos: Buffer[] = [];
    req.on('data', (trozo: Buffer) => trozos.push(trozo));
    req.on('end', () => {
      const crudo = Buffer.concat(trozos).toString('utf8');
      const peticion: PeticionRecibida = {
        metodo: req.method ?? '',
        ruta: req.url ?? '',
        cuerpo: crudo ? JSON.parse(crudo) : undefined,
      };
      peticiones.push(peticion);
      const { status, cuerpo } = responder(peticion);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cuerpo));
    });
  });

  return {
    peticiones,
    setResponder(fn: typeof responder): void {
      responder = fn;
    },
    escuchar(): Promise<number> {
      return new Promise((resolve) => {
        servidor.listen(0, '127.0.0.1', () => resolve((servidor.address() as AddressInfo).port));
      });
    },
    cerrar(): Promise<void> {
      return new Promise((resolve) => servidor.close(() => resolve()));
    },
  };
}

/** Un puerto que existió y ya no tiene nada escuchando -- ECONNREFUSED garantizado, sin depender de timeouts largos. */
async function puertoCerrado(): Promise<number> {
  const servidor = http.createServer();
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const { port } = servidor.address() as AddressInfo;
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  return port;
}

const URL_API_ORIGINAL = process.env.EXPO_PUBLIC_API_URL;

afterAll(() => {
  process.env.EXPO_PUBLIC_API_URL = URL_API_ORIGINAL;
});

const CONTEO_DE_PRUEBA: Conteo = {
  productoId: 51,
  empaques: [{ empaqueNombre: 'Caja', cantidad: 3 }],
  sueltas: 2,
  confirmadoPorEscaner: false,
  contadoEn: '2026-09-06T10:00:00.000Z',
};

// ---------------------------------------------------------------------------
// hojasApi contra el servidor real -- la mitad de RED del ciclo.
// ---------------------------------------------------------------------------

describe('hojasApi.guardarConteo contra un servidor HTTP real (nunca un mock de fetch)', () => {
  const stub = crearServidorControlable();
  let puerto = 0;

  beforeAll(async () => {
    puerto = await stub.escuchar();
    recordarToken('token-de-prueba'); // el stub no valida sesión, pero pedir() igual la adjunta.
  });

  beforeEach(() => {
    stub.peticiones.length = 0;
    process.env.EXPO_PUBLIC_API_URL = `http://127.0.0.1:${puerto}`;
  });

  afterAll(() => stub.cerrar());

  it('backend arriba: el conteo llega con el shape EXACTO que espera hojas.service.ts, y el total nunca viaja', async () => {
    stub.setResponder(() => ({
      status: 200,
      cuerpo: { conteo: { productoId: 51, empaques: CONTEO_DE_PRUEBA.empaques, sueltas: 2, confirmadoPorEscaner: false, contadoEn: CONTEO_DE_PRUEBA.contadoEn }, total: 38, estadoHoja: 'en-proceso' },
    }));

    await expect(hojasApi.guardarConteo(7, CONTEO_DE_PRUEBA)).resolves.toBeUndefined();

    expect(stub.peticiones).toHaveLength(1);
    const [peticion] = stub.peticiones;
    expect(peticion.metodo).toBe('PUT');
    expect(peticion.ruta).toBe('/api/hojas/7/conteos/51');
    expect(peticion.cuerpo).toEqual({
      empaques: CONTEO_DE_PRUEBA.empaques,
      sueltas: 2,
      confirmadoPorEscaner: false,
      contadoEn: CONTEO_DE_PRUEBA.contadoEn,
    });
    expect(peticion.cuerpo).not.toHaveProperty('total'); // se calcula del lado del servidor, nunca viaja.
  });

  it('backend abajo (puerto sin nadie escuchando): NUNCA una excepción cruda -- siempre ErrorApi clase "sin-red"', async () => {
    process.env.EXPO_PUBLIC_API_URL = `http://127.0.0.1:${await puertoCerrado()}`;

    const error = await hojasApi.guardarConteo(7, CONTEO_DE_PRUEBA).catch((e: unknown) => e);

    expect(esErrorApi(error)).toBe(true);
    expect(esFallaDeRed(error)).toBe(true);
    expect((error as { clase: string }).clase).toBe('sin-red');
  });

  it('la hoja YA la finalizó otro colaborador (409 real del backend): ErrorApi clase "conflicto", NO reintentable', async () => {
    // Mismo shape que error.middleware.ts para un ErrorHttp tipado, y el
    // mismo mensaje literal que hojas.service.ts#guardarConteo tira
    // cuando la hoja ya está finalizada.
    stub.setResponder(() => ({ status: 409, cuerpo: { error: 'La hoja ya esta finalizada: no se puede corregir el conteo.' } }));

    const error = await hojasApi.guardarConteo(7, CONTEO_DE_PRUEBA).catch((e: unknown) => e);

    expect(esErrorApi(error)).toBe(true);
    const errorApi = error as { clase: string; estado: number | null; reintentable: boolean; message: string };
    expect(errorApi.clase).toBe('conflicto');
    expect(errorApi.estado).toBe(409);
    // NO reintentable a propósito: la hoja no se va a "des-finalizar" sola
    // insistiendo -- reintentar acá sería quemar batería para nada.
    expect(errorApi.reintentable).toBe(false);
    expect(errorApi.message).toBe('La hoja ya esta finalizada: no se puede corregir el conteo.');
    expect(stub.peticiones).toHaveLength(1); // un solo intento.
  });

  it('un 500 (reintentable EN TEORÍA) no se reintenta solo: PUT es escritura, de eso se ocupa la cola, no _http.ts', async () => {
    stub.setResponder(() => ({ status: 500, cuerpo: { error: 'boom' } }));

    const error = await hojasApi.guardarConteo(7, CONTEO_DE_PRUEBA).catch((e: unknown) => e);

    const errorApi = error as { clase: string; reintentable: boolean };
    expect(errorApi.clase).toBe('servidor');
    expect(errorApi.reintentable).toBe(true); // reintentable en teoría...
    expect(stub.peticiones).toHaveLength(1); // ...pero hojas-api.ts no pide `idempotente`, así que no se repite solo.
  });
});

// ---------------------------------------------------------------------------
// El ciclo completo: SQLite real + cola + red real -- los 5 pasos.
// ---------------------------------------------------------------------------

interface DbDeTest {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params?: unknown[]): Promise<void>;
  getAllAsync<T>(source: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params?: unknown[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

function envolverNodeSqlite(raw: DatabaseSync): DbDeTest {
  return {
    async execAsync(source) {
      raw.exec(source);
    },
    async runAsync(source, params = []) {
      raw.prepare(source).run(...(params as never[]));
    },
    async getAllAsync<T>(source: string, params: unknown[] = []) {
      return raw.prepare(source).all(...(params as never[])) as T[];
    },
    async getFirstAsync<T>(source: string, params: unknown[] = []) {
      return (raw.prepare(source).get(...(params as never[])) ?? null) as T | null;
    },
    async withTransactionAsync(task) {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

const archivoDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inventario-sync-test-')), 'inventario.db');
let conexionActual: DbDeTest | null = null;
let rawActual: DatabaseSync | null = null;

async function obtenerDbDeTest(): Promise<DbDeTest> {
  if (!conexionActual) {
    const raw = new DatabaseSync(archivoDb);
    rawActual = raw;
    const envuelta = envolverNodeSqlite(raw);
    await envuelta.execAsync('PRAGMA journal_mode = WAL;');
    await migrarSqlite(envuelta);
    conexionActual = envuelta;
  }
  return conexionActual;
}

/** "Cierra la app": descarta la conexión en memoria -- la próxima `obtenerDb()` abre una NUEVA contra el MISMO archivo. */
function simularReinicioDeApp(): void {
  conexionActual = null;
}

vi.mock('./_sqlite', () => ({
  obtenerDb: () => obtenerDbDeTest(),
}));

const { hojasSqlite, procesarColaDeSincronizacion } = await import('./hojas-sqlite');
const { obtenerInventarioDeSucursal } = await import('./_compartido');

afterAll(() => {
  rawActual?.close();
  try {
    fs.rmSync(path.dirname(archivoDb), { recursive: true, force: true });
  } catch {
    // Windows a veces tarda un instante en soltar el handle del WAL.
  }
});

async function hoja002(): Promise<{ inventarioId: number; hojaId: number }> {
  const inventario = await obtenerInventarioDeSucursal(1);
  const base = inventario!.hojas.find((h) => h.numero === '002')!;
  return { inventarioId: inventario!.id, hojaId: base.id };
}

/**
 * El trabajo que un futuro `sincronizador.ts` tendría que hacer: traducir
 * el resultado REAL de `hojasApi` (que resuelve o tira `ErrorApi`) al
 * contrato `ResultadoEnvio` que espera `procesarColaDeSincronizacion`
 * (hojas-sqlite.ts). No existe ese módulo todavía (ver el comentario
 * grande de arriba) -- esto prueba que la pieza, el día que se escriba,
 * tiene con qué funcionar.
 */
async function enviarViaApiReal(item: { tipo: string; hojaId: number; productoId: number }, hoja: { conteos: Conteo[] }): Promise<{ ok: true } | { ok: false; motivo: 'sin-red' | 'rechazado' }> {
  try {
    if (item.tipo === 'conteo') {
      const conteo = hoja.conteos.find((c) => c.productoId === item.productoId);
      if (!conteo) return { ok: false, motivo: 'rechazado' };
      await hojasApi.guardarConteo(item.hojaId, conteo);
    } else {
      await hojasApi.finalizar(item.hojaId);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, motivo: esFallaDeRed(error) ? 'sin-red' : 'rechazado' };
  }
}

describe('el ciclo offline de punta a punta: los 5 pasos del operario, con SQLite y red reales', () => {
  const stub = crearServidorControlable();
  let puertoVivo = 0;

  beforeAll(async () => {
    puertoVivo = await stub.escuchar();
    stub.setResponder(() => ({ status: 200, cuerpo: {} }));
    recordarToken('token-de-prueba');
  });

  afterEach(() => {
    // Cada test deja el backend "arriba" para el siguiente, salvo que
    // explícitamente lo tumbe (paso 2).
    process.env.EXPO_PUBLIC_API_URL = `http://127.0.0.1:${puertoVivo}`;
  });

  afterAll(() => stub.cerrar());

  it('1) backend arriba: el operario guarda un conteo y queda sincronizado de una', async () => {
    const { hojaId } = await hoja002();
    process.env.EXPO_PUBLIC_API_URL = `http://127.0.0.1:${puertoVivo}`;

    await hojasSqlite.guardarConteo(hojaId, {
      productoId: 60,
      empaques: [{ empaqueNombre: 'Caja', cantidad: 1 }],
      sueltas: 0,
      confirmadoPorEscaner: false,
      contadoEn: 'paso-1',
    });

    await procesarColaDeSincronizacion(enviarViaApiReal as never);

    const hoja = await hojasSqlite.porNumero((await hoja002()).inventarioId, '002');
    expect(hoja!.sync).toBe('sincronizado');
  });

  it('2) MATA el backend (puerto sin nadie escuchando): guarda otro, queda local y encolado, SIN colgarse ni tirar una excepción cruda', async () => {
    const { hojaId } = await hoja002();

    await expect(
      hojasSqlite.guardarConteo(hojaId, {
        productoId: 61,
        empaques: [],
        sueltas: 4,
        confirmadoPorEscaner: false,
        contadoEn: 'paso-2',
      }),
    ).resolves.toBeUndefined(); // guardarConteo NUNCA toca la red -- esto no debería poder fallar por el backend estando abajo.

    // El backend recién ahora se "mata" -- se intenta sincronizar contra
    // un puerto que ya no tiene nada escuchando.
    process.env.EXPO_PUBLIC_API_URL = `http://127.0.0.1:${await puertoCerrado()}`;

    await expect(procesarColaDeSincronizacion(enviarViaApiReal as never)).resolves.toBeUndefined(); // nunca tira.

    const hoja = await hojasSqlite.porNumero((await hoja002()).inventarioId, '002');
    // Sigue local -- el dato NO se perdió, solo no pudo salir del teléfono.
    expect(hoja!.conteos.some((c) => c.productoId === 61)).toBe(true);
    expect(hoja!.sync).not.toBe('sincronizado');
  });

  it('3) cierra la app y la vuelve a abrir: el conteo local sigue ahí (32/50 equivalente: nada se perdió)', async () => {
    const { inventarioId } = await hoja002();
    const antesDeCerrar = await hojasSqlite.porNumero(inventarioId, '002');
    const contadosAntes = avance(antesDeCerrar!).contados;
    expect(antesDeCerrar!.conteos.some((c) => c.productoId === 61)).toBe(true); // el del paso 2, sin sincronizar, sigue local.

    simularReinicioDeApp();

    const despuesDeReabrir = await hojasSqlite.porNumero(inventarioId, '002');
    expect(avance(despuesDeReabrir!).contados).toBe(contadosAntes);
    expect(despuesDeReabrir!.conteos).toEqual(antesDeCerrar!.conteos);
  });

  it('4) levanta el backend: el pendiente del paso 2 sincroniza', async () => {
    const { hojaId } = await hoja002();
    process.env.EXPO_PUBLIC_API_URL = `http://127.0.0.1:${puertoVivo}`; // "vuelve el WiFi".

    await procesarColaDeSincronizacion(enviarViaApiReal as never);

    const hoja = await hojasSqlite.porNumero((await hoja002()).inventarioId, '002');
    expect(hoja!.sync).toBe('sincronizado');
    void hojaId;
  });

  it('5) reintenta el MISMO conteo dos veces antes de que vuelva el WiFi: se cuenta UNA sola vez', async () => {
    const { hojaId } = await hoja002();
    const productoId = 62;

    // El operario (o la propia app, insegura de si guardó) manda el MISMO
    // conteo dos veces mientras sigue sin señal.
    await hojasSqlite.guardarConteo(hojaId, {
      productoId,
      empaques: [{ empaqueNombre: 'Caja', cantidad: 1 }],
      sueltas: 0,
      confirmadoPorEscaner: false,
      contadoEn: 'paso-5-a',
    });
    await hojasSqlite.guardarConteo(hojaId, {
      productoId,
      empaques: [{ empaqueNombre: 'Caja', cantidad: 3 }], // se corrigió antes de que saliera.
      sueltas: 1,
      confirmadoPorEscaner: false,
      contadoEn: 'paso-5-b',
    });

    stub.peticiones.length = 0;
    await procesarColaDeSincronizacion(enviarViaApiReal as never);

    // Un solo envío de red para este producto: la cola ya había
    // deduplicado ANTES de sincronizar (ON CONFLICT en cola_sync).
    const enviosDeEsteProducto = stub.peticiones.filter((p) => p.ruta === `/api/hojas/${hojaId}/conteos/${productoId}`);
    expect(enviosDeEsteProducto).toHaveLength(1);
    expect(enviosDeEsteProducto[0]!.cuerpo).toMatchObject({ sueltas: 1 }); // el valor MÁS NUEVO, no el primero.

    const db = await obtenerDbDeTest();
    const filas = await db.getAllAsync('SELECT * FROM conteos WHERE hoja_id = ? AND producto_id = ?', [hojaId, productoId]);
    expect(filas).toHaveLength(1); // una sola fila en la base, nunca dos.
  });
});
