/**
 * Dónde queda guardada la sesión ENTRE ARRANQUES, en el teléfono: el almacén
 * seguro del sistema (`expo-secure-store`, que en Android cifra con una llave
 * del Keystore). La versión web tiene la suya (`sesion-local.web.ts`, con
 * `localStorage`), y el adaptador de la API no se entera de cuál usa.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ DEJÓ DE SER SQLITE
 * ---------------------------------------------------------------------------
 * Hasta el 2026-11-17 la sesión vivía en `sesion.db`, una base SQLite sin
 * cifrar, y la app permitía respaldos (`allowBackup=true`). Juntas, esas dos
 * cosas dejaban salir del teléfono el token, que vale 12 horas, dentro de un
 * respaldo. Ahora el token está cifrado y la app no se respalda
 * (`android.allowBackup: false` en app.config.ts). Lo marcó la revisión con la
 * skill de blindaje de apps.
 *
 * ---------------------------------------------------------------------------
 * LA MIGRACIÓN, Y POR QUÉ BORRA EL ARCHIVO ENTERO
 * ---------------------------------------------------------------------------
 * Un teléfono que se actualiza desde la versión anterior todavía tiene su
 * sesión en `sesion.db`. La primera lectura la pasa al almacén seguro y BORRA
 * EL ARCHIVO, no solo la fila: un `DELETE` de SQLite deja los bytes en páginas
 * libres, así que el token seguiría ahí, legible, para quien abra el archivo.
 *
 * Corre una sola vez por arranque. Si el almacén seguro ya tiene una sesión,
 * la vieja NO la pisa: la nueva es la que la persona acaba de abrir.
 */
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import type { Sesion } from '../dominio/tipos';

const CLAVE = 'sesion_activa';
const BASE_VIEJA = 'sesion.db';

let migracion: Promise<void> | null = null;

function migrarDesdeSqlite(): Promise<void> {
  if (!migracion) {
    migracion = (async () => {
      const db = await SQLite.openDatabaseAsync(BASE_VIEJA);
      try {
        const tabla = await db.getFirstAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sesion_activa';",
        );
        if (tabla) {
          const fila = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM sesion_activa WHERE id = 1;');
          if (fila && (await SecureStore.getItemAsync(CLAVE)) === null) {
            await SecureStore.setItemAsync(CLAVE, fila.payload);
          }
        }
      } finally {
        await db.closeAsync();
        await SQLite.deleteDatabaseAsync(BASE_VIEJA);
      }
    })().catch(() => {
      // Si la migración falla, la persona vuelve a ingresar con su PIN: es lo
      // peor que puede pasar, y no vale la pena dejar la app sin abrir por eso.
      // La próxima lectura lo vuelve a intentar.
      migracion = null;
    });
  }
  return migracion;
}

export async function guardarSesionLocal(sesion: Sesion): Promise<void> {
  await migrarDesdeSqlite();
  await SecureStore.setItemAsync(CLAVE, JSON.stringify(sesion));
}

export async function leerSesionLocal(): Promise<Sesion | null> {
  await migrarDesdeSqlite();
  const payload = await SecureStore.getItemAsync(CLAVE);
  if (payload === null) return null;

  const sesion = JSON.parse(payload) as Sesion;
  if (new Date(sesion.expiraEn).getTime() < Date.now()) {
    await borrarSesionLocal();
    return null;
  }
  return sesion;
}

export async function borrarSesionLocal(): Promise<void> {
  await migrarDesdeSqlite();
  await SecureStore.deleteItemAsync(CLAVE);
}
