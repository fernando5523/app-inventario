/**
 * Dónde queda guardada la sesión ENTRE ARRANQUES, en el navegador:
 * `localStorage`.
 *
 * ---------------------------------------------------------------------------
 * BUG REAL que obligó a separar esto (2026-09-24)
 * ---------------------------------------------------------------------------
 * La web usaba la misma persistencia que el teléfono y el login fallaba con
 *
 *   Error code 1: no such table: sesion_activa
 *
 * DESPUÉS de que el backend aceptara el PIN: se entraba y no se podía guardar
 * la sesión. `expo-sqlite` en web corre sobre WebAssembly y su base no
 * sobrevive de la forma en que el resto del código da por sentada.
 *
 * Y no hacía falta pelearse con eso: una sesión son doscientos bytes de JSON
 * que tienen que sobrevivir a un F5. Eso es `localStorage`, no una base de
 * datos.
 *
 * ---------------------------------------------------------------------------
 * MISMA FIRMA, MISMAS REGLAS
 * ---------------------------------------------------------------------------
 * Las tres funciones son las del archivo nativo, incluida la que importa: leer
 * una sesión VENCIDA la borra y devuelve `null`, en vez de dejar entrar con un
 * token que el backend va a rechazar en el primer pedido.
 *
 * `try/catch` en todo: en una ventana privada, o con las cookies de sitio
 * bloqueadas, `localStorage` no lee ni escribe -- tira. Ahí la sesión dura lo
 * que la pestaña, que es molesto pero funciona; reventar al arrancar, no.
 */
import type { Sesion } from '../dominio/tipos';

const CLAVE = 'inventario.sesion';

export async function guardarSesionLocal(sesion: Sesion): Promise<void> {
  try {
    globalThis.localStorage?.setItem(CLAVE, JSON.stringify(sesion));
  } catch {
    // Sin almacenamiento: la sesión vive en memoria hasta que se recargue.
  }
}

export async function leerSesionLocal(): Promise<Sesion | null> {
  let crudo: string | null = null;
  try {
    crudo = globalThis.localStorage?.getItem(CLAVE) ?? null;
  } catch {
    return null;
  }
  if (crudo === null) return null;

  try {
    const sesion = JSON.parse(crudo) as Sesion;
    if (new Date(sesion.expiraEn).getTime() < Date.now()) {
      await borrarSesionLocal();
      return null;
    }
    return sesion;
  } catch {
    // Guardado por una versión vieja, o a medias: se descarta en vez de
    // arrastrar un objeto que no es una sesión.
    await borrarSesionLocal();
    return null;
  }
}

export async function borrarSesionLocal(): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(CLAVE);
  } catch {
    // Ver `guardarSesionLocal`.
  }
}
