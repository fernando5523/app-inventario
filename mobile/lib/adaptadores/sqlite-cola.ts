/**
 * Lógica PURA de la cola de sincronización — nada de SQLite, nada de red,
 * nada de React Native. Se puede testear en milisegundos, a diferencia
 * de _sqlite.ts/hojas-sqlite.ts (ver el comentario de _sqlite.ts: ese
 * lado no se puede ni importar bajo vitest).
 *
 * hojas-sqlite.ts es la única que la usa: lee filas de la tabla
 * `cola_sync`, las convierte a `ItemCola`, llama a estas funciones para
 * decidir QUÉ hacer, y recién ahí vuelve a escribir en la base.
 */

import type { EstadoSync } from '../dominio/tipos';
import type { ClaseErrorApi } from './_http';

export type TipoItemCola = 'conteo' | 'finalizar';

/**
 * `rechazado` es DISTINTO de `error`, y la diferencia es la que el cliente
 * reportó el 2026-09-07:
 *
 *   - `pendiente` / `error`: el servidor podría aceptarlo en otro momento
 *     (no había red, dio 500, la hoja estaba trabada un instante). Se
 *     reintenta solo en la próxima pasada. Es TRANSITORIO.
 *   - `rechazado`: el servidor dijo que NO y va a decir que no siempre. Un
 *     403 "esta hoja no es tuya" no cambia porque insistas: reintentarlo mil
 *     veces gasta batería y, peor, la banda sigue diciendo "1 ítem sin
 *     sincronizar" como si fuera cuestión de esperar. NO ES CUESTIÓN DE
 *     ESPERAR: hace falta que alguien haga algo.
 *
 * Sin este estado, los dos casos se veían iguales -- el mismo amarillo de
 * "ya va a subir" para algo que no iba a subir nunca.
 */
export type EstadoItemCola = 'pendiente' | 'enviando' | 'error' | 'rechazado';

export interface ItemCola {
  id: number;
  hojaId: number;
  tipo: TipoItemCola;
  /** 0 = no aplica — los items de tipo 'finalizar' son de la hoja entera, no de un producto. */
  productoId: number;
  creadoEn: string;
  intentos: number;
  estado: EstadoItemCola;
  /**
   * El motivo que dio el SERVIDOR para un rechazo real (`motivo:
   * 'rechazado'`) — nunca para un `sin-red`, que no tiene "razón del
   * servidor" que guardar. `undefined`/`null` = sin rechazo todavía, o
   * rechazo sin motivo (queda "Rechazado por el servidor." al mostrarlo,
   * ver sincronizador.ts). Opcional para no obligar a tocar cada literal
   * de `ItemCola` que ya existía antes de este campo.
   */
  razon?: string | null;
}

/**
 * Clave de deduplicación: un conteo nuevo del MISMO producto en la MISMA
 * hoja reemplaza al que ya estaba pendiente de mandar — nunca se apilan
 * dos envíos para lo mismo. `cola_sync` tiene un UNIQUE sobre esto mismo
 * (hoja_id, tipo, producto_id) — esta función documenta esa clave para
 * quien arme el UPSERT, no la reemplaza.
 */
export function claveDedup(item: Pick<ItemCola, 'hojaId' | 'tipo' | 'productoId'>): string {
  return `${item.hojaId}:${item.tipo}:${item.productoId}`;
}

/**
 * FIFO por fecha de creación (con el id como desempate) — se sincroniza
 * en el mismo orden en que el operario contó. Mandar fuera de orden
 * podría hacer que un conteo viejo pise a uno nuevo si dos llegan cerca
 * en el tiempo.
 */
export function ordenarCola(items: ItemCola[]): ItemCola[] {
  return [...items].sort((a, b) => {
    if (a.creadoEn !== b.creadoEn) return a.creadoEn < b.creadoEn ? -1 : 1;
    return a.id - b.id;
  });
}

/**
 * Estado de sincronización que le corresponde a una hoja, DERIVADO de lo
 * que queda pendiente para ella en la cola — nunca un campo aparte que
 * se pueda desincronizar de la cola real. `error` gana sobre
 * `sincronizando` (si algo falló, no se puede decir que "va bien" porque
 * otro item de la misma hoja esté en curso).
 *
 * OJO: un item que falló por `sin-red` (ver `aplicarResultadoEnvio`)
 * queda en `pendiente`, NO en `error` — así que estar sin conexión da
 * `local`, nunca `error`. `error` significa de verdad "esto no se va a
 * arreglar solo insistiendo".
 */
export function estadoSyncDeHoja(itemsDeLaHoja: ItemCola[]): EstadoSync {
  if (itemsDeLaHoja.length === 0) return 'sincronizado';
  // `rechazado` cuenta como `error` para la HOJA: los dos significan "el
  // servidor no tiene esto". La diferencia entre ambos (si conviene
  // reintentar o no) le importa a la cola y a la banda, no al estado de la
  // hoja, que solo distingue "al día" de "no al día".
  if (itemsDeLaHoja.some((i) => i.estado === 'error' || i.estado === 'rechazado')) return 'error';
  if (itemsDeLaHoja.some((i) => i.estado === 'enviando')) return 'sincronizando';
  return 'local';
}

export type ResultadoEnvio =
  | { ok: true }
  | {
      ok: false;
      motivo: 'sin-red' | 'rechazado';
      /** El mensaje que dio el servidor, si `motivo` es 'rechazado'. Ver `ItemCola.razon`. */
      mensaje?: string | null;
      /**
       * La clase del error (`_http.ts#ClaseErrorApi`), cuando `motivo` es
       * 'rechazado' y vino de un `ErrorApi` real. Solo `'no-encontrado'`
       * cambia algo hoy: ver `aplicarResultadoEnvio`.
       */
      clase?: ClaseErrorApi;
    };

/** Lo que se muestra cuando el servidor rechazó algo sin mandar un mensaje aprovechable. Nunca se inventa un motivo más específico que esto. */
export const RECHAZO_SIN_MOTIVO = 'Rechazado por el servidor.';

/**
 * El texto de un conteo rechazado porque la hoja no es de quien contó (403).
 *
 * Dice TRES cosas, y las tres hacen falta:
 *   1. Que no se va a guardar -- no "todavía no se guardó".
 *   2. CUÁL hoja, por su número, que es como la persona la conoce.
 *   3. QUÉ HACER. Sin esto, quien lee se queda mirando una banda roja sin
 *      saber si perdió el trabajo, si tiene que contar de nuevo, o a quién
 *      preguntarle.
 *
 * El mensaje del servidor ("Solo quien tiene la hoja asignada puede contar en
 * ella.") es correcto pero no accionable: explica la regla, no el paso
 * siguiente. Este lo reemplaza a propósito.
 */
export function mensajeRechazoPorPermiso(numeroHoja: string): string {
  return `Este conteo no se puede guardar: la hoja #${numeroHoja} no está asignada a vos. Pedile al coordinador que te la asigne.`;
}

/**
 * ¿Este rechazo es DEFINITIVO? (o sea: reintentarlo no puede cambiar nada)
 *
 * Solo `sin-permiso` por ahora. El resto de los rechazos se deja reintentable
 * a propósito, aunque hoy fallen: un 409 "hoja finalizada" se destraba si el
 * Coordinador reabre la ronda, un 500 se destraba solo, un 401 se destraba
 * volviendo a entrar. Un 403 de asignación NO se destraba desde el teléfono
 * -- lo tiene que resolver otra persona, en otra pantalla.
 *
 * `no-encontrado` no está acá porque no llega a este punto: se descarta antes
 * (ver `aplicarResultadoEnvio`), que es una salida distinta de "rechazado".
 */
export function esRechazoDefinitivo(clase: ClaseErrorApi | undefined): boolean {
  return clase === 'sin-permiso';
}

/**
 * Transición PURA de un item tras intentar enviarlo — decide qué hacer,
 * no lo hace. `null` = se sincronizó, sale de la cola. Un objeto = se
 * queda, con el estado que le corresponde.
 *
 * HALLAZGO DE min-4 (2026-09-05): sin red, tras force-stop y reabrir con
 * conteos en cola, la banda decía "N ítems no se pudieron sincronizar —
 * revisá la conexión o pedí ayuda" — el mensaje de un RECHAZO, para
 * alguien que está sin red mirando sus propios conteos ya guardados. La
 * causa: `sin-red` y `rechazado` dejaban el mismo `estado: 'error'`, así
 * que `estadoDeLaCola`/`sincronizacionDeHojas` (BandaSync.tsx) no podían
 * distinguirlos — `cola.error` ganaba SIEMPRE sobre `cola.sinRed`.
 *
 * LA REGLA, desde acá: un fallo de RED nunca marca `error` — el pedido ni
 * siquiera SALIÓ, no hay nada que el servidor haya "rechazado". Queda
 * `pendiente`, igual que antes de intentarlo: se reintenta solo en el
 * próximo disparo (sincronizador.ts), sin que nadie tenga que hacer nada,
 * y la banda puede mostrar "Sin conexión — seguí contando" en vez de
 * mandar a buscar ayuda para algo que se arregla solo con la WiFi.
 *
 * `error` queda RESERVADO para un rechazo real del servidor (4xx/5xx que
 * sí respondió) — eso es lo que de verdad "no se va a arreglar solo
 * insistiendo", y ahí SÍ se guarda `razon` (el motivo del servidor, o el
 * fallback fijo si no mandó ninguno).
 */
export function aplicarResultadoEnvio(item: ItemCola, resultado: ResultadoEnvio): ItemCola | null {
  if (resultado.ok) return null;
  if (resultado.motivo === 'sin-red') {
    return { ...item, estado: 'pendiente', intentos: item.intentos + 1, razon: null };
  }
  /**
   * 404 "no-encontrado" -- la hoja (o el producto) a la que apunta este
   * item ya no existe en el servidor. Es IRRECUPERABLE: a diferencia de
   * cualquier otro rechazo, reintentar para siempre nunca lo va a
   * arreglar, porque no hay nada del otro lado con qué reconciliarlo. Se
   * descarta como si se hubiera sincronizado (null = sale de la cola) —
   * NUNCA para un 409 "hoja finalizada" u otro rechazo real, que sí
   * conviene dejar visible para que alguien lo resuelva.
   *
   * HALLAZGO (2026-09-07): `limpiar-datos-dev.ts` borró un inventario que
   * ya tenía un conteo encolado sin sincronizar. Ese item quedaba en
   * `error` para siempre (la hoja nunca iba a volver a existir) y
   * `estadoDeLaCola()` cuenta TODA la cola, no una hoja sola -- ese único
   * item podrido contaminaba la banda de sincronización de CUALQUIER otra
   * hoja, sana, con un mensaje ajeno e irresoluble.
   */
  if (resultado.clase === 'no-encontrado') return null;
  /**
   * 403 "sin-permiso" -- la hoja no está asignada a quien contó.
   *
   * NO se descarta como el 404, y la diferencia es toda la decisión: un 404
   * no tiene destinatario (la hoja no existe, no hay nada que contarle a
   * nadie), pero un 403 significa que UNA PERSONA contó en una hoja que no le
   * tocaba, y ese trabajo se pierde si nadie se entera. Se conserva, con el
   * motivo real, y se marca `rechazado` para que la banda deje de prometer
   * que va a subir y la cola deje de reintentarlo.
   *
   * CASO REAL (cliente, 2026-09-07): reasignó las hojas al pasar a la ronda
   * 3 con el teléfono de un contador todavía abierto en una hoja de la ronda
   * anterior. Él siguió contando; cada conteo se encolaba y el servidor los
   * rechazaba. La banda decía "1 ítem sin sincronizar · última sync 12:37",
   * que se lee como "ya va a subir". Nunca iba a subir.
   */
  if (esRechazoDefinitivo(resultado.clase)) {
    return {
      ...item,
      estado: 'rechazado',
      intentos: item.intentos + 1,
      razon: resultado.mensaje?.trim() || RECHAZO_SIN_MOTIVO,
    };
  }
  return {
    ...item,
    estado: 'error',
    intentos: item.intentos + 1,
    razon: resultado.mensaje?.trim() || RECHAZO_SIN_MOTIVO,
  };
}
