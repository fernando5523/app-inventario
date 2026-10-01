/**
 * ===========================================================================
 * RESCATAR LA URL QUE PIDIÓ EL NAVEGADOR CUANDO EL GRUPO SE MONTA TARDE
 * ===========================================================================
 * Solo web. Lo usa `RolTabsLayout.web.tsx`, el layout de los cuatro grupos de
 * rutas (`app/administrador`, `app/coordinador`, `app/conteo`, `app/auditor`).
 *
 * ---------------------------------------------------------------------------
 * EL BUG, MEDIDO EL 2026-09-30 CONTRA `expo start --web` EN EL 8082
 * ---------------------------------------------------------------------------
 * Abrir `http://localhost:8082/auditor/comparativo` con la sesión del auditor
 * terminaba en `/auditor/auditoria`. Igual `/auditor/ciclo`, igual
 * `/auditor/ajustes-negativos?inventarioId=8078`: TODA url profunda escrita a
 * mano, pegada de un chat o recargada con F5 caía en el primer acceso del rol.
 * En el teléfono las mismas rutas abren bien.
 *
 * ---------------------------------------------------------------------------
 * LO QUE PARECÍA Y NO ERA, CON LA EVIDENCIA QUE LO DESCARTA
 * ---------------------------------------------------------------------------
 *  - NO es un guardia de permisos: no existe ninguno en `components/` ni en
 *    `lib/`.
 *  - NO es el catálogo de navegación (`GET /api/navegacion/mia`). Parecía que
 *    sí, porque las únicas dos que alguien notó rotas —`comparativo` y
 *    `ajustes-negativos`— son las dos que NO están en el menú. Pero probando
 *    `/auditor/ciclo`, que SÍ está, también rebota. A las del menú se llega
 *    haciendo clic en la barra lateral, que es `router.push` del lado del
 *    cliente y no recarga la página: por eso nunca se notó que por url
 *    tampoco abrían.
 *  - NO es que el árbol de rutas se arme distinto en web. Reconstruido con el
 *    `getRoutes` de expo-router para `platform: 'web'` y para
 *    `platform: 'android'` da las MISMAS 34 rutas (eso lo fija
 *    `rutas-de-app.test.ts`). Y el navegador lo confirma en caliente: el
 *    `<Slot>` del grupo declara las catorce pantallas del auditor —
 *    `[index, ciclo, ajuste, matriz, lacrado, corregir, usuarios, auditoria,
 *    historial, mi-cuenta, comparativo, liquidacion, clasificacion,
 *    ajustes-negativos]`.
 *
 * ---------------------------------------------------------------------------
 * LA CAUSA: UN COMMIT SIN EL `<Slot>` ALCANZA PARA PERDER LA RUTA
 * ---------------------------------------------------------------------------
 * `getStateFromPath` SÍ matchea la url. El estado inicial que se lee con
 * `useRootNavigationState()` en el primer render es exactamente
 *
 *     __root > auditor > comparativo      (stale: true)
 *
 * `stale` significa que React Navigation todavía no lo hidrató: lo hidrata el
 * navegador de CADA nivel en el momento en que ese nivel se monta. Y este
 * nivel no se monta a tiempo: `RolTabsLayout` devuelve `null` mientras
 * `useSesion().cargando` sea `true` — el gate de arranque de la app entera,
 * documentado en `lib/sesion-contexto.tsx`. Con UN solo commit en el que el
 * `<Slot>` del grupo no existe, React Navigation da ese estado anidado por no
 * consumido y lo descarta.
 *
 * La traza del navegador, render por render, con la sesión todavía cargando:
 *
 *     n=0  cargando=true   ruta=/auditor/ciclo   url=/auditor/ciclo
 *     n=1  cargando=true   ruta=/auditor         url=/auditor/ciclo
 *     n=2  cargando=false  ruta=/auditor         url=/auditor
 *
 * De ahí en adelante todo lo que pasa es CORRECTO, y por eso no había ni un
 * warning en consola que investigar: el grupo queda parado en su `index`,
 * `getPathFromState` reescribe la barra de direcciones a `/auditor`, y el
 * redirect legítimo del layout ("en web no hay Inicio") completa el viaje
 * hasta el primer acceso del rol.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ SE ARREGLA ACÁ Y NO MONTANDO EL `<Slot>` ANTES
 * ---------------------------------------------------------------------------
 * Montarlo mientras `cargando` hace que la ruta sobreviva —se probó y
 * funciona—, pero monta también la PANTALLA sin sesión: sus efectos salen a
 * pedir datos sin token. La mayoría se defiende con `if (!sesion) return`,
 * pero tres no miran la sesión en absoluto (`ClasificacionScreen`,
 * `MiCuentaScreen`, `AjustesNegativosScreen.web`), así que el arreglo sería
 * peor que el bug. El gate de arranque queda como está; lo único que se repara
 * es el daño que causa.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ES GENERAL
 * ---------------------------------------------------------------------------
 * Esta función NO conoce ninguna lista de rutas. Rescata cualquier cosa que
 * cuelgue del grupo: esté o no en el catálogo —que es configurable desde la
 * base (`backend/src/modules/navegacion/`), o sea que una pantalla puede salir
 * del menú sin dejar de existir—, y exista hoy o la agregue alguien mañana.
 */

export interface RutaPedida {
  /**
   * La url que pedía el navegador en el PRIMER render del layout del grupo:
   * `window.location.pathname + window.location.search`. Después de ese render
   * ya no existe — la pisa `getPathFromState`.
   */
  pedida: string;
  /** La raíz del grupo: `/auditor`, `/coordinador`, … */
  inicio: string;
  /** Primer acceso del rol, el destino de siempre cuando se entra a la raíz. */
  primero: string | undefined;
}

/**
 * A dónde mandar cuando la ruta vigente quedó en la raíz del grupo: a lo que
 * pedía el navegador si era algo más adentro, y si no al primer acceso del rol
 * (el comportamiento de siempre, ver el redirect en `RolTabsLayout.web.tsx`).
 *
 * `null` = no hay a dónde mandar y no se redirige.
 */
export function destinoDesdeLaRaizDelGrupo({ pedida, inicio, primero }: RutaPedida): string | null {
  // `${inicio}/` con la barra, NUNCA `startsWith(inicio)` a secas: con
  // `inicio = '/auditor'` un `startsWith` daría verdadero para `/auditoria`,
  // que no es una ruta de este grupo sino de otro rol.
  if (pedida.startsWith(`${inicio}/`)) return pedida;
  return primero ?? null;
}
