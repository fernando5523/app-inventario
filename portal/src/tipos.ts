/**
 * Los contratos del backend de ESTE repo (`backend/src/modules/`), tal como los
 * devuelve. No son los de app_pdv: ahí todo venía envuelto en
 * `{ success, data }` y acá el cuerpo ES el dato (ver `services/api.ts`).
 *
 * Verificado contra el backend vivo el 2026-10-12, no deducido de la pantalla.
 */

/**
 * NO HAY PERMISOS GRANULARES, HAY CUATRO ROLES.
 *
 * app_pdv tiene un padrón de permisos (`constants/permissions.ts`, ~150
 * claves) y rutas que piden uno. Este backend no: cada router declara
 * `requiereRol(...)` con nombres de rol, y los recortes mas finos dependen del
 * INVENTARIO, no del usuario (ver `auditoria.permisos.ts`). Inventar permisos
 * en el cliente seria inventar una regla que el servidor no comparte.
 *
 * `administrador` entra a todo; es la unica jerarquía que existe.
 */
export type Rol = 'administrador' | 'auditor' | 'coordinador' | 'conteo'

/** `GET /api/sesion/sucursales`. `colaboradores` = cuántos se pueden elegir acá. */
export interface Sucursal {
  id: number
  nombre: string
  colaboradores: number
}

/** `GET /api/sesion/sucursales/:id/colaboradores` y `GET /api/sesion/administradores`. */
export interface Colaborador {
  id: number
  nombre: string
  dni: string
  rol: Rol
}

/** Respuesta de `POST /api/sesion/ingresar`. */
export interface Sesion {
  colaborador: Colaborador
  /** null solo para rol=administrador: es del sistema, no de una tienda. */
  sucursal: Sucursal | null
  token: string
  /** ISO 8601. La sesión dura 12 horas. */
  expiraEn: string
}

/** El ciclo de vida de un inventario, en la base. */
export type EstadoInventario =
  | 'en_curso'
  | 'ajuste_auditor'
  | 'conteo_cerrado'
  | 'liquidado'
  | 'lacrado'
  | 'anulado'

/** Un cuadro de diferencias (`unidad`, `paquete` o `empresa`). */
export interface CuadroDeDiferencias {
  items: number
  unidadesFaltantes: number
  unidadesSobrantes: number
  valorFaltante: number
  valorSobrante: number
}

/**
 * Los tres cuadros en los que se reparte cada diferencia, según cómo se trata
 * ese producto (ver `Clasificación de productos`):
 * - `unidad`: lo que se le descuenta al personal, medido por unidad.
 * - `paquete`: faltante que se mide por paquete, no por unidad.
 * - `empresa`: lo que asume la empresa y NO se le descuenta a nadie.
 */
export interface PorClase {
  unidad: CuadroDeDiferencias
  paquete: CuadroDeDiferencias
  empresa: CuadroDeDiferencias
}

/** Una tienda de la cadena en el período. `FilaCadena` en el backend. */
export interface TiendaDeLaCadena {
  sucursalId: number
  sucursal: string
  /** null = esta tienda todavía no abrió el inventario del período. */
  inventarioId: number | null
  /** null junto con `inventarioId`: sin inventario no hay estado que declarar. */
  estado: EstadoInventario | null
  items: number
  auditables: number
  cuadrados: number
  valorFaltante: number
  valorSobrante: number
  porClase: PorClase
  /**
   * LA PLATA QUE SE LE DESCUENTA AL PERSONAL DE ESTA TIENDA: el NETO, no el
   * bruto de `porClase.unidad.valorFaltante`. Le resta el sobrante que lo
   * compensa y los ajustes del mes.
   *
   * Viene POSITIVO como el resto de los montos (el signo lo pone la pantalla),
   * pero PUEDE DAR NEGATIVO cuando el sobrante supera al faltante: eso es
   * plata a favor del personal y se muestra tal cual da. Un `Math.max(0, ...)`
   * puesto de buena fe haría desaparecer la compensación sin dejar rastro
   * (decisión del cliente, documentada en el backend).
   */
  valorADescontar: number
}

/** El pie de la tabla: la cadena entera. `TotalCadena` en el backend. */
export interface TotalDeLaCadena {
  /** Cuántas tiendas activas hay: el denominador de la cobertura. */
  tiendas: number
  /** De esas, cuántas arrancaron el período. */
  conInventario: number
  items: number
  cuadrados: number
  auditables: number
  valorFaltante: number
  valorSobrante: number
  porClase: PorClase
  /** La suma de `valorADescontar` de las tiendas. Puede ser negativo. */
  valorADescontar: number
}

export interface Periodo {
  anio: number
  mes: number
}

/** `GET /api/auditoria/cadena?anio=&mes=`. */
export interface ResumenDeLaCadena {
  periodo: Periodo
  total: TotalDeLaCadena
  tiendas: TiendaDeLaCadena[]
}
