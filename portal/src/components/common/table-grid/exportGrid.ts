import { buildXlsx, downloadXlsx, type XlsxCell, type XlsxColumn } from '../../../utils/xlsx'
import type { TableColumnDef } from '../table-settings/types'

const dateText = (d: Date) => d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** What a grid cell exports: `exportValue`, else the filter value (the cell's data), else its text. */
function cellValue<Row>(column: TableColumnDef<Row>, row: Row): XlsxCell {
  if (column.exportValue) return column.exportValue(row)
  const v = column.filter?.value?.(row)
  if (v instanceof Date) return dateText(v)
  if (v !== undefined && v !== null) return v as XlsxCell
  const rendered = column.renderCell(row)
  return typeof rendered === 'string' || typeof rendered === 'number' ? rendered : ''
}

/**
 * Exports rows of a configurable grid to .xlsx with the columns the user sees, in their
 * order (D365 "Exportar todas las filas / filas marcadas"). Returns the number of rows.
 */
export function exportGridToExcel<Row>({
  fileName,
  sheetName,
  columns,
  rows,
}: {
  fileName: string
  sheetName: string
  columns: TableColumnDef<Row>[]
  rows: Row[]
}): number {
  const data = rows.map((row) => columns.map((column) => cellValue(column, row)))
  const xlsxColumns: XlsxColumn[] = columns.map((column, i) => {
    const longest = data.reduce((max, r) => Math.max(max, String(r[i] ?? '').length), column.label.length)
    return {
      header: column.label,
      width: Math.min(60, Math.max(8, longest + 2)),
      format: column.exportFormat ?? (column.filter?.type === 'number' ? 'number' : 'text'),
    }
  })
  downloadXlsx(fileName, buildXlsx(sheetName, xlsxColumns, data))
  return rows.length
}
