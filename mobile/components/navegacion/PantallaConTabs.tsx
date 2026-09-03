import type { JSX } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenContainer, type ScreenContainerProps } from '../ui';
import { ALTO_TAB_BAR } from './tabs';

/**
 * ScreenContainer para pantallas que viven dentro de un grupo con tabs.
 * Descuenta el alto del tab-bar (ver TabBar.tsx) del contenido scrolleable
 * — es el bug clásico que ya marcamos en mobile/design/home.html: como el
 * tab bar cuelga con `position: absolute`, sin este padding el último
 * ítem de la lista queda tapado. El tab bar sí incluye el inset inferior
 * del equipo (gesto/home indicator), así que el contenido también lo suma
 * para que el margen se sienta igual en todos los teléfonos.
 */
export function PantallaConTabs(props: ScreenContainerProps): JSX.Element {
  const { contentStyle, ...resto } = props;
  const insets = useSafeAreaInsets();
  return (
    <ScreenContainer
      {...resto}
      contentStyle={[{ paddingBottom: ALTO_TAB_BAR + insets.bottom + 24 }, contentStyle]}
    />
  );
}
