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
import type { CatalogoItemDto, D365ProductBarcode, D365ReleasedProduct, EmpaqueDto } from './d365.types';

export type ModoCatalogo = 'real' | 'ejemplo';

// ---------------------------------------------------------------------------
// Mapeo (puro, sin red ni DB -- ver d365-catalogo.test.ts)
// ---------------------------------------------------------------------------

/** Agrupa los codigos de barra de ProductBarcodes por ItemNumber. */
export function agruparBarcodesPorItem(barcodes: D365ProductBarcode[]): Map<string, D365ProductBarcode[]> {
  const mapa = new Map<string, D365ProductBarcode[]>();
  for (const barcode of barcodes) {
    const existentes = mapa.get(barcode.ItemNumber) ?? [];
    existentes.push(barcode);
    mapa.set(barcode.ItemNumber, existentes);
  }
  return mapa;
}

/**
 * Un producto de D365 a nuestro Producto (sin `id`/`ubicacion`, que salen
 * de la hoja, no del catalogo). Regla de mapeo:
 *   - codigoBarras (unidad SUELTA) = el barcode con ProductQuantity===1,
 *     o el marcado IsDefaultDisplayedBarcode, o el primero que haya.
 *   - empaque = el primer barcode con ProductQuantity>1 (nombre =
 *     ProductQuantityUnitSymbol, factor = ProductQuantity). Si D365 no
 *     tiene ningun barcode de empaque para ese item, el empaque queda en
 *     factor 1 con la unidad de inventario de D365 -- nuestro dominio
 *     exige un Empaque siempre, a diferencia del proyecto hermano, que
 *     admite VARIAS unidades alternas por producto; nosotros solo
 *     modelamos una, asi que si D365 trae mas de una se toma la primera
 *     y el resto se pierde (ver README para esta limitacion documentada).
 */
export function mapearProducto(producto: D365ReleasedProduct, barcodesDelItem: D365ProductBarcode[]): CatalogoItemDto {
  const ordenados = [...barcodesDelItem].sort((a, b) => (a.ProductQuantity ?? 1) - (b.ProductQuantity ?? 1));

  const suelto =
    ordenados.find((b) => b.IsDefaultDisplayedBarcode === 'Yes') ??
    ordenados.find((b) => (b.ProductQuantity ?? 1) === 1) ??
    ordenados[0];

  const alterno = ordenados.find((b) => b !== suelto && (b.ProductQuantity ?? 1) > 1);

  const descripcion = producto.ProductName || producto.ProductDescription || producto.ItemNumber;

  const empaque: EmpaqueDto = alterno
    ? {
        nombre: alterno.ProductQuantityUnitSymbol || `x${alterno.ProductQuantity}`,
        factor: alterno.ProductQuantity ?? 1,
        ...(alterno.Barcode ? { codigoBarras: alterno.Barcode } : {}),
      }
    : { nombre: producto.InventoryUnitSymbol || producto.PurchaseUnitSymbol || 'UND', factor: 1 };

  return {
    codigo: producto.ItemNumber,
    // Sin ningun barcode: el ItemNumber hace de codigo de barras de ultimo
    // recurso -- nunca se deja vacio, el escaner necesita algo para matchear.
    codigoBarras: suelto?.Barcode || producto.ItemNumber,
    descripcion,
    empaque,
  };
}

// ---------------------------------------------------------------------------
// Datos de ejemplo -- mismos 4 productos/empaques/codigos de barra que ya
// usa mobile/lib/adaptadores/_compartido.ts (BASE_PRODUCTOS): no se inventan
// datos nuevos, se reusa lo que el cliente ya valido en la maqueta.
// ---------------------------------------------------------------------------

const PRODUCTOS_EJEMPLO: D365ReleasedProduct[] = [
  { ItemId: '0051', ItemNumber: '0051', ProductName: 'Aceite Vegetal Primor 1L', InventoryUnitSymbol: 'UND' },
  { ItemId: '0052', ItemNumber: '0052', ProductName: 'Cerveza Cusqueña Trigo 310ml', InventoryUnitSymbol: 'UND' },
  { ItemId: '0053', ItemNumber: '0053', ProductName: 'Leche Evaporada Gloria Azul 400g', InventoryUnitSymbol: 'UND' },
  { ItemId: '0054', ItemNumber: '0054', ProductName: 'Fideos Canuto Lavaggi 500g', InventoryUnitSymbol: 'UND' },
];

const BARCODES_EJEMPLO: D365ProductBarcode[] = [
  { ItemNumber: '0051', Barcode: '7750123051', ProductQuantity: 1, ProductQuantityUnitSymbol: 'UND', IsDefaultDisplayedBarcode: 'Yes' },
  { ItemNumber: '0051', Barcode: '7750123051012', ProductQuantity: 12, ProductQuantityUnitSymbol: 'Caja' },
  { ItemNumber: '0052', Barcode: '7750999015', ProductQuantity: 1, ProductQuantityUnitSymbol: 'UND', IsDefaultDisplayedBarcode: 'Yes' },
  { ItemNumber: '0052', Barcode: '7750999015006', ProductQuantity: 6, ProductQuantityUnitSymbol: 'Pack' },
  { ItemNumber: '0053', Barcode: '7750123088', ProductQuantity: 1, ProductQuantityUnitSymbol: 'UND', IsDefaultDisplayedBarcode: 'Yes' },
  { ItemNumber: '0053', Barcode: '7750123088024', ProductQuantity: 24, ProductQuantityUnitSymbol: 'Plancha' },
  { ItemNumber: '0054', Barcode: '7750123054', ProductQuantity: 1, ProductQuantityUnitSymbol: 'UND', IsDefaultDisplayedBarcode: 'Yes' },
  { ItemNumber: '0054', Barcode: '7750123054020', ProductQuantity: 20, ProductQuantityUnitSymbol: 'Fardo' },
];

function mapearCatalogo(productos: D365ReleasedProduct[], barcodes: D365ProductBarcode[]): CatalogoItemDto[] {
  const barcodesPorItem = agruparBarcodesPorItem(barcodes);
  return productos.map((producto) => mapearProducto(producto, barcodesPorItem.get(producto.ItemNumber) ?? []));
}

/** modo='ejemplo': nunca toca red, siempre disponible sin credenciales. */
export function obtenerCatalogoEjemplo(): CatalogoItemDto[] {
  return mapearCatalogo(PRODUCTOS_EJEMPLO, BARCODES_EJEMPLO);
}

/** modo='real': trae ReleasedProducts + ProductBarcodes de Dynamics, paginado. */
async function obtenerCatalogoReal(): Promise<CatalogoItemDto[]> {
  const filtroCompania = d365Config.dataAreaId ? `dataAreaId eq '${d365Config.dataAreaId}'` : undefined;

  const [productos, barcodes] = await Promise.all([
    d365EntityService.obtenerTodos<D365ReleasedProduct>('ReleasedProducts', {
      $select: 'ItemId,ItemNumber,ProductName,ProductDescription,ProductType,ItemModelGroupId,ProductGroupId,SearchName,InventoryUnitSymbol,PurchaseUnitSymbol',
      ...(filtroCompania ? { $filter: filtroCompania } : {}),
    }),
    d365EntityService.obtenerTodos<D365ProductBarcode>('ProductBarcodes', {
      $select: 'ItemNumber,Barcode,ProductQuantityUnitSymbol,ProductQuantity,IsDefaultDisplayedBarcode',
      ...(filtroCompania ? { $filter: filtroCompania } : {}),
    }),
  ]);

  return mapearCatalogo(productos, barcodes);
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
