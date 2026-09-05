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
  Almacen,
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
  /**
   * El Administrador es del sistema, no de una tienda (`Sesion.sucursal` es
   * `null` para este rol) — por eso no sale de `colaboradores(sucursalId)`
   * como el resto y necesita su propio padron. Sin esto, el login no tiene
   * forma de ofrecerlo en ningun combo de sucursal.
   */
  administradores(): Promise<Colaborador[]>;
  ingresar(colaboradorId: number, pin: string): Promise<Sesion>;
  sesionActiva(): Promise<Sesion | null>;
  cerrar(): Promise<void>;
  /**
   * Cambio de PIN PROPIO — nunca lleva `colaboradorId`: es el de la sesión
   * (sale del token en el backend, ver sesion.schema.ts#cambiarPinSchema).
   * El backend cierra TODAS las sesiones de esa persona al aplicar el
   * cambio, la que llama incluida (sesion.service.ts#cambiarPinPropio) —
   * quien invoca esto tiene que tratar la sesión actual como inválida
   * apenas la promesa resuelve y mandar a la persona de nuevo al login.
   */
  cambiarPin(pinActual: string, pinNuevo: string): Promise<void>;
}

export interface RepositorioHojas {
  /**
   * Hojas de la RONDA dada, asignadas al colaborador de la sesion.
   *
   * `ronda` es obligatoria a proposito: antes no existia y el front pedia
   * siempre la 1ra (bug real — el Contador no veia sus hojas de reconteo).
   * Hacerla parametro y sin default fuerza a cada pantalla a decir de que
   * ronda habla, en vez de caer en la 1 por olvido. La ronda activa sale de
   * `RepositorioInventario.activo().rondaActiva`.
   */
  mias(inventarioId: number, ronda: number): Promise<HojaConteo[]>;
  /**
   * Todas las hojas de la RONDA dada, asignadas o no. Solo la usa el
   * Coordinador (vista de conjunto de la pantalla 2/pantalla "Mis
   * hojas" del equipo) — un Contador nunca deberia ver el lote entero,
   * por eso es un metodo aparte de `mias` y no un filtro sobre el mismo.
   */
  todas(inventarioId: number, ronda: number): Promise<HojaConteo[]>;
  porNumero(inventarioId: number, numero: string, ronda: number): Promise<HojaConteo | null>;

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
 *   - `sin-almacen`: la sucursal no tiene almacén de Dynamics asociado. El
 *     stock NO viene del catálogo de productos: vive en `WarehousesOnHandV2`
 *     y se consulta POR ALMACÉN. Sin almacén no hay stock, y sin stock no se
 *     puede armar el inventario — se cuenta contra nada. Lo configura un
 *     Administrador en app/administrador/tiendas.tsx.
 *   - `credenciales-rechazadas`: la red anduvo, Azure devolvió 401 — las
 *     credenciales configuradas están mal, no es un problema de red.
 *   - `timeout`: se cortó a mitad de camino — se puede reintentar sin
 *     quedar en un estado raro (el inventario, si ya se creó, es idempotente).
 *   - `cancelado`: lo canceló la propia persona — no es un error, no se
 *     muestra ninguna alerta.
 *   - `desconocido`: cualquier otra falla no prevista arriba.
 */
export type CodigoErrorSnapshot =
  | 'sin-red'
  | 'dynamics-no-configurado'
  | 'sin-almacen'
  | 'credenciales-rechazadas'
  | 'timeout'
  | 'cancelado'
  | 'desconocido';

export class ErrorSnapshot extends Error {
  readonly codigo: CodigoErrorSnapshot;
  constructor(codigo: CodigoErrorSnapshot, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorSnapshot';
    this.codigo = codigo;
  }
}

/**
 * Qué UNIVERSO se cuenta. No es una preferencia de vista: cambia el
 * conjunto de productos del inventario entero.
 *
 *  - `mensual` — solo lo que es responsabilidad del EMPLEADO. Lo que asume
 *    la empresa queda afuera. Es el que se hace todos los meses.
 *  - `anual` — todo el catálogo activo, empresa incluida ("en el anual ya
 *    cuentan todo", reunión de requisitos).
 *
 * Medido contra el tenant real (backend/README.md §Dynamics): 6.297 ítems
 * el mensual contra 11.835 el anual. Que alguien cuente 11.835 creyendo que
 * cuenta 6.297 es una jornada perdida, así que el default es `mensual` y el
 * anual hay que pedirlo explícito.
 */
export type TipoInventario = 'mensual' | 'anual';

/**
 * De dónde salió el número final de ítems: cuántos entraron y cuántos
 * quedaron afuera, por motivo.
 *
 * Es lo que el Coordinador va a mirar el día que alguien pregunte "por qué
 * esta hoja no tiene tal producto". Sin esto, la única respuesta posible es
 * "no sé", y un inventario que no puede explicar su propio universo no se
 * puede auditar.
 *
 * Todos los motivos son opcionales porque el servidor informa los que
 * calculó: mostrar un `0` donde el dato no vino diría "no se excluyó
 * ninguno", que es una afirmación distinta de "no lo sé".
 */
export interface DesgloseSnapshot {
  /** Los que quedaron dentro del inventario. Coincide con `items`. */
  incluidos: number;
  /** Descartados por no tener stock en el almacén de la sucursal. */
  sinStock?: number;
  /** Descartados por no estar activos en Dynamics. */
  noActivos?: number;
  /** Descartados por ser responsabilidad de la EMPRESA — solo aplica al mensual. */
  deEmpresa?: number;
  /** Descartados por no tener responsable asignado: sin responsable no hay a quién liquidarle una diferencia. */
  sinResponsable?: number;
}

export interface ResultadoSnapshot {
  inventarioId: number;
  items: number;
  tomadoEn: string;
  /**
   * Presente solo si el servidor lo informa. Se deja opcional a propósito:
   * la pantalla muestra el desglose cuando existe y calla cuando no, en vez
   * de inventar los números que faltan.
   */
  desglose?: DesgloseSnapshot;
}

export interface OpcionesTraerSnapshot {
  /** Qué universo contar. Default `mensual` — ver TipoInventario. */
  tipo?: TipoInventario;
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
  traerSnapshot(sucursalId: number, opciones?: OpcionesTraerSnapshot): Promise<ResultadoSnapshot>;
  /**
   * Paso 2: parte el snapshot en hojas del tamaño elegido. Reemplaza
   * cualquier hoja previa de ese inventario (y su reparto): es
   * destructivo a proposito, igual que lo seria en el backend real.
   */
  crearHojas(inventarioId: number, tamano: TamanoHoja): Promise<HojaConteo[]>;
  /** Paso 3: reparte las hojas sin asignar entre los presentes. */
  asignarHojas(inventarioId: number, colaboradorIds: number[]): Promise<HojaConteo[]>;

  /**
   * PASO 4 — PREVIEW del cierre de una ronda del ciclo de conteos. NO MUTA
   * NADA: solo dice qué pasaría si se cerrara ahora.
   *
   * Existe separado del cierre porque cerrar una ronda es una DECISIÓN, no
   * un trámite: si de 1.236 ítems quedan 12 por recontar, la ronda 2 es media
   * hora; si quedan 900, algo se contó mal y hay que mirar ESO antes de mandar
   * a once personas a recontar. El Coordinador ve este resumen ANTES de
   * apretar — nunca un botón que cierra de una.
   *
   * `sePuedeCerrar` es false mientras queden hojas sin finalizar: están en
   * `hojasSinFinalizar` para poder decir CUÁLES bloquean, no solo que algo
   * bloquea. Rechaza si el inventario no tiene hojas de esa ronda.
   */
  resumenRonda(inventarioId: number, ronda: number): Promise<ResumenRonda>;

  /**
   * Cierra la ronda y abre la siguiente SOLO con los ítems que no cuadraron.
   *
   * NO BORRA NADA: las hojas, productos y conteos de la ronda cerrada quedan
   * intactos — la auditoría compara las tres pasadas, así que borrar una
   * ronda sería destruir la evidencia que justifica el cierre. Las hojas
   * nuevas nacen SIN asignar y sin conteos (conteo ciego): se reparten con
   * `asignarHojas`, igual que la ronda 1.
   *
   * Rechaza si quedan hojas sin finalizar (una hoja a medias no es un conteo
   * definitivo) o si la ronda ya se había cerrado. Cuando ya no hay nada que
   * recontar, `rondaAbierta` es null y `motivoSinSiguiente` dice por qué: el
   * ciclo terminó, no falló.
   */
  cerrarRonda(inventarioId: number, ronda: number): Promise<CierreRonda>;

  /** Inventario en curso de una sucursal, o null si el Coordinador todavia no trajo el snapshot. */
  activo(sucursalId: number): Promise<{
    inventarioId: number;
    items: number;
    tomadoEn: string;
    tamanoHoja: TamanoHoja | null;
    totalHojas: number;
    /**
     * La ronda MAS ALTA con hojas creadas (`max(numeroConteo)`), o `null` si
     * todavia no hay hojas (mismo momento que `tamanoHoja: null` — el
     * Coordinador esta en el paso 1). Es lo que el Contador necesita para
     * ver las hojas de la ronda ACTIVA y el Coordinador para cerrar esa
     * ronda, no siempre la 1. `null` NO es 1: "no hay ronda" y "ronda 1" son
     * cosas distintas — con null no se pide hojas ni se ofrece cerrar.
     *
     * El backend garantiza que si viene un numero, esa ronda todavia admite
     * conteo (activo() filtra `estado: en_curso`, y cerrar la ultima ronda
     * pasa el inventario a `conteo_cerrado` en la misma transaccion).
     */
    rondaActiva: number | null;
  } | null>;
}

/** Una hoja de la ronda que todavía no se finalizó: es lo que bloquea el cierre. */
export interface HojaSinFinalizar {
  id: number;
  numero: string;
  estado: string;
  zona: string;
  /** true = ya tiene a alguien asignado; false = quedó sin repartir. */
  asignada: boolean;
}

/**
 * El embudo de una ronda: cuántos ítems cuadraron contra el ERP y cuántos
 * pasan a la ronda siguiente. `contados + sinContar` siempre da `total`;
 * `cuadrados + aRecontar + sinDatoErp` también (son los tres destinos).
 */
export interface EmbudoRonda {
  /** Ítems que ENTRARON a la ronda. */
  total: number;
  /** De esos, cuántos tienen conteo (en esta ronda o una anterior). */
  contados: number;
  /** Cuántos no tiene conteo en ninguna ronda: nadie los miró. */
  sinContar: number;
  /** Coinciden con el stock del ERP: no se recuentan. */
  cuadrados: number;
  /** No cuadraron: van a la ronda siguiente. */
  aRecontar: number;
  /** No se pueden auditar porque falta el stock del ERP. No se recuentan. */
  sinDatoErp: number;
  /** % que cuadró sobre los AUDITABLES (los que tienen stock del ERP). */
  porcentajeCuadrado: number;
}

export interface ResumenRonda extends EmbudoRonda {
  inventarioId: number;
  ronda: number;
  hojasSinFinalizar: HojaSinFinalizar[];
  sePuedeCerrar: boolean;
  /** La ronda que se abriría al cerrar, o null si el ciclo termina. */
  siguienteRonda: number | null;
  motivoSinSiguiente: string | null;
}

export interface CierreRonda {
  inventarioId: number;
  rondaCerrada: number;
  resumen: EmbudoRonda;
  /** La ronda que se abrió, o null si el ciclo no sigue. */
  rondaAbierta: number | null;
  motivoSinSiguiente: string | null;
  /** Hojas nuevas de la ronda siguiente, SIN asignar. Vacío si no se abrió ninguna. */
  hojas: HojaConteo[];
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

/**
 * Lo que hay que ADVERTIR sobre el monto, antes de firmarlo.
 *
 * Un ítem con diferencia pero sin precio de venta en Dynamics suma 0 al
 * faltante: no rompe el cálculo y no se le inventa un precio, pero deja el
 * monto SUBESTIMADO. Quien autoriza un descuento a la nómina de otra persona
 * tiene derecho a saber que el número está incompleto — y a saberlo ANTES de
 * firmar, no después.
 *
 * `asistenciaSinRegistrar`/`ajustesSinRegistrar` son la MISMA idea aplicada
 * a que hoy no existe ningún mecanismo para registrar quién asistió al
 * inventario ni para cargar los ajustes del mes: mientras eso no exista,
 * `Liquidacion.faltanteNeto`/`cuotaBase`/`bonoAsistencia`/`totalFaltas`
 * vienen en `null` — NO en 0 — y estos dos flags son la razón, para que la
 * pantalla pueda decir POR QUÉ en vez de mostrar un hueco sin explicación.
 */
export interface AdvertenciaLiquidacion {
  /** Ítems con diferencia real que no se pudieron valorizar. */
  itemsSinPrecio: number;
  /** true = no se puede registrar todavía quién asistió: el neto/cuota/bono/faltas de esta liquidación son null. */
  asistenciaSinRegistrar: boolean;
  /** true = los ajustes del mes todavía no se cargaron: mismo efecto que arriba. */
  ajustesSinRegistrar: boolean;
  /** Texto listo para mostrar tal cual, combinando todas las razones. `null` cuando no hay nada que advertir. */
  mensaje: string | null;
}

export interface Liquidacion {
  periodo: string;
  faltanteBruto: number;
  /** null = todavía no se cargaron los ajustes del mes. Nunca 0 con ese significado — ver AdvertenciaLiquidacion. */
  negativosDelMes: number | null;
  faltanteEmpresa: number;
  /**
   * null cuando `advertencia.asistenciaSinRegistrar` o `ajustesSinRegistrar`
   * son true: sin esos dos datos este número no se puede calcular de
   * verdad, así que no se inventa con un placeholder — se deja sin venir.
   */
  faltanteNeto: number | null;
  cuotaBase: number | null;
  multaInasistencia: number;
  /**
   * El PISO del reparto del fondo de multas, no el promedio.
   *
   * Cuando el fondo no divide exacto entre los asistentes, a algunos les toca
   * UN centavo más para que la suma de los bonos dé el fondo exacto (S/80
   * entre 7 = seis de 11.43 y uno de 11.42). Por eso este número puede ser un
   * centavo MENOR que el que aparece en algunas filas de la planilla: es el
   * reparto, no un error de cálculo. La pantalla lo aclara cuando pasa.
   *
   * null, mismo criterio que `faltanteNeto`.
   */
  bonoAsistencia: number | null;
  /** null, mismo criterio que `faltanteNeto`: sin asistencia registrada no hay "cuántos faltaron" que valga. */
  totalFaltas: number | null;
  planilla: DetalleLiquidacion[];
  /** Ver AdvertenciaLiquidacion. Siempre viene; `mensaje: null` si no hay nada que decir. */
  advertencia: AdvertenciaLiquidacion;
}

/**
 * El fondo de multas por inasistencia TIENE QUE CERRAR: lo que se recauda de
 * quienes faltaron es exactamente lo que se reparte entre quienes asistieron
 * (regla textual del cliente). `cierra` se expone en vez de asumirse — si
 * algún día vuelve a no cerrar por un cambio en el reparto, se ve acá en vez
 * de aparecer como un descuadre en la nómina tres meses después.
 */
export interface FondoDeMultas {
  recaudado: number;
  repartido: number;
  /** repartido - recaudado. Tiene que ser 0: positivo = la empresa puso, negativo = se quedó con algo. */
  diferencia: number;
  cierra: boolean;
}

/**
 * "De dónde sale este número" del encabezado de la liquidación — por qué el
 * total de la planilla no da EXACTO contra el faltante neto. Espeja
 * `GET /liquidacion/sucursales/:sucursalId/conciliacion`
 * (backend/liquidacion.service.ts#conciliacion).
 *
 * NO es un histórico: es el desglose aritmético del ÚLTIMO cierre de la
 * sucursal, el mismo ciclo que devuelve `deSucursal`. Por eso es una unión
 * discriminada por `calculable`, igual criterio que `Liquidacion.faltanteNeto`:
 * sin asistencia u ajustes registrados, ninguna de estas cuentas se puede
 * hacer — se corta ANTES de calcular con un valor inventado, no se calcula
 * con un placeholder.
 */
export type Conciliacion =
  | { calculable: false; periodo: string; advertencia: AdvertenciaLiquidacion }
  | {
      calculable: true;
      periodo: string;
      faltanteNeto: number;
      /** Suma real de los montos de la planilla — no siempre igual a `faltanteNeto`, ver `diferenciaPorRedondeo`. */
      sumaPlanilla: number;
      /**
       * faltanteNeto - sumaPlanilla: los centavos que deja el redondeo de la
       * cuota (1390 / 11 = 126.3636... -> 126.36 x 11 = 1389.96, sobran 4
       * centavos). Hoy queda a favor del personal — pendiente de definir con
       * el cliente si eso cambia.
       */
      diferenciaPorRedondeo: number;
      colaboradores: number;
      asistieron: number;
      faltaron: number;
      fondoDeMultas: FondoDeMultas;
      advertencia: AdvertenciaLiquidacion;
    };

/** Solo lo usa el Coordinador (cierre de fin de mes, pantalla 6). */
export interface RepositorioLiquidacion {
  /** null si todavía no hay un ciclo cerrado para calcular sobre esa sucursal. */
  deSucursal(sucursalId: number): Promise<Liquidacion | null>;
  /** null exactamente en el mismo caso que `deSucursal`: no hay ciclo cerrado que conciliar. */
  conciliacion(sucursalId: number): Promise<Conciliacion | null>;
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
  /**
   * Conectividad ACTUAL del teléfono, no derivada de la cola. Sin esto, la
   * banda de sincronización solo puede decir "guardado, pendiente" DESPUÉS
   * de que una pasada de sincronización falle — y guardar un conteo no
   * dispara ninguna pasada por sí solo, así que alguien sin señal contando
   * su primer producto no vería ningún aviso hasta minutos después. Se
   * actualiza en cuanto cambia la conectividad (sincronizador.ts), no
   * cuando corre una sincronización.
   */
  sinRed: boolean;
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

/** Datos para editar una cuenta existente. */
export interface DatosEditarUsuario {
  nombre?: string;
  dni?: string;
  rol?: Rol;
  sucursalId?: number;
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
  /** Edita los datos básicos de la cuenta (nombre, DNI, rol, sucursal). */
  editar(usuarioId: number, datos: DatosEditarUsuario): Promise<Usuario>;
  /** Habilita o deshabilita la cuenta. */
  cambiarActivo(usuarioId: number, activo: boolean): Promise<Usuario>;
  /** PIN nuevo de 6 dígitos, mismo campo que el login. */
  resetearPin(usuarioId: number, nuevoPin: string): Promise<void>;
  /** Elimina definitivamente la cuenta. */
  eliminar(usuarioId: number): Promise<void>;
}

/**
 * Datos editables de una tienda — alta y edición comparten forma.
 * `almacenId` es opcional (una sucursal puede crearse sin almacén
 * todavía, ver `Sucursal.almacenId`) — pero cuando VIENE, tiene que ser
 * uno de los códigos que devolvió `listarAlmacenes()`, nunca texto
 * libre: eso lo hace cumplir la pantalla usando `Select`, no este tipo
 * (el backend además lo verifica contra Dynamics, doble resguardo).
 *
 * Tres estados posibles, no dos — por eso `string | null | undefined`:
 *   - `undefined` (ausente): no tocar el almacén actual (PATCH parcial).
 *   - `null`: DESASOCIAR el almacén a propósito — un almacén mal
 *     asignado es peor que ninguno, así que tiene que poder vaciarse.
 *   - `string`: asignar/cambiar a ese código.
 */
export interface DatosTienda {
  nombre: string;
  direccion?: string;
  almacenId?: string | null;
}

/** Gestión de sucursales (solo Administrador). */
export interface RepositorioTiendas {
  listar(): Promise<Sucursal[]>;
  crear(datos: DatosTienda): Promise<Sucursal>;
  editar(sucursalId: number, datos: DatosTienda): Promise<Sucursal>;
  /** Nunca se borra una tienda (mismo criterio que Usuarios): se activa o desactiva. */
  cambiarActiva(sucursalId: number, activa: boolean): Promise<Sucursal>;
  /**
   * Los almacenes reales de Dynamics, para el `Select` de `crear`/`editar`
   * — NUNCA un campo de texto: un código mal tipeado no falla, trae el
   * stock de OTRA tienda, y la auditoría compara contra números que
   * parecen válidos sin que nadie se entere hasta que no cuadra a fin de
   * mes. Si la lista sale del ERP, ese error deja de ser posible.
   *
   * Por defecto trae SOLO los habilitados para inventario (10 de 70): el
   * tenant tiene almacenes de Tránsito y Cuarentena cuyos nombres se
   * parecen muchísimo a los de tienda — "ALMACÉN CUARENTENA MARKET
   * LUZURIAGA" contra "ALMACÉN DISPONIBLE MARKET LUZURIAGA" — y elegir el
   * equivocado haría contar mercadería bloqueada.
   *
   * `todos: true` trae los 70, para la tienda que abre hoy y cuyo almacén
   * todavía no está habilitado. Al asociarlo, el backend lo habilita solo.
   */
  listarAlmacenes(opciones?: { todos?: boolean }): Promise<Almacen[]>;
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
  /**
   * Lo ÚNICO que se dice del secreto: si hay uno guardado. Nunca su valor,
   * su largo ni sus primeros caracteres — un secreto que la pantalla puede
   * mostrar de vuelta es un secreto que alguien puede fotografiar.
   */
  secretoConfigurado: boolean;
  /**
   * De dónde salen las credenciales que el backend está usando DE VERDAD.
   * `base` = cargadas con `npm run config:dynamics`; `entorno` = todavía
   * salen del .env del servidor. La distinción importa: explica por qué un
   * cambio en la base no tuvo efecto (el proceso no se reinició) sin que
   * nadie tenga que entrar al servidor a mirar.
   */
  origen: 'base' | 'entorno' | 'ninguno';
  /** ISO-8601, o null si nunca se cargaron por base. */
  actualizadoEn: string | null;
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
/**
 * SOLO LECTURA: no hay `guardar`.
 *
 * Las credenciales de Dynamics se cargan en el servidor
 * (`backend/scripts/cargar-config-dynamics.ts`), no desde el teléfono. El
 * puerto no expone escritura porque la app no debe poder escribir las
 * credenciales del ERP: lo que no está en la interfaz no se puede llamar
 * por error ni desde una pantalla futura que no conozca esta decisión.
 */
export interface RepositorioConfigDynamics {
  obtener(): Promise<EstadoConfigDynamics>;
  /** Prueba las credenciales YA guardadas contra Azure AD, sin traer los 8.000 ítems del catálogo. */
  probarConexion(): Promise<ResultadoPruebaDynamics>;
}

// ---------------------------------------------------------------------------
// Histórico (rol Administrador y Auditor)
// ---------------------------------------------------------------------------

/**
 * Ciclo de vida de un inventario (backend/README.md#Histórico):
 *
 *   en_curso ──▶ conteo_cerrado ──▶ liquidado ──▶ lacrado (INMUTABLE)
 *       └──▶ anulado
 *
 * `lacrado` es el único estado del que no se vuelve: cualquier ajuste
 * posterior entra en el período siguiente.
 */
export type EstadoInventario = 'en_curso' | 'conteo_cerrado' | 'liquidado' | 'lacrado' | 'anulado';

/**
 * Cifras del cierre. Casi todo es `number | null`: un inventario en curso
 * todavía no tiene resultado calculado, y `0` no es lo mismo que "no se
 * calculó".
 *
 * `montoFaltanteNeto`/`cuotaBase` tienen DOS razones distintas para ser
 * null, y son razones que la pantalla tiene que poder distinguir:
 *   1. El conteo todavía no se cerró (`resultado` en sí es `null` más
 *      arriba, en `InventarioHistorico`/`DetalleInventarioHistorico`).
 *   2. El conteo YA se cerró (itemsTotales/montoFaltanteBruto/el embudo ya
 *      son reales) pero falta capturar `asistenciaSinRegistrar`/
 *      `ajustesSinRegistrar` -- ver esos dos flags, más abajo.
 * Mostrar el mismo "Sin liquidar todavía" para las dos confunde "todavía
 * no llegamos" con "llegamos, pero falta un dato que hoy no se puede
 * cargar".
 */
export interface ResultadoInventario {
  itemsTotales: number;
  itemsConDiferencia: number;
  itemsCuadrados: number;
  porcentajeCuadrado: number;
  montoFaltanteBruto: number;
  montoFaltanteNeto: number | null;
  cuotaBase: number | null;
  /** Solo en el detalle: el embudo de las 3 rondas y el desglose de unidades. */
  itemsSegundoConteo?: number;
  itemsTercerConteo?: number;
  unidadesFaltantes?: number;
  unidadesSobrantes?: number;
  /**
   * Solo en el detalle. true = `montoFaltanteNeto`/`cuotaBase` son null
   * PORQUE todavía no existe forma de registrar asistencia, no porque el
   * inventario esté sin liquidar.
   */
  asistenciaSinRegistrar?: boolean;
  /** Solo en el detalle. Mismo criterio, para los ajustes del mes. */
  ajustesSinRegistrar?: boolean;
}

/** Una fila del listado. Sin hojas ni firmas: eso lo trae el detalle. */
export interface InventarioHistorico {
  id: number;
  sucursalId: number;
  sucursalNombre: string;
  estado: EstadoInventario;
  /** "2026-08" — el identificador con el que la gente habla del inventario. */
  periodo: string;
  periodoAnio: number;
  periodoMes: number;
  tamanoHoja: number | null;
  snapshotItems: number;
  /** Cuándo se abrió (creó) el inventario — el otro extremo de `cerradoEn`. */
  abiertoEn: string;
  cerradoEn: string | null;
  resultado: ResultadoInventario | null;
  /** Cuántas de las 2 firmas de auditoría ya están. */
  aprobaciones: number;
  /** Solo el folio: para la lista alcanza con saber SI hay sello y cuál es. */
  folio: string | null;
  /**
   * Aplanados del sello, igual criterio que `folio`: la lista necesita
   * CUÁNDO y QUIÉN sin arrastrar el hash ni el registro ERP (eso lo sigue
   * trayendo solo el detalle, en `SelloLacrado`). `null` cuando no hay sello.
   */
  lacradoEn: string | null;
  lacradoPor: { id: number; nombre: string } | null;
}

/**
 * Una de las dos firmas que habilitaron el lacrado.
 *
 * `rolAlAprobar` es el rol CONGELADO al firmar, no el actual: si mañana
 * esa persona cambia de rol, la firma tiene que seguir diciendo con qué
 * autoridad se dio.
 */
export interface AprobacionCierre {
  aprobadorId: number;
  aprobadorNombre: string;
  rolAlAprobar: Rol;
  aprobadoEn: string;
  nota: string | null;
}

/** El sello. Existe únicamente si el inventario está lacrado. */
export interface SelloLacrado {
  /** "INV-2026-06-LUZ-8000-06A" — el identificador legible que se cita en un acta. */
  folio: string;
  /** SHA-256 del contenido canónico del cierre: permite recalcular la huella y detectar una alteración. */
  hash: string;
  lacradoEn: string;
  lacradoPor: { id: number; nombre: string };
  /** Constancia del registro MANUAL en Dynamics — el ajuste automático es fase 2. */
  registroErp: { referencia: string; registradoEn: string; registradoPor: { id: number; nombre: string } } | null;
}

export interface HojaHistorica {
  id: number;
  numero: string;
  zona: string | null;
  gondola: string | null;
  tamano: number;
  estado: string;
  asignados: { id: number; nombre: string }[];
  productos: number;
  contados: number;
}

export interface DetalleInventarioHistorico
  extends Omit<InventarioHistorico, 'folio' | 'aprobaciones' | 'lacradoEn' | 'lacradoPor'> {
  cerradoPor: { id: number; nombre: string } | null;
  hojas: HojaHistorica[];
  /** Cuántos ítems tienen diferencia (el listado en sí es paginado aparte). */
  diferencias: number;
  liquidaciones: number;
  aprobaciones: AprobacionCierre[];
  lacrado: SelloLacrado | null;
}

export interface FiltroHistorial {
  sucursalId?: number;
  estado?: EstadoInventario;
  /** Mes calendario del período (1-12). Solo tiene efecto junto con `periodoAnio`. */
  periodoAnio?: number;
  periodoMes?: number;
  limite?: number;
  desplazamiento?: number;
}

export interface PaginaHistorial {
  total: number;
  inventarios: InventarioHistorico[];
}

/**
 * Las secciones que el sello cubre, en el orden en que le importan a quien
 * lee el resultado. El backend guarda claves técnicas del contenido
 * canónico (backend/historial.lacrado.ts#armarContenidoLacrado); acá se
 * traducen a lo que la persona reconoce:
 *   - `resultado`/`diferencias`: el cierre del conteo en sí.
 *   - `planilla`: la clave técnica es `liquidaciones` — se liquida ANTES de
 *     lacrar (decisión del cliente), así que el sello también cubre cuánto
 *     se le descuenta a cada persona. Es la sección que más le importa al
 *     colaborador.
 *   - `aprobaciones`: las firmas del control de dos personas.
 *   - `datosDelInventario`: el resto del contenido (sucursal, período,
 *     tamaño de hoja, snapshot) — metadata que casi nunca cambia sola, así
 *     que se agrupa en vez de listar cada clave técnica.
 */
export type SeccionSellada = 'resultado' | 'diferencias' | 'planilla' | 'aprobaciones' | 'datosDelInventario';

/**
 * El resultado de recalcular el hash del sello contra el contenido actual
 * (backend/historial.lacrado.ts#verificarLacrado). No muta nada — es una
 * lectura que compara, nunca una escritura.
 *
 * `intacto: true` es la única lectura tranquilizadora: nada cambió desde el
 * lacrado. `intacto: false` viene siempre con `seccionesAlteradas` no
 * vacío, para señalar QUÉ se movió, no solo que algo se movió.
 *
 * `versionDistinta` es un caso aparte: el formato del contenido canónico
 * cambió entre el lacrado y ahora (una migración de `armarContenidoLacrado`
 * en el backend), así que la comparación campo por campo no es 100%
 * confiable aunque diga `intacto`. La pantalla tiene que decirlo aparte, no
 * mezclarlo con "alterado".
 */
export interface VerificacionSello {
  inventarioId: number;
  folio: string;
  lacradoEn: string;
  /** Cuándo se hizo ESTA verificación — no es un dato guardado, se calcula al pedirla. */
  verificadoEn: string;
  intacto: boolean;
  hashGuardado: string;
  hashRecalculado: string;
  /** Vacío cuando `intacto` es true. */
  seccionesAlteradas: SeccionSellada[];
  versionDistinta: boolean;
}

/**
 * Una fila de las diferencias del cierre: lo que dijo el ERP contra lo que
 * fijó el 3er conteo, ya valorizado. Espeja `DiferenciaItem`
 * (backend/prisma/schema.prisma) vía `GET /inventarios/:id/diferencias`.
 *
 * `precioUnitario`/`montoDiferencia` son `null` cuando el snapshot de
 * Dynamics no trajo precio para ese ítem — la diferencia en UNIDADES sigue
 * siendo válida, pero no se puede valorizar. Es precio de VENTA, no costo
 * (ver el comentario de `DiferenciaItem.precioUnitario` en el schema): el
 * cliente definió valorizar a precio de venta, nunca de compra.
 */
export interface DiferenciaHistorica {
  codigo: string;
  descripcion: string;
  stockSistema: number;
  conteoFinal: number;
  /** conteoFinal - stockSistema. Negativo = faltante, positivo = sobrante. */
  diferencia: number;
  tipo: 'faltante' | 'sobrante';
  /** En qué ronda (1, 2 o 3) quedó resuelto este ítem. */
  resueltoEnConteo: number;
  precioUnitario: number | null;
  montoDiferencia: number | null;
}

/**
 * El reparto del faltante neto entre quienes asistieron — lo que muestra el
 * encabezado de la planilla. Espeja `ResumenLiquidacion`
 * (backend/historial.calculos.ts).
 */
export interface ResumenLiquidacion {
  montoFaltanteNeto: number;
  cuotaBase: number;
  faltantes: number;
  fondoMultas: number;
  /** El PISO del reparto: a algunos les toca un centavo más (ver residuoCentavos). */
  bonoAsistencia: number;
  residuoCentavos: number;
}

/** Una fila de la planilla: qué se le descuenta a UN colaborador y por qué. */
export interface LiquidacionColaboradorHistorica {
  colaboradorId: number;
  /** Nombre CONGELADO al liquidar — es lo que decía el recibo, no cambia si la persona se renombra después. */
  nombre: string;
  /** El nombre actual de la cuenta, para poder identificar a la persona si se renombró. */
  nombreActual: string;
  dni: string;
  rol: Rol;
  asistio: boolean;
  cuotaBase: number;
  multaInasistencia: number;
  bonoAsistencia: number;
  /** cuotaBase + multaInasistencia - bonoAsistencia. Derivado, nunca guardado — el backend lo calcula, acá se recibe listo. */
  totalDescuento: number;
}

/**
 * La planilla completa del cierre. Espeja `GET /inventarios/:id/liquidacion`.
 *
 * `resumen: null` — NUNCA un objeto con ceros de relleno — cuando falta
 * capturar asistencia o ajustes: mostrar un resumen calculado sobre datos
 * que no llegaron sería peor que decir que todavía no se puede calcular.
 * `asistenciaSinRegistrar`/`ajustesSinRegistrar` dicen CUÁL de las dos cosas
 * falta.
 */
export interface LiquidacionInventario {
  inventarioId: number;
  periodo: string;
  resumen: ResumenLiquidacion | null;
  asistenciaSinRegistrar: boolean;
  ajustesSinRegistrar: boolean;
  planilla: LiquidacionColaboradorHistorica[];
}

// ---------------------------------------------------------------------------
// Comparativo mensual
// ---------------------------------------------------------------------------

/**
 * Un punto de la serie mensual. Ya viene aplanado del backend (sucursal,
 * folio y las cifras del mes en el mismo objeto — espeja `VariacionComparativo`
 * + metadata de `historial.service.ts#comparativo`), así que el adaptador
 * no traduce nada acá, solo tipa.
 */
export interface PuntoComparativoMensual {
  inventarioId: number;
  sucursalNombre: string;
  periodo: string;
  periodoAnio: number;
  periodoMes: number;
  itemsTotales: number;
  itemsConDiferencia: number;
  /** % de ítems que cuadraron ese mes. */
  porcentajeCuadrado: number;
  montoFaltanteNeto: number;
  /**
   * Variación del faltante neto contra el mes ANTERIOR de la serie, en %.
   * `null` en el primer punto: no hay contra qué comparar, y un 0 ahí
   * mentiría diciendo "no cambió".
   */
  variacionFaltantePct: number | null;
  /** `null` si ese mes todavía no está lacrado. */
  folio: string | null;
}

/**
 * Un mes que existe pero quedó AFUERA de la serie porque su faltante neto
 * no se pudo calcular (falta asistencia o ajustes) — se lista, no se omite
 * en silencio: un gráfico que salta un mes sin decirlo se lee como "no
 * hubo inventario ese mes", que es mentir distinto.
 */
export interface PeriodoExcluidoComparativo {
  inventarioId: number;
  periodo: string;
  motivo: string;
}

export interface FiltroComparativo {
  sucursalId?: number;
  desdeAnio?: number;
  hastaAnio?: number;
}

/**
 * Serie mes a mes de faltante neto y % cuadrado, con la variación contra el
 * mes anterior ya calculada (`historial.calculos.ts#compararPeriodos`).
 * `sucursalId: null` = vista de TODAS las sucursales (solo posible para el
 * Administrador sin filtro; el Auditor siempre recibe la suya).
 */
export interface ComparativoMensual {
  sucursalId: number | null;
  serie: PuntoComparativoMensual[];
  excluidos: PeriodoExcluidoComparativo[];
}

// ---------------------------------------------------------------------------
// Histórico de un ítem
// ---------------------------------------------------------------------------

/** Una aparición del ítem en un inventario anterior con diferencia. */
export interface AparicionItemHistorico {
  inventarioId: number;
  sucursalId: number;
  sucursalNombre: string;
  periodo: string;
  periodoAnio: number;
  periodoMes: number;
  estadoInventario: EstadoInventario;
  stockSistema: number;
  conteoFinal: number;
  /** conteoFinal - stockSistema. Negativo = faltante, positivo = sobrante. */
  diferencia: number;
  /** En qué ronda (1, 2 o 3) quedó resuelto este ítem, en ESE inventario. */
  resueltoEnConteo: number;
  montoDiferencia: number | null;
}

export interface PeorPeriodoItem {
  anio: number;
  mes: number;
  diferencia: number;
}

/**
 * "Este producto, cuántas veces dio diferencia" — la pregunta textual del
 * cliente. Un ítem que aparece todos los meses con faltante no es un error
 * de conteo: es una merma sistemática o algo peor, y solo se ve mirando el
 * histórico completo, no un mes suelto.
 */
export interface ResumenHistoricoItem {
  /** En cuántos inventarios apareció con diferencia. */
  veces: number;
  vecesFaltante: number;
  vecesSobrante: number;
  unidadesFaltantes: number;
  unidadesSobrantes: number;
  /** Solo suma las apariciones que pudieron valorizarse (con precio). */
  montoAcumulado: number;
  peorPeriodo: PeorPeriodoItem | null;
}

export interface FiltroHistoricoItem {
  sucursalId?: number;
  desdeAnio?: number;
  hastaAnio?: number;
}

/**
 * La historia de un artículo a través de los inventarios que ya cerraron
 * (un inventario en curso todavía puede resolver esa diferencia en el 2do
 * o 3er conteo, así que no cuenta). `apariciones` viene en orden cronológico
 * ascendente — mismo orden que la serie del comparativo.
 */
export interface HistoricoItem {
  codigo: string;
  /** La descripción más reciente entre las apariciones — la que la gente reconoce. `null` si nunca apareció. */
  descripcion: string | null;
  resumen: ResumenHistoricoItem;
  apariciones: AparicionItemHistorico[];
}

/**
 * El registro de todos los inventarios: en qué estado está cada uno, cómo
 * cerró y quién lo firmó. Responde la pregunta del cliente ("falta el
 * registro de todos los inventarios, dónde llevaremos el control y el
 * histórico").
 *
 * SOLO Administrador y Auditor. `coordinador` y `conteo` NO — y no es una
 * omisión: es la misma regla de conteo ciego que sostiene el sistema. Quien
 * cuenta no puede ver el resultado del mes pasado ni el faltante ya
 * detectado, porque entonces deja de contar a ciegas y pasa a confirmar un
 * número que vio antes. El backend devuelve 403; la app no ofrece el acceso.
 *
 * Es de solo lectura a propósito: firmar y lacrar viven en la pantalla de
 * Lacrado (RepositorioLacrado), donde el control de dos personas ya está
 * resuelto. Un histórico que además escribe es un histórico que se puede
 * reescribir. `verificarSello` no rompe esto: recalcula y compara, no
 * escribe nada — por eso comparte el mismo acceso que `detalle`, sin una
 * regla de permisos propia (backend/historial.permisos.ts no tiene ninguna
 * función "quién puede verificar"; el único guard es el de leer el
 * histórico: administrador y auditor, este último recortado a su sucursal).
 */
export interface RepositorioHistorial {
  listar(filtro?: FiltroHistorial): Promise<PaginaHistorial>;
  /** Rechaza con 403 si el inventario es de otra sucursal y quien pide es Auditor. */
  detalle(inventarioId: number): Promise<DetalleInventarioHistorico>;
  /**
   * Recalcula el hash del sello y lo compara contra el guardado. Rechaza
   * con 409 si el inventario todavía no está lacrado — no hay sello que
   * verificar. Mismo acceso que `detalle`.
   */
  verificarSello(inventarioId: number): Promise<VerificacionSello>;
  /**
   * Las diferencias del cierre, ordenadas por VALOR ABSOLUTO descendente:
   * lo que más plata mueve primero. Es un criterio DISTINTO al que usa el
   * backend para paginar (`diferencia` en unidades) — el adaptador reordena.
   * Trae hasta 500 (el máximo del endpoint): un inventario con más de 500
   * ítems con diferencia sería inusual, pero si pasara, esta lista queda
   * truncada a las 500 que más plata mueven.
   */
  diferencias(inventarioId: number): Promise<DiferenciaHistorica[]>;
  /** La planilla del cierre: quién, cuánto, por qué. Mismo acceso que `detalle`. */
  liquidacion(inventarioId: number): Promise<LiquidacionInventario>;
  /**
   * Serie mensual de faltante neto y % cuadrado. Mismo alcance por rol que
   * `listar`: el Administrador puede filtrar por sucursal o pedir todas
   * (`sucursalId` ausente); el Auditor recibe siempre la suya, ignorando
   * cualquier `sucursalId` que mande — mismo criterio del backend.
   */
  comparativo(filtro?: FiltroComparativo): Promise<ComparativoMensual>;
  /**
   * La historia de un ítem a través de los inventarios anteriores. Mismo
   * alcance por rol que `listar`. `codigo` es el ItemNumber de Dynamics
   * (`DiferenciaItem.codigo` — la identidad ESTABLE entre períodos), no el
   * código interno de la hoja ("0051") ni el código de barras.
   */
  historicoDeItem(codigo: string, filtro?: FiltroHistoricoItem): Promise<HistoricoItem>;
}
