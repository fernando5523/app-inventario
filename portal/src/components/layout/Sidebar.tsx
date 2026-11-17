import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation } from 'react-router-dom'
import { HiChevronDown, HiX } from 'react-icons/hi'
import { useUIStore } from '../../store/uiStore'
import { useAuthStore } from '../../store/authStore'
import { GRUPOS_AUDITOR, type Acceso, type SubAcceso } from './accesos'
import type { Rol } from '../../tipos'

/**
 * EL MENÚ DEL PORTAL, portado del Sidebar de app_pdv con su estructura de
 * grupos entera: grupos con etiqueta, secciones expandibles, marcado de activo
 * por prefijo con desempate entre hermanos, rail colapsado con tooltip, borde
 * arrastrable y cajón a pantalla completa en móvil.
 *
 * LO ÚNICO QUE CAMBIA RESPECTO DE app_pdv es la unidad de autorización: allá
 * cada entrada declara un PERMISO (`P.SALES_VIEW`) y acá declara ROLES, porque
 * este backend no tiene permisos granulares (ver `routes/RoleRoute.tsx`). El
 * comportamiento es el mismo: una entrada que no pasa no se dibuja, y un grupo
 * entero cuyas entradas no pasan ninguna desaparece con su etiqueta y su
 * separador -- un encabezado "Cierre" sobre una lista vacía es peor que no
 * tener el grupo.
 *
 * La agrupación de los diez accesos vive en `accesos.ts`, no acá: es la misma
 * lista de la que `App.tsx` saca las rutas.
 */

function NavTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const handleEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setPos({ top: rect.top + rect.height / 2, left: rect.right + 8 })
    }
    setHover(true)
  }

  return (
    <div ref={ref} onMouseEnter={handleEnter} onMouseLeave={() => setHover(false)}>
      {children}
      {hover &&
        createPortal(
          <div
            className="fixed px-2.5 py-1.5 bg-[var(--bg-emphasis)] text-white text-[12px] font-medium rounded-md shadow-lg whitespace-nowrap z-[9999] pointer-events-none"
            style={{ top: pos.top, left: pos.left, transform: 'translateY(-50%)' }}
          >
            {label}
            <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[var(--bg-emphasis)]" />
          </div>,
          document.body,
        )}
    </div>
  )
}

export function Sidebar() {
  const location = useLocation()
  const { sidebarOpen, setSidebarOpen, sidebarExpanded, sidebarWidth, setSidebarWidth } = useUIStore()
  const tieneRol = useAuthStore((s) => s.tieneRol)
  const collapsed = !sidebarExpanded
  const [seccionesAbiertas, setSeccionesAbiertas] = useState<Record<string, boolean>>({})
  const [isResizing, setIsResizing] = useState(false)

  const closeMobile = () => setSidebarOpen(false)

  // El cajón móvil se cierra al navegar: si no, tapa la pantalla que se acaba
  // de abrir.
  useEffect(() => {
    setSidebarOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)

    const startX = e.clientX
    const startWidth = sidebarWidth

    const handleMouseMove = (ev: MouseEvent) => setSidebarWidth(startWidth + (ev.clientX - startX))

    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  /** Visible si el rol de la sesión cumple; sin `roles` declarados, siempre. */
  const puedeVer = (roles?: Rol[]) => roles === undefined || roles.length === 0 || tieneRol(roles)

  /** Un hijo sin `roles` propios hereda los del padre. */
  const puedeVerHijo = (hijo: SubAcceso, padre: Acceso) => puedeVer(hijo.roles ?? padre.roles)

  const esActivo = (ruta: string) => location.pathname === ruta || location.pathname.startsWith(ruta + '/')

  const padreActivo = (acceso: Acceso) =>
    esActivo(acceso.ruta) || (acceso.hijos?.some((h) => esActivo(h.ruta)) ?? false)

  /**
   * DE UN GRUPO DE HERMANOS SE MARCA SOLO EL MÁS ESPECÍFICO QUE COINCIDA.
   *
   * `esActivo` da por activo todo href que sea prefijo de la ruta, que es lo
   * correcto para el padre pero no entre hermanos: con `/ciclo` y
   * `/ciclo/ronda` estando en el hijo se encenderían los dos, y el menú deja de
   * decir dónde está uno.
   */
  const hermanoActivo = (hermanos: SubAcceso[]): string | null => {
    const coinciden = hermanos.filter((h) => esActivo(h.ruta))
    if (coinciden.length === 0) return null
    return coinciden.reduce((mejor, h) => (h.ruta.length > mejor.ruta.length ? h : mejor)).ruta
  }

  const alternarSeccion = (clave: string) =>
    setSeccionesAbiertas((prev) => ({ ...prev, [clave]: !prev[clave] }))

  /** Abierta si el usuario la abrió; si no la tocó, abierta cuando contiene la ruta actual. */
  const seccionAbierta = (acceso: Acceso) =>
    seccionesAbiertas[acceso.ruta] !== undefined ? seccionesAbiertas[acceso.ruta] : padreActivo(acceso)

  const renderHijo = (hijo: SubAcceso, padre: Acceso, rutaActiva: string | null) => {
    if (!puedeVerHijo(hijo, padre)) return null
    const activo = hijo.ruta === rutaActiva
    const Icono = hijo.icono

    return (
      <NavLink
        key={hijo.ruta}
        to={hijo.ruta}
        onClick={closeMobile}
        className={`flex items-center gap-2 py-[5px] pl-9 pr-3 rounded-md transition-colors relative ${
          activo
            ? 'text-[11px] font-bold bg-[var(--bg-rail)] text-[var(--fg)] before:content-[""] before:absolute before:left-[-5px] before:top-1.5 before:bottom-1.5 before:w-1 before:bg-[var(--primary)] before:rounded-full'
            : 'text-[12px] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--bg-rail)]'
        }`}
      >
        {Icono && (
          <Icono
            className={`w-3.5 h-3.5 flex-shrink-0 ${activo ? 'text-[var(--fg)]' : 'text-[var(--fg-muted)]'}`}
          />
        )}
        {hijo.titulo}
      </NavLink>
    )
  }

  const renderAcceso = (acceso: Acceso, isCollapsed: boolean) => {
    if (!puedeVer(acceso.roles)) return null

    const Icono = acceso.icono
    const hijosVisibles = acceso.hijos?.filter((h) => puedeVerHijo(h, acceso)) ?? []
    const tieneHijos = hijosVisibles.length > 0
    const activo = esActivo(acceso.ruta)
    const activoConHijos = padreActivo(acceso)
    const abierta = tieneHijos && seccionAbierta(acceso)

    if (isCollapsed) {
      return (
        <NavTooltip key={acceso.ruta} label={acceso.titulo}>
          <NavLink
            to={acceso.ruta}
            className={`flex items-center justify-center w-full h-10 rounded-md transition-colors relative ${
              activoConHijos
                ? 'bg-[var(--bg-rail)] text-[var(--fg)] before:content-[""] before:absolute before:left-[-5px] before:top-1.5 before:bottom-1.5 before:w-1 before:bg-[var(--primary)] before:rounded-full'
                : 'text-[var(--fg-muted)] hover:bg-[var(--bg-rail)] hover:text-[var(--fg)]'
            }`}
          >
            <Icono className="w-4 h-4" />
          </NavLink>
        </NavTooltip>
      )
    }

    if (tieneHijos) {
      return (
        <div key={acceso.ruta}>
          <button
            onClick={() => alternarSeccion(acceso.ruta)}
            title={acceso.sub}
            className={`w-full flex items-center gap-2.5 py-[5px] px-3 text-[13px] rounded-md transition-colors relative ${
              activoConHijos
                ? 'text-[var(--fg)] font-semibold border-2 border-[var(--primary)] rounded-md'
                : 'text-[var(--fg)] hover:bg-[var(--bg-rail)]'
            }`}
          >
            <Icono
              className={`w-[18px] h-[18px] flex-shrink-0 ${activoConHijos ? 'text-[var(--primary)]' : 'text-[var(--fg-muted)]'}`}
            />
            <span className="flex-1 text-left truncate">{acceso.titulo}</span>
            <HiChevronDown
              className={`w-4 h-4 text-[var(--fg-muted)] transition-transform ${abierta ? '' : '-rotate-90'}`}
            />
          </button>
          {abierta && (
            <div className="mt-0.5">
              {(() => {
                const rutaActiva = hermanoActivo(hijosVisibles)
                return hijosVisibles.map((h) => renderHijo(h, acceso, rutaActiva))
              })()}
            </div>
          )}
        </div>
      )
    }

    return (
      <NavLink
        key={acceso.ruta}
        to={acceso.ruta}
        onClick={closeMobile}
        title={acceso.sub}
        className={`flex items-center gap-2.5 py-[5px] px-3 text-[13px] rounded-md transition-colors relative ${
          activo
            ? 'bg-[var(--bg-rail)] text-[var(--fg)] font-semibold before:content-[""] before:absolute before:left-[-5px] before:top-1.5 before:bottom-1.5 before:w-1 before:bg-[var(--primary)] before:rounded-full'
            : 'text-[var(--fg)] hover:bg-[var(--bg-rail)]'
        }`}
      >
        <Icono className={`w-[18px] h-[18px] flex-shrink-0 ${activo ? 'text-[var(--primary)]' : 'text-[var(--fg-muted)]'}`} />
        <span className="truncate">{acceso.titulo}</span>
      </NavLink>
    )
  }

  const renderSidebarContent = (isCollapsed: boolean, useCustomWidth: boolean) => (
    <div
      className={`h-full flex flex-col bg-[var(--surface)] ${isCollapsed ? 'w-12' : ''}`}
      style={isCollapsed || !useCustomWidth ? undefined : { width: `${sidebarWidth}px` }}
    >
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {GRUPOS_AUDITOR.map((grupo, i) => {
          // El grupo entero desaparece -- etiqueta y separador incluidos -- si
          // ninguna de sus entradas pasa el filtro de rol.
          const visibles = grupo.items.filter((item) => puedeVer(item.roles))
          if (visibles.length === 0) return null

          return (
            <div key={grupo.label ?? `grupo-${i}`}>
              {i > 0 && !isCollapsed && <hr className="border-[var(--border)] my-3" />}
              {!isCollapsed && grupo.label && (
                <div className="px-3 pt-1 pb-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--fg-muted)]">
                  {grupo.label}
                </div>
              )}
              <div className="space-y-0.5">{visibles.map((item) => renderAcceso(item, isCollapsed))}</div>
            </div>
          )
        })}
      </nav>
    </div>
  )

  return (
    <>
      {/* Cajón móvil: pantalla completa, con su propio botón de cierre. */}
      <div
        className={`fixed inset-0 z-50 flex flex-col bg-[var(--surface)] transform transition-transform duration-300 lg:hidden ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between h-14 px-3 border-b border-[var(--border)] bg-[var(--bg-subtle)] flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-[var(--primary)] flex items-center justify-center">
              <span className="text-white text-[11px] font-bold leading-none">MT</span>
            </div>
            <span className="text-[13px] font-semibold text-[var(--fg)]">Portal del Auditor</span>
          </div>
          <button
            onClick={closeMobile}
            className="p-2 hover:bg-[var(--bg-rail)] rounded-md transition-colors"
            title="Cerrar menú"
            aria-label="Cerrar menú"
          >
            <HiX className="w-5 h-5 text-[var(--fg-muted)]" />
          </button>
        </div>
        <div className="flex-1 min-h-0">{renderSidebarContent(false, false)}</div>
      </div>

      {/* Menú de escritorio */}
      <div className="hidden lg:block flex-shrink-0 relative">
        {renderSidebarContent(collapsed, true)}
        {!collapsed && (
          <div
            onMouseDown={handleMouseDown}
            className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[var(--primary)] transition-colors z-20 ${
              isResizing ? 'bg-[var(--primary)]' : 'bg-transparent'
            }`}
          />
        )}
      </div>
    </>
  )
}
