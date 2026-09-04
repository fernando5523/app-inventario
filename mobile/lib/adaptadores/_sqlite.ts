/**
 * Base SQLite local — apertura y migraciones. La usa hojas-sqlite.ts (la
 * única, por ahora: es la única pantalla con datos que no pueden vivir
 * SOLO en memoria — ver la tarea de persistencia offline).
 *
 * OJO al testear: este archivo (y todo lo que lo importe) NO se puede
 * cargar bajo vitest — `expo-sqlite` arrastra react-native, que usa
 * sintaxis Flow que el parser de vitest no entiende (verificado: un
 * `import('expo-sqlite')` suelto en un test ya rompe con "Flow is not
 * supported"). Por eso la lógica de la cola de sincronización vive
 * APARTE, en sqlite-cola.ts, que no importa nada de acá — ese sí se
 * testea.
 */

import * as SQLite from 'expo-sqlite';

const NOMBRE_BASE = 'inventario.db';

/**
 * Migraciones en orden — cada una es el SQL completo de un paso. Nunca se
 * edita una ya escrita (una vez que salió a un dispositivo, ese `CREATE
 * TABLE` ya corrió ahí): para cambiar el esquema se agrega una nueva.
 *
 * v1 — tres tablas:
 *   - `hoja_estado_local`: overlay LOCAL de estado/sync por hoja. La
 *     estructura de la hoja (zona, góndola, productos, asignados) sigue
 *     viniendo de donde ya vivía (_compartido.ts hoy, el backend
 *     mañana) — acá solo se guarda lo que el dispositivo mutó offline.
 *   - `conteos`: PK (hoja_id, producto_id) — un producto tiene UN
 *     conteo vigente, nunca una lista que crece. Recontar el mismo
 *     producto pisa la fila anterior (`INSERT OR REPLACE`), no agrega
 *     una nueva: así no se duplica ni local ni en lo que se sincroniza.
 *   - `cola_sync`: qué falta mandar. UNIQUE (hoja_id, tipo, producto_id)
 *     por la misma razón — un conteo nuevo del mismo producto reemplaza
 *     al pendiente en vez de apilarse. `producto_id = 0` para los items
 *     de tipo 'finalizar' (son de la hoja entera, no de un producto).
 */
const MIGRACIONES: string[] = [
  `
  CREATE TABLE IF NOT EXISTS hoja_estado_local (
    hoja_id INTEGER PRIMARY KEY NOT NULL,
    estado TEXT NOT NULL,
    sync TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conteos (
    hoja_id INTEGER NOT NULL,
    producto_id INTEGER NOT NULL,
    empaques INTEGER NOT NULL,
    sueltas INTEGER NOT NULL,
    confirmado_por_escaner INTEGER NOT NULL,
    contado_en TEXT NOT NULL,
    PRIMARY KEY (hoja_id, producto_id)
  );

  CREATE TABLE IF NOT EXISTS cola_sync (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hoja_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    producto_id INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT NOT NULL,
    intentos INTEGER NOT NULL DEFAULT 0,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    UNIQUE (hoja_id, tipo, producto_id)
  );
  `,
];

async function migrar(db: SQLite.SQLiteDatabase): Promise<void> {
  const fila = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = fila?.user_version ?? 0;
  for (let i = version; i < MIGRACIONES.length; i++) {
    await db.execAsync(MIGRACIONES[i]);
    await db.execAsync(`PRAGMA user_version = ${i + 1}`);
  }
}

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
      await migrar(db);
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
