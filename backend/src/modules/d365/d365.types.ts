/**
 * Tipos de las entidades OData de D365 que este modulo lee, y de nuestro
 * propio dominio de catalogo. Solo los campos que de verdad usamos --
 * ver backend/README.md para por que se eligieron estas dos entidades.
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
// Entidades D365 F&O (ver README: ReleasedProducts + ProductBarcodes)
// ---------------------------------------------------------------------------

/** ReleasedProducts -- catalogo maestro. Solo lectura, nunca se escribe de vuelta. */
export interface D365ReleasedProduct {
  ItemId: string;
  ItemNumber: string;
  ProductName?: string;
  ProductDescription?: string;
  ProductType?: string;
  ItemModelGroupId?: string;
  ProductGroupId?: string;
  SearchName?: string;
  InventoryUnitSymbol?: string;
  PurchaseUnitSymbol?: string;
}

/**
 * ProductBarcodes -- un producto puede tener varios: uno para la unidad
 * suelta (ProductQuantity = 1) y uno o mas para empaques (ProductQuantity
 * > 1, ej. 12 para "Caja"). Esto es lo que alimenta el escaner y
 * Producto.empaque en nuestro dominio.
 */
export interface D365ProductBarcode {
  ItemNumber: string;
  Barcode: string;
  ProductQuantityUnitSymbol?: string;
  ProductQuantity?: number;
  IsDefaultDisplayedBarcode?: 'Yes' | 'No';
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
  empaque: EmpaqueDto;
}
