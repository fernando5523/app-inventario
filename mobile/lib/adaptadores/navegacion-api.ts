/**
 * QUÉ VE ESTE ROL en el home y en la barra de abajo. Lo configura el
 * Administrador; acá solo se trae y se resuelve.
 *
 * ---------------------------------------------------------------------------
 * EL RESPALDO NO ES NEGOCIABLE
 * ---------------------------------------------------------------------------
 * Si la configuración no llega —sin señal, backend caído, respuesta rara— se
 * usa el MAPA COMPILADO (`components/navegacion/{accesos,tabs}.ts`), que es
 * exactamente lo que la app mostraba antes de que esto fuera configurable.
 * Nunca un home vacío.
 *
 * No es una precaución de manual: estas tiendas tienen WiFi mala y la app se
 * usa en la góndola. Un home en blanco es una persona parada al lado de una
 * estantería sin poder empezar a contar, y el inventario es de un día.
 *
 * Por eso `traerNavegacion` NO PROPAGA el error: lo traga y devuelve el
 * respaldo. Es la única función del proyecto que hace eso a propósito —
 * en cualquier otra, esconder un error sería esconder un problema; acá,
 * dejarlo salir apagaría la pantalla entera por algo que es decorativo.
 *
 * ---------------------------------------------------------------------------
 * LOS ICONOS NO VIAJAN POR HTTP
 * ---------------------------------------------------------------------------
 * Un icono es un componente de `lucide-react-native`. El backend manda el
 * `name` del tab y acá se busca el icono en el mapa compilado. Un tab que el
 * backend mande y el mapa no conozca se DESCARTA: sin icono la barra se
 * rompe, y una barra rota es peor que un tab de menos.
 */

import { ACCESOS_POR_ROL, type DefinicionAcceso } from '../../components/navegacion/accesos';
import { TABS_POR_ROL, type DefinicionTab } from '../../components/navegacion/tabs';
import type { Rol } from '../dominio/tipos';
import { pedir } from './_http';

/** Lo que devuelve `GET /api/navegacion/mia`. Solo lo PRENDIDO, en orden. */
interface RespuestaNavegacion {
  rol: Rol;
  accesos: Array<{ ruta: string; titulo: string; sub: string }>;
  tabs: Array<{ name: string; etiqueta: string }>;
}

export interface Navegacion {
  accesos: DefinicionAcceso[];
  tabs: DefinicionTab[];
  /** `true` = no llegó la configuración y esto es el mapa compilado. */
  esRespaldo: boolean;
}

/** El home y la barra tal como están compilados. El respaldo, y el default. */
export function navegacionDeRespaldo(rol: Rol): Navegacion {
  return { accesos: ACCESOS_POR_ROL[rol], tabs: TABS_POR_ROL[rol], esRespaldo: true };
}

/**
 * Traduce la respuesta del servidor, quedándose con lo que la app puede
 * mostrar de verdad.
 *
 * Un acceso SIN `ruta` utilizable o un tab sin icono conocido se descartan en
 * vez de romper la pantalla. Y si después de descartar no queda NADA, se
 * devuelve el respaldo: una configuración que deja el home vacío es una
 * configuración que no se puede aplicar, venga de donde venga.
 */
function aNavegacion(rol: Rol, respuesta: RespuestaNavegacion): Navegacion {
  const iconoPorName = new Map(TABS_POR_ROL[rol].map((t) => [t.name, t.icono]));

  const accesos: DefinicionAcceso[] = respuesta.accesos
    .filter((a) => typeof a.ruta === 'string' && a.ruta.length > 0)
    .map((a) => ({ titulo: a.titulo, sub: a.sub, ruta: a.ruta }));

  const tabs: DefinicionTab[] = respuesta.tabs
    .map((t) => {
      const icono = iconoPorName.get(t.name);
      return icono === undefined ? null : { name: t.name, etiqueta: t.etiqueta, icono };
    })
    .filter((t): t is DefinicionTab => t !== null);

  // El home sin tarjetas o la barra sin tabs no son estados usables. Mejor lo
  // de siempre que una pantalla a la que no se le puede hacer nada.
  if (accesos.length === 0 || tabs.length === 0) return navegacionDeRespaldo(rol);

  return { accesos, tabs, esRespaldo: false };
}

/**
 * La navegación de la sesión actual. NUNCA falla: si algo sale mal devuelve el
 * mapa compilado.
 *
 * El rol se pasa solo para elegir el respaldo — el servidor devuelve la del
 * rol de la sesión, no la de un rol que venga por parámetro (si viniera por
 * parámetro, cualquiera con sesión podría leer el home de otro rol).
 */
export async function traerNavegacion(rol: Rol): Promise<Navegacion> {
  return (await traerNavegacionSiSePuede(rol)) ?? navegacionDeRespaldo(rol);
}

/**
 * LA MISMA LECTURA, PERO DICIENDO SI SE PUDO. `null` = no se pudo traer.
 *
 * ---------------------------------------------------------------------------
 * POR QUE HACEN FALTA LAS DOS, Y NO ES DUPLICAR
 * ---------------------------------------------------------------------------
 * Son dos momentos con la respuesta correcta OPUESTA ante el mismo error de
 * red:
 *
 *   AL ARRANCAR no hay nada en memoria, así que el respaldo es lo mejor que
 *   se puede ofrecer: mejor el home de siempre que una pantalla en blanco.
 *   Para eso está `traerNavegacion`.
 *
 *   AL REFRESCAR ya hay una configuración buena en memoria -- la que trajo el
 *   servidor hace un rato. Caer al respaldo ahí sería PISAR un dato bueno con
 *   el mapa de fábrica: si el Administrador apagó un acceso, volver a la app
 *   sin señal lo haría reaparecer. Por eso el refresco necesita distinguir
 *   "llegó otra cosa" de "no llegó nada", y con `traerNavegacion` no puede:
 *   las dos le devuelven una `Navegacion` que parece igual de válida.
 *
 * Lo pidió el orquestador como límite del lote: sin red, lo que ya está en la
 * app es lo bueno y no se vacía ni se reemplaza.
 */
export async function traerNavegacionSiSePuede(rol: Rol): Promise<Navegacion | null> {
  try {
    const respuesta = await pedir<RespuestaNavegacion>('/api/navegacion/mia');
    // Una respuesta con la forma equivocada (un proxy que devuelve HTML, una
    // versión vieja del backend) cuenta como "no llegó": no es una
    // configuración que se pueda aplicar.
    if (!Array.isArray(respuesta?.accesos) || !Array.isArray(respuesta?.tabs)) return null;

    const navegacion = aNavegacion(rol, respuesta);
    // `aNavegacion` devuelve el RESPALDO cuando lo que llegó deja el home
    // vacío. Eso tampoco es una configuración aplicable, así que para el
    // refresco vale lo mismo que no haber traído nada.
    return navegacion.esRespaldo ? null : navegacion;
  } catch {
    // A propósito sin log ni re-throw: ver la cabecera. Quedarse sin señal es
    // el camino esperado de esta app, no una degradación que avisar.
    return null;
  }
}
