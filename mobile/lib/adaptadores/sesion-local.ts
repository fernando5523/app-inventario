/**
 * Dónde queda guardada la sesión ENTRE ARRANQUES, en el teléfono: SQLite.
 *
 * Salió de `sesion-api.ts` para que la web pueda tener la suya
 * (`sesion-local.web.ts`, con `localStorage`) sin que el adaptador de la API
 * se entere. Ver ese archivo para el bug real que lo obligó.
 *
 * `sesion_activa` tiene UNA sola fila -- `CHECK (id = 1)` --: no existe "las
 * sesiones", existe la que está abierta ahora.
 */
import * as SQLite from 'expo-sqlite';

import type { Sesion } from '../dominio/tipos';

const dbPromise = SQLite.openDatabaseAsync('sesion.db');

let tablaLista: Promise<void> | null = null;
function asegurarTabla(): Promise<void> {
  if (!tablaLista) {
    tablaLista = dbPromise.then(async (db) => {
      await db.execAsync(
        'CREATE TABLE IF NOT EXISTS sesion_activa (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);',
      );
    });
  }
  return tablaLista;
}

export async function guardarSesionLocal(sesion: Sesion): Promise<void> {
  await asegurarTabla();
  const db = await dbPromise;
  await db.runAsync(
    'INSERT INTO sesion_activa (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload;',
    [JSON.stringify(sesion)],
  );
}

export async function leerSesionLocal(): Promise<Sesion | null> {
  await asegurarTabla();
  const db = await dbPromise;
  const fila = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM sesion_activa WHERE id = 1;');
  if (!fila) return null;

  const sesion = JSON.parse(fila.payload) as Sesion;
  if (new Date(sesion.expiraEn).getTime() < Date.now()) {
    await borrarSesionLocal();
    return null;
  }
  return sesion;
}

export async function borrarSesionLocal(): Promise<void> {
  await asegurarTabla();
  const db = await dbPromise;
  await db.runAsync('DELETE FROM sesion_activa WHERE id = 1;');
}
