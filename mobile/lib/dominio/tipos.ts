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
 * `codigoBarras` es opcional y propio del empaque: la caja de 12 puede tener
 * un codigo distinto al de la unidad suelta. Es lo que permite que el escaner
 * confirme "esto que tengo en la mano es una CAJA de este producto", no solo
 * el producto.
 */
export interface Empaque {
  nombre: string;          // "Caja", "Pack", "Plancha", "Fardo"
  factor: number;          // unidades que trae: 12, 6, 24, 20
  codigoBarras?: string;
}

export interface Producto {
  id: number;
  codigo: string;          // codigo interno del item en la hoja: "0051"
  codigoBarras: string;    // el de la unidad suelta
  descripcion: string;
  empaque: Empaque;
  ubicacion?: string;      // "Gondola A2 - Nivel 3"
}

// ---------------------------------------------------------------------------
// Conteo
// ---------------------------------------------------------------------------

/**
 * Lo que el operario cuenta de UN producto: cuantos empaques cerrados y
 * cuantas unidades sueltas. El total NO se guarda: se calcula (ver
 * `empaque.ts`). Guardar un total junto a sus partes es garantizar que algun
 * dia no coincidan.
 */
export interface Conteo {
  productoId: number;
  empaques: number;
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
}

export interface Sesion {
  colaborador: Colaborador;
  sucursal: Sucursal;
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
