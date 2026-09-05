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
import { configDynamicsApi } from './adaptadores/config-dynamics-api';
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
 * ── CATÁLOGO: CONECTADO, como el resto ──
 *
 * ⚠️ ESTE PUERTO ESTUVO SIRVIENDO UN CATÁLOGO DE MENTIRA EN EL APK REAL.
 *
 * Usaba `elegirHttp`, o sea: memoria por defecto y HTTP solo con
 * `EXPO_PUBLIC_PUERTOS_HTTP=catalogo`. En el APK no hay NINGUNA
 * `EXPO_PUBLIC_PUERTOS_*`, así que el escáner de Contar buscaba los códigos
 * de barras en el dataset de demo — encontrando productos que no están en la
 * góndola y no encontrando los que sí. Un escáner que responde con datos de
 * otro catálogo es peor que uno que no responde: el segundo se nota.
 *
 * Los dos motivos que justificaban dejarlo en memoria ya no son ciertos:
 *
 *  1. "el módulo que CREA hojas no existe" — existe:
 *     `inventarios.service.ts#crearHojas`, `POST /api/inventarios/:id/hojas`.
 *     Verificado el 2026-09-05 creando 20 hojas de 50 desde la app.
 *  2. "el catálogo tiene que salir de la MISMA fuente que la hoja" — se
 *     cumple, y al revés de como estaba escrito: la hoja BAJA del servidor
 *     (`hojasApi` por la cola de `hojas-sqlite.ts`), así que el `hojaId` que
 *     tiene la pantalla es el del servidor. Es el catálogo en memoria el que
 *     rompía la coherencia, no al revés.
 *
 * Ahora usa `elegir` como los demás: HTTP por defecto, memoria SOLO con
 * `EXPO_PUBLIC_PUERTOS_MEMORIA=catalogo`.
 *
 * PENDIENTE, y no es de este archivo: `porCodigoBarras` pega contra el
 * servidor, así que en el fondo del almacén —sin señal— el escáner queda sin
 * respuesta. La hoja ya está local con todos sus productos, así que la
 * búsqueda por código podría resolverse offline sin pedirle nada a nadie;
 * eso es una decisión de la pantalla de Contar, no del selector.
 */
export const repositorioCatalogo: RepositorioCatalogo = elegir('catalogo', catalogoMemoria, catalogoApi);

/**
 * ── INVENTARIO: CONECTADO ──
 *
 * Los 4 metodos del puerto existen en el backend y estan probados:
 *   traerSnapshot → POST /api/d365/snapshot                    ✅
 *   crearHojas    → POST /api/inventarios/:id/hojas            ✅
 *   asignarHojas  → POST /api/inventarios/:id/hojas/asignar    ✅
 *   activo        → GET  /api/sucursales/:id/inventarios/activo ✅
 *
 * Hasta hoy los tres ultimos daban 404 y el wizard del Coordinador corria
 * contra memoria: se creaban hojas, se repartian, se cerraba la app y no
 * quedaba nada. Ese era el bloqueante para probar el flujo con datos reales.
 *
 * Sigue pasando por `elegir` y no por un import directo: `TODO_A_MEMORIA`
 * tiene que poder devolverlo al mock para desarrollar sin backend.
 */
export const repositorioInventario: RepositorioInventario = elegir('inventario', inventarioMemoria, inventarioApi);

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
 * ── CREDENCIALES DE DYNAMICS: HTTP, y de SOLO LECTURA ──
 *
 * `/api/config-dynamics` existe y este adaptador lo usa: `GET /` para el
 * estado y `POST /probar` para validar contra Azure AD sin bajar los 8.000
 * ítems del catálogo.
 *
 * Lo que la app NO puede hacer es ESCRIBIRLAS. El backend expone un `PUT`,
 * pero el puerto no lo declara y el adaptador no lo llama: las credenciales
 * se cargan en el servidor con `npm run config:dynamics` desde backend/.
 * Tipear un `client_secret` de Azure —40+ caracteres sin sentido— en el
 * teclado de un teléfono produce un error que después se diagnostica como
 * "la integración no anda", porque Azure responde 401 sin decir cuál de los
 * cuatro campos está mal.
 *
 * El secreto nunca viaja de vuelta: el backend no lo devuelve en ninguna
 * respuesta, ni siquiera enmascarado. Lo único que llega es el booleano
 * `secretoConfigurado`.
 */
export const repositorioConfigDynamics: RepositorioConfigDynamics = elegir(
  'config-dynamics',
  configDynamicsMemoria,
  configDynamicsApi,
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
