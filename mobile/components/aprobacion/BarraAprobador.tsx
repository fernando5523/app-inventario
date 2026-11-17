import { router } from 'expo-router';
import { ClipboardCheck, History } from 'lucide-react-native';
import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ALTO_TAB_BAR } from '../navegacion/tabs';
import { colors, fonts } from '../../lib/theme';

const TABS = [
  { ruta: '/aprobador/pendientes', etiqueta: 'Pendientes', icono: ClipboardCheck },
  { ruta: '/aprobador/historial', etiqueta: 'Historial', icono: History },
] as const;

export interface BarraAprobadorProps {
  activa: (typeof TABS)[number]['ruta'];
  /** Cuántas esperan aprobación: se muestra en la pestaña, no en el inicio de otro rol. */
  pendientes?: number | null;
}

/**
 * Barra inferior de la aprobadora. Mismo aspecto que TabBar.tsx, pero propia:
 * aquella sale del rol de la sesión con PIN, que la aprobadora no tiene.
 */
export function BarraAprobador({ activa, pendientes }: BarraAprobadorProps): JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.raiz, { paddingBottom: insets.bottom }]}>
      {TABS.map((tab) => {
        const esActiva = tab.ruta === activa;
        const Icono = tab.icono;
        const contador = tab.ruta === '/aprobador/pendientes' && pendientes ? ` (${pendientes})` : '';
        return (
          <Pressable
            key={tab.ruta}
            accessibilityRole="button"
            accessibilityState={esActiva ? { selected: true } : {}}
            accessibilityLabel={`${tab.etiqueta}${contador}`}
            style={styles.tab}
            onPress={() => {
              if (!esActiva) router.replace(tab.ruta);
            }}
          >
            <View style={[styles.indicador, esActiva && styles.indicadorActivo]} />
            <Icono size={20} color={esActiva ? colors.rojo : colors.gris} />
            <Text style={[styles.etiqueta, esActiva && styles.etiquetaActiva]} numberOfLines={1}>
              {tab.etiqueta}
              {contador}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: {
    flexDirection: 'row',
    backgroundColor: colors.blanco,
    borderTopWidth: 1,
    borderTopColor: colors.borde,
    minHeight: ALTO_TAB_BAR,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 6, paddingBottom: 6 },
  indicador: { position: 'absolute', top: 0, height: 3, width: 36, borderRadius: 3, backgroundColor: 'transparent' },
  indicadorActivo: { backgroundColor: colors.rojo },
  etiqueta: { fontFamily: fonts.medium, fontSize: 12, color: colors.gris },
  etiquetaActiva: { color: colors.rojo, fontFamily: fonts.semibold },
});
