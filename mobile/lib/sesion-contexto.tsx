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

import { router } from 'expo-router';
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
import { Alert } from 'react-native';

import { registrarAlVencerSesion } from './adaptadores/_http';
import { repositorioSesion } from './contenedor';
import type { Sesion } from './dominio/tipos';

/**
 * Alto impacto (2026-09-10): `RolTabsLayout` no monta `<Tabs>` (ninguna
 * navegación, de ningún rol) mientras `cargando` sea `true` -- es el ÚNICO
 * gate de arranque de la app entera. `sesionActiva()` hoy es puro SQLite
 * (sin red), pero un `.then()` sin `.catch()` deja `cargando` trabado ante
 * CUALQUIER falla (SQLite bloqueada, corrupta, sin espacio) para siempre --
 * y como cada relanzamiento repite el mismo camino, "force-stop y volver a
 * abrir" no arregla nada. Un timeout duro, además del catch: la garantía
 * tiene que sostenerse sola, sin depender de que `sesionActiva()` se porte
 * bien siempre.
 */
const TIMEOUT_ARRANQUE_MS = 5_000;

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
    const terminar = (activa: Sesion | null): void => {
      if (!vigente) return;
      vigente = false;
      setSesion(activa);
      setCargando(false);
    };
    // El timeout es la RED DE SEGURIDAD, no el camino esperado: si
    // `sesionActiva()` nunca resuelve ni rechaza, no puede dejar la app
    // entera sin poder navegar. Sin sesión (null) es el estado seguro --
    // manda al login, que siempre se puede reintentar desde ahí.
    const reloj = setTimeout(() => terminar(null), TIMEOUT_ARRANQUE_MS);
    repositorioSesion
      .sesionActiva()
      .then((activa) => {
        clearTimeout(reloj);
        terminar(activa);
      })
      .catch(() => {
        clearTimeout(reloj);
        terminar(null);
      });
    return () => {
      vigente = false;
      clearTimeout(reloj);
    };
  }, []);

  // El servidor rechazó la sesión (venció a las 12 horas): se cierra y se
  // vuelve al ingreso, en vez de dejar las pantallas del rol con cada pedido
  // fallando. Varios pedidos rechazados a la vez (o los que llegan después)
  // cierran una sola vez: la marca se levanta recién al volver a ingresar.
  const cerrandoPorVencida = useRef(false);
  useEffect(() => {
    registrarAlVencerSesion(() => {
      if (cerrandoPorVencida.current) return;
      cerrandoPorVencida.current = true;
      void repositorioSesion
        .cerrar()
        .catch(() => {})
        .finally(() => {
          setSesion(null);
          router.replace('/');
          Alert.alert('Tu sesión venció', 'Ingresa de nuevo con tu PIN.');
        });
    });
    return () => registrarAlVencerSesion(null);
  }, []);

  const ingresar = useCallback(async (colaboradorId: number, pin: string) => {
    const nueva = await repositorioSesion.ingresar(colaboradorId, pin);
    cerrandoPorVencida.current = false;
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
