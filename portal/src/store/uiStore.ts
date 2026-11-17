import { create } from 'zustand'
import type { TableColumnsConfig } from '../components/common/table-settings/types'

/**
 * PREFERENCIAS DE INTERFAZ: ancho y estado del menú, y la configuración de cada
 * tabla (orden de columnas, cuáles están ocultas, anchos, filtros y orden
 * vigentes).
 *
 * ADAPTADO de app_pdv, y el cambio es de dónde sale el dato. Allá las
 * preferencias viven en el SERVIDOR (`PUT /auth/preferences`, con un debounce
 * de 500 ms y un `fetch` con `keepalive` en `pagehide` para no perder el último
 * cambio). Este backend no tiene ese endpoint -- no hay ninguna ruta de
 * preferencias de usuario en `backend/src/modules/` -- así que se guarda en
 * `localStorage`.
 *
 * Lo que eso cambia para quien lo usa: las preferencias NO viajan entre
 * navegadores ni entre máquinas. Para un portal de escritorio que se usa desde
 * el mismo equipo es el comportamiento esperado; el día que el backend tenga
 * preferencias de usuario, el único cambio es reemplazar `leer`/`escribir` de
 * acá -- el resto de la app ya habla contra esta interfaz.
 *
 * El debounce se conserva igual (500 ms): `localStorage.setItem` es síncrono y
 * bloquea el hilo, y arrastrar el borde del menú dispara un `set` por
 * `mousemove`.
 */

const CLAVE = 'inventario_preferencias'

interface UIState {
  sidebarOpen: boolean
  sidebarExpanded: boolean
  sidebarWidth: number
  /**
   * Copia COMPLETA de las preferencias. Se guarda entera, igual que en app_pdv:
   * escribir solo la parte que cambió borraría el resto (el menú al guardar una
   * tabla, o al revés).
   */
  preferences: Record<string, unknown>
  setSidebarOpen: (open: boolean) => void
  setSidebarExpanded: (expanded: boolean) => void
  toggleSidebarExpanded: () => void
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  loadPreferences: (prefs: Record<string, unknown>) => void
  /** Guarda la configuración de columnas de una tabla; `null` vuelve a la de fábrica. */
  setTableConfig: (tableId: string, config: TableColumnsConfig | null) => void
}

let temporizador: ReturnType<typeof setTimeout> | null = null

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor)

function leerDelDisco(): Record<string, unknown> {
  try {
    const crudo = localStorage.getItem(CLAVE)
    if (!crudo) return {}
    const valor: unknown = JSON.parse(crudo)
    return esObjeto(valor) ? valor : {}
  } catch {
    // Almacenamiento bloqueado o JSON corrupto: se arranca con las
    // preferencias de fábrica, que es lo que hace cualquier usuario nuevo.
    return {}
  }
}

/** Configuración guardada de una tabla, o `null` si el usuario no la tocó. */
export const selectTableConfig = (tableId: string) => (state: UIState): TableColumnsConfig | null => {
  const tables = state.preferences.tables
  if (!esObjeto(tables)) return null
  const config = tables[tableId]
  return esObjeto(config) ? (config as unknown as TableColumnsConfig) : null
}

export const useUIStore = create<UIState>((set, get) => {
  const guardadas = leerDelDisco()

  // Lee al dispararse, no al programarse: si en los 500 ms cambian el menú y
  // una tabla, la única escritura lleva los dos cambios.
  const escribir = () => {
    if (temporizador) clearTimeout(temporizador)
    temporizador = setTimeout(() => {
      temporizador = null
      try {
        localStorage.setItem(CLAVE, JSON.stringify(get().preferences))
      } catch {
        // Sin almacenamiento las preferencias viven lo que dure la pestaña.
      }
    }, 500)
  }

  // Recargar o cerrar la pestaña dentro de la ventana de 500 ms no puede
  // perder el último cambio (un ancho de columna, un filtro).
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      if (!temporizador) return
      clearTimeout(temporizador)
      temporizador = null
      try {
        localStorage.setItem(CLAVE, JSON.stringify(get().preferences))
      } catch {
        // Idem.
      }
    })
  }

  const actualizar = (parche: Record<string, unknown>) => {
    set({ preferences: { ...get().preferences, ...parche } })
    escribir()
  }

  const anchoValido = (ancho: number) => Math.max(180, Math.min(400, ancho))

  return {
    sidebarOpen: false,
    sidebarExpanded: guardadas.sidebarExpanded === undefined ? true : Boolean(guardadas.sidebarExpanded),
    sidebarWidth: typeof guardadas.sidebarWidth === 'number' ? anchoValido(guardadas.sidebarWidth) : 240,
    preferences: guardadas,

    setSidebarOpen: (open: boolean) => set({ sidebarOpen: open }),

    setSidebarExpanded: (expanded: boolean) => {
      set({ sidebarExpanded: expanded })
      actualizar({ sidebarExpanded: expanded, sidebarWidth: get().sidebarWidth })
    },

    toggleSidebarExpanded: () => {
      const expanded = !get().sidebarExpanded
      set({ sidebarExpanded: expanded })
      actualizar({ sidebarExpanded: expanded, sidebarWidth: get().sidebarWidth })
    },

    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

    setSidebarWidth: (width: number) => {
      const acotado = anchoValido(width)
      set({ sidebarWidth: acotado })
      actualizar({ sidebarExpanded: get().sidebarExpanded, sidebarWidth: acotado })
    },

    loadPreferences: (prefs: Record<string, unknown>) => {
      const cambios: Partial<UIState> = { preferences: { ...prefs } }
      if (prefs.sidebarExpanded !== undefined) cambios.sidebarExpanded = Boolean(prefs.sidebarExpanded)
      if (typeof prefs.sidebarWidth === 'number') cambios.sidebarWidth = anchoValido(prefs.sidebarWidth)
      set(cambios)
    },

    setTableConfig: (tableId: string, config: TableColumnsConfig | null) => {
      const tables = get().preferences.tables
      actualizar({ tables: { ...(esObjeto(tables) ? tables : {}), [tableId]: config } })
    },
  }
})
