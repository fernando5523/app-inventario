/**
 * Cliente HTTP compartido por TODOS los adaptadores `*-api.ts`.
 *
 * Existe por una razón concreta del negocio, no por prolijidad: los equipos
 * cuentan con la WiFi de la tienda y SIN chip. En el fondo del almacén y en
 * las cámaras de frío la señal se cae, y "sin red" no es un error raro — es
 * el estado NORMAL. Si cada adaptador resolviera por su cuenta timeout /
 * 401 / sin-red, tendríamos siete versiones del mismo problema y seis
 * estarían mal (la misma razón por la que existen los puertos, ver
 * puertos/repositorios.ts).
 *
 * Cuatro garantías que este archivo le debe a las pantallas:
 *
 *   1. NUNCA escapa una excepción cruda de red. Todo lo que sale de acá es
 *      un `ErrorApi` con una `clase` que la pantalla puede leer y un
 *      `message` en castellano que se le puede mostrar a un operario.
 *   2. NUNCA queda un spinner colgado. Todo pedido tiene timeout, y los
 *      reintentos tienen un presupuesto TOTAL que no se puede pasar.
 *   3. NUNCA se reintenta sola una escritura. Ver "Reintentos" más abajo.
 *   4. La URL base sale de configuración, jamás hardcodeada en un adaptador.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// URL base — configuración, nunca hardcode
// ---------------------------------------------------------------------------

/**
 * `process` no existe como global tipado en React Native, pero el plugin de
 * Babel que inlinea `EXPO_PUBLIC_*` en tiempo de build necesita ver el
 * patrón LITERAL `process.env.NOMBRE` en el AST -- exacto, sin indirección.
 *
 * BUG REAL que tuvo esta función: guardar `process.env` en una variable
 * (`const entorno = (globalThis as {...}).process?.env`) y leer
 * `entorno?.EXPO_PUBLIC_API_URL` le esconde el literal al plugin, que nunca
 * lo reemplaza. Y en el bundle de producción `globalThis.process` no existe
 * (no hay polyfill de Node ahí), así que el valor leído en runtime SIEMPRE
 * era `undefined` -- la función caía al fallback de desarrollo pase lo que
 * pase, sin ningún error visible. Nadie lo notó hasta que se compiló para un
 * teléfono físico con una IP distinta del fallback del emulador: el cliente
 * instaló el APK y se quedó sin datos (ver mobile/README.md, "APK para un
 * TELEFONO FISICO"). Contra el emulador el bug quedaba tapado porque el
 * fallback (`10.0.2.2`) es justo lo que hace falta ahí.
 *
 * La función accede `process.env.EXPO_PUBLIC_API_URL` DIRECTO más abajo — el
 * cast a `any` es solo para que TypeScript no se queje de que `process` no
 * está tipado; en el JS emitido no deja rastro, así que Babel sigue viendo
 * el literal que necesita para inlinearlo.
 */
declare const process: any;

/**
 * Fallback SOLO de desarrollo. En el emulador de Android `localhost` es el
 * teléfono, no la máquina que corre el backend: por eso 10.0.2.2, que es el
 * alias que el emulador reserva para el host.
 *
 * OJO: en un teléfono FÍSICO en la WiFi de la tienda ninguno de los dos
 * sirve — ahí hay que setear `EXPO_PUBLIC_API_URL` con la IP real del
 * servidor. Por eso `urlBase()` avisa por consola cuando cae acá.
 */
const URL_DESARROLLO = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

let avisoUrlEmitido = false;

/**
 * Orden de resolución, del más específico al más general:
 *
 *   1. `EXPO_PUBLIC_API_URL` — variable de entorno. No requiere tocar
 *      app.config.ts, sirve para apuntar un APK a otra IP sin recompilar
 *      la configuración a mano.
 *   2. `extra.apiUrl` de app.config.ts — el lugar canónico cuando el
 *      backend tenga una URL fija de despliegue.
 *   3. Fallback de desarrollo, con aviso.
 *
 * Se normaliza la barra final para que `${base}/api/sesion` no termine
 * generando `//api/sesion` según cómo la haya escrito quien configuró.
 */
export function urlBase(): string {
  const configurada: string | undefined =
    process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined);

  if (configurada) return configurada.replace(/\/+$/, '');

  if (!avisoUrlEmitido) {
    avisoUrlEmitido = true;
    console.warn(
      [
        `[http] Sin EXPO_PUBLIC_API_URL ni extra.apiUrl: usando ${URL_DESARROLLO}.`,
        '  Eso es el alias del EMULADOR hacia su máquina. En un TELÉFONO FÍSICO no lleva',
        '  a ningún lado: la app abre y queda sin datos, sin decir por qué.',
        '  Al compilar el APK: EXPO_PUBLIC_API_URL=http://<IP-de-la-máquina>:3000',
        '  (ver mobile/README.md, "APK para un TELEFONO FISICO").',
      ].join('\n'),
    );
  }
  return URL_DESARROLLO;
}

// ---------------------------------------------------------------------------
// Errores tipados
// ---------------------------------------------------------------------------

/**
 * Cada clase existe porque le corresponde un mensaje DISTINTO en pantalla y,
 * varias, una reacción distinta del código. No es una taxonomía decorativa:
 *
 *   - `sin-red` / `timeout`    → la banda de sincronización, no un cartel rojo.
 *   - `sesion-vencida`         → mandar al login.
 *   - `credenciales-invalidas` → quedarse en el login y limpiar el PIN.
 *   - `sin-permiso`            → la pantalla no se debería haber podido abrir.
 *   - `demasiados-intentos`    → decir cuánto esperar, no "reintentá".
 *   - `validacion`             → mostrar el mensaje del servidor tal cual.
 *   - `servidor`               → reintentable, no es culpa de quien cuenta.
 */
export type ClaseErrorApi =
  | 'sin-red'
  | 'timeout'
  | 'cancelado'
  | 'credenciales-invalidas'
  | 'sesion-vencida'
  | 'sin-permiso'
  | 'no-encontrado'
  | 'conflicto'
  | 'demasiados-intentos'
  | 'validacion'
  | 'servidor'
  | 'respuesta-invalida';

/**
 * Mensajes por defecto. Se usan solo si el backend no mandó uno mejor.
 *
 * `sin-red` y `timeout` están redactados a propósito para que NO suenen a
 * que se rompió algo: no se rompió nada, no hay WiFi. La persona que lee
 * esto está parada en una cámara de frío con un teléfono en la mano — un
 * "Error de conexión" en rojo la hace pensar que perdió el conteo.
 */
const MENSAJE_POR_CLASE: Record<ClaseErrorApi, string> = {
  'sin-red': 'Sin señal en este sector. Seguí contando: nada se pierde.',
  timeout: 'La red de la tienda está lenta y el pedido no llegó a completarse.',
  cancelado: 'La operación se canceló.',
  'credenciales-invalidas': 'PIN incorrecto.',
  'sesion-vencida': 'Tu sesión venció. Ingresá de nuevo con tu PIN.',
  'sin-permiso': 'Tu rol no tiene permiso para esta operación.',
  'no-encontrado': 'No se encontró lo que buscabas.',
  conflicto: 'Ese registro ya existe.',
  'demasiados-intentos': 'Demasiados intentos. Esperá unos minutos antes de volver a probar.',
  validacion: 'Los datos enviados no son válidos.',
  servidor: 'El servidor tuvo un problema. Volvé a intentar en un momento.',
  'respuesta-invalida': 'El servidor respondió algo que no se pudo interpretar.',
};

/**
 * Las únicas clases donde el dato es correcto y lo que falló es el CAMINO.
 * Un 401 o un 400 reintentados dan exactamente lo mismo — reintentarlos es
 * quemar batería y tiempo del operario.
 *
 * `demasiados-intentos` (429) queda AFUERA a propósito: el servidor está
 * pidiendo explícitamente que bajemos el ritmo. Reintentar un 429 es hacer
 * lo contrario de lo que el servidor pidió.
 */
const REINTENTABLES: ReadonlySet<ClaseErrorApi> = new Set<ClaseErrorApi>(['sin-red', 'timeout', 'servidor']);

export class ErrorApi extends Error {
  readonly clase: ClaseErrorApi;
  /** Código HTTP, o null cuando el pedido nunca llegó a tener respuesta. */
  readonly estado: number | null;
  /** Cuerpo crudo del error, si el backend mandó detalles (ej. `flatten()` de zod). */
  readonly detalles: unknown;
  /**
   * Si el problema es el camino y no el dato. NO significa "esto ya se
   * reintentó": significa "a esto tendría sentido volver a intentarlo".
   * Lo lee la cola de sincronización para decidir si reencola o descarta.
   */
  readonly reintentable: boolean;
  /** Cuántos intentos se hicieron de verdad. 1 = no hubo reintento. */
  readonly intentos: number;
  /**
   * El mensaje CRUDO del backend, siempre, aunque no se muestre.
   *
   * Existe porque `message` y "lo que dijo el servidor" no son lo mismo: en
   * un 5xx `message` se reemplaza por un texto genérico a propósito (el del
   * servidor puede traer un stack o el nombre de una tabla). Pero un
   * adaptador a veces NECESITA ese texto para decidir — el 502 de
   * `/api/d365/snapshot` significa "Azure rechazó las credenciales" o
   * "Dynamics falló", y hoy solo el mensaje los distingue.
   *
   * Regla: `message` es para la persona, `mensajeServidor` es para el código.
   * Nunca mostrar este en pantalla sin filtrar.
   */
  readonly mensajeServidor: string | null;

  constructor(
    clase: ClaseErrorApi,
    opciones: {
      mensaje?: string;
      estado?: number | null;
      detalles?: unknown;
      intentos?: number;
      mensajeServidor?: string | null;
    } = {},
  ) {
    super(opciones.mensaje ?? MENSAJE_POR_CLASE[clase]);
    this.name = 'ErrorApi';
    this.clase = clase;
    this.estado = opciones.estado ?? null;
    this.detalles = opciones.detalles;
    this.reintentable = REINTENTABLES.has(clase);
    this.intentos = opciones.intentos ?? 1;
    this.mensajeServidor = opciones.mensajeServidor ?? opciones.mensaje ?? null;
  }
}

/**
 * Guard para las pantallas: `catch (e)` en TypeScript es `unknown`, así que
 * sin esto no hay forma de leer `.clase` sin un cast a mano en cada pantalla.
 */
export function esErrorApi(error: unknown): error is ErrorApi {
  return error instanceof ErrorApi;
}

/**
 * "¿Esto es porque no hay red?" — la pregunta que más veces se va a hacer
 * una pantalla. Agrupa las dos clases que significan lo mismo para quien
 * está contando: no llegaste al servidor, y no fue culpa tuya.
 */
export function esFallaDeRed(error: unknown): boolean {
  return esErrorApi(error) && (error.clase === 'sin-red' || error.clase === 'timeout');
}

// ---------------------------------------------------------------------------
// Token de sesión
// ---------------------------------------------------------------------------

/**
 * El token lo emite `RepositorioSesion.ingresar()` y lo necesitan TODOS los
 * demás adaptadores. Este archivo no puede importar `sesion-api.ts` (sería
 * circular: ese importa este), así que la dependencia se invierte —
 * `sesion-api.ts` empuja el token acá.
 *
 * `lectorPersistido` cubre el arranque en frío: la app se abre de nuevo, no
 * hay nada en memoria, pero la sesión sigue viva en SQLite. Es una función
 * y no un valor porque leer SQLite es asíncrono y no se puede hacer al
 * importar el módulo.
 */
let tokenEnMemoria: string | null = null;
let lectorPersistido: (() => Promise<string | null>) | null = null;

export function recordarToken(token: string | null): void {
  tokenEnMemoria = token;
}

export function registrarLectorDeToken(leer: () => Promise<string | null>): void {
  lectorPersistido = leer;
}

async function tokenActual(): Promise<string | null> {
  if (tokenEnMemoria) return tokenEnMemoria;
  if (!lectorPersistido) return null;
  tokenEnMemoria = await lectorPersistido();
  return tokenEnMemoria;
}

// ---------------------------------------------------------------------------
// Reintentos
// ---------------------------------------------------------------------------

/**
 * REGLA: se reintentan solo las LECTURAS.
 *
 * GET y HEAD son seguros por definición de HTTP: no cambian nada del lado
 * del servidor, así que repetirlos no puede duplicar un conteo ni crear dos
 * usuarios. Todo lo demás — POST, PATCH, PUT, DELETE — sale con UN solo
 * intento salvo que quien llama declare `idempotente: true`.
 *
 * Por qué tan conservador con las escrituras: cuando un POST falla con
 * `sin-red`, NO sabemos si el servidor llegó a procesarlo. El pedido pudo
 * haber llegado, haberse guardado, y haberse cortado la respuesta de vuelta.
 * Reintentar ahí es exactamente cómo se duplica un conteo — y en un
 * inventario que se cruza contra Dynamics, un conteo duplicado es una
 * diferencia que alguien va a tener que explicar a fin de mes.
 *
 * Y una división de responsabilidades que importa: los reintentos de
 * ESCRITURA son de la cola de sincronización (`Sincronizador`, ver
 * puertos/repositorios.ts), no de este archivo. La cola sabe qué se guardó
 * localmente y puede reintentar contra un endpoint idempotente con la
 * identidad del recurso en la mano. Este archivo no sabe nada de eso. Dos
 * capas reintentando lo mismo es peor que una sola: los reintentos se
 * multiplican y nadie entiende cuántas veces salió el pedido de verdad.
 *
 * (Por eso `hojas-api.ts#guardarConteo` NO pasa `idempotente: true` aunque
 * su PUT lo sea: es escritura, y de sus reintentos se ocupa la cola.)
 */
const METODOS_SEGUROS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/** 3 intentos: el original más dos. Con 4 ya se nota la espera y no mejora. */
const INTENTOS_LECTURA = 3;

/** Primera espera antes de reintentar. Crece exponencialmente desde acá. */
const BACKOFF_BASE_MS = 300;

/** Techo del backoff: nunca esperar más de esto entre dos intentos. */
const BACKOFF_TECHO_MS = 3_000;

/**
 * Espera con "full jitter": un valor al azar entre 0 y el techo exponencial,
 * NO el techo exacto.
 *
 * No es un refinamiento teórico. Son 8 personas contando con 8 teléfonos en
 * la misma WiFi. Cuando el equipo sale de la cámara de frío y todos
 * recuperan señal en el mismo segundo, un backoff fijo los hace reintentar
 * a coro: 8 pedidos simultáneos, otra vez a los 300ms, otra vez a los 600.
 * El jitter los desparrama.
 */
function esperaDeReintento(intentoFallido: number): number {
  const techo = Math.min(BACKOFF_BASE_MS * 2 ** (intentoFallido - 1), BACKOFF_TECHO_MS);
  return Math.random() * techo;
}

/** Espera cancelable. Sin esto, un `senal.abort()` durante el backoff no se nota. */
function dormir(ms: number, senal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolver) => {
    const terminar = () => {
      clearTimeout(reloj);
      senal?.removeEventListener('abort', terminar);
      resolver();
    };
    const reloj = setTimeout(terminar, ms);
    senal?.addEventListener('abort', terminar);
  });
}

// ---------------------------------------------------------------------------
// El pedido
// ---------------------------------------------------------------------------

/**
 * 15s por intento. No es un número mágico: es el techo de lo que un operario
 * parado frente a la góndola tolera antes de dar por muerta la app. Más
 * corto corta pedidos legítimos en una WiFi saturada; más largo es un
 * spinner eterno.
 */
export const TIMEOUT_MS = 15_000;

export interface OpcionesPedido {
  metodo?: 'GET' | 'HEAD' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Se serializa a JSON. `undefined` = sin cuerpo. */
  cuerpo?: unknown;
  /**
   * Marca las rutas que NO requieren sesión (login, padrón de sucursales).
   * Cambia cómo se lee un 401: en una ruta pública significa "PIN
   * incorrecto", no "tu sesión venció" — y mandar al login a alguien que YA
   * está en el login es un bucle.
   */
  sinSesion?: boolean;
  /** Para cancelar desde la pantalla (ej. al desmontarse). */
  senal?: AbortSignal;
  /** Timeout de CADA intento. */
  msTimeout?: number;
  /**
   * Techo de tiempo de TODA la operación, reintentos y esperas incluidos.
   * Es la garantía dura contra el spinner infinito: sin esto, 3 intentos de
   * 15s más backoff son 45+ segundos mirando girar una rueda.
   * Default: el doble del timeout de un intento.
   */
  msPresupuesto?: number;
  /**
   * Declara que repetir este pedido NO tiene efecto extra del lado del
   * servidor. Habilita reintentos en un método que no es GET/HEAD.
   * Usar SOLO con endpoints idempotentes de verdad (un PUT sobre una
   * identidad concreta). Ante la duda: no ponerlo.
   */
  idempotente?: boolean;
  /** Máximo de intentos. Pisa el default (3 en lecturas, 1 en escrituras). */
  intentos?: number;
}

interface CuerpoError {
  error?: string;
  detalles?: unknown;
}

function clasificarPorEstado(estado: number, sinSesion: boolean): ClaseErrorApi {
  if (estado === 401) return sinSesion ? 'credenciales-invalidas' : 'sesion-vencida';
  if (estado === 403) return 'sin-permiso';
  if (estado === 404) return 'no-encontrado';
  // 409 aparte de `validacion` porque la pantalla reacciona distinto: el
  // formulario NO está mal (backend/README.md lo usa para "ya existe un
  // colaborador con ese DNI en esa sucursal"). Lo que corresponde ahí es
  // señalar el campo DNI y ofrecer reactivar la cuenta existente — no
  // decirle a quien carga que revise todo el formulario.
  if (estado === 409) return 'conflicto';
  if (estado === 429) return 'demasiados-intentos';
  if (estado >= 500) return 'servidor';
  if (estado >= 400) return 'validacion';
  // 3xx sin seguir, o un 2xx que llegó acá por error de quien llama.
  return 'respuesta-invalida';
}

/** UN intento. Toda la traducción de fallas a `ErrorApi` vive acá. */
async function intentarUnaVez<T>(
  ruta: string,
  opciones: OpcionesPedido,
  msTimeoutEfectivo: number,
): Promise<T> {
  const { metodo = 'GET', cuerpo, sinSesion = false, senal } = opciones;

  const encabezados: Record<string, string> = { Accept: 'application/json' };
  if (cuerpo !== undefined) encabezados['Content-Type'] = 'application/json';

  if (!sinSesion) {
    // `tokenActual()` puede tocar SQLite (lector persistido de sesion-api.ts)
    // y SQLite puede fallar: base bloqueada, disco lleno, archivo corrupto.
    // Sin este catch, ese error saldría CRUDO hacia la pantalla y rompería
    // la garantía #1 del módulo. Se trata como sesión no disponible, que es
    // lo que efectivamente pasó desde el punto de vista de quien llama.
    // (No hay timer que limpiar todavía: el reloj arranca más abajo, recién
    // cuando se va a hacer el fetch.)
    let token: string | null = null;
    try {
      token = await tokenActual();
    } catch {
      throw new ErrorApi('sesion-vencida');
    }
    // Sin token igual se manda: el backend responde 401 y eso se traduce a
    // `sesion-vencida`, que es exactamente lo que pasó. Fallar acá con un
    // error propio duplicaría la lógica de "qué es una sesión válida".
    if (token) encabezados.Authorization = `Bearer ${token}`;
  }

  /**
   * `AbortController` es lo único que corta un fetch colgado — sin esto, un
   * backend que aceptó la conexión y nunca contesta deja el spinner girando
   * hasta que la persona mate la app.
   */
  const control = new AbortController();
  let vencioPorTimeout = false;
  const reloj = setTimeout(() => {
    vencioPorTimeout = true;
    control.abort();
  }, msTimeoutEfectivo);

  // La cancelación de quien llama se reenvía al mismo controller, para no
  // tener dos señales compitiendo por el mismo fetch.
  //
  // OJO con el orden: entre que empieza este intento y que se registra el
  // listener hay un `await tokenActual()` que puede leer SQLite. Si la
  // pantalla se desmonta JUSTO ahí, el abort ya pasó y el listener se
  // suscribe a un evento que nunca va a volver a dispararse — el pedido
  // saldría igual y quedaría colgado hasta el timeout, sin nadie esperándolo.
  // Por eso se chequea `aborted` a los dos lados del registro.
  const cancelarExterno = () => control.abort();
  if (senal?.aborted) {
    clearTimeout(reloj);
    throw new ErrorApi('cancelado');
  }
  senal?.addEventListener('abort', cancelarExterno);
  if (senal?.aborted) control.abort();

  let respuesta: Response;
  try {
    respuesta = await fetch(`${urlBase()}${ruta}`, {
      method: metodo,
      headers: encabezados,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: control.signal,
    });
  } catch {
    // fetch tira lo mismo (TypeError / AbortError) para DNS caído, WiFi sin
    // salida, servidor apagado y abort. La única distinción que importa acá
    // la sabemos nosotros por las banderas, no por el error.
    // El orden importa: si quien llama canceló, eso gana sobre el timeout.
    if (senal?.aborted) throw new ErrorApi('cancelado');
    if (vencioPorTimeout) throw new ErrorApi('timeout');
    throw new ErrorApi('sin-red');
  } finally {
    clearTimeout(reloj);
    senal?.removeEventListener('abort', cancelarExterno);
  }

  if (!respuesta.ok) {
    const clase = clasificarPorEstado(respuesta.status, sinSesion);
    // El backend (error.middleware.ts) ya escribe mensajes en castellano y
    // pensados para el operario ("PIN incorrecto.", "Demasiados intentos de
    // ingreso..."). Se prefieren SIEMPRE al genérico: son más específicos y
    // están más cerca del caso real.
    let mensaje: string | undefined;
    let detalles: unknown;
    try {
      const cuerpoError = (await respuesta.json()) as CuerpoError;
      if (typeof cuerpoError?.error === 'string' && cuerpoError.error.trim()) mensaje = cuerpoError.error;
      detalles = cuerpoError?.detalles;
    } catch {
      // Un 502 de un proxy devuelve HTML, no JSON. No es un caso raro: queda
      // el mensaje por clase, que para eso está.
    }

    // Un 500 con mensaje del servidor NO se muestra crudo: puede traer un
    // stack o el nombre de una tabla. Para el resto, el mensaje del backend
    // es información útil para quien está parado frente a la góndola.
    throw new ErrorApi(clase, {
      mensaje: clase === 'servidor' ? undefined : mensaje,
      // El crudo se conserva SIEMPRE, aunque no se muestre: es lo unico que
      // distingue dos 5xx con significados distintos (ver mensajeServidor).
      mensajeServidor: mensaje ?? null,
      estado: respuesta.status,
      detalles,
    });
  }

  // 204 (y cualquier respuesta vacía) no tiene JSON que parsear: `.json()`
  // tiraría. Los métodos de puerto que devuelven void terminan acá.
  if (respuesta.status === 204) return undefined as T;

  const texto = await respuesta.text();
  if (!texto) return undefined as T;

  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new ErrorApi('respuesta-invalida', { estado: respuesta.status });
  }
}

/**
 * Hace el pedido y devuelve el JSON ya tipado. Reintenta solo lecturas
 * (ver "Reintentos" arriba) y nunca supera `msPresupuesto` en total.
 *
 * `ruta` es relativa a la URL base e incluye el prefijo del módulo:
 * `/api/sesion/sucursales`. Se resuelve contra `urlBase()` en cada intento
 * (no en una constante de módulo) para que cambiar la configuración no
 * obligue a reiniciar la app.
 */
export async function pedir<T>(ruta: string, opciones: OpcionesPedido = {}): Promise<T> {
  const {
    metodo = 'GET',
    senal,
    msTimeout = TIMEOUT_MS,
    msPresupuesto = msTimeout * 2,
    idempotente = false,
  } = opciones;

  const sePuedeRepetir = METODOS_SEGUROS.has(metodo) || idempotente;
  const maxIntentos = Math.max(1, opciones.intentos ?? (sePuedeRepetir ? INTENTOS_LECTURA : 1));

  const comienzo = Date.now();
  const restante = () => msPresupuesto - (Date.now() - comienzo);

  let ultimoError: ErrorApi = new ErrorApi('timeout');
  let intentosHechos = 0;

  for (let intento = 1; intento <= maxIntentos; intento++) {
    if (senal?.aborted) throw new ErrorApi('cancelado', { intentos: intentosHechos });

    // Ningún intento puede pasarse del presupuesto: el último arranca con lo
    // que quede, aunque sea menos que el timeout nominal. El PRIMER intento
    // sale igual — un presupuesto mal configurado no puede terminar en un
    // error inventado sin haber tocado la red ni una vez.
    const disponible = restante();
    if (disponible <= 0 && intento > 1) break;

    intentosHechos = intento;
    try {
      return await intentarUnaVez<T>(ruta, opciones, Math.max(1, Math.min(msTimeout, disponible)));
    } catch (error) {
      // `intentarUnaVez` solo tira ErrorApi. Si apareciera otra cosa es un
      // bug nuestro, y se traduce igual antes de que llegue a una pantalla.
      ultimoError = error instanceof ErrorApi ? error : new ErrorApi('sin-red');

      const esUltimo = intento === maxIntentos;
      if (!ultimoError.reintentable || esUltimo || ultimoError.clase === 'cancelado') break;

      const espera = esperaDeReintento(intento);
      // No dormir si al despertar ya no queda tiempo para intentar de nuevo:
      // sería regalar segundos de spinner para terminar en el mismo error.
      if (espera >= restante()) break;
      await dormir(espera, senal);
    }
  }

  // Se re-lanza con la cuenta REAL de intentos (no el máximo permitido),
  // para que la cola de sincronización y los logs sepan cuánto se insistió
  // de verdad. Un 401 que cortó en el primer intento reporta 1, no 3.
  throw new ErrorApi(ultimoError.clase, {
    mensaje: ultimoError.message,
    mensajeServidor: ultimoError.mensajeServidor,
    estado: ultimoError.estado,
    detalles: ultimoError.detalles,
    intentos: intentosHechos,
  });
}

/** Azúcar para los métodos de puerto que devuelven `void`. */
export async function pedirSinCuerpo(ruta: string, opciones: OpcionesPedido = {}): Promise<void> {
  await pedir<unknown>(ruta, opciones);
}

// ---------------------------------------------------------------------------
// Operaciones largas: sondeo con progreso
// ---------------------------------------------------------------------------

/**
 * Techo para operaciones que tardan MINUTOS, no segundos. El snapshot de
 * Dynamics baja ~8.000 items paginados por OData: los 15s que sobran para un
 * login lo matarían a la mitad, siempre.
 *
 * No es "el timeout largo por si acaso": es el de una clase distinta de
 * operación, y por eso tiene nombre propio en vez de ser un número suelto en
 * la llamada.
 */
export const TIMEOUT_LARGO_MS = 5 * 60_000;

/** Cada cuánto se vuelve a preguntar "¿terminó?". */
const INTERVALO_SONDEO_MS = 2_000;

/**
 * Cuántas consultas seguidas pueden fallar por RED antes de dar por perdida
 * la operación. No es 1 a propósito: el teléfono entra a una cámara de frío,
 * pierde señal 20 segundos y vuelve — el trabajo del servidor no se enteró
 * de nada. Rendirse al primer fallo sería reportar un error que no ocurrió.
 */
const FALLAS_DE_RED_TOLERADAS = 5;

export interface OpcionesSondeo<T> {
  /** Una consulta de estado. Se la llama repetidamente hasta que `termino`. */
  consultar: (senal?: AbortSignal) => Promise<T>;
  /** Lee el estado y dice si la operación ya está completa. */
  termino: (estado: T) => boolean;
  /**
   * Se llama en CADA vuelta con el último estado leído, haya cambiado o no.
   * Es de donde sale el "1.200 de 8.000" de la pantalla.
   */
  alAvanzar?: (estado: T) => void;
  /** Cancelación real desde la pantalla (el botón "Cancelar" de min-2). */
  senal?: AbortSignal;
  msIntervalo?: number;
  /** Techo de TODA la espera. Default: `TIMEOUT_LARGO_MS`. */
  msPresupuesto?: number;
}

/**
 * Repite `consultar` hasta que `termino` diga que sí, reportando avance.
 *
 * Por qué sondeo y no una sola petición larga que devuelva al final:
 *
 *  1. Una conexión HTTP abierta cinco minutos sobre la WiFi de una tienda se
 *     corta. Y cuando se corta, el teléfono no puede distinguir "el servidor
 *     sigue trabajando" de "el servidor se murió": las dos cosas se ven
 *     igual desde acá.
 *  2. Con sondeo, perder señal 30 segundos es un bache, no un fracaso — el
 *     trabajo sigue del lado del servidor y la próxima consulta lo reengancha.
 *  3. Es la única forma de tener progreso real. El `fetch` de React Native no
 *     expone el cuerpo como stream, así que "1.200 de 8.000" no puede salir
 *     de leer la respuesta de a pedazos: tiene que venir de preguntar.
 *
 * Los fallos de RED de una consulta suelta NO cortan el sondeo (ver
 * `FALLAS_DE_RED_TOLERADAS`). Los que sí cortan son los que no van a mejorar
 * insistiendo: 401, 403, 404 — si la sesión venció o el trabajo no existe,
 * seguir preguntando es quemar batería.
 */
export async function sondear<T>(opciones: OpcionesSondeo<T>): Promise<T> {
  const {
    consultar,
    termino,
    alAvanzar,
    senal,
    msIntervalo = INTERVALO_SONDEO_MS,
    msPresupuesto = TIMEOUT_LARGO_MS,
  } = opciones;

  const comienzo = Date.now();
  let fallasSeguidas = 0;

  for (;;) {
    if (senal?.aborted) throw new ErrorApi('cancelado');
    if (Date.now() - comienzo >= msPresupuesto) throw new ErrorApi('timeout');

    try {
      const estado = await consultar(senal);
      fallasSeguidas = 0;
      alAvanzar?.(estado);
      if (termino(estado)) return estado;
    } catch (error) {
      const apiError = error instanceof ErrorApi ? error : new ErrorApi('sin-red');

      // Cancelar es una decisión de la persona, no una falla a tolerar.
      if (apiError.clase === 'cancelado') throw apiError;

      // Un error que no es de camino (sesión vencida, sin permiso, no
      // existe) no mejora insistiendo: sale ya.
      if (!apiError.reintentable) throw apiError;

      fallasSeguidas++;
      if (fallasSeguidas > FALLAS_DE_RED_TOLERADAS) throw apiError;
    }

    // La espera también es cancelable: sin esto, tocar "Cancelar" tarda
    // hasta un intervalo entero en tener efecto.
    await dormir(msIntervalo, senal);
  }
}
