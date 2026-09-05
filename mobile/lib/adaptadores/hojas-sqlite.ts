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
import { catalogoApi } from './catalogo-api';
import { esErrorApi, esFallaDeRed } from './_http';
import { hojasApi } from './hojas-api';
import { sesionApi } from './sesion-api';
import { sesionMemoria } from './sesion-memoria';
import type { Conteo, Empaque, EstadoHoja, EstadoSync, HojaConteo, LineaEmpaque, Producto } from '../dominio/tipos';
import type { RepositorioHojas } from '../puertos/repositorios';

/**
 * Marcador de v1→v2 (ver sqlite-esquema.ts): una línea legada no dice a
 * cuál empaque correspondía su cantidad porque v1 solo conocía uno por
 * producto. `repararLineasLegado` la resuelve la primera vez que se
 * relee esa fila, con el producto real a mano.
 */
const EMPAQUE_LEGADO = '__LEGADO__';

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
  /** JSON de LineaEmpaque[] — ver sqlite-esquema.ts (migración v2). */
  lineas: string;
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

/** `hojas_estructura` (migración v3) — ver sqlite-esquema.ts para el porqué. */
interface FilaHojaEstructura {
  id: number;
  inventario_id: number;
  numero: string;
  zona: string;
  gondola: string;
  tamano: number;
  /** JSON de string[]. */
  asignados: string;
}

/** `productos_estructura` (migración v3). */
interface FilaProductoEstructura {
  hoja_id: number;
  id: number;
  orden: number;
  codigo: string;
  codigo_barras: string;
  descripcion: string;
  /** JSON de Empaque[]. */
  empaques: string;
  ubicacion: string | null;
  categoria: string | null;
}

function filaAConteo(f: FilaConteo): Conteo {
  return {
    productoId: f.producto_id,
    empaques: JSON.parse(f.lineas) as LineaEmpaque[],
    sueltas: f.sueltas,
    confirmadoPorEscaner: f.confirmado_por_escaner === 1,
    contadoEn: f.contado_en,
  };
}

/**
 * Resuelve las líneas `__LEGADO__` de un conteo (ver el comentario de la
 * constante, arriba) al empaque por defecto del producto REAL — y deja
 * la corrección escrita en la base, para no repetir el trabajo en cada
 * lectura de la misma fila. Sin líneas legadas, no toca la base.
 */
async function repararLineasLegado(hojaId: number, conteo: Conteo, producto: Producto): Promise<Conteo> {
  if (!conteo.empaques.some((l) => l.empaqueNombre === EMPAQUE_LEGADO)) return conteo;

  const nombreDefault = producto.empaques[0]?.nombre ?? EMPAQUE_LEGADO;
  const lineasReparadas = conteo.empaques.map((l) => (l.empaqueNombre === EMPAQUE_LEGADO ? { ...l, empaqueNombre: nombreDefault } : l));

  const db = await obtenerDb();
  await db.runAsync('UPDATE conteos SET lineas = ? WHERE hoja_id = ? AND producto_id = ?', [
    JSON.stringify(lineasReparadas),
    hojaId,
    conteo.productoId,
  ]);

  return { ...conteo, empaques: lineasReparadas };
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

function filaAProducto(f: FilaProductoEstructura): Producto {
  return {
    id: f.id,
    codigo: f.codigo,
    codigoBarras: f.codigo_barras,
    descripcion: f.descripcion,
    empaques: JSON.parse(f.empaques) as Empaque[],
    // `exactOptionalPropertyTypes`: un `ubicacion: undefined` explícito no
    // es lo mismo que omitir la clave — se arma condicional en vez de
    // pasar `f.ubicacion ?? undefined`.
    ...(f.ubicacion !== null ? { ubicacion: f.ubicacion } : {}),
    ...(f.categoria !== null ? { categoria: f.categoria } : {}),
  };
}

/**
 * Arma un `HojaConteo` desde `hojas_estructura` + `productos_estructura`
 * SOLO con lo que esas dos tablas saben — nunca estado/sync/conteos
 * reales, que siguen viviendo únicamente en `hoja_estado_local`/`conteos`
 * (ver el comentario de la migración v3). Los tres placeholders de acá
 * abajo ('pendiente'/'local'/[]) los pisa siempre `hojaConEstadoLocal`
 * más abajo — el único momento en que el estado/sync/conteos REAL importa
 * es la primera siembra, y ésa usa la hoja fresca que vino de la red
 * (`guardarEstructuraDeHoja`), no ésta.
 */
function filaAHojaBase(fila: FilaHojaEstructura, productos: Producto[]): HojaConteo {
  return {
    id: fila.id,
    inventarioId: fila.inventario_id,
    numero: fila.numero,
    zona: fila.zona,
    gondola: fila.gondola,
    // `tamano` es el tamaño NOMINAL del lote pedido al crear las hojas
    // (20/30/50, configurable — ver tipos.ts y backend/dominio/lote.ts#
    // partirEnHojas), no cuántos productos tiene ESTA hoja: la última hoja
    // de un inventario real queda parcial cuando el catálogo no es
    // múltiplo exacto del lote, y eso es correcto y esperado. Se guarda
    // TAL CUAL vino del backend — quien necesite "cuánto hay para contar
    // de verdad" usa `productos.length` (o `avance()`, que ya lo hace),
    // nunca este campo.
    tamano: fila.tamano,
    estado: 'pendiente',
    sync: 'local',
    asignados: JSON.parse(fila.asignados) as string[],
    productos,
    conteos: [],
  };
}

// ---------------------------------------------------------------------------
// Estructura descargada — lectura (hojas_estructura + productos_estructura)
// ---------------------------------------------------------------------------

type DbSqlite = Awaited<ReturnType<typeof obtenerDb>>;

async function productosDeHojaDb(db: DbSqlite, hojaId: number): Promise<Producto[]> {
  const filas = await db.getAllAsync<FilaProductoEstructura>(
    'SELECT * FROM productos_estructura WHERE hoja_id = ? ORDER BY orden ASC',
    [hojaId],
  );
  return filas.map(filaAProducto);
}

async function hojaEstructuraDb(db: DbSqlite, hojaId: number): Promise<HojaConteo | null> {
  const fila = await db.getFirstAsync<FilaHojaEstructura>('SELECT * FROM hojas_estructura WHERE id = ?', [hojaId]);
  if (!fila) return null;
  return filaAHojaBase(fila, await productosDeHojaDb(db, fila.id));
}

async function hojasEstructuraDeInventarioDb(db: DbSqlite, inventarioId: number): Promise<HojaConteo[]> {
  const filas = await db.getAllAsync<FilaHojaEstructura>(
    'SELECT * FROM hojas_estructura WHERE inventario_id = ? ORDER BY numero ASC',
    [inventarioId],
  );
  const resultado: HojaConteo[] = [];
  for (const fila of filas) resultado.push(filaAHojaBase(fila, await productosDeHojaDb(db, fila.id)));
  return resultado;
}

/**
 * La hoja BASE, real primero: si ya se descargó su estructura (tabla
 * `hojas_estructura`), es esa. Si no — el inventario nunca se descargó, o
 * es el dataset de ejemplo — cae al mock de `_compartido.ts`, exactamente
 * el comportamiento de siempre. Ningún llamador de este archivo necesita
 * saber cuál de los dos casos es.
 */
async function buscarHojaBase(hojaId: number): Promise<HojaConteo | undefined> {
  const db = await obtenerDb();
  const real = await hojaEstructuraDb(db, hojaId);
  if (real) return real;
  return buscarHojaPorId(hojaId);
}

interface HojasDeInventarioBase {
  hojas: HojaConteo[];
  /**
   * 'real': salieron de `hojas_estructura` — el backend YA filtró
   * `alcance` (mías vs. todas) del lado del servidor, así que acá no hay
   * que volver a filtrar por nombre de colaborador.
   * 'mock': cayó a `_compartido.ts` — mismo dataset de ejemplo de
   * siempre, que SÍ necesita el filtro manual (ver `mias()` abajo).
   */
  origen: 'real' | 'mock';
}

async function hojasDeInventarioBase(inventarioId: number): Promise<HojasDeInventarioBase> {
  const db = await obtenerDb();
  const reales = await hojasEstructuraDeInventarioDb(db, inventarioId);
  if (reales.length > 0) return { hojas: reales, origen: 'real' };

  const inventario = await obtenerInventario(inventarioId);
  return { hojas: inventario?.hojas ?? [], origen: 'mock' };
}

/**
 * El `inventarioId` sin preguntarle al servidor — para cuando
 * `repositorioInventario.activo()` no puede responder (sin red: es HTTP
 * puro, sin caché local, ver contenedor.ts). Sin este fallback, Inicio,
 * Mis hojas y Contar dependían TODAS de esa respuesta para poder mostrar
 * cualquier cosa, aunque el avance completo ya estuviera acá adentro: el
 * operario sin señal veía un spinner infinito en vez de su trabajo.
 *
 * Se resuelve leyendo `hojas_estructura`, que ya tiene el `inventario_id`
 * de cualquier hoja que se haya descargado alguna vez. Un colaborador
 * cuenta en UN inventario a la vez, así que cualquier fila sirve — no es
 * la fuente de verdad (`repositorioInventario.activo()` lo es cuando hay
 * red), es el único dato que queda cuando no la hay.
 */
export async function inventarioIdSinRed(): Promise<number | null> {
  const db = await obtenerDb();
  const fila = await db.getFirstAsync<{ inventario_id: number }>('SELECT inventario_id FROM hojas_estructura LIMIT 1');
  return fila?.inventario_id ?? null;
}

// ---------------------------------------------------------------------------
// Descarga inicial — lo que faltaba (bug real, reportado por el cliente)
// ---------------------------------------------------------------------------

/**
 * Cuántos productos entran en un solo INSERT: 25 hojas × 50 productos son
 * 1.250 filas — hacerlo un `runAsync` por producto es 1.250 idas y vueltas
 * al motor nativo por cada descarga. Un INSERT con N tuplas de `VALUES` es
 * una sola llamada; 100 productos × 9 columnas = 900 parámetros
 * posicionales, bien debajo del límite de SQLite (999 por sentencia en la
 * configuración por defecto) con margen para no pisarlo si un producto
 * suma una columna más el día de mañana.
 */
const TAMANO_LOTE_INSERT_PRODUCTOS = 100;

async function insertarProductosEnLote(db: DbSqlite, hojaId: number, productos: Producto[]): Promise<void> {
  for (let inicio = 0; inicio < productos.length; inicio += TAMANO_LOTE_INSERT_PRODUCTOS) {
    const lote = productos.slice(inicio, inicio + TAMANO_LOTE_INSERT_PRODUCTOS);
    const placeholders = lote.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
    const valores: (string | number | null)[] = [];
    lote.forEach((p, i) => {
      valores.push(
        hojaId,
        p.id,
        inicio + i,
        p.codigo,
        p.codigoBarras,
        p.descripcion,
        JSON.stringify(p.empaques),
        p.ubicacion ?? null,
        p.categoria ?? null,
      );
    });
    await db.runAsync(
      `INSERT INTO productos_estructura (hoja_id, id, orden, codigo, codigo_barras, descripcion, empaques, ubicacion, categoria) VALUES ${placeholders}`,
      valores,
    );
  }
}

/**
 * Guarda la ESTRUCTURA de una hoja recién bajada del backend. Dos reglas
 * duras, las dos a propósito:
 *
 *  1. Los productos se insertan UNA sola vez por hoja — si ya hay filas en
 *     `productos_estructura` para esa hoja, no se vuelven a tocar. Una
 *     hoja ya asignada no cambia de catálogo (el backend se niega con 409
 *     a rehacer hojas que ya tienen conteos, ver backend/README.md), así
 *     que reinsertar 1.250 productos en CADA visita a "Mis hojas" sería
 *     trabajo repetido sin ningún beneficio.
 *  2. `asegurarSembrada(hoja)` recibe la hoja FRESCA de la red (con su
 *     estado/sync/conteos reales), nunca la reconstruida de
 *     `hojas_estructura` (que no los tiene, ver `filaAHojaBase`) — es lo
 *     que le permite a `asegurarSembrada` sembrar bien la PRIMERA vez y,
 *     a la vez, es inofensivo las veces siguientes: si `hoja_estado_local`
 *     ya existe, `asegurarSembrada` no toca nada — ni el estado, ni el
 *     sync, ni la tabla `conteos`. Es la garantía que pide el bug: si el
 *     operario ya contó 32 de 50 sin señal, esta función NUNCA se lo pisa.
 */
async function guardarEstructuraDeHoja(db: DbSqlite, hoja: HojaConteo): Promise<void> {
  await db.runAsync(
    `INSERT INTO hojas_estructura (id, inventario_id, numero, zona, gondola, tamano, asignados)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       inventario_id = excluded.inventario_id,
       numero = excluded.numero,
       zona = excluded.zona,
       gondola = excluded.gondola,
       tamano = excluded.tamano,
       asignados = excluded.asignados`,
    [hoja.id, hoja.inventarioId, hoja.numero, hoja.zona, hoja.gondola, hoja.tamano, JSON.stringify(hoja.asignados)],
  );

  if (hoja.productos.length > 0) {
    const conteo = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM productos_estructura WHERE hoja_id = ?', [
      hoja.id,
    ]);
    if (!conteo || conteo.n === 0) {
      await insertarProductosEnLote(db, hoja.id, hoja.productos);
    }
  }

  await asegurarSembrada(hoja);
}

/**
 * Lo que le hace falta a la pantalla para el mensaje del punto 4 — ver
 * mis-hojas.tsx. Tres motivos, no dos, porque "sin red" y "el servidor
 * respondió pero está mal" piden acciones DISTINTAS de quien cuenta:
 * reconectarse a la WiFi de la tienda no arregla una sesión vencida ni un
 * 500 del backend, y decirle que sí es el mismo "0 hojas sin explicación"
 * que reportó el cliente, con otra causa.
 */
export type ResultadoDescarga =
  | { ok: true; hojas: number }
  | { ok: false; motivo: 'sin-red' | 'sesion-vencida' | 'error' };

const ultimosResultados = new Map<string, ResultadoDescarga>();

function claveResultado(inventarioId: number, alcance: 'mias' | 'todas'): string {
  return `${inventarioId}:${alcance}`;
}

/**
 * Qué pasó la ÚLTIMA vez que se intentó bajar `alcance` para este
 * inventario. La pantalla lo usa para distinguir "0 hojas porque no hay
 * ninguna asignada todavía" de "0 hojas porque no hay señal y nunca se
 * pudo bajar nada" — son dos mensajes distintos, y confundirlos es
 * exactamente la pantalla vacía sin explicación que reportó el cliente.
 */
export function ultimaDescarga(inventarioId: number, alcance: 'mias' | 'todas'): ResultadoDescarga | null {
  return ultimosResultados.get(claveResultado(inventarioId, alcance)) ?? null;
}

/**
 * La descarga inicial que faltaba. `GET /api/hojas?...` (backend/README.md)
 * manda `productos: []` en el LISTADO a propósito — completar el catálogo
 * de cada hoja es un pedido aparte (`GET /api/hojas/:id/productos`, el
 * mismo que ya usa `catalogo-api.ts`), así que una hoja sin productos en
 * la respuesta se completa acá antes de guardar nada.
 *
 * Nunca lanza: sin red, sin servidor, cualquier falla — vuelve
 * `{ ok: false, ... }` y el que llama sigue con lo que ya tenía local.
 * Bajar hojas es un refresco, no un requisito para poder seguir contando.
 */
async function descargarHojas(inventarioId: number, alcance: 'mias' | 'todas'): Promise<ResultadoDescarga> {
  let remotas: HojaConteo[];
  try {
    const respuesta = alcance === 'mias' ? await hojasApi.mias(inventarioId) : await hojasApi.todas(inventarioId);
    // Defensivo a propósito: un `200` que no trae un array (un backend de
    // prueba que no conoce esta ruta y devuelve `{}` genérico, o un proxy
    // que reescribe la respuesta) no es una falla de red que capturar acá
    // arriba, pero tampoco son hojas — se trata como "nada que guardar",
    // nunca como un array a medio armar que rompa el resto de la función.
    remotas = Array.isArray(respuesta) ? respuesta : [];
  } catch (error) {
    const motivo = esFallaDeRed(error)
      ? 'sin-red'
      : esErrorApi(error) && error.clase === 'sesion-vencida'
        ? 'sesion-vencida'
        : 'error';
    const resultado: ResultadoDescarga = { ok: false, motivo };
    ultimosResultados.set(claveResultado(inventarioId, alcance), resultado);
    return resultado;
  }

  const completas: HojaConteo[] = [];
  for (const hoja of remotas) {
    if (hoja.productos.length > 0) {
      completas.push(hoja);
      continue;
    }
    try {
      const productos = await catalogoApi.deHoja(hoja.id);
      completas.push({ ...hoja, productos });
    } catch {
      // Sin catálogo por esta vez — se guarda igual (estructura/asignación
      // ya sirven para que la hoja aparezca en la lista) y se reintenta
      // completar el catálogo en la próxima descarga.
      completas.push(hoja);
    }
  }

  // Sin transacción envolvente acá: guardarEstructuraDeHoja ya abre su
  // propia transacción por hoja, y adentro llama a asegurarSembrada, que
  // abre OTRA — SQLite (node:sqlite y expo-sqlite por igual) no admite
  // transacciones anidadas sin SAVEPOINT. Atomicidad por hoja alcanza:
  // no hace falta que las 25 se guarden todas o ninguna.
  const db = await obtenerDb();
  for (const hoja of completas) await guardarEstructuraDeHoja(db, hoja);

  const resultado: ResultadoDescarga = { ok: true, hojas: completas.length };
  ultimosResultados.set(claveResultado(inventarioId, alcance), resultado);
  return resultado;
}

/**
 * Dispara la descarga y decide si HAY que esperarla:
 *  - ya hay estructura local para este inventario → se muestra YA (no hace
 *    esperar un timeout de red para terminar mostrando lo mismo que ya
 *    había); la descarga corre en segundo plano para refrescar.
 *  - no hay nada local todavía → no hay nada más que mostrar, así que sí
 *    vale la pena esperar el intento (es el caso "primera vez, con WiFi,
 *    en la tienda" del punto 1).
 */
async function descargarSiHaceFalta(inventarioId: number, alcance: 'mias' | 'todas'): Promise<void> {
  const db = await obtenerDb();
  const yaHayLocal = (await hojasEstructuraDeInventarioDb(db, inventarioId)).length > 0;

  if (yaHayLocal) {
    void descargarHojas(inventarioId, alcance);
    return;
  }
  await descargarHojas(inventarioId, alcance);
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
        'INSERT OR REPLACE INTO conteos (hoja_id, producto_id, lineas, sueltas, confirmado_por_escaner, contado_en) VALUES (?, ?, ?, ?, ?, ?)',
        [hojaBase.id, c.productoId, JSON.stringify(c.empaques), c.sueltas, c.confirmadoPorEscaner ? 1 : 0, c.contadoEn],
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

  const productosPorId = new Map(hojaBase.productos.map((p) => [p.id, p] as const));
  const conteos = await Promise.all(
    filasConteo.map((f) => {
      const conteo = filaAConteo(f);
      const producto = productosPorId.get(f.producto_id);
      return producto ? repararLineasLegado(hojaBase.id, conteo, producto) : conteo;
    }),
  );

  return {
    ...hojaBase,
    estado: (estadoLocal?.estado as EstadoHoja | undefined) ?? hojaBase.estado,
    sync: (estadoLocal?.sync as EstadoSync | undefined) ?? hojaBase.sync,
    conteos,
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
    // La descarga que faltaba (bug real): antes de leer nada, se le
    // pregunta al backend. Ver `descargarSiHaceFalta` para cuándo se
    // espera esa respuesta y cuándo se muestra lo local sin esperar.
    await descargarSiHaceFalta(inventarioId, 'mias');

    const { hojas, origen } = await hojasDeInventarioBase(inventarioId);
    if (origen === 'real') {
      // El backend ya resolvió "mías" del lado del servidor
      // (alcance=mias, ver backend/README.md) — lo que hay en
      // `hojas_estructura` para este inventario NO es nada más que eso.
      return hojasConEstadoLocal(hojas);
    }

    // Cayó al dataset de ejemplo (`_compartido.ts`): ese SÍ mezcla las
    // hojas de todos los contadores en un solo inventario, así que acá
    // sigue haciendo falta el filtro por nombre, como siempre.
    // El login por defecto pasa por sesionApi (HTTP), que guarda la sesión
    // activa en su propia tabla SQLite — no en el estado en memoria de
    // sesionMemoria. Probar ahí primero y caer a sesionMemoria cubre el
    // modo debug (EXPO_PUBLIC_PUERTOS_MEMORIA=sesion) sin volver a perder
    // de vista quién está logueado cuando la sesión sí vino por HTTP.
    const sesion = (await sesionApi.sesionActiva()) ?? (await sesionMemoria.sesionActiva());
    if (!sesion) return [];

    const propias = hojas.filter((hoja) => hoja.asignados.includes(sesion.colaborador.nombre));
    return hojasConEstadoLocal(propias);
  },

  async todas(inventarioId) {
    await descargarSiHaceFalta(inventarioId, 'todas');
    const { hojas } = await hojasDeInventarioBase(inventarioId);
    return hojasConEstadoLocal(hojas);
  },

  async porNumero(inventarioId, numero) {
    // `porNumero` lo usa `contar.tsx` para reabrir UNA hoja propia
    // (siempre después de haber pasado por `mias()`), así que alcanza con
    // refrescar el mismo alcance — no hace falta esperar acá si `mias()`
    // ya disparó la descarga hace un instante.
    await descargarSiHaceFalta(inventarioId, 'mias');
    const { hojas } = await hojasDeInventarioBase(inventarioId);
    const hojaBase = hojas.find((h) => h.numero === numero);
    if (!hojaBase) return null;
    return hojaConEstadoLocal(hojaBase);
  },

  async guardarConteo(hojaId, conteo) {
    const hojaBase = await buscarHojaBase(hojaId);
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
        'INSERT OR REPLACE INTO conteos (hoja_id, producto_id, lineas, sueltas, confirmado_por_escaner, contado_en) VALUES (?, ?, ?, ?, ?, ?)',
        [hojaId, conteo.productoId, JSON.stringify(conteo.empaques), conteo.sueltas, conteo.confirmadoPorEscaner ? 1 : 0, conteo.contadoEn],
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
    const hojaBase = await buscarHojaBase(hojaId);
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

export interface EstadoColaCruda {
  /** Todo lo que sigue en `cola_sync`, sea cual sea su sub-estado (pendiente/enviando/error). */
  pendientes: number;
  /** Cuántos de esos quedaron en `error` -- no se van a resolver solos reintentando. */
  enError: number;
}

/** Lo que necesita `sincronizador.ts` para armar `EstadoCola` (puertos/repositorios.ts) -- cuenta TODA la cola, no una hoja sola. */
export async function estadoDeLaCola(): Promise<EstadoColaCruda> {
  const db = await obtenerDb();
  const filas = await db.getAllAsync<{ estado: string }>('SELECT estado FROM cola_sync');
  return { pendientes: filas.length, enError: filas.filter((f) => f.estado === 'error').length };
}

/**
 * Recorre la cola en orden y trata de mandar cada item con `enviar`
 * (inyectado a propósito: este archivo no sabe de red, `sincronizador.ts`
 * es quien decide CUÁNDO llamar a esto y CÓMO mandar cada item por HTTP).
 *
 * `enviar` real es `enviarPorRed` (sincronizador.ts) contra `hojasApi`
 * (hojas-api.ts). `sincronizador.ts` la dispara en 5 momentos, todos
 * verificados en el código, no solo documentados acá:
 *   1. Reconexión de red — sincronizador.ts:160-166 (Network.addNetworkStateListener, solo en la transición a conectado).
 *   2. Al finalizar una hoja — app/conteo/contar.tsx:289 (`void sincronizador.sincronizar()` justo después de `repositorioHojas.finalizar()`).
 *   3. Manual — app/conteo/contar.tsx:323 y app/conteo/mis-hojas.tsx:140 (`BandaSync onSincronizar`).
 *   4. Vuelta a primer plano — sincronizador.ts:171 (`AppState.addEventListener('change', ...)`).
 *   5. Arranque de la app — app/_layout.tsx:43 (`useEffect(() => iniciarSincronizador(), [])`).
 * `contenedor.ts` expone `sincronizador` como `sincronizadorReal` directo,
 * sin flag que pueda caer a un stub.
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

    const hojaBase = await buscarHojaBase(item.hojaId);
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
