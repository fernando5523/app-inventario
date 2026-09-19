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

import { createContext, useContext, useEffect, useMemo, useState, type JSX, type PropsWithChildren } from 'react';

import { navegacionDeRespaldo, traerNavegacion, type Navegacion } from './adaptadores/navegacion-api';
import type { Rol } from './dominio/tipos';
import { useSesion } from './sesion-contexto';

const NavegacionContexto = createContext<Navegacion | null>(null);

export function NavegacionProvider({ children }: PropsWithChildren): JSX.Element {
  const { sesion } = useSesion();
  const rol = sesion?.colaborador.rol ?? null;

  // El respaldo YA es el estado inicial: no hay un momento sin navegación.
  const [navegacion, setNavegacion] = useState<Navegacion | null>(null);

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

  // Mientras no llegó nada -- y también si el rol cambió recién --, el
  // respaldo. `useMemo` para no rearmar el objeto en cada render: `tabs` entra
  // como dependencia de efectos en RolTabsLayout.
  const valor = useMemo<Navegacion | null>(
    () => navegacion ?? (rol === null ? null : navegacionDeRespaldo(rol)),
    [navegacion, rol],
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
  return contexto ?? navegacionDeRespaldo(rol);
}
