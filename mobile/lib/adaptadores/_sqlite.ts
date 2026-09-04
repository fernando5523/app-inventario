/**
 * Base SQLite local — apertura y conexión con el motor real. La usa
 * hojas-sqlite.ts (la única, por ahora: es la única pantalla con datos
 * que no pueden vivir SOLO en memoria — ver la tarea de persistencia
 * offline).
 *
 * El esquema en sí (las migraciones) vive en sqlite-esquema.ts, aparte,
 * a propósito: ese archivo no importa `expo-sqlite` y por eso SÍ se
 * puede cargar bajo vitest — hojas-sqlite.test.ts corre el MISMO SQL de
 * acá contra `node:sqlite` (el motor real de Node) para probar la
 * persistencia de verdad, sin dispositivo.
 *
 * OJO: este archivo puntual (y todo lo que lo importe) NO se puede
 * cargar bajo vitest — `expo-sqlite` arrastra react-native, que usa
 * sintaxis Flow que el parser de vitest no entiende (verificado: un
 * `import('expo-sqlite')` suelto en un test ya rompe con "Flow is not
 * supported").
 */

import * as SQLite from 'expo-sqlite';
import { migrarSqlite } from './sqlite-esquema';

const NOMBRE_BASE = 'inventario.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Handle único de la base — memoizado (no una apertura por llamada) para
 * que dos escrituras concurrentes usen la MISMA conexión y no se pisen.
 * WAL: permite lecturas mientras hay una escritura en curso, que es
 * exactamente el patrón de esta pantalla (leer avance mientras se guarda
 * el conteo siguiente).
 */
export function obtenerDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(NOMBRE_BASE).then(async (db) => {
      await db.execAsync('PRAGMA journal_mode = WAL;');
      await migrarSqlite(db);
      return db;
    });
  }
  return dbPromise;
}

/** Para tests que sí corren contra un dispositivo/simulador real — no la usa vitest. */
export async function cerrarDbParaTests(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  await db.closeAsync();
  dbPromise = null;
}
