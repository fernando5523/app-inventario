import { ChevronRight, LayoutGrid } from 'lucide-react-native';
import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';

export interface AccesoTarjetaProps {
  titulo: string;
  sub: string;
  onPress: () => void;
}

/** Tarjeta tocable de acceso (`.acceso` en las maquetas) — icono, título + subtítulo, flecha. */
export function AccesoTarjeta({ titulo, sub, onPress }: AccesoTarjetaProps): JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.raiz, pressed && styles.presionada]}
      accessibilityRole="button"
    >
      <View style={styles.icono}>
        <LayoutGrid size={18} color={colors.rojo} />
      </View>
      <View style={styles.textos}>
        <Text style={styles.titulo}>{titulo}</Text>
        <Text style={styles.sub}>{sub}</Text>
      </View>
      <ChevronRight size={18} color={colors.rojo} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  raiz: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: 15,
    backgroundColor: colors.campo,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.lg,
  },
  presionada: { backgroundColor: colors.rojoSuave, borderColor: 'rgba(216,32,24,0.3)' },
  icono: {
    width: 40,
    height: 40,
    flex: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rojoSuave,
    borderRadius: radius.md,
  },
  textos: { flex: 1, minWidth: 0, gap: 2 },
  titulo: { fontSize: fontSize.sm + 0.5, color: colors.tinta, fontFamily: fonts.bold },
  sub: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },
});
