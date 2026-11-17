import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'

/**
 * Igual que en app_pdv, menos el `useDeviceAgent()`: ese registra el EQUIPO
 * contra el servidor para atribuir ventas a una caja. Acá no hay cajas ni
 * equipos registrados.
 */
export function MainLayout() {
  return (
    <div className="flex flex-col h-screen bg-[var(--surface)]">
      <Header />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-[var(--surface)]">
          <div className="p-2 md:p-[var(--app-content-pad)]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
