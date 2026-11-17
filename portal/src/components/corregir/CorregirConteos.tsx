import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HiRefresh } from 'react-icons/hi'
import { AlertIcon, CheckCircleIcon, DownloadIcon, PencilIcon, UploadIcon } from '@primer/octicons-react'
import { ActionGroup } from '../common/ActionGroup'
import { EmptyState } from '../common/EmptyState'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { SearchableSelect } from '../common/SearchableSelect'
import { StatusBadge } from '../common/StatusBadge'
import { TableSettingsButton } from '../common/table-settings/TableSettingsButton'
import { useTableColumns } from '../common/table-settings/useTableColumns'
import type { TableColumnDef } from '../common/table-settings/types'
import { ColumnHeaderCell, NoFilterMatches, QuickFilterInput, buildQueryGetters, useTableQuery } from '../common/table-filters'
import { GridHeaderCell, useColumnDrag, useColumnLayout } from '../common/table-grid'
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus'
import { sesionApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { notifyError } from '../../utils/notifyError'
import { formatoMiles, pluralizar } from '../../utils/formato'
import { downloadXlsx } from '../../utils/xlsx'
import type { Sucursal } from '../../tipos'
import { corregirApi } from './api'
import { PanelCorreccion } from './PanelCorreccion'
import { PanelImportacion } from './PanelImportacion'
import {
  STOCK_NO_SE_CORRIGE,
  armarFilas,
  faseDeCierre,
  motivoSinCorregir,
  ordinal,
  puedeCorregirLoContado,
  sinCuadrar as soloSinCuadrar,
  textoItemSalioDeRonda,
  textoRondaQueYaNoExiste,
  type FaseDeCierre,
} from './reglas'
import type { FilaCorregible, InventarioActivo, LineaEmpaque, ResultadoConfirmacion } from './tipos'

/**
 * ---------------------------------------------------------------------------
 * CORREGIR LO CONTADO — EL PORTAL DEL AUDITOR
 * ---------------------------------------------------------------------------
 * Portada de `mobile/app/auditor/corregir.web.tsx`, con la grilla y los
 * controles del portal. LAS DECISIONES DE NEGOCIO NO SE REINVENTARON: están en
 * `reglas.ts`, con los mismos textos que la app móvil, y las tres que más
 * cuestan si se tocan son:
 *
 * 1. EL STOCK DEL SISTEMA SE VE Y NO SE EDITA. Es el único lado de la
 *    comparación que el inventario no produce; si se pudiera editar, "cuadrar"
 *    sería escribir el número que falta de los dos lados.
 * 2. EL MOTIVO ES OBLIGATORIO y queda con el nombre de quien corrige y la
 *    hora. Es la única parte que el sistema no puede deducir solo.
 * 3. LA VENTANA SE CIERRA al empezar el ajuste final. No es una regla del
 *    cliente ni de esta pantalla: la sostiene el servidor
 *    (`ajuste.permisos.ts#validarCorreccion`), que responde 409. Acá se dice
 *    de antemano para no ofrecer un botón que va a fallar.
 *
 * Y UNA QUE NO SE TRASLADA: esta es la única pantalla que muestra el stock
 * mientras se corrige. El Contador nunca lo ve — el conteo es ciego.
 */

const HEADER_CELL_CLASS = 'px-2 md:px-3 py-1.5 text-[11px] md:text-xs font-semibold text-[var(--fg-muted)]'
/**
 * Las cifras en la tinta normal, sin verde ni rojo según el signo: mismo
 * criterio que el panel de auditoría. El primario es acción, nunca un estado.
 */
const NUM_CELL_CLASS = 'py-1.5 text-xs text-[var(--fg)] tabular-nums text-right'
/** Sin dato es un guion, nunca un 0: "nadie lo contó" es distinto de "contó cero". */
const SIN_DATO = '—'

type Filtro = 'sin-cuadrar' | 'todos'

/** Lo que pasó con la última corrección. */
interface Aviso {
  texto: string
  tono: 'ok' | 'atencion'
}

/**
 * La diferencia como badge, con las mismas tres palabras que la app móvil:
 * "Sin comparar" cuando no hay contra qué, "Cuadra" cuando da cero, y el
 * número con signo cuando no.
 *
 * `warning` y no `danger`: un ítem sin cuadrar espera una decisión, no es un
 * peligro — y el destructivo está reservado para lo que no se puede deshacer.
 */
function badgeDeDiferencia(diferencia: number | null): { label: string; variant: 'default' | 'success' | 'warning' } {
  if (diferencia === null) return { label: 'Sin comparar', variant: 'default' }
  if (diferencia === 0) return { label: 'Cuadra', variant: 'success' }
  return { label: `${diferencia > 0 ? '+' : ''}${formatoMiles(diferencia)}`, variant: 'warning' }
}

export function CorregirConteos() {
  const { sucursal: sucursalDeSesion } = useAuthStore()

  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [sucursalElegida, setSucursalElegida] = useState<number | null>(null)
  const sucursalId = sucursalElegida ?? sucursalDeSesion?.id ?? null

  const [cargando, setCargando] = useState(true)
  const [refrescando, setRefrescando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inventario, setInventario] = useState<InventarioActivo | null>(null)
  const [filas, setFilas] = useState<FilaCorregible[]>([])
  const [filtro, setFiltro] = useState<Filtro>('sin-cuadrar')
  /** La ronda que se está mirando. `null` = la vigente, que se resuelve al cargar. */
  const [rondaElegida, setRondaElegida] = useState<number | null>(null)
  const [aviso, setAviso] = useState<Aviso | null>(null)

  const [enEdicion, setEnEdicion] = useState<FilaCorregible | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [errorAlGuardar, setErrorAlGuardar] = useState<unknown>(null)

  const [exportando, setExportando] = useState(false)
  const [importando, setImportando] = useState(false)

  useEffect(() => {
    sesionApi
      .sucursales()
      .then(setSucursales)
      .catch((e) => notifyError('No se pudieron cargar las sucursales', e))
  }, [])

  /**
   * `rondaElegida` en un ref para que `cargar` no cambie de identidad cada vez
   * que se elige una ronda: el efecto de abajo corre con `[cargar]`, y una
   * dependencia que se mueve en cada carga sería un bucle de pedidos.
   */
  const rondaElegidaRef = useRef<number | null>(null)
  rondaElegidaRef.current = rondaElegida

  const cargar = useCallback(
    async (silencioso = false) => {
      if (sucursalId === null) {
        setFilas([])
        setInventario(null)
        setCargando(false)
        return
      }
      if (!silencioso) setCargando(true)
      try {
        const activo = await corregirApi.inventarioActivo(sucursalId)
        setInventario(activo)
        if (activo === null || activo.rondaActiva === null) {
          setFilas([])
          setRondaElegida(null)
          setError(null)
          return
        }

        /**
         * LA RONDA QUE SE ESTABA MIRANDO PUEDE HABER DESAPARECIDO: se corrige
         * el último ítem que quedaba, la ronda se queda sin hojas y el servidor
         * la borra. Quedarse parado ahí sería mostrar una ronda que ya no
         * existe; irse en silencio sería mover la pantalla debajo de quien la
         * está usando. Se hacen las dos cosas.
         */
        const pedida = rondaElegidaRef.current
        const ronda = pedida !== null && pedida <= activo.rondaActiva ? pedida : activo.rondaActiva
        if (pedida !== null && pedida !== ronda) {
          setAviso({ texto: textoRondaQueYaNoExiste(pedida, ronda), tono: 'atencion' })
        }
        setRondaElegida(ronda)

        // Las dos lecturas en paralelo: no dependen entre sí. Las hojas dan el
        // `hojaId` que pide la corrección; la matriz, el stock y el veredicto.
        const [hojas, matriz] = await Promise.all([
          corregirApi.hojasDeLaRonda(activo.inventarioId, ronda),
          corregirApi.matrizCompleta(activo.inventarioId),
        ])
        setFilas(armarFilas(hojas, matriz))
        setError(null)
      } catch (e) {
        /**
         * SIN RELLENO: si falla, la tabla desaparece y se dice por qué. Una
         * lista vacía se leería como "esta ronda no tiene ítems", que sobre una
         * ronda que sí los tiene es peor que un error.
         */
        if (!silencioso) {
          setFilas([])
          setError(e instanceof Error ? e.message : 'No se pudo cargar lo contado.')
        }
        notifyError('No se pudo cargar lo contado', e)
      } finally {
        if (!silencioso) setCargando(false)
      }
    },
    [sucursalId],
  )

  useEffect(() => {
    // Cambió la tienda: se limpia ANTES de que llegue lo nuevo. Los números de
    // hoja se repiten en cada ronda y en cada tienda, así que dejar las filas
    // viejas un instante mostraría "Hoja #001" de otro lote.
    setFilas([])
    void cargar()
  }, [cargar])

  /**
   * Cambió la ronda a mano: se recarga sin tocar la identidad de `cargar`.
   * El primer render no entra — esa carga ya la hizo el efecto de arriba.
   */
  const primerRender = useRef(true)
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false
      return
    }
    setFilas([])
    void cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rondaElegida])

  // Volver a la ventana relee en silencio: el Coordinador puede estar
  // corrigiendo en paralelo por la misma vía. Pausado con el panel abierto: un
  // refresco a mitad de tipear el motivo borraría el borrador.
  useRefreshOnFocus(() => cargar(true), enEdicion === null && !guardando)

  const refrescar = async () => {
    setRefrescando(true)
    try {
      await cargar()
    } finally {
      setRefrescando(false)
    }
  }

  /**
   * BAJAR LA PLANTILLA, con el filtro que está puesto en la pantalla.
   *
   * `soloSinCuadrar` sale del filtro de arriba y no de un default: el archivo
   * tiene que traer lo que el auditor está mirando. Con "Sin cuadrar" puesto
   * —que es como entra la pantalla— baja solo lo que no cuadra.
   *
   * EL PERÍODO NO SE DERIVA DEL RELOJ. Se pide al detalle del inventario
   * (`periodoDelInventario`): medido, un inventario de septiembre tiene fecha
   * de octubre, y el mes de hoy no tiene ningún inventario -- un archivo del
   * mes equivocado se descubre recién al importarlo, con todas las filas
   * rechazadas.
   */
  async function exportar() {
    if (inventario === null) return
    setExportando(true)
    try {
      const { periodoAnio, periodoMes } = await corregirApi.periodoDelInventario(inventario.inventarioId)
      const archivo = await corregirApi.exportarPlantilla({
        anio: periodoAnio,
        mes: periodoMes,
        ...(sucursalId === null ? {} : { sucursalId }),
        soloSinCuadrar: filtro === 'sin-cuadrar',
      })
      // El nombre lo pone el servidor (`conteos-2026-09-suc3.xlsx`): dice de qué
      // tienda y de qué mes es, que es lo que permite no confundir dos archivos.
      downloadXlsx(archivo.nombreArchivo, archivo.bytes)
      setAviso({
        tono: 'ok',
        texto: `Se bajó ${archivo.nombreArchivo}. Trae los conteos de TODAS las rondas del mes${filtro === 'sin-cuadrar' ? ' que no cuadran' : ''}, no solo del ${ordinal(rondaElegida ?? 1)} conteo que estás viendo. Edita "Nuevo valor" y "Motivo", y vuelve a subirlo con "Corregir con un Excel".`,
      })
    } catch (e) {
      notifyError('No se pudo bajar el archivo', e)
    } finally {
      setExportando(false)
    }
  }

  /**
   * VOLVIÓ DEL EXCEL: la tabla de atrás quedó vieja y se relee.
   *
   * El aviso nombra las DOS cifras, y las fallidas no son un detalle: el lote
   * no es todo o nada, así que volver a subir el archivo entero repetiría lo
   * que ya entró. El detalle fila por fila queda en el panel, que sigue
   * abierto.
   */
  function despuesDeImportar(resultado: ResultadoConfirmacion) {
    const { aplicadas, fallidas } = resultado.resumen
    const partes = [
      `Se aplicaron ${formatoMiles(aplicadas)} ${pluralizar(aplicadas, 'corrección', 'correcciones')} desde ${resultado.nombreArchivo}.`,
    ]
    if (fallidas > 0) {
      partes.push(
        `${formatoMiles(fallidas)} ${pluralizar(fallidas, 'fila no se pudo aplicar', 'filas no se pudieron aplicar')} y el resto sí entró: corrige solo esas y vuelve a subirlas.`,
      )
    }
    setAviso({ tono: fallidas > 0 ? 'atencion' : 'ok', texto: partes.join(' ') })
    void cargar(true)
  }

  const fase: FaseDeCierre | null = useMemo(() => faseDeCierre(inventario), [inventario])
  const sePuedeCorregir = puedeCorregirLoContado(fase)
  const bloqueo = motivoSinCorregir(fase)

  const sinCuadrar = useMemo(() => soloSinCuadrar(filas), [filas])
  const visibles = filtro === 'sin-cuadrar' ? sinCuadrar : filas

  const columnas: TableColumnDef<FilaCorregible>[] = useMemo(
    () => [
      {
        id: 'codigo',
        label: 'Código',
        width: 10,
        locked: true,
        sortable: true,
        filter: { type: 'text', value: (f) => f.producto.codigo },
        cellClassName: 'py-1.5 text-xs text-[var(--fg)] tabular-nums',
        renderCell: (f) => f.producto.codigo,
        exportValue: (f) => f.producto.codigo,
      },
      {
        id: 'descripcion',
        label: 'Descripción',
        width: 26,
        sortable: true,
        filter: { type: 'text', value: (f) => f.producto.descripcion },
        cellClassName: 'py-1.5 text-xs font-semibold text-[var(--fg)]',
        renderCell: (f) => f.producto.descripcion,
        exportValue: (f) => f.producto.descripcion,
      },
      {
        id: 'hoja',
        label: 'Hoja',
        width: 8,
        sortable: true,
        filter: { type: 'text', value: (f) => f.numeroHoja },
        cellClassName: 'py-1.5 text-xs text-[var(--fg)] tabular-nums',
        renderCell: (f) => `#${f.numeroHoja}`,
        exportValue: (f) => f.numeroHoja,
      },
      {
        id: 'categoria',
        label: 'Categoría',
        width: 16,
        sortable: true,
        /**
         * LA CATEGORÍA DEL PRODUCTO, no la `zona` de la hoja.
         *
         * BUG REAL (2026-10-13, inventario 8090 de Market Sucre): esta columna
         * leía `item.zona` y mostraba "DETERGENTES EN POLVO" en las cinco
         * filas sin cuadrar, con dos vinos y dos aceites entre ellas. `zona` es
         * la categoría DOMINANTE del bloque con el que se armó la hoja, así que
         * en un inventario de 45 ítems y 16 categorías vale lo mismo para
         * todos. Ver `ItemDeLaMatriz` en tipos.ts, de donde ya se quitó.
         *
         * Vacío es un guion y nunca una categoría inventada: el ERP no
         * clasifica todos los productos.
         */
        filter: { type: 'text', value: (f) => f.producto.categoria ?? '' },
        cellClassName: 'py-1.5 text-xs text-[var(--fg-muted)]',
        renderCell: (f) => f.producto.categoria ?? SIN_DATO,
        exportValue: (f) => f.producto.categoria ?? '',
      },
      {
        id: 'contado',
        label: 'Contado',
        width: 9,
        align: 'right',
        sortable: true,
        filter: { type: 'number', value: (f) => f.contado },
        cellClassName: NUM_CELL_CLASS,
        renderCell: (f) => (f.contado === null ? SIN_DATO : formatoMiles(f.contado)),
        exportValue: (f) => f.contado,
        exportFormat: 'number',
      },
      {
        id: 'stock',
        label: 'Stock del sistema',
        width: 11,
        align: 'right',
        sortable: true,
        /**
         * EL DE LA MEDICIÓN, no `item.stockErp`: tiene que ser el mismo contra
         * el que se calculó la diferencia de la columna de al lado, o la fila
         * mostraría una resta que no cierra consigo misma. Cuando el stock no
         * es el de la ronda del conteo, la celda lo dice con la ronda.
         */
        filter: { type: 'number', value: (f) => f.item?.stockDeLaMedicion.stockErp ?? null },
        cellClassName: NUM_CELL_CLASS,
        renderCell: (f) => {
          const m = f.item?.stockDeLaMedicion ?? null
          if (m === null || m.stockErp === null) return SIN_DATO
          const deOtraRonda = m.rondaDelStock !== null && m.rondaDelConteo !== null && m.rondaDelStock !== m.rondaDelConteo
          return (
            <span>
              {formatoMiles(m.stockErp)}
              {deOtraRonda && (
                <span className="ml-1 text-[11px] font-normal text-[var(--fg-muted)]">
                  {ordinal(m.rondaDelStock!)}
                </span>
              )}
            </span>
          )
        },
        exportValue: (f) => f.item?.stockDeLaMedicion.stockErp ?? null,
        exportFormat: 'number',
      },
      {
        id: 'diferencia',
        label: 'Diferencia',
        width: 12,
        sortable: true,
        filter: { type: 'number', value: (f) => f.item?.diferenciaUnidades ?? null },
        cellClassName: 'py-1.5 text-xs',
        renderCell: (f) => {
          const badge = badgeDeDiferencia(f.item?.diferenciaUnidades ?? null)
          return (
            <span className="inline-flex min-w-[104px]">
              <StatusBadge status={badge.label} label={badge.label} variant={badge.variant} />
            </span>
          )
        },
        exportValue: (f) => f.item?.diferenciaUnidades ?? null,
        exportFormat: 'number',
      },
    ],
    [],
  )

  const tableColumns = useTableColumns('corregir-conteos', columnas)
  const { filterGetters, filterTypes, sortGetters } = buildQueryGetters(columnas)
  const tableQuery = useTableQuery<FilaCorregible>({
    rows: visibles,
    filterGetters,
    filterTypes,
    sortGetters,
    persisted: { value: tableColumns.query, onChange: tableColumns.setQuery },
    getQuickFilterText: (f) => `${f.producto.codigo} ${f.producto.descripcion} ${f.producto.categoria ?? ''}`,
  })

  const { visibleColumns } = tableColumns
  const layout = useColumnLayout({
    visibleColumns,
    widths: tableColumns.widths,
    setWidths: tableColumns.setWidths,
    ready: !cargando,
  })
  const columnDrag = useColumnDrag(
    tableColumns.move,
    tableColumns.columns.map((c) => c.id),
  )

  const mostradas = tableQuery.rows
  const hayFiltros = tableQuery.quickFilter !== '' || Object.keys(tableQuery.columnFilters).length > 0
  const limpiarFiltros = () => {
    tableQuery.clearAllColumnFilters()
    tableQuery.setQuickFilter('')
  }

  async function guardar(cuerpo: { empaques: LineaEmpaque[]; sueltas: number; motivo: string }) {
    const fila = enEdicion
    if (fila === null) return
    setGuardando(true)
    setErrorAlGuardar(null)
    try {
      const resultado = await corregirApi.corregirConteo(fila.hojaId, fila.producto.id, cuerpo)
      setEnEdicion(null)
      /**
       * LO ÚNICO QUE EL CLIENTE PIDIÓ CON ESAS PALABRAS: *"corrígelo para que ya
       * no salga en mi segundo conteo"*. Una corrección que no saca nada de la
       * ronda es el caso normal y no merece un cartel, así que el aviso solo
       * aparece cuando hay algo nuevo que decir.
       */
      if (resultado.salioDeLaRonda) {
        setAviso({ texto: textoItemSalioDeRonda(resultado.salioDeLaRonda), tono: 'ok' })
      } else {
        setAviso({
          tono: 'ok',
          texto: `${fila.producto.codigo}: lo contado pasó de ${formatoMiles(resultado.totalAnterior)} a ${formatoMiles(resultado.total)} unidades. El motivo quedó registrado con tu nombre y la hora.`,
        })
      }
      // Se vuelve a pedir todo: la corrección puede cambiar el veredicto del
      // ítem (de "falta" a "cuadrado") y con él el filtro y los contadores.
      await cargar(true)
    } catch (e) {
      // El mensaje del servidor dice qué regla se topó (el ajuste ya empezó, no
      // es tu sucursal) y es lo accionable: va al `ErrorNotice` del formulario,
      // que no se va hasta que se lo cierre.
      setErrorAlGuardar(e)
    } finally {
      setGuardando(false)
    }
  }

  const nombreSucursal = sucursales.find((s) => s.id === sucursalId)?.nombre ?? sucursalDeSesion?.nombre
  const rondaActiva = inventario?.rondaActiva ?? null

  /** El contexto en un renglón: de qué inventario y de qué ronda es esta lista. */
  const contexto = useMemo(() => {
    if (inventario === null) return null
    const partes = [`Inventario ${inventario.inventarioId}`]
    if (rondaElegida !== null) partes.push(`${ordinal(rondaElegida)} conteo`)
    partes.push(`${formatoMiles(filas.length)} ${pluralizar(filas.length, 'ítem', 'ítems')} en la ronda`)
    partes.push(`${formatoMiles(sinCuadrar.length)} ${pluralizar(sinCuadrar.length, 'sin cuadrar', 'sin cuadrar')}`)
    return partes.join(' · ')
  }, [inventario, rondaElegida, filas.length, sinCuadrar.length])

  return (
    <div className="space-y-3 md:space-y-0 md:flex md:flex-col md:gap-4 md:h-[calc(100vh_-_var(--app-header-h)_-_1px_-_2*var(--app-content-pad))]">
      {/* Panel de acciones (D365): el Excel a la izquierda, [⟳][⚙] a la
          derecha. La corrección de a una no está acá: se abre tocando la fila. */}
      <div className="flex items-center justify-between gap-2">
        <ActionGroup
          items={[
            {
              id: 'exportar',
              label: exportando ? 'Armando el archivo...' : 'Bajar a Excel',
              icon: <DownloadIcon size={14} />,
              disabled: exportando || inventario === null,
              title:
                inventario === null
                  ? 'Esta tienda no tiene un inventario abierto, así que no hay conteos para bajar'
                  : 'Baja lo contado del mes de esta tienda, con el filtro que tienes puesto',
              onClick: () => void exportar(),
            },
            {
              id: 'importar',
              label: 'Corregir con un Excel',
              icon: <UploadIcon size={14} />,
              tone: 'primary',
              title: 'Sube el archivo editado: primero se ve fila por fila y nada se escribe hasta confirmar',
              onClick: () => setImportando(true),
            },
          ]}
          label="Corregir con un Excel"
        />
        <div className="flex items-center gap-2">
        <button
          onClick={() => void refrescar()}
          disabled={refrescando || cargando}
          className="p-[7px] border border-[var(--border)] rounded-md bg-white text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)] disabled:opacity-50 transition-colors"
          title="Volver a leer lo contado"
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

      {/* El resultado de la última corrección, ARRIBA de la lista: la lista se
          recarga y se reordena debajo, así que al pie el aviso quedaría fuera
          de pantalla justo después de guardar. */}
      {aviso !== null && (
        <div
          className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[12px] ${
            aviso.tono === 'ok'
              ? 'border-[var(--success-border)] bg-[var(--success-light)] text-[var(--fg)]'
              : 'border-[var(--warning-border)] bg-[var(--warning-light)] text-[var(--fg)]'
          }`}
        >
          <span className={aviso.tono === 'ok' ? 'text-[var(--success)]' : 'text-[var(--warning)]'} aria-hidden="true">
            {aviso.tono === 'ok' ? <CheckCircleIcon size={14} /> : <AlertIcon size={14} />}
          </span>
          <p className="min-w-0 break-words">{aviso.texto}</p>
          <button
            type="button"
            onClick={() => setAviso(null)}
            aria-label="Cerrar el aviso"
            className="ml-auto shrink-0 text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            ✕
          </button>
        </div>
      )}

      <div>
        <h1 className="text-sm md:text-[13px] font-semibold text-[var(--fg)]">
          Corregir lo contado
          {nombreSucursal && <span className="ml-2 font-normal text-[var(--fg-muted)]">{nombreSucursal}</span>}
        </h1>
        {contexto !== null && <p className="text-[12px] text-[var(--fg-muted)]">{contexto}</p>}
        {sePuedeCorregir && (
          <p className="text-[12px] text-[var(--fg-muted)]">
            Abre un ítem para corregir lo que se contó. Cada cambio pide un motivo y queda registrado con tu nombre.{' '}
            {STOCK_NO_SE_CORRIGE}
          </p>
        )}
      </div>

      {/* Sucursal, ronda y filtros. Nunca un <select> nativo. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <QuickFilterInput value={tableQuery.quickFilter} onChange={tableQuery.setQuickFilter} />
        <SearchableSelect
          options={sucursales.map((s) => ({ value: String(s.id), label: s.nombre }))}
          value={sucursalId === null ? '' : String(sucursalId)}
          onChange={(v) => {
            // El aviso viejo habla de la tienda que se está dejando.
            setAviso(null)
            setRondaElegida(null)
            setSucursalElegida(Number(v))
          }}
          placeholder="Elige la sucursal"
          ariaLabel="Sucursal a auditar"
          className="sm:w-56"
        />
        {/* Con una sola ronda no se ofrece nada: un selector de una opción es un
            control que no decide nada. */}
        {rondaActiva !== null && rondaActiva > 1 && (
          <SearchableSelect
            options={Array.from({ length: rondaActiva }, (_, i) => ({
              value: String(i + 1),
              label: `${ordinal(i + 1)} conteo`,
            }))}
            value={String(rondaElegida ?? rondaActiva)}
            onChange={(v) => {
              setAviso(null)
              setRondaElegida(Number(v))
            }}
            ariaLabel="Conteo a corregir"
            className="sm:w-44"
            searchThreshold={12}
          />
        )}
        {sePuedeCorregir && (
          <SearchableSelect
            options={[
              { value: 'sin-cuadrar', label: `Sin cuadrar (${formatoMiles(sinCuadrar.length)})` },
              { value: 'todos', label: `Todos (${formatoMiles(filas.length)})` },
            ]}
            value={filtro}
            onChange={(v) => setFiltro(v as Filtro)}
            ariaLabel="Qué ítems mostrar"
            className="sm:w-52"
            searchThreshold={12}
          />
        )}
      </div>

      {cargando ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner text="Leyendo lo contado..." />
        </div>
      ) : sucursalId === null ? (
        <EmptyState
          title="Elige una sucursal"
          message="Esta pantalla corrige lo contado de una tienda a la vez. Elige cuál arriba."
        />
      ) : error !== null ? (
        <EmptyState title="No se pudo cargar lo contado" message={error} />
      ) : !sePuedeCorregir ? (
        /*
          NO dice "vuelve a intentar": esto no cambia solo. Dice qué pasó, que
          en el caso del ajuste es una decisión que ya se tomó.
        */
        <EmptyState
          title={fase === 'ajuste' ? 'Ya empezó el ajuste final' : 'Aquí no hay nada que corregir'}
          message={
            bloqueo ??
            'Todavía no hay un inventario abierto en esta tienda, o no tiene una ronda con hojas para corregir.'
          }
        />
      ) : (
        <>
          <div className="hidden md:block md:flex-1 md:min-h-0 border border-[var(--border)] rounded-md overflow-auto">
            <table ref={layout.tableRef} className={`${layout.tableClass} text-sm`} style={layout.tableStyle}>
              <colgroup>
                {visibleColumns.map((column) => (
                  <col key={column.id} style={layout.colStyle(column)} />
                ))}
                {layout.hasFiller && <col />}
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="bg-white border-b border-[var(--border)]">
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
                {mostradas.map((fila) => (
                  /*
                    LA FILA ABRE LA CORRECCIÓN. Sin checkbox de selección ni
                    menú "..." : no hay ninguna acción masiva detrás, y un
                    control que no hace nada enseña a ignorar la interfaz.
                  */
                  <tr
                    key={`${fila.hojaId}-${fila.producto.id}`}
                    onClick={() => setEnEdicion(fila)}
                    title={`Corregir lo contado de ${fila.producto.descripcion}`}
                    className="cursor-pointer transition-colors hover:bg-[var(--bg-subtle)]"
                  >
                    {visibleColumns.map((column) => {
                      const crudo = column.filter?.value?.(fila)
                      return (
                        <td
                          key={column.id}
                          title={typeof crudo === 'string' ? crudo : undefined}
                          className={`px-2 md:px-3 truncate ${column.cellClassName ?? ''}`}
                        >
                          {column.renderCell(fila)}
                        </td>
                      )
                    })}
                    {layout.hasFiller && <td aria-hidden="true" className="p-0" />}
                  </tr>
                ))}
                {mostradas.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length + (layout.hasFiller ? 1 : 0)} className="py-10 text-center">
                      {hayFiltros ? (
                        <NoFilterMatches onClear={limpiarFiltros} />
                      ) : (
                        <p className="text-sm text-[var(--fg-muted)]">
                          {filtro === 'sin-cuadrar'
                            ? 'No queda ningún ítem sin cuadrar. Puedes ver la lista completa con el filtro de arriba.'
                            : 'Las hojas de esta ronda todavía no tienen catálogo cargado.'}
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Tarjetas en móvil: siete columnas no entran en un teléfono. */}
          <div className="md:hidden space-y-3">
            {mostradas.length === 0 && hayFiltros && <NoFilterMatches onClear={limpiarFiltros} />}
            {mostradas.map((fila) => {
              const badge = badgeDeDiferencia(fila.item?.diferenciaUnidades ?? null)
              const stock = fila.item?.stockDeLaMedicion.stockErp ?? null
              return (
                <button
                  key={`${fila.hojaId}-${fila.producto.id}`}
                  type="button"
                  onClick={() => setEnEdicion(fila)}
                  className="w-full text-left bg-white rounded-md border border-[var(--border)] p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--fg)] truncate">{fila.producto.descripcion}</p>
                    <StatusBadge status={badge.label} label={badge.label} variant={badge.variant} />
                  </div>
                  <p className="text-xs text-[var(--fg-muted)]">
                    {fila.producto.codigo} · Hoja #{fila.numeroHoja}
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-[var(--fg-muted)]">Contado</p>
                      <p className="text-[var(--fg)] tabular-nums">
                        {fila.contado === null ? SIN_DATO : formatoMiles(fila.contado)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[var(--fg-muted)]">Stock del sistema</p>
                      <p className="text-[var(--fg)] tabular-nums">{stock === null ? SIN_DATO : formatoMiles(stock)}</p>
                    </div>
                  </div>
                  <p className="flex items-center gap-1 text-[11px] text-[var(--fg-muted)]">
                    <PencilIcon size={11} /> Toca para corregir
                  </p>
                </button>
              )
            })}
          </div>
        </>
      )}

      <PanelCorreccion
        fila={enEdicion}
        guardando={guardando}
        error={errorAlGuardar}
        onDescartarError={() => setErrorAlGuardar(null)}
        onGuardar={(cuerpo) => void guardar(cuerpo)}
        onCerrar={() => {
          setEnEdicion(null)
          setErrorAlGuardar(null)
        }}
      />

      <PanelImportacion
        abierto={importando}
        onCerrar={() => setImportando(false)}
        onAplicado={despuesDeImportar}
      />
    </div>
  )
}
