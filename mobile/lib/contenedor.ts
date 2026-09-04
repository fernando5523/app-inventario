/**
 * Punto ÚNICO donde se elige la implementación concreta de cada puerto.
 *
 * Las pantallas importan de acá, nunca de un adaptador directo — así,
 * enchufar el backend real es cambiar ESTE archivo, no tocar la pantalla.
 * Si alguna vez hay que editar una pantalla para cambiar de memoria a HTTP,
 * algo se rompió en la arquitectura y hay que arreglarlo acá, no allá.
 */

import type {
  RepositorioAuditoria,
  RepositorioCatalogo,
  RepositorioConfig,
  RepositorioConfigDynamics,
  RepositorioHistorial,
  RepositorioHojas,
  RepositorioInventario,
  RepositorioLacrado,
  RepositorioLiquidacion,
  RepositorioSesion,
  RepositorioTiendas,
  RepositorioUsuarios,
  Sincronizador,
} from './puertos/repositorios';

import { auditoriaMemoria } from './adaptadores/auditoria-memoria';
import { catalogoMemoria } from './adaptadores/catalogo-memoria';
import { configDynamicsMemoria } from './adaptadores/config-dynamics-memoria';
import { configMemoria } from './adaptadores/config-memoria';
import { hojasMemoria } from './adaptadores/hojas-memoria';
import { hojasSqlite } from './adaptadores/hojas-sqlite';
import { inventarioMemoria } from './adaptadores/inventario-memoria';
import { lacradoMemoria } from './adaptadores/lacrado-memoria';
import { liquidacionMemoria } from './adaptadores/liquidacion-memoria';
import { sesionMemoria } from './adaptadores/sesion-memoria';
import { sincronizadorReal } from './adaptadores/sincronizador';
import { tiendasMemoria } from './adaptadores/tiendas-memoria';
import { usuariosMemoria } from './adaptadores/usuarios-memoria';

import { catalogoApi } from './adaptadores/catalogo-api';
import { configApi } from './adaptadores/config-api';
import { historialApi } from './adaptadores/historial-api';
import { hojasApi } from './adaptadores/hojas-api';
import { lacradoApi } from './adaptadores/lacrado-api';
import { liquidacionApi } from './adaptadores/liquidacion-api';
import { auditoriaApi } from './adaptadores/auditoria-api';
import { inventarioApi } from './adaptadores/inventario-api';
import { sesionApi } from './adaptadores/sesion-api';
import { tiendasApi } from './adaptadores/tiendas-api';
import { usuariosApi } from './adaptadores/usuarios-api';

// ---------------------------------------------------------------------------
// La bandera
// ---------------------------------------------------------------------------

/**
 * Desde 2026-09-04 el backend está VIVO contra Postgres, así que el default
 * se invirtió: los puertos verificados contra el servidor real salen a la
 * red, y la perilla sirve para volver a memoria, no para salir de ella.
 *
 * `EXPO_PUBLIC_PUERTOS_MEMORIA`:
 *   - vacío / sin definir  → cada puerto usa lo que dice este archivo.
 *   - `*`                  → TODO a memoria. Para demostrar sin backend.
 *   - lista separada por comas → solo esos vuelven a memoria.
 *     Ej: `sesion` para probar el login sin servidor.
 *
 * Sigue sin requerir tocar app.config.ts (ver _http.ts#urlBase).
 */
const entorno = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

/** Los puertos que HOY tienen una implementación HTTP escrita. */
type PuertoConectable =
  | 'sesion'
  | 'hojas'
  | 'catalogo'
  | 'inventario'
  | 'usuarios'
  | 'tiendas'
  | 'config'
  | 'auditoria'
  | 'liquidacion'
  | 'lacrado'
  | 'config-dynamics';

function leerConfiguracion(): string {
  // `require` en vez de `import` para no arrastrar expo-constants al grafo de
  // módulos cuando la variable de entorno ya resolvió: este archivo lo
  // importa TODA pantalla, y es el primero que se evalúa al arrancar.
  const desdeEntorno = entorno?.EXPO_PUBLIC_PUERTOS_MEMORIA;
  if (desdeEntorno !== undefined) return desdeEntorno;

  const Constants = require('expo-constants').default as {
    expoConfig?: { extra?: Record<string, unknown> };
  };
  return (Constants.expoConfig?.extra?.puertosMemoria as string | undefined) ?? '';
}

const forzados = leerConfiguracion()
  .split(',')
  .map((nombre) => nombre.trim().toLowerCase())
  .filter(Boolean);

const TODO_A_MEMORIA = forzados.includes('*');
const aMemoria = new Set(forzados);

/**
 * Devuelve la implementación que corresponde. El tipo obliga a que ambas
 * cumplan el MISMO puerto — es lo que garantiza que cambiar la bandera no
 * pueda romper una pantalla: si un adaptador HTTP se desviara del contrato,
 * esto no compila.
 */
/**
 * Inverso de `elegir`: para los puertos cuyo default es LOCAL por una razón
 * de negocio (no por falta de endpoint). Hay que pedir HTTP explícitamente
 * con `EXPO_PUBLIC_PUERTOS_HTTP`, en vez de tener que acordarse de excluirlo.
 */
const pedidosHttp = new Set(
  (entorno?.EXPO_PUBLIC_PUERTOS_HTTP ?? '')
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean),
);

function elegirHttp<T>(puerto: PuertoConectable, local: T, api: T): T {
  return pedidosHttp.has(puerto) ? api : local;
}

function elegir<T>(puerto: PuertoConectable, memoria: T, api: T): T {
  return TODO_A_MEMORIA || aMemoria.has(puerto) ? memoria : api;
}

/**
 * Placeholders EXPLICITOS para los puertos cuyo endpoint todavia no existe.
 *
 * Apuntan al adaptador en memoria a proposito: asi `elegir()` compila y todos
 * los repositorios pasan por el selector, que es lo que evita que un puerto
 * quede clavado y nadie lo conecte el dia que aparece su endpoint (le paso a
 * `auditoria`). El nombre dice lo que son: cuando exista el endpoint, se
 * reemplaza esta linea por el adaptador HTTP de verdad.
 */
const configDynamicsApiPendiente = configDynamicsMemoria;

// ---------------------------------------------------------------------------
// Los puertos
// ---------------------------------------------------------------------------

/**
 * ── CONTRA EL BACKEND REAL ──
 *
 * Los cuatro se probaron con curl contra http://localhost:3000 el
 * 2026-09-04, con la base sembrada: login de un colaborador real (argon2
 * contra Postgres), listados de usuarios/tiendas/config. La forma que
 * devuelve el servidor coincide con la que estos adaptadores esperan —
 * incluidos los `null` de `direccion`/`sucursalId`, que se normalizan a
 * ausente en el adaptador (ver usuarios-api.ts, tiendas-api.ts).
 */
export const repositorioSesion: RepositorioSesion = elegir('sesion', sesionMemoria, sesionApi);
export const repositorioUsuarios: RepositorioUsuarios = elegir('usuarios', usuariosMemoria, usuariosApi);
export const repositorioTiendas: RepositorioTiendas = elegir('tiendas', tiendasMemoria, tiendasApi);
export const repositorioConfig: RepositorioConfig = elegir('config', configMemoria, configApi);

/**
 * ── HOJAS: LOCAL + COLA, y NO se toca ──
 *
 * SQLite no es "memoria pendiente de migrar": es la persistencia que el
 * negocio necesita. Los equipos cuentan con la WiFi de la tienda y SIN chip,
 * y en el fondo del almacén no hay señal. Un `hojasApi` puro dejaría al
 * operario sin poder contar cada vez que se cae el WiFi — que es la mitad de
 * la jornada.
 *
 * La hoja se guarda local y se sincroniza contra `/api/hojas` por la cola
 * (hojas-sqlite.ts#procesarColaDeSincronizacion). `hojasApi` NO se enchufa
 * acá: lo usa la cola, no la pantalla.
 *
 * Igual pasa por el selector, como todos: que la razon de negocio sea fuerte
 * no justifica clavarlo. `EXPO_PUBLIC_PUERTOS_HTTP=hojas` fuerza HTTP puro
 * (util para probar el endpoint sin la cola de por medio, NUNCA en la
 * tienda), y `EXPO_PUBLIC_HOJAS_MEMORIA=1` elige cual es el lado local:
 * memoria en vez de SQLite, para depurar.
 */
const hojasLocal: RepositorioHojas = entorno?.EXPO_PUBLIC_HOJAS_MEMORIA === '1' ? hojasMemoria : hojasSqlite;
export const repositorioHojas: RepositorioHojas = elegirHttp('hojas', hojasLocal, hojasApi);

/**
 * ── CATÁLOGO: pasa por el selector, pero por DEFECTO local ──
 *
 * El endpoint existe y está probado (`GET /api/hojas/:id/productos` devuelve
 * `empaques: [...]` con la forma exacta del dominio). Lo que NO se puede hoy
 * es enchufarlo, y la razón es de coherencia, no de contrato:
 *
 * el catálogo tiene que salir de la MISMA fuente que la hoja. `hojas` viene
 * de SQLite, con el dataset local (hoja #002, 50 productos). Si el catálogo
 * viniera del backend, la pantalla abriría la hoja #002 de SQLite y le
 * pediría al servidor los productos de una hoja que el servidor no tiene:
 * 404, hoja abierta y vacía, con el operario parado frente a la góndola.
 *
 * Se mueve junto con `hojas`, no por separado — y `hojas` solo puede salir
 * del backend cuando exista el módulo que CREA hojas (paso 2 del
 * Coordinador), que hoy no existe.
 *
 * Ya no está clavado: `EXPO_PUBLIC_PUERTOS_HTTP=catalogo` lo enchufa el día
 * que las hojas vengan del servidor.
 */
export const repositorioCatalogo: RepositorioCatalogo = elegirHttp('catalogo', catalogoMemoria, catalogoApi);

/**
 * ── INVENTARIO: por el selector, pero resuelve a memoria ──
 *
 * Estuvo clavado y no debio estarlo: la razon de negocio no cambia que TIENE
 * que poder cambiarse por configuracion (ver la nota de `elegir` arriba).
 *
 * De los 4 metodos del puerto, el backend hoy tiene UNO:
 *   traerSnapshot → POST /api/d365/snapshot   ✅ probado contra Postgres
 *   crearHojas    → 404, `/api/inventarios` no esta montado
 *   asignarHojas  → 404
 *   activo        → 404
 *
 * Enchufarlo haria que el paso 1 del Coordinador cree un inventario REAL y
 * que los pasos 2 y 3 fallen contra el: quedaria un inventario a medio armar
 * en la base y un wizard que arranca y no termina. Por eso el default sigue
 * siendo memoria — pero ahora se puede forzar con
 * `EXPO_PUBLIC_PUERTOS_HTTP=inventario` para probar el snapshot solo.
 */
export const repositorioInventario: RepositorioInventario = elegirHttp('inventario', inventarioMemoria, inventarioApi);

/**
 * ── AUDITORÍA: CONECTADA ──
 *
 * `GET /api/auditoria/inventarios/:id/matriz` existe y esta probado contra el
 * backend real: devuelve los campos de `ItemAuditoria` tal cual. Era la
 * ultima pantalla con datos inventados.
 */
export const repositorioAuditoria: RepositorioAuditoria = elegir('auditoria', auditoriaMemoria, auditoriaApi);

/**
 * ── LIQUIDACIÓN: contra el backend real ──
 *
 * `GET /api/liquidacion/sucursales/:sucursalId` existe desde el commit
 * 21c34c5 y se verificó con curl el 2026-09-04: devuelve los 9 campos de
 * `Liquidacion` con la forma exacta del puerto, y `200` con body `null`
 * cuando la sucursal todavía no cerró ningún ciclo.
 *
 * Es un endpoint DISTINTO de `GET /api/historial/inventarios/:id/liquidacion`
 * y las dos rutas tienen razón de existir: aquella pide un `inventarioId` y
 * sirve para mirar un mes del archivo; esta responde "cómo quedó el último
 * cierre de ESTA tienda", que es lo único que la pantalla 6 sabe preguntar.
 */
export const repositorioLiquidacion: RepositorioLiquidacion = elegir('liquidacion', liquidacionMemoria, liquidacionApi);

/**
 * ── LACRADO: contra el backend real ──
 *
 * El GET que faltaba ya existe: `GET .../lacrado/estado` devuelve
 * `EstadoLacrado` entero, incluidos `aprobacionesRequeridas` (que viaja en la
 * respuesta en vez de estar clavado acá: el día que sean tres, la pantalla se
 * entera sola) y `todoSincronizado`, el que decide si el botón de lacrar se
 * habilita — no se lacra con hojas que todavía no llegaron al servidor.
 *
 * La regla del control de dos personas la sostiene el servidor, verificado
 * contra la base real: quien firma sale del TOKEN, la misma persona no puede
 * completar el par (409) y mandar un `aprobadorId` en el body es 400.
 */
export const repositorioLacrado: RepositorioLacrado = elegir('lacrado', lacradoMemoria, lacradoApi);

/**
 * ── CREDENCIALES DE DYNAMICS: en memoria, y por ahora está bien ──
 *
 * No hay `config-dynamics-api.ts` todavía: el backend guarda las
 * credenciales de Dynamics en su propio `.env`, no las expone por HTTP (y
 * un endpoint que devuelva un client secret es exactamente lo que esta
 * pantalla promete que nunca va a existir).
 *
 * Igual sale de acá y no de un import directo en la pantalla: el día que
 * haya endpoint, se cambia esta línea. Una pantalla que importa un
 * adaptador concreto es una pantalla que hay que editar para cambiar de
 * implementación, que es justo lo que este archivo existe para evitar.
 */
/**
 * ── CONFIG-DYNAMICS: sin endpoint ──
 *
 * `/api/d365` expone solo `GET /estado` (`{configurado}`) y `POST /snapshot`.
 * El puerto pide `obtener`, `guardar` y `probarConexion`: no hay donde
 * GUARDAR credenciales ni donde probarlas sin bajar los 8.000 items.
 */
export const repositorioConfigDynamics: RepositorioConfigDynamics = elegir(
  'config-dynamics',
  configDynamicsMemoria,
  configDynamicsApiPendiente,
);

/**
 * ── HISTÓRICO: solo HTTP, sin variante en memoria ──
 *
 * No hay `historial-memoria.ts` y es deliberado: el histórico es el registro
 * de lo que YA pasó, y un mock que invente inventarios cerrados con sus
 * firmas es exactamente el dato que nadie debería poder fabricar. Sin
 * backend, la pantalla avisa que no pudo cargar — nunca muestra un histórico
 * de mentira, que frente al cliente sería peor que una pantalla vacía.
 *
 * Por eso tampoco pasa por `elegir()`: no hay a qué caer.
 */
export const repositorioHistorial: RepositorioHistorial = historialApi;

/**
 * ── SINCRONIZADOR: el disparador de la cola de hojas ──
 *
 * No pasa por `elegir()`: no hay una variante "en memoria" que tenga
 * sentido — siempre vacía la MISMA cola SQLite (`hojas-sqlite.ts`) contra
 * la MISMA red real (`hojasApi`), pase lo que pase con la bandera de los
 * demás puertos. `iniciarSincronizador()` se llama UNA vez desde
 * app/_layout.tsx (ver ese archivo) para arrancar los disparadores
 * automáticos (red + primer plano); las pantallas solo importan
 * `sincronizador` para leer `estado()`/`suscribir()` y para el botón
 * manual de la banda de sincronización.
 */
export const sincronizador: Sincronizador = sincronizadorReal;
export { iniciarSincronizador } from './adaptadores/sincronizador';
