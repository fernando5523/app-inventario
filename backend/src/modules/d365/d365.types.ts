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

export interface CatalogoItemDto {
  /** ItemNumber de D365 -- es el "codigo interno" en nuestro dominio. */
  codigo: string;
  /** Codigo de barras de la unidad SUELTA. */
  codigoBarras: string;
  descripcion: string;
  /** Siempre al menos uno. `[0]` = el de mayor factor (ver elegirEmpaques). */
  empaques: EmpaqueDto[];
}
