/**
 * Prueba la persistencia offline con el motor SQLite REAL de Node
 * (`node:sqlite`, estable desde Node 22) — no un mock de la lógica.
 *
 * `expo-sqlite` no se puede cargar bajo vitest (arrastra react-native,
 * que usa sintaxis Flow — ver el comentario de _sqlite.ts). La solución
 * NO es mockear `hojas-sqlite.ts` ni su lógica: es mockear el módulo
 * `_sqlite.ts` (la única pieza que de verdad depende de `expo-sqlite`)
 * para que `obtenerDb()` devuelva una conexión respaldada por
 * `node:sqlite` en vez del motor nativo — misma interfaz async, mismo
 * SQL (sqlite-esquema.ts, compartido con el `_sqlite.ts` real), motor
 * SQLite real en los dos casos. Todo lo demás — hojas-sqlite.ts entero,
 * sin cambiar una línea — corre tal cual corre en el teléfono.
 *
 * El "reinicio de la app" se simula abriendo una conexión NUEVA contra
 * el MISMO archivo en disco (no `:memory:`, que se perdería al
 * "cerrar") — es literalmente lo que pasa cuando expo-sqlite reabre
 * `inventario.db` en un proceso nuevo.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Desde la descarga inicial, hojas-sqlite.ts importa `esFallaDeRed` de
// `./_http` DIRECTO (no solo a través de hojas-api.ts/catalogo-api.ts,
// mockeados más abajo) — `_http.ts` importa `react-native`/`expo-constants`
// de verdad, que Node no puede ni parsear (sintaxis Flow). Mismo patrón que
// hojas-sincronizacion.test.ts: se mockean ANTES de cualquier import real.
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

import { avance } from '../dominio/hoja';
import type { Sesion } from '../dominio/tipos';
import { migrarSqlite, MIGRACIONES_SQLITE } from './sqlite-esquema';

// ---------------------------------------------------------------------------
// Motor de test: node:sqlite envuelto en la MISMA interfaz async que
// expo-sqlite.SQLiteDatabase (execAsync/runAsync/getAllAsync/getFirstAsync/
// withTransactionAsync) — lo único que hojas-sqlite.ts necesita de una base.
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

const archivoDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inventario-sqlite-test-')), 'inventario.db');
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

/**
 * Simula "cerrar la app y volver a abrirla": descarta la conexión en
 * memoria del proceso de test — la próxima `obtenerDb()` abre una
 * conexión NUEVA contra el MISMO archivo, como pasaría en un reinicio
 * real (proceso nuevo, mismo `inventario.db` en disco).
 */
function simularReinicioDeApp(): void {
  conexionActual = null;
}

vi.mock('./_sqlite', () => ({
  obtenerDb: () => obtenerDbDeTest(),
}));

// sesion-api.ts importa react-native (Platform, vía _http.ts) — no carga
// bajo vitest por la misma razón que expo-sqlite (sintaxis Flow). Ningún
// test de este archivo llama a `mias()`, así que alcanza con un stub: lo
// que importa acá es no arrastrar el módulo real al grafo de imports.
vi.mock('./sesion-api', () => ({
  // vi.fn (no una función suelta) para que cada test decida QUIÉN está
  // logueado — `mias`/`porNumero` ahora filtran por el colaborador de la
  // sesión, así que "sin sesión" y "sesión de otro" son casos que se prueban.
  sesionApi: { sesionActiva: vi.fn() },
}));

// Mismo motivo: hojas-api.ts/catalogo-api.ts importan react-native vía
// _http.ts. Desde la descarga inicial (hojas-sqlite.ts#descargarHojas),
// hojasSqlite llama a los dos en CADA mias()/todas()/porNumero() — acá se
// simula "sin red" siempre: descargarHojas lo captura y cae al dataset de
// ejemplo (_compartido.ts), que es exactamente lo que estos tests de
// persistencia local esperan seguir viendo, sin cambiar una aserción.
// `mias`/`todas` son `vi.fn()` (no funciones sueltas) para que el describe
// de más abajo pueda hacerlas rechazar con un `ErrorApi` puntual (401,
// 500) sin tocar este default — que sigue siendo "sin red" para todos los
// demás tests de este archivo, exactamente como antes.
vi.mock('./hojas-api', () => ({
  hojasApi: {
    mias: vi.fn(async () => {
      throw new Error('sin red (stub de test)');
    }),
    todas: vi.fn(async () => {
      throw new Error('sin red (stub de test)');
    }),
    porNumero: async () => null,
    guardarConteo: async () => {},
    finalizar: async () => {
      throw new Error('no usado en este test');
    },
  },
}));
vi.mock('./catalogo-api', () => ({
  catalogoApi: {
    deHoja: async () => {
      throw new Error('sin red (stub de test)');
    },
    porCodigoBarras: async () => null,
  },
}));

// Import DESPUÉS del vi.mock (vitest lo hoistea igual, pero así queda
// explícito el orden real: hojas-sqlite.ts se carga con `_sqlite.ts` ya
// reemplazado, nunca llega a tocar `expo-sqlite`).
const { hojasSqlite, inventarioIdSinRed, procesarColaDeSincronizacion, ultimaDescarga } = await import('./hojas-sqlite');
const { obtenerInventarioDeSucursal } = await import('./_compartido');
const { ErrorApi } = await import('./_http');
const { hojasApi } = await import('./hojas-api');
const { sesionApi } = await import('./sesion-api');

// La sesión por defecto de los tests: María Rojas, la Contadora dueña de la
// #002 del seed (ver _compartido.ts) — así todos los tests que abren la #002
// con `porNumero` la ven como propia, sin declarar sesión uno por uno. Sin
// sesión, `mias`/`porNumero` devuelven vacío a propósito.
const SESION_MARIA = {
  colaborador: { id: 501, nombre: 'María Rojas', dni: '4821', rol: 'conteo' },
  sucursal: { id: 1, nombre: 'Market Central Luzuriaga', colaboradores: 6 },
  token: 'token-de-prueba',
  expiraEn: '2099-01-01T00:00:00.000Z',
} as unknown as Sesion;

beforeEach(() => {
  vi.mocked(sesionApi.sesionActiva).mockResolvedValue(SESION_MARIA);
});

afterAll(() => {
  rawActual?.close();
  try {
    fs.rmSync(path.dirname(archivoDb), { recursive: true, force: true });
  } catch {
    // Windows a veces tarda un instante en soltar el handle del archivo
    // WAL después de close() — no vale la pena que la suite falle por
    // basura de /tmp que el SO limpia solo.
  }
});

async function hoja002(): Promise<{ inventarioId: number; hojaId: number }> {
  const inventario = await obtenerInventarioDeSucursal(1);
  const base = inventario!.hojas.find((h) => h.numero === '002')!;
  return { inventarioId: inventario!.id, hojaId: base.id };
}

describe('recuperación: el conteo sobrevive a cerrar y reabrir la app', () => {
  it('el dato de arranque (32 de 50) ya está en 32 antes de tocar nada', async () => {
    const { inventarioId } = await hoja002();
    const hoja = await hojasSqlite.porNumero(inventarioId, '002', 1);
    expect(avance(hoja!).contados).toBe(32);
  });

  it('EL ESCENARIO EXACTO: el operario en 32 de 50, sin tocar nada más, cierra la app y al volver a abrirla sigue en 32', async () => {
    // Este es el test que importa de verdad (pedido explícito): "el
    // operario cuenta 32 de 50 en el fondo del almacén, sin señal. Cierra
    // la app. Al volver a abrir tiene que estar en 32 de 50." Va PRIMERO
    // en el archivo, antes de cualquier test que escriba un conteo nuevo,
    // para que "32" sea literal y no dependa del orden de ejecución del
    // resto de la suite (todos comparten el mismo archivo .db en disco).
    const { inventarioId } = await hoja002();
    const antesDeCerrar = await hojasSqlite.porNumero(inventarioId, '002', 1);
    expect(avance(antesDeCerrar!).contados).toBe(32);

    simularReinicioDeApp();

    const despuesDeReabrir = await hojasSqlite.porNumero(inventarioId, '002', 1);
    expect(avance(despuesDeReabrir!).contados).toBe(32);
    // No solo la CANTIDAD: las líneas de cada conteo sobreviven intactas,
    // no solo un número que por casualidad coincide.
    expect(despuesDeReabrir!.conteos).toEqual(antesDeCerrar!.conteos);
  });

  it('el operario cuenta un ítem más (33 de 50) y sigue en 33 después de "reabrir" la app', async () => {
    const { inventarioId, hojaId } = await hoja002();
    const antes = await hojasSqlite.porNumero(inventarioId, '002', 1);
    const sinContar = antes!.productos.find((p) => !antes!.conteos.some((c) => c.productoId === p.id))!;

    await hojasSqlite.guardarConteo(hojaId, {
      productoId: sinContar.id,
      empaques: [{ empaqueNombre: sinContar.empaques[0].nombre, cantidad: 1 }],
      sueltas: 0,
      confirmadoPorEscaner: false,
      contadoEn: '2026-09-05T10:00:00.000Z',
    });

    const antesDeCerrar = await hojasSqlite.porNumero(inventarioId, '002', 1);
    expect(avance(antesDeCerrar!).contados).toBe(33);
    expect(antesDeCerrar!.estado).toBe('en-proceso');
    expect(antesDeCerrar!.sync).toBe('local');

    // ESTE es el momento que importa: se "cierra" la app.
    simularReinicioDeApp();

    // Y esto es EL test: al "volver a abrir", ¿sigue en 33?
    const despuesDeReabrir = await hojasSqlite.porNumero(inventarioId, '002', 1);
    expect(avance(despuesDeReabrir!).contados).toBe(33);
    expect(despuesDeReabrir!.estado).toBe('en-proceso');
    expect(despuesDeReabrir!.sync).toBe('local');
    expect(despuesDeReabrir!.conteos.find((c) => c.productoId === sinContar.id)?.empaques).toEqual([
      { empaqueNombre: sinContar.empaques[0].nombre, cantidad: 1 },
    ]);
  });
});

describe('no se duplican conteos al reintentar', () => {
  it('guardar el MISMO producto dos veces dejó una sola fila, con el valor más nuevo', async () => {
    const { hojaId } = await hoja002();
    const db = await obtenerDbDeTest();
    const productoId = 51; // primer producto de la Hoja #002 (código 0051).

    await hojasSqlite.guardarConteo(hojaId, {
      productoId,
      empaques: [{ empaqueNombre: 'Caja', cantidad: 3 }],
      sueltas: 1,
      confirmadoPorEscaner: false,
      contadoEn: '2026-09-05T10:01:00.000Z',
    });
    await hojasSqlite.guardarConteo(hojaId, {
      productoId,
      empaques: [{ empaqueNombre: 'Caja', cantidad: 5 }],
      sueltas: 0,
      confirmadoPorEscaner: false,
      contadoEn: '2026-09-05T10:02:00.000Z',
    });

    const filas = await db.getAllAsync<{ lineas: string }>('SELECT lineas FROM conteos WHERE hoja_id = ? AND producto_id = ?', [
      hojaId,
      productoId,
    ]);
    expect(filas).toHaveLength(1);
    expect(JSON.parse(filas[0].lineas)).toEqual([{ empaqueNombre: 'Caja', cantidad: 5 }]); // el valor MÁS NUEVO, no el primero.
  });

  it('reintentar el mismo conteo no deja dos items pendientes en la cola de sincronización', async () => {
    const { hojaId } = await hoja002();
    const db = await obtenerDbDeTest();
    const productoId = 52;

    await hojasSqlite.guardarConteo(hojaId, {
      productoId,
      empaques: [{ empaqueNombre: 'Caja', cantidad: 1 }],
      sueltas: 0,
      confirmadoPorEscaner: false,
      contadoEn: 't1',
    });
    await hojasSqlite.guardarConteo(hojaId, {
      productoId,
      empaques: [{ empaqueNombre: 'Caja', cantidad: 2 }],
      sueltas: 0,
      confirmadoPorEscaner: false,
      contadoEn: 't2',
    });

    const filasCola = await db.getAllAsync<{ id: number }>("SELECT id FROM cola_sync WHERE hoja_id = ? AND tipo = 'conteo' AND producto_id = ?", [
      hojaId,
      productoId,
    ]);
    expect(filasCola).toHaveLength(1);
  });
});

describe('la escritura es atómica: si se interrumpe, no queda nada a medias', () => {
  it('si la transacción de guardarConteo se corta a mitad, no se guarda ni la parte que ya había corrido', async () => {
    const { hojaId } = await hoja002();
    const db = await obtenerDbDeTest();
    const productoId = 53;

    // Se rompe el UPDATE de en medio a propósito (columna que no existe)
    // para simular "la app murió a mitad de la escritura" sin depender
    // de matar el proceso de verdad.
    await expect(
      db.withTransactionAsync(async () => {
        await db.runAsync('INSERT OR REPLACE INTO conteos (hoja_id, producto_id, lineas, sueltas, confirmado_por_escaner, contado_en) VALUES (?,?,?,?,?,?)', [
          hojaId,
          productoId,
          JSON.stringify([{ empaqueNombre: 'Caja', cantidad: 9 }]),
          9,
          0,
          'x',
        ]);
        await db.runAsync('UPDATE hoja_estado_local SET columna_que_no_existe = 1 WHERE hoja_id = ?', [hojaId]);
      }),
    ).rejects.toThrow();

    const filas = await db.getAllAsync('SELECT * FROM conteos WHERE hoja_id = ? AND producto_id = ?', [hojaId, productoId]);
    // El INSERT que sí había corrido ANTES del error se deshace con el
    // resto de la transacción — o están los dos cambios, o ninguno.
    expect(filas).toHaveLength(0);
  });
});

describe('la hoja YA finalizada por otro colaborador no deja el conteo local en un limbo silencioso', () => {
  it('el operario guarda offline, otro dispositivo finaliza la hoja antes, y el rechazo queda VISIBLE (no desaparece ni se reintenta infinito en silencio)', async () => {
    const { hojaId } = await hoja002();
    const productoId = 56;

    // El operario cuenta, sin señal — se guarda local, como siempre.
    await hojasSqlite.guardarConteo(hojaId, {
      productoId,
      empaques: [{ empaqueNombre: 'Caja', cantidad: 4 }],
      sueltas: 1,
      confirmadoPorEscaner: false,
      contadoEn: 't-finalizada-por-otro',
    });

    // Vuelve el WiFi y la cola intenta mandarlo -- pero para entonces OTRO
    // colaborador, desde otro dispositivo, ya finalizó esta hoja: el
    // backend rechaza con 409 (ver hojas.service.ts#guardarConteo, "La
    // hoja ya esta finalizada"). Del lado del adaptador eso llega como
    // `motivo: 'rechazado'` (sqlite-cola.ts lo documenta explícito: "ej.
    // la hoja ya la finalizó otra persona").
    await procesarColaDeSincronizacion(async (item) => {
      if (item.hojaId === hojaId && item.productoId === productoId) {
        return { ok: false, motivo: 'rechazado' };
      }
      return { ok: true };
    });

    const db = await obtenerDbDeTest();

    // 1) El item NO desaparece de la cola: queda VISIBLE en error, con el
    //    intento registrado -- nunca un reintento infinito silencioso.
    const itemCola = await db.getFirstAsync<{ estado: string; intentos: number }>(
      "SELECT estado, intentos FROM cola_sync WHERE hoja_id = ? AND producto_id = ? AND tipo = 'conteo'",
      [hojaId, productoId],
    );
    expect(itemCola?.estado).toBe('error');
    expect(itemCola?.intentos).toBe(1);

    // 2) El conteo que el operario cargó NO se pierde -- sigue en la base,
    //    intacto, aunque el servidor ya no lo vaya a aceptar.
    const conteo = await db.getFirstAsync<{ lineas: string; sueltas: number }>('SELECT lineas, sueltas FROM conteos WHERE hoja_id = ? AND producto_id = ?', [
      hojaId,
      productoId,
    ]);
    expect(conteo).not.toBeNull();
    expect(JSON.parse(conteo!.lineas)).toEqual([{ empaqueNombre: 'Caja', cantidad: 4 }]);

    // 3) La hoja pasa a sync: 'error' -- un estado DISTINTO de 'local' o
    //    'sincronizando', para que la pantalla pueda avisar que esto no es
    //    "todavía no llegó WiFi" sino "esto no se va a poder mandar solo".
    const hojaActualizada = await hojasSqlite.porNumero((await hoja002()).inventarioId, '002', 1);
    expect(hojaActualizada!.sync).toBe('error');

    // 4) LÍMITE CONOCIDO, documentado a propósito: el estado LOCAL de la
    //    hoja (`estado`, pendiente/en-proceso/finalizada) no se entera de
    //    que el servidor ya la dio por finalizada -- este adaptador no
    //    tiene forma de saberlo sin la respuesta del servidor, que es
    //    justo la que acaba de rechazar. Sigue siendo editable localmente
    //    (ver el siguiente test): el operario no queda trabado a mitad de
    //    la góndola, pero el conflicto real se resuelve recién cuando
    //    alguien mire `sync: 'error'` y decida qué hacer.
    expect(hojaActualizada!.estado).toBe('en-proceso');
  });

  it('tras el rechazo, la hoja sigue siendo editable localmente -- no se traba, no tira, no pierde el resto del trabajo', async () => {
    const { hojaId } = await hoja002();
    const otroProducto = 57;

    // Sigue contando otro producto de la misma hoja después del rechazo
    // del test anterior -- no debería fallar ni quedar en un estado raro.
    await expect(
      hojasSqlite.guardarConteo(hojaId, {
        productoId: otroProducto,
        empaques: [],
        sueltas: 3,
        confirmadoPorEscaner: false,
        contadoEn: 't-sigue-contando',
      }),
    ).resolves.toBeUndefined();

    const db = await obtenerDbDeTest();
    const conteo = await db.getFirstAsync('SELECT * FROM conteos WHERE hoja_id = ? AND producto_id = ?', [hojaId, otroProducto]);
    expect(conteo).not.toBeNull();
  });
});

describe('reintentar el mismo item de la cola, procesada dos veces, no lo reenvía ni lo duplica', () => {
  it('un item ya sincronizado no se vuelve a mandar en una segunda pasada de la cola', async () => {
    const { hojaId } = await hoja002();
    const productoId = 58;

    await hojasSqlite.guardarConteo(hojaId, {
      productoId,
      empaques: [{ empaqueNombre: 'Caja', cantidad: 2 }],
      sueltas: 0,
      confirmadoPorEscaner: false,
      contadoEn: 't-reintento-cola',
    });

    let vecesEnviado = 0;
    const contarEnvios = async (item: { hojaId: number; productoId: number }) => {
      if (item.hojaId === hojaId && item.productoId === productoId) vecesEnviado++;
      return { ok: true as const };
    };

    // "Reintentar" de verdad: se procesa la cola dos veces, como pasaría
    // si el sincronizador corriera de nuevo (ej. la app vuelve a primer
    // plano con WiFi otra vez) -- el item ya salió en la primera pasada,
    // así que la segunda no debería tener nada que mandar para él.
    await procesarColaDeSincronizacion(contarEnvios);
    await procesarColaDeSincronizacion(contarEnvios);

    expect(vecesEnviado).toBe(1);

    const db = await obtenerDbDeTest();
    const filasConteo = await db.getAllAsync('SELECT * FROM conteos WHERE hoja_id = ? AND producto_id = ?', [hojaId, productoId]);
    expect(filasConteo).toHaveLength(1); // una sola fila, nunca duplicada.
  });
});

describe('un conteo rechazado por el servidor no queda en un limbo silencioso', () => {
  it('marca el item en error y la hoja en sync: error, sin borrar el conteo local', async () => {
    const { hojaId } = await hoja002();
    const productoId = 54;

    await hojasSqlite.guardarConteo(hojaId, {
      productoId,
      empaques: [{ empaqueNombre: 'Caja', cantidad: 1 }],
      sueltas: 0,
      confirmadoPorEscaner: false,
      contadoEn: 't',
    });

    await procesarColaDeSincronizacion(async (item) => {
      if (item.hojaId === hojaId && item.productoId === productoId) {
        return { ok: false, motivo: 'rechazado' };
      }
      return { ok: true };
    });

    const db = await obtenerDbDeTest();
    const itemCola = await db.getFirstAsync<{ estado: string; intentos: number }>(
      "SELECT estado, intentos FROM cola_sync WHERE hoja_id = ? AND producto_id = ? AND tipo = 'conteo'",
      [hojaId, productoId],
    );
    expect(itemCola?.estado).toBe('error');
    expect(itemCola?.intentos).toBe(1);

    // El conteo local NO desaparece — solo dejó de estar sincronizado.
    const conteo = await db.getFirstAsync('SELECT * FROM conteos WHERE hoja_id = ? AND producto_id = ?', [hojaId, productoId]);
    expect(conteo).not.toBeNull();

    const inventario = await obtenerInventarioDeSucursal(1);
    const hojaActualizada = await hojasSqlite.porNumero(inventario!.id, '002', 1);
    expect(hojaActualizada!.sync).toBe('error');
  });

  it('un envío que sí sale bien saca el item de la cola y deja la hoja sincronizada', async () => {
    const { hojaId } = await hoja002();
    const productoId = 55;

    await hojasSqlite.guardarConteo(hojaId, {
      productoId,
      empaques: [{ empaqueNombre: 'Caja', cantidad: 1 }],
      sueltas: 0,
      confirmadoPorEscaner: false,
      contadoEn: 't',
    });
    await procesarColaDeSincronizacion(async () => ({ ok: true }));

    const db = await obtenerDbDeTest();
    const itemCola = await db.getFirstAsync("SELECT * FROM cola_sync WHERE hoja_id = ? AND producto_id = ? AND tipo = 'conteo'", [
      hojaId,
      productoId,
    ]);
    expect(itemCola).toBeNull(); // salió de la cola.

    // Este `enviar` siempre da `ok`, así que de paso retoma y resuelve
    // los items que el test anterior había dejado en `error` para la
    // MISMA hoja (procesarColaDeSincronizacion reintenta todo lo que no
    // esté "enviando", entre ellos los que ya fallaron una vez) — al
    // vaciarse la cola de esta hoja por completo, su sync pasa a
    // 'sincronizado'.
    const inventario = await obtenerInventarioDeSucursal(1);
    const hojaActualizada = await hojasSqlite.porNumero(inventario!.id, '002', 1);
    expect(hojaActualizada!.sync).toBe('sincronizado');
  });
});

describe('la descarga inicial distingue POR QUÉ no trajo hojas', () => {
  // Inventarios que no existen en el dataset de ejemplo (_compartido.ts):
  // así `hojasDeInventarioBase` cae a `{ hojas: [], origen: 'mock' }` sin
  // tocar ninguna hoja real de otro test, y lo único que importa acá es
  // qué motivo quedó guardado en `ultimaDescarga`.
  it('un 401 (sesión vencida) NO es "sin conexión": reconectar a la WiFi no lo arregla', async () => {
    vi.mocked(hojasApi.mias).mockRejectedValueOnce(new ErrorApi('sesion-vencida'));

    const hojas = await hojasSqlite.mias(999001, 1);

    expect(hojas).toEqual([]);
    expect(ultimaDescarga(999001, 'mias', 1)).toEqual({ ok: false, motivo: 'sesion-vencida' });
  });

  it('un 500 del servidor tampoco es "sin conexión": es un error de servidor', async () => {
    vi.mocked(hojasApi.mias).mockRejectedValueOnce(new ErrorApi('servidor'));

    const hojas = await hojasSqlite.mias(999002, 1);

    expect(hojas).toEqual([]);
    expect(ultimaDescarga(999002, 'mias', 1)).toEqual({ ok: false, motivo: 'error' });
  });

  it('la falla de red genérica sigue siendo "sin-red"', async () => {
    vi.mocked(hojasApi.mias).mockRejectedValueOnce(new ErrorApi('sin-red'));

    const hojas = await hojasSqlite.mias(999003, 1);

    expect(hojas).toEqual([]);
    expect(ultimaDescarga(999003, 'mias', 1)).toEqual({ ok: false, motivo: 'sin-red' });
  });
});

describe('el tamaño bajado es el NOMINAL del lote, no cuánto hay para contar', () => {
  // Caso real (inventario 20 del backend, hoja 025): el backend arma hojas
  // de a 50 (tamaño pedido al crear el lote, backend/dominio/lote.ts#
  // partirEnHojas) hasta que se acaba el catálogo — la última hoja de un
  // inventario que no es múltiplo exacto de 50 llega con menos productos
  // que ese nominal, y eso es correcto y esperado. `tamano` se guarda TAL
  // CUAL vino del backend, sin que hojas-sqlite.ts lo pise por
  // `productos.length` — quien necesita "cuánto hay para contar de
  // verdad" en las pantallas usa `avance()`/`productos.length`, nunca
  // este campo (ver mis-hojas.tsx, contar.tsx, InicioScreen.tsx).
  it('no pisa tamano con productos.length aunque el backend mande menos productos que el nominal', async () => {
    const productoDeTest = (id: number) => ({
      id,
      codigo: String(id).padStart(4, '0'),
      codigoBarras: `770000000${id}`,
      descripcion: `Producto ${id}`,
      empaques: [{ nombre: 'Caja', factor: 12 }],
    });

    vi.mocked(hojasApi.mias).mockResolvedValueOnce([
      {
        id: 90025,
        inventarioId: 999004,
        numero: '025',
        zona: 'Zona Z',
        gondola: 'Z9',
        tamano: 50, // nominal del lote — el backend NO lo ajustó a lo real.
        estado: 'pendiente',
        sync: 'sincronizado',
        asignados: ['María Rojas'],
        productos: Array.from({ length: 36 }, (_, i) => productoDeTest(i + 1)),
        conteos: [],
      },
    ]);

    const hojas = await hojasSqlite.mias(999004, 1);

    expect(hojas).toHaveLength(1);
    expect(hojas[0]!.tamano).toBe(50);
    expect(hojas[0]!.productos).toHaveLength(36);
  });
});

describe('inventarioIdSinRed: el fallback cuando no hay forma de preguntarle al servidor', () => {
  // Caso real: sin red, Inicio/Mis hojas/Contar no pueden llamar a
  // repositorioInventario.activo() (HTTP puro) para saber cuál es el
  // inventario activo -- pero si ya se descargó estructura de alguna hoja
  // (ver el test de arriba, que dejó inventario_id=999004 en
  // hojas_estructura), ESO alcanza para seguir mostrando el avance local
  // sin depender del servidor.
  it('devuelve el inventario_id de alguna hoja con estructura ya descargada', async () => {
    const db = await obtenerDbDeTest();
    const filas = await db.getAllAsync<{ inventario_id: number }>('SELECT inventario_id FROM hojas_estructura');
    expect(filas.length).toBeGreaterThan(0);

    const resultado = await inventarioIdSinRed();
    expect(resultado).not.toBeNull();
    expect(filas.map((f) => f.inventario_id)).toContain(resultado);
  });

  it('sin ninguna hoja con estructura local, devuelve null en vez de inventar un id', async () => {
    const db = await obtenerDbDeTest();
    await db.runAsync('DELETE FROM hojas_estructura');
    expect(await inventarioIdSinRed()).toBeNull();
  });
});

describe('CONTEO CIEGO ENTRE RONDAS: en la ronda 2 el Contador NO ve lo que contó en la 1', () => {
  // El requisito que no se negocia: al abrir el 2do conteo, la hoja tiene que
  // llegar EN CERO. Si arrastrara los conteos de la 1ra, el Contador vería un
  // número ya puesto y CONFIRMARÍA en vez de CONTAR — y el 2do conteo (que
  // existe justo para volver a contar a ciegas lo que no cuadró) no valdría
  // nada. La garantía es estructural: las hojas de cada ronda son filas
  // DISTINTAS de `hojas_estructura` (ids propios, `numero_conteo` propio) con
  // sus PROPIOS productos, y los `conteos` cuelgan de (hoja_id, producto_id) —
  // los de la ronda 1 nunca pueden aparecer bajo una hoja de la ronda 2.
  const INV = 888001;

  const prod = (id: number) => ({
    id,
    codigo: String(id).padStart(4, '0'),
    codigoBarras: `771000000${id}`,
    descripcion: `Producto ${id}`,
    empaques: [{ nombre: 'Caja', factor: 12 }],
  });

  // Mismo `numero` de hoja ('001') en las dos rondas — es la MISMA góndola
  // recontada — pero id de hoja y de productos distintos, como los
  // materializa el backend al abrir el reconteo.
  const PROD_R1 = 88100011;
  const hojaR1 = {
    id: 8810001,
    inventarioId: INV,
    numero: '001',
    zona: 'Zona R',
    gondola: 'R1',
    tamano: 50,
    estado: 'pendiente' as const,
    sync: 'sincronizado' as const,
    asignados: ['María Rojas'],
    productos: [prod(PROD_R1), prod(88100012)],
    conteos: [],
  };
  const hojaR2 = {
    id: 8820001,
    inventarioId: INV,
    numero: '001',
    zona: 'Zona R',
    gondola: 'R1',
    tamano: 50,
    estado: 'pendiente' as const,
    sync: 'sincronizado' as const,
    asignados: ['María Rojas'],
    productos: [prod(88200011)],
    conteos: [],
  };

  it('la hoja de la ronda 2 llega en 0 conteos y con OTROS productos — el conteo de la ronda 1 no la roza', async () => {
    // El backend devuelve las hojas de la ronda pedida: acá el mock ramifica
    // por `ronda`, exactamente como filtra el `?ronda=` del servidor.
    vi.mocked(hojasApi.mias).mockImplementation(async (_inv: number, ronda: number) =>
      ronda === 1 ? [hojaR1] : ronda === 2 ? [hojaR2] : [],
    );

    // --- Ronda 1: se baja y se cuenta un producto ---
    const ronda1 = await hojasSqlite.mias(INV, 1);
    const h1 = ronda1.find((h) => h.numero === '001')!;
    expect(avance(h1).contados).toBe(0); // arranca en 0, claro

    await hojasSqlite.guardarConteo(h1.id, {
      productoId: PROD_R1,
      empaques: [{ empaqueNombre: 'Caja', cantidad: 1 }],
      sueltas: 0,
      confirmadoPorEscaner: false,
      contadoEn: 't-ronda-1',
    });

    const ronda1DespuesDeContar = await hojasSqlite.mias(INV, 1);
    // La ronda 1 SÍ tiene su conteo — para que "0 en la ronda 2" signifique
    // algo, primero hay que probar que en la 1 el conteo existe de verdad.
    expect(avance(ronda1DespuesDeContar.find((h) => h.numero === '001')!).contados).toBe(1);

    // --- Ronda 2: el reconteo. LO QUE NO PUEDE FALLAR ---
    const ronda2 = await hojasSqlite.mias(INV, 2);
    const h2 = ronda2.find((h) => h.numero === '001')!;

    expect(avance(h2).contados).toBe(0); // EN CERO: se cuenta, no se confirma.
    expect(h2.conteos).toHaveLength(0);
    // Es OTRA hoja, con OTROS productos: el producto contado en la 1 ni
    // siquiera existe en la 2, así que no hay dónde arrastrar su conteo.
    expect(h2.id).not.toBe(h1.id);
    expect(h2.productos.some((p) => p.id === PROD_R1)).toBe(false);

    // Prueba estructural en la base: el conteo cuelga de la hoja de la ronda
    // 1, y la hoja de la ronda 2 no tiene ninguno.
    const db = await obtenerDbDeTest();
    const conteosR1 = await db.getAllAsync('SELECT * FROM conteos WHERE hoja_id = ?', [h1.id]);
    const conteosR2 = await db.getAllAsync('SELECT * FROM conteos WHERE hoja_id = ?', [h2.id]);
    expect(conteosR1).toHaveLength(1);
    expect(conteosR2).toHaveLength(0);

    // Coexistencia: cada `mias(inv, ronda)` devuelve SOLO las hojas de esa
    // ronda (filtro por `numero_conteo` en la consulta), nunca las de la otra.
    expect(ronda1DespuesDeContar.every((h) => h.id === h1.id)).toBe(true);
    expect(ronda2.every((h) => h.id === h2.id)).toBe(true);
  });
});

describe('AISLAMIENTO ENTRE CONTADORES: cada uno ve SOLO sus hojas, aunque el cache tenga las de todos', () => {
  // El caso real (min-5): el Coordinador bajó `todas` en ESTE mismo teléfono,
  // así que `hojas_estructura` quedó con las hojas de LOS DOS contadores. Cada
  // Contador tiene que ver solo las suyas y no poder abrir ni contar las del
  // otro — si no, se rompe el reparto y la asistencia deducida de "hoja
  // asignada con conteos" deja figurar como asistente a quien contó ajeno.
  const INV = 777001;
  const LUIS = 'Luis Shuan';
  const CARLA = 'Carla Depaz';

  const prod = (id: number) => ({
    id,
    codigo: String(id).padStart(4, '0'),
    codigoBarras: `772000000${id}`,
    descripcion: `Producto ${id}`,
    empaques: [{ nombre: 'Caja', factor: 12 }],
  });
  const hoja = (id: number, numero: string, quien: string) => ({
    id,
    inventarioId: INV,
    numero,
    zona: 'Zona R',
    gondola: 'R1',
    tamano: 50,
    estado: 'pendiente' as const,
    sync: 'sincronizado' as const,
    asignados: [quien],
    productos: [prod(id * 10 + 1)],
    conteos: [],
  });
  const hojasLuis = [hoja(7710001, '001', LUIS), hoja(7710002, '002', LUIS)];
  const hojasCarla = [hoja(7710011, '011', CARLA), hoja(7710012, '012', CARLA)];

  const sesionDe = (nombre: string) =>
    ({ ...SESION_MARIA, colaborador: { ...SESION_MARIA.colaborador, nombre } }) as unknown as Sesion;

  it('el Coordinador bajó TODAS; Luis ve solo las suyas, Carla solo las suyas, y ninguno abre las del otro', async () => {
    // Que la descarga en segundo plano de `mias` no reponga nada raro: lo que
    // se prueba es la lectura del cache que dejó `todas`, no otra descarga.
    vi.mocked(hojasApi.mias).mockResolvedValue([]);

    // El Coordinador baja `todas`: las 4 hojas (de los dos) entran al cache
    // compartido del teléfono — es EXACTAMENTE lo que dispara el bug.
    vi.mocked(hojasApi.todas).mockResolvedValueOnce([...hojasLuis, ...hojasCarla]);
    await hojasSqlite.todas(INV, 1);

    // Luis entra a Mis Hojas: ve SOLO las suyas.
    vi.mocked(sesionApi.sesionActiva).mockResolvedValue(sesionDe(LUIS));
    const deLuis = await hojasSqlite.mias(INV, 1);
    expect(deLuis.map((h) => h.numero).sort()).toEqual(['001', '002']);
    expect(deLuis.every((h) => h.asignados.includes(LUIS))).toBe(true);
    // Y NO puede abrir una de Carla ni sabiendo el número: null, no la hoja.
    expect(await hojasSqlite.porNumero(INV, '011', 1)).toBeNull();

    // Carla entra: ve las suyas, nunca las de Luis.
    vi.mocked(sesionApi.sesionActiva).mockResolvedValue(sesionDe(CARLA));
    const deCarla = await hojasSqlite.mias(INV, 1);
    expect(deCarla.map((h) => h.numero).sort()).toEqual(['011', '012']);
    expect(await hojasSqlite.porNumero(INV, '001', 1)).toBeNull();
  });

  it('sin sesión no se sabe de quién son las hojas: `mias` devuelve vacío, jamás todas', async () => {
    vi.mocked(sesionApi.sesionActiva).mockResolvedValue(null as unknown as Sesion);
    expect(await hojasSqlite.mias(INV, 1)).toEqual([]);
    expect(await hojasSqlite.porNumero(INV, '001', 1)).toBeNull();
  });
});

describe('migración v4 (numero_conteo): aditiva — nunca le cuesta a nadie un conteo ya hecho', () => {
  // Base v3 FRESCA, aparte del archivo compartido de los otros tests: así se
  // controla el "antes de v4" (estructura sin `numero_conteo`, más conteos y
  // cola ya sembrados) tal como está un teléfono ya instalado, y se corre
  // SOLO la migración v4 encima.
  async function crearDbV3(): Promise<{ db: DbDeTest; raw: DatabaseSync; dir: string }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventario-mig-v4-'));
    const raw = new DatabaseSync(path.join(dir, 'inventario.db'));
    const db = envolverNodeSqlite(raw);
    // Los 3 primeros elementos de MIGRACIONES_SQLITE = v1, v2, v3.
    for (let i = 0; i < 3; i++) await db.execAsync(MIGRACIONES_SQLITE[i]);
    await db.execAsync('PRAGMA user_version = 3');
    return { db, raw, dir };
  }

  function limpiar(raw: DatabaseSync, dir: string): void {
    raw.close();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Mismo motivo que el afterAll: Windows tarda en soltar el handle.
    }
  }

  it('las filas viejas quedan en ronda 1 (su ronda REAL, no un relleno) y volver a migrar no rompe', async () => {
    const { db, raw, dir } = await crearDbV3();
    try {
      // Una hoja bajada cuando el front solo pedía la 1ra: sin `numero_conteo`.
      await db.runAsync(
        'INSERT INTO hojas_estructura (id, inventario_id, numero, zona, gondola, tamano, asignados) VALUES (?,?,?,?,?,?,?)',
        [5001, 400, '001', 'Zona A', 'A1', 50, JSON.stringify(['Conteo'])],
      );

      await migrarSqlite(db);

      const fila = await db.getFirstAsync<{ numero_conteo: number }>('SELECT numero_conteo FROM hojas_estructura WHERE id = ?', [5001]);
      expect(fila?.numero_conteo).toBe(1); // su ronda real: se bajó cuando solo existía la 1ra.
      const ver = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      expect(ver?.user_version).toBe(MIGRACIONES_SQLITE.length);

      // Idempotente: ya está en la última versión, no vuelve a correr el
      // ALTER (que fallaría porque la columna ya existe).
      await expect(migrarSqlite(db)).resolves.toBeUndefined();
      const fila2 = await db.getFirstAsync<{ numero_conteo: number }>('SELECT numero_conteo FROM hojas_estructura WHERE id = ?', [5001]);
      expect(fila2?.numero_conteo).toBe(1);
    } finally {
      limpiar(raw, dir);
    }
  });

  it('LO QUE NO PUEDE FALLAR: un conteo offline y su ítem en la cola sobreviven intactos a la migración', async () => {
    const { db, raw, dir } = await crearDbV3();
    try {
      // El operario contó sin señal antes de actualizar la app: el conteo y su
      // ítem pendiente en la cola ya están en la base v3.
      await db.runAsync(
        'INSERT INTO conteos (hoja_id, producto_id, lineas, sueltas, confirmado_por_escaner, contado_en) VALUES (?,?,?,?,?,?)',
        [5001, 700, JSON.stringify([{ empaqueNombre: 'Caja', cantidad: 7 }]), 2, 0, 't-offline'],
      );
      await db.runAsync(
        "INSERT INTO cola_sync (hoja_id, tipo, producto_id, creado_en, intentos, estado) VALUES (?, 'conteo', ?, ?, 0, 'pendiente')",
        [5001, 700, 't-offline'],
      );

      await migrarSqlite(db);

      // El conteo sigue ahí, con el MISMO valor — la migración ni nombró la tabla.
      const conteo = await db.getFirstAsync<{ lineas: string; sueltas: number }>(
        'SELECT lineas, sueltas FROM conteos WHERE hoja_id = ? AND producto_id = ?',
        [5001, 700],
      );
      expect(conteo).not.toBeNull();
      expect(JSON.parse(conteo!.lineas)).toEqual([{ empaqueNombre: 'Caja', cantidad: 7 }]);
      expect(conteo!.sueltas).toBe(2);

      // Y su ítem en la cola sigue pendiente de mandar: no se perdió el "falta subir esto".
      const item = await db.getFirstAsync<{ estado: string; intentos: number }>(
        "SELECT estado, intentos FROM cola_sync WHERE hoja_id = ? AND producto_id = ? AND tipo = 'conteo'",
        [5001, 700],
      );
      expect(item?.estado).toBe('pendiente');
      expect(item?.intentos).toBe(0);
    } finally {
      limpiar(raw, dir);
    }
  });
});
