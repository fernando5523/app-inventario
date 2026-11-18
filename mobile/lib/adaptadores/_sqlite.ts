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
      // UN ENVÍO A MEDIAS DE LA VEZ ANTERIOR SE VUELVE A INTENTAR.
      //
      // La cola marca un item `enviando` antes de mandarlo y lo resuelve al
      // volver la respuesta. Si la app se cierra en el medio -- Android la
      // mata, se actualiza, se acaba la batería --, el item queda `enviando`
      // para siempre: la pasada de la cola los saltea (para no mandar dos
      // veces lo que está en vuelo), así que nunca se reintenta, la banda
      // dice "Subiendo 1 conteo" sin fin, y el `finalizar` de esa hoja no
      // sale porque espera a ese conteo. Visto el 2026-11-18 en un teléfono
      // real, después de reinstalar la app.
      //
      // Acá es el único lugar seguro para soltarlos: la base se abre una vez
      // por arranque, antes de cualquier pasada de la cola, así que en este
      // momento no hay NADA en vuelo y todo `enviando` es de un proceso que
      // ya no existe. Mandarlo de nuevo no duplica: el conteo es un PUT por
      // producto y finalizar es idempotente en el servidor.
      await db.runAsync("UPDATE cola_sync SET estado = 'pendiente' WHERE estado = 'enviando'");
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
