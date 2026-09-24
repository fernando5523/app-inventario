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
 *   GET  /api/sesion/administradores                       (solo activos, sin sucursal)
 *   POST /api/sesion/ingresar { colaboradorId, pin }
 *   POST /api/sesion/cambiar-pin { pinActual, pinNuevo }   (CON sesión — no lleva colaboradorId)
 *
 * Las 3 primeras rutas coincidían con lo que ya tenía. Rate limit en
 * `ingresar` y en `cambiar-pin` (mismo limitador — sesion.routes.ts): 8
 * intentos / 15 min por colaboradorId → 429 → `demasiados-intentos`.
 * Un 401 acá puede ser PIN incorrecto O cuenta deshabilitada; el mensaje
 * exacto lo pone el backend y este cliente lo respeta.
 *
 * `cambiar-pin` responde 204 y CIERRA TODAS las sesiones de esa persona,
 * la que llama incluida (sesion.service.ts#cambiarPinPropio) — por eso acá
 * también se borra la sesión local apenas el backend confirma el cambio:
 * el token que quedó en SQLite ya no sirve, y dejarlo sería mostrar una
 * sesión "activa" que el próximo pedido a cualquier otro endpoint
 * rechazaría con `sesion-vencida`.
 *
 * `sucursal` viene `null` cuando el rol es `administrador` (README §Sesión):
 * un administrador es del sistema, no de una tienda. `Sesion.sucursal` en
 * lib/dominio/tipos.ts ya está declarado `Sucursal | null`, así que el null
 * pasa derecho y tipa bien — no hace falta traducir nada acá.
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

import type { Colaborador, Sesion, Sucursal } from '../dominio/tipos';
import type { RepositorioSesion } from '../puertos/repositorios';
import { pedir, pedirSinCuerpo, recordarToken, registrarLectorDeToken } from './_http';
// DONDE se guarda la sesion entre arranques depende de la plataforma: SQLite
// en el telefono, localStorage en el navegador. Metro elige el archivo; este
// adaptador no se entera. Ver `sesion-local.web.ts` para el bug que lo obligo.
import { borrarSesionLocal, guardarSesionLocal, leerSesionLocal } from './sesion-local';

const RUTA = '/api/sesion';

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

export const sesionApi: RepositorioSesion = {
  async sucursales() {
    return pedir<Sucursal[]>(`${RUTA}/sucursales`, { sinSesion: true });
  },

  async colaboradores(sucursalId) {
    return pedir<Colaborador[]>(`${RUTA}/sucursales/${sucursalId}/colaboradores`, { sinSesion: true });
  },

  async administradores() {
    return pedir<Colaborador[]>(`${RUTA}/administradores`, { sinSesion: true });
  },

  async ingresar(colaboradorId, pin) {
    const sesion = await pedir<Sesion>(`${RUTA}/ingresar`, {
      metodo: 'POST',
      cuerpo: { colaboradorId, pin },
      sinSesion: true,
    });
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

  async cambiarPin(pinActual, pinNuevo) {
    await pedirSinCuerpo(`${RUTA}/cambiar-pin`, { metodo: 'POST', cuerpo: { pinActual, pinNuevo } });
    // El backend ya cerró esta sesión (y todas las demás) al aplicar el
    // cambio — borrar acá es reflejar del lado del teléfono lo que ya es
    // cierto del lado del servidor, no una decisión aparte.
    await borrarSesionLocal();
    recordarToken(null);
  },
};
