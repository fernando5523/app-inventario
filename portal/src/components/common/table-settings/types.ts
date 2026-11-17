import type { ReactNode } from 'react'
import type { CellValue, ColumnFilterValue, FilterOperator, FilterType, SortDirection } from '../table-filters/operators'

/** Lo que se guarda por usuario para una tabla: orden de columnas, cuáles están ocultas y anchos. */
export interface TableColumnsConfig {
  order: string[]
  hidden: string[]
  /**
   * Ancho en px de las columnas que el usuario redimensionó. Vacío = la tabla reparte
   * el 100 % según los pesos (`width`) de las definiciones.
   */
  widths?: Record<string, number>
  /** Filtros, orden y filtro rápido vigentes: sobreviven a recargar la página. */
  query?: SavedTableQuery
}

/** Estado de consulta de una tabla guardado por usuario (ver `useTableQuery({ persisted })`). */
export interface SavedTableQuery {
  filters?: Record<string, ColumnFilterValue>
  sort?: { columnId: string; direction: SortDirection } | null
  quick?: string
}

/** Metadata declarativa de filtro de columna (ver `common/table-filters/`). */
export interface TableColumnFilterDef<Row> {
  type: FilterType
  /** Opciones para un filtro `enum` (como las de un `<select>`). */
  options?: { value: string; label: string }[]
  /** Valor crudo de la columna en esa fila: lo que el operador compara. Por defecto usa `renderCell`'s cell via String(). */
  value?: (row: Row) => CellValue
  /**
   * Restringe el menú a los operadores que esta columna puede resolver
   * correctamente (p.ej. una columna que filtra vía un parámetro de
   * servidor de solo-igualdad ofrece nada más "es exactamente"). Sin esto,
   * se ofrecen todos los operadores del tipo.
   */
  operators?: FilterOperator[]
}

/**
 * Una columna configurable. La tabla se dibuja entera desde este arreglo: el
 * `<colgroup>`, los encabezados y las celdas siguen el mismo orden y la misma
 * visibilidad, así que no pueden desalinearse.
 */
export interface TableColumnDef<Row> {
  id: string
  /** Texto del encabezado y de la lista de "Configuración de tabla". */
  label: string
  /** Peso del ancho en el `<colgroup>`; se reparte entre las columnas visibles. */
  width: number
  align?: 'left' | 'right' | 'center'
  /** Siempre visible: su casilla aparece marcada y deshabilitada. Se puede reordenar. */
  locked?: boolean
  /** Visible cuando el usuario todavía no configuró nada. Por defecto `true`. */
  defaultVisible?: boolean
  /**
   * Filtro de columna vía el menú del encabezado (`ColumnHeaderCell`). Sin
   * esto, la columna no es filtrable y su encabezado no abre menú (a menos
   * que sea `sortable`).
   */
  filter?: TableColumnFilterDef<Row>
  /** Valor crudo para ordenar. Si falta y hay `filter.value`, se usa ese. */
  sortValue?: (row: Row) => CellValue
  /** `true` habilita ordenar aunque no haya `sortValue` propio (usa `filter.value`). */
  sortable?: boolean
  /**
   * @deprecated Reemplazado por `filter` + el menú del encabezado
   * (`ColumnHeaderCell`). Queda sin usar hasta que las últimas tablas con
   * fila de filtros (SalesList, CreditNoteList, DebitNoteList) se conviertan.
   */
  renderFilter?: () => ReactNode
  renderCell: (row: Row) => ReactNode
  /** Valor para exportar a Excel (por defecto, el valor del filtro o el texto de la celda). */
  exportValue?: (row: Row) => string | number | boolean | null
  /** 'money' exporta el número con 2 decimales. */
  exportFormat?: 'text' | 'number' | 'money'
  /** Clases extra para las celdas del cuerpo (padding, color). */
  cellClassName?: string
}

/** Estado de una columna tal como la muestra el popover. */
export interface ResolvedColumn {
  id: string
  label: string
  visible: boolean
  locked: boolean
}
