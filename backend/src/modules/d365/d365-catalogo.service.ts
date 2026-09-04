/**
 * Catalogo de Dynamics mapeado a NUESTRO dominio (Producto/Empaque, ver
 * mobile/lib/dominio/tipos.ts) y el snapshot que consume el paso 1 del
 * wizard del Coordinador (RepositorioInventario.traerSnapshot).
 *
 * SOLO LECTURA: esta funcion nunca escribe de vuelta a Dynamics. El unico
 * lado que persiste algo es Postgres, del lado de aca.
 */

import { d365Config } from '../../config/d365.config';
import { factorDesdeSimbolo } from '../../dominio/empaque';
import { prisma } from '../../config/database';
import { ErrorHttp } from '../../shared/errores';
import { d365EntityService } from './d365-entity.service';
import type {
  CatalogoItemDto,
  D365ProductBarcode,
  D365ReleasedProduct,
  D365ResponsableItem,
  D365StockAlmacen,
  D365UnitConversion,
  EmpaqueDto,
} from './d365.types';

export type ModoCatalogo = 'real' | 'ejemplo';

/**
 * Los dos universos del inventario (ver d365.schema.ts para la decision del
 * cliente). No es una preferencia de configuracion: cambia QUE se cuenta.
 */
export type TipoInventario = 'mensual' | 'anual';

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
 * El/los empaque/s de un producto salen de
 * ProductSpecificUnitOfMeasureConversions, NO de
 * ProductBarcodesV2.ProductQuantity (que en este tenant siempre es 0 -- ver
 * el comentario largo en d365.types.ts#D365ProductBarcode). Una fila con
 * Factor=1 es solo la equivalencia entre "U" y "U." (misma unidad, distinta
 * grafia) y no cuenta como empaque; el resto (Factor != 1) son empaques
 * alternos de verdad, ej. `{FromUnitSymbol:'Emp.12', Factor:12}`.
 *
 * Nuestro dominio ahora modela VARIOS Empaque por producto (decision del
 * cliente: un mismo item puede venir en Caja x12 Y Pack x6) -- antes se
 * descartaban todos menos el de mayor factor. Se devuelven ordenados de
 * mayor a menor factor: el mas grande (ej. Caja antes que Pack) queda
 * primero, mismo criterio que ya usaba el desempate viejo, ahora aplicado
 * al orden de oferta en vez de a un descarte.
 */
export function elegirEmpaques(conversionesDelProducto: D365UnitConversion[], producto: D365ReleasedProduct): EmpaqueDto[] {
  const factoresPorUnidad = new Map<string, number>();
  for (const conversion of conversionesDelProducto) {
    if (conversion.Factor && conversion.Factor !== 1) {
      factoresPorUnidad.set(conversion.FromUnitSymbol, conversion.Factor);
    }
  }

  /**
   * RESPALDO -- no reemplazo.
   *
   * Cuando D365 tiene una conversion de unidad, ESE numero manda: es un dato
   * explicito del ERP, no una lectura del nombre. Parsear el texto por encima
   * de una conversion seria cambiar un dato duro por una inferencia.
   *
   * Pero 3.728 de 11.835 productos no tienen ninguna conversion cargada, y
   * para esos el unico lugar donde vive el factor es el nombre de la unidad
   * de compra ("Emp.12"). Ahi aplica la regla del cliente
   * (dominio/empaque.ts): sacar el numero, y si no hay, factor 1.
   */
  if (factoresPorUnidad.size === 0) {
    const simbolo = producto.PurchaseUnitSymbol || producto.InventoryUnitSymbol || 'UND';
    const factor = factorDesdeSimbolo(producto.PurchaseUnitSymbol);
    return [{ nombre: simbolo, factor }];
  }

  return [...factoresPorUnidad.entries()].sort((a, b) => b[1] - a[1]).map(([nombre, factor]) => ({ nombre, factor }));
}

/**
 * Un producto de D365 a nuestro Producto (sin `id`/`ubicacion`, que salen
 * de la hoja, no del catalogo).
 *   - codigoBarras (unidad SUELTA) = el barcode marcado
 *     IsDefaultDisplayedBarcode, o el primero que haya (ProductQuantity no
 *     sirve de desempate en este tenant: siempre es 0).
 *   - descripcion = ProductBarcodesV2.ProductDescription (nombre legible de
 *     verdad) y si no hay barcode, SearchName de ReleasedProductsV2.
 *   - cada empaque.codigoBarras NUNCA se llena: no existe un barcode
 *     especifico por empaque en este tenant (ver D365ProductBarcode) --
 *     queda siempre undefined, a proposito.
 */
/**
 * SOLO SE CUENTA LO QUE ES RESPONSABILIDAD DEL EMPLEADO.
 *
 * `TRU_InventoryManagerPEEntities` es una entidad CUSTOM del tenant de
 * Market Trujillo: por cada item dice quien responde por su faltante.
 * Valores crudos `Employee` / `Company` / `None`.
 *
 * Se descubrio leyendo el desarrollo que el cliente ya usa
 * (D:/Documentos/node/app_inventarioautomatico, sync.service.ts +
 * report.service.ts#buildReportRows): ahi el reporte de conteo descarta
 * todo lo que no sea `Employee`. No es una convencion nuestra -- es la
 * regla que la empresa ya aplica hoy en papel.
 *
 * `ModuleType === 'Invent'` filtra las filas de inventario: la misma
 * entidad guarda responsables de otros modulos.
 */
const RESPONSABLE_EMPLEADO = 'Employee';
const RESPONSABLE_EMPRESA = 'Company';

export function agruparResponsablesPorItem(responsables: D365ResponsableItem[]): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const r of responsables) {
    if (r.ModuleType === 'Invent' && r.ItemId) mapa.set(r.ItemId, r.TRU_InventoryManagerPE);
  }
  return mapa;
}

/**
 * Un item entra al inventario solo si su responsable es el Empleado.
 *
 * Los `Company` no se cuentan (los asume la empresa) y los `None` o sin
 * fila TAMPOCO: sin responsable asignado no hay a quien liquidarle una
 * diferencia, y contar algo que despues nadie puede resolver solo agrega
 * ruido a la auditoria. Mismo criterio que el reporte que el cliente ya usa.
 */
export function seCuenta(responsableCrudo: string | undefined): boolean {
  return responsableCrudo === RESPONSABLE_EMPLEADO;
}

export function esDeLaEmpresa(responsableCrudo: string | undefined): boolean {
  return responsableCrudo === RESPONSABLE_EMPRESA;
}

/**
 * Stock por item para UN almacen. `WarehousesOnHandV2` devuelve una fila por
 * (item, almacen): filtrando por almacen, cada item aparece una sola vez.
 *
 * Se suman las filas repetidas por las dudas (dimensiones de inventario
 * distintas del mismo item en el mismo almacen): sumar es lo correcto, quedarse
 * con la ultima perderia existencias.
 */
export function agruparStockPorItem(filas: D365StockAlmacen[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const fila of filas) {
    if (!fila.ItemNumber) continue;
    const cantidad = typeof fila.OnHandQuantity === 'number' ? fila.OnHandQuantity : 0;
    mapa.set(fila.ItemNumber, (mapa.get(fila.ItemNumber) ?? 0) + cantidad);
  }
  return mapa;
}

export function mapearProducto(
  producto: D365ReleasedProduct,
  barcodesDelItem: D365ProductBarcode[],
  conversionesDelItem: D365UnitConversion[],
  responsableCrudo?: string,
  stockErp: number | null = null,
): CatalogoItemDto {
  const suelto = barcodesDelItem.find((b) => b.IsDefaultDisplayedBarcode === 'Yes') ?? barcodesDelItem[0];

  const descripcion = suelto?.ProductDescription || producto.SearchName || producto.ItemNumber;

  return {
    codigo: producto.ItemNumber,
    // Sin ningun barcode: el ItemNumber hace de codigo de barras de ultimo
    // recurso -- nunca se deja vacio, el escaner necesita algo para matchear.
    codigoBarras: suelto?.Barcode || producto.ItemNumber,
    descripcion,
    empaques: elegirEmpaques(conversionesDelItem, producto),
    esEmpresa: esDeLaEmpresa(responsableCrudo),
    stockErp,
  };
}

// ---------------------------------------------------------------------------
// Datos de ejemplo -- mismos 4 productos/empaques/codigos de barra que ya
// usa mobile/lib/adaptadores/_compartido.ts (BASE_PRODUCTOS): no se inventan
// datos nuevos, se reusa lo que el cliente ya valido en la maqueta. Forma
// alineada a como responde el tenant real (barcode SIEMPRE de unidad
// suelta, factor en una conversion aparte).
//
// El Aceite (0051) suma un segundo empaque alterno (Emp.6, "Pack") para que
// el modo "ejemplo" pueda probar de verdad la pantalla con mas de un
// empaque por producto -- mismo criterio que
// mobile/lib/adaptadores/_compartido.ts#BASE_PRODUCTOS, que ya tiene ese
// producto con ['caja', 'pack'].
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
  // Segundo empaque alterno del mismo producto -- ver el comentario de la
  // seccion de arriba.
  { ProductNumber: '0051', FromUnitSymbol: 'Emp.6', ToUnitSymbol: 'U', Factor: 6 },
  { ProductNumber: '0052', FromUnitSymbol: 'U', ToUnitSymbol: 'U.', Factor: 1 },
  { ProductNumber: '0052', FromUnitSymbol: 'Emp.6', ToUnitSymbol: 'U', Factor: 6 },
  { ProductNumber: '0053', FromUnitSymbol: 'U', ToUnitSymbol: 'U.', Factor: 1 },
  { ProductNumber: '0053', FromUnitSymbol: 'Emp.24', ToUnitSymbol: 'U', Factor: 24 },
  { ProductNumber: '0054', FromUnitSymbol: 'U', ToUnitSymbol: 'U.', Factor: 1 },
  { ProductNumber: '0054', FromUnitSymbol: 'Emp.20', ToUnitSymbol: 'U', Factor: 20 },
];

export function mapearCatalogo(
  productos: D365ReleasedProduct[],
  barcodes: D365ProductBarcode[],
  conversiones: D365UnitConversion[],
  responsables: D365ResponsableItem[] = [],
  tipo: TipoInventario = 'mensual',
  stockPorItem: Map<string, number> = new Map(),
): CatalogoItemDto[] {
  const barcodesPorItem = agruparBarcodesPorItem(barcodes);
  const conversionesPorItem = agruparConversionesPorProducto(conversiones);
  const responsablePorItem = agruparResponsablesPorItem(responsables);

  /**
   * El filtro se aplica ACA y no con un `$filter` de OData, y no es por
   * comodidad: el responsable vive en OTRA entidad
   * (TRU_InventoryManagerPEEntities), asi que OData no puede cruzarlo en la
   * misma consulta. El proyecto de referencia hace exactamente lo mismo.
   *
   * Si no llego ningun responsable (la entidad fallo o el tenant no la
   * tiene), NO se filtra nada: es preferible un catalogo de mas que uno
   * vacio por un error de red. Se ve en `snapshotItems` y se puede revisar.
   */
  const listos = productos.map((producto) =>
    mapearProducto(
      producto,
      barcodesPorItem.get(producto.ItemNumber) ?? [],
      conversionesPorItem.get(producto.ItemNumber) ?? [],
      responsablePorItem.get(producto.ItemNumber),
      // `?? null` y NUNCA `?? 0`: un item sin fila de stock es "no sabemos",
      // no "hay cero". Ver CatalogoItemDto.stockErp.
      stockPorItem.get(producto.ItemNumber) ?? null,
    ),
  );

  /**
   * ANUAL: se cuenta TODO, empresa incluida. El `esEmpresa` de cada item
   * queda mapeado igual -- la auditoria necesita saber de quien es cada
   * faltante aunque los cuente a todos.
   */
  if (tipo === 'anual') return listos;

  if (responsablePorItem.size === 0) return listos;
  return listos.filter((_, i) => seCuenta(responsablePorItem.get(productos[i]!.ItemNumber)));
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
async function obtenerCatalogoReal(tipo: TipoInventario, almacen?: string): Promise<CatalogoItemDto[]> {
  const filtroCompania = d365Config.dataAreaId ? `dataAreaId eq '${d365Config.dataAreaId}'` : undefined;

  const [productos, barcodes, conversiones, responsables, stock] = await Promise.all([
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
    // Si esta entidad falla NO se cae el snapshot entero: se sigue sin
    // filtro (ver mapearCatalogo). Un catalogo de mas es revisable; un
    // snapshot que no existe deja al Coordinador sin poder arrancar.
    d365EntityService
      .obtenerTodos<D365ResponsableItem>('TRU_InventoryManagerPEEntities', {
        $select: 'ItemId,ModuleType,TRU_InventoryManagerPE',
      })
      .catch(() => [] as D365ResponsableItem[]),
    /**
     * EL STOCK NO VIENE DEL CATALOGO DE PRODUCTOS: vive en una data entity
     * aparte, `WarehousesOnHandV2`, y se consulta POR ALMACEN. Por eso no
     * aparecia por mas campos que se le agregaran al $select de
     * ReleasedProductsV2.
     *
     * Sin `almacen` no se consulta nada y todo queda en null -- traer el
     * consolidado de las 4 sucursales seria peor que no tener el dato: la
     * auditoria de Luzuriaga compararia contra el stock de todas.
     */
    almacen
      ? d365EntityService
          .obtenerTodos<D365StockAlmacen>('WarehousesOnHandV2', {
            $filter: `InventoryWarehouseId eq '${almacen}'`,
            $select: 'ItemNumber,InventoryWarehouseId,OnHandQuantity,AvailableOnHandQuantity,TotalAvailableQuantity',
          })
          .catch(() => [] as D365StockAlmacen[])
      : Promise.resolve([] as D365StockAlmacen[]),
  ]);

  return mapearCatalogo(productos, barcodes, conversiones, responsables, tipo, agruparStockPorItem(stock));
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
export async function crearSnapshot(
  sucursalId: number,
  modo: ModoCatalogo,
  tipo: TipoInventario = 'mensual',
  almacen?: string,
): Promise<SnapshotDto> {
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

  const catalogo = modo === 'ejemplo' ? obtenerCatalogoEjemplo() : await obtenerCatalogoReal(tipo, almacen);
  const tomadoEn = new Date();

  const inventario = await prisma.inventario.create({
    data: { sucursalId, snapshotItems: catalogo.length, snapshotTomadoEn: tomadoEn },
  });

  if (catalogo.length > 0) {
    // `createMany` no acepta escrituras anidadas (cada item ahora trae una
    // LISTA de empaques, no columnas planas) -- por eso es un create por
    // item envuelto en $transaction, y no un solo createMany masivo.
    await prisma.$transaction(
      catalogo.map((item) =>
        prisma.catalogoItem.create({
          data: {
            inventarioId: inventario.id,
            codigo: item.codigo,
            codigoBarras: item.codigoBarras,
            descripcion: item.descripcion,
            // Dato del ERP, no calculado: quien responde por el faltante de
            // este item (ver seCuenta/esDeLaEmpresa). Hasta ahora quedaba
            // NULL en la base y la auditoria no podia distinguirlos.
            esEmpresa: item.esEmpresa,
            // null cuando no hubo dato: nunca 0 (ver CatalogoItemDto.stockErp).
            stockErp: item.stockErp,
            empaques: {
              // `exactOptionalPropertyTypes` no deja `codigoBarras: undefined`
              // explicito -- se omite la clave entera cuando no vino.
              create: item.empaques.map((empaque, orden) => ({
                nombre: empaque.nombre,
                factor: empaque.factor,
                orden,
                ...(empaque.codigoBarras !== undefined ? { codigoBarras: empaque.codigoBarras } : {}),
              })),
            },
          },
        }),
      ),
    );
  }

  return { inventarioId: inventario.id, items: catalogo.length, tomadoEn: tomadoEn.toISOString() };
}
