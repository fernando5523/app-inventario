/**
 * Tipos de las entidades OData de D365 que este modulo lee, y de nuestro
 * propio dominio de catalogo. Solo los campos que de verdad usamos --
 * ver backend/README.md para por que se eligieron estas entidades (y por
 * que NO son las que se asumian al principio: `ReleasedProducts` y
 * `ProductBarcodes` a secas no existen/no sirven en el ambiente real de
 * Market Trujillo, ver el historial de esa investigacion en el README).
 */

// ---------------------------------------------------------------------------
// OAuth2 (Azure AD, client_credentials)
// ---------------------------------------------------------------------------

export interface D365TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_on: string;
  resource: string;
}

export interface D365Token {
  accessToken: string;
  tokenType: string;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// OData generico
// ---------------------------------------------------------------------------

export interface ODataQueryOptions {
  $filter?: string;
  $select?: string;
  $orderby?: string;
  $top?: number;
  $skip?: number;
}

export interface ODataResponse<T> {
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
  value: T[];
}

// ---------------------------------------------------------------------------
// Entidades D365 F&O -- verificadas contra el tenant real de Market
// Trujillo (dataAreaId "trv", confirmado por el cliente), no adivinadas.
// ---------------------------------------------------------------------------

/**
 * ReleasedProductsV2 -- catalogo maestro. `ReleasedProducts` a secas da 404
 * en este ambiente. No tiene `ItemId`, `ProductName` ni `ProductDescription`
 * (los tres dan 400 "property not found") -- el unico nombre disponible es
 * `SearchName`, y viene recortado/en mayusculas fijas (ver ProductBarcodesV2
 * mas abajo, que trae una descripcion mejor).
 */
export interface D365ReleasedProduct {
  ItemNumber: string;
  SearchName?: string;
  InventoryUnitSymbol?: string;
  PurchaseUnitSymbol?: string;
}

/**
 * ProductBarcodesV2 -- SIEMPRE de la unidad SUELTA en este tenant: en una
 * muestra real de 100+ productos, `ProductQuantity` fue 0 en el 100% de los
 * casos (nunca 1 ni >1) y `IsDefaultDisplayedBarcode` siempre "No". Esto
 * significa que el escaner NUNCA puede distinguir "esto es una caja" de
 * "esto es una unidad" por el codigo de barras solo -- es una limitacion
 * real del dato de origen, no algo que se nos escapo armando el mapeo (ver
 * backend/README.md). `ProductDescription` si trae un nombre legible de
 * verdad (ej. "SAPOLIO LIMPIATODO ANTIBACTERIAL COCO 900 ML"), mejor que el
 * `SearchName` truncado de ReleasedProductsV2.
 */
export interface D365ProductBarcode {
  ItemNumber: string;
  Barcode: string;
  ProductDescription?: string;
  ProductQuantityUnitSymbol?: string;
  ProductQuantity?: number;
  IsDefaultDisplayedBarcode?: 'Yes' | 'No';
}

/**
 * ProductSpecificUnitOfMeasureConversions -- ACA es donde vive de verdad el
 * factor de "Emp.12" = 12 unidades, NO en ProductBarcodesV2.ProductQuantity
 * (que siempre es 0). Confirmado contra datos reales: fila
 * `{ProductNumber: '110605', FromUnitSymbol: 'Emp.12', ToUnitSymbol: 'U', Factor: 12}`.
 * Un producto puede tener mas de una fila con Factor != 1 (varios empaques
 * alternos) -- la tabla lo soporta, aunque en la muestra real que se probo
 * (100 productos) ninguno mostro dos a la vez. No acepta filtro por
 * dataAreaId (ver README): se trae completa y se agrupa localmente por
 * ProductNumber.
 */
export interface D365UnitConversion {
  ProductNumber: string;
  FromUnitSymbol: string;
  ToUnitSymbol: string;
  Factor: number;
}

// ---------------------------------------------------------------------------
// Nuestro dominio (mobile/lib/dominio/tipos.ts#Producto/Empaque)
// ---------------------------------------------------------------------------

export interface EmpaqueDto {
  nombre: string;
  factor: number;
  codigoBarras?: string;
}

/**
 * Responsabilidad del conteo de un item, de la entidad CUSTOM del tenant
 * `TRU_InventoryManagerPEEntities`. Es lo que decide si un producto entra en
 * el inventario del operario o lo asume la empresa.
 *
 * Descubierto leyendo el proyecto de referencia
 * (D:\Documentos
odepp_inventarioautomatico, sync.service.ts): filtra
 * por `ModuleType === 'Invent'` y traduce `Employee`/`Company`/`None`.
 */
export interface D365ResponsableItem {
  ItemId: string;
  ModuleType: string;
  TRU_InventoryManagerPE: string;
}

/**
 * Un almacen de Dynamics (entidad `Warehouses`). Es lo que el Administrador
 * ELIGE al dar de alta una tienda -- ver `almacenes` en backend/README.md.
 */
export interface D365Almacen {
  WarehouseId: string;
  WarehouseName?: string;
}

/**
 * Un precio de venta de `SalesPriceAgreements`, la entidad donde vive el
 * precio en este tenant.
 *
 * Medido contra el tenant real antes de diseñar nada:
 *  - `ReleasedProductsV2.SalesPrice` existe y es 1:1, pero viene en 0 en el
 *    100% de 2.000 filas. Inutil.
 *  - `InventItemPrices` trae precio, pero `PriceType: "Cost"` -- es COSTO.
 *  - `SalesPriceAgreements` trae 100% con precio > 0, en PEN.
 *
 * OJO con la cardinalidad, que es la trampa: SIN filtrar por almacen hay
 * hasta 15 filas por item (2.000 filas -> 239 items distintos), porque el
 * precio es POR TIENDA. Filtrando por `PriceWarehouseId` baja a ~1:1, y el
 * residuo que queda es por UNIDAD DE VENTA (ver `elegirPrecioVenta`).
 */
export interface D365PrecioVenta {
  ItemNumber: string;
  Price: number;
  /** "U", "Emp.20", "SA"... la unidad a la que aplica ESE precio. */
  QuantityUnitySymbol?: string;
  PriceWarehouseId?: string;
  PriceCurrencyCode?: string;
}

/** Stock por almacen -- `WarehousesOnHandV2` del tenant real. */
export interface D365StockAlmacen {
  ItemNumber: string;
  InventoryWarehouseId: string;
  OnHandQuantity: number;
  AvailableOnHandQuantity?: number;
  TotalAvailableQuantity?: number;
}

/**
 * Fila de `ProductCategoryAssignments`. VERIFICADA contra el tenant real con
 * una muestra de 2.000: una sola jerarquia ("Catalogo Ventas"), CERO
 * productos con mas de una asignacion, 134 categorias distintas.
 *
 * Esa unicidad es lo que permite cruzarla sin miedo: si un producto tuviera
 * dos categorias, un join lo duplicaria en las hojas y se contaria dos veces
 * en tienda -- un error que no se ve en el codigo y aparece recien en la
 * auditoria como un descuadre.
 */
export interface D365CategoriaItem {
  ProductNumber: string;
  /** "Catalogo Ventas". Hoy la unica del tenant; se filtra igual, por si aparece otra. */
  ProductCategoryHierarchyName: string;
  /** "FIDEOS Y PASTAS", "GALLETAS", "DETERGENTES EN POLVO". */
  ProductCategoryName: string;
}

export interface CatalogoItemDto {
  /** ItemNumber de D365 -- es el "codigo interno" en nuestro dominio. */
  codigo: string;
  /** Codigo de barras de la unidad SUELTA. */
  codigoBarras: string;
  descripcion: string;
  /** Siempre al menos uno. `[0]` = el de mayor factor (ver elegirEmpaques). */
  empaques: EmpaqueDto[];
  /**
   * Existencia del ERP para el almacen consultado.
   *
   * `null` = NO SABEMOS, y es radicalmente distinto de 0. En un inventario,
   * "no tengo el dato" y "hay cero" llevan a conclusiones opuestas: un 0
   * falso hace que la auditoria reporte un faltante que no existe y que
   * alguien lo pague. Se deja null salvo que Dynamics haya dado un numero.
   */
  stockErp: number | null;
  /**
   * Precio de venta de la UNIDAD suelta, en el almacen de la sucursal.
   *
   * `null` = no lo sabemos, y nunca 0: mismo criterio que `stockErp`. Un 0
   * falso haria que la auditoria valorice un faltante real en cero y que
   * nadie lo vea en la liquidacion.
   */
  precioVenta: number | null;
  /**
   * Categoria de "Catalogo Ventas" en Dynamics. Es el ORDEN con el que se
   * arman las hojas de conteo, no un dato decorativo: sin ella las hojas
   * salen por codigo de item y el operario cruza la tienda en cada renglon.
   *
   * `null` = el ERP no tiene asignacion para ese producto. Esos van al
   * final, juntos, nunca afuera del inventario.
   */
  categoria: string | null;
  /**
   * true = el faltante lo asume la EMPRESA, no se le descuenta al operario
   * (mobile/lib/dominio/tipos.ts#ItemAuditoria.esEmpresa). Sale de
   * `TRU_InventoryManagerPE`, no se calcula.
   */
  esEmpresa: boolean;
}
