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
 */
export function estadoSyncDeHoja(itemsDeLaHoja: ItemCola[]): EstadoSync {
  if (itemsDeLaHoja.length === 0) return 'sincronizado';
  if (itemsDeLaHoja.some((i) => i.estado === 'error')) return 'error';
  if (itemsDeLaHoja.some((i) => i.estado === 'enviando')) return 'sincronizando';
  return 'local';
}

export type ResultadoEnvio = { ok: true } | { ok: false; motivo: 'sin-red' | 'rechazado' };

/**
 * Transición PURA de un item tras intentar enviarlo — decide qué hacer,
 * no lo hace. `null` = se sincronizó, sale de la cola. Un objeto = se
 * queda, con el estado que le corresponde.
 *
 * Rechazado (el servidor dijo que no — ej. la hoja ya la finalizó otra
 * persona) y sin-red se tratan IGUAL acá: los dos dejan el item en
 * `error`, visible, nunca en un limbo silencioso ni en un reintento
 * infinito sin que nadie se entere. La pantalla es la que decide, con
 * `motivo`, qué mensaje mostrar — esta función solo dice "no se pudo,
 * quedate a la vista".
 */
export function aplicarResultadoEnvio(item: ItemCola, resultado: ResultadoEnvio): ItemCola | null {
  if (resultado.ok) return null;
  return { ...item, estado: 'error', intentos: item.intentos + 1 };
}
