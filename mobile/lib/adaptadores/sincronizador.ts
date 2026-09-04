/**
 * El disparador que faltaba (ver hojas-sincronizacion.test.ts):
 * `procesarColaDeSincronizacion` (hojas-sqlite.ts) funcionaba —se probó
 * de punta a punta contra SQLite y HTTP reales— pero nadie la llamaba con
 * la red real. Hoy, sin este archivo, un conteo guardado local se queda
 * en el teléfono para siempre, aunque vuelva el WiFi.
 *
 * Implementa el puerto `Sincronizador` (puertos/repositorios.ts), que ya
 * estaba diseñado desde el primer commit del proyecto (`EstadoCola` con
 * `pendientes`/`ultimaSync`/`error`) esperando este adaptador.
 *
 * CUÁNDO DISPARA (ninguno es un loop constante -- son teléfonos de gama
 * baja contando una jornada entera, la batería tiene que durar):
 *   1. Al recuperar conectividad (expo-network, SOLO en la transición a
 *      conectado, no en cada evento de red).
 *   2. Al finalizar una hoja -- lo dispara app/conteo/contar.tsx después
 *      de `repositorioHojas.finalizar()`: es cuando el dato importa más,
 *      la hoja se congela y tiene que salir del teléfono.
 *   3. Manual, desde la banda de sincronización (`BandaSync.onSincronizar`).
 *   4. Al volver la app a primer plano (`AppState`), por si estuvo
 *      minimizada mientras volvía la señal.
 *
 * NUNCA SE SOLAPAN DOS PASADAS: `sincronizar()` devuelve la MISMA promesa
 * si ya hay una corriendo, en vez de arrancar una segunda -- dos pasadas
 * en paralelo podrían marcar `estado = 'enviando'` sobre el mismo item
 * dos veces y mandarlo dos veces por red.
 */

import { AppState, type AppStateStatus } from 'react-native';
import * as Network from 'expo-network';

import type { EstadoCola, Sincronizador } from '../puertos/repositorios';
import { esFallaDeRed } from './_http';
import { hojasApi } from './hojas-api';
import { estadoDeLaCola, procesarColaDeSincronizacion, type EnviarItemCola } from './hojas-sqlite';

// ---------------------------------------------------------------------------
// El envío: traduce lo que devuelve `hojasApi` (resuelve o tira `ErrorApi`)
// al contrato `ResultadoEnvio` que espera `procesarColaDeSincronizacion`.
// ---------------------------------------------------------------------------

export const enviarPorRed: EnviarItemCola = async (item, hoja) => {
  try {
    if (item.tipo === 'conteo') {
      const conteo = hoja.conteos.find((c) => c.productoId === item.productoId);
      // No debería pasar (el item de cola nace junto con el conteo), pero
      // si el conteo ya no está, no hay nada que mandar -- se descarta
      // como rechazado en vez de reintentar algo que no existe.
      if (!conteo) return { ok: false, motivo: 'rechazado' };
      await hojasApi.guardarConteo(item.hojaId, conteo);
    } else {
      await hojasApi.finalizar(item.hojaId);
    }
    return { ok: true };
  } catch (error) {
    // `sin-red`/`timeout` (esFallaDeRed) -> reintentable, se reintenta
    // solo en el próximo disparo. Cualquier otra cosa (401, 403, 404,
    // 409 "hoja ya finalizada por otro", 500...) -> `rechazado`: queda
    // visible en error, nunca en un reintento infinito silencioso --
    // mismo criterio ya verificado en hojas-sincronizacion.test.ts.
    return { ok: false, motivo: esFallaDeRed(error) ? 'sin-red' : 'rechazado' };
  }
};

// ---------------------------------------------------------------------------
// Estado observable + el lock contra solapamiento.
// ---------------------------------------------------------------------------

let estadoActual: EstadoCola = { pendientes: 0, ultimaSync: null, error: null };
const escuchas = new Set<(estado: EstadoCola) => void>();

function notificar(): void {
  for (const escuchar of escuchas) escuchar(estadoActual);
}

async function actualizarEstadoDesdeLaCola(huboExito: boolean): Promise<void> {
  const { pendientes, enError } = await estadoDeLaCola();
  estadoActual = {
    pendientes,
    // `ultimaSync` es CUÁNDO CORRIÓ una pasada sin tirar, no "cuándo se
    // vació la cola entera" -- si hay items en error, igual hubo una
    // pasada real recién. Mentir acá ("nunca sincronizó") sería tan malo
    // como decir "sincronizado" con la cola llena.
    ultimaSync: huboExito ? new Date().toISOString() : estadoActual.ultimaSync,
    error:
      enError > 0
        ? `${enError} ${enError === 1 ? 'ítem no se pudo sincronizar' : 'ítems no se pudieron sincronizar'} — revisá la conexión o pedí ayuda.`
        : null,
  };
  notificar();
}

let sincronizacionEnCurso: Promise<void> | null = null;

/**
 * Vacía la cola una vez. `procesarColaDeSincronizacion` ya no deja
 * escapar nada (cada item que falla queda en `error`, nunca una
 * excepción) -- el catch de acá es un cinturón extra: un disparador de
 * fondo (red, primer plano) no puede tirar abajo a quien lo escucha.
 */
async function ejecutarSincronizacion(): Promise<void> {
  try {
    await procesarColaDeSincronizacion(enviarPorRed);
    await actualizarEstadoDesdeLaCola(true);
  } catch {
    await actualizarEstadoDesdeLaCola(false).catch(() => undefined);
  }
}

function sincronizar(): Promise<void> {
  // El lock: si ya hay una pasada corriendo, ESTA llamada se cuelga de
  // la misma promesa en vez de arrancar una segunda. Cubre los 4
  // disparadores pisándose entre sí (ej. vuelve el WiFi Y la app pasa a
  // primer plano casi al mismo tiempo).
  if (!sincronizacionEnCurso) {
    sincronizacionEnCurso = ejecutarSincronizacion().finally(() => {
      sincronizacionEnCurso = null;
    });
  }
  return sincronizacionEnCurso;
}

export const sincronizadorReal: Sincronizador = {
  estado: () => estadoActual,
  suscribir(escuchar) {
    escuchas.add(escuchar);
    return () => {
      escuchas.delete(escuchar);
    };
  },
  sincronizar,
};

// ---------------------------------------------------------------------------
// Disparadores automáticos (red + primer plano).
// ---------------------------------------------------------------------------

export function estaConectado(estado: Pick<Network.NetworkState, 'isConnected' | 'isInternetReachable'>): boolean {
  return estado.isConnected === true && estado.isInternetReachable !== false;
}

/**
 * Arranca los disparadores automáticos. Se llama UNA sola vez, desde
 * app/_layout.tsx -- nunca por pantalla: si cada pantalla se suscribiera
 * a su propio listener de red, se registrarían N veces el mismo trabajo
 * (inofensivo por el lock de arriba, pero un desperdicio de batería que
 * no hace falta).
 *
 * Devuelve la función de limpieza para el `useEffect` que la invoca.
 */
export function iniciarSincronizador(): () => void {
  let ultimoConectado = true;

  Network.getNetworkStateAsync()
    .then((estado) => {
      ultimoConectado = estaConectado(estado);
    })
    .catch(() => undefined); // sin lectura inicial, se corrige solo con el primer evento real.

  const suscripcionRed = Network.addNetworkStateListener((estado) => {
    const conectadoAhora = estaConectado(estado);
    // Solo en la TRANSICIÓN a conectado -- pasar de WiFi a datos móviles
    // sin perder conexión no tiene que disparar nada de más.
    if (conectadoAhora && !ultimoConectado) sincronizar();
    ultimoConectado = conectadoAhora;
  });

  function alCambiarAppState(siguiente: AppStateStatus): void {
    if (siguiente === 'active') sincronizar();
  }
  const suscripcionAppState = AppState.addEventListener('change', alCambiarAppState);

  // Por si quedó algo pendiente de la sesión anterior de la app.
  sincronizar();

  return () => {
    suscripcionRed.remove();
    suscripcionAppState.remove();
  };
}
