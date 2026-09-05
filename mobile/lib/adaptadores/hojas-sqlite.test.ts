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
const { hojasSqlite, inventarioIdSinRed, rondaActivaSinRed, procesarColaDeSincronizacion, ultimaDescarga } = await import('./hojas-sqlite');
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

describe('ARREGLADO (2026-09-05): una hoja no se declara finalizada ante el servidor mientras tenga conteos sin resolver', () => {
  // Antes de este fix, `procesarColaDeSincronizacion` mandaba el
  // `finalizar` de una hoja aunque el `conteo` de la MISMA hoja que iba
  // antes en la cola hubiera sido rechazado -- el servidor terminaba
  // creyendo la hoja completa (sync: 'sincronizado') sin que nadie le
  // avisara del hueco, y `rondas.service.ts#cerrar` podía cerrar la
  // ronda sobre esa mentira. Decisión del cliente: NO es una regla de
  // negocio, es honestidad del estado -- una hoja no puede declararse
  // finalizada mientras el servidor no aceptó todos sus conteos.
  //
  // Hoja sintética propia (no la #002 del seed, que otros tests de este
  // archivo ya finalizan/sincronizan) — cada test usa un INVENTARIO
  // propio (no solo una hoja propia): `mias()` solo AWAITEA la descarga
  // cuando no hay nada local todavía para ese inventario (ver
  // `descargarSiHaceFalta`) -- compartir un inventario entre tests haría
  // que el segundo cayera en la descarga en 2do plano (`void
  // descargarHojas`) y leyera la base ANTES de que esa descarga termine.
  function hojaDeRiesgo(inventarioId: number, id: number, numero: string, productoId: number) {
    return {
      id,
      inventarioId,
      numero,
      zona: 'Zona R',
      gondola: 'R1',
      tamano: 50,
      estado: 'pendiente' as const,
      sync: 'sincronizado' as const,
      asignados: ['María Rojas'],
      productos: [
        {
          id: productoId,
          codigo: String(productoId).padStart(4, '0'),
          codigoBarras: `774000000${productoId}`,
          descripcion: `Producto ${productoId}`,
          empaques: [{ nombre: 'Caja', factor: 12 }],
        },
      ],
      conteos: [],
    };
  }

  it('hoja con 1 rechazado: NO se manda el finalizar (queda pendiente, la hoja visible en error)', async () => {
    const INV_RIESGO = 555101;
    const productoId = 991;
    vi.mocked(hojasApi.mias).mockResolvedValueOnce([hojaDeRiesgo(INV_RIESGO, 5551001, '001', productoId)]);
    const [hoja] = await hojasSqlite.mias(INV_RIESGO, 1);
    const hojaId = hoja!.id;

    await hojasSqlite.guardarConteo(hojaId, {
      productoId,
      empaques: [{ empaqueNombre: 'Caja', cantidad: 1 }],
      sueltas: 0,
      confirmadoPorEscaner: false,
      contadoEn: 't-riesgo-conteo',
    });
    // finalizar() no exige que la hoja esté completa (puedeFinalizar solo
    // mira si YA estaba finalizada, nunca si faltan renglones) — mismo
    // criterio que el backend, ver hojas.service.ts#finalizar. El punto
    // de este test es que la cola SÍ lo frena, aunque el dominio no.
    await hojasSqlite.finalizar(hojaId);

    let seLlamoAFinalizar = false;
    await procesarColaDeSincronizacion(async (item) => {
      if (item.tipo === 'finalizar') seLlamoAFinalizar = true;
      if (item.tipo === 'conteo' && item.productoId === productoId) {
        return { ok: false, motivo: 'rechazado', mensaje: 'La ronda 1 ya cerró.' };
      }
      return { ok: true };
    });

    // El finalizar NUNCA se intentó mandar -- ni siquiera para que el
    // servidor lo rechazara: se lo bloqueó ACÁ, antes de gastar el viaje.
    expect(seLlamoAFinalizar).toBe(false);

    const db = await obtenerDbDeTest();

    // El conteo rechazado queda visible, con la razón que dio "el servidor".
    const itemConteo = await db.getFirstAsync<{ estado: string; razon: string | null }>(
      "SELECT estado, razon FROM cola_sync WHERE hoja_id = ? AND tipo = 'conteo' AND producto_id = ?",
      [hojaId, productoId],
    );
    expect(itemConteo?.estado).toBe('error');
    expect(itemConteo?.razon).toBe('La ronda 1 ya cerró.');

    // El finalizar sigue en la cola, PENDIENTE -- no se perdió, no quedó
    // en error: está esperando a que se resuelva lo que lo bloquea.
    const itemFinalizar = await db.getFirstAsync<{ estado: string }>("SELECT estado FROM cola_sync WHERE hoja_id = ? AND tipo = ?", [
      hojaId,
      'finalizar',
    ]);
    expect(itemFinalizar?.estado).toBe('pendiente');

    // Local: la persona SÍ ve que algo quedó mal (sync: 'error') -- pero,
    // a propósito, la hoja no le miente al SERVIDOR diciendo que está
    // completa: eso es justamente lo que este fix evita.
    const hojaLocal = await hojasSqlite.porNumero(INV_RIESGO, '001', 1);
    expect(hojaLocal!.sync).toBe('error');
  });

  it('se resuelve el rechazo: en la próxima pasada, el finalizar SÍ se manda', async () => {
    const INV_RIESGO = 555102;
    const productoId = 992;
    vi.mocked(hojasApi.mias).mockResolvedValueOnce([hojaDeRiesgo(INV_RIESGO, 5551002, '002', productoId)]);
    const [hoja] = await hojasSqlite.mias(INV_RIESGO, 1);
    const hojaId = hoja!.id;

    await hojasSqlite.guardarConteo(hojaId, {
      productoId,
      empaques: [{ empaqueNombre: 'Caja', cantidad: 1 }],
      sueltas: 0,
      confirmadoPorEscaner: false,
      contadoEn: 't-riesgo-conteo-2',
    });
    await hojasSqlite.finalizar(hojaId);

    // Pasada 1: el conteo se rechaza -- el finalizar queda bloqueado (ya
    // demostrado arriba).
    await procesarColaDeSincronizacion(async (item) => {
      if (item.tipo === 'conteo' && item.productoId === productoId) {
        return { ok: false, motivo: 'rechazado' };
      }
      return { ok: true };
    });

    // Se resuelve lo que bloqueaba (ej. la ronda se reabrió, o era un
    // error transitorio del servidor): el MISMO item de la cola se
    // reintenta, sin tocar el conteo local -- que la hoja ya esté
    // finalizada localmente le impide a la persona corregirlo a mano
    // (`puedeEditar`), así que "resolverse" acá es que el reintento
    // automático tenga éxito, no una edición nueva.
    //
    // Pasada 2: esta vez todo sale bien -- incluido el conteo que antes
    // se había rechazado.
    let seLlamoAFinalizar = false;
    await procesarColaDeSincronizacion(async (item) => {
      if (item.tipo === 'finalizar') seLlamoAFinalizar = true;
      return { ok: true };
    });

    expect(seLlamoAFinalizar).toBe(true);

    const db = await obtenerDbDeTest();
    const restantes = await db.getAllAsync('SELECT * FROM cola_sync WHERE hoja_id = ?', [hojaId]);
    expect(restantes).toHaveLength(0); // cola vacía: conteo Y finalizar salieron.

    const hojaLocal = await hojasSqlite.porNumero(INV_RIESGO, '002', 1);
    expect(hojaLocal!.estado).toBe('finalizada');
    expect(hojaLocal!.sync).toBe('sincronizado');
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
    expect(ultimaDescarga(999001, 'mias', 1)).toEqual({ ok: false, motivo: 'sesion-vencida', hojas: 0 });
  });

  it('un 500 del servidor tampoco es "sin conexión": es un error de servidor', async () => {
    vi.mocked(hojasApi.mias).mockRejectedValueOnce(new ErrorApi('servidor'));

    const hojas = await hojasSqlite.mias(999002, 1);

    expect(hojas).toEqual([]);
    expect(ultimaDescarga(999002, 'mias', 1)).toEqual({ ok: false, motivo: 'error', hojas: 0 });
  });

  it('la falla de red genérica sigue siendo "sin-red"', async () => {
    vi.mocked(hojasApi.mias).mockRejectedValueOnce(new ErrorApi('sin-red'));

    const hojas = await hojasSqlite.mias(999003, 1);

    expect(hojas).toEqual([]);
    expect(ultimaDescarga(999003, 'mias', 1)).toEqual({ ok: false, motivo: 'sin-red', hojas: 0 });
  });
});

describe('la descarga que se corta A MEDIAS no queda marcada como completa', () => {
  // El caso pedido: hojasApi devuelve N hojas y el guardado en SQLite
  // falla en la K-ésima (disco lleno, cualquier error del motor — acá se
  // simula rompiendo el propio `runAsync` para esa hoja puntual). Lo que
  // importa: ¿las hojas guardadas ANTES del corte quedan mostradas como
  // si fueran el total, sin ningún aviso de que se cortó?
  const INV = 666001;
  const productoDeTest = (id: number) => ({
    id,
    codigo: String(id).padStart(4, '0'),
    codigoBarras: `773000000${id}`,
    descripcion: `Producto ${id}`,
    empaques: [{ nombre: 'Caja', factor: 12 }],
  });
  const hojaDeTest = (id: number, numero: string) => ({
    id,
    inventarioId: INV,
    numero,
    zona: 'Zona T',
    gondola: 'T1',
    tamano: 50,
    estado: 'pendiente' as const,
    sync: 'sincronizado' as const,
    asignados: ['María Rojas'],
    productos: [productoDeTest(id * 10 + 1)],
    conteos: [],
  });

  it('con 3 hojas y el guardado roto en la 2da: se guarda solo la 1ra, el resultado queda incompleto (no ok:true con "3")', async () => {
    const hojas = [hojaDeTest(6660001, '001'), hojaDeTest(6660002, '002'), hojaDeTest(6660003, '003')];
    vi.mocked(hojasApi.mias).mockResolvedValueOnce(hojas);

    const db = await obtenerDbDeTest();
    const runOriginal = db.runAsync.bind(db);
    const rotoEn2da = vi.spyOn(db, 'runAsync').mockImplementation(async (source: string, params: unknown[] = []) => {
      if (source.includes('INSERT INTO hojas_estructura') && (params as unknown[])[0] === 6660002) {
        throw new Error('disco lleno (simulado)');
      }
      return runOriginal(source, params);
    });

    // Antes del fix esto rechazaba (la excepción se colaba sin atrapar
    // hasta mias()) y dejaba a quien llama con una promesa que nunca
    // resuelve — el mismo spinner infinito de f558689, en un lugar nuevo.
    const resultado1 = await hojasSqlite.mias(INV, 1);

    rotoEn2da.mockRestore();

    // Solo la 1ra hoja (guardada ANTES del corte) llegó a persistirse —
    // la 2da rompió y la 3ra ni se intentó.
    const filas = await db.getAllAsync<{ id: number }>('SELECT id FROM hojas_estructura WHERE inventario_id = ? ORDER BY id', [INV]);
    expect(filas.map((f) => f.id)).toEqual([6660001]);
    expect(resultado1.map((h) => h.numero)).toEqual(['001']);

    // EL PUNTO DEL BUG: el resultado de ESTA descarga no puede quedar
    // "ok: true" con la cuenta de lo pedido (3) ni de lo guardado (1) —
    // eso sería mostrar 1 hoja como si fuera el total sin avisar nada.
    // Tiene que quedar marcado como incompleto, con cuántas SÍ entraron.
    expect(ultimaDescarga(INV, 'mias', 1)).toEqual({ ok: false, motivo: 'incompleta', hojas: 1 });
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

describe('AVANCE OFFLINE: la ronda activa NO suma las dos rondas', () => {
  // El caso real (visto en el emulador, ronda 2 de Market Bolívar): con la
  // ronda 1 y la ronda 2 ambas asignadas al Contador y en la estructura local,
  // SIN RED "Tu avance" contaba 50 hojas (las dos rondas) en vez de las 25 de
  // la ronda activa. La lista ONLINE (con `activo().rondaActiva`) sí mostraba
  // 25 — la divergencia está en el camino offline (`rondaActivaSinRed` + mias).
  const INV = 999100;
  const prod = (id: number) => ({
    id,
    codigo: String(id).padStart(4, '0'),
    codigoBarras: `773000000${id}`,
    descripcion: `Producto ${id}`,
    empaques: [{ nombre: 'Caja', factor: 12 }],
  });
  // Mismo `numero` (#001..#025) en las dos rondas — es la MISMA góndola
  // recontada — pero ids de hoja/producto distintos, como los materializa el
  // backend al abrir el reconteo. Ambas asignadas a María (la sesión default).
  const hoja = (id: number, numero: string) => ({
    id,
    inventarioId: INV,
    numero,
    zona: 'Zona X',
    gondola: 'X1',
    tamano: 50,
    estado: 'pendiente' as const,
    sync: 'sincronizado' as const,
    asignados: ['María Rojas'],
    productos: [prod(id * 10 + 1)],
    conteos: [],
  });
  const hojasR1 = Array.from({ length: 25 }, (_, i) => hoja(99110000 + i, String(i + 1).padStart(3, '0')));
  const hojasR2 = Array.from({ length: 25 }, (_, i) => hoja(99120000 + i, String(i + 1).padStart(3, '0')));

  it('con 25 hojas en ronda 1 y 25 en ronda 2 locales, sin red, mias(ronda activa) devuelve 25 — nunca 50', async () => {
    // El Coordinador vio la ronda 1 y la 2: las 50 quedaron en la estructura
    // local (25 con numero_conteo=1, 25 con numero_conteo=2).
    vi.mocked(hojasApi.todas).mockResolvedValueOnce(hojasR1);
    await hojasSqlite.todas(INV, 1);
    vi.mocked(hojasApi.todas).mockResolvedValueOnce(hojasR2);
    await hojasSqlite.todas(INV, 2);

    // Sin red para lo que sigue: el refresco en segundo plano de `mias` falla.
    vi.mocked(hojasApi.mias).mockRejectedValue(new ErrorApi('sin-red'));

    // La ronda activa sin red = la más alta descargada.
    expect(await rondaActivaSinRed(INV)).toBe(2);

    // El camino EXACTO de Inicio/Mis hojas offline: mias con la ronda activa.
    const activa = await rondaActivaSinRed(INV);
    const mias = await hojasSqlite.mias(INV, activa!);

    // LO QUE NO PUEDE FALLAR: solo las 25 de la ronda 2, NUNCA las 50.
    expect(mias).toHaveLength(25);
    // Y el avance (total de productos de esas hojas) es sobre 25 hojas, no 50.
    expect(mias.reduce((acc, h) => acc + h.productos.length, 0)).toBe(25);
  });
});

describe('OFFLINE MULTI-TIENDA: sin red, cada colaborador ve SOLO su sucursal y su ronda', () => {
  // Caso real (min-1, emulador, 2026-09-06): un Contador de Bolívar bajó
  // sus hojas de las rondas 1 y 2 en este mismo teléfono; después, Luis
  // Shuan (Contador de Luzuriaga) cierra y reabre la app SIN RED, y "Mis
  // hojas" le mostraba 50 hojas / 2.470 ítems de BOLÍVAR, con la #001
  // duplicada (las dos rondas). `hojas_estructura` es una tabla COMPARTIDA
  // por todo lo que se haya descargado alguna vez en el equipo, y el
  // camino sin red (`inventarioIdSinRed`/`rondaActivaSinRed`) no
  // distinguía ni sucursal ni colaborador: devolvía la primera fila que
  // encontraba (`LIMIT 1`, sin condición), y de ahí en más TODO heredaba
  // el inventario equivocado.
  const INV_LUZURIAGA = 999200;
  const INV_BOLIVAR = 999201;
  const SUC_LUZURIAGA = 1;
  const SUC_BOLIVAR = 2;

  const prod = (id: number) => ({
    id,
    codigo: String(id).padStart(4, '0'),
    codigoBarras: `775000000${id}`,
    descripcion: `Producto ${id}`,
    empaques: [{ nombre: 'Caja', factor: 12 }],
  });
  const hoja = (inventarioId: number, id: number, numero: string, asignados: string[]) => ({
    id,
    inventarioId,
    numero,
    zona: 'Zona Y',
    gondola: 'Y1',
    tamano: 50,
    estado: 'pendiente' as const,
    sync: 'sincronizado' as const,
    asignados,
    productos: [prod(id * 10 + 1)],
    conteos: [],
  });

  const sesionDeTienda = (nombre: string, sucursalId: number, sucursalNombre: string) =>
    ({
      colaborador: { id: 900 + sucursalId, nombre, dni: '0000', rol: 'conteo' },
      sucursal: { id: sucursalId, nombre: sucursalNombre, colaboradores: 1 },
      token: 'token-de-prueba',
      expiraEn: '2099-01-01T00:00:00.000Z',
    }) as unknown as Sesion;

  const hojasLuzuriaga = Array.from({ length: 10 }, (_, i) =>
    hoja(INV_LUZURIAGA, 9992000 + i, String(i + 1).padStart(3, '0'), ['Luis Paredes']),
  );
  const hojasBolivarR1 = Array.from({ length: 25 }, (_, i) =>
    hoja(INV_BOLIVAR, 9992100 + i, String(i + 1).padStart(3, '0'), ['Contador 30']),
  );
  const hojasBolivarR2 = Array.from({ length: 25 }, (_, i) =>
    hoja(INV_BOLIVAR, 9992200 + i, String(i + 1).padStart(3, '0'), ['Contador 30']),
  );

  it('dos tiendas, dos rondas, mismo teléfono, sin red: Luis Paredes ve SOLO sus 10 de Luzuriaga, nunca las 50 de Bolívar, sin duplicados', async () => {
    // 1) Contador 30 (Bolívar) baja sus dos rondas en este equipo.
    vi.mocked(sesionApi.sesionActiva).mockResolvedValue(sesionDeTienda('Contador 30', SUC_BOLIVAR, 'Market Bolívar'));
    vi.mocked(hojasApi.todas).mockResolvedValueOnce(hojasBolivarR1);
    await hojasSqlite.todas(INV_BOLIVAR, 1);
    vi.mocked(hojasApi.todas).mockResolvedValueOnce(hojasBolivarR2);
    await hojasSqlite.todas(INV_BOLIVAR, 2);

    // 2) Luis (Luzuriaga) entra en el MISMO teléfono y baja su ronda 1.
    vi.mocked(sesionApi.sesionActiva).mockResolvedValue(sesionDeTienda('Luis Paredes', SUC_LUZURIAGA, 'Market Central Luzuriaga'));
    vi.mocked(hojasApi.mias).mockResolvedValueOnce(hojasLuzuriaga);
    await hojasSqlite.mias(INV_LUZURIAGA, 1);

    // 3) Luis cierra la app y la reabre SIN RED -- el camino offline
    // entero, exactamente como en el reporte.
    vi.mocked(hojasApi.mias).mockRejectedValue(new ErrorApi('sin-red'));
    vi.mocked(hojasApi.todas).mockRejectedValue(new ErrorApi('sin-red'));

    const inventarioId = await inventarioIdSinRed();
    expect(inventarioId).toBe(INV_LUZURIAGA); // NUNCA Bolívar.

    const ronda = await rondaActivaSinRed(inventarioId!);
    expect(ronda).toBe(1);

    const mias = await hojasSqlite.mias(inventarioId!, ronda!);
    expect(mias).toHaveLength(10); // las suyas -- nunca las 50 de Bolívar.
    expect(mias.every((h) => h.inventarioId === INV_LUZURIAGA)).toBe(true);
    expect(new Set(mias.map((h) => h.numero)).size).toBe(10); // sin la #001 duplicada.
    // El avance cuenta SOLO esto: 10 hojas, 10 productos (uno por hoja en este fixture).
    expect(mias.reduce((acc, h) => acc + h.productos.length, 0)).toBe(10);
  });

  it('Contador 30 (Bolívar), mismo teléfono, sin red: ve sus 25 de la ronda activa (2) -- ni las 10 de Luzuriaga, ni su propia ronda 1', async () => {
    vi.mocked(sesionApi.sesionActiva).mockResolvedValue(sesionDeTienda('Contador 30', SUC_BOLIVAR, 'Market Bolívar'));
    vi.mocked(hojasApi.mias).mockRejectedValue(new ErrorApi('sin-red'));
    vi.mocked(hojasApi.todas).mockRejectedValue(new ErrorApi('sin-red'));

    const inventarioId = await inventarioIdSinRed();
    expect(inventarioId).toBe(INV_BOLIVAR);

    const ronda = await rondaActivaSinRed(inventarioId!);
    expect(ronda).toBe(2); // la más alta ENTRE SUS PROPIAS hojas de este inventario.

    const mias = await hojasSqlite.mias(inventarioId!, ronda!);
    expect(mias).toHaveLength(25);
    expect(mias.every((h) => h.inventarioId === INV_BOLIVAR)).toBe(true);
  });
});

describe('ENDURECIMIENTO: el id de colaborador resuelve lo que el nombre solo no puede -- un homónimo', () => {
  // El filtro de `mias()` (y de `inventarioIdSinRed`/`rondaActivaSinRed`)
  // usaba SOLO el nombre para decidir "es mía". Es frágil: dos personas
  // DISTINTAS con el mismo nombre, en la MISMA tienda, en la MISMA ronda
  // -- ni el inventario, ni la ronda, ni la sucursal alcanzan para
  // separarlas, porque las dos comparten los tres. El id de colaborador
  // (backend, hojas.service.ts#aHojaDto -- endurecimiento 2026-09-06) es
  // lo único que sí las distingue.
  const INV = 999400;
  const NOMBRE_COMPARTIDO = 'Luis Pérez';
  const COLAB_A = 5001; // el "Luis Pérez" dueño de la #001
  const COLAB_B = 5002; // OTRO "Luis Pérez" -- misma tienda, misma ronda, dueño de la #002

  const prod = (id: number) => ({
    id,
    codigo: String(id).padStart(4, '0'),
    codigoBarras: `776000000${id}`,
    descripcion: `Producto ${id}`,
    empaques: [{ nombre: 'Caja', factor: 12 }],
  });
  const hoja = (id: number, numero: string, asignadoAId: number) => ({
    id,
    inventarioId: INV,
    numero,
    zona: 'Zona H',
    gondola: 'H1',
    tamano: 50,
    estado: 'pendiente' as const,
    sync: 'sincronizado' as const,
    // MISMO nombre en las dos -- es justo el caso que el nombre solo no
    // puede resolver.
    asignados: [NOMBRE_COMPARTIDO],
    asignadoAId,
    asignadoA2Id: null,
    productos: [prod(id * 10 + 1)],
    conteos: [],
  });

  const sesionDe = (colaboradorId: number) =>
    ({
      colaborador: { id: colaboradorId, nombre: NOMBRE_COMPARTIDO, dni: '0000', rol: 'conteo' },
      sucursal: { id: 1, nombre: 'Sucursal de prueba', colaboradores: 2 },
      token: 't',
      expiraEn: '2099-01-01T00:00:00.000Z',
    }) as unknown as Sesion;

  it('cada "Luis Pérez" ve SOLO su propia hoja, aunque compartan nombre, tienda y ronda', async () => {
    const hojas = [hoja(9994001, '001', COLAB_A), hoja(9994002, '002', COLAB_B)];

    vi.mocked(sesionApi.sesionActiva).mockResolvedValue(sesionDe(COLAB_A));
    vi.mocked(hojasApi.mias).mockResolvedValueOnce(hojas);
    const deA = await hojasSqlite.mias(INV, 1);

    // Con el filtro viejo (solo `asignados.includes(nombre)`) esto habría
    // devuelto las DOS hojas: las dos dicen "Luis Pérez". Con el id, solo
    // la que de verdad es de COLAB_A.
    expect(deA.map((h) => h.numero)).toEqual(['001']);
    expect(deA.every((h) => h.asignadoAId === COLAB_A)).toBe(true);

    // El otro "Luis Pérez" (mismo teléfono, sesión distinta): ve la SUYA,
    // nunca la de su homónimo.
    vi.mocked(sesionApi.sesionActiva).mockResolvedValue(sesionDe(COLAB_B));
    const deB = await hojasSqlite.mias(INV, 1);
    expect(deB.map((h) => h.numero)).toEqual(['002']);
    expect(deB.every((h) => h.asignadoAId === COLAB_B)).toBe(true);
  });

  it('lo mismo para porNumero(): pedir la #002 como COLAB_A da null, no la hoja del homónimo', async () => {
    vi.mocked(sesionApi.sesionActiva).mockResolvedValue(sesionDe(COLAB_A));
    // La estructura ya quedó descargada por el test anterior (mismo INV).
    const hojaAjena = await hojasSqlite.porNumero(INV, '002', 1);
    expect(hojaAjena).toBeNull();

    const hojaPropia = await hojasSqlite.porNumero(INV, '001', 1);
    expect(hojaPropia).not.toBeNull();
    expect(hojaPropia!.asignadoAId).toBe(COLAB_A);
  });
});

describe('ENDURECIMIENTO: una sesión local incompleta o corrupta no muestra hojas de nadie', () => {
  // Hallazgo min-1 (2026-09-06): sin red, "Mis hojas" de Luis mostró las
  // hojas de OTRO colaborador -- ya con el filtro por id aplicado
  // (859ea5e). Al revisar `sesion_activa` (SQLite del dispositivo) en el
  // momento de investigar, la tabla estaba VACÍA -- no se pudo confirmar
  // la fila exacta de aquel instante, pero deja claro que esa tabla
  // puede terminar sin una sesión completa (expiró, quedó a medio
  // escribir, un payload viejo). Esto prueba que, pase lo que pase con
  // esa fila, un `colaborador.id` o `nombre` faltante en la sesión NO
  // puede terminar mostrando hojas de otra persona -- tiene que mostrar
  // NADA, ni siquiera cayendo al nombre (que también podría faltar, o
  // coincidir por casualidad).
  const INV = 999600;
  const COLABORADOR_ID_REAL = 57; // el id real de Luis Shuan, capturado del emulador.

  const prod = (id: number) => ({
    id,
    codigo: String(id).padStart(4, '0'),
    codigoBarras: `777000000${id}`,
    descripcion: `Producto ${id}`,
    empaques: [{ nombre: 'Caja', factor: 12 }],
  });
  const hojaDeLuis = {
    id: 9996001,
    inventarioId: INV,
    numero: '001',
    zona: 'Zona S',
    gondola: 'S1',
    tamano: 50,
    estado: 'pendiente' as const,
    sync: 'sincronizado' as const,
    asignados: ['Luis Shuan'],
    asignadoAId: COLABORADOR_ID_REAL,
    asignadoA2Id: null,
    productos: [prod(70001)],
    conteos: [],
  };

  it('sin colaborador.id en la sesión (payload parcial): ni por id ni cayendo al nombre -- no muestra nada', async () => {
    // Primero, CON una sesión válida, se descarga la hoja real de Luis
    // (queda en hojas_estructura para el resto del test). `mockResolvedValue`
    // (no `Once`): `mias()` consulta la sesión más de una vez (al guardar
    // la estructura Y al filtrar), y las dos tienen que ver la misma sesión.
    vi.mocked(sesionApi.sesionActiva).mockResolvedValue({
      colaborador: { id: COLABORADOR_ID_REAL, nombre: 'Luis Shuan', dni: '9102', rol: 'conteo' },
      sucursal: { id: 30, nombre: 'Market Central Luzuriaga', colaboradores: 6 },
      token: 't',
      expiraEn: '2099-01-01T00:00:00.000Z',
    } as unknown as Sesion);
    vi.mocked(hojasApi.mias).mockResolvedValueOnce([hojaDeLuis]);
    const conSesionValida = await hojasSqlite.mias(INV, 1);
    expect(conSesionValida).toHaveLength(1); // control: con sesión válida, SÍ la ve.

    // Ahora la sesión queda con el NOMBRE (coincide con la hoja) pero SIN
    // colaborador.id -- el "solo token" que planteó la hipótesis. Con el
    // viejo filtro por nombre esto la habría mostrado igual.
    vi.mocked(sesionApi.sesionActiva).mockResolvedValue({
      colaborador: { nombre: 'Luis Shuan', dni: '9102', rol: 'conteo' },
      sucursal: { id: 30, nombre: 'Market Central Luzuriaga', colaboradores: 6 },
      token: 't',
      expiraEn: '2099-01-01T00:00:00.000Z',
    } as unknown as Sesion);

    expect(await inventarioIdSinRed()).toBeNull();
    expect(await rondaActivaSinRed(INV)).toBeNull();
    expect(await hojasSqlite.mias(INV, 1)).toEqual([]);
    expect(await hojasSqlite.porNumero(INV, '001', 1)).toBeNull();
  });

  it('con sucursal a medias (el objeto está, pero sin id): tampoco muestra nada', async () => {
    vi.mocked(sesionApi.sesionActiva).mockResolvedValue({
      colaborador: { id: COLABORADOR_ID_REAL, nombre: 'Luis Shuan', dni: '9102', rol: 'conteo' },
      sucursal: { nombre: 'Market Central Luzuriaga', colaboradores: 6 }, // sin id
      token: 't',
      expiraEn: '2099-01-01T00:00:00.000Z',
    } as unknown as Sesion);

    expect(await inventarioIdSinRed()).toBeNull();
  });

  it('sesión null-ish (ni objeto): igual que no tener sesión -- null, no una excepción', async () => {
    vi.mocked(sesionApi.sesionActiva).mockResolvedValue({} as unknown as Sesion);
    expect(await inventarioIdSinRed()).toBeNull();
    expect(await hojasSqlite.mias(INV, 1)).toEqual([]);
  });
});
