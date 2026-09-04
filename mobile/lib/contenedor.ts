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
 * Qué puertos salen a la red. UNA sola perilla, y por una razón concreta:
 * el backend no aparece de golpe entero, aparece módulo por módulo. Hoy
 * `/api/sesion` existe y el resto no. Una bandera booleana global obligaría
 * a elegir entre "todo en memoria" (y no probar nunca el backend) o "todo
 * HTTP" (y romper cinco pantallas contra endpoints que no existen).
 *
 * Valores:
 *   - vacío / sin definir  → TODO en memoria. Es el default a propósito:
 *     se puede demostrar la app completa sin levantar nada.
 *   - `*`                  → todos los puertos que tengan adaptador HTTP.
 *   - lista separada por comas → solo esos. Ej: `sesion` hoy;
 *     `sesion,hojas,catalogo` cuando el backend sirva hojas.
 *
 * Se configura con `EXPO_PUBLIC_PUERTOS_HTTP` (variable de entorno, no
 * requiere tocar app.config.ts) o con `extra.puertosHttp`.
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
  const desdeEntorno = entorno?.EXPO_PUBLIC_PUERTOS_HTTP;
  if (desdeEntorno !== undefined) return desdeEntorno;

  const Constants = require('expo-constants').default as {
    expoConfig?: { extra?: Record<string, unknown> };
  };
  return (Constants.expoConfig?.extra?.puertosHttp as string | undefined) ?? '';
}

const configurados = leerConfiguracion()
  .split(',')
  .map((nombre) => nombre.trim().toLowerCase())
  .filter(Boolean);

const TODOS = configurados.includes('*');
const seleccionados = new Set(configurados);

/**
 * Devuelve la implementación que corresponde. El tipo obliga a que ambas
 * cumplan el MISMO puerto — es lo que garantiza que cambiar la bandera no
 * pueda romper una pantalla: si un adaptador HTTP se desviara del contrato,
 * esto no compila.
 */
function elegir<T>(puerto: PuertoConectable, memoria: T, api: T): T {
  return TODOS || seleccionados.has(puerto) ? api : memoria;
}

// ---------------------------------------------------------------------------
// Los puertos
// ---------------------------------------------------------------------------

/**
 * ── Puertos con endpoint REAL, contrastado contra el código del backend ──
 *
 * Los 4 routers están montados en backend/src/config/app.ts y las rutas de
 * cada adaptador se leyeron de su `*.routes.ts`, no de un README.
 *
 * Que el contrato esté verificado NO quiere decir que respondan: sin
 * `backend/.env` no hay base, y sin base el backend no arranca. Por eso el
 * default sigue siendo memoria (ver la bandera arriba).
 */
export const repositorioSesion: RepositorioSesion = elegir('sesion', sesionMemoria, sesionApi);
export const repositorioUsuarios: RepositorioUsuarios = elegir('usuarios', usuariosMemoria, usuariosApi);
export const repositorioTiendas: RepositorioTiendas = elegir('tiendas', tiendasMemoria, tiendasApi);
export const repositorioConfig: RepositorioConfig = elegir('config', configMemoria, configApi);

/**
 * ── Puertos con contrato ADIVINADO ──
 *
 * ⚠️ El backend no tiene módulos de hojas, catálogo ni inventario: esas
 * rutas están DEDUCIDAS de la convención de los otros cuatro. Encenderlas
 * hoy da 404, no datos. Ver la cabecera de hojas-api.ts.
 *
 * `hojas` además tiene una tercera variante que las demás no tienen,
 * sqlite (ver la tarea de persistencia offline, 2026-09-03): los conteos
 * NO pueden vivir solo en RAM — un operario en el fondo del depósito,
 * sin señal, pierde 40 ítems contados si la app se cierra. `elegir()`
 * sigue siendo memoria/api; acá se decide aparte cuál de las dos es el
 * lado "memoria" que le llega, porque hay una tercera opción.
 *
 * DEFAULT: sqlite. Es lo que el negocio necesita — un conteo que no
 * sobrevive un cierre de la app no es un detalle técnico, es la promesa
 * que la banda de sincronización ("guardado en el equipo") le hace al
 * operario y hoy no cumplía. Escape hatch a la versión pura en memoria
 * (debug, o si sqlite da problemas puntuales en un dispositivo):
 * `EXPO_PUBLIC_HOJAS_MEMORIA=1`.
 */
const hojasLocal: RepositorioHojas = entorno?.EXPO_PUBLIC_HOJAS_MEMORIA === '1' ? hojasMemoria : hojasSqlite;
export const repositorioHojas: RepositorioHojas = elegir('hojas', hojasLocal, hojasApi);
export const repositorioCatalogo: RepositorioCatalogo = elegir('catalogo', catalogoMemoria, catalogoApi);
export const repositorioInventario: RepositorioInventario = elegir('inventario', inventarioMemoria, inventarioApi);

/**
 * Sin adaptador HTTP todavía: auditoría, liquidación y lacrado dependen de
 * la comparación contra Dynamics y del cierre de mes, que son fase 2. Se
 * quedan en memoria hasta que haya endpoints — no se les inventa una ruta
 * para emparejar con los demás.
 */
export const repositorioAuditoria: RepositorioAuditoria = auditoriaMemoria;
export const repositorioLiquidacion: RepositorioLiquidacion = liquidacionMemoria;
export const repositorioLacrado: RepositorioLacrado = lacradoMemoria;
