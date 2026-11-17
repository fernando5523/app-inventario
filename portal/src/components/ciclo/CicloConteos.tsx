import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { HiRefresh } from 'react-icons/hi'
import { PlusCircleIcon, LawIcon, AlertIcon, CheckCircleIcon } from '@primer/octicons-react'
import { ActionGroup } from '../common/ActionGroup'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { EmptyState } from '../common/EmptyState'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { SearchableSelect } from '../common/SearchableSelect'
import { StatusBadge } from '../common/StatusBadge'
import { TableSettingsButton } from '../common/table-settings/TableSettingsButton'
import { useTableColumns } from '../common/table-settings/useTableColumns'
import type { TableColumnDef } from '../common/table-settings/types'
import { GridHeaderCell, useColumnDrag, useColumnLayout } from '../common/table-grid'
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus'
import { sesionApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { apiErrorText } from '../../utils/apiError'
import { notifyError } from '../../utils/notifyError'
import { formatoMiles, formatoPct, pluralizar } from '../../utils/formato'
import type { Sucursal } from '../../tipos'
import { cicloApi } from './cicloApi'
import type { ResumenRonda } from './cicloTipos'
import {
  RONDA_MAX,
  badgeDePaso,
  elAuditorPuedeDecidir,
  faseDeCierre,
  filasDelCiclo,
  inventarioDelCiclo,
  ordinal,
  pasadasCorridas,
  puedeConsultarHistorial,
  rondaQueAdmiteConteo as rondaConConteo,
  type FaseDeCierre,
  type FilaDeRonda,
} from './cicloDominio'

/**
 * ---------------------------------------------------------------------------
 * EL CICLO DE CONTEOS EN EL PORTAL: EL EMBUDO COMO TABLA
 * ---------------------------------------------------------------------------
 * Portada de `mobile/components/pantallas/CicloScreen.tsx`, variante AUDITOR
 * (el portal es suyo). Las reglas y los textos NO se reescribieron: viven en
 * `cicloDominio.ts`, que es la copia de los módulos de dominio del teléfono --
 * ver su cabecera.
 *
 * LO QUE CAMBIA RESPECTO DEL TELÉFONO es la FORMA, y por una razón: en el
 * teléfono cada pasada es una tarjeta que se scrollea, porque una columna de
 * 400px no aguanta siete cifras. Acá el Auditor quiere ver las cuatro pasadas
 * una debajo de la otra y barrer la columna "A recontar" de arriba abajo para
 * entender dónde se traba el inventario. Eso es una tabla.
 *
 * ---------------------------------------------------------------------------
 * LO QUE EL AUDITOR **NO** PUEDE HACER ACÁ, Y NO ES UN OLVIDO
 * ---------------------------------------------------------------------------
 * CERRAR UNA RONDA. `POST /api/inventarios/:id/rondas/:ronda/cerrar` exige
 * `administrador` o `coordinador` (`inventarios.routes.ts#puedeEscribir`), así
 * que el bloque de cierre del teléfono -- con su preview, su aviso de hojas
 * sin finalizar y su botón -- es del Coordinador y no se portó. Dibujarlo acá
 * sería un botón que termina en 403.
 *
 * ELEGIR EL TAMAÑO DE HOJA de los reconteos: también es decisión del
 * Coordinador; el teléfono se lo muestra al Auditor de solo lectura.
 *
 * ---------------------------------------------------------------------------
 * SIN FILTROS NI SELECCIÓN EN ESTA TABLA
 * ---------------------------------------------------------------------------
 * `useTableColumns` sí (nueve columnas: esconderlas y reordenarlas sirve),
 * pero no `useTableQuery` ni `useRowSelection`. Un inventario tiene tres,
 * cuatro o cinco pasadas: un buscador y un filtro por columna sobre cuatro
 * filas son controles que no hacen nada, y eso enseña a ignorar la interfaz.
 */

const HEADER_CELL_CLASS = 'px-2 md:px-3 py-1.5 text-[11px] md:text-xs font-semibold text-[var(--fg-muted)]'
/**
 * TODAS LAS CIFRAS EN LA TINTA NORMAL, sin verde ni rojo según el signo: lo
 * pidió el cliente para las tablas del portal ("nada de colores a los
 * registros en la tabla") y es la regla de la marca -- el rojo es SIEMPRE
 * acción, nunca un estado. En el teléfono el embudo pinta "cuadraron" en verde
 * y "a recontar" en rojo; acá el estado lo lleva el badge y los encabezados
 * dicen qué es cada número.
 */
const NUM_CELL_CLASS = 'py-1.5 text-xs text-[var(--fg)] tabular-nums text-right'

/** Sin dato es guion, NUNCA un 0: un cero afirma que se contó y dio cero. */
const SIN_DATO = '—'

/** El nombre del estado del inventario, igual que en el Panel de auditoría. */
function nombreDeFase(fase: FaseDeCierre | null): { label: string; variant: 'default' | 'success' | 'warning' } {
  if (fase === null) return { label: 'Sin inventario', variant: 'default' }
  if (fase === 'sin-hojas') return { label: 'Sin hojas todavía', variant: 'default' }
  if (fase === 'contando') return { label: 'Conteo en curso', variant: 'default' }
  if (fase === 'rondas-cerradas') return { label: 'Esperando al auditor', variant: 'warning' }
  if (fase === 'ajuste') return { label: 'Ajuste final en curso', variant: 'warning' }
  return { label: 'Conteo cerrado', variant: 'success' }
}

/** Lo que pasó con la última acción del Auditor, y de cuál de las dos habla. */
interface Aviso {
  cual: 'ronda' | 'ajuste'
  tono: 'ok' | 'rechazo'
  mensaje: string
}

export function CicloConteos() {
  const { colaborador, sucursal: sucursalDeSesion, rol } = useAuthStore()

  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  /** null = todavía no eligió: manda la de su ficha. */
  const [sucursalElegida, setSucursalElegida] = useState<number | null>(null)
  const [inventarioId, setInventarioId] = useState<number | null>(null)
  const [items, setItems] = useState<number | null>(null)
  const [tamanoHoja, setTamanoHoja] = useState<number | null>(null)
  const [totalHojas, setTotalHojas] = useState<number | null>(null)
  const [rondaActiva, setRondaActiva] = useState<number | null>(null)
  const [fase, setFase] = useState<FaseDeCierre | null>(null)
  const [resumenPorRonda, setResumenPorRonda] = useState<Record<number, ResumenRonda | null>>({})

  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refrescando, setRefrescando] = useState(false)
  const [accion, setAccion] = useState<'ronda' | 'ajuste' | null>(null)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [confirmarAjuste, setConfirmarAjuste] = useState(false)

  const sucursalId = sucursalElegida ?? sucursalDeSesion?.id ?? null

  useEffect(() => {
    sesionApi
      .sucursales()
      .then(setSucursales)
      .catch((e) => notifyError('No se pudieron cargar las sucursales', e))
  }, [])

  /**
   * EL EMBUDO DE LAS RONDAS, del servidor y de una sola fuente: el mismo
   * `resumenDeRonda` llamado con 1, 2, 3 y las que haya de más, sobre TODOS
   * los conteos del inventario.
   *
   * `hastaRonda` no es 3 fijo: el Auditor abre un 4to o un 5to, y con el techo
   * clavado esas rondas se contarían en el servidor pero no se verían acá.
   *
   * UN 404 QUEDA EN `null` Y NO ES UN FALLO: esa ronda todavía no se abrió, y
   * la tabla lo dice con esas palabras en vez de mostrar un cálculo fallido.
   */
  const cargarRondas = useCallback(async (invId: number, hastaRonda: number) => {
    const rondas = Array.from({ length: Math.max(RONDA_MAX, hastaRonda) }, (_, i) => i + 1)
    const resultados = await Promise.all(
      rondas.map(async (r) => {
        try {
          return [r, await cicloApi.resumenDeRonda(invId, r)] as const
        } catch {
          return [r, null] as const
        }
      }),
    )
    setResumenPorRonda(Object.fromEntries(resultados))
  }, [])

  /**
   * SIN RELLENO: si la lectura falla, la tabla desaparece y se dice por qué.
   * Un embudo en cero sobre un inventario que sí se está contando se lee como
   * un dato y no como una falla.
   */
  const cargar = useCallback(
    async (silencioso = false) => {
      if (sucursalId === null) {
        setInventarioId(null)
        setResumenPorRonda({})
        setCargando(false)
        return
      }
      if (!silencioso) setCargando(true)
      try {
        const abierto = await cicloApi.activo(sucursalId)
        /**
         * EL HISTÓRICO SOLO SE PIDE SI EL ROL LO TIENE. Sin inventario
         * abierto, el ciclo que se muestra es el del último cerrado, y ese
         * sale del histórico -- que es del auditor y del administrador. Pedir
         * lo que ya se sabe que va a ser negado deja un "no tienes permiso"
         * sobre una pantalla que SÍ es de quien la mira.
         */
        const historial =
          abierto || !puedeConsultarHistorial(rol ?? '')
            ? []
            : (await cicloApi.historial(sucursalId)).inventarios

        const delCiclo = inventarioDelCiclo(abierto, historial)
        setInventarioId(delCiclo?.inventarioId ?? null)
        setItems(delCiclo?.items ?? null)
        setTamanoHoja(delCiclo?.tamanoHoja ?? null)
        setTotalHojas(delCiclo?.totalHojas ?? null)
        setRondaActiva(delCiclo?.rondaActiva ?? null)
        // La fase sale del inventario ABIERTO. Si el ciclo vino del histórico,
        // ese inventario ya cerró: no hay nada que abrir ni que ajustar.
        setFase(
          abierto
            ? faseDeCierre(abierto.estado, abierto.rondaActiva, abierto.totalHojas, abierto.ultimaRondaCerrada)
            : delCiclo
              ? 'cerrado'
              : null,
        )
        setError(null)
        if (!delCiclo) {
          setResumenPorRonda({})
          return
        }
        await cargarRondas(delCiclo.inventarioId, delCiclo.rondaActiva ?? RONDA_MAX)
      } catch (e) {
        if (!silencioso) {
          setInventarioId(null)
          setResumenPorRonda({})
          setError(apiErrorText(e, 'No se pudo cargar el ciclo de conteos'))
        }
        notifyError('No se pudo cargar el ciclo de conteos', e)
      } finally {
        if (!silencioso) setCargando(false)
      }
    },
    [sucursalId, rol, cargarRondas],
  )

  /**
   * CAMBIAR DE SUCURSAL RECARGA. En el teléfono esto era un bug: el selector
   * del Auditor quedó sin efecto y seguía mostrando el ciclo de la tienda
   * anterior. Se limpia la tabla ANTES de pedir la nueva -- el encabezado ya
   * dice la tienda nueva, y dejar el embudo de la otra sería un número con el
   * apellido equivocado.
   */
  const primerRender = useRef(true)
  useEffect(() => {
    if (!primerRender.current) {
      setResumenPorRonda({})
      setAviso(null)
    }
    primerRender.current = false
    void cargar()
  }, [cargar])

  // Volver a la ventana relee en silencio: los conteos se mueven mientras esta
  // pantalla está abierta. Pausado mientras corre una acción: un refresco a
  // mitad de abrir una ronda pisaría la fase con el estado de ANTES.
  useRefreshOnFocus(() => cargar(true), accion === null && !confirmarAjuste)

  const refrescar = async () => {
    setRefrescando(true)
    try {
      await cargar()
    } finally {
      setRefrescando(false)
    }
  }

  /** La ronda que puede estar "en curso": solo en la fase `contando` hay una abierta. */
  const rondaAbierta = rondaConConteo(fase, rondaActiva)

  const filas = useMemo(
    () => filasDelCiclo(resumenPorRonda, rondaAbierta, formatoMiles, formatoPct),
    [resumenPorRonda, rondaAbierta],
  )

  const pasadas = pasadasCorridas(resumenPorRonda)
  const puedeDecidir = fase !== null && elAuditorPuedeDecidir(fase)

  /**
   * LAS DOS DECISIONES DEL AUDITOR. Se recarga todo después de cada una: abrir
   * una ronda cambia la ronda activa y el embudo; iniciar el ajuste cambia el
   * ESTADO del inventario, y con él lo que puede hacer el Coordinador en su
   * app. Tocar solo el estado local dejaría la pantalla diciendo algo que el
   * servidor ya no dice.
   */
  const ejecutar = async (cual: 'ronda' | 'ajuste') => {
    if (inventarioId === null) return
    setAccion(cual)
    // El aviso anterior se limpia ANTES de intentar: dejar el de la vez pasada
    // mientras corre el intento nuevo haría leer un rechazo viejo como el de ahora.
    setAviso(null)
    try {
      if (cual === 'ronda') {
        const abierta = await cicloApi.abrirRondaExtra(inventarioId)
        setAviso({
          cual,
          tono: 'ok',
          mensaje: `${ordinal(abierta.ronda)} conteo abierto. Las hojas nuevas nacen sin asignar: el coordinador las reparte desde Gestión de hojas.`,
        })
      } else {
        await cicloApi.iniciarAjuste(inventarioId)
        setAviso({
          cual,
          tono: 'ok',
          mensaje:
            'Ajuste final iniciado. Desde ahora los valores los cambias tú, comparando contra el stock. El coordinador ya no puede corregir.',
        })
      }
      await cargar(true)
    } catch (e) {
      /**
       * EL MENSAJE DEL SERVIDOR, TAL CUAL Y A LA VISTA. Dice qué regla se topó
       * -- "todavía queda una hoja sin finalizar", "el ajuste ya empezó", "no
       * queda nada por recontar", que ni siquiera es un error: es el caso
       * feliz. Un genérico borraría las tres cosas.
       *
       * Queda en la página y no en un toast que se va: el aviso tiene que
       * seguir ahí hasta el próximo intento o la próxima recarga. Y nombra la
       * acción de la que habla, porque hay dos botones y un aviso suelto no
       * diría de cuál de los dos es.
       */
      setAviso({
        cual,
        tono: 'rechazo',
        mensaje: apiErrorText(e, cual === 'ronda' ? 'No se pudo abrir el conteo' : 'No se pudo empezar el ajuste'),
      })
    } finally {
      setAccion(null)
    }
  }

  const columnas: TableColumnDef<FilaDeRonda>[] = useMemo(() => {
    /** Sin resumen de esa ronda, guion: ver `SIN_DATO`. */
    const cifra = (fila: FilaDeRonda, texto: (r: ResumenRonda) => string): string =>
      fila.resumen === null ? SIN_DATO : texto(fila.resumen as ResumenRonda)

    return [
      {
        id: 'paso',
        label: 'Pasada',
        width: 20,
        locked: true,
        cellClassName: 'py-1.5 text-xs font-semibold text-[var(--fg)]',
        renderCell: (f) => f.titulo,
        exportValue: (f) => f.titulo,
      },
      {
        id: 'estado',
        label: 'Estado',
        // 16 y no menos: "Sin datos todavía" es la etiqueta más larga, y
        // truncada deja de distinguirse de "Sin datos" de cualquier otra cosa.
        width: 16,
        cellClassName: 'py-1.5 text-xs',
        renderCell: (f) => {
          const badge = badgeDePaso(f.estado)
          return (
            <span className="inline-flex min-w-[120px]">
              <StatusBadge status={badge.label} label={badge.label} variant={badge.variant} />
            </span>
          )
        },
        exportValue: (f) => badgeDePaso(f.estado).label,
      },
      {
        id: 'entraron',
        // "Entraron" y no "Ítems": es el universo de ESTA pasada, no el del
        // inventario -- en la 2da entran solo los que no cuadraron en la 1ra.
        label: 'Entraron',
        width: 10,
        align: 'right',
        cellClassName: NUM_CELL_CLASS,
        renderCell: (f) => cifra(f, (r) => formatoMiles(r.total)),
        exportValue: (f) => f.resumen?.total ?? '',
        exportFormat: 'number',
      },
      {
        id: 'cuadrados',
        label: 'Cuadraron',
        width: 15,
        align: 'right',
        cellClassName: NUM_CELL_CLASS,
        /**
         * LOS DOS NÚMEROS, como en el Panel: "967 de 985" solo dice algo con su
         * denominador. Y el denominador son los AUDITABLES (`total -
         * sinDatoErp`), no el total: un ítem sin stock en el ERP no puede
         * cuadrar ni dejar de cuadrar, y meterlo abajo haría ver el ciclo peor
         * de lo que está.
         */
        renderCell: (f) =>
          f.comparativo === null
            ? SIN_DATO
            : `${formatoMiles(f.resumen!.cuadrados)} de ${formatoMiles(f.comparativo.auditables)}`,
        exportValue: (f) => (f.comparativo === null ? '' : `${f.resumen!.cuadrados} de ${f.comparativo.auditables}`),
      },
      {
        id: 'pct',
        label: '% cuadrado',
        width: 11,
        align: 'right',
        cellClassName: NUM_CELL_CLASS,
        renderCell: (f) => (f.comparativo === null ? SIN_DATO : `${formatoPct(f.comparativo.avance.pct)}%`),
        exportValue: (f) => f.comparativo?.avance.pct ?? '',
        exportFormat: 'number',
      },
      {
        id: 'aRecontar',
        label: 'A recontar',
        width: 11,
        align: 'right',
        cellClassName: NUM_CELL_CLASS,
        renderCell: (f) => cifra(f, (r) => formatoMiles(r.aRecontar)),
        exportValue: (f) => f.resumen?.aRecontar ?? '',
        exportFormat: 'number',
      },
      {
        id: 'sinContar',
        label: 'Sin contar',
        width: 11,
        align: 'right',
        cellClassName: NUM_CELL_CLASS,
        renderCell: (f) => cifra(f, (r) => formatoMiles(r.sinContar)),
        exportValue: (f) => f.resumen?.sinContar ?? '',
        exportFormat: 'number',
      },
      {
        id: 'sinErp',
        // Se muestran aparte y NUNCA como cuadrados: un ítem sin stock del ERP
        // no se puede auditar. Contarlo como cuadrado es el error que reportó
        // "100% cuadrado" sobre 11.835 productos sin stock cargado.
        label: 'Sin stock ERP',
        width: 12,
        align: 'right',
        cellClassName: NUM_CELL_CLASS,
        renderCell: (f) => cifra(f, (r) => formatoMiles(r.sinDatoErp)),
        exportValue: (f) => f.resumen?.sinDatoErp ?? '',
        exportFormat: 'number',
      },
      {
        id: 'queEntra',
        label: 'Qué se cuenta en esta pasada',
        width: 26,
        cellClassName: 'py-1.5 text-xs text-[var(--fg-muted)]',
        renderCell: (f) => f.descripcion,
        exportValue: (f) => f.descripcion,
      },
    ]
  }, [])

  const tableColumns = useTableColumns('ciclo-conteos', columnas)
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

  const nombreSucursal = sucursales.find((s) => s.id === sucursalId)?.nombre ?? sucursalDeSesion?.nombre
  const faseBadge = nombreDeFase(fase)

  /**
   * EL CONTEXTO EN UN RENGLÓN: de qué inventario es este embudo. Sin esto, una
   * tabla de cifras no dice de qué tienda ni de qué momento habla.
   *
   * Las PASADAS son las que corrieron de verdad, no un 3 fijo: el Auditor abre
   * un 4to o un 5to conteo, y el encabezado sería el primer lugar donde se
   * notaría que la pantalla cuenta una historia distinta de la del inventario.
   */
  const contexto = useMemo(() => {
    if (inventarioId === null) return null
    const partes = [`Inventario ${inventarioId}`]
    if (items !== null) partes.push(`${formatoMiles(items)} ${pluralizar(items, 'ítem', 'ítems')}`)
    if (totalHojas !== null && tamanoHoja !== null) {
      partes.push(`${formatoMiles(totalHojas)} ${pluralizar(totalHojas, 'hoja', 'hojas')} de ${tamanoHoja} ítems`)
    }
    partes.push(`${pasadas} ${pluralizar(pasadas, 'pasada corrida', 'pasadas corridas')}`)
    return partes.join(' · ')
  }, [inventarioId, items, totalHojas, tamanoHoja, pasadas])

  const sinSucursal = sucursalId === null

  return (
    <div className="space-y-3 md:space-y-0 md:flex md:flex-col md:gap-4">
      {/* Panel de acciones (D365): las decisiones del Auditor a la izquierda, [⟳][⚙] a la derecha. */}
      <div className="flex items-center justify-between gap-2">
        <ActionGroup
          items={[
            {
              id: 'ronda',
              label:
                accion === 'ronda'
                  ? 'Abriendo el conteo...'
                  : `Abrir el ${ordinal((rondaActiva ?? RONDA_MAX) + 1)} conteo`,
              icon: <PlusCircleIcon size={14} />,
              disabled: !puedeDecidir || accion !== null || inventarioId === null,
              title: puedeDecidir
                ? 'Abre otra pasada solo con los ítems que siguen sin cuadrar'
                : 'Se puede con el inventario abierto y el ajuste final sin empezar',
              onClick: () => void ejecutar('ronda'),
            },
            {
              id: 'ajuste',
              label: accion === 'ajuste' ? 'Iniciando el ajuste...' : 'Empezar el ajuste final',
              icon: <LawIcon size={14} />,
              tone: 'primary',
              disabled: !puedeDecidir || accion !== null || inventarioId === null,
              title: puedeDecidir
                ? 'Fija tú los valores definitivos contra el stock. Se puede una sola vez'
                : 'Se puede con el inventario abierto y el ajuste final sin empezar',
              onClick: () => setConfirmarAjuste(true),
            },
          ]}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refrescar()}
            disabled={refrescando}
            className="p-[7px] border border-[var(--border)] rounded-md bg-white text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)] disabled:opacity-50 transition-colors"
            title="Volver a leer el ciclo"
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

      {/*
        EL RESULTADO DE LA ÚLTIMA DECISIÓN, pegado a los botones que la
        produjeron y con la acción nombrada. No va en un toast: el motivo de un
        rechazo tiene que seguir a la vista mientras se decide qué hacer.
      */}
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
          <p className="min-w-0 break-words">
            <span className="font-semibold">
              {aviso.cual === 'ronda' ? 'Abrir otro conteo: ' : 'Ajuste final: '}
            </span>
            {aviso.mensaje}
          </p>
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
          Ciclo de conteos
          {nombreSucursal && <span className="ml-2 font-normal text-[var(--fg-muted)]">{nombreSucursal}</span>}
        </h1>
        {contexto && <p className="text-[12px] text-[var(--fg-muted)]">{contexto}</p>}
      </div>

      {/* El Auditor elige la tienda cuyo ciclo mira. Siempre visible, para
          poder cambiarla aunque la actual no tenga ciclo. Nunca un <select>. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <SearchableSelect
          options={sucursales.map((s) => ({ value: String(s.id), label: s.nombre }))}
          value={sucursalId === null ? '' : String(sucursalId)}
          onChange={(v) => setSucursalElegida(Number(v))}
          placeholder="Elige la sucursal a auditar"
          ariaLabel="Sucursal a auditar"
          className="sm:w-72"
        />
        <StatusBadge status={faseBadge.label} label={faseBadge.label} variant={faseBadge.variant} />
      </div>

      {sinSucursal ? (
        <EmptyState
          title="Elige una sucursal"
          message={`${colaborador?.nombre ?? 'El auditor'} audita toda la cadena: el ciclo es de una tienda, así que hay que elegir cuál mirar.`}
        />
      ) : cargando ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner text="Leyendo el ciclo de conteos..." />
        </div>
      ) : error !== null ? (
        <EmptyState
          title="No se pudo cargar el ciclo de conteos"
          message={error}
          action={{ label: 'Volver a intentar', onClick: () => void refrescar() }}
        />
      ) : inventarioId === null ? (
        /*
          TODAVÍA NO HAY INVENTARIO, y eso no es un error ni una falta de
          permisos: es el estado normal de cada tienda al empezar el mes. Antes
          acá caían las tres pasadas con sus "todavía no empezó", que sobre una
          tienda sin inventario se leen como un ciclo en curso y atrasado.
        */
        <EmptyState
          title="Esta tienda todavía no tiene inventario"
          message="No hay un inventario en curso ni uno cerrado para esta sucursal. Cuando el coordinador arme las hojas, el ciclo aparece acá."
        />
      ) : (
        <>
          <div className="hidden md:block border border-[var(--border)] rounded-md overflow-auto">
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
                      className={HEADER_CELL_CLASS}
                      layout={layout}
                      drag={columnDrag}
                    >
                      <span className={`block truncate ${column.align === 'right' ? 'text-right' : ''}`}>
                        {column.label}
                      </span>
                    </GridHeaderCell>
                  ))}
                  {layout.hasFiller && <th aria-hidden="true" className="p-0" />}
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => (
                  <tr key={fila.ronda} className="transition-colors hover:bg-[var(--bg-subtle)]">
                    {visibleColumns.map((column) => (
                      <td
                        key={column.id}
                        // El detalle completo del comparativo en el tooltip de la
                        // pasada: es la frase que el teléfono muestra dentro de la
                        // tarjeta, y acá no hay lugar para una línea por fila.
                        title={column.id === 'paso' ? (fila.comparativo?.detalle ?? fila.descripcion) : undefined}
                        className={`px-2 md:px-3 truncate ${column.cellClassName ?? ''}`}
                      >
                        {column.renderCell(fila)}
                      </td>
                    ))}
                    {layout.hasFiller && <td aria-hidden="true" className="p-0" />}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tarjetas en móvil: nueve columnas no entran en un teléfono. */}
          <div className="md:hidden space-y-3">
            {filas.map((fila) => {
              const badge = badgeDePaso(fila.estado)
              return (
                <div key={fila.ronda} className="bg-white rounded-md border border-[var(--border)] p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--fg)]">{fila.titulo}</p>
                    <StatusBadge status={badge.label} label={badge.label} variant={badge.variant} />
                  </div>
                  <p className="text-xs text-[var(--fg-muted)]">{fila.descripcion}</p>
                  {fila.comparativo !== null && (
                    <p className="text-xs text-[var(--fg)]">{fila.comparativo.detalle}</p>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-[var(--fg-muted)]">Entraron</p>
                      <p className="text-[var(--fg)] tabular-nums">
                        {fila.resumen === null ? SIN_DATO : formatoMiles(fila.resumen.total)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[var(--fg-muted)]">Cuadraron</p>
                      <p className="text-[var(--fg)] tabular-nums">
                        {fila.comparativo === null
                          ? SIN_DATO
                          : `${formatoMiles(fila.resumen!.cuadrados)} de ${formatoMiles(fila.comparativo.auditables)}`}
                      </p>
                    </div>
                    <div>
                      <p className="text-[var(--fg-muted)]">A recontar</p>
                      <p className="text-[var(--fg)] tabular-nums">
                        {fila.resumen === null ? SIN_DATO : formatoMiles(fila.resumen.aRecontar)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[var(--fg-muted)]">Sin stock ERP</p>
                      <p className="text-[var(--fg)] tabular-nums">
                        {fila.resumen === null ? SIN_DATO : formatoMiles(fila.resumen.sinDatoErp)}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/*
            QUÉ SIGUE CON ESTE CONTEO. Los textos son los del teléfono. El de la
            PRECONDICIÓN va porque desde el cliente no se puede saber si la
            última ronda ya cerró (ver `faseDeCierre`): se avisa de antemano y
            el servidor es el que corta, con su mensaje.
          */}
          <div className="rounded-md border border-[var(--border)] bg-white p-3 space-y-1.5">
            <p className="text-[13px] font-semibold text-[var(--fg)]">
              {fase === 'ajuste' ? 'Ajuste final en curso' : '¿Qué sigue con este conteo?'}
            </p>
            {fase === 'ajuste' ? (
              <p className="text-[12px] text-[var(--fg-muted)]">
                El coordinador ya no puede corregir este inventario. Fija los valores definitivos y cierra el ajuste
                para que pase a la liquidación.
              </p>
            ) : puedeDecidir ? (
              <>
                <p className="text-[12px] text-[var(--fg-muted)]">
                  Cuando cierre la última ronda, el inventario te espera: puedes mandar otra pasada de conteo, o fijar
                  tú mismo los valores comparando contra el stock. Mientras no empieces el ajuste, el coordinador
                  todavía puede corregir lo que cargaron los contadores.
                </p>
                <p className="text-[12px] text-[var(--fg-subtle)]">
                  Las dos necesitan que la última ronda esté cerrada. Si todavía está abierta, te lo va a decir.
                </p>
              </>
            ) : (
              <p className="text-[12px] text-[var(--fg-muted)]">
                El conteo de este inventario está cerrado: sigue la liquidación.
              </p>
            )}
            <Link to="/ajuste" className="inline-block text-[12px] text-[var(--primary)] hover:underline">
              {fase === 'ajuste' ? 'Ir al ajuste final' : 'Ver el ajuste final'}
            </Link>
          </div>
        </>
      )}

      {/*
        SOLO EL AJUSTE SE CONFIRMA, y es la misma asimetría del teléfono: abrir
        otra pasada crea hojas y se puede volver a cerrar; empezar el ajuste
        le saca al coordinador la posibilidad de corregir y SE PUEDE UNA SOLA
        VEZ. Los textos son los del teléfono, incluido "Todavía no".
      */}
      {confirmarAjuste && (
        <ConfirmDialog
          title="Empezar el ajuste final"
          message="A partir de ahora el coordinador ya no puede corregir los conteos de este inventario: los valores los cambias tú, viendo el stock. Se puede empezar una sola vez."
          confirmText="Empezar el ajuste"
          cancelText="Todavía no"
          isLoading={accion === 'ajuste'}
          onConfirm={() => {
            setConfirmarAjuste(false)
            void ejecutar('ajuste')
          }}
          onCancel={() => setConfirmarAjuste(false)}
          onClose={() => setConfirmarAjuste(false)}
        />
      )}
    </div>
  )
}
