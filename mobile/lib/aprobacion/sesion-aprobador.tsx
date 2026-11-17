/**
 * La sesión de la aprobadora. Aparte de `SesionProvider` (la del PIN) a
 * propósito: son dos personas distintas y una no puede heredar la otra.
 *
 * Vive SOLO en memoria. Cerrar la app pide ingresar de nuevo, y con la cuenta
 * de Microsoft ya abierta en el navegador del teléfono eso es un toque: no
 * hace falta guardar un token de acceso al ERP en el teléfono.
 */

import { createContext, useCallback, useContext, useMemo, useState, type JSX, type PropsWithChildren } from 'react';

import type { Aprobador } from './tipos';

interface SesionAprobador {
  token: string;
  aprobador: Aprobador;
}

interface ContextoAprobador {
  sesion: SesionAprobador | null;
  ingresar: (token: string, aprobador: Aprobador) => void;
  salir: () => void;
}

const Contexto = createContext<ContextoAprobador | null>(null);

export function AprobadorProvider({ children }: PropsWithChildren): JSX.Element {
  const [sesion, setSesion] = useState<SesionAprobador | null>(null);
  const ingresar = useCallback((token: string, aprobador: Aprobador) => setSesion({ token, aprobador }), []);
  const salir = useCallback(() => setSesion(null), []);
  const valor = useMemo(() => ({ sesion, ingresar, salir }), [sesion, ingresar, salir]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useAprobador(): ContextoAprobador {
  const valor = useContext(Contexto);
  if (valor === null) throw new Error('useAprobador fuera de AprobadorProvider');
  return valor;
}
