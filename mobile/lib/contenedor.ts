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
  RepositorioHojas,
  RepositorioInventario,
  RepositorioLacrado,
  RepositorioLiquidacion,
  RepositorioSesion,
  RepositorioTiendas,
  RepositorioUsuarios,
} from './puertos/repositorios';

import { auditoriaMemoria } from './adaptadores/auditoria-memoria';
import { catalogoMemoria } from './adaptadores/catalogo-memoria';
import { configMemoria } from './adaptadores/config-memoria';
import { hojasMemoria } from './adaptadores/hojas-memoria';
import { hojasSqlite } from './adaptadores/hojas-sqlite';
import { inventarioMemoria } from './adaptadores/inventario-memoria';
import { lacradoMemoria } from './adaptadores/lacrado-memoria';
import { liquidacionMemoria } from './adaptadores/liquidacion-memoria';
import { sesionMemoria } from './adaptadores/sesion-memoria';
import { tiendasMemoria } from './adaptadores/tiendas-memoria';
import { usuariosMemoria } from './adaptadores/usuarios-memoria';

import { catalogoApi } from './adaptadores/catalogo-api';
import { configApi } from './adaptadores/config-api';
import { hojasApi } from './adaptadores/hojas-api';
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
  | 'config';

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
function elegir<T>(puerto: PuertoConectable, memoria: T, api: T): T {
  return TODO_A_MEMORIA || aMemoria.has(puerto) ? memoria : api;
}

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
 * Escape hatch a la versión pura en memoria (debug): `EXPO_PUBLIC_HOJAS_MEMORIA=1`.
 */
export const repositorioHojas: RepositorioHojas =
  entorno?.EXPO_PUBLIC_HOJAS_MEMORIA === '1' ? hojasMemoria : hojasSqlite;

/**
 * ── CATÁLOGO: local, por COHERENCIA con hojas ──
 *
 * El endpoint `/api/hojas/:id/productos` existe y está bien, pero el
 * catálogo tiene que salir de la MISMA fuente que la hoja. Si la hoja viene
 * de SQLite y los productos del backend, se le estarían pidiendo al servidor
 * los productos de una hoja que el servidor no tiene: 404 en la pantalla de
 * conteo, con la hoja abierta y vacía.
 *
 * Se mueve junto con `hojas`, no por separado.
 */
export const repositorioCatalogo: RepositorioCatalogo = catalogoMemoria;

/**
 * ── INVENTARIO: en memoria, y NO es olvido ──
 *
 * De los 4 métodos del puerto, el backend hoy solo tiene uno:
 *   traerSnapshot → POST /api/d365/snapshot   ✅ probado, devuelve un
 *                                                inventario real de Postgres
 *   crearHojas    → 404, no existe el módulo
 *   asignarHojas  → 404, no existe el módulo
 *   activo        → 404, no existe el módulo
 *
 * Enchufar `inventarioApi` haría que el paso 1 del Coordinador cree un
 * inventario REAL en Postgres y que los pasos 2 y 3 fallen contra él. Peor
 * que memoria pura: quedaría un inventario a medio armar en la base, y la
 * pantalla mostraría un wizard que arranca y no termina.
 *
 * Cuando exista el módulo de inventario (crear/asignar hojas), esta línea
 * pasa a `elegir('inventario', inventarioMemoria, inventarioApi)` y nada más
 * cambia — el adaptador HTTP ya está escrito y su snapshot ya está probado.
 */
export const repositorioInventario: RepositorioInventario = inventarioMemoria;

/**
 * ── SIN ENDPOINT: auditoría, liquidación y lacrado del lado del conteo ──
 *
 * `/api/auditoria` no existe (404 verificado). La matriz ERP vs los 3
 * conteos depende de comparar contra Dynamics, que es fase 2. Liquidación y
 * lacrado tienen módulo `historial` en el backend, pero sus puertos todavía
 * no se cablearon acá.
 */
export const repositorioAuditoria: RepositorioAuditoria = auditoriaMemoria;
export const repositorioLiquidacion: RepositorioLiquidacion = liquidacionMemoria;
export const repositorioLacrado: RepositorioLacrado = lacradoMemoria;
