/**
 * El archivo EXCEL de faltantes/sobrantes de UN inventario -- pedido del
 * cliente para mandarlo por WhatsApp/correo y analizarlo en tablas dinámicas
 * de otra herramienta. SIN Prisma (regla de capas, ver historial.service.ts):
 * recibe filas ya armadas y arma el libro, para poder probarlo sin base de
 * datos.
 *
 * REGLAS NO NEGOCIABLES DEL CLIENTE, todas en juego acá:
 *   - TABLA PLANA: encabezados en la fila 1, una fila por producto, CERO
 *     celdas combinadas, CERO títulos decorativos arriba, CERO filas en
 *     blanco. Una tabla dinámica que encuentra una fila de título o una
 *     celda combinada rompe el agrupamiento -- por eso ni siquiera se le
 *     pone negrita al encabezado: es una fila más, sin fusionar nada.
 *   - NUMERO como número, nunca como texto: `worksheet.addRow` con un
 *     `number` de JS entra a la celda como NumberValue automáticamente (no
 *     hace falta `numFmt`); pasar un string lo dejaría alineado a la
 *     izquierda y fuera de cualquier SUMA/PROMEDIO de una tabla dinámica.
 *   - Sin fecha real que exportar hoy: lo pedido es año/mes (`Inventario`
 *     no tiene un campo de fecha de cierre expuesto acá), así que van como
 *     dos columnas NUMERO, no como texto "2026-09" ni como `Date`.
 */

import ExcelJS from 'exceljs';

export interface FilaDiferenciaExport {
  sucursal: string;
  periodoAnio: number;
  periodoMes: number;
  inventarioId: number;
  codigo: string;
  /** '' cuando el catálogo de esa ronda no tiene el ítem (no debería pasar, pero no se inventa). */
  codigoBarras: string;
  descripcion: string;
  /** `null` = Dynamics no lo clasificó -- columna vacía, no un "Sin categoría" inventado. */
  categoria: string | null;
  stockSistema: number;
  conteoFinal: number;
  diferencia: number;
  tipo: 'faltante' | 'sobrante';
  resueltoEnConteo: number;
  /** `null` = la diferencia no se pudo valorizar (ver DiferenciaItem.precioUnitario) -- columna vacía. */
  precioUnitario: number | null;
  montoDiferencia: number | null;
}

/**
 * Encabezados EXACTOS de la fila 1, en el mismo orden que `filaAOrdenDeColumnas`.
 * Una sola fuente para las dos cosas: si un día se agrega una columna, alguien
 * que solo toque esta constante ya sabe que también tiene que tocar la otra
 * (el test de "encabezados esperados" los compara contra esta misma lista).
 */
export const ENCABEZADOS_EXPORT_DIFERENCIAS = [
  'Sucursal',
  'Año',
  'Mes',
  'Inventario',
  'Código',
  'Código de barras',
  'Descripción',
  'Categoría',
  'Stock ERP',
  'Conteo final',
  'Diferencia',
  'Tipo',
  'Ronda resuelta',
  'Precio unitario',
  'Monto diferencia',
] as const;

function filaAOrdenDeColumnas(f: FilaDiferenciaExport): (string | number | null)[] {
  return [
    f.sucursal,
    f.periodoAnio,
    f.periodoMes,
    f.inventarioId,
    f.codigo,
    f.codigoBarras,
    f.descripcion,
    f.categoria,
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
 * El libro: UNA hoja, sin fusionar celdas, sin fila de título, sin fila en
 * blanco entre el encabezado y los datos. `null` en una celda (categoría o
 * precio sin dato) queda vacía -- exceljs no escribe la palabra "null".
 */
export async function armarLibroDiferencias(filas: readonly FilaDiferenciaExport[]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Diferencias');

  hoja.addRow([...ENCABEZADOS_EXPORT_DIFERENCIAS]);
  for (const fila of filas) {
    hoja.addRow(filaAOrdenDeColumnas(fila));
  }

  const buffer = await libro.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * "diferencias-market-bolivar-2026-09-inv30.xlsx" -- identifica tienda,
 * período e inventario SIN espacios ni acentos: es lo que se manda por
 * WhatsApp, y un nombre con "í"/" " ahí puede llegar recodificado distinto
 * según el cliente de mensajería del otro lado.
 */
export function nombreArchivoExportDiferencias(sucursal: string, periodoAnio: number, periodoMes: number, inventarioId: number): string {
  const slugSucursal =
    sucursal
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'sucursal';
  const periodo = `${periodoAnio}-${String(periodoMes).padStart(2, '0')}`;
  return `diferencias-${slugSucursal}-${periodo}-inv${inventarioId}.xlsx`;
}

/**
 * El consolidado de varias tiendas (o todas) en un mismo período -- pedido
 * del cliente (2026-09-09): una tienda, varias, o todas. Sin nombre de
 * sucursal ni de inventario: el archivo mezcla N tiendas, así que ninguna de
 * las dos identifica el contenido (la columna `Sucursal` de la tabla sí lo
 * hace, fila por fila).
 */
export function nombreArchivoExportConsolidado(periodoAnio: number, periodoMes: number): string {
  const periodo = `${periodoAnio}-${String(periodoMes).padStart(2, '0')}`;
  return `diferencias-consolidado-${periodo}.xlsx`;
}
