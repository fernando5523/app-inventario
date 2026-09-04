/**
 * El esquema SQLite — SQL puro, sin importar `expo-sqlite`. Lo usan
 * _sqlite.ts (con el motor nativo de verdad) Y hojas-sqlite.test.ts (con
 * `node:sqlite`, el motor real de Node, para probar la persistencia sin
 * dispositivo) — el MISMO esquema en los dos lados, nunca una copia que
 * se pueda desincronizar de lo que corre en el teléfono.
 *
 * `DbMigrable` es la única forma que este archivo necesita de una base:
 * cualquier objeto con esos dos métodos sirve, sea `expo-sqlite` real o
 * un stand-in de test — por eso este archivo no importa nada de RN y se
 * puede cargar bajo vitest sin problema.
 */

export interface DbMigrable {
  getFirstAsync<T>(source: string): Promise<T | null>;
  execAsync(source: string): Promise<void>;
}

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
export const MIGRACIONES_SQLITE: string[] = [
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
  /**
   * v2 — decisión del cliente: un producto puede tener MÁS de un empaque
   * (Caja Y Pack del mismo producto). `conteos.empaques` deja de ser un
   * número (cuántos del ÚNICO empaque) y pasa a ser `lineas`, JSON con
   * una entrada por cada empaque cargado (ver
   * lib/dominio/tipos.ts#LineaEmpaque). `cola_sync` NO cambia: nunca
   * guardó el valor del conteo, solo qué falta mandar — el valor se
   * relee siempre de `conteos` al momento de enviar.
   *
   * Los conteos v1 ya guardados (`empaques` INTEGER) no dicen A CUÁL
   * empaque correspondía esa cantidad — v1 solo conocía uno por
   * producto, así que nunca hizo falta guardar el nombre. Esta
   * migración SQL no inventa uno: copia la cantidad tal cual bajo un
   * empaque marcador `__LEGADO__` — hojas-sqlite.ts#repararLineaLegado
   * lo resuelve al nombre real la primera vez que relee esa fila (ahí sí
   * hay acceso al catálogo del producto) y lo deja corregido en la base,
   * no en cada lectura.
   */
  `
  ALTER TABLE conteos RENAME TO conteos_v1_legado;

  CREATE TABLE conteos (
    hoja_id INTEGER NOT NULL,
    producto_id INTEGER NOT NULL,
    lineas TEXT NOT NULL,
    sueltas INTEGER NOT NULL,
    confirmado_por_escaner INTEGER NOT NULL,
    contado_en TEXT NOT NULL,
    PRIMARY KEY (hoja_id, producto_id)
  );

  INSERT INTO conteos (hoja_id, producto_id, lineas, sueltas, confirmado_por_escaner, contado_en)
    SELECT
      hoja_id,
      producto_id,
      CASE WHEN empaques > 0
        THEN '[{"empaqueNombre":"__LEGADO__","cantidad":' || empaques || '}]'
        ELSE '[]'
      END,
      sueltas,
      confirmado_por_escaner,
      contado_en
    FROM conteos_v1_legado;

  DROP TABLE conteos_v1_legado;
  `,
];

export async function migrarSqlite(db: DbMigrable): Promise<void> {
  const fila = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = fila?.user_version ?? 0;
  for (let i = version; i < MIGRACIONES_SQLITE.length; i++) {
    await db.execAsync(MIGRACIONES_SQLITE[i]);
    await db.execAsync(`PRAGMA user_version = ${i + 1}`);
  }
}
