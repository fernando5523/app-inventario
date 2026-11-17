import type { ReactNode } from 'react'
import { useAuthStore } from '../../store/authStore'
import type { Rol } from '../../tipos'

interface RoleRouteProps {
  /** Se cumple con CUALQUIERA de los roles de la lista. */
  roles: Rol[]
  children: ReactNode
}

/**
 * REEMPLAZA a `PermissionRoute` de app_pdv, y no es el mismo componente con
 * otro nombre: cambia la unidad de autorización.
 *
 * app_pdv pregunta por un PERMISO (`P.SALES_VIEW`) contra un conjunto que el
 * servidor le manda por usuario. Este backend no tiene permisos granulares:
 * cada router declara `requiereRol('administrador', 'auditor', ...)`, y los
 * recortes más finos dependen del INVENTARIO y no del usuario (ver
 * `backend/src/modules/auditoria/auditoria.permisos.ts`). Con esa forma, un
 * padrón de permisos en el cliente sería una segunda regla que el servidor no
 * comparte: se desincroniza en el primer cambio.
 *
 * ESTO NO ES LA SEGURIDAD, es la navegación. Quien tenga el rol equivocado no
 * ve la pantalla, pero lo que de verdad impide leer los datos es el
 * `requiereRol` del backend -- esta guarda solo evita mostrar una pantalla que
 * iba a contestar 403.
 */
export function RoleRoute({ roles, children }: RoleRouteProps) {
  const permitido = useAuthStore((state) => state.tieneRol(roles))
  const rol = useAuthStore((state) => state.rol)

  if (!permitido) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-[var(--fg)] mb-1">Sin acceso</h1>
          <p className="text-[13px] text-[var(--fg-muted)]">
            Esta pantalla es para {roles.join(' o ')}
            {rol ? `, y tu cuenta entra como ${rol}` : ''}.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
