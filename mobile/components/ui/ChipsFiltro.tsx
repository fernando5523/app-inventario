import type { JSX } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { colors, fonts, radius } from '../../lib/theme';

export interface OpcionChip {
  id: string;
  etiqueta: string;
  contador?: number;
}

export interface ChipsFiltroProps {
  opciones: OpcionChip[];
  activo: string;
  onCambiar: (id: string) => void;
}

/** Fila de chips de filtro (`.chips`/`.chip` en las maquetas) — scroll horizontal, sin barra visible. */
export function ChipsFiltro({ opciones, activo, onCambiar }: ChipsFiltroProps): JSX.Element {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fila}>
      {opciones.map((op) => {
        const seleccionado = op.id === activo;
        return (
          <Pressable
            key={op.id}
            onPress={() => onCambiar(op.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: seleccionado }}
            style={[styles.chip, seleccionado && styles.chipActivo]}
          >
            <Text style={[styles.texto, seleccionado && styles.textoActivo]}>
              {op.etiqueta}
              {op.contador !== undefined ? ` (${op.contador})` : ''}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fila: { flexDirection: 'row', gap: 7 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borde,
    backgroundColor: colors.campo,
  },
  chipActivo: { backgroundColor: colors.rojo, borderColor: colors.rojo },
  texto: { fontSize: 12.5, color: colors.tinta, fontFamily: fonts.medium },
  textoActivo: { color: colors.blanco, fontFamily: fonts.bold },
});
