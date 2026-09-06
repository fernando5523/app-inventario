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
  /** Migración v5 — ver sqlite-esquema.ts. NULL salvo un rechazo real. */
  razon: string | null;
}

/** `hojas_estructura` (migración v3, `numero_conteo` en v4, `sucursal_id` en v6, `asignado_a(2)_id` en v7) — ver sqlite-esquema.ts. */
interface FilaHojaEstructura {
  id: number;
  inventario_id: number;
  numero: string;
  zona: string;
  gondola: string;
  tamano: number;
  /** JSON de string[]. */
  asignados: string;
  /** La ronda del ciclo (v4). Las filas anteriores a v4 quedan en 1. */
  numero_conteo: number;
  /** De qué sucursal es esta hoja (v6). NULL = se bajó antes de que existiera esta columna. */
  sucursal_id: number | null;
  /** Id de `asignados[0]`/`asignados[1]` (v7). NULL = se bajó antes de que el backend los mandara. */
  asignado_a_id: number | null;
  asignado_a2_id: number | null;
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
    razon: f.razon,
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
    // Si NINGUNO de los dos ids está guardado (fila de antes de v7), se
    // omiten los DOS -- deja el objeto sin la clave (`undefined`), para
    // que `esAsignadaA` caiga al nombre en vez de comparar contra `null`
    // y fallar siempre (SQL no distingue "esta fila es de antes de v7"
    // de "el backend confirmó que no hay nadie acá": las dos dan NULL).
    // Si CUALQUIERA de los dos SÍ está, viajan los dos tal cual -- uno
    // puede ser legítimamente `null` ("no hay segundo asignado").
    ...(fila.asignado_a_id !== null || fila.asignado_a2_id !== null
      ? { asignadoAId: fila.asignado_a_id, asignadoA2Id: fila.asignado_a2_id }
      : {}),
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

async function hojasEstructuraDeInventarioDb(db: DbSqlite, inventarioId: number, ronda: number): Promise<HojaConteo[]> {
  // Filtra por ronda EN LA CONSULTA: las hojas de la ronda 1 y la 2 conviven
  // en la tabla (ids distintos), pero el Contador solo ve las de la ronda
  // activa. Traer las dos y filtrar después dejaría entrar el conteo ciego
  // por la ventana — la hoja de otra ronda no tiene por qué llegar acá.
  const filas = await db.getAllAsync<FilaHojaEstructura>(
    'SELECT * FROM hojas_estructura WHERE inventario_id = ? AND numero_conteo = ? ORDER BY numero ASC',
    [inventarioId, ronda],
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

async function hojasDeInventarioBase(inventarioId: number, ronda: number): Promise<HojasDeInventarioBase> {
  const db = await obtenerDb();
  const reales = await hojasEstructuraDeInventarioDb(db, inventarioId, ronda);
  if (reales.length > 0) return { hojas: reales, origen: 'real' };

  // El dataset de ejemplo (`_compartido.ts`) solo tiene la ronda 1 sembrada:
  // no modela reconteo. Para una ronda > 1 no hay mock que ofrecer — vacío,
  // en vez de devolver las de la ronda 1 haciéndolas pasar por otra ronda.
  if (ronda !== 1) return { hojas: [], origen: 'real' };
  const inventario = await obtenerInventario(inventarioId);
  return { hojas: inventario?.hojas ?? [], origen: 'mock' };
}

/**
 * Quién es la sesión activa, para TODO el camino sin red — colaboradorId
 * (identidad dura, ver `esAsignadaA`/`asignadaPorIdONombre`), nombre (el
 * fallback para hojas de antes de v7) y sucursal (para no cruzar hojas de
 * otra tienda). La usan `mias`/`porNumero` Y `inventarioIdSinRed`/
 * `rondaActivaSinRed` — una sola función, para que las cuatro decidan
 * "quién soy" exactamente de la misma forma.
 *
 * `sucursalId: null` es un caso real, no un error: el Administrador no
 * pertenece a ninguna sucursal (ver dominio/tipos.ts#Sesion). Para él,
 * el filtro de sucursal simplemente no descarta nada por esa vía — igual
 * que una fila vieja con `sucursal_id` NULL (ver migración v6).
 *
 * HALLAZGO (2026-09-06, min-1): sin red, "Mis hojas" de Luis mostró las
 * hojas de OTRO colaborador (Bolívar) — con el filtro por id ya aplicado
 * (`859ea5e`). La sesión que quedó en `sesion_activa` (SQLite,
 * sesion-api.ts) al momento de revisar el dispositivo estaba VACÍA — no
 * se pudo confirmar la fila exacta de aquel momento, pero confirma que
 * esa tabla puede terminar con una sesión ausente o parcial (expiró,
 * quedó a medio escribir, un payload de una corrida vieja). El TIPO
 * `Sesion` dice que `colaborador.id`/`.nombre` siempre están, pero eso es
 * lo que promete el compilador sobre datos que en el teléfono vienen de
 * `JSON.parse` de lo que sea que haya en disco — no una garantía real.
 * Por eso esta función VALIDA en tiempo de ejecución, no solo confía en
 * el tipo: sin `colaboradorId` (número) o sin `nombre` (string no vacío),
 * es EXACTAMENTE lo mismo que no tener sesión — no hay de quién decir
 * que son las hojas, y mostrar cualquier cosa sería inventar un dueño.
 */
interface IdentidadSinRed {
  colaboradorId: number;
  nombre: string;
  sucursalId: number | null;
}

async function identidadSinRed(): Promise<IdentidadSinRed | null> {
  const sesion = (await sesionApi.sesionActiva()) ?? (await sesionMemoria.sesionActiva());
  if (!sesion) return null;

  const colaboradorId = sesion.colaborador?.id;
  const nombre = sesion.colaborador?.nombre;
  if (typeof colaboradorId !== 'number' || typeof nombre !== 'string' || nombre.trim() === '') return null;

  // `sesion.sucursal === null` es el Administrador, un caso VÁLIDO (no se
  // rechaza). Pero si el campo SÍ trae un objeto, tiene que tener un id
  // usable -- un objeto `sucursal` a medias es la misma sospecha que un
  // `colaborador` a medias.
  if (sesion.sucursal !== null && typeof sesion.sucursal?.id !== 'number') return null;

  return { colaboradorId, nombre, sucursalId: sesion.sucursal?.id ?? null };
}

/**
 * Una fila de `hojas_estructura` es "de la persona que está usando el
 * teléfono ahora" SOLO cuando trae `asignado_a_id` (v7) Y `sucursal_id`
 * (v6) Y alguno de los dos coincide con su identidad. Sin esos dos datos
 * la fila es VIEJA (se bajó antes de que el backend los mandara) y NO es
 * de nadie -- ni siquiera de quien esté logueado en este instante.
 *
 * HALLAZGO (2026-09-06): antes, sin esos ids, se caía al NOMBRE
 * (`asignados: string[]`) como último recurso -- y ESE fue el bug de
 * "hojas cruzadas sin red": un colaborador de OTRA sucursal que se llama
 * igual que un ROL ("Conteo", visto en los datos reales del emulador)
 * coincidía por nombre con cualquiera que tuviera ese rol, sin que el
 * dueño real de esas hojas tuviera ninguna fila propia todavía. "No se
 * puede decidir de quién es" nunca se resuelve mostrándosela a quien esté
 * logueado -- se resuelve NO mostrándola y dejando que la próxima
 * descarga con red la complete (o, si nunca se completa, la migración v8
 * la borra). El nombre sigue existiendo en la fila -- es lo que se
 * MUESTRA en pantalla -- pero deja de usarse para decidir pertenencia.
 */
function esDeLaPersona(
  fila: { asignado_a_id: number | null; asignado_a2_id: number | null; sucursal_id: number | null },
  identidad: IdentidadSinRed,
): boolean {
  if (fila.asignado_a_id === null || fila.sucursal_id === null) return false;
  const deSuSucursal = identidad.sucursalId === null || fila.sucursal_id === identidad.sucursalId;
  return deSuSucursal && (fila.asignado_a_id === identidad.colaboradorId || fila.asignado_a2_id === identidad.colaboradorId);
}

/**
 * El `inventarioId` sin preguntarle al servidor — para cuando
 * `repositorioInventario.activo()` no puede responder (sin red: es HTTP
 * puro, sin caché local, ver contenedor.ts). Sin este fallback, Inicio,
 * Mis hojas y Contar dependían TODAS de esa respuesta para poder mostrar
 * cualquier cosa, aunque el avance completo ya estuviera acá adentro: el
 * operario sin señal veía un spinner infinito en vez de su trabajo.
 *
 * HALLAZGO (2026-09-06, min-1 en el emulador): `hojas_estructura` es una
 * tabla COMPARTIDA por TODO lo que se haya descargado alguna vez en ese
 * teléfono — un Coordinador que bajó `todas()` de su tienda, o un Contador
 * de OTRA sucursal que usó el mismo equipo, dejan filas ahí. La versión
 * vieja de esta función (`SELECT inventario_id FROM hojas_estructura LIMIT
 * 1`, sin `ORDER BY` ni condición) devolvía UNA fila cualquiera — en el
 * caso real, la de Bolívar, para un Contador de Luzuriaga. Ahora se
 * exige que la fila sea DE ESA PERSONA (`esDeLaPersona`, arriba): nunca
 * "cualquier inventario descargado", siempre "un inventario donde YO
 * tengo una hoja asignada". Sin sesión local, no hay de quién ser: `null`.
 *
 * Si la persona tiene hojas de más de un inventario (no debería pasar en
 * uso normal — un colaborador cuenta en uno a la vez — pero el teléfono
 * puede tener restos de un mes anterior), se queda con el de la hoja de
 * `numero_conteo` más alto: es la más probable de ser la actual.
 */
export async function inventarioIdSinRed(): Promise<number | null> {
  const identidad = await identidadSinRed();
  if (!identidad) return null;

  const db = await obtenerDb();
  const filas = await db.getAllAsync<{
    inventario_id: number;
    asignado_a_id: number | null;
    asignado_a2_id: number | null;
    sucursal_id: number | null;
    numero_conteo: number;
  }>('SELECT inventario_id, asignado_a_id, asignado_a2_id, sucursal_id, numero_conteo FROM hojas_estructura');
  const propias = filas.filter((f) => esDeLaPersona(f, identidad));
  if (propias.length === 0) return null;

  propias.sort((a, b) => b.numero_conteo - a.numero_conteo);
  return propias[0]!.inventario_id;
}

/**
 * La ronda activa SIN preguntarle al servidor — la compañera de
 * `inventarioIdSinRed` para el mismo caso (Contador contando sin señal, ver
 * su comentario). Es la ronda MÁS ALTA entre las hojas de ESA PERSONA en
 * este inventario (`max(numero_conteo)` acotado por `esDeLaPersona`) — NO
 * la más alta del inventario entero: si el Coordinador bajó `todas()` con
 * la ronda 1 y la 2 de la tienda, pero esta persona solo tiene hoja en la
 * 1 (la suya cuadró y no fue a recontar), su ronda activa sigue siendo la
 * 1, no la 2 de otro colaborador. `null` = nunca se descargó ninguna hoja
 * de este inventario asignada a esta persona. Con red manda
 * `activo().rondaActiva`; esto es el único dato que queda cuando no la hay.
 */
export async function rondaActivaSinRed(inventarioId: number): Promise<number | null> {
  const identidad = await identidadSinRed();
  if (!identidad) return null;

  const db = await obtenerDb();
  const filas = await db.getAllAsync<{
    numero_conteo: number;
    asignado_a_id: number | null;
    asignado_a2_id: number | null;
    sucursal_id: number | null;
  }>('SELECT numero_conteo, asignado_a_id, asignado_a2_id, sucursal_id FROM hojas_estructura WHERE inventario_id = ?', [
    inventarioId,
  ]);
  const rondas = filas.filter((f) => esDeLaPersona(f, identidad)).map((f) => f.numero_conteo);
  if (rondas.length === 0) return null;
  return Math.max(...rondas);
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
async function guardarEstructuraDeHoja(db: DbSqlite, hoja: HojaConteo, ronda: number): Promise<void> {
  // `ronda` viene de la descarga (qué ronda se pidió), no de `hoja`:
  // `HojaConteo` del dominio no lleva `numeroConteo` — la ronda es del
  // pedido, y el backend ya devolvió solo hojas de esa ronda.
  //
  // `sucursalId` sale de la sesión local ACTIVA en este instante — quien
  // dispara esta descarga es, necesariamente, quien está usando la app
  // ahora, así que su sucursal es la sucursal real de esta hoja (v6, ver
  // sqlite-esquema.ts). Sin sesión (no debería pasar: hace falta estar
  // logueado para llegar hasta acá) queda NULL, el mismo valor "no se
  // sabe" que ya tenían las filas de antes de v6.
  // `asignadoAId`/`asignadoA2Id` (v7) vienen de la hoja FRESCA que mandó
  // el backend (`hojas.service.ts#aHojaDto`) -- son la identidad dura,
  // ninguna sesión local hace falta para saberlos. `undefined` (una hoja
  // de un backend viejo, o el dataset de ejemplo) queda NULL, igual que
  // el resto de las columnas ADITIVAS.
  const identidad = await identidadSinRed();
  await db.runAsync(
    `INSERT INTO hojas_estructura (id, inventario_id, numero, zona, gondola, tamano, asignados, numero_conteo, sucursal_id, asignado_a_id, asignado_a2_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       inventario_id = excluded.inventario_id,
       numero = excluded.numero,
       zona = excluded.zona,
       gondola = excluded.gondola,
       tamano = excluded.tamano,
       asignados = excluded.asignados,
       numero_conteo = excluded.numero_conteo,
       sucursal_id = excluded.sucursal_id,
       asignado_a_id = excluded.asignado_a_id,
       asignado_a2_id = excluded.asignado_a2_id`,
    [
      hoja.id,
      hoja.inventarioId,
      hoja.numero,
      hoja.zona,
      hoja.gondola,
      hoja.tamano,
      JSON.stringify(hoja.asignados),
      ronda,
      identidad?.sucursalId ?? null,
      hoja.asignadoAId ?? null,
      hoja.asignadoA2Id ?? null,
    ],
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
 * HALLAZGO (2026-09-06, min-1): el Coordinador cerró rondas por script
 * contra el backend, y "Ciclo de conteos"/"Gestión de hojas" en su
 * teléfono siguieron diciendo "Quedan N hojas sin finalizar" — aun
 * reiniciando la app por completo. Causa: `asegurarSembrada` (arriba)
 * siembra `hoja_estado_local`/`conteos` UNA sola vez y nunca más los
 * toca — la protección correcta para un CONTADOR (nunca pisarle un
 * conteo propio sin sincronizar), pero un desastre para quien solo MIRA
 * `todas()` (Coordinador/Auditor): una vez que este dispositivo vio una
 * hoja ajena por primera vez, quedaba congelada en ESE estado para
 * siempre, sin importar cuántas veces se refrescara la estructura.
 *
 * `alcance === 'todas'` es de solo lectura para quien lo pide -- nunca
 * cuenta, nunca tiene un conteo propio que proteger acá -- así que esta
 * función SIEMPRE pisa con lo que acaba de responder el servidor. La
 * única excepción: si ESTE MISMO dispositivo tiene algo pendiente de
 * sincronizar para esa hoja (`cola_sync`), no se toca -- sería el caso
 * (fuera de lo normal, pero posible en un teléfono compartido entre
 * roles) de que la persona que mira `todas()` sea TAMBIÉN quien está
 * contando esa hoja sin haber podido subirla todavía.
 */
async function refrescarEstadoDesdeServidor(db: DbSqlite, hoja: HojaConteo): Promise<void> {
  const pendientes = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM cola_sync WHERE hoja_id = ?', [hoja.id]);
  if ((pendientes?.n ?? 0) > 0) return;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO hoja_estado_local (hoja_id, estado, sync) VALUES (?, ?, ?)
       ON CONFLICT(hoja_id) DO UPDATE SET estado = excluded.estado, sync = excluded.sync`,
      [hoja.id, hoja.estado, hoja.sync],
    );
    // Reemplaza los conteos ENTEROS de esta hoja por los que acaba de
    // mandar el servidor -- mismo criterio que ModalConteo.tsx ya usa
    // para un conteo individual (nunca mezcla lo viejo con lo nuevo).
    await db.runAsync('DELETE FROM conteos WHERE hoja_id = ?', [hoja.id]);
    for (const c of hoja.conteos) {
      await db.runAsync(
        'INSERT OR REPLACE INTO conteos (hoja_id, producto_id, lineas, sueltas, confirmado_por_escaner, contado_en) VALUES (?, ?, ?, ?, ?, ?)',
        [hoja.id, c.productoId, JSON.stringify(c.empaques), c.sueltas, c.confirmadoPorEscaner ? 1 : 0, c.contadoEn],
      );
    }
  });
}

/**
 * Lo que le hace falta a la pantalla para el mensaje del punto 4 — ver
 * mis-hojas.tsx. Cuatro motivos, no tres, porque "sin red desde el
 * arranque" y "la descarga se cortó a mitad de camino" piden acciones
 * DISTINTAS de quien cuenta: reconectarse a la WiFi de la tienda no
 * arregla una sesión vencida ni un 500 del backend, y "incompleta" es un
 * cuarto caso con su propia causa (el pedido al servidor SÍ funcionó, lo
 * que falló fue guardar alguna de las hojas ya bajadas) — confundirlo con
 * cualquiera de los otros tres es el mismo "N hojas sin explicación" que
 * reportó el cliente, con otra causa todavía.
 *
 * `hojas` en la rama `ok: false` es cuántas SÍ llegaron a guardarse antes
 * del corte (0 si el pedido al servidor ni siquiera respondió) — sin este
 * dato la pantalla no puede distinguir "no se guardó nada" de "se guardó
 * una parte", que es justo la diferencia entre reintentar desde cero o
 * seguir viendo lo que ya hay mientras se reintenta.
 *
 * `en` en la rama `ok: true` es CUÁNDO se completó esa descarga (ISO
 * 8601) — lo necesita la pantalla del Coordinador para decir "sin red,
 * datos de las 14:32" cuando la siguiente consulta falla por falta de
 * señal: sin este dato no hay forma de distinguir "esto es de hace un
 * minuto" de "esto es de la semana pasada".
 */
export type ResultadoDescarga =
  | { ok: true; hojas: number; en: string }
  | { ok: false; motivo: 'sin-red' | 'sesion-vencida' | 'error' | 'incompleta'; hojas: number };

const ultimosResultados = new Map<string, ResultadoDescarga>();

/**
 * CUÁNDO fue la última descarga que SÍ salió bien -- aparte de
 * `ultimosResultados`, que guarda el último INTENTO (éxito o no). Si se
 * guardara solo ahí, un intento fallido pisaría el resultado anterior y
 * "sin red, datos de las 14:32" perdería justo el dato que necesita
 * mostrar: la hora de la ÚLTIMA VEZ que hubo datos de verdad, no la del
 * último intento (que fue el que falló).
 */
const ultimasDescargasExitosas = new Map<string, string>();

function claveResultado(inventarioId: number, alcance: 'mias' | 'todas', ronda: number): string {
  // La ronda entra en la clave: "0 hojas" de la ronda 2 (todavía no
  // descargada) no es lo mismo que "0 hojas" de la ronda 1, y la pantalla
  // decide su mensaje según el último resultado de ESTA ronda.
  return `${inventarioId}:${alcance}:${ronda}`;
}

/**
 * Qué pasó la ÚLTIMA vez que se intentó bajar `alcance` para este
 * inventario. La pantalla lo usa para distinguir "0 hojas porque no hay
 * ninguna asignada todavía" de "0 hojas porque no hay señal y nunca se
 * pudo bajar nada" — son dos mensajes distintos, y confundirlos es
 * exactamente la pantalla vacía sin explicación que reportó el cliente.
 */
export function ultimaDescarga(inventarioId: number, alcance: 'mias' | 'todas', ronda: number): ResultadoDescarga | null {
  return ultimosResultados.get(claveResultado(inventarioId, alcance, ronda)) ?? null;
}

/**
 * CUÁNDO fue la última vez que `alcance` bajó datos de verdad para este
 * inventario -- sobrevive a un intento fallido posterior (ver el
 * comentario de `ultimasDescargasExitosas`). `null` = nunca se bajó nada
 * con éxito. Es lo que arma "sin red, datos de las 14:32" en la pantalla
 * del Coordinador (Ciclo de conteos / Gestión de hojas) cuando `todas()`
 * falla por falta de señal pero ya había datos de una vez anterior.
 */
export function ultimaDescargaExitosa(inventarioId: number, alcance: 'mias' | 'todas', ronda: number): string | null {
  return ultimasDescargasExitosas.get(claveResultado(inventarioId, alcance, ronda)) ?? null;
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
async function descargarHojas(inventarioId: number, alcance: 'mias' | 'todas', ronda: number): Promise<ResultadoDescarga> {
  let remotas: HojaConteo[];
  try {
    const respuesta = alcance === 'mias' ? await hojasApi.mias(inventarioId, ronda) : await hojasApi.todas(inventarioId, ronda);
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
    const resultado: ResultadoDescarga = { ok: false, motivo, hojas: 0 };
    ultimosResultados.set(claveResultado(inventarioId, alcance, ronda), resultado);
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
  //
  // Lo que SÍ hace falta es que un corte a mitad de esa lista (la app
  // muere, el disco se llena, cualquier falla de `guardarEstructuraDeHoja`
  // en la hoja K) no se cuele como una excepción sin atrapar hacia
  // `mias()`/`todas()` — eso dejaba a quien llama con una promesa que
  // nunca resuelve (el mismo spinner infinito de f558689, en un lugar
  // nuevo) Y, todavía peor, sin marca ninguna: las K-1 hojas que sí se
  // guardaron (cada una en su propia transacción, ya confirmadas en
  // disco) quedaban ahí SIN que `ultimaDescarga` se enterara del corte —
  // la próxima lectura las mostraba como si fueran el total, sin ningún
  // aviso de que la descarga real pedía K hojas y se cortó en la mitad.
  const db = await obtenerDb();
  let guardadas = 0;
  try {
    for (const hoja of completas) {
      await guardarEstructuraDeHoja(db, hoja, ronda);
      // Solo para `todas()` (Coordinador/Auditor, solo lectura): refresca
      // el estado/conteos locales con la respuesta FRESCA del servidor.
      // `mias()` no pasa por acá -- `asegurarSembrada` (adentro de
      // guardarEstructuraDeHoja) ya protege el trabajo propio del
      // Contador, sembrando una sola vez, y eso es lo correcto ahí.
      if (alcance === 'todas') await refrescarEstadoDesdeServidor(db, hoja);
      guardadas++;
    }
  } catch {
    const resultado: ResultadoDescarga = { ok: false, motivo: 'incompleta', hojas: guardadas };
    ultimosResultados.set(claveResultado(inventarioId, alcance, ronda), resultado);
    return resultado;
  }

  const ahora = new Date().toISOString();
  const resultado: ResultadoDescarga = { ok: true, hojas: completas.length, en: ahora };
  ultimosResultados.set(claveResultado(inventarioId, alcance, ronda), resultado);
  ultimasDescargasExitosas.set(claveResultado(inventarioId, alcance, ronda), ahora);
  return resultado;
}

/**
 * Dispara la descarga y decide si HAY que esperarla:
 *  - `mias()` (Contador) con estructura local ya presente → se muestra YA
 *    (no hace esperar un timeout de red para terminar mostrando lo mismo
 *    que ya había); la descarga corre en segundo plano para refrescar.
 *    Sin nada local todavía, sí vale la pena esperar el intento (es el
 *    caso "primera vez, con WiFi, en la tienda" del punto 1).
 *  - `todas()` (Coordinador/Auditor) SIEMPRE espera el intento, tenga o
 *    no estructura local. Es de solo lectura y la razón de ser de la
 *    pantalla es ver el estado REAL de lo que hicieron los demás — la
 *    optimización de "mostrar la cache ya y refrescar en segundo plano"
 *    es correcta para el Contador (que solo necesita ver SU propio
 *    avance sin esperar), pero acá dejaba "Quedan N hojas sin finalizar"
 *    clavado para siempre (hallazgo 2026-09-06, min-1): la promesa de
 *    fondo terminaba de escribir en SQLite, pero nada volvía a pintar la
 *    pantalla con eso, así que la MISMA lectura vieja se repetía en cada
 *    visita, cada reinicio, indefinidamente. Sin red, `descargarHojas`
 *    falla rápido (timeout de `_http.ts`, no un cuelgue) y esta función
 *    sigue con lo local — la pantalla lo distingue con `ultimaDescarga`.
 */
async function descargarSiHaceFalta(inventarioId: number, alcance: 'mias' | 'todas', ronda: number): Promise<void> {
  if (alcance === 'todas') {
    await descargarHojas(inventarioId, alcance, ronda);
    return;
  }

  const db = await obtenerDb();
  const yaHayLocal = (await hojasEstructuraDeInventarioDb(db, inventarioId, ronda)).length > 0;

  if (yaHayLocal) {
    void descargarHojas(inventarioId, alcance, ronda);
    return;
  }
  await descargarHojas(inventarioId, alcance, ronda);
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

/**
 * "Es mía" a nivel del objeto de dominio ya reconstruido (`mias`/
 * `porNumero`, después de leer `hojas_estructura` o caer al mock) —
 * mismo criterio que `esDeLaPersona` (más arriba, que opera sobre la fila
 * cruda): el id manda si `HojaConteo` lo trae (`!== undefined`, v7 en
 * adelante — un `null` real, "el backend contestó y no hay segundo
 * asignado", sí tiene que poder decidir "no, no es esta").
 *
 * Sin esos ids (`undefined` en las dos), el criterio depende de `origen`:
 *   - `'mock'` (`_compartido.ts`, el dataset de ejemplo): NUNCA tuvo ids
 *     que dar y no es un dato real bajado de ningún backend — el nombre
 *     sigue siendo, como siempre fue, el único criterio que existe ahí.
 *   - `'real'` (vino de `hojas_estructura`): es una fila VIEJA, de antes
 *     de que el backend mandara los ids. NO es de nadie por nombre —
 *     ver el comentario de `esDeLaPersona` sobre por qué ese fallback fue
 *     el bug de "hojas cruzadas sin red" (2026-09-06).
 */
function esAsignadaA(hoja: HojaConteo, identidad: IdentidadSinRed, origen: 'real' | 'mock'): boolean {
  if (hoja.asignadoAId !== undefined || hoja.asignadoA2Id !== undefined) {
    return hoja.asignadoAId === identidad.colaboradorId || hoja.asignadoA2Id === identidad.colaboradorId;
  }
  if (origen === 'real') return false;
  return hoja.asignados.includes(identidad.nombre);
}

/**
 * UN PARÁMETRO AUSENTE NUNCA AMPLÍA EL RESULTADO.
 *
 * `inventarioId`/`ronda` están tipados como `number`, pero llegan de
 * `activo()` (que devuelve `rondaActiva: null` cuando el inventario está en
 * `conteo_cerrado`) y de `inventarioIdSinRed()`/`rondaActivaSinRed()`, que
 * devuelven `null` cuando no hay nada local. El tipo dice `number`; lo que
 * corre en el teléfono puede ser `null`.
 *
 * Hoy las pantallas cortan antes (mis-hojas.tsx:105, InicioScreen.tsx:183),
 * pero esa defensa vive en QUIEN LLAMA. Sin esta guarda, un `null` que se
 * cuele por un camino nuevo dispara `hojasApi.mias(inv, null)` -- una
 * descarga con la ronda inválida, cuyo resultado depende de cómo el servidor
 * interprete el parámetro roto (el schema tiene `.default(1)`, así que
 * omitirlo trae la ronda 1 en silencio) y que SE GUARDA en la tabla local,
 * quedando disponible para todo lo que lea después.
 *
 * "No sé qué ronda" no puede convertirse en "traé lo que haya": la única
 * respuesta honesta es vacío.
 */
function sinAlcance(inventarioId: number | null | undefined, ronda: number | null | undefined): boolean {
  return typeof inventarioId !== 'number' || typeof ronda !== 'number';
}

export const hojasSqlite: RepositorioHojas = {
  async mias(inventarioId, ronda) {
    if (sinAlcance(inventarioId, ronda)) return [];
    // La descarga que faltaba (bug real): antes de leer nada, se le
    // pregunta al backend. Ver `descargarSiHaceFalta` para cuándo se
    // espera esa respuesta y cuándo se muestra lo local sin esperar.
    await descargarSiHaceFalta(inventarioId, 'mias', ronda);

    const { hojas, origen } = await hojasDeInventarioBase(inventarioId, ronda);

    // SIEMPRE filtrar por el colaborador de la sesión — pase lo que pase con
    // el `origen`. `hojas_estructura` es una tabla COMPARTIDA del teléfono: si
    // el Coordinador bajó `todas` en este MISMO equipo, las hojas de TODOS los
    // contadores del inventario quedaron ahí. Confiar en "origen real = ya vino
    // filtrado del servidor" era EL BUG (min-5): un Contador veía —y podía
    // CONTAR— hojas ajenas, rompiendo el reparto y la asistencia deducida de
    // "hoja asignada con conteos" (ef44a2d). "Mía" es "estoy en sus asignados"
    // (por id, ver `esAsignadaA` — sin id, una fila `real` no es de nadie),
    // nunca "está en el cache del teléfono". Sin sesión no se sabe de quién
    // son las hojas: se devuelve vacío, jamás todas.
    const identidad = await identidadSinRed();
    if (!identidad) return [];
    const propias = hojas.filter((hoja) => esAsignadaA(hoja, identidad, origen));
    return hojasConEstadoLocal(propias);
  },

  async todas(inventarioId, ronda) {
    if (sinAlcance(inventarioId, ronda)) return [];
    await descargarSiHaceFalta(inventarioId, 'todas', ronda);
    const { hojas } = await hojasDeInventarioBase(inventarioId, ronda);
    return hojasConEstadoLocal(hojas);
  },

  async porNumero(inventarioId, numero, ronda) {
    if (sinAlcance(inventarioId, ronda)) return null;
    // `porNumero` lo usa `contar.tsx` para reabrir UNA hoja (siempre después
    // de pasar por `mias()`), así que alcanza con refrescar el mismo alcance.
    await descargarSiHaceFalta(inventarioId, 'mias', ronda);
    const { hojas, origen } = await hojasDeInventarioBase(inventarioId, ronda);

    // Misma regla de propiedad que `mias`: una hoja solo es abrible por el
    // Contador si está entre SUS asignados (por id, ver `esAsignadaA`). Sin
    // esto, entrar por ?numero=011 a una hoja de otro (deep link, o el
    // param a mano) esquiva el filtro de la lista y deja contar una hoja
    // ajena. "No es tuya" y "no existe" son lo mismo acá: null — y
    // contar.tsx ya muestra el EmptyState de "hoja no encontrada".
    const identidad = await identidadSinRed();
    if (!identidad) return null;
    const hojaBase = hojas.find((h) => h.numero === numero && esAsignadaA(h, identidad, origen));
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
      // `razon = NULL`: un conteo NUEVO del mismo producto es un intento
      // fresco — la razón del rechazo anterior (si lo hubo) ya no aplica a
      // este dato, y dejarla quedaría mostrando un motivo viejo para un
      // envío que todavía ni se intentó.
      await db.runAsync(
        `INSERT INTO cola_sync (hoja_id, tipo, producto_id, creado_en, intentos, estado)
         VALUES (?, 'conteo', ?, ?, 0, 'pendiente')
         ON CONFLICT(hoja_id, tipo, producto_id)
         DO UPDATE SET creado_en = excluded.creado_en, intentos = 0, estado = 'pendiente', razon = NULL`,
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

    // DECISIÓN DEL CLIENTE (2026-09-05): al finalizar, un renglón SIN CONTAR
    // no queda en "faltan N" — se registra un Conteo en 0 explícito ("si no
    // hay el producto, es 0"). Espeja hojas.service.ts#finalizar del backend.
    // Cada 0 se ENCOLA como un conteo más (no solo se escribe local): así,
    // sin red, la cola manda primero los 0 y recién después el finalizar
    // (procesarColaDeSincronizacion retiene 'finalizar' mientras la hoja
    // tenga items 'conteo'), y el servidor nunca ve un conteo tardío sobre
    // una hoja ya finalizada. Es la afirmación de quien finaliza ("miré, no
    // hay"), no el cero automático que dominio/ciclo-conteos.ts prohíbe para
    // lo que NADIE miró.
    const ahora = new Date().toISOString();
    const contados = new Set(actual.conteos.map((c) => c.productoId));
    const ceros: Conteo[] = actual.productos
      .filter((p) => !contados.has(p.id))
      .map((p) => ({ productoId: p.id, empaques: [], sueltas: 0, confirmadoPorEscaner: false, contadoEn: ahora }));

    const db = await obtenerDb();
    await db.withTransactionAsync(async () => {
      // Los 0 primero, con el MISMO INSERT OR REPLACE + cola 'conteo' que
      // guardarConteo: así el envío y la dedup por (hoja, tipo, producto)
      // funcionan igual que un conteo cargado a mano.
      for (const cero of ceros) {
        await db.runAsync(
          'INSERT OR REPLACE INTO conteos (hoja_id, producto_id, lineas, sueltas, confirmado_por_escaner, contado_en) VALUES (?, ?, ?, ?, ?, ?)',
          [hojaId, cero.productoId, '[]', 0, 0, ahora],
        );
        await db.runAsync(
          `INSERT INTO cola_sync (hoja_id, tipo, producto_id, creado_en, intentos, estado)
           VALUES (?, 'conteo', ?, ?, 0, 'pendiente')
           ON CONFLICT(hoja_id, tipo, producto_id)
           DO UPDATE SET creado_en = excluded.creado_en, intentos = 0, estado = 'pendiente', razon = NULL`,
          [hojaId, cero.productoId, ahora],
        );
      }
      await db.runAsync('UPDATE hoja_estado_local SET estado = ?, sync = ? WHERE hoja_id = ?', ['finalizada', 'local', hojaId]);
      await db.runAsync(
        `INSERT INTO cola_sync (hoja_id, tipo, producto_id, creado_en, intentos, estado)
         VALUES (?, 'finalizar', 0, ?, 0, 'pendiente')
         ON CONFLICT(hoja_id, tipo, producto_id)
         DO UPDATE SET creado_en = excluded.creado_en, intentos = 0, estado = 'pendiente', razon = NULL`,
        [hojaId, ahora],
      );
    });

    // sync: 'local', NO 'sincronizado' — finalizar también es una
    // escritura que tiene que llegar al servidor. Decir "sincronizado"
    // acá sería la misma promesa incumplida que este adaptador existe
    // para dejar de hacer. Los ceros se devuelven en la hoja para que la
    // pantalla muestre el avance completo (N/N) sin volver a leer.
    return { ...finalizada, conteos: [...finalizada.conteos, ...ceros], sync: 'local' };
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
  /**
   * La razón del rechazo MÁS RECIENTE entre los items en error -- `null`
   * si ninguno está en error, o si los que están en error son todos
   * `sin-red` (ahí no hay "razón del servidor": hay falta de señal, y ese
   * mensaje lo arma `sincronizador.ts` aparte). La pantalla la usa para
   * decir POR QUÉ en vez de "revisá la conexión" cuando el problema real
   * es un rechazo del servidor (ver BandaSync.tsx).
   */
  razonRechazo: string | null;
}

/** Lo que necesita `sincronizador.ts` para armar `EstadoCola` (puertos/repositorios.ts) -- cuenta TODA la cola, no una hoja sola. */
export async function estadoDeLaCola(): Promise<EstadoColaCruda> {
  const db = await obtenerDb();
  const filas = await db.getAllAsync<{ estado: string }>('SELECT estado FROM cola_sync');
  const masReciente = await db.getFirstAsync<{ razon: string | null }>(
    "SELECT razon FROM cola_sync WHERE estado = 'error' AND razon IS NOT NULL ORDER BY id DESC LIMIT 1",
  );
  return {
    pendientes: filas.length,
    enError: filas.filter((f) => f.estado === 'error').length,
    razonRechazo: masReciente?.razon ?? null,
  };
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
 *
 * DECISIÓN DEL CLIENTE (2026-09-05, honestidad del estado, no regla de
 * negocio): una hoja NO puede declararse finalizada ante el servidor
 * mientras tenga conteos que el servidor no aceptó. Antes, un `finalizar`
 * más adelante en la cola se mandaba igual aunque el `conteo` de la MISMA
 * hoja que iba justo antes hubiera quedado rechazado (`hojas.service.ts
 * #finalizar` no consulta productos/conteos para decidir) — el servidor
 * terminaba creyendo la hoja completa cuando le faltaba un renglón, y
 * `rondas.service.ts#cerrar` (que sólo mira `estado`/`sync` de la hoja,
 * nunca sus productos) podía cerrar la ronda sin que nada avisara del
 * hueco. Por eso, antes de mandar un `finalizar`, se comprueba que no
 * quede ningún `conteo` de esa misma hoja todavía en la cola (pendiente O
 * rechazado — cualquiera de los dos significa "el servidor todavía no lo
 * tiene") — si queda alguno, el `finalizar` NO se manda: se deja
 * `pendiente` para reintentar en la próxima pasada, cuando (si) se
 * resuelva.
 */
export async function procesarColaDeSincronizacion(enviar: EnviarItemCola): Promise<void> {
  const db = await obtenerDb();
  const filas = await db.getAllAsync<FilaCola>("SELECT * FROM cola_sync WHERE estado != 'enviando'");
  const items = ordenarCola(filas.map(filaAItemCola));

  for (const item of items) {
    let seEnvia = true;
    if (item.tipo === 'finalizar') {
      const conteosSinResolver = await db.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) as n FROM cola_sync WHERE hoja_id = ? AND tipo = 'conteo'",
        [item.hojaId],
      );
      seEnvia = (conteosSinResolver?.n ?? 0) === 0;
    }

    if (seEnvia) {
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
        await db.runAsync('UPDATE cola_sync SET estado = ?, intentos = ?, razon = ? WHERE id = ?', [
          siguiente.estado,
          siguiente.intentos,
          siguiente.razon ?? null,
          item.id,
        ]);
      }
    }

    // El sync de la hoja se recalcula de lo que le queda pendiente EN LA
    // COLA, nunca se pisa a mano aparte — así nunca se desincroniza de
    // la cola real (mismo criterio que sqlite-cola.ts#estadoSyncDeHoja).
    // Se recalcula IGUAL cuando `seEnvia` es false: un finalizar bloqueado
    // no cambia nada en la cola, pero el conteo que lo está bloqueando ya
    // pudo haber sido tocado antes en esta misma pasada.
    const restantes = await db.getAllAsync<FilaCola>('SELECT * FROM cola_sync WHERE hoja_id = ?', [item.hojaId]);
    const nuevoSync = estadoSyncDeHoja(restantes.map(filaAItemCola));
    await db.runAsync('UPDATE hoja_estado_local SET sync = ? WHERE hoja_id = ?', [nuevoSync, item.hojaId]);
  }
}
