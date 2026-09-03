/**
 * Tabs por rol — mismo diseño y mismo criterio que mobile/design/home.html:
 * un tab se gana el lugar si el usuario vuelve ahí varias veces por
 * jornada. "Liquidación" y "Lacrado" NO son tabs: son cierres de una vez
 * al mes, vivos solo como acceso del home (ver components/navegacion/accesos.ts).
 *
 * El `name` de cada tab tiene que coincidir EXACTO con el nombre de archivo
 * de ruta dentro de app/<rol>/ (sin extensión) — es lo que usa expo-router
 * para resolver la pantalla.
 */

import type { LucideIcon } from 'lucide-react-native';
import { BarChart3, ClipboardList, Home, Layers, Settings, ShieldCheck, Store, Users } from 'lucide-react-native';

import type { Rol } from '../../lib/dominio/tipos';

export interface DefinicionTab {
  name: string;
  etiqueta: string;
  icono: LucideIcon;
}

export const TABS_POR_ROL: Record<Rol, DefinicionTab[]> = {
  // 4 tabs (Administrador y Auditor): etiquetas cortas a propósito — con
  // 4 en vez de 3 cada tab tiene menos ancho, y "Auditoría"/"Usuarios"
  // son las más largas del set. Ver TabBar.tsx (numberOfLines={1}) para
  // que ninguna se corte aunque el ancho apriete.
  administrador: [
    { name: 'index', etiqueta: 'Inicio', icono: Home },
    { name: 'usuarios', etiqueta: 'Usuarios', icono: Users },
    { name: 'tiendas', etiqueta: 'Tiendas', icono: Store },
    { name: 'config', etiqueta: 'Config', icono: Settings },
  ],
  coordinador: [
    { name: 'index', etiqueta: 'Inicio', icono: Home },
    { name: 'hojas', etiqueta: 'Hojas', icono: ClipboardList },
    { name: 'ciclo', etiqueta: 'Ciclo', icono: Layers },
  ],
  conteo: [
    { name: 'index', etiqueta: 'Inicio', icono: Home },
    { name: 'mis-hojas', etiqueta: 'Mis hojas', icono: ClipboardList },
    { name: 'contar', etiqueta: 'Contar', icono: ShieldCheck },
  ],
  auditor: [
    { name: 'index', etiqueta: 'Inicio', icono: Home },
    { name: 'auditoria', etiqueta: 'Auditoría', icono: BarChart3 },
    { name: 'ciclo', etiqueta: 'Ciclo', icono: Layers },
    // Pedido explícito del cliente: el Auditor también gestiona cuentas
    // de su propia sucursal — comparte pantalla con el Administrador
    // (ver components/pantallas/UsuariosScreen.tsx), no es una copia.
    { name: 'usuarios', etiqueta: 'Usuarios', icono: Users },
  ],
};

/**
 * Alto del tab bar en px. ÚNICA fuente de verdad: lo usan el propio
 * `TabBar` (para su `minHeight`) y `PantallaConTabs` (para el
 * `paddingBottom` del contenido scrolleable). En mobile/design/home.html
 * este número quedó clavado dos veces (76px en el CSS, comentario aparte
 * sobre una variable sin usar) — acá no se repite ese error.
 */
export const ALTO_TAB_BAR = 58;
