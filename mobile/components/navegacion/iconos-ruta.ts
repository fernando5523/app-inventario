import {
  BarChart3,
  CalendarClock,
  ClipboardList,
  DollarSign,
  FileSpreadsheet,
  History,
  Home,
  LayoutGrid,
  PencilLine,
  Scale,
  Settings,
  ShieldCheck,
  Store,
  Table2,
  Tags,
  UserCheck,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react-native';

/**
 * EL ÍCONO DE CADA ACCESO, por ruta.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO VIENE DEL BACKEND
 * ---------------------------------------------------------------------------
 * El catálogo de accesos (`navegacion.catalogo.ts`) manda `ruta`, `titulo` y
 * `sub`, y NO manda ícono a propósito: los íconos son componentes de
 * `lucide-react-native`, o sea código, y no se pueden serializar en una
 * respuesta HTTP. El mismo criterio que ya usa `tabs.ts` para la barra del
 * teléfono -- el servidor manda la clave, el móvil resuelve el dibujo.
 *
 * ---------------------------------------------------------------------------
 * SE BUSCA POR EL FINAL DE LA RUTA, no por la ruta entera
 * ---------------------------------------------------------------------------
 * `/auditor/usuarios` y `/administrador/usuarios` son la misma idea y llevan
 * el mismo ícono. Guardar las dos rutas completas sería la misma tabla
 * escrita dos veces, y el día que se agregue un rol habría que acordarse de
 * duplicarla otra vez.
 *
 * Lo que no está en la tabla cae en `LayoutGrid`, que es el genérico: un
 * acceso nuevo se ve prolijo desde el primer día aunque nadie le haya elegido
 * un dibujo todavía.
 */
const POR_SEGMENTO: Record<string, LucideIcon> = {
  index: Home,
  auditoria: BarChart3,
  matriz: Table2,
  ciclo: CalendarClock,
  corregir: PencilLine,
  ajuste: Scale,
  'ajustes-negativos': FileSpreadsheet,
  liquidacion: DollarSign,
  lacrado: ShieldCheck,
  usuarios: Users,
  clasificacion: Tags,
  historial: History,
  comparativo: BarChart3,
  'mi-cuenta': UserRound,
  hojas: ClipboardList,
  'mis-hojas': ClipboardList,
  armar: LayoutGrid,
  asistencia: UserCheck,
  contar: ClipboardList,
  tiendas: Store,
  config: Settings,
  navegacion: LayoutGrid,
};

export function iconoDeRuta(ruta: string): LucideIcon {
  // `/auditor` (el Inicio de un rol) no tiene segmento propio: es la casa.
  const partes = ruta.split('/').filter(Boolean);
  if (partes.length <= 1) return Home;
  return POR_SEGMENTO[partes[partes.length - 1]!] ?? LayoutGrid;
}
