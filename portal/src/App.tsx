import { useEffect, type ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './store/authStore'
import { MainLayout } from './components/layout/MainLayout'
import { ProtectedRoute } from './components/routes/ProtectedRoute'
import { RoleRoute } from './components/routes/RoleRoute'
import { LoginPage } from './components/auth/LoginPage'
import { LoadingSpinner } from './components/common/LoadingSpinner'
import { PanelAuditoria } from './components/auditoria/PanelAuditoria'
import { CicloConteos } from './components/ciclo/CicloConteos'
import { CorregirConteos } from './components/corregir/CorregirConteos'
import { AjusteFinal } from './components/ajuste/AjusteFinal'
import { ClasificacionProductos } from './components/clasificacion/ClasificacionProductos'
import { UsuariosDeMiSucursal } from './components/usuarios/UsuariosDeMiSucursal'
import { HistorialInventarios } from './components/historial/HistorialInventarios'
import { Liquidacion } from './components/liquidacion/Liquidacion'
import { AprobacionYLacrado } from './components/lacrado/AprobacionYLacrado'
import { PantallaPendiente } from './components/pendientes/PantallaPendiente'
import { ACCESOS_AUDITOR } from './components/layout/accesos'

/**
 * LAS PANTALLAS QUE YA EXISTEN, por su ruta.
 *
 * Reemplaza al antiguo `portada: true` de `accesos.ts`, que solo sabía
 * distinguir una pantalla real de las demás. Con el registro, portar una
 * pantalla es agregar UNA línea acá; lo que no esté listado cae solo en el
 * cartel de "pendiente de portar", sin tocar la lista del menú.
 */
const PANTALLAS: Record<string, ReactElement> = {
  '/auditoria': <PanelAuditoria />,
  '/ciclo': <CicloConteos />,
  '/corregir': <CorregirConteos />,
  '/ajuste': <AjusteFinal />,
  '/clasificacion': <ClasificacionProductos />,
  '/usuarios': <UsuariosDeMiSucursal />,
  '/historial': <HistorialInventarios />,
  '/liquidacion': <Liquidacion />,
  '/lacrado': <AprobacionYLacrado />,
}

/**
 * LAS DIEZ RUTAS DEL AUDITOR SE DECLARAN TODAS, pero solo la primera está
 * implementada. Las otras nueve se generan desde la MISMA lista que dibuja el
 * menú (`accesos.ts`): una ruta declarada a mano que no esté en el menú es una
 * pantalla a la que no se llega, y una entrada del menú sin ruta es un clic que
 * cae en la pantalla de "no existe". Generándolas juntas, no puede pasar
 * ninguna de las dos.
 *
 * Cada ruta lleva el `RoleRoute` con los roles que declara su acceso (hoy
 * `auditor` en las diez). `administrador` entra a todo por la jerarquía del
 * store, no por una lista aparte (ver `authStore.tieneRol`).
 */
function App() {
  const isLoading = useAuthStore((state) => state.isLoading)
  const checkAuth = useAuthStore((state) => state.checkAuth)

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner text="Cargando..." />
      </div>
    )
  }

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          {ACCESOS_AUDITOR.flatMap((acceso) => [
            <Route
              key={acceso.ruta}
              path={acceso.ruta}
              element={
                <RoleRoute roles={acceso.roles ?? ['auditor']}>
                  {PANTALLAS[acceso.ruta] ?? (
                    <PantallaPendiente titulo={acceso.titulo} sub={acceso.sub} />
                  )}
                </RoleRoute>
              }
            />,
            // Las sub-páginas de un acceso, si las declara. Hoy ninguna de las
            // diez lo hace; va igual para que agregar una hija en `accesos.ts`
            // le de menu Y ruta de una sola vez.
            ...(acceso.hijos ?? []).map((hijo) => (
              <Route
                key={hijo.ruta}
                path={hijo.ruta}
                element={
                  <RoleRoute roles={hijo.roles ?? acceso.roles ?? ['auditor']}>
                    <PantallaPendiente titulo={hijo.titulo} sub={acceso.sub} />
                  </RoleRoute>
                }
              />
            )),
          ])}
        </Route>

        {/* La raíz entra al Panel, que es la pantalla de trabajo del Auditor. */}
        <Route path="/" element={<Navigate to="/auditoria" replace />} />
        <Route path="*" element={<Navigate to="/auditoria" replace />} />
      </Routes>

      <Toaster position="top-right" />
    </>
  )
}

export default App
