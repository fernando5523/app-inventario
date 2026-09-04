/**
 * Puertos: lo que la app necesita del mundo exterior, expresado como
 * interfaces.
 *
 * Las pantallas dependen SOLO de esto. Nunca de SQLite, nunca de fetch.
 *
 * La razon no es purismo: los equipos trabajan con la WiFi de la tienda y sin
 * chip, asi que hay DOS implementaciones reales de cada puerto — la local
 * (SQLite, que es la que manda) y la remota (la API). Si cada pantalla
 * resolviera por su cuenta "hay red / no hay red / reintento / encolo",
 * tendriamos siete versiones del mismo problema y seis estarian mal.
 *
 * Regla de corte: un puerto existe cuando hay dos implementaciones reales o
 * una razon concreta para aislar. Para todo lo demas, una funcion y listo.
 */

import type {
  Colaborador,
  ConfigSistema,
  Conteo,
  HojaConteo,
  ItemAuditoria,
  Producto,
  Rol,
  Sesion,
  Sucursal,
  TamanoHoja,
  Usuario,
} from '../dominio/tipos';

// ---------------------------------------------------------------------------

export interface RepositorioSesion {
  sucursales(): Promise<Sucursal[]>;
  /** Padron de la sucursal. El rol viene de aca, no lo elige la persona. */
  colaboradores(sucursalId: number): Promise<Colaborador[]>;
  ingresar(colaboradorId: number, pin: string): Promise<Sesion>;
  sesionActiva(): Promise<Sesion | null>;
  cerrar(): Promise<void>;
}

export interface RepositorioHojas {
  /** Hojas asignadas al colaborador de la sesion. */
  mias(inventarioId: number): Promise<HojaConteo[]>;
  /**
   * Todas las hojas del inventario, asignadas o no. Solo la usa el
   * Coordinador (vista de conjunto de la pantalla 2/pantalla "Mis
   * hojas" del equipo) — un Contador nunca deberia ver el lote entero,
   * por eso es un metodo aparte de `mias` y no un filtro sobre el mismo.
   */
  todas(inventarioId: number): Promise<HojaConteo[]>;
  porNumero(inventarioId: number, numero: string): Promise<HojaConteo | null>;

  /**
   * Guarda o corrige el conteo de un producto.
   *
   * Debe resolver contra el almacenamiento local y devolver de inmediato: el
   * operario esta parado frente a la gondola y no puede esperar a la red.
   * Falla solo si la hoja ya esta finalizada.
   */
  guardarConteo(hojaId: number, conteo: Conteo): Promise<void>;

  /**
   * Congela la hoja. Punto de no retorno: despues de esto `guardarConteo`
   * rechaza. Devuelve la hoja en su estado final.
   */
  finalizar(hojaId: number): Promise<HojaConteo>;
}

export interface RepositorioCatalogo {
  /** Productos de una hoja, con su empaque y factor. */
  deHoja(hojaId: number): Promise<Producto[]>;
  /**
   * Busca por codigo de barras dentro de una hoja. Devuelve null si el codigo
   * no pertenece a esa hoja — el caso de la gondola, donde el producto de al
   * lado entra en cuadro.
   */
  porCodigoBarras(hojaId: number, codigo: string): Promise<Producto | null>;
}

/**
 * Solo lo usa el Auditor (pantalla 5) — el conteo ciego no puede tocar
 * esto: `RepositorioHojas`/`RepositorioCatalogo` no exponen stock del ERP
 * a propósito, así que la comparación contra Dynamics necesita su propio
 * puerto en vez de agregarle un campo de stock a `Producto`.
 */
export interface RepositorioAuditoria {
  /** Matriz item por item (ERP vs los 3 conteos) del inventario dado. */
  matriz(inventarioId: number): Promise<ItemAuditoria[]>;
}

/**
 * Cuántos ítems del catálogo ya llegaron — el paso 1 real son ~8.000
 * ítems por OData paginado desde Azure sobre la WiFi de la tienda,
 * minutos, no milisegundos. Sin esto, una pantalla que solo sabe
 * "cargando sí/no" hace que el Coordinador crea que se colgó.
 *
 * `total` es `number | null`: Dynamics puede no contestar cuántos ítems
 * hay hasta la primera página — no se inventa un total para poder
 * dibujar una barra completa antes de tiempo, una barra que miente es
 * peor que un spinner honesto.
 */
export interface AvanceSnapshot {
  traidos: number;
  total: number | null;
}

/**
 * Motivo por el que `traerSnapshot` no pudo terminar. Cada uno tiene un
 * mensaje y una salida DISTINTOS en la pantalla (ver
 * app/coordinador/hojas.tsx):
 *   - `sin-red`: no hay conexión con la tienda — no se rompió nada, se reintenta solo.
 *   - `dynamics-no-configurado`: faltan credenciales (tenant/client id/secret/URL) —
 *     un Administrador las carga en app/administrador/config.tsx.
 *   - `credenciales-rechazadas`: la red anduvo, Azure devolvió 401 — las
 *     credenciales configuradas están mal, no es un problema de red.
 *   - `timeout`: se cortó a mitad de camino — se puede reintentar sin
 *     quedar en un estado raro (el inventario, si ya se creó, es idempotente).
 *   - `cancelado`: lo canceló la propia persona — no es un error, no se
 *     muestra ninguna alerta.
 *   - `desconocido`: cualquier otra falla no prevista arriba.
 */
export type CodigoErrorSnapshot = 'sin-red' | 'dynamics-no-configurado' | 'credenciales-rechazadas' | 'timeout' | 'cancelado' | 'desconocido';

export class ErrorSnapshot extends Error {
  readonly codigo: CodigoErrorSnapshot;
  constructor(codigo: CodigoErrorSnapshot, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorSnapshot';
    this.codigo = codigo;
  }
}

export interface OpcionesTraerSnapshot {
  /** Se llama cada vez que llega una página nueva del catálogo. */
  onAvance?: (avance: AvanceSnapshot) => void;
  /** Mismo AbortSignal que usa `fetch` — el adaptador HTTP lo pasa derecho a cada request, sin traducir nada. */
  signal?: AbortSignal;
}

/**
 * El wizard de 3 pasos (traerSnapshot/crearHojas/asignarHojas) lo usa
 * solo el Coordinador (pantalla 2). `activo` es de lectura y la puede
 * llamar cualquier pantalla que necesite resolver "cual es el
 * inventario en curso de mi sucursal" sin pasar por el wizard —
 * un Contador o un Auditor entrando a su propia pantalla, por ejemplo.
 */
export interface RepositorioInventario {
  /**
   * Paso 1: snapshot del catalogo desde Dynamics. Lectura, nunca
   * escritura. Idempotente: si la sucursal ya tiene un inventario en
   * curso, lo devuelve tal cual en vez de crear uno nuevo — no puede
   * haber dos inventarios activos a la vez para la misma sucursal.
   *
   * Devuelve `inventarioId`: sin este dato no hay forma de encadenar
   * `crearHojas`/`asignarHojas`, que lo piden como primer argumento.
   *
   * `opciones` es nueva (antes no existía): 8.000 ítems por OData
   * paginado tardan minutos reales, no milisegundos simulados — la
   * pantalla necesita `onAvance` para no parecer colgada y `signal` para
   * poder cancelar una operación de minutos sin salida. Rechaza con
   * `ErrorSnapshot` (ver más arriba), nunca con un `Error` genérico —
   * la pantalla necesita distinguir el motivo para dar la salida correcta.
   */
  traerSnapshot(
    sucursalId: number,
    opciones?: OpcionesTraerSnapshot,
  ): Promise<{ inventarioId: number; items: number; tomadoEn: string }>;
  /**
   * Paso 2: parte el snapshot en hojas del tamaño elegido. Reemplaza
   * cualquier hoja previa de ese inventario (y su reparto): es
   * destructivo a proposito, igual que lo seria en el backend real.
   */
  crearHojas(inventarioId: number, tamano: TamanoHoja): Promise<HojaConteo[]>;
  /** Paso 3: reparte las hojas sin asignar entre los presentes. */
  asignarHojas(inventarioId: number, colaboradorIds: number[]): Promise<HojaConteo[]>;
  /** Inventario en curso de una sucursal, o null si el Coordinador todavia no trajo el snapshot. */
  activo(
    sucursalId: number,
  ): Promise<{ inventarioId: number; items: number; tomadoEn: string; tamanoHoja: TamanoHoja | null; totalHojas: number } | null>;
}

/** Un renglón de la planilla de descuentos (pantalla 6). */
export interface DetalleLiquidacion {
  colaboradorId: number;
  nombre: string;
  rol: Rol;
  asistio: boolean;
  /** Monto a descontar, ya calculado (cuota base ± bono/multa). Nunca se guarda un total suelto sin sus partes. */
  monto: number;
}

export interface Liquidacion {
  periodo: string;
  faltanteBruto: number;
  negativosDelMes: number;
  faltanteEmpresa: number;
  faltanteNeto: number;
  cuotaBase: number;
  multaInasistencia: number;
  bonoAsistencia: number;
  totalFaltas: number;
  planilla: DetalleLiquidacion[];
}

/** Solo lo usa el Coordinador (cierre de fin de mes, pantalla 6). */
export interface RepositorioLiquidacion {
  /** null si todavía no hay un ciclo cerrado para calcular sobre esa sucursal. */
  deSucursal(sucursalId: number): Promise<Liquidacion | null>;
}

// ---------------------------------------------------------------------------

/** Quién ya aprobó y si el inventario quedó lacrado (pantalla 7, punto de no retorno). */
/**
 * Una de las dos firmas de la doble validación de auditoría.
 *
 * Lleva `fecha` porque una firma sin cuándo no es auditable: el acto que
 * cierra el inventario del mes tiene que poder responder "quién y a qué
 * hora", no solo "sí".
 */
export interface AprobacionLacrado {
  colaboradorId: number;
  nombre: string;
  /** ISO 8601. */
  fecha: string;
}

export interface EstadoLacrado {
  inventarioId: number;
  aprobaciones: AprobacionLacrado[];
  /** Cuántas aprobaciones distintas hacen falta antes de poder lacrar. Hoy: 2 (doble validación de auditoría). */
  aprobacionesRequeridas: number;
  /** Si hay hojas del inventario todavía sin sincronizar — no se puede lacrar con datos que no llegaron a Dynamics. */
  todoSincronizado: boolean;
  lacrado: boolean;
  hash: string | null;
  lacradoEn: string | null;
  /**
   * El ajuste automático a Dynamics es fase 2 (acordado con el cliente):
   * esto es solo la marca de que TI lo cargó a mano en el ERP.
   */
  registradoManualmenteEnDynamics: boolean;
}

/** Solo lo usa el Auditor (cierre definitivo del inventario, pantalla 7). */
export interface RepositorioLacrado {
  estado(inventarioId: number): Promise<EstadoLacrado>;
  /**
   * Registra la aprobación de QUIEN ESTÁ EN SESIÓN. A propósito NO recibe
   * un `colaboradorId`: mientras la firma venía por parámetro, el auditor
   * logueado podía aprobar en nombre del otro — dos firmas registradas,
   * una sola persona — y la doble validación quedaba en un botón doble.
   * El único que puede firmar es el dueño de la sesión, y eso no puede
   * depender de que la pantalla esconda un botón.
   *
   * Espeja el backend, donde la aprobación se registra contra el
   * colaborador del token y nunca contra un id del body.
   *
   * Rechaza si: no hay sesión, quien firma no es auditor, no es auditor de
   * la sucursal del inventario, ya había firmado, o ya está lacrado.
   */
  aprobar(inventarioId: number): Promise<EstadoLacrado>;
  /**
   * Punto de no retorno: congela el inventario del mes. Rechaza si faltan
   * aprobaciones o si hay hojas sin sincronizar — nunca confía en que la
   * pantalla ya deshabilitó el botón, lo vuelve a chequear acá.
   */
  lacrar(inventarioId: number): Promise<EstadoLacrado>;
  /** Registro MANUAL de que TI cargó el resultado lacrado en Dynamics. Rechaza si todavía no está lacrado. */
  marcarRegistradoEnDynamics(inventarioId: number): Promise<EstadoLacrado>;
}

// ---------------------------------------------------------------------------

export interface EstadoCola {
  pendientes: number;
  ultimaSync: string | null;
  error: string | null;
}

/**
 * Orquesta las dos implementaciones. Es el unico que sabe que existe una red.
 *
 * Las pantallas no lo llaman para leer ni escribir: solo se suscriben para
 * mostrar la banda de sincronizacion.
 */
export interface Sincronizador {
  estado(): EstadoCola;
  suscribir(escuchar: (estado: EstadoCola) => void): () => void;
  /** Intenta vaciar la cola. Silencioso si no hay red: no es un error. */
  sincronizar(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Gestión (rol Administrador, y Usuarios también para el Auditor)
// ---------------------------------------------------------------------------

/** Datos para dar de alta una cuenta — `sucursalId` no aplica al rol Administrador. */
export interface DatosNuevoUsuario {
  nombre: string;
  dni: string;
  rol: Rol;
  sucursalId?: number;
  /** PIN inicial de 6 dígitos, mismo campo que el login. */
  pin: string;
}

/**
 * Gestión de cuentas (Administrador: todas; Auditor: solo las de su
 * propia sucursal — pantalla "Usuarios", pedida por el cliente para
 * ambos roles).
 */
export interface RepositorioUsuarios {
  /** Sin `sucursalId`: todas las cuentas (Administrador). Con `sucursalId`: solo esa sucursal (Auditor, la suya). */
  listar(sucursalId?: number): Promise<Usuario[]>;
  /**
   * `creadoPorRol` es el rol de quien crea la cuenta. El adaptador vuelve
   * a validar que ese rol pueda otorgar `datos.rol` aunque la pantalla ya
   * haya filtrado el selector — mismo criterio que
   * `RepositorioLacrado.aprobar`: nunca confiar en que la UI ya lo
   * impidió. Rechaza si `creadoPorRol` no puede crear ese rol (ver
   * `rolesQuePuedeCrear` en lib/dominio/roles.ts).
   */
  crear(datos: DatosNuevoUsuario, creadoPorRol: Rol): Promise<Usuario>;
  /**
   * Habilita o deshabilita. Nunca hay un `eliminar`: un usuario borrado
   * deja conteos huérfanos en un sistema que se audita — se deshabilita,
   * nunca se borra.
   */
  cambiarActivo(usuarioId: number, activo: boolean): Promise<Usuario>;
  /** PIN nuevo de 6 dígitos, mismo campo que el login. */
  resetearPin(usuarioId: number, nuevoPin: string): Promise<void>;
}

/** Datos editables de una tienda — alta y edición comparten forma. */
export interface DatosTienda {
  nombre: string;
  direccion?: string;
}

/** Gestión de sucursales (solo Administrador). */
export interface RepositorioTiendas {
  listar(): Promise<Sucursal[]>;
  crear(datos: DatosTienda): Promise<Sucursal>;
  editar(sucursalId: number, datos: DatosTienda): Promise<Sucursal>;
  /** Nunca se borra una tienda (mismo criterio que Usuarios): se activa o desactiva. */
  cambiarActiva(sucursalId: number, activa: boolean): Promise<Sucursal>;
}

/** Configuración global del sistema (solo Administrador). */
export interface RepositorioConfig {
  obtener(): Promise<ConfigSistema>;
  actualizar(datos: ConfigSistema): Promise<ConfigSistema>;
}

/**
 * Lo que se puede LEER de la configuración de Dynamics — nunca el
 * `clientSecret`. Un secreto que la pantalla puede mostrar de vuelta es
 * un secreto que alguien puede fotografiar; `secretoConfigurado` es lo
 * único que dice si ya hay uno guardado.
 */
export interface EstadoConfigDynamics {
  tenantId: string;
  clientId: string;
  urlBase: string;
  secretoConfigurado: boolean;
}

/**
 * Lo que se puede ESCRIBIR. `clientSecret` es opcional a propósito: sin
 * él, `guardar` actualiza tenant/clientId/urlBase y deja el secreto ya
 * guardado tal cual — así se puede corregir el tenant sin forzar a
 * re-tipear el secreto entero.
 */
export interface DatosConfigDynamics {
  tenantId: string;
  clientId: string;
  urlBase: string;
  clientSecret?: string;
}

export interface ResultadoPruebaDynamics {
  ok: boolean;
  mensaje: string;
}

/**
 * Credenciales de la integración con Dynamics (solo Administrador) — que
 * `traerSnapshot` (RepositorioInventario) necesita para funcionar. Puerto
 * aparte de RepositorioConfig: el manejo del secreto (nunca se lee de
 * vuelta) y `probarConexion` (una llamada de red real, no una lectura
 * local) son razones concretas para aislarlo, no una config más.
 */
export interface RepositorioConfigDynamics {
  obtener(): Promise<EstadoConfigDynamics>;
  guardar(datos: DatosConfigDynamics): Promise<EstadoConfigDynamics>;
  /** Prueba las credenciales YA guardadas contra Azure AD, sin traer los 8.000 ítems del catálogo. */
  probarConexion(): Promise<ResultadoPruebaDynamics>;
}
