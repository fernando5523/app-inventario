import type { JSX } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '../../lib/theme';
import { ScreenContainer, type ScreenContainerProps } from '../ui';
import { ALTO_TAB_BAR } from './tabs';

/**
 * ScreenContainer para pantallas que viven dentro de un grupo con tabs.
 *
 * El tab bar cuelga con `position: absolute` (TabBar.tsx) del contenedor de
 * `<Tabs>` -- React Navigation no le reserva espacio al contenido de la
 * pantalla porque es un `tabBar` custom, no el de default.
 *
 * ---------------------------------------------------------------------------
 * BUG REAL (encontrado en la prueba end-to-end de liquidación, 2026-09-11)
 * ---------------------------------------------------------------------------
 * Esto rellenaba el CONTENIDO scrolleable con `paddingBottom` (un padding
 * que viaja DENTRO de `contentContainerStyle`, después del último ítem). Esa
 * plata solo se ve una vez que se scrollea hasta el final -- el ScrollView
 * en sí sigue midiendo su viewport hasta el borde REAL de la pantalla, así
 * que con una lista lo bastante larga la ÚLTIMA fila nace ya tapada por la
 * barra ANTES de que nadie scrollee un pixel: el toque de esa fila lo agarra
 * un botón de la barra (tan alto como su propia superficie), no el control
 * de la fila. Se vio en vivo: "Excluir" de la última línea de ajustes
 * activaba la pestaña Usuarios.
 *
 * Un padding más grande no alcanza -- sigue siendo la misma trampa con una
 * lista un poco más larga. La solución es ACHICAR el propio ScrollView:
 * reservando el alto de la barra como `paddingBottom` del CONTENEDOR (la
 * `SafeAreaView` de `ScreenContainer`, vía la prop `style`) en vez del
 * contenido, el ScrollView nunca llega a dibujar nada detrás de la barra --
 * "scrollear hasta el final" deja de ser una condición para que el último
 * ítem sea tocable, sea cual sea el largo de la lista.
 *
 * El tab bar incluye el inset inferior del equipo (gesto/home indicator), y
 * acá se reserva ese mismo alto para que el margen coincida exacto con la
 * barra real, en vez de un número aparte que se puede desalinear.
 */
export function PantallaConTabs(props: ScreenContainerProps): JSX.Element {
  const { contentStyle, style, ...resto } = props;
  const insets = useSafeAreaInsets();
  return (
    <ScreenContainer
      {...resto}
      style={[{ paddingBottom: ALTO_TAB_BAR + insets.bottom }, style]}
      contentStyle={[{ paddingBottom: spacing.lg }, contentStyle]}
    />
  );
}
