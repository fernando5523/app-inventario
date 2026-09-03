import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts } from '../../lib/theme';
import { ALTO_TAB_BAR, TABS_POR_ROL } from './tabs';

/**
 * Tab bar propio, no el default de React Navigation — así se replica
 * exacto el diseño validado en mobile/design/home.html: icono + etiqueta +
 * indicador rojo arriba del activo (tres señales, no solo color).
 *
 * Cuelga con `position: absolute` del contenedor de <Tabs>, igual que
 * `.tab-bar` cuelga de `.telefono` en la maqueta — por eso el contenido de
 * cada pantalla tiene que compensar con `paddingBottom` (ver
 * PantallaConTabs.tsx), no alcanza con el layout en flujo normal.
 */
export function TabBar({ state, navigation }: BottomTabBarProps): JSX.Element {
  const { sesion } = useSesion();
  const insets = useSafeAreaInsets();
  const tabs = sesion ? TABS_POR_ROL[sesion.colaborador.rol] : [];

  return (
    <View style={[styles.raiz, { paddingBottom: insets.bottom }]}>
      {state.routes.map((route, index) => {
        const tab = tabs.find((t) => t.name === route.name);
        if (!tab) return null;
        const activo = state.index === index;
        const Icon = tab.icono;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={activo ? { selected: true } : {}}
            accessibilityLabel={tab.etiqueta}
            style={styles.tab}
            onPress={() => {
              const evento = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!activo && !evento.defaultPrevented) navigation.navigate(route.name);
            }}
          >
            <View style={[styles.indicador, activo && styles.indicadorActivo]} />
            <Icon size={20} color={activo ? colors.rojo : colors.gris} />
            {/* numberOfLines: con 4 tabs (Administrador/Auditor) el ancho por
                tab baja de ~125px a ~90px — esto evita que una etiqueta
                larga se parta en dos líneas y desalinee la fila. */}
            <Text style={[styles.etiqueta, activo && styles.etiquetaActiva]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              {tab.etiqueta}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: colors.fondo,
    borderTopWidth: 1,
    borderTopColor: colors.borde,
  },
  tab: {
    flex: 1,
    minHeight: ALTO_TAB_BAR,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingTop: 9,
    paddingHorizontal: 2,
  },
  indicador: {
    position: 'absolute',
    top: 0,
    left: '50%',
    marginLeft: -13,
    width: 26,
    height: 3,
    borderRadius: 4,
    backgroundColor: colors.rojo,
    opacity: 0,
  },
  indicadorActivo: { opacity: 1 },
  etiqueta: { fontSize: 10.5, color: colors.gris, fontFamily: fonts.semibold },
  etiquetaActiva: { color: colors.rojo, fontFamily: fonts.bold },
});
