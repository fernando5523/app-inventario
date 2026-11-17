import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DownloadIcon } from '@primer/octicons-react'
import { HiRefresh } from 'react-icons/hi'
import { ActionGroup } from '../common/ActionGroup'
import { EmptyState } from '../common/EmptyState'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { SearchableSelect } from '../common/SearchableSelect'
import { StatusBadge } from '../common/StatusBadge'
import { TableSettingsButton } from '../common/table-settings/TableSettingsButton'
import { useTableColumns } from '../common/table-settings/useTableColumns'
import type { TableColumnDef } from '../common/table-settings/types'
import {
  ColumnHeaderCell,
  NoFilterMatches,
  QuickFilterInput,
  buildQueryGetters,
  useTableQuery,
} from '../common/table-filters'
import {
  GridHeaderCell,
  RowSelectCell,
  SELECTION_COLUMN_WIDTH,
  SelectAllHeaderCell,
  useColumnDrag,
  useColumnLayout,
  useRowSelection,
} from '../common/table-grid'
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus'
import { auditoriaApi } from '../../services/api'
import { notifyError } from '../../utils/notifyError'
import { MESES, MESES_CORTOS, formatoMiles, formatoMoneda, formatoPct, pluralizar } from '../../utils/formato'
import type { EstadoInventario, Periodo, ResumenDeLaCadena, TiendaDeLaCadena } from '../../tipos'
import { buscarPeriodoInicial } from './periodoInicial'

/**
 * EL PANEL DE AUDITORÍA: las once tiendas de la cadena en un período, con la
 * grilla configurable de app_pdv.
 *
 * Las decisiones de negocio NO se reinventaron acá: son las que ya resolvió
 * `mobile/app/auditor/auditoria.web.tsx` discutiendo con el cliente, y están
 * anotadas una por una en `columnasDeTiendas` más abajo. Las dos que más
 * cuestan si se tocan:
 *
 * 1. "A descontar" la calcula el SERVIDOR. Restar "Faltante" menos "Sobrante"
 *    acá sería tentador (las dos columnas están a la vista) y sería una
 *    segunda copia de la regla que decide cuánta plata sale del sueldo de
 *    alguien -- el neto resta además los ajustes del mes.
 * 2. Una tienda sin inventario del período muestra GUION, nunca el 0 que trae
 *    el DTO. Un "S/ 0,00" en Faltante sobre una tienda que no contó nada dice
 *    que cuadró, que es lo contrario de lo que pasa.
 */

const HEADER_CELL_CLASS = 'px-2 md:px-3 py-1.5 text-[11px] md:text-xs font-semibold text-[var(--fg-muted)]'
/**
 * TODAS LAS CIFRAS EN LA TINTA NORMAL, sin verde ni rojo según el signo. Lo
 * pidió el cliente ("nada de colores a los registros en la tabla") y es la
 * regla de la marca: el rojo es SIEMPRE acción, nunca un estado
 * (`mobile/lib/theme.ts`). Pintar un número negativo de rojo lo vuelve un
 * estado y le quita fuerza al rojo de los botones; el signo menos ya lo dice.
 */
const NUM_CELL_CLASS = 'py-1.5 text-xs text-[var(--fg)] tabular-nums text-right'

interface CartelDeEstado {
  titulo: string
  tono: 'ok' | 'atencion' | 'neutro'
}

/**
 * El nombre de cada estado, derivado del estado REAL del inventario y no de un
 * texto fijo: son seis en la base y cada uno habilita cosas distintas. Decir
 * "listo para aprobación" sobre un inventario que todavía se está contando
 * manda a alguien a una pantalla que lo va a rechazar.
 *
 * Es la misma tabla de `cartelDe` en la pantalla del teléfono: si un día el
 * nombre de un estado cambia, cambia en los dos lados o en ninguno.
 */
function cartelDe(estado: EstadoInventario | null): CartelDeEstado {
  if (estado === null) return { titulo: 'Sin inventario abierto', tono: 'neutro' }
  if (estado === 'en_curso') return { titulo: 'Conteo en curso', tono: 'neutro' }
  if (estado === 'ajuste_auditor') return { titulo: 'Ajuste final en curso', tono: 'atencion' }
  if (estado === 'conteo_cerrado') return { titulo: 'Conteo finalizado', tono: 'ok' }
  if (estado === 'liquidado') return { titulo: 'Liquidado', tono: 'atencion' }
  if (estado === 'lacrado') return { titulo: 'Lacrado', tono: 'ok' }
  return { titulo: 'Anulado', tono: 'neutro' }
}

const VARIANTE_DE_TONO = {
  ok: 'success',
  atencion: 'warning',
  neutro: 'default',
} as const

/**
 * SIN INVENTARIO NO ES "sin inventario abierto" (lo que diría `cartelDe`): es
 * que esta tienda todavía no abrió el del período, que es otra cosa y es el
 * dato que esta tabla vino a dar.
 */
function etiquetaDeEstado(tienda: TiendaDeLaCadena): { label: string; variant: 'default' | 'success' | 'warning' } {
  if (tienda.inventarioId === null) return { label: 'Sin inventario', variant: 'default' }
  const cartel = cartelDe(tienda.estado)
  return { label: cartel.titulo, variant: VARIANTE_DE_TONO[cartel.tono] }
}

/** "-S/ 161,70" / "S/ 130,40". El signo lo decide quién llama, no el dato. */
function monto(valor: number, negativo: boolean): string {
  return `${negativo && valor !== 0 ? '-' : ''}S/ ${formatoMoneda(valor)}`
}

/**
 * "A descontar" con su signo: con el menos es lo que sale del sueldo; SIN el
 * menos, el neto a favor del personal (el sobrante superó al faltante). Una
 * sola regla para la columna, la tarjeta del teléfono y la banda de totales:
 * `monto(negativo, true)` daría "-S/ -4,10".
 */
function montoADescontar(valor: number): string {
  return valor < 0 ? monto(Math.abs(valor), false) : monto(valor, true)
}

/**
 * UNA TARJETA DE LA BANDA DE TOTALES. Pequeña a propósito: el cliente ya hizo
 * sacar una vez las tarjetas grandes de esta pantalla ("quita estos cards")
 * porque empujaban la tabla media pantalla hacia abajo, y las volvió a pedir
 * "pero card pequeños". Son clases y no un componente común, como el resto de
 * las tarjetas del portal: esta banda solo existe acá.
 *
 * TODAS LAS TARJETAS SE VEN IGUAL. Hubo una versión donde "A descontar"
 * llevaba borde en tinta y cifra más grande, por ser el número que decide
 * plata; el usuario la rechazó: *"los card que muestren iguales todo, no
 * resaltar ninguno"*. Mismo borde, mismo tamaño y mismo peso para las siete.
 */
function Indicador({
  titulo,
  valor,
  detalle,
}: {
  titulo: string
  valor: string
  detalle?: string
}) {
  return (
    <div className="min-w-[112px] rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5">
      <p className="text-[11px] leading-4 text-[var(--fg-muted)]">{titulo}</p>
      <p className="text-[13px] font-semibold leading-5 tabular-nums text-[var(--fg)]">{valor}</p>
      {detalle && <p className="text-[11px] leading-4 tabular-nums text-[var(--fg-muted)]">{detalle}</p>}
    </div>
  )
}

/** El período de hoy, que es el que el servidor usa si no se le manda ninguno. */
function periodoDeHoy(): Periodo {
  const hoy = new Date()
  return { anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 }
}

/**
 * Los años que ofrece el selector: el actual y los dos anteriores. No se
 * consulta al servidor qué años tienen inventario porque no hay endpoint que
 * lo diga, y un año sin inventarios contesta una tabla con las once tiendas en
 * "Sin inventario" -- que es una respuesta correcta y legible, no un error.
 *
 * El año del período elegido entra siempre, aunque caiga fuera de esos tres:
 * un selector que no ofrece el año que está mostrando no se puede leer.
 */
function aniosOfrecidos(elegido: number): number[] {
  const actual = new Date().getFullYear()
  const anios = [actual, actual - 1, actual - 2]
  return anios.includes(elegido) ? anios : [...anios, elegido].sort((a, b) => b - a)
}

export function PanelAuditoria() {
  const [periodo, setPeriodo] = useState<Periodo>(periodoDeHoy)
  const [cadena, setCadena] = useState<ResumenDeLaCadena | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refrescando, setRefrescando] = useState(false)
  const [bajando, setBajando] = useState(false)
  const [buscando, setBuscando] = useState(true)
  const eligioAMano = useRef(false)

  /**
   * SIN RELLENO: si el endpoint falla, la tabla desaparece y se dice por qué.
   * Una cadena vacía mostraría "0 tiendas con inventario" sobre una cadena que
   * sí está contando -- es el peor error posible en esta pantalla, porque se
   * lee como un dato y no como una falla.
   */
  const cargar = useCallback(async (p: Periodo, silencioso = false) => {
    if (!silencioso) setCargando(true)
    try {
      const datos = await auditoriaApi.cadena(p)
      setCadena(datos)
      setError(null)
    } catch (e) {
      if (!silencioso) {
        setCadena(null)
        setError(e instanceof Error ? e.message : 'No se pudo cargar el resumen de la cadena.')
      }
      notifyError('No se pudo cargar el resumen de la cadena', e)
    } finally {
      if (!silencioso) setCargando(false)
    }
  }, [])

  /**
   * EL PERÍODO CON EL QUE ABRE: el último con inventario, no el mes de hoy (ver
   * `buscarPeriodoInicial`). Corre UNA vez, al entrar, y la tabla no se pinta
   * hasta que termina. Si la persona elige mes o año mientras tanto, gana su
   * elección y lo que la búsqueda encuentre se descarta.
   */
  useEffect(() => {
    // También cubre el doble montaje de StrictMode en desarrollo, que si no
    // haría dos búsquedas.
    let cancelado = false
    const descartada = () => cancelado || eligioAMano.current
    const buscar = async () => {
      try {
        const resumen = await buscarPeriodoInicial(periodoDeHoy(), auditoriaApi.cadena, descartada)
        if (resumen === null || descartada()) return
        setPeriodo(resumen.periodo)
        setCadena(resumen)
        setError(null)
      } catch (e) {
        if (descartada()) return
        setCadena(null)
        setError(e instanceof Error ? e.message : 'No se pudo cargar el resumen de la cadena.')
        notifyError('No se pudo cargar el resumen de la cadena', e)
      }
      setCargando(false)
      setBuscando(false)
    }
    void buscar()
    return () => {
      cancelado = true
    }
  }, [])

  /** Mes o año elegido a mano: de acá en adelante manda la persona. */
  const elegirPeriodo = (p: Periodo) => {
    eligioAMano.current = true
    setBuscando(false)
    setPeriodo(p)
    void cargar(p)
  }

  // Volver a la ventana relee la cadena en silencio: los conteos de las once
  // tiendas se mueven mientras esta pantalla está abierta. Durante la búsqueda
  // no: leería un período que todavía no está decidido.
  useRefreshOnFocus(() => cargar(periodo, true), !buscando)

  const refrescar = async () => {
    setRefrescando(true)
    try {
      await cargar(periodo)
    } finally {
      setRefrescando(false)
    }
  }

  /**
   * EL .XLSX LO ARMA EL SERVIDOR, no la grilla.
   *
   * `exportGridToExcel` exportaría las ocho columnas que están a la vista: una
   * foto de esta pantalla. El endpoint `/auditoria/cadena/diferencias/exportar`
   * devuelve el DETALLE POR PRODUCTO de los faltantes y sobrantes de todas las
   * tiendas, que es el respaldo que explica estas cifras. Son dos archivos
   * distintos y el que sirve para auditar es el del servidor.
   *
   * Tampoco se usa `useGridExport`: su diálogo cuenta páginas de registros que
   * va trayendo del servidor, y acá el servidor devuelve UN archivo armado. Una
   * barra de progreso sobre un total que no existe es una cifra inventada.
   *
   * El NOMBRE del archivo también lo manda el servidor (ver `services/api.ts`).
   */
  const bajarDetalle = async () => {
    setBajando(true)
    try {
      const { bytes, nombreArchivo } = await auditoriaApi.exportarDiferenciasDeLaCadena(periodo)
      const url = URL.createObjectURL(bytes)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = nombreArchivo
      document.body.appendChild(enlace)
      enlace.click()
      enlace.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      notifyError('No se pudo bajar el detalle de la cadena', e)
    } finally {
      setBajando(false)
    }
  }

  const tiendas = cadena?.tiendas ?? []

  const columnas: TableColumnDef<TiendaDeLaCadena>[] = useMemo(() => {
    /**
     * SIN INVENTARIO DEL PERÍODO, GUION. Ver el comentario de cabecera: el 0
     * del DTO se leería como "cuadró".
     */
    const cifra = (tienda: TiendaDeLaCadena, texto: () => string): string =>
      tienda.inventarioId === null ? '—' : texto()

    return [
      {
        id: 'tienda',
        label: 'Tienda',
        width: 20,
        locked: true,
        sortable: true,
        filter: { type: 'text', value: (t) => t.sucursal },
        cellClassName: 'py-1.5 text-xs font-semibold text-[var(--fg)]',
        renderCell: (t) => t.sucursal,
        exportValue: (t) => t.sucursal,
      },
      {
        id: 'estado',
        label: 'Estado',
        // 20 y no menos: el nombre mas largo que puede salir de `cartelDe` es
        // "Ajuste final en curso", y truncado a la mitad deja de distinguirse
        // de "Ajuste final" de cualquier otra cosa.
        width: 20,
        sortable: true,
        filter: {
          type: 'enum',
          // Las opciones salen de los estados que REALMENTE trae esta cadena,
          // no de los siete posibles: un filtro que ofrece "Anulado" sobre un
          // período sin ninguno es una opción que siempre devuelve vacío.
          options: Array.from(new Set(tiendas.map((t) => etiquetaDeEstado(t).label))).map((label) => ({
            value: label,
            label,
          })),
          value: (t) => etiquetaDeEstado(t).label,
        },
        cellClassName: 'py-1.5 text-xs',
        // Nunca un badge suelto: `StatusBadge`, con `variant` explícito. Su
        // mapa de estados es el de app_pdv (ventas, compras) y no conoce el
        // ciclo de vida de un inventario.
        //
        // EL `min-w` NO ES COSMÉTICO. `useColumnLayout` mide la tabla UNA vez,
        // con los datos que haya en pantalla en ese momento, y congela los
        // anchos; cambiar de período no vuelve a medir. Si la primera carga cae
        // en un mes sin inventarios -- todas las filas en "Sin inventario", que
        // es corto -- la columna queda angosta para siempre y "Ajuste final en
        // curso" aparece cortado al cambiar de mes. El ancho mínimo hace que la
        // medición refleje lo que la columna PUEDE llegar a mostrar y no lo que
        // hoy muestra.
        renderCell: (t) => {
          const badge = etiquetaDeEstado(t)
          return (
            <span className="inline-flex min-w-[124px]">
              <StatusBadge status={badge.label} label={badge.label} variant={badge.variant} />
            </span>
          )
        },
        exportValue: (t) => etiquetaDeEstado(t).label,
      },
      {
        id: 'items',
        label: 'Ítems',
        width: 9,
        align: 'right',
        sortable: true,
        filter: { type: 'number', value: (t) => t.items },
        cellClassName: NUM_CELL_CLASS,
        renderCell: (t) => cifra(t, () => formatoMiles(t.items)),
        exportValue: (t) => t.items,
        exportFormat: 'number',
      },
      {
        id: 'cuadrados',
        label: 'Cuadrados',
        width: 13,
        align: 'right',
        sortable: true,
        // Se ORDENA Y SE FILTRA por los cuadrados, pero se MUESTRAN los dos
        // números: "2.951" solo no dice si es bueno o malo.
        filter: { type: 'number', value: (t) => t.cuadrados },
        cellClassName: NUM_CELL_CLASS,
        renderCell: (t) => cifra(t, () => `${formatoMiles(t.cuadrados)} de ${formatoMiles(t.auditables)}`),
        exportValue: (t) => (t.inventarioId === null ? '' : `${t.cuadrados} de ${t.auditables}`),
      },
      {
        id: 'faltante',
        label: 'Faltante',
        width: 11,
        align: 'right',
        sortable: true,
        filter: { type: 'number', value: (t) => t.valorFaltante },
        cellClassName: NUM_CELL_CLASS,
        renderCell: (t) => cifra(t, () => monto(t.valorFaltante, true)),
        exportValue: (t) => t.valorFaltante,
        exportFormat: 'money',
      },
      {
        id: 'sobrante',
        label: 'Sobrante',
        width: 11,
        align: 'right',
        sortable: true,
        filter: { type: 'number', value: (t) => t.valorSobrante },
        cellClassName: NUM_CELL_CLASS,
        /**
         * SIN SIGNO: es lo que aparece de más, y COMPENSA el faltante en la
         * cuenta del descuento (`faltantes + sobrantes` es la resta que el
         * Auditor hacía a mano en su hoja DESCUENTO). No lleva el menos porque
         * no es plata que se le saque a nadie, y eso es lo que la distingue de
         * Faltante a simple vista -- no un color (ver `NUM_CELL_CLASS`).
         */
        renderCell: (t) => cifra(t, () => monto(t.valorSobrante, false)),
        exportValue: (t) => t.valorSobrante,
        exportFormat: 'money',
      },
      {
        id: 'personal',
        label: 'Al personal',
        width: 11,
        align: 'right',
        sortable: true,
        filter: { type: 'number', value: (t) => t.porClase.unidad.valorFaltante },
        cellClassName: NUM_CELL_CLASS,
        /**
         * El faltante BRUTO del cuadro `unidad`. Queda al lado de "A descontar"
         * porque es lo que la explica: la diferencia entre las dos es el
         * sobrante que el personal recupera, y sin este número el neto parece
         * salido de la nada.
         */
        renderCell: (t) => cifra(t, () => monto(t.porClase.unidad.valorFaltante, true)),
        exportValue: (t) => t.porClase.unidad.valorFaltante,
        exportFormat: 'money',
      },
      {
        id: 'descontar',
        label: 'A descontar',
        width: 12,
        align: 'right',
        sortable: true,
        filter: { type: 'number', value: (t) => t.valorADescontar },
        cellClassName: 'py-1.5 text-xs font-semibold text-[var(--fg)] tabular-nums text-right',
        /**
         * LA COLUMNA QUE SE BARRE DE ARRIBA ABAJO: es la plata que
         * efectivamente sale del sueldo de alguien, y de acá sale la cuota de
         * cada persona en la liquidación.
         *
         * PUEDE SER NEGATIVO, o sea a favor del personal, cuando el sobrante
         * supera al faltante. Ahí va sin el signo de resta, que es lo único
         * que lo distingue de un descuento: el neto se muestra tal cual da y no
         * se recorta a cero (decisión del cliente, documentada en el backend).
         */
        renderCell: (t) => cifra(t, () => montoADescontar(t.valorADescontar)),
        exportValue: (t) => t.valorADescontar,
        exportFormat: 'money',
      },
    ]
  }, [tiendas])

  const tableColumns = useTableColumns('auditoria-cadena', columnas)
  const { filterGetters, filterTypes, sortGetters } = buildQueryGetters(columnas)
  const tableQuery = useTableQuery<TiendaDeLaCadena>({
    rows: tiendas,
    filterGetters,
    filterTypes,
    sortGetters,
    persisted: { value: tableColumns.query, onChange: tableColumns.setQuery },
    getQuickFilterText: (t) => `${t.sucursal} ${etiquetaDeEstado(t).label}`,
  })

  const { visibleColumns } = tableColumns
  const layout = useColumnLayout({
    visibleColumns,
    widths: tableColumns.widths,
    setWidths: tableColumns.setWidths,
    leadingPx: SELECTION_COLUMN_WIDTH,
    ready: !cargando,
  })
  const columnDrag = useColumnDrag(
    tableColumns.move,
    tableColumns.columns.map((c) => c.id),
  )

  // El filtro (y el orden, si era esa columna) de una columna que se oculta se
  // vacía: un filtro activo invisible deja la tabla recortada sin explicación.
  const ocultasKey = tableColumns.columns
    .filter((c) => !c.visible)
    .map((c) => c.id)
    .join(',')
  useEffect(() => {
    const ocultas = new Set(ocultasKey.split(',').filter(Boolean))
    for (const id of ocultas) tableQuery.clearColumnFilter(id)
    if (tableQuery.sort && ocultas.has(tableQuery.sort.columnId)) tableQuery.clearSort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocultasKey])

  const filas = tableQuery.rows
  const selection = useRowSelection(filas, (t) => String(t.sucursalId))
  const limpiarFiltros = () => {
    tableQuery.clearAllColumnFilters()
    tableQuery.setQuickFilter('')
  }

  const total = cadena?.total ?? null

  /**
   * EL TOTAL DE LA CADENA, en una banda de tarjetas pequeñas pegada al título
   * (ver `Indicador`). Lo que NO se puede perder es el total: sumar once filas a
   * ojo para saber cuánto se descuenta en el mes es justo lo que esta pantalla
   * existe para evitar.
   *
   * NO SE MEZCLAN LAS CLASES. Habia una tarjeta "Faltante" con el bruto
   * (`total.valorFaltante`) y `paquete` y `empresa` como subtitulo. El usuario
   * la rechazo: *"aca no hay que combinar productos de empresa y personal"*, y
   * tiene razon de fondo -- ese bruto suma tres bolsas que no se tocan entre
   * si. Solo `unidad` sale del sueldo de alguien; `paquete` se audita aparte y
   * `empresa` lo absorbe la compania. Un numero que las suma no responde
   * ninguna pregunta real: ni cuanto se descuenta ni cuanto perdio la empresa.
   *
   * Por eso cada clase tiene su tarjeta y el bruto no se muestra. "A descontar"
   * queda entre las dos del personal porque es exactamente su resta neta.
   */
  const indicadores = useMemo(() => {
    if (total === null) return null
    return [
      {
        titulo: `${pluralizar(total.tiendas, 'Tienda', 'Tiendas')} con inventario`,
        valor: `${total.conInventario} de ${total.tiendas}`,
      },
      // Sin auditables NO se muestra un porcentaje: 0 de 0 daría "100%" o "0%" y
      // las dos cosas serían una afirmación sobre un conteo que no existe.
      total.auditables === 0
        ? { titulo: 'Cuadrados', valor: '—', detalle: 'todavía no hay ítems auditables' }
        : {
            titulo: 'Cuadrados',
            valor: `${formatoPct((total.cuadrados / total.auditables) * 100)}%`,
            detalle: `${formatoMiles(total.cuadrados)} de ${formatoMiles(total.auditables)} auditables`,
          },
      // LAS TRES CLASES NUNCA SE SUMAN EN UNA SOLA CIFRA. Ver el comentario
      // de arriba: el faltante bruto mezclaba las tres bolsas en un numero
      // que no le sirve a nadie.
      { titulo: 'Faltante al personal', valor: monto(total.porClase.unidad.valorFaltante, true) },
      { titulo: 'Sobrante al personal', valor: monto(total.porClase.unidad.valorSobrante, false) },
      { titulo: 'A descontar', valor: montoADescontar(total.valorADescontar) },
      { titulo: 'Por paquete', valor: monto(total.porClase.paquete.valorFaltante, true) },
      { titulo: 'De empresa', valor: monto(total.porClase.empresa.valorFaltante, true) },
    ]
  }, [total])

  const hayFiltros = tableQuery.quickFilter !== '' || Object.keys(tableQuery.columnFilters).length > 0

  return (
    <div className="space-y-3 md:space-y-0 md:flex md:flex-col md:gap-4 md:h-[calc(100vh_-_var(--app-header-h)_-_1px_-_2*var(--app-content-pad))]">
      {/* Panel de acciones (D365): la acción de la pantalla a la izquierda, [⟳][⚙] a la derecha. */}
      <div className="flex items-center justify-between gap-2">
        <ActionGroup
          items={[
            {
              id: 'detalle',
              label: bajando ? 'Bajando...' : 'Detalle por producto en Excel',
              icon: <DownloadIcon size={14} />,
              tone: 'primary',
              disabled: bajando || cadena === null,
              onClick: () => void bajarDetalle(),
            },
          ]}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refrescar()}
            disabled={refrescando || buscando}
            className="p-[7px] border border-[var(--border)] rounded-md bg-white text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)] disabled:opacity-50 transition-colors"
            title="Volver a leer la cadena"
          >
            <HiRefresh className={`w-3.5 h-3.5 ${refrescando ? 'animate-spin' : ''}`} />
          </button>
          <div className="hidden md:flex">
            <TableSettingsButton
              columns={tableColumns.columns}
              canHide={tableColumns.canHide}
              onToggle={tableColumns.toggle}
              onMove={tableColumns.move}
              onReset={tableColumns.reset}
              isDefault={tableColumns.isDefault}
            />
          </div>
        </div>
      </div>

      <div>
        <h1 className="text-sm md:text-[13px] font-semibold text-[var(--fg)]">
          Tiendas de la cadena
          {cadena && (
            <span className="ml-2 font-normal text-[var(--fg-muted)]">
              {MESES_CORTOS[cadena.periodo.mes - 1]} {cadena.periodo.anio}
            </span>
          )}
        </h1>
        {indicadores && (
          // Flex con salto de línea y no una grilla fija: las tarjetas miden lo
          // que su cifra, quedan juntas a la izquierda en un monitor ancho y se
          // reacomodan solas en uno angosto, sin scroll horizontal.
          <div className="mt-1.5 flex flex-wrap gap-2">
            {indicadores.map((indicador) => (
              <Indicador key={indicador.titulo} {...indicador} />
            ))}
          </div>
        )}
      </div>

      {/* Selector de período + filtro rápido. Nunca un <select> nativo. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <QuickFilterInput value={tableQuery.quickFilter} onChange={tableQuery.setQuickFilter} />
        <SearchableSelect
          options={MESES.map((nombre, i) => ({ value: String(i + 1), label: nombre }))}
          value={String(periodo.mes)}
          onChange={(v) => elegirPeriodo({ ...periodo, mes: Number(v) })}
          ariaLabel="Mes del período"
          className="sm:w-40"
          searchThreshold={12}
        />
        <SearchableSelect
          options={aniosOfrecidos(periodo.anio).map((a) => ({ value: String(a), label: String(a) }))}
          value={String(periodo.anio)}
          onChange={(v) => elegirPeriodo({ ...periodo, anio: Number(v) })}
          ariaLabel="Año del período"
          className="sm:w-28"
          searchThreshold={12}
        />
      </div>

      {cargando ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner text={buscando ? 'Buscando el último período con inventario...' : 'Leyendo la cadena...'} />
        </div>
      ) : error !== null ? (
        <EmptyState title="No se pudo cargar el resumen de la cadena" message={error} />
      ) : tiendas.length === 0 ? (
        <EmptyState title="Sin tiendas" message="El servidor no devolvió ninguna tienda activa para este período." />
      ) : (
        <>
          <div className="hidden md:block md:flex-1 md:min-h-0 border border-[var(--border)] rounded-md overflow-auto">
            <table ref={layout.tableRef} className={`${layout.tableClass} text-sm`} style={layout.tableStyle}>
              <colgroup>
                <col style={{ width: `${SELECTION_COLUMN_WIDTH}px` }} />
                {visibleColumns.map((column) => (
                  <col key={column.id} style={layout.colStyle(column)} />
                ))}
                {layout.hasFiller && <col />}
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="bg-white border-b border-[var(--border)]">
                  <SelectAllHeaderCell
                    allSelected={selection.allSelected}
                    someSelected={selection.someSelected}
                    onToggleAll={selection.toggleAll}
                  />
                  {visibleColumns.map((column) => (
                    <GridHeaderCell
                      key={column.id}
                      column={column}
                      ariaSort={
                        tableQuery.sort?.columnId === column.id
                          ? tableQuery.sort.direction === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : undefined
                      }
                      className={HEADER_CELL_CLASS}
                      layout={layout}
                      drag={columnDrag}
                    >
                      <ColumnHeaderCell
                        label={column.label}
                        sortable={Boolean(column.sortable)}
                        currentSort={tableQuery.sort?.columnId === column.id ? tableQuery.sort.direction : null}
                        onSort={(direction) => tableQuery.setSortColumn(column.id, direction)}
                        filterType={column.filter?.type}
                        operators={column.filter?.operators}
                        options={column.filter?.options}
                        currentFilter={tableQuery.columnFilters[column.id] ?? null}
                        onApplyFilter={(filter) => tableQuery.setColumnFilter(column.id, filter)}
                        onClearFilter={() => tableQuery.clearColumnFilter(column.id)}
                      />
                    </GridHeaderCell>
                  ))}
                  {layout.hasFiller && <th aria-hidden="true" className="p-0" />}
                </tr>
              </thead>
              <tbody>
                {filas.map((tienda) => (
                  <tr
                    key={tienda.sucursalId}
                    aria-selected={selection.isSelected(String(tienda.sucursalId))}
                    onClick={(e) => selection.onRowClick(String(tienda.sucursalId), e)}
                    onMouseDown={selection.onRowMouseDown}
                    // Seleccionada y activa SIN TINTE DE MARCA: una superficie
                    // neutra (`--bg-rail`, un paso más oscura que el hover) y la
                    // barra de la fila activa en la tinta de foco, no en rojo.
                    // La selección ya la dice el círculo de la primera columna.
                    className={`transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)] ${
                      selection.isSelected(String(tienda.sucursalId))
                        ? 'bg-[var(--bg-rail)]'
                        : 'hover:bg-[var(--bg-subtle)]'
                    } ${selection.isActive(String(tienda.sucursalId)) ? 'shadow-[inset_3px_0_0_var(--focus)]' : ''}`}
                  >
                    <RowSelectCell
                      selected={selection.isSelected(String(tienda.sucursalId))}
                      label={tienda.sucursal}
                      onToggle={() => selection.toggle(String(tienda.sucursalId))}
                    />
                    {visibleColumns.map((column) => {
                      const crudo = column.filter?.value?.(tienda)
                      return (
                        <td
                          key={column.id}
                          title={typeof crudo === 'string' ? crudo : undefined}
                          className={`px-2 md:px-3 truncate ${column.cellClassName ?? ''}`}
                        >
                          {column.renderCell(tienda)}
                        </td>
                      )
                    })}
                    {layout.hasFiller && <td aria-hidden="true" className="p-0" />}
                  </tr>
                ))}
                {filas.length === 0 && (
                  <tr>
                    <td
                      colSpan={visibleColumns.length + 1 + (layout.hasFiller ? 1 : 0)}
                      className="py-10 text-center"
                    >
                      <NoFilterMatches onClear={limpiarFiltros} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Tarjetas en móvil: la grilla de ocho columnas no entra en un teléfono. */}
          <div className="md:hidden space-y-3">
            {filas.length === 0 && hayFiltros && <NoFilterMatches onClear={limpiarFiltros} />}
            {filas.map((tienda) => {
              const badge = etiquetaDeEstado(tienda)
              const sinInventario = tienda.inventarioId === null
              return (
                <div
                  key={tienda.sucursalId}
                  className="bg-white rounded-md border border-[var(--border)] p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--fg)] truncate">{tienda.sucursal}</p>
                    <StatusBadge status={badge.label} label={badge.label} variant={badge.variant} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-[var(--fg-muted)]">Cuadrados</p>
                      <p className="text-[var(--fg)] tabular-nums">
                        {sinInventario ? '—' : `${formatoMiles(tienda.cuadrados)} de ${formatoMiles(tienda.auditables)}`}
                      </p>
                    </div>
                    <div>
                      <p className="text-[var(--fg-muted)]">Faltante</p>
                      <p className="text-[var(--fg)] tabular-nums">
                        {sinInventario ? '—' : monto(tienda.valorFaltante, true)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[var(--fg-muted)]">Sobrante</p>
                      <p className="text-[var(--fg)] tabular-nums">
                        {sinInventario ? '—' : monto(tienda.valorSobrante, false)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[var(--fg-muted)]">A descontar</p>
                      <p className="font-semibold text-[var(--fg)] tabular-nums">
                        {sinInventario ? '—' : montoADescontar(tienda.valorADescontar)}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
