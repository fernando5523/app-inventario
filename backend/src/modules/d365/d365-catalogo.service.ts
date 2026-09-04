/**
 * Catalogo de Dynamics mapeado a NUESTRO dominio (Producto/Empaque, ver
 * mobile/lib/dominio/tipos.ts) y el snapshot que consume el paso 1 del
 * wizard del Coordinador (RepositorioInventario.traerSnapshot).
 *
 * SOLO LECTURA: esta funcion nunca escribe de vuelta a Dynamics. El unico
 * lado que persiste algo es Postgres, del lado de aca.
 */

import { d365Config } from '../../config/d365.config';
import { prisma } from '../../config/database';
import { ErrorHttp } from '../../shared/errores';
import { d365EntityService } from './d365-entity.service';
import type { CatalogoItemDto, D365ProductBarcode, D365ReleasedProduct, D365UnitConversion, EmpaqueDto } from './d365.types';

export type ModoCatalogo = 'real' | 'ejemplo';

// ---------------------------------------------------------------------------
// Mapeo (puro, sin red ni DB -- ver d365-catalogo.test.ts)
// ---------------------------------------------------------------------------

function agruparPor<T>(filas: T[], clave: (fila: T) => string): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const fila of filas) {
    const k = clave(fila);
    const existentes = mapa.get(k) ?? [];
    existentes.push(fila);
    mapa.set(k, existentes);
  }
  return mapa;
}

/** Agrupa los codigos de barra de ProductBarcodesV2 por ItemNumber. */
export function agruparBarcodesPorItem(barcodes: D365ProductBarcode[]): Map<string, D365ProductBarcode[]> {
  return agruparPor(barcodes, (b) => b.ItemNumber);
}

/** Agrupa las conversiones de unidad de ProductSpecificUnitOfMeasureConversions por ProductNumber. */
export function agruparConversionesPorProducto(conversiones: D365UnitConversion[]): Map<string, D365UnitConversion[]> {
  return agruparPor(conversiones, (c) => c.ProductNumber);
}

/**
 * El empaque de un producto sale de ProductSpecificUnitOfMeasureConversions,
 * NO de ProductBarcodesV2.ProductQuantity (que en este tenant siempre es 0
 * -- ver el comentario largo en d365.types.ts#D365ProductBarcode). Una fila
 * con Factor=1 es solo la equivalencia entre "U" y "U." (misma unidad,
 * distinta grafia) y no cuenta como empaque; el resto (Factor != 1) son
 * empaques alternos de verdad, ej. `{FromUnitSymbol:'Emp.12', Factor:12}`.
 *
 * Nuestro dominio modela un Empaque por producto (no una lista, a
 * diferencia de otros proyectos D365 de referencia que vimos con varios
 * simultaneos) -- si D365 trae mas de un empaque alterno para el mismo
 * producto, nos quedamos con el de mayor factor (el "mas grande", ej. Caja
 * antes que Pack) y el resto se descarta. Esta limitacion queda
 * documentada en el README para cuando se decida soportar varios.
 */
export function elegirEmpaque(conversionesDelProducto: D365UnitConversion[], producto: D365ReleasedProduct): EmpaqueDto {
  const factoresPorUnidad = new Map<string, number>();
  for (const conversion of conversionesDelProducto) {
    if (conversion.Factor && conversion.Factor !== 1) {
      factoresPorUnidad.set(conversion.FromUnitSymbol, conversion.Factor);
    }
  }

  if (factoresPorUnidad.size === 0) {
    return { nombre: producto.InventoryUnitSymbol || producto.PurchaseUnitSymbol || 'UND', factor: 1 };
  }

  const [nombre, factor] = [...factoresPorUnidad.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return { nombre, factor };
}

/**
 * Un producto de D365 a nuestro Producto (sin `id`/`ubicacion`, que salen
 * de la hoja, no del catalogo).
 *   - codigoBarras (unidad SUELTA) = el barcode marcado
 *     IsDefaultDisplayedBarcode, o el primero que haya (ProductQuantity no
 *     sirve de desempate en este tenant: siempre es 0).
 *   - descripcion = ProductBarcodesV2.ProductDescription (nombre legible de
 *     verdad) y si no hay barcode, SearchName de ReleasedProductsV2.
 *   - empaque.codigoBarras NUNCA se llena: no existe un barcode especifico
 *     por empaque en este tenant (ver D365ProductBarcode) -- queda siempre
 *     undefined, a proposito.
 */
export function mapearProducto(
  producto: D365ReleasedProduct,
  barcodesDelItem: D365ProductBarcode[],
  conversionesDelItem: D365UnitConversion[],
): CatalogoItemDto {
  const suelto = barcodesDelItem.find((b) => b.IsDefaultDisplayedBarcode === 'Yes') ?? barcodesDelItem[0];

  const descripcion = suelto?.ProductDescription || producto.SearchName || producto.ItemNumber;

  return {
    codigo: producto.ItemNumber,
    // Sin ningun barcode: el ItemNumber hace de codigo de barras de ultimo
    // recurso -- nunca se deja vacio, el escaner necesita algo para matchear.
    codigoBarras: suelto?.Barcode || producto.ItemNumber,
    descripcion,
    empaque: elegirEmpaque(conversionesDelItem, producto),
  };
}

// ---------------------------------------------------------------------------
// Datos de ejemplo -- mismos 4 productos/empaques/codigos de barra que ya
// usa mobile/lib/adaptadores/_compartido.ts (BASE_PRODUCTOS): no se inventan
// datos nuevos, se reusa lo que el cliente ya valido en la maqueta. Forma
// alineada a como responde el tenant real (barcode SIEMPRE de unidad
// suelta, factor en una conversion aparte).
// ---------------------------------------------------------------------------

const PRODUCTOS_EJEMPLO: D365ReleasedProduct[] = [
  { ItemNumber: '0051', SearchName: 'ACEITEVEGETALPRIMOR', InventoryUnitSymbol: 'U.', PurchaseUnitSymbol: 'Emp.12' },
  { ItemNumber: '0052', SearchName: 'CERVEZACUSQUENATRIGO', InventoryUnitSymbol: 'U.', PurchaseUnitSymbol: 'Emp.6' },
  { ItemNumber: '0053', SearchName: 'LECHEEVAPORADAGLORIA', InventoryUnitSymbol: 'U.', PurchaseUnitSymbol: 'Emp.24' },
  { ItemNumber: '0054', SearchName: 'FIDEOSCANUTOLAVAGGI', InventoryUnitSymbol: 'U.', PurchaseUnitSymbol: 'Emp.20' },
];

const BARCODES_EJEMPLO: D365ProductBarcode[] = [
  { ItemNumber: '0051', Barcode: '7750123051', ProductDescription: 'Aceite Vegetal Primor 1L', ProductQuantityUnitSymbol: 'U', ProductQuantity: 0, IsDefaultDisplayedBarcode: 'Yes' },
  { ItemNumber: '0052', Barcode: '7750999015', ProductDescription: 'Cerveza Cusqueña Trigo 310ml', ProductQuantityUnitSymbol: 'U', ProductQuantity: 0, IsDefaultDisplayedBarcode: 'Yes' },
  { ItemNumber: '0053', Barcode: '7750123088', ProductDescription: 'Leche Evaporada Gloria Azul 400g', ProductQuantityUnitSymbol: 'U', ProductQuantity: 0, IsDefaultDisplayedBarcode: 'Yes' },
  { ItemNumber: '0054', Barcode: '7750123054', ProductDescription: 'Fideos Canuto Lavaggi 500g', ProductQuantityUnitSymbol: 'U', ProductQuantity: 0, IsDefaultDisplayedBarcode: 'Yes' },
];

const CONVERSIONES_EJEMPLO: D365UnitConversion[] = [
  { ProductNumber: '0051', FromUnitSymbol: 'U', ToUnitSymbol: 'U.', Factor: 1 },
  { ProductNumber: '0051', FromUnitSymbol: 'Emp.12', ToUnitSymbol: 'U', Factor: 12 },
  { ProductNumber: '0052', FromUnitSymbol: 'U', ToUnitSymbol: 'U.', Factor: 1 },
  { ProductNumber: '0052', FromUnitSymbol: 'Emp.6', ToUnitSymbol: 'U', Factor: 6 },
  { ProductNumber: '0053', FromUnitSymbol: 'U', ToUnitSymbol: 'U.', Factor: 1 },
  { ProductNumber: '0053', FromUnitSymbol: 'Emp.24', ToUnitSymbol: 'U', Factor: 24 },
  { ProductNumber: '0054', FromUnitSymbol: 'U', ToUnitSymbol: 'U.', Factor: 1 },
  { ProductNumber: '0054', FromUnitSymbol: 'Emp.20', ToUnitSymbol: 'U', Factor: 20 },
];

function mapearCatalogo(
  productos: D365ReleasedProduct[],
  barcodes: D365ProductBarcode[],
  conversiones: D365UnitConversion[],
): CatalogoItemDto[] {
  const barcodesPorItem = agruparBarcodesPorItem(barcodes);
  const conversionesPorItem = agruparConversionesPorProducto(conversiones);
  return productos.map((producto) =>
    mapearProducto(producto, barcodesPorItem.get(producto.ItemNumber) ?? [], conversionesPorItem.get(producto.ItemNumber) ?? []),
  );
}

/** modo='ejemplo': nunca toca red, siempre disponible sin credenciales. */
export function obtenerCatalogoEjemplo(): CatalogoItemDto[] {
  return mapearCatalogo(PRODUCTOS_EJEMPLO, BARCODES_EJEMPLO, CONVERSIONES_EJEMPLO);
}

/**
 * modo='real': trae ReleasedProductsV2 + ProductBarcodesV2 + las
 * conversiones de unidad, paginado. `ReleasedProducts`/`ProductBarcodes`
 * a secas (sin V2) dan 404 en el tenant real -- ver d365.types.ts.
 * ProductSpecificUnitOfMeasureConversions no acepta filtro por dataAreaId
 * (confirmado contra el tenant real), asi que se trae completa y se
 * agrupa localmente por ProductNumber en vez de filtrar por item.
 */
async function obtenerCatalogoReal(): Promise<CatalogoItemDto[]> {
  const filtroCompania = d365Config.dataAreaId ? `dataAreaId eq '${d365Config.dataAreaId}'` : undefined;

  const [productos, barcodes, conversiones] = await Promise.all([
    d365EntityService.obtenerTodos<D365ReleasedProduct>('ReleasedProductsV2', {
      $select: 'ItemNumber,SearchName,InventoryUnitSymbol,PurchaseUnitSymbol',
      ...(filtroCompania ? { $filter: filtroCompania } : {}),
    }),
    d365EntityService.obtenerTodos<D365ProductBarcode>('ProductBarcodesV2', {
      $select: 'ItemNumber,Barcode,ProductDescription,ProductQuantityUnitSymbol,ProductQuantity,IsDefaultDisplayedBarcode',
      ...(filtroCompania ? { $filter: filtroCompania } : {}),
    }),
    d365EntityService.obtenerTodos<D365UnitConversion>('ProductSpecificUnitOfMeasureConversions', {
      $select: 'ProductNumber,FromUnitSymbol,ToUnitSymbol,Factor',
    }),
  ]);

  return mapearCatalogo(productos, barcodes, conversiones);
}

// ---------------------------------------------------------------------------
// Snapshot (paso 1 del Coordinador) -- ver
// mobile/lib/puertos/repositorios.ts#RepositorioInventario.traerSnapshot
// ---------------------------------------------------------------------------

export interface SnapshotDto {
  inventarioId: number;
  items: number;
  tomadoEn: string;
}

/**
 * Idempotente: si la sucursal ya tiene un inventario, lo devuelve tal cual
 * en vez de crear uno nuevo (mismo contrato que el puerto del front) --
 * simplificacion documentada: como todavia no existe un modulo de
 * inventario/hojas en este backend, "ya tiene un inventario" se resuelve
 * como "existe al menos una fila", no "esta en curso sin cerrar".
 */
export async function crearSnapshot(sucursalId: number, modo: ModoCatalogo): Promise<SnapshotDto> {
  const existente = await prisma.inventario.findFirst({ where: { sucursalId }, orderBy: { id: 'desc' } });
  if (existente) {
    return {
      inventarioId: existente.id,
      items: existente.snapshotItems ?? 0,
      tomadoEn: (existente.snapshotTomadoEn ?? existente.createdAt).toISOString(),
    };
  }

  if (modo === 'real' && !d365Config.isConfigured()) {
    throw new ErrorHttp(
      400,
      'Dynamics no configurado. Configurá D365_TENANT_ID/D365_CLIENT_ID/D365_CLIENT_SECRET/D365_BASE_URL, o pedí el snapshot con modo "ejemplo".',
    );
  }

  const catalogo = modo === 'ejemplo' ? obtenerCatalogoEjemplo() : await obtenerCatalogoReal();
  const tomadoEn = new Date();

  const inventario = await prisma.inventario.create({
    data: { sucursalId, snapshotItems: catalogo.length, snapshotTomadoEn: tomadoEn },
  });

  if (catalogo.length > 0) {
    await prisma.catalogoItem.createMany({
      // `exactOptionalPropertyTypes` no deja `empaqueCodigoBarras: undefined`
      // explicito -- se omite la clave entera cuando no vino.
      data: catalogo.map((item) => ({
        inventarioId: inventario.id,
        codigo: item.codigo,
        codigoBarras: item.codigoBarras,
        descripcion: item.descripcion,
        empaqueNombre: item.empaque.nombre,
        empaqueFactor: item.empaque.factor,
        ...(item.empaque.codigoBarras !== undefined ? { empaqueCodigoBarras: item.empaque.codigoBarras } : {}),
      })),
    });
  }

  return { inventarioId: inventario.id, items: catalogo.length, tomadoEn: tomadoEn.toISOString() };
}
