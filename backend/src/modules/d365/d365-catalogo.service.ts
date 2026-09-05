/**
 * Catalogo de Dynamics mapeado a NUESTRO dominio (Producto/Empaque, ver
 * mobile/lib/dominio/tipos.ts) y el snapshot que consume el paso 1 del
 * wizard del Coordinador (RepositorioInventario.traerSnapshot).
 *
 * SOLO LECTURA: esta funcion nunca escribe de vuelta a Dynamics. El unico
 * lado que persiste algo es Postgres, del lado de aca.
 */

import { mensajeSinAlmacen } from '../tiendas/tiendas.almacen';
import { factorDesdeSimbolo } from '../../dominio/empaque';
import { prisma } from '../../config/database';
import { d365AuthService } from './d365-auth.service';
import {
  CLAVE_ALMACENES,
  filtrar as filtrarHabilitados,
  parsear as parsearAlmacenes,
} from './d365.almacenes-inventario';
import { registrarAuditoria } from '../../shared/auditoria';
import { ErrorHttp } from '../../shared/errores';
import { d365EntityService } from './d365-entity.service';
import * as progreso from './d365.progreso';
import type {
  CatalogoItemDto,
  D365ProductBarcode,
  D365ReleasedProduct,
  D365CategoriaItem,
  D365ResponsableItem,
  D365Almacen,
  D365PrecioVenta,
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
    // Se parsea EL MISMO simbolo que se usa de nombre. Mirar solo
    // `PurchaseUnitSymbol` daba un empaque llamado "Emp.12" con factor 1
    // cuando el numero venia en `InventoryUnitSymbol` -- visto en datos
    // reales (item 100018): el nombre decia 12 y la cuenta usaba 1.
    const factor = factorDesdeSimbolo(simbolo);
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
 * Categoria por ItemNumber, para ordenar las hojas.
 *
 * Se filtra por jerarquia aunque hoy el tenant tenga UNA sola ("Catalogo
 * Ventas"): el dia que alguien cargue "Catalogo Compras", sin este filtro el
 * mismo producto entraria dos veces y se contaria dos veces en gondola. El
 * costo de la linea es cero; el de no tenerla, una jornada de conteo.
 *
 * Ante dos filas de la misma jerarquia para un producto (no pasa hoy: 0/2000
 * en la muestra) gana la primera. Cualquier criterio sirve mientras sea UNO:
 * lo que no puede pasar es que el item aparezca duplicado.
 */
export const JERARQUIA_CATEGORIAS = 'Catalogo Ventas';

export function agruparCategoriasPorItem(categorias: D365CategoriaItem[]): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const c of categorias) {
    if (c.ProductCategoryHierarchyName !== JERARQUIA_CATEGORIAS) continue;
    if (!c.ProductNumber || !c.ProductCategoryName) continue;
    if (!mapa.has(c.ProductNumber)) mapa.set(c.ProductNumber, c.ProductCategoryName);
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

/**
 * Normaliza un simbolo de unidad para poder cruzarlo entre entidades.
 *
 * NO es cosmetica: medido contra el tenant real, `ReleasedProductsV2` dice
 * `"U."`, `"SA."`, `"LTR."` y `SalesPriceAgreements` dice `"U"`, `"SA"`,
 * `"LTR"`. Con comparacion exacta coinciden CERO de 1.554 filas -- o sea que
 * `precioVenta` habria quedado en null en el 100% del catalogo, en silencio y
 * sin ningun error. La diferencia es el punto final.
 */
export function normalizarUnidad(simbolo: string | null | undefined): string {
  if (!simbolo) return '';
  return simbolo.trim().replace(/\.+$/, '').toUpperCase();
}

export function agruparPreciosPorItem(filas: D365PrecioVenta[]): Map<string, D365PrecioVenta[]> {
  const mapa = new Map<string, D365PrecioVenta[]>();
  for (const fila of filas) {
    if (!fila.ItemNumber) continue;
    const previos = mapa.get(fila.ItemNumber);
    if (previos) previos.push(fila);
    else mapa.set(fila.ItemNumber, [fila]);
  }
  return mapa;
}

/**
 * Elige el precio de la UNIDAD SUELTA entre las filas de precio del item.
 *
 * Por que hay que elegir y no alcanza con tomar la primera: dentro de UN
 * almacen el mismo item puede tener dos filas, una por unidad y otra por
 * empaque. Caso real medido (item 101127, MD01_LUZ):
 *
 *     U        ->  S/  1.20
 *     Emp.20   ->  S/ 22.80
 *
 * `ItemAuditoria.precioVenta` valoriza UNIDADES (el conteo se convierte a
 * unidades con el factor del empaque). Tomar la fila del empaque valorizaria
 * cada unidad al precio de la caja: 20x de mas en la liquidacion de alguien.
 *
 * Y no se deriva el precio unitario dividiendo el del empaque: 1.20 x 20 =
 * 24, no 22.80. El empaque tiene descuento por volumen, asi que dividir
 * inventaria plata. Sin fila de unidad suelta, `null` -- no sabemos.
 */
export function elegirPrecioVenta(
  preciosDelItem: D365PrecioVenta[],
  unidadDeInventario: string | null | undefined,
): number | null {
  const objetivo = normalizarUnidad(unidadDeInventario);
  if (!objetivo) return null;

  const fila = preciosDelItem.find((p) => normalizarUnidad(p.QuantityUnitySymbol) === objetivo);
  if (!fila) return null;

  const precio = typeof fila.Price === 'number' ? fila.Price : Number(fila.Price);
  // 0 se trata como "sin precio": un producto de la gondola no vale cero, y
  // valorizarlo asi esconde el faltante en vez de mostrarlo.
  if (!Number.isFinite(precio) || precio <= 0) return null;
  return precio;
}

/**
 * SOLO SE CUENTA LO QUE TIENE EXISTENCIA. Decision del cliente, confirmada.
 *
 * Misma condicion que el desarrollo que ya usa la empresa en produccion
 * (app_inventarioautomatico, report.service.ts#buildReportRows:
 * `if (qty === undefined || qty <= 0) continue`). Descarta DOS cosas
 * distintas y por eso se cuentan por separado:
 *
 *   - `null`  -> el ERP no tiene registro de ese item en ese almacen.
 *   - `<= 0`  -> el ERP dice explicitamente que hay cero.
 *
 * La distincion no es academica: "no se" y "hay cero" llevan a
 * conversaciones distintas el dia que alguien pregunte por que una hoja no
 * trae tal producto. Por eso `resumirDescartes` los separa y el snapshot los
 * deja en el registro de auditoria.
 *
 * OJO con el riesgo, que existe y hay que tenerlo presente: un producto que
 * ESTA en la gondola pero que el ERP cree en cero nunca se va a contar. El
 * inventario deja de poder descubrir ese caso. Es la contrapartida de la
 * decision, no un efecto no deseado.
 */
export function tieneExistencia(stockErp: number | null): boolean {
  return stockErp !== null && stockErp > 0;
}

export interface DescartesPorStock {
  sinRegistro: number;
  stockCero: number;
}

export function resumirDescartes(items: { stockErp: number | null }[]): DescartesPorStock {
  let sinRegistro = 0;
  let stockCero = 0;
  for (const item of items) {
    if (item.stockErp === null) sinRegistro++;
    else if (item.stockErp <= 0) stockCero++;
  }
  return { sinRegistro, stockCero };
}

export function mapearProducto(
  producto: D365ReleasedProduct,
  barcodesDelItem: D365ProductBarcode[],
  conversionesDelItem: D365UnitConversion[],
  responsableCrudo?: string,
  stockErp: number | null = null,
  categoria: string | null = null,
  precioVenta: number | null = null,
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
    precioVenta,
    categoria,
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
  filtrarPorStock = false,
  categoriaPorItem: Map<string, string> = new Map(),
  preciosPorItem: Map<string, D365PrecioVenta[]> = new Map(),
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
      // Sin categoria el item NO se descarta: va al final del orden, junto
      // con los otros sin categoria. Un producto que esta en la gondola
      // tiene que contarse aunque el ERP no lo haya clasificado.
      categoriaPorItem.get(producto.ItemNumber) ?? null,
      // La unidad de inventario del PRODUCTO es la que decide cual de sus
      // filas de precio corresponde (ver elegirPrecioVenta).
      elegirPrecioVenta(preciosPorItem.get(producto.ItemNumber) ?? [], producto.InventoryUnitSymbol),
    ),
  );

  /**
   * ANUAL: se cuenta TODO, empresa incluida. El `esEmpresa` de cada item
   * queda mapeado igual -- la auditoria necesita saber de quien es cada
   * faltante aunque los cuente a todos.
   */
  const porResponsable =
    tipo === 'anual' || responsablePorItem.size === 0
      ? listos
      : listos.filter((_, i) => seCuenta(responsablePorItem.get(productos[i]!.ItemNumber)));

  /**
   * `filtrarPorStock` es explicito y no "hay mapa de stock, filtro": si la
   * consulta de stock falla y vuelve vacia, filtrar dejaria el inventario en
   * CERO items y el Coordinador no podria arrancar. Prefiero un catalogo de
   * mas, que se ve, a uno vacio por un error de red.
   */
  if (!filtrarPorStock) return porResponsable;
  return porResponsable.filter((item) => tieneExistencia(item.stockErp));
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
async function obtenerCatalogoReal(
  tipo: TipoInventario,
  almacen?: string,
  onProductos?: (traidos: number, total: number) => void,
): Promise<{ catalogo: CatalogoItemDto[]; descartes: DescartesPorStock }> {
  const dataAreaId = await d365AuthService.getDataAreaId();
  const filtroCompania = dataAreaId ? `dataAreaId eq '${dataAreaId}'` : undefined;

  const [productos, barcodes, conversiones, responsables, stock, categorias, precios] = await Promise.all([
    // El progreso sale de ESTA entidad y no de la suma de las 7: es la que
    // define el universo del catalogo y la que domina el tiempo. Ver el
    // comentario largo de d365.progreso.ts sobre por que el numero que se
    // reporta (productos bajados) no es el mismo que el del resultado
    // (items que entraron al inventario).
    d365EntityService.obtenerTodos<D365ReleasedProduct>(
      'ReleasedProductsV2',
      {
        $select: 'ItemNumber,SearchName,InventoryUnitSymbol,PurchaseUnitSymbol',
        ...(filtroCompania ? { $filter: filtroCompania } : {}),
      },
      undefined,
      onProductos,
    ),
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
    /**
     * CATEGORIAS -- lo que ORDENA las hojas de conteo.
     *
     * Mismo criterio que responsables: si falla, NO se cae el snapshot. Se
     * sigue sin categoria y las hojas salen por codigo, que es como salian
     * antes de esto. Un recorrido peor es un problema; un inventario que no
     * se puede arrancar es otro mucho mayor.
     *
     * No lleva `filtroCompania`: la entidad no expone `dataAreaId` (las
     * categorias son del producto, no de la empresa que lo vende).
     */
    d365EntityService
      .obtenerTodos<D365CategoriaItem>('ProductCategoryAssignments', {
        $select: 'ProductNumber,ProductCategoryHierarchyName,ProductCategoryName',
      })
      .catch(() => [] as D365CategoriaItem[]),
    /**
     * EL PRECIO TAMPOCO VIENE DEL CATALOGO, igual que el stock: vive en
     * `SalesPriceAgreements` y es POR ALMACEN (el mismo item vale distinto en
     * cada tienda -- medido: hasta 15 filas por item sin filtrar).
     *
     * Sin `almacen` no se consulta: traer el consolidado mezclaria precios de
     * las 4 sucursales y valorizaria el faltante de una con el precio de otra.
     *
     * `.catch(() => [])` como las demas: si esta entidad falla, el snapshot
     * sigue y los precios quedan en null. Un catalogo sin precio se puede
     * auditar en unidades; un snapshot que no existe deja al Coordinador sin
     * poder arrancar.
     */
    almacen
      ? d365EntityService
          .obtenerTodos<D365PrecioVenta>('SalesPriceAgreements', {
            $filter: `PriceWarehouseId eq '${almacen}'`,
            $select: 'ItemNumber,Price,QuantityUnitySymbol,PriceWarehouseId,PriceCurrencyCode',
          })
          .catch(() => [] as D365PrecioVenta[])
      : Promise.resolve([] as D365PrecioVenta[]),
  ]);

  /**
   * Se mapea SIN filtrar para poder contar por que quedo afuera cada item, y
   * recien despues se filtra. Contar primero es lo que permite responder "por
   * que esta hoja no trae tal producto" sin volver a golpear Dynamics.
   */
  const sinFiltrar = mapearCatalogo(
    productos,
    barcodes,
    conversiones,
    responsables,
    tipo,
    agruparStockPorItem(stock),
    false,
    agruparCategoriasPorItem(categorias),
    agruparPreciosPorItem(precios),
  );
  const descartes = resumirDescartes(sinFiltrar);

  // Solo se filtra si de verdad se consulto stock: sin almacen no hay dato y
  // filtrar dejaria el inventario vacio.
  const catalogo = almacen ? sinFiltrar.filter((item) => tieneExistencia(item.stockErp)) : sinFiltrar;
  return { catalogo, descartes };
}

// ---------------------------------------------------------------------------
// Almacenes -- para ELEGIR, no para tipear
// ---------------------------------------------------------------------------

export interface AlmacenDto {
  codigo: string;
  nombre: string;
}

/**
 * Lista los almacenes de Dynamics para que el Administrador elija uno al dar
 * de alta una tienda.
 *
 * POR QUE UN ENDPOINT Y NO UN CAMPO DE TEXTO: un codigo mal tipeado no falla
 * -- trae el stock de OTRA tienda. La auditoria compara contra numeros que
 * parecen validos y nadie se entera hasta que no cuadra a fin de mes. Si la
 * lista sale del ERP, el error deja de ser posible.
 *
 * FILTRADA por `ALMACENES_INVENTARIO` (ver d365.almacenes-inventario.ts): el
 * tenant tiene 70 almacenes y solo un punado se inventaria. Los de Transito
 * (mercaderia en viaje) y Cuarentena (mercaderia bloqueada) NO se cuentan, y
 * sus nombres se parecen tanto a los de tienda que elegir el equivocado es
 * cuestion de tiempo: "ALMACEN CUARENTENA MARKET LUZURIAGA" contra "ALMACEN
 * DISPONIBLE MARKET LUZURIAGA".
 *
 * `todos: true` saltea el filtro -- es para dar de alta una tienda cuyo
 * almacen todavia no esta habilitado. No se saca el filtro entero por eso:
 * el caso raro no puede volver peligroso el caso comun.
 *
 * Se ordena por codigo: la lista se lee, no se busca.
 */
export async function listarAlmacenes(opciones?: { todos?: boolean }): Promise<AlmacenDto[]> {
  const almacenes = await d365EntityService.obtenerTodos<D365Almacen>('Warehouses', {
    $select: 'WarehouseId,WarehouseName',
  });

  const listados = almacenes
    .filter((a) => a.WarehouseId)
    .map((a) => ({ codigo: a.WarehouseId, nombre: a.WarehouseName || a.WarehouseId }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo));

  if (opciones?.todos === true) return listados;
  return filtrarHabilitados(listados, await almacenesHabilitados());
}

/** Los codigos habilitados, leidos de `Configuracion`. Vacio = sin filtro. */
export async function almacenesHabilitados(): Promise<string[]> {
  const fila = await prisma.configuracion.findUnique({ where: { clave: CLAVE_ALMACENES } });
  return parsearAlmacenes(fila?.valor);
}

// ---------------------------------------------------------------------------
// Snapshot (paso 1 del Coordinador) -- ver
// mobile/lib/puertos/repositorios.ts#RepositorioInventario.traerSnapshot
// ---------------------------------------------------------------------------

export interface SnapshotDto {
  inventarioId: number;
  /** Items CONTABLES: los que quedaron tras el filtro de existencia. */
  items: number;
  tomadoEn: string;
  /** Cuantos quedaron afuera y por que. Ausente en un inventario ya existente. */
  descartados?: DescartesPorStock;
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
  almacenOverride?: string,
  actorId = 0,
): Promise<SnapshotDto> {
  const sucursal = await prisma.sucursal.findUnique({
    where: { id: sucursalId },
    select: { id: true, nombre: true, almacenId: true },
  });
  if (sucursal === null) throw new ErrorHttp(404, `No existe la sucursal ${sucursalId}.`);

  // IDEMPOTENTE sobre el inventario EN CURSO, no sobre "la fila mas
  // reciente". La diferencia importa desde que existe `tipo`: buscar
  // cualquier fila hacia que un mensual ya cerrado impidiera abrir el anual
  // -- y con `abierto` en el schema, "en curso" ya se puede preguntar bien.
  const enCurso = await prisma.inventario.findFirst({ where: { sucursalId, abierto: true } });
  if (enCurso) {
    return {
      inventarioId: enCurso.id,
      items: enCurso.snapshotItems ?? 0,
      tomadoEn: (enCurso.snapshotTomadoEn ?? enCurso.createdAt).toISOString(),
    };
  }

  /**
   * EL ALMACEN SALE DE LA SUCURSAL, no de un parametro suelto.
   *
   * Decision del cliente: "al crear el sitio, se debe asociar el almacen".
   * El parametro `almacenOverride` queda como excepcion explicita (probar
   * otro almacen sin reconfigurar la tienda), pero el camino normal es que
   * nadie lo mande y el dato salga de donde vive.
   *
   * Que sea la sucursal y no un parametro es lo que hace imposible el error
   * caro: un almacen tipeado en cada llamada es un almacen que alguna vez se
   * va a tipear mal, y traer el stock de otra tienda no falla -- devuelve
   * numeros que parecen validos.
   */
  const almacen = almacenOverride ?? sucursal.almacenId ?? undefined;

  if (modo === 'real' && almacen === undefined) {
    throw new ErrorHttp(400, mensajeSinAlmacen(sucursal.nombre));
  }

  if (modo === 'real' && !(await d365AuthService.isConfigured())) {
    throw new ErrorHttp(
      400,
      'Dynamics no configurado. Configurá D365_TENANT_ID/D365_CLIENT_ID/D365_CLIENT_SECRET/D365_BASE_URL, o pedí el snapshot con modo "ejemplo".',
    );
  }

  /**
   * PROGRESO CONSULTABLE, de punta a punta de lo que tarda.
   *
   * `iniciar` antes de la primera llamada a Dynamics y `terminar` en un
   * `finally`: si esto revienta a mitad de camino, el progreso NO puede
   * quedar colgado en "bajando" para siempre -- el proximo sondeo mostraria
   * el avance de un snapshot que ya no existe.
   *
   * El modo `ejemplo` tambien lo registra aunque sea instantaneo: asi el
   * front no tiene dos caminos distintos segun el modo.
   */
  progreso.iniciar(sucursalId);
  let catalogo: CatalogoItemDto[];
  let descartes: DescartesPorStock;
  try {
    const resultado =
      modo === 'ejemplo'
        ? { catalogo: obtenerCatalogoEjemplo(), descartes: { sinRegistro: 0, stockCero: 0 } }
        : await obtenerCatalogoReal(tipo, almacen, (traidos, total) =>
            progreso.reportar(sucursalId, traidos, total),
          );
    catalogo = resultado.catalogo;
    descartes = resultado.descartes;
    // La OTRA fase lenta: guardar. Son N `create` dentro de una sola
    // transaccion (ver abajo), asi que hasta el commit no hay ni una fila
    // visible -- por eso se marca la fase en vez de seguir contando items.
    progreso.marcarGuardando(sucursalId);
    return await guardarSnapshot({ sucursalId, tipo, catalogo, descartes, actorId, almacen, modo });
  } finally {
    progreso.terminar(sucursalId);
  }
}

/**
 * Progreso del snapshot en curso de esa sucursal, o `null` si no hay ninguno.
 * Ver d365.progreso.ts para por que vive en memoria y que numero reporta.
 */
export function progresoDeSnapshot(sucursalId: number): progreso.ProgresoSnapshot | null {
  return progreso.leer(sucursalId);
}

/** El guardado, separado para que `crearSnapshot` pueda envolverlo en el progreso. */
async function guardarSnapshot(args: {
  sucursalId: number;
  tipo: TipoInventario;
  catalogo: CatalogoItemDto[];
  descartes: DescartesPorStock;
  actorId: number;
  /** `undefined` explícito: el proyecto corre con `exactOptionalPropertyTypes`. */
  almacen: string | undefined;
  modo: ModoCatalogo;
}): Promise<SnapshotDto> {
  const { sucursalId, tipo, catalogo, descartes, actorId, almacen } = args;
  const tomadoEn = new Date();

  const inventario = await prisma.inventario.create({
    // `tipo` se guarda en el inventario: es lo que define QUE universo se
    // conto, y sin el nadie puede saber despues si esos 6.297 items eran
    // "solo responsabilidad del empleado" o un anual incompleto.
    data: { sucursalId, tipo, snapshotItems: catalogo.length, snapshotTomadoEn: tomadoEn },
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
            // null cuando no hay fila de precio para la unidad suelta:
            // nunca 0 (ver elegirPrecioVenta).
            precioVenta: item.precioVenta,
            // El ORDEN con el que se van a armar las hojas de conteo. Se
            // guarda con el snapshot y no se recalcula despues: si manana
            // alguien reclasifica un producto en Dynamics, las hojas ya
            // repartidas no pueden cambiar de contenido debajo de quien las
            // esta contando. Mismo criterio que `stockErp`.
            categoria: item.categoria,
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

  /**
   * Queda registrado CUANTOS quedaron afuera y por que. No es telemetria:
   * es la respuesta a "por que esta hoja no trae tal producto", que alguien
   * va a preguntar, y sin esto habria que volver a correr el snapshot para
   * contestarla.
   */
  await registrarAuditoria({
    actorId,
    accion: 'inventario.snapshot',
    entidad: 'inventario',
    entidadId: inventario.id,
    detalle: {
      tipo,
      almacen: almacen ?? null,
      itemsContables: catalogo.length,
      descartadosSinRegistro: descartes.sinRegistro,
      descartadosStockCero: descartes.stockCero,
    },
  });

  return {
    inventarioId: inventario.id,
    items: catalogo.length,
    tomadoEn: tomadoEn.toISOString(),
    descartados: descartes,
  };
}
