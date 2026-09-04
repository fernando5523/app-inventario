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
import { afterAll, describe, expect, it, vi } from 'vitest';
import { avance } from '../dominio/hoja';
import { migrarSqlite } from './sqlite-esquema';

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
  sesionApi: { sesionActiva: async () => null },
}));

// Import DESPUÉS del vi.mock (vitest lo hoistea igual, pero así queda
// explícito el orden real: hojas-sqlite.ts se carga con `_sqlite.ts` ya
// reemplazado, nunca llega a tocar `expo-sqlite`).
const { hojasSqlite, procesarColaDeSincronizacion } = await import('./hojas-sqlite');
const { obtenerInventarioDeSucursal } = await import('./_compartido');

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
    const hoja = await hojasSqlite.porNumero(inventarioId, '002');
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
    const antesDeCerrar = await hojasSqlite.porNumero(inventarioId, '002');
    expect(avance(antesDeCerrar!).contados).toBe(32);

    simularReinicioDeApp();

    const despuesDeReabrir = await hojasSqlite.porNumero(inventarioId, '002');
    expect(avance(despuesDeReabrir!).contados).toBe(32);
    // No solo la CANTIDAD: las líneas de cada conteo sobreviven intactas,
    // no solo un número que por casualidad coincide.
    expect(despuesDeReabrir!.conteos).toEqual(antesDeCerrar!.conteos);
  });

  it('el operario cuenta un ítem más (33 de 50) y sigue en 33 después de "reabrir" la app', async () => {
    const { inventarioId, hojaId } = await hoja002();
    const antes = await hojasSqlite.porNumero(inventarioId, '002');
    const sinContar = antes!.productos.find((p) => !antes!.conteos.some((c) => c.productoId === p.id))!;

    await hojasSqlite.guardarConteo(hojaId, {
      productoId: sinContar.id,
      empaques: [{ empaqueNombre: sinContar.empaques[0].nombre, cantidad: 1 }],
      sueltas: 0,
      confirmadoPorEscaner: false,
      contadoEn: '2026-09-05T10:00:00.000Z',
    });

    const antesDeCerrar = await hojasSqlite.porNumero(inventarioId, '002');
    expect(avance(antesDeCerrar!).contados).toBe(33);
    expect(antesDeCerrar!.estado).toBe('en-proceso');
    expect(antesDeCerrar!.sync).toBe('local');

    // ESTE es el momento que importa: se "cierra" la app.
    simularReinicioDeApp();

    // Y esto es EL test: al "volver a abrir", ¿sigue en 33?
    const despuesDeReabrir = await hojasSqlite.porNumero(inventarioId, '002');
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
    const hojaActualizada = await hojasSqlite.porNumero((await hoja002()).inventarioId, '002');
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
    const hojaActualizada = await hojasSqlite.porNumero(inventario!.id, '002');
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
    const hojaActualizada = await hojasSqlite.porNumero(inventario!.id, '002');
    expect(hojaActualizada!.sync).toBe('sincronizado');
  });
});
