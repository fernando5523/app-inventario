/**
 * Adaptador HTTP de RepositorioSesion, contra backend/src/modules/sesion/
 * (Express + Prisma + argon2 + zod). Mismo puerto que sesion-memoria.ts — la
 * pantalla no cambia una línea al enchufar este archivo (ver
 * lib/contenedor.ts).
 *
 * CONTRATO — VERIFICADO contra backend/README.md §Sesión y contra
 * backend/src/modules/sesion/sesion.routes.ts:
 *   GET  /api/sesion/sucursales                            (solo activas)
 *   GET  /api/sesion/sucursales/:sucursalId/colaboradores  (solo activos)
 *   POST /api/sesion/ingresar { colaboradorId, pin }
 *
 * Las 3 rutas coincidían con lo que ya tenía. Rate limit en `ingresar`: 8
 * intentos / 15 min por colaboradorId → 429 → `demasiados-intentos`.
 * Un 401 acá puede ser PIN incorrecto O cuenta deshabilitada; el mensaje
 * exacto lo pone el backend y este cliente lo respeta.
 *
 * ⚠️ CHOQUE ABIERTO — `sucursal: null` para el Administrador.
 * El README (§Sesión) dice: "`sucursal` es `null` si `colaborador.rol ===
 * "administrador"`" — porque un administrador es del sistema, no de una
 * tienda. Pero `Sesion.sucursal` en lib/dominio/tipos.ts está declarado
 * `Sucursal`, NO `Sucursal | null`.
 *
 * O sea que hoy, cuando ingrese un administrador, este adaptador va a
 * devolver un objeto que MIENTE sobre su propio tipo, y la primera pantalla
 * que lea `sesion.sucursal.nombre` va a reventar con un error que no dice
 * nada de esto.
 *
 * No lo tapo con una sucursal inventada (sería el mismo error que meter
 * basura en la base) ni lo convierto en un throw (bloquearía el login del
 * administrador por completo). Lo dejo pasar y lo hago RUIDOSO — ver
 * `avisarSiFaltaSucursal`. La corrección de fondo es de lib/dominio/tipos.ts:
 * `sucursal: Sucursal | null`, y las pantallas contemplando el caso.
 *
 * Los tres son PÚBLICOS (el router no monta `requiereSesion`): son
 * justamente los que se necesitan ANTES de tener sesión. Por eso van con
 * `sinSesion: true` — no es un detalle cosmético, es lo que hace que un 401
 * en `ingresar` se lea como "PIN incorrecto" y no como "tu sesión venció"
 * (ver _http.ts#clasificarPorEstado).
 *
 * No hay endpoint de "quién soy" ni de logout todavía (el backend valida el
 * token por request, no expone una consulta de sesión activa) — por eso
 * `sesionActiva()` y `cerrar()` trabajan solo contra la copia local en
 * SQLite, que es la fuente de verdad del lado del teléfono.
 */

import * as SQLite from 'expo-sqlite';

import type { Colaborador, Sesion, Sucursal } from '../dominio/tipos';
import type { RepositorioSesion } from '../puertos/repositorios';
import { pedir, recordarToken, registrarLectorDeToken } from './_http';

const RUTA = '/api/sesion';

// ---------------------------------------------------------------------------
// Persistencia local de la sesión (expo-sqlite) — sobrevive a un reinicio.
// ---------------------------------------------------------------------------

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

async function guardarSesionLocal(sesion: Sesion): Promise<void> {
  await asegurarTabla();
  const db = await dbPromise;
  await db.runAsync(
    'INSERT INTO sesion_activa (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload;',
    [JSON.stringify(sesion)],
  );
}

async function leerSesionLocal(): Promise<Sesion | null> {
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

async function borrarSesionLocal(): Promise<void> {
  await asegurarTabla();
  const db = await dbPromise;
  await db.runAsync('DELETE FROM sesion_activa WHERE id = 1;');
}

// ---------------------------------------------------------------------------
// Token compartido con el resto de los adaptadores
// ---------------------------------------------------------------------------

/**
 * Arranque en frío: la app se abre de nuevo, la memoria está vacía pero la
 * sesión sigue viva en SQLite. Sin esto, el primer pedido de CUALQUIER otro
 * adaptador saldría sin `Authorization` y volvería 401 — mandando al login a
 * alguien que nunca cerró sesión.
 *
 * Se registra al importar el módulo (no dentro de un método) porque el otro
 * adaptador puede pedir antes de que una pantalla llame a `sesionActiva()`.
 */
registrarLectorDeToken(async () => (await leerSesionLocal())?.token ?? null);

// ---------------------------------------------------------------------------

/**
 * Convierte el choque de tipos de arriba en un aviso legible en vez de en un
 * `undefined is not an object` tres pantallas más adelante. No arregla nada
 * —no puede, el arreglo es del dominio— pero hace que quien pruebe el login
 * de administrador sepa en 5 segundos qué pasó, en vez de en media hora.
 */
function avisarSiFaltaSucursal(sesion: Sesion): void {
  if (sesion.sucursal == null) {
    console.warn(
      `[sesion-api] El backend devolvió sucursal: null para el rol "${sesion.colaborador?.rol}". ` +
        'Sesion.sucursal está declarado NO nulable en lib/dominio/tipos.ts: cualquier pantalla que ' +
        'lea sesion.sucursal.* va a fallar. Hay que cambiar el tipo a `Sucursal | null`.',
    );
  }
}

export const sesionApi: RepositorioSesion = {
  async sucursales() {
    return pedir<Sucursal[]>(`${RUTA}/sucursales`, { sinSesion: true });
  },

  async colaboradores(sucursalId) {
    return pedir<Colaborador[]>(`${RUTA}/sucursales/${sucursalId}/colaboradores`, { sinSesion: true });
  },

  async ingresar(colaboradorId, pin) {
    const sesion = await pedir<Sesion>(`${RUTA}/ingresar`, {
      metodo: 'POST',
      cuerpo: { colaboradorId, pin },
      sinSesion: true,
    });
    avisarSiFaltaSucursal(sesion);
    await guardarSesionLocal(sesion);
    recordarToken(sesion.token);
    return sesion;
  },

  async sesionActiva() {
    const sesion = await leerSesionLocal();
    // Reponer el token en memoria acá también (no solo en `ingresar`) cubre
    // el caso de la sesión que ya venía guardada de una corrida anterior.
    recordarToken(sesion?.token ?? null);
    return sesion;
  },

  async cerrar() {
    await borrarSesionLocal();
    recordarToken(null);
  },
};
