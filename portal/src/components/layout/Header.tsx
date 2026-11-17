import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { HiMenu } from 'react-icons/hi'
import { KeyIcon, SidebarCollapseIcon, SidebarExpandIcon, SignOutIcon } from '@primer/octicons-react'
import toast from 'react-hot-toast'
import { useUIStore } from '../../store/uiStore'
import { useAuthStore } from '../../store/authStore'
import { Avatar } from '../common/Avatar'
import { CambiarPinModal } from '../common/CambiarPinModal'
import { accesoDe } from './accesos'

/**
 * La barra superior, portada de app_pdv. Dos cosas se fueron:
 *
 * - `CompanySwitcher`: no hay multiempresa. Son once tiendas de UNA cadena, y
 *   el Auditor las ve todas a la vez en el Panel -- no elige una.
 * - El mapa `pageNames` escrito a mano. El título sale de `accesos.ts`, que es
 *   la misma lista que dibuja el menú: dos listas de nombres para las mismas
 *   pantallas se desincronizan en el primer cambio de nombre.
 *
 * LA BARRA ES NEGRA (`--bg-emphasis`) y todo lo que va encima usa
 * `--on-emphasis`. El color va en cada elemento y NO en el `<header>`: el menú
 * del avatar cuelga de acá y es una superficie clara, y heredaría el blanco.
 * Sin borde inferior: sobre negro, la línea gris se ve como un corte raro.
 */
export function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const sidebarExpanded = useUIStore((s) => s.sidebarExpanded)
  const toggleSidebarExpanded = useUIStore((s) => s.toggleSidebarExpanded)
  const colaborador = useAuthStore((s) => s.colaborador)
  const sucursal = useAuthStore((s) => s.sucursal)
  const salir = useAuthStore((s) => s.salir)
  const [showMenu, setShowMenu] = useState(false)
  const [showCambiarPin, setShowCambiarPin] = useState(false)

  const titulo = accesoDe(location.pathname)?.titulo ?? 'Portal del Auditor'

  const cerrarSesion = () => {
    salir()
    navigate('/login')
    toast.success('Sesión cerrada')
  }

  return (
    <header className="h-[var(--app-header-h)] bg-[var(--bg-emphasis)] flex items-center justify-between px-3 md:px-6 flex-shrink-0 z-50">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="foco-sobre-enfasis lg:hidden p-0.5 hover:bg-[var(--bg-emphasis-hover)] rounded-md transition-colors"
          title="Alternar menú"
        >
          <HiMenu className="w-4 h-4 text-[var(--on-emphasis)]" />
        </button>
        {/* El distintivo, invertido: un círculo negro sobre la barra negra no se ve. */}
        <div className="w-5 h-5 rounded-full bg-[var(--on-emphasis)] flex items-center justify-center">
          <span className="text-[var(--bg-emphasis)] text-[9px] font-bold leading-none">MT</span>
        </div>
        <button
          onClick={toggleSidebarExpanded}
          className="foco-sobre-enfasis hidden lg:flex p-0.5 rounded-md text-[var(--on-emphasis)] hover:bg-[var(--bg-emphasis-hover)] transition-colors"
          title={sidebarExpanded ? 'Colapsar menú' : 'Expandir menú'}
        >
          {sidebarExpanded ? <SidebarCollapseIcon size={14} /> : <SidebarExpandIcon size={14} />}
        </button>
        <h1 className="text-xs font-semibold text-[var(--on-emphasis)]">{titulo}</h1>
      </div>

      <div className="relative flex items-center gap-3">
        {colaborador && (
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="foco-sobre-enfasis rounded-full hover:shadow-[0_0_0_2px_var(--on-emphasis)] transition-shadow"
            title="Menú de usuario"
          >
            {/* Sobre la barra, en el gris del hover: el primario es el mismo negro de la barra. */}
            <Avatar name={colaborador.nombre} size="xs" color="var(--bg-emphasis-hover)" />
          </button>
        )}

        {showMenu && colaborador && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
            <div className="absolute right-0 top-full mt-1 bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-lg w-72 z-50 animate-fade-in overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-3">
                <Avatar name={colaborador.nombre} size="sm" />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-[var(--fg)] truncate">{colaborador.nombre}</div>
                  {/*
                    El ROL y la TIENDA juntos, y no solo el rol como en app_pdv:
                    el auditor entra eligiéndose dentro de una tienda pero audita
                    toda la cadena, así que "auditor" a secas no dice por dónde
                    entró. El administrador no tiene tienda y ahí no se muestra
                    ninguna.
                  */}
                  <div className="text-[12px] text-[var(--fg-muted)] truncate">
                    {colaborador.rol}
                    {sucursal ? ` · ${sucursal.nombre}` : ''}
                  </div>
                </div>
              </div>

              <div className="border-t border-[var(--border)]" />

              <div className="py-1">
                <button
                  onClick={() => {
                    setShowCambiarPin(true)
                    setShowMenu(false)
                  }}
                  className="w-full text-left px-4 py-[6px] text-[13px] text-[var(--fg)] hover:bg-[var(--bg-rail)] flex items-center gap-3 transition-colors"
                >
                  <KeyIcon size={16} className="text-[var(--fg-muted)]" />
                  Cambiar mi PIN
                </button>
              </div>

              <div className="border-t border-[var(--border)]" />

              <div className="py-1">
                <button
                  onClick={() => {
                    cerrarSesion()
                    setShowMenu(false)
                  }}
                  className="w-full text-left px-4 py-[6px] text-[13px] text-[var(--fg)] hover:bg-[var(--bg-rail)] flex items-center gap-3 transition-colors"
                >
                  <SignOutIcon size={16} className="text-[var(--fg-muted)]" />
                  Cerrar sesión
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {showCambiarPin && <CambiarPinModal onClose={() => setShowCambiarPin(false)} />}
    </header>
  )
}
