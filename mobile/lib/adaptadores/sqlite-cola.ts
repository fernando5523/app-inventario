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

export type TipoItemCola = 'conteo' | 'finalizar';
export type EstadoItemCola = 'pendiente' | 'enviando' | 'error';

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
  if (itemsDeLaHoja.some((i) => i.estado === 'error')) return 'error';
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
    };

/** Lo que se muestra cuando el servidor rechazó algo sin mandar un mensaje aprovechable. Nunca se inventa un motivo más específico que esto. */
export const RECHAZO_SIN_MOTIVO = 'Rechazado por el servidor.';

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
  return {
    ...item,
    estado: 'error',
    intentos: item.intentos + 1,
    razon: resultado.mensaje?.trim() || RECHAZO_SIN_MOTIVO,
  };
}
