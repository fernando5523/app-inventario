/**
 * QUÉ VE ESTE ROL en el home y en la barra. Una sola fuente para las tres
 * pantallas que lo necesitan (InicioScreen, RolTabsLayout, TabBar): si cada
 * una lo pidiera por su cuenta, serían tres llamadas por arranque y podrían
 * quedar mostrando cosas distintas mientras llegan.
 *
 * ===========================================================================
 * ARRANCA CON EL MAPA COMPILADO, Y ESO ES TODO EL DISEÑO
 * ===========================================================================
 * El estado inicial NO es "cargando": es el home de siempre, disponible de
 * forma síncrona. La configuración del servidor se pide en segundo plano y
 * solo REEMPLAZA lo que ya se está mostrando si llega y es distinta.
 *
 * De ahí salen las tres propiedades que importan, y ninguna es un accidente:
 *
 *  1. NUNCA hay una pantalla vacía ni un spinner. La persona abre la app en
 *     la góndola y tiene sus tarjetas, con señal o sin ella.
 *  2. Si la configuración no llega, NO SE NOTA. No hay cartel, no hay
 *     reintento visible, no hay estado degradado que explicar: se ve
 *     exactamente lo que se veía antes de que esto fuera configurable.
 *  3. Si llega y es igual a lo compilado -- el caso normal, porque la siembra
 *     es el mapa compilado -- tampoco se nota, porque no cambia nada.
 *
 * Lo que se paga: durante el instante entre el arranque y la respuesta, un
 * Administrador que acaba de apagar una tarjeta la sigue viendo. Es aceptable
 * y es el lado correcto del intercambio -- el error simétrico (mostrar una
 * pantalla en blanco hasta que conteste el servidor) le cuesta la jornada a
 * once personas, y este le cuesta un parpadeo a una.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type PropsWithChildren,
} from 'react';

import {
  navegacionDeRespaldo,
  traerNavegacion,
  traerNavegacionSiSePuede,
  type Navegacion,
} from './adaptadores/navegacion-api';
import type { Rol } from './dominio/tipos';
import { useSesion } from './sesion-contexto';

interface ValorNavegacion {
  navegacion: Navegacion | null;
  /** Vuelve a pedirla. Ver `refrescar` en el provider: nunca pisa lo bueno. */
  refrescar: () => void;
}

const NavegacionContexto = createContext<ValorNavegacion | null>(null);

export function NavegacionProvider({ children }: PropsWithChildren): JSX.Element {
  const { sesion } = useSesion();
  const rol = sesion?.colaborador.rol ?? null;

  // El respaldo YA es el estado inicial: no hay un momento sin navegación.
  const [navegacion, setNavegacion] = useState<Navegacion | null>(null);

  // El rol vigente, para que `refrescar` sea estable y no se rearme en cada
  // cambio de sesión -- lo consumen pantallas que lo pasan a `useEffect`.
  const rolRef = useRef<Rol | null>(rol);
  rolRef.current = rol;

  useEffect(() => {
    if (rol === null) {
      // Al cerrar sesión se descarta: el próximo que entre puede ser otro rol,
      // y mostrarle un instante el home del anterior sería confuso además de
      // filtrar qué veía esa persona.
      setNavegacion(null);
      return;
    }

    let vigente = true;
    // `traerNavegacion` no lanza NUNCA (ver su cabecera): devuelve el respaldo
    // ante cualquier falla. Por eso acá no hay `.catch()` -- no lo necesita, y
    // ponerlo sugeriría que existe un camino de error que hay que manejar.
    void traerNavegacion(rol).then((traida) => {
      if (vigente) setNavegacion(traida);
    });

    return () => {
      vigente = false;
    };
  }, [rol]);

  /**
   * VOLVER A PEDIRLA, sin pisar lo que ya está bien.
   *
   * ---------------------------------------------------------------------
   * POR QUE HACE FALTA
   * ---------------------------------------------------------------------
   * El efecto de arriba depende solo de `[rol]`, y el rol no cambia durante
   * una sesión: `/api/navegacion/mia` se pedía UNA vez por login y no se
   * volvía a pedir nunca. Si el Administrador prendía, apagaba o reordenaba
   * un acceso, nadie lo veía hasta cerrar y volver a abrir la app -- ni él
   * mismo, que después de Guardar seguía con su propia barra de tabs vieja.
   *
   * ---------------------------------------------------------------------
   * ANTE UN ERROR NO TOCA NADA, Y ESA ES LA PARTE QUE IMPORTA
   * ---------------------------------------------------------------------
   * Usa `traerNavegacionSiSePuede`, que devuelve `null` cuando no llegó. El
   * arranque SÍ cae al mapa compilado (mejor el home de siempre que una
   * pantalla en blanco), pero un refresco NO puede hacer eso: ya hay una
   * configuración buena en memoria, y reemplazarla por la de fábrica haría
   * reaparecer un acceso que el Administrador apagó, cada vez que la persona
   * vuelve a la app sin señal. Sin red, lo que ya está es lo bueno.
   */
  const refrescar = useCallback((): void => {
    const rolActual = rolRef.current;
    if (rolActual === null) return;
    void traerNavegacionSiSePuede(rolActual).then((traida) => {
      // `rolRef` otra vez y no `rolActual`: entre el pedido y la respuesta
      // alguien pudo cerrar sesión y entrar con otro rol, y aplicarle el home
      // del anterior sería mostrarle pantallas que no son suyas.
      if (traida !== null && rolRef.current === rolActual) setNavegacion(traida);
    });
  }, []);

  // Mientras no llegó nada -- y también si el rol cambió recién --, el
  // respaldo. `useMemo` para no rearmar el objeto en cada render: `tabs` entra
  // como dependencia de efectos en RolTabsLayout.
  const valor = useMemo<ValorNavegacion>(
    () => ({ navegacion: navegacion ?? (rol === null ? null : navegacionDeRespaldo(rol)), refrescar }),
    [navegacion, rol, refrescar],
  );

  return <NavegacionContexto.Provider value={valor}>{children}</NavegacionContexto.Provider>;
}

/**
 * La navegación del rol de la sesión. Devuelve el RESPALDO de ese rol si se
 * la usa fuera del provider o sin sesión -- nunca `null` para quien ya sabe
 * su rol. Un hook de presentación que puede devolver nada obliga a cada
 * pantalla a inventar qué hacer con eso, y una de ellas va a elegir mal.
 */
export function useNavegacion(rol: Rol): Navegacion {
  const contexto = useContext(NavegacionContexto);
  return contexto?.navegacion ?? navegacionDeRespaldo(rol);
}

/**
 * VOLVER A PEDIR la navegación. La usan dos lugares y por dos motivos
 * distintos:
 *
 *  - `InicioScreen`, al enfocar y al volver a primer plano: así los otros tres
 *    roles se enteran de lo que cambió el Administrador sin reiniciar la app.
 *  - La pantalla de "Accesos y menús", justo después de guardar o de volver a
 *    fábrica: el Administrador tiene que ver SU propio cambio en SU barra de
 *    tabs, y guardar solo actualizaba el estado local de esa pantalla.
 *
 * Fuera del provider es un no-op: nunca lanza ni obliga a chequear nada.
 */
export function useRefrescarNavegacion(): () => void {
  const contexto = useContext(NavegacionContexto);
  return contexto?.refrescar ?? NO_OP;
}

const NO_OP = (): void => undefined;
