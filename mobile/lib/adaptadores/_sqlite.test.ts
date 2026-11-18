/**
 * Abrir la base local suelta los envíos que quedaron a medias la vez
 * anterior. Ver el comentario en `_sqlite.ts#obtenerDb`.
 *
 * `expo-sqlite` se reemplaza por `node:sqlite` sobre un archivo real, y el
 * esquema es el de verdad (`migrarSqlite`): cerrar y volver a abrir el mismo
 * archivo es lo que pasa cuando la app se cierra y vuelve a arrancar.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it, vi } from 'vitest';

const archivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inventario-abrir-')), 'inventario.db');

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => {
    const raw = new DatabaseSync(archivo);
    return {
      execAsync: async (sql: string) => {
        raw.exec(sql);
      },
      runAsync: async (sql: string, params: unknown[] = []) => {
        raw.prepare(sql).run(...(params as never[]));
      },
      getAllAsync: async (sql: string, params: unknown[] = []) => raw.prepare(sql).all(...(params as never[])),
      getFirstAsync: async (sql: string, params: unknown[] = []) => raw.prepare(sql).get(...(params as never[])) ?? null,
      withTransactionAsync: async (tarea: () => Promise<void>) => {
        raw.exec('BEGIN');
        try {
          await tarea();
          raw.exec('COMMIT');
        } catch (e) {
          raw.exec('ROLLBACK');
          throw e;
        }
      },
      closeAsync: async () => {
        raw.close();
      },
    };
  },
}));

const { obtenerDb, cerrarDbParaTests } = await import('./_sqlite');

afterAll(async () => {
  await cerrarDbParaTests();
  fs.rmSync(path.dirname(archivo), { recursive: true, force: true });
});

describe('al arrancar, un envío que quedó a medias se vuelve a intentar', () => {
  it('lo que quedó "enviando" vuelve a pendiente; un rechazo definitivo no se toca', async () => {
    const db = await obtenerDb();
    const encolar = (hojaId: number, estado: string) =>
      db.runAsync(
        `INSERT INTO cola_sync (hoja_id, tipo, producto_id, creado_en, intentos, estado) VALUES (?, 'conteo', 1, 't', 0, ?)`,
        [hojaId, estado],
      );
    await encolar(1, 'enviando'); // la app se cerró mientras subía
    await encolar(2, 'rechazado'); // el servidor ya dijo que no: no se reintenta
    await encolar(3, 'pendiente');

    await cerrarDbParaTests();
    const reabierta = await obtenerDb();

    const filas = await reabierta.getAllAsync<{ hoja_id: number; estado: string }>(
      'SELECT hoja_id, estado FROM cola_sync ORDER BY hoja_id',
    );
    expect(filas).toEqual([
      { hoja_id: 1, estado: 'pendiente' },
      { hoja_id: 2, estado: 'rechazado' },
      { hoja_id: 3, estado: 'pendiente' },
    ]);
  });
});
