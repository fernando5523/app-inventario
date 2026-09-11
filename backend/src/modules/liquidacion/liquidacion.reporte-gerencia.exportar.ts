/**
 * El EXCEL del REPORTE A GERENCIA: los productos de EMPRESA con sus sobrantes
 * y faltantes, para presentar a gerencia -- pedido del cliente: "listar
 * detallado, tanto sobrante como faltante".
 *
 * Los datos salen de `obtenerReporteGerencia` (liquidacion.reporte-gerencia.ts),
 * la MISMA funcion que alimenta la pantalla: que productos entran, en que
 * lista y con que monto se decide una sola vez. Este archivo solo agrega el
 * contexto (tienda, periodo) y la trazabilidad de cada producto (codigo de
 * barras, categoria, stock, conteo, precio), y arma el libro.
 *
 * LAS MISMAS COLUMNAS QUE EL EXPORT DE DIFERENCIAS
 * (historial.exportar.ts#ENCABEZADOS_EXPORT_DIFERENCIAS), a proposito: aquel
 * trae lo del Empleado, este lo de la Empresa, y la columna Responsable los
 * separa. Gerencia puede pegar las dos tablas una debajo de la otra y armar
 * una sola tabla dinamica.
 *
 * Reglas del cliente para todo export (ver historial.exportar.ts): tabla
 * plana -- encabezado en la fila 1, una fila por producto, CERO celdas
 * combinadas, titulos o filas en blanco --, numeros como numeros, y sobrantes
 * y faltantes en la MISMA hoja, distinguidos por la columna Tipo. Diferencia y
 * monto van CON SIGNO (faltante negativo), igual que alla.
 */

import ExcelJS from 'exceljs';
import { prisma } from '../../config/database';
import { NoEncontrado } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { ENCABEZADOS_EXPORT_DIFERENCIAS } from '../historial/historial.exportar';
import { obtenerReporteGerencia, type FilaReporteGerencia, type ReporteGerenciaDto } from './liquidacion.reporte-gerencia';

export interface ContextoReporteGerencia {
  sucursal: string;
  periodoAnio: number;
  periodoMes: number;
}

/** Lo que el reporte en pantalla no trae y el archivo si: la trazabilidad de cada producto. */
export interface DetalleItemReporte {
  /** '' si el catalogo de ese inventario no tiene el item -- no se inventa. */
  codigoBarras: string;
  /** null = Dynamics no lo clasifico: celda vacia. */
  categoria: string | null;
  stockSistema: number;
  conteoFinal: number;
  resueltoEnConteo: number;
  /** null = el snapshot no trajo precio de venta: celda vacia. */
  precioUnitario: number | null;
}

export interface FilaReporteGerenciaExport {
  sucursal: string;
  periodoAnio: number;
  periodoMes: number;
  inventarioId: number;
  codigo: string;
  codigoBarras: string;
  descripcion: string;
  categoria: string | null;
  /** SIEMPRE 'Empresa': es el reporte de lo que absorbe la empresa. */
  responsable: 'Empresa';
  stockSistema: number;
  conteoFinal: number;
  /** Con signo, como el export de diferencias: negativo = faltante. */
  diferencia: number;
  tipo: 'faltante' | 'sobrante';
  resueltoEnConteo: number;
  precioUnitario: number | null;
  /** El monto del reporte en pantalla, con el signo del tipo. null = sin precio. */
  montoDiferencia: number | null;
}

/**
 * Las filas del libro, en el orden de la pantalla: primero los faltantes y
 * despues los sobrantes. Unidades y monto salen del reporte TAL CUAL, con el
 * signo del tipo: no se recalculan con el precio -- la cuenta que se muestra
 * es la que se exporta.
 *
 * Si falta el detalle de un producto, falla. No deberia pasar (DiferenciaItem
 * tiene @@unique([inventarioId, codigo]) y el reporte sale de esa misma
 * tabla), y si pasa, un error honesto es mejor que una fila con stock y conteo
 * inventados.
 */
export function filasDeReporteGerencia(
  reporte: ReporteGerenciaDto,
  contexto: ContextoReporteGerencia,
  detalles: ReadonlyMap<string, DetalleItemReporte>,
): FilaReporteGerenciaExport[] {
  const aFila = (f: FilaReporteGerencia, tipo: 'faltante' | 'sobrante'): FilaReporteGerenciaExport => {
    const detalle = detalles.get(f.codigo);
    if (detalle === undefined) {
      throw new Error(`Falta el detalle del producto ${f.codigo} del inventario ${reporte.inventarioId}: no se arma el archivo.`);
    }
    // `n === 0 ? 0`: sin esto un faltante de monto 0 saldria como -0.
    const conSigno = (n: number): number => (n === 0 ? 0 : tipo === 'faltante' ? -n : n);
    return {
      sucursal: contexto.sucursal,
      periodoAnio: contexto.periodoAnio,
      periodoMes: contexto.periodoMes,
      inventarioId: reporte.inventarioId,
      codigo: f.codigo,
      codigoBarras: detalle.codigoBarras,
      descripcion: f.descripcion,
      categoria: detalle.categoria,
      responsable: 'Empresa',
      stockSistema: detalle.stockSistema,
      conteoFinal: detalle.conteoFinal,
      diferencia: conSigno(f.unidades),
      tipo,
      resueltoEnConteo: detalle.resueltoEnConteo,
      precioUnitario: detalle.precioUnitario,
      montoDiferencia: f.monto === null ? null : conSigno(f.monto),
    };
  };

  return [...reporte.faltantes.map((f) => aFila(f, 'faltante')), ...reporte.sobrantes.map((f) => aFila(f, 'sobrante'))];
}

/** En el mismo orden que ENCABEZADOS_EXPORT_DIFERENCIAS. */
function filaAOrdenDeColumnas(f: FilaReporteGerenciaExport): (string | number | null)[] {
  return [
    f.sucursal,
    f.periodoAnio,
    f.periodoMes,
    f.inventarioId,
    f.codigo,
    f.codigoBarras,
    f.descripcion,
    f.categoria,
    f.responsable,
    f.stockSistema,
    f.conteoFinal,
    f.diferencia,
    f.tipo,
    f.resueltoEnConteo,
    f.precioUnitario,
    f.montoDiferencia,
  ];
}

/**
 * UNA hoja, encabezado en la fila 1 y una fila por producto. `null` queda como
 * celda vacia -- exceljs no escribe la palabra "null".
 */
export async function armarLibroReporteGerencia(filas: readonly FilaReporteGerenciaExport[]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Reporte gerencia');

  hoja.addRow([...ENCABEZADOS_EXPORT_DIFERENCIAS]);
  for (const fila of filas) {
    hoja.addRow(filaAOrdenDeColumnas(fila));
  }

  return Buffer.from(await libro.xlsx.writeBuffer());
}

/**
 * "reporte-gerencia-market-bolivar-2026-08-inv45.xlsx": tienda, periodo e
 * inventario SIN espacios ni tildes, porque es lo que se manda por WhatsApp.
 * Mismo criterio que historial.exportar.ts#nombreArchivoExportDiferencias, y
 * el mismo formato que arma el telefono
 * (mobile/lib/dominio/reporte-gerencia.ts#nombreArchivoReporteGerencia).
 */
export function nombreArchivoReporteGerencia(sucursal: string, periodoAnio: number, periodoMes: number, inventarioId: number): string {
  const slugSucursal =
    sucursal
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'sucursal';
  const periodo = `${periodoAnio}-${String(periodoMes).padStart(2, '0')}`;
  return `reporte-gerencia-${slugSucursal}-${periodo}-inv${inventarioId}.xlsx`;
}

/**
 * El .xlsx del reporte de UN inventario.
 *
 * Los guardas -- solo auditor, 404, 409 si todavia no se liquido -- son los
 * del reporte en pantalla, porque se llama a la MISMA funcion: el archivo no
 * puede estar disponible en un estado en que la pantalla dice que no hay
 * reporte.
 */
export async function exportarReporteGerencia(
  actor: ColaboradorAutenticado,
  inventarioId: number,
): Promise<{ buffer: Buffer; nombreArchivo: string }> {
  const reporte = await obtenerReporteGerencia(actor, inventarioId);
  const codigos = [...reporte.faltantes, ...reporte.sobrantes].map((f) => f.codigo);

  const [inventario, diferencias, catalogo] = await Promise.all([
    prisma.inventario.findUnique({
      where: { id: inventarioId },
      select: { periodoAnio: true, periodoMes: true, sucursal: { select: { nombre: true } } },
    }),
    prisma.diferenciaItem.findMany({
      where: { inventarioId, codigo: { in: codigos } },
      select: { codigo: true, stockSistema: true, conteoFinal: true, resueltoEnConteo: true, precioUnitario: true },
    }),
    prisma.catalogoItem.findMany({
      where: { inventarioId, codigo: { in: codigos } },
      select: { codigo: true, codigoBarras: true, categoria: true },
    }),
  ]);
  if (inventario === null) throw new NoEncontrado('Ese inventario no existe.');

  const catalogoPorCodigo = new Map(catalogo.map((c) => [c.codigo, c]));
  const detalles = new Map<string, DetalleItemReporte>(
    diferencias.map((d) => [
      d.codigo,
      {
        codigoBarras: catalogoPorCodigo.get(d.codigo)?.codigoBarras ?? '',
        categoria: catalogoPorCodigo.get(d.codigo)?.categoria ?? null,
        stockSistema: d.stockSistema,
        conteoFinal: d.conteoFinal,
        resueltoEnConteo: d.resueltoEnConteo,
        precioUnitario: d.precioUnitario === null ? null : d.precioUnitario.toNumber(),
      },
    ]),
  );

  const contexto: ContextoReporteGerencia = {
    sucursal: inventario.sucursal.nombre,
    periodoAnio: inventario.periodoAnio,
    periodoMes: inventario.periodoMes,
  };

  return {
    buffer: await armarLibroReporteGerencia(filasDeReporteGerencia(reporte, contexto, detalles)),
    nombreArchivo: nombreArchivoReporteGerencia(contexto.sucursal, contexto.periodoAnio, contexto.periodoMes, inventarioId),
  };
}
