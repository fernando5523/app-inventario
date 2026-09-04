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

  it('el operario cuenta un ítem más (33 de 50) y sigue en 33 después de "reabrir" la app', async () => {
    const { inventarioId, hojaId } = await hoja002();
    const antes = await hojasSqlite.porNumero(inventarioId, '002');
    const sinContar = antes!.productos.find((p) => !antes!.conteos.some((c) => c.productoId === p.id))!;

    await hojasSqlite.guardarConteo(hojaId, {
      productoId: sinContar.id,
      empaques: 1,
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
    expect(despuesDeReabrir!.conteos.find((c) => c.productoId === sinContar.id)?.empaques).toBe(1);
  });
});

describe('no se duplican conteos al reintentar', () => {
  it('guardar el MISMO producto dos veces dejó una sola fila, con el valor más nuevo', async () => {
    const { hojaId } = await hoja002();
    const db = await obtenerDbDeTest();
    const productoId = 51; // primer producto de la Hoja #002 (código 0051).

    await hojasSqlite.guardarConteo(hojaId, {
      productoId,
      empaques: 3,
      sueltas: 1,
      confirmadoPorEscaner: false,
      contadoEn: '2026-09-05T10:01:00.000Z',
    });
    await hojasSqlite.guardarConteo(hojaId, {
      productoId,
      empaques: 5,
      sueltas: 0,
      confirmadoPorEscaner: false,
      contadoEn: '2026-09-05T10:02:00.000Z',
    });

    const filas = await db.getAllAsync<{ empaques: number }>('SELECT empaques FROM conteos WHERE hoja_id = ? AND producto_id = ?', [
      hojaId,
      productoId,
    ]);
    expect(filas).toHaveLength(1);
    expect(filas[0].empaques).toBe(5); // el valor MÁS NUEVO, no el primero.
  });

  it('reintentar el mismo conteo no deja dos items pendientes en la cola de sincronización', async () => {
    const { hojaId } = await hoja002();
    const db = await obtenerDbDeTest();
    const productoId = 52;

    await hojasSqlite.guardarConteo(hojaId, { productoId, empaques: 1, sueltas: 0, confirmadoPorEscaner: false, contadoEn: 't1' });
    await hojasSqlite.guardarConteo(hojaId, { productoId, empaques: 2, sueltas: 0, confirmadoPorEscaner: false, contadoEn: 't2' });

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
        await db.runAsync('INSERT OR REPLACE INTO conteos (hoja_id, producto_id, empaques, sueltas, confirmado_por_escaner, contado_en) VALUES (?,?,?,?,?,?)', [
          hojaId,
          productoId,
          9,
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

describe('un conteo rechazado por el servidor no queda en un limbo silencioso', () => {
  it('marca el item en error y la hoja en sync: error, sin borrar el conteo local', async () => {
    const { hojaId } = await hoja002();
    const productoId = 54;

    await hojasSqlite.guardarConteo(hojaId, { productoId, empaques: 1, sueltas: 0, confirmadoPorEscaner: false, contadoEn: 't' });

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

    await hojasSqlite.guardarConteo(hojaId, { productoId, empaques: 1, sueltas: 0, confirmadoPorEscaner: false, contadoEn: 't' });
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
