/**
 * Modelo de dominio del conteo de inventario.
 *
 * Este archivo NO importa nada: ni React, ni Expo, ni SQLite, ni el cliente
 * HTTP. Es el nucleo. Todo lo demas depende de el y el no depende de nadie —
 * por eso se puede testear sin emulador, sin red y sin base de datos.
 *
 * Los nombres siguen el modelo que ya existe en el backend
 * (D:\Documentos\monorepo\inventario\backend\prisma\schema.prisma) para que
 * no haya dos vocabularios para la misma cosa.
 */

// ---------------------------------------------------------------------------
// Catalogo
// ---------------------------------------------------------------------------

/**
 * Presentacion en la que viene un producto. En el backend es `UnidadAlterna`.
 *
 * `codigoBarras` es opcional DE VERDAD, no solo en el tipo: dato real de
 * Dynamics (verificado por min-1 contra 15 productos reales) es que los
 * barcodes que trae son de la UNIDAD SUELTA (`ProductQuantity 0`, unidad
 * "U") — ninguno identifica un empaque especifico. La logica NUNCA puede
 * asumir que un empaque va a traer codigo: el escaner confirma QUE
 * PRODUCTO es (por `Producto.codigoBarras`), la persona elige a mano CON
 * QUE empaque cuenta. Si algun dia Dynamics expone codigos por empaque,
 * este campo ya esta listo para usarlos — pero no se disena asumiendo
 * que van a estar.
 */
export interface Empaque {
  nombre: string;          // "Caja", "Pack", "Plancha", "Fardo"
  factor: number;          // unidades que trae: 12, 6, 24, 20
  codigoBarras?: string;
}

/**
 * Decision del cliente (2026-09-XX): un producto puede venir en MAS DE UN
 * empaque a la vez (ej. Caja x12 Y Pack x6 del mismo producto) — antes se
 * elegia uno solo al mapear el catalogo y se descartaban los demas en
 * silencio, y eso estaba mal: el operario tiene que poder contar los dos.
 *
 * La UNIDAD SUELTA queda AFUERA de esta lista, a proposito, no como un
 * "empaque de factor 1" mas: no es una presentacion empaquetada (la
 * palabra lo dice), y ya tenia su propio lugar antes de este cambio
 * (`Producto.codigoBarras`, el de la unidad — ver ahi). Meterla en la
 * lista hubiera dejado DOS codigos de barra candidatos para la unidad
 * (el de `Producto` y uno con factor 1 en `empaques`) sin que quede claro
 * cual manda — mezclar los dos casos es exactamente como se cuelan los
 * bugs de conteo.
 *
 * `empaques[0]` es el que se ofrece primero al abrir el modal de conteo
 * (el mas comun/frecuente) — el ORDEN de la lista decide eso, no un
 * campo aparte que se pueda desincronizar de cual es "el default".
 */
export interface Producto {
  id: number;
  codigo: string;          // codigo interno del item en la hoja: "0051"
  codigoBarras: string;    // el de la unidad suelta
  descripcion: string;
  /** Al menos uno. `[0]` = el que se ofrece primero al abrir el modal. */
  empaques: Empaque[];
  ubicacion?: string;      // "Gondola A2 - Nivel 3"
}

// ---------------------------------------------------------------------------
// Conteo
// ---------------------------------------------------------------------------

/**
 * Cuantos empaques CERRADOS de un tipo cargo el operario — una linea por
 * cada empaque de `Producto.empaques` que efectivamente contó (no hay una
 * linea vacia por cada empaque que el producto podria tener y no se usó).
 * `empaqueNombre` identifica CUAL de `Producto.empaques` es: dentro de un
 * mismo producto los nombres no se repiten (no hay dos "Caja" del mismo
 * producto), asi que no hace falta inventar un id aparte para esto — el
 * empaque no lo tiene tampoco (ver el comentario de `Empaque`).
 */
export interface LineaEmpaque {
  empaqueNombre: string;
  cantidad: number;
}

/**
 * Lo que el operario cuenta de UN producto: una linea por cada empaque
 * cerrado que cargó (puede ser mas de uno — Caja Y Pack del mismo
 * producto, ver `Producto.empaques`) mas las unidades sueltas, que son
 * una sola cifra sin importar de que empaque "vendrian": una unidad
 * suelta no esta empaquetada, no tiene sentido preguntarse a cual de los
 * empaques pertenece. El total NO se guarda: se calcula (ver
 * `empaque.ts`). Guardar un total junto a sus partes es garantizar que
 * algun dia no coincidan.
 */
export interface Conteo {
  productoId: number;
  /** Vacio = no cargó ningún empaque cerrado, solo sueltas. */
  empaques: LineaEmpaque[];
  sueltas: number;
  /** Marcado por el escaner: el fisico coincide con lo que dice la linea. */
  confirmadoPorEscaner: boolean;
  contadoEn: string;       // ISO 8601
}

/**
 * Ciclo de vida de una hoja. El orden importa y no se puede saltear.
 *
 * `finalizada` es un punto de no retorno decidido por el cliente: mientras la
 * hoja no este finalizada los conteos se pueden corregir; despues, no.
 *
 * `sincronizada` no es un estado del conteo sino de su viaje al servidor, y
 * por eso va aparte (`EstadoSync`): una hoja finalizada sigue siendo valida
 * aunque todavia no haya salido del telefono.
 */
export type EstadoHoja = 'pendiente' | 'en-proceso' | 'finalizada';

/**
 * Estado del dato frente al servidor. Los equipos trabajan con la WiFi de la
 * tienda y sin chip: `local` es la situacion normal, no la excepcion.
 */
export type EstadoSync = 'local' | 'sincronizando' | 'sincronizado' | 'error';

export interface HojaConteo {
  id: number;
  inventarioId: number;
  numero: string;          // "002"
  zona: string;            // "Abarrotes"
  gondola: string;         // "A2"
  /** Tamaño del lote. Configurable por el cliente: 20, 30 o 50. */
  tamano: number;
  estado: EstadoHoja;
  sync: EstadoSync;
  /** El backend asigna hasta dos personas por hoja (asignado_a, asignado_a_2). */
  asignados: string[];
  productos: Producto[];
  conteos: Conteo[];
}

/** Tamaños de hoja que el coordinador puede elegir al crearlas. */
export const TAMANOS_HOJA = [20, 30, 50] as const;
export type TamanoHoja = (typeof TAMANOS_HOJA)[number];

// ---------------------------------------------------------------------------
// Sesion
// ---------------------------------------------------------------------------

export type Rol = 'administrador' | 'coordinador' | 'conteo' | 'auditor';

export interface Colaborador {
  id: number;
  nombre: string;
  dni: string;
  /** Derivado del padron, nunca elegido por la persona. */
  rol: Rol;
}

/**
 * Un almacén de Dynamics (`WarehouseId`/`WarehouseName`), tal como los
 * expone `GET /api/d365/almacenes` (backend/src/modules/d365) — no un
 * dato que este dominio invente. Solo `codigo` es lo que el ERP necesita
 * para filtrar stock (`InventoryWarehouseId eq '<codigo>'`); `nombre` es
 * para que la persona elija sin memorizar códigos.
 */
export interface Almacen {
  codigo: string; // "MD11_CENT", "AD04_TCE"
  nombre: string;
}

export interface Sucursal {
  id: number;
  nombre: string;
  colaboradores: number;
  /**
   * Opcional: lo completan RepositorioTiendas.crear/editar (gestión del
   * Administrador). Las sucursales que vienen de RepositorioSesion (el
   * padrón de login) no lo traen — por eso es opcional y no rompe esos
   * literales existentes.
   */
  direccion?: string;
  /** Opcional por la misma razón que `direccion` — default `true` cuando no está. */
  activa?: boolean;
  /**
   * Decisión del cliente: "al crear el sitio, se debe asociar el
   * almacén" — de acá sale el stock del ERP contra el que se audita todo
   * el inventario. `WarehouseId` de Dynamics (ej. "MD11_CENT") — el
   * backend lo verifica contra el ERP real al guardar (nunca confía en
   * el formato solo, ver backend/src/modules/tiendas/tiendas.service.ts),
   * así que si está presente acá es porque ya se confirmó que existe.
   *
   * `undefined`/`null` es un estado LEGÍTIMO, no un error: una sucursal
   * puede existir sin almacén todavía configurado — a propósito no se
   * exige al crear, porque bloquear el alta no ayuda a nadie más que a
   * quien complete el dato después. Lo que NO puede pasar es que la
   * ausencia quede escondida: sin almacén no hay stock del ERP, y sin
   * stock la auditoría no puede comparar nada (ver TiendasScreen).
   */
  almacenId?: string | null;
  /**
   * Nombre legible, copiado del ERP en el momento de elegir el almacén
   * (mismo criterio que `DiferenciaItem.descripcion` del backend: si
   * Dynamics renombra el almacén después, esta tienda sigue diciendo con
   * qué nombre se lo asoció). Siempre presente junto con `almacenId`,
   * nunca por separado — no hace falta cruzar contra
   * `listarAlmacenes()` solo para mostrar el nombre.
   */
  almacenNombre?: string | null;
}

export interface Sesion {
  colaborador: Colaborador;
  /**
   * `null` únicamente para `rol: 'administrador'` — es del sistema, no de
   * una tienda (mismo contrato que `SesionDto` del backend, ver
   * backend/README.md#El-administrador-no-pertenece-a-ninguna-sucursal).
   * Coordinador/Conteo/Auditor SIEMPRE tienen una sucursal real: en esas
   * pantallas (rutas aisladas por rol, `RolTabsLayout` nunca monta un
   * grupo con la sesión de otro rol) `sesion.sucursal!` es seguro — es el
   * mismo criterio que ya usa `sesion!` en toda la app para invariantes
   * que la arquitectura garantiza y el tipo no puede expresar solo.
   */
  sucursal: Sucursal | null;
  token: string;
  expiraEn: string;        // ISO 8601
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

/**
 * Resultado de comparar un item contra Dynamics tras el ciclo de 3
 * conteos (mobile/design/auditoria.html). NO vive dentro de `Producto` ni
 * de `HojaConteo`: el conteo ciego no conoce el stock del ERP (por eso
 * `Producto` no tiene un campo de stock), y la auditoria ocurre despues
 * de cerrado el ciclo, no por hoja individual sino por item comparado
 * contra el snapshot completo. Es lo que faltaba modelar para que el rol
 * Auditor pudiera tener datos reales en vez de un dataset fijo.
 *
 * `conteo1`/`conteo2`/`conteo3` son null cuando ese item no llego a
 * necesitar esa pasada (cuadro antes, ver dominio/auditoria.ts#conteoFinal).
 */
export interface ItemAuditoria {
  productoId: number;
  codigo: string;
  descripcion: string;
  zona: string;
  precioVenta: number;
  stockErp: number;
  conteo1: number | null;
  conteo2: number | null;
  conteo3: number | null;
  /**
   * true = la categoria la asume la empresa por orden de gerencia (ej.
   * cervezas, por seguimiento de robo) — dato configurado en Dynamics
   * caso por caso, no algo que el dominio pueda calcular solo.
   */
  esEmpresa: boolean;
}

export type VeredictoAuditoria = 'cuadrado' | 'falta' | 'empresa';

// ---------------------------------------------------------------------------
// Gestión (rol Administrador, y Usuarios también para el Auditor)
// ---------------------------------------------------------------------------

/**
 * Cuenta con acceso a la app — distinto de `Colaborador` (el padrón de
 * login, de solo lectura desde acá) porque este es del lado de la
 * GESTIÓN: crear, deshabilitar, resetear PIN. Separarlo evita tocar
 * `RepositorioSesion`/`Colaborador`, que no son de esta tarea.
 */
export interface Usuario {
  id: number;
  nombre: string;
  dni: string;
  rol: Rol;
  /**
   * Ausente para el rol Administrador: no pertenece a una sola sucursal.
   * El nombre de la sucursal NO se duplica acá — quien necesite mostrarlo
   * lo cruza con `RepositorioTiendas.listar()`, así hay una sola fuente
   * de verdad para el nombre y nunca queda desactualizado.
   */
  sucursalId?: number;
  /** Nunca se borra un usuario (dejaría conteos huérfanos): se deshabilita. */
  activo: boolean;
}

/**
 * Configuración del sistema (pantalla del Administrador). `umbralMediaUnidad`
 * es la fracción del paquete (0-1) desde la que una diferencia se
 * descuenta por paquete completo en vez de por unidad suelta — regla de
 * negocio real de la reunión de requisitos, hoy la define el auditor
 * caso por caso ("mitad del paquete más uno", ver docs/pantallas.md,
 * sección Pantalla 3 / Modal 1); este valor es el default configurable.
 */
export interface ConfigSistema {
  tamanoHojaDefecto: TamanoHoja;
  /** Cantidad de pasadas del ciclo de conteo (hoy 3: 1er conteo + 2 reconteos). */
  conteosDelCiclo: number;
  umbralMediaUnidad: number;
}
