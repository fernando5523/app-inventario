/**
 * Los tipos de "Clasificación de productos", tomados del DTO del backend
 * (`backend/src/modules/clasificacion/clasificacion.service.ts`), con los
 * MISMOS nombres que usa la app móvil (`mobile/lib/puertos/repositorios.ts`)
 * para que las dos copias de las reglas se puedan comparar línea a línea.
 *
 * Viven acá y no en `src/tipos.ts` porque esa es zona compartida con los otros
 * agentes del portal.
 */

/**
 * LAS TRES VÍAS. Pedido textual del cliente (reunión 2): "ponga empresa y se
 * va al cuadro de empresa, ponga paquetes se va al cuadro de paquetes, unidad
 * se queda ahí unidad para el descuento del personal".
 */
export type ClaseItem = 'empresa' | 'paquete' | 'unidad'

/** Lo que dice Dynamics. `null` = D365 contestó 'None'. */
export type ResponsableDynamics = 'empleado' | 'empresa' | null

/** La excepción VIVA del Auditor sobre un código (backend: ClasificacionProducto). */
export interface Clasificacion {
  codigo: string
  /**
   * `true` = lo asume la EMPRESA; `false` = del EMPLEADO.
   *
   * Lo DERIVA el servidor de `clase`, y sigue viniendo porque lo leen la
   * auditoría, la liquidación y el sello del lacrado. Mientras las dos viajen
   * no pueden discrepar: `clase === 'empresa'` es exactamente `esEmpresa`.
   */
  esEmpresa: boolean
  /**
   * LA EXCEPCIÓN A TRES VÍAS. `null` = excepción VIEJA, cargada antes de este
   * cambio: la sigue mandando `esEmpresa`.
   *
   * NO SE REINTERPRETA. La pantalla la muestra por lo que es (empresa /
   * no-empresa) y nunca le inventa una tercera vía que nadie eligió -- decir
   * "unidad" sobre un null sería atribuirle al Auditor una decisión que no
   * tomó, sobre un dato que mueve plata.
   */
  clase: ClaseItem | null
  /**
   * EL EMPAQUE DE COMPRA CORREGIDO A MANO por el Auditor. `null` = sin
   * corregir: manda `ProductoClasificable.empaqueCompra`, el del snapshot.
   *
   * CORREGIR EL EMPAQUE NO ES CORREGIR EL STOCK: el stock del ERP no lo edita
   * nadie nunca desde ninguna pantalla. El empaque es un ATRIBUTO del producto
   * ("viene en display de 12") que Dynamics a veces tiene mal.
   *
   * Un `1` puesto a mano NO es lo mismo que `null`: afirma "se compra suelto",
   * y con eso el ítem nunca va al cuadro de paquetes.
   */
  empaqueCompraCorregido: number | null
  nota: string | null
  clasificadoPorId: number
  clasificadoEn: string
}

/** Un producto del catálogo, con lo de Dynamics y lo del Auditor por separado. */
export interface ProductoClasificable {
  codigo: string
  descripcion: string
  categoria: string | null
  /** Lo que dice DYNAMICS. El Auditor NO lo pisa. */
  responsableDynamics: ResponsableDynamics
  /**
   * La clase que DERIVÓ EL SNAPSHOT: qué haría el sistema si el Auditor no
   * pusiera excepción. Sin esto la pantalla ofrecería tres vías sin decir cuál
   * es la que ya está.
   */
  claseDynamics: ClaseItem
  /**
   * EL EMPAQUE DE COMPRA, que es el denominador del umbral por paquete.
   *
   * `null` = el snapshot no lo pudo resolver, y NULL NO ES 1: sin ese dato el
   * umbral no se puede medir, y la pantalla tiene que decirlo en vez de dejar
   * elegir "paquete" como si nada.
   */
  empaqueCompra: number | null
  /** El símbolo tal cual lo tiene Dynamics ("Emp.12", "CJ"), para poder auditar de dónde salió el número. */
  empaqueCompraSimbolo: string | null
  /** Lo que decidió el AUDITOR, o `null` si no hay excepción (manda Dynamics). */
  clasificacion: Clasificacion | null
}

/** Una página de `GET /api/clasificacion`. `total` es el del catálogo, no el de lo traído. */
export interface PaginaDeProductos {
  total: number
  limite: number
  desplazamiento: number
  productos: ProductoClasificable[]
}

/** El cuerpo de `PUT /api/clasificacion/:codigo`. El servidor lo valida `.strict()`. */
export interface ExcepcionAGuardar {
  /** `null` = no se fuerza ningún cuadro: lo decide el sistema con el empaque. */
  clase: ClaseItem | null
  /** `null` = sin corregir. Viaja explícito porque es el deshacer. */
  empaqueCompraCorregido: number | null
  nota?: string
}
