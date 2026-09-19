import { Redirect, Tabs } from 'expo-router';
import type { JSX } from 'react';

import type { Rol } from '../../lib/dominio/tipos';
import { useNavegacion } from '../../lib/navegacion-contexto';
import { useSesion } from '../../lib/sesion-contexto';
import { TabBar } from './TabBar';

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
 *
 * QUÉ TABS se arman lo decide el Administrador (`useNavegacion`), pero ESO NO
 * ES UN PERMISO: esconder un tab es una comodidad. Lo que impide entrar sigue
 * siendo el redirect de arriba, y del otro lado el `requiereRol` de cada
 * endpoint. Un tab apagado no cierra una puerta; una ruta de otro grupo no se
 * puede encender (ver navegacion.lista-blanca.ts en el backend).
 */
export function RolTabsLayout({ rol }: RolTabsLayoutProps): JSX.Element | null {
  const { sesion, cargando } = useSesion();
  // Arranca con el mapa compilado y se actualiza si llega otra cosa: no hay
  // un instante sin barra. Ver lib/navegacion-contexto.tsx.
  const { tabs } = useNavegacion(rol);

  if (cargando) return null;
  if (!sesion) return <Redirect href="/" />;
  if (sesion.colaborador.rol !== rol) return <Redirect href={`/${sesion.colaborador.rol}`} />;

  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      {tabs.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.etiqueta }} />
      ))}
    </Tabs>
  );
}
