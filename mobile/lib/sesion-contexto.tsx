/**
 * Contexto de sesión: quién entró, en qué sucursal, con qué rol.
 *
 * El login lo llena al ingresar; "Salir" lo limpia. Los tabs y el home lo
 * leen para saber qué mostrar — nunca reciben la sesión por props, porque
 * ambos grupos de rutas (el layout de tabs y las pantallas de adentro)
 * necesitan el mismo dato sin pasarlo a mano por cada nivel.
 *
 * Habla con el PUERTO (RepositorioSesion) vía lib/contenedor.ts, nunca con
 * un adaptador directo — mismo principio que el resto de la app.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type PropsWithChildren,
} from 'react';

import { repositorioSesion } from './contenedor';
import type { Sesion } from './dominio/tipos';

export interface SesionContextoValor {
  sesion: Sesion | null;
  /** true mientras se revisa si hay una sesión guardada de un arranque anterior. */
  cargando: boolean;
  ingresar: (colaboradorId: number, pin: string) => Promise<Sesion>;
  cerrar: () => Promise<void>;
}

const SesionContexto = createContext<SesionContextoValor | null>(null);

export function SesionProvider({ children }: PropsWithChildren): JSX.Element {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vigente = true;
    repositorioSesion.sesionActiva().then((activa) => {
      if (!vigente) return;
      setSesion(activa);
      setCargando(false);
    });
    return () => {
      vigente = false;
    };
  }, []);

  const ingresar = useCallback(async (colaboradorId: number, pin: string) => {
    const nueva = await repositorioSesion.ingresar(colaboradorId, pin);
    setSesion(nueva);
    return nueva;
  }, []);

  const cerrar = useCallback(async () => {
    await repositorioSesion.cerrar();
    setSesion(null);
  }, []);

  const valor = useMemo<SesionContextoValor>(
    () => ({ sesion, cargando, ingresar, cerrar }),
    [sesion, cargando, ingresar, cerrar],
  );

  return <SesionContexto.Provider value={valor}>{children}</SesionContexto.Provider>;
}

export function useSesion(): SesionContextoValor {
  const contexto = useContext(SesionContexto);
  if (!contexto) throw new Error('useSesion() tiene que usarse dentro de <SesionProvider>.');
  return contexto;
}
