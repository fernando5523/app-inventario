/**
 * Adaptador SQLite de RepositorioHojas — el que persiste de VERDAD.
 *
 * Por qué existe: los equipos van con la WiFi de la tienda y sin chip. Un
 * operario puede llevar 40 de 50 ítems contados y perderlos todos si la
 * app se cierra, Android la mata en segundo plano, se queda sin batería
 * o toca atrás de más — hojas-memoria.ts (todo en RAM) no sobrevive
 * ninguno de esos casos. Éste sí: escribe en disco PRIMERO, siempre.
 *
 * DISEÑO — qué vive dónde:
 *   - La ESTRUCTURA de una hoja (zona, góndola, tamaño, asignados,
 *     productos) sigue viniendo de _compartido.ts, igual que
 *     hojas-memoria.ts — no cambia sola una vez creada y no tiene la
 *     urgencia de sobrevivir un cierre (se puede volver a traer).
 *   - Lo que el operario hace con la mano — CONTEOS y el estado/sync de
 *     la hoja mientras cuenta — es lo irremplazable, y es lo único que
 *     esta base guarda. La primera vez que se toca una hoja, se copia su
 *     estado de arranque acá adentro (`asegurarSembrada`); de ahí en más
 *     esta base es la única fuente de verdad para esa hoja — nunca más
 *     se vuelve a leer su `estado`/`conteos` de _compartido.ts.
 *
 * DEDUPLICACIÓN: la tabla `conteos` tiene PK (hoja_id, producto_id) — un
 * producto tiene UN conteo vigente. `guardarConteo` hace `INSERT OR
 * REPLACE`: recontar el mismo producto (a mano o por un reintento de
 * sincronización) pisa la fila, nunca agrega una segunda. Mismo criterio
 * en `cola_sync` (ver sqlite-cola.ts).
 *
 * ATOMICIDAD: cada escritura que toca más de una tabla va en
 * `withTransactionAsync` — si la app se cierra a mitad de una escritura,
 * SQLite descarta la transacción entera al volver a abrir (no queda un
 * conteo guardado sin su fila de cola, por ejemplo).
 */

import { buscarHojaPorId, finalizarDominio, obtenerInventario, puedeEditar } from './_compartido';
import { obtenerDb } from './_sqlite';
import { aplicarResultadoEnvio, ordenarCola, estadoSyncDeHoja, type ItemCola, type ResultadoEnvio } from './sqlite-cola';
import { sesionMemoria } from './sesion-memoria';
import type { Conteo, EstadoHoja, EstadoSync, HojaConteo } from '../dominio/tipos';
import type { RepositorioHojas } from '../puertos/repositorios';

// ---------------------------------------------------------------------------
// Filas <-> tipos de dominio
// ---------------------------------------------------------------------------

interface FilaEstadoLocal {
  hoja_id: number;
  estado: string;
  sync: string;
}

interface FilaConteo {
  hoja_id: number;
  producto_id: number;
  empaques: number;
  sueltas: number;
  confirmado_por_escaner: number;
  contado_en: string;
}

interface FilaCola {
  id: number;
  hoja_id: number;
  tipo: string;
  producto_id: number;
  creado_en: string;
  intentos: number;
  estado: string;
}

function filaAConteo(f: FilaConteo): Conteo {
  return {
    productoId: f.producto_id,
    empaques: f.empaques,
    sueltas: f.sueltas,
    confirmadoPorEscaner: f.confirmado_por_escaner === 1,
    contadoEn: f.contado_en,
  };
}

function filaAItemCola(f: FilaCola): ItemCola {
  return {
    id: f.id,
    hojaId: f.hoja_id,
    tipo: f.tipo as ItemCola['tipo'],
    productoId: f.producto_id,
    creadoEn: f.creado_en,
    intentos: f.intentos,
    estado: f.estado as ItemCola['estado'],
  };
}

// ---------------------------------------------------------------------------
// Siembra por hoja (lazy: recién la primera vez que se toca esa hoja)
// ---------------------------------------------------------------------------

async function asegurarSembrada(hojaBase: HojaConteo): Promise<void> {
  const db = await obtenerDb();
  const existente = await db.getFirstAsync<FilaEstadoLocal>('SELECT hoja_id FROM hoja_estado_local WHERE hoja_id = ?', [hojaBase.id]);
  if (existente) return;

  await db.withTransactionAsync(async () => {
    await db.runAsync('INSERT INTO hoja_estado_local (hoja_id, estado, sync) VALUES (?, ?, ?)', [
      hojaBase.id,
      hojaBase.estado,
      hojaBase.sync,
    ]);
    for (const c of hojaBase.conteos) {
      await db.runAsync(
        'INSERT OR REPLACE INTO conteos (hoja_id, producto_id, empaques, sueltas, confirmado_por_escaner, contado_en) VALUES (?, ?, ?, ?, ?, ?)',
        [hojaBase.id, c.productoId, c.empaques, c.sueltas, c.confirmadoPorEscaner ? 1 : 0, c.contadoEn],
      );
    }
  });
}

/** La hoja BASE (de _compartido.ts) con el estado/sync/conteos que de verdad rigen — los de esta base, no los del seed. */
async function hojaConEstadoLocal(hojaBase: HojaConteo): Promise<HojaConteo> {
  await asegurarSembrada(hojaBase);
  const db = await obtenerDb();

  const [estadoLocal, filasConteo] = await Promise.all([
    db.getFirstAsync<FilaEstadoLocal>('SELECT * FROM hoja_estado_local WHERE hoja_id = ?', [hojaBase.id]),
    db.getAllAsync<FilaConteo>('SELECT * FROM conteos WHERE hoja_id = ?', [hojaBase.id]),
  ]);

  return {
    ...hojaBase,
    estado: (estadoLocal?.estado as EstadoHoja | undefined) ?? hojaBase.estado,
    sync: (estadoLocal?.sync as EstadoSync | undefined) ?? hojaBase.sync,
    conteos: filasConteo.map(filaAConteo),
  };
}

async function hojasConEstadoLocal(hojasBase: HojaConteo[]): Promise<HojaConteo[]> {
  const resultado: HojaConteo[] = [];
  for (const hoja of hojasBase) resultado.push(await hojaConEstadoLocal(hoja));
  return resultado;
}

// ---------------------------------------------------------------------------
// El adaptador
// ---------------------------------------------------------------------------

export const hojasSqlite: RepositorioHojas = {
  async mias(inventarioId) {
    const inventario = await obtenerInventario(inventarioId);
    if (!inventario) return [];

    const sesion = await sesionMemoria.sesionActiva();
    if (!sesion) return [];

    const propias = inventario.hojas.filter((hoja) => hoja.asignados.includes(sesion.colaborador.nombre));
    return hojasConEstadoLocal(propias);
  },

  async todas(inventarioId) {
    const inventario = await obtenerInventario(inventarioId);
    if (!inventario) return [];
    return hojasConEstadoLocal(inventario.hojas);
  },

  async porNumero(inventarioId, numero) {
    const inventario = await obtenerInventario(inventarioId);
    const hojaBase = inventario?.hojas.find((h) => h.numero === numero);
    if (!hojaBase) return null;
    return hojaConEstadoLocal(hojaBase);
  },

  async guardarConteo(hojaId, conteo) {
    const hojaBase = await buscarHojaPorId(hojaId);
    if (!hojaBase) throw new Error(`Hoja ${hojaId} no encontrada.`);

    const actual = await hojaConEstadoLocal(hojaBase);
    if (!puedeEditar(actual)) {
      throw new Error(`La hoja #${actual.numero} ya está finalizada: no se puede corregir el conteo.`);
    }

    const db = await obtenerDb();
    const ahora = new Date().toISOString();
    const nuevoEstado: EstadoHoja = actual.estado === 'pendiente' ? 'en-proceso' : actual.estado;

    // Todo en UNA transacción: si la app muere entre el conteo y la cola,
    // al reabrir no queda ninguno de los dos a medias — o están los tres
    // cambios, o ninguno.
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        'INSERT OR REPLACE INTO conteos (hoja_id, producto_id, empaques, sueltas, confirmado_por_escaner, contado_en) VALUES (?, ?, ?, ?, ?, ?)',
        [hojaId, conteo.productoId, conteo.empaques, conteo.sueltas, conteo.confirmadoPorEscaner ? 1 : 0, conteo.contadoEn],
      );
      await db.runAsync('UPDATE hoja_estado_local SET estado = ?, sync = ? WHERE hoja_id = ?', [nuevoEstado, 'local', hojaId]);
      // ON CONFLICT en (hoja_id, tipo, producto_id): un conteo nuevo del
      // MISMO producto reemplaza al que ya estaba pendiente de mandar —
      // nunca se apilan dos envíos para lo mismo (ver sqlite-cola.ts).
      await db.runAsync(
        `INSERT INTO cola_sync (hoja_id, tipo, producto_id, creado_en, intentos, estado)
         VALUES (?, 'conteo', ?, ?, 0, 'pendiente')
         ON CONFLICT(hoja_id, tipo, producto_id)
         DO UPDATE SET creado_en = excluded.creado_en, intentos = 0, estado = 'pendiente'`,
        [hojaId, conteo.productoId, ahora],
      );
    });
    // Devuelve cuando SQLite ya confirmó, no antes: el operario está
    // parado frente a la góndola, pero lo que ve como "guardado" tiene
    // que estarlo de verdad, no solo en una promesa de memoria.
  },

  async finalizar(hojaId) {
    const hojaBase = await buscarHojaPorId(hojaId);
    if (!hojaBase) throw new Error(`Hoja ${hojaId} no encontrada.`);

    const actual = await hojaConEstadoLocal(hojaBase);
    // finalizarDominio es pura y lanza si ya estaba finalizada — mismo
    // punto de no retorno que hojas-memoria.ts, no se relaja acá.
    const finalizada = finalizarDominio(actual);

    const db = await obtenerDb();
    const ahora = new Date().toISOString();
    await db.withTransactionAsync(async () => {
      await db.runAsync('UPDATE hoja_estado_local SET estado = ?, sync = ? WHERE hoja_id = ?', ['finalizada', 'local', hojaId]);
      await db.runAsync(
        `INSERT INTO cola_sync (hoja_id, tipo, producto_id, creado_en, intentos, estado)
         VALUES (?, 'finalizar', 0, ?, 0, 'pendiente')
         ON CONFLICT(hoja_id, tipo, producto_id)
         DO UPDATE SET creado_en = excluded.creado_en, intentos = 0, estado = 'pendiente'`,
        [hojaId, ahora],
      );
    });

    // sync: 'local', NO 'sincronizado' — finalizar también es una
    // escritura que tiene que llegar al servidor. Decir "sincronizado"
    // acá sería la misma promesa incumplida que este adaptador existe
    // para dejar de hacer.
    return { ...finalizada, sync: 'local' };
  },
};

// ---------------------------------------------------------------------------
// Cola de sincronización
// ---------------------------------------------------------------------------

/** Lo que hace falta para mandar UN item — nunca el conteo entero: `hoja` es de solo lectura, no se decide nada de negocio acá. */
export type EnviarItemCola = (item: ItemCola, hoja: HojaConteo) => Promise<ResultadoEnvio>;

/**
 * Recorre la cola en orden y trata de mandar cada item con `enviar`
 * (inyectado: hoy no hay un endpoint de hojas confirmado contra el
 * backend — ver hojas-api.ts — así que nada llama a esto todavía con una
 * implementación de red real; queda lista para cuando lo haya, sin tener
 * que tocar este archivo).
 *
 * Rechazado o sin red: el item queda en `error` (sqlite-cola.ts#
 * aplicarResultadoEnvio) — NUNCA desaparece en silencio ni se reintenta
 * infinito sin que se note. El conteo en sí sigue en `conteos`: lo único
 * que cambia es que deja de estar "al día" con el servidor.
 */
export async function procesarColaDeSincronizacion(enviar: EnviarItemCola): Promise<void> {
  const db = await obtenerDb();
  const filas = await db.getAllAsync<FilaCola>("SELECT * FROM cola_sync WHERE estado != 'enviando'");
  const items = ordenarCola(filas.map(filaAItemCola));

  for (const item of items) {
    await db.runAsync('UPDATE cola_sync SET estado = ? WHERE id = ?', ['enviando', item.id]);

    const hojaBase = await buscarHojaPorId(item.hojaId);
    let resultado: ResultadoEnvio;
    if (!hojaBase) {
      // La hoja ya no existe en el origen — no debería pasar, pero no
      // tira abajo el resto de la cola si pasa.
      resultado = { ok: false, motivo: 'rechazado' };
    } else {
      const hojaActual = await hojaConEstadoLocal(hojaBase);
      try {
        resultado = await enviar(item, hojaActual);
      } catch {
        resultado = { ok: false, motivo: 'sin-red' };
      }
    }

    const siguiente = aplicarResultadoEnvio(item, resultado);
    if (siguiente === null) {
      await db.runAsync('DELETE FROM cola_sync WHERE id = ?', [item.id]);
    } else {
      await db.runAsync('UPDATE cola_sync SET estado = ?, intentos = ? WHERE id = ?', [siguiente.estado, siguiente.intentos, item.id]);
    }

    // El sync de la hoja se recalcula de lo que le queda pendiente EN LA
    // COLA, nunca se pisa a mano aparte — así nunca se desincroniza de
    // la cola real (mismo criterio que sqlite-cola.ts#estadoSyncDeHoja).
    const restantes = await db.getAllAsync<FilaCola>('SELECT * FROM cola_sync WHERE hoja_id = ?', [item.hojaId]);
    const nuevoSync = estadoSyncDeHoja(restantes.map(filaAItemCola));
    await db.runAsync('UPDATE hoja_estado_local SET sync = ? WHERE hoja_id = ?', [nuevoSync, item.hojaId]);
  }
}
