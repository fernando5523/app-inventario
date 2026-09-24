import type { JSX } from 'react';

import { spacing } from '../../lib/theme';
import { ScreenContainer, type ScreenContainerProps } from '../ui';

/**
 * En web NO hay barra de pestañas al pie -- la navegación está en la barra
 * lateral (`RolTabsLayout.web.tsx`), así que el hueco que la versión del
 * teléfono reserva abajo (`ALTO_TAB_BAR` + el `inset` del gesto) acá es una
 * franja muerta de 80px al final de cada pantalla.
 *
 * Tampoco usa `useSafeAreaInsets`: el navegador no tiene notch ni barra de
 * gestos.
 *
 * El nombre y las props son los MISMOS a propósito: las pantallas siguen
 * escribiendo `<PantallaConTabs>` sin saber en qué plataforma corren, y Metro
 * elige este archivo cuando el bundle es de web.
 */
export function PantallaConTabs(props: ScreenContainerProps): JSX.Element {
  const { contentStyle, ...resto } = props;
  return <ScreenContainer {...resto} contentStyle={[{ paddingBottom: spacing.lg }, contentStyle]} />;
}
