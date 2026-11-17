import { HiOutlineClipboardList } from 'react-icons/hi'
import { Link } from 'react-router-dom'

interface PantallaPendienteProps {
  /** El título tal como lo lista el menú: tienen que ser el mismo nombre. */
  titulo: string
  /** Qué hace esa pantalla, en los términos del menú. */
  sub: string
}

/**
 * EL CARTEL DE LAS NUEVE PANTALLAS QUE TODAVÍA NO SE PORTARON.
 *
 * Las diez rutas del Auditor están declaradas desde esta primera entrega, pero
 * solo el Panel de auditoría existe de verdad. Las otras nueve muestran esto.
 *
 * Es deliberado que el menú las liste igual y que esta pantalla NO invente
 * contenido: media pantalla con números de ejemplo sobre un inventario real es
 * peor que un cartel honesto -- nadie puede distinguir el dato de muestra del
 * dato bueno, y alguien va a tomar una decisión de plata sobre el primero. Lo
 * único que dice es qué va a haber acá y que todavía no está.
 *
 * La pantalla que sí funciona queda a un clic: desde un cartel sin salida se
 * vuelve con el botón del navegador, que es la peor navegación posible.
 */
export function PantallaPendiente({ titulo, sub }: PantallaPendienteProps) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 w-11 h-11 rounded-full bg-[var(--bg-subtle)] border border-[var(--border)] flex items-center justify-center">
          <HiOutlineClipboardList className="w-5 h-5 text-[var(--fg-muted)]" />
        </div>
        <h1 className="text-[15px] font-semibold text-[var(--fg)]">{titulo}</h1>
        <p className="mt-1 text-[13px] text-[var(--fg-muted)]">{sub}</p>
        <p className="mt-4 inline-flex items-center rounded-full border border-[var(--warning-border)] bg-[var(--warning-light)] px-3 py-1 text-[12px] font-medium text-[var(--warning)]">
          Pendiente de portar
        </p>
        <p className="mt-4 text-[12px] text-[var(--fg-muted)]">
          Esta pantalla todavía vive solo en la app del teléfono. En esta entrega del portal se
          declaró su acceso, no su contenido.
        </p>
        <Link to="/auditoria" className="mt-4 inline-block text-[12px] text-[var(--primary)] hover:underline">
          Ir al Panel de auditoría
        </Link>
      </div>
    </div>
  )
}
