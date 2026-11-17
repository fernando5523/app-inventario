import type { ComponentType } from 'react'
import {
  HiAdjustments,
  HiArchive,
  HiBadgeCheck,
  HiCash,
  HiClipboardCheck,
  HiCollection,
  HiPencilAlt,
  HiUserGroup,
  HiViewGrid,
} from 'react-icons/hi'
import type { Rol } from '../../tipos'

/**
 * LOS DIEZ ACCESOS DEL AUDITOR, AGRUPADOS POR MÓDULO.
 *
 * El modelo es el `navGroups` del Sidebar de app_pdv
 * (`client/src/components/layout/Sidebar.tsx`): grupos con etiqueta opcional,
 * ítems con hijos opcionales. Se conserva entero, incluida la parte que hoy no
 * usa nadie (`hijos`): es el contrato con el que el Sidebar sabe dibujar una
 * sección expandible, y sacarlo obligaría a reescribir el menú la primera vez
 * que una de estas pantallas gane sub-páginas.
 *
 * SON LOS MISMOS, EN EL MISMO ORDEN, que `mobile/components/navegacion/
 * accesos.ts` (bloque `auditor:`), y los subtítulos también: ya los leyó el
 * cliente, y reescribirlos acá crearía dos nombres para la misma pantalla.
 *
 * LA ÚNICA DIFERENCIA ES "Mi cuenta", que el teléfono tiene y acá NO: cambiar
 * el PIN ya está en el menú del avatar (`Header.tsx`, "Cambiar mi PIN"), y una
 * segunda entrada en el lateral mandaba al cartel de "Pendiente de portar" por
 * algo que en el encabezado ya funciona. `/mi-cuenta` escrita a mano cae en la
 * ruta comodín de `App.tsx`, que lleva al Panel.
 *
 * LA AGRUPACIÓN SIGUE EL RECORRIDO DEL NEGOCIO, no el alfabeto:
 *
 *   (sin etiqueta)  el tablero: por dónde se empieza el día.
 *   Conteo          lo que se hace MIENTRAS las rondas están abiertas.
 *   Cierre          el fin de mes, en su secuencia real: se ajusta, se
 *                   liquida, se lacra. Ese orden es una dependencia dura --
 *                   el lacrado exige `liquidado` -- así que el menú lo dice.
 *   Consultas       mirar hacia atrás, sin tocar nada.
 *   Sistema         configuración y cuentas. Último, igual que en app_pdv.
 *
 * Reordenar por comodidad visual rompe la única pista que tiene el Auditor de
 * qué va primero.
 */

/** Una sub-página de un acceso. Hoy ninguno de los diez declara hijas. */
export interface SubAcceso {
  titulo: string
  ruta: string
  icono?: ComponentType<{ className?: string }>
  /** Se cumple con cualquiera de los roles; sin esto, lo hereda del padre. */
  roles?: Rol[]
}

export interface Acceso {
  titulo: string
  sub: string
  ruta: string
  icono: ComponentType<{ className?: string }>
  /** Se cumple con CUALQUIERA de los roles de la lista. */
  roles?: Rol[]
  hijos?: SubAcceso[]
  /**
   * `true` solo en la pantalla que esta entrega implementa de verdad. El resto
   * muestra el cartel de "Pendiente de portar": es deliberado que el menú las
   * liste igual -- el Auditor tiene que poder ver qué falta, no descubrirlo.
   */
  portada?: boolean
}

export interface GrupoDeAccesos {
  /** Sin etiqueta: el grupo se dibuja pegado arriba, sin encabezado. */
  label?: string
  items: Acceso[]
}

/** El rol dueño del portal. `administrador` entra a todo por jerarquía del store. */
const DEL_AUDITOR: Rol[] = ['auditor']

export const GRUPOS_AUDITOR: GrupoDeAccesos[] = [
  {
    items: [
      {
        titulo: 'Panel de auditoría',
        sub: 'Comparar los conteos contra el ERP',
        ruta: '/auditoria',
        icono: HiViewGrid,
        roles: DEL_AUDITOR,
        portada: true,
      },
    ],
  },
  {
    label: 'Conteo',
    items: [
      // Salió de adentro del Panel (2026-09-22): el Panel mezclaba DECIDIR con
      // REVISAR ítem por ítem, y con los 980 ítems reales de Luzuriaga los
      // botones del cierre quedaban al final de la lista, o sea que no existían.
      // "Matriz comparativa" SE QUITÓ (13/10): decisión del usuario -- no es
      // parte del requerimiento, ni acá ni en la app del teléfono. El ENDPOINT
      // `/api/auditoria/inventarios/:id/matriz` SIGUE EN PIE y no se toca:
      // "Corregir lo contado" lo usa para el stock de la medición y la
      // diferencia de cada ítem. Lo que se fue es la pantalla, no el dato.
      {
        titulo: 'Ciclo de conteos',
        sub: 'Embudo de discrepancias, y abrir otro conteo',
        ruta: '/ciclo',
        icono: HiClipboardCheck,
        roles: DEL_AUDITOR,
      },
      // Va en Conteo y no en Cierre: el Auditor corrige lo contado MIENTRAS las
      // rondas siguen abiertas, y recién cuando arranca el ajuste esa vía se le
      // cierra.
      {
        titulo: 'Corregir lo contado',
        sub: 'Arreglar un conteo cargado, viendo el stock',
        ruta: '/corregir',
        icono: HiPencilAlt,
        roles: DEL_AUDITOR,
      },
    ],
  },
  {
    label: 'Cierre',
    items: [
      {
        titulo: 'Ajuste final del conteo',
        sub: 'Fijar los valores definitivos contra el stock',
        ruta: '/ajuste',
        icono: HiAdjustments,
        roles: DEL_AUDITOR,
      },
      // Decisión del cliente (2026-09-11): la liquidación pasó del Coordinador
      // al Auditor. Va ANTES del lacrado porque es el orden del cierre.
      {
        titulo: 'Liquidación y nómina',
        sub: 'Cierre de fin de mes',
        ruta: '/liquidacion',
        icono: HiCash,
        roles: DEL_AUDITOR,
      },
      {
        titulo: 'Aprobación y lacrado',
        sub: 'Firma y cierre del inventario auditado',
        ruta: '/lacrado',
        icono: HiBadgeCheck,
        roles: DEL_AUDITOR,
      },
    ],
  },
  {
    label: 'Consultas',
    items: [
      {
        titulo: 'Historial de inventarios',
        sub: 'Cierres de mi sucursal, período por período',
        ruta: '/historial',
        icono: HiArchive,
        roles: DEL_AUDITOR,
      },
    ],
  },
  {
    label: 'Sistema',
    items: [
      // Excepciones a la clasificación de Dynamics, por código (las cervezas:
      // van del empleado en D365 pero las asume la empresa). Se evalúa al
      // liquidar, por eso es del Auditor.
      {
        titulo: 'Clasificación de productos',
        sub: 'Empresa, paquete o unidad: cómo se trata cada faltante',
        ruta: '/clasificacion',
        icono: HiCollection,
        roles: DEL_AUDITOR,
      },
      {
        titulo: 'Usuarios de mi sucursal',
        sub: 'Crear y habilitar cuentas',
        ruta: '/usuarios',
        icono: HiUserGroup,
        roles: DEL_AUDITOR,
      },
    ],
  },
]

/**
 * Los diez en una sola lista, derivada de los grupos y NO escrita aparte: de
 * acá salen las rutas de `App.tsx` y el título del encabezado. Una ruta
 * declarada a mano que no esté en el menú es una pantalla a la que no se llega,
 * y una entrada del menú sin ruta es un clic que cae en "no existe".
 */
export const ACCESOS_AUDITOR: Acceso[] = GRUPOS_AUDITOR.flatMap((g) => g.items)

/** El acceso al que apunta una ruta, para que el encabezado sepa su título. */
export function accesoDe(ruta: string): { titulo: string } | undefined {
  const padre = ACCESOS_AUDITOR.find((a) => a.ruta === ruta)
  if (padre) return padre
  // Una sub-página lleva el título de la sub-página, no el del padre.
  for (const a of ACCESOS_AUDITOR) {
    const hijo = a.hijos?.find((h) => h.ruta === ruta)
    if (hijo) return hijo
  }
  return undefined
}
