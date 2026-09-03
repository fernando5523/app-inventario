import { Redirect, Tabs } from 'expo-router';
import type { JSX } from 'react';

import type { Rol } from '../../lib/dominio/tipos';
import { useSesion } from '../../lib/sesion-contexto';
import { TabBar } from './TabBar';
import { TABS_POR_ROL } from './tabs';

export interface RolTabsLayoutProps {
  rol: Rol;
}

/**
 * Layout de tabs compartido por los tres grupos de rutas (app/coordinador,
 * app/conteo, app/auditor). Cada archivo `_layout.tsx` de esos grupos solo
 * le pasa su propio `rol` — la lógica de proteger la ruta y armar los tabs
 * vive acá una sola vez.
 *
 * La protección es a nivel de RUTA, no de botón: si la sesión no coincide
 * con este grupo, ni siquiera se monta <Tabs> — se redirige al grupo que
 * sí le corresponde (o al login si no hay sesión). Es la diferencia entre
 * "esconder un tab" y "que la ruta no exista para ese rol".
 */
export function RolTabsLayout({ rol }: RolTabsLayoutProps): JSX.Element | null {
  const { sesion, cargando } = useSesion();

  if (cargando) return null;
  if (!sesion) return <Redirect href="/" />;
  if (sesion.colaborador.rol !== rol) return <Redirect href={`/${sesion.colaborador.rol}`} />;

  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      {TABS_POR_ROL[rol].map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.etiqueta }} />
      ))}
    </Tabs>
  );
}
