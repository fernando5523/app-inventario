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
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // `flexGrow: 0` -- SIN ESTO LOS CHIPS NO SE VEN EN WEB. Un ScrollView
      // horizontal adentro de una columna flex se estira a lo alto en el
      // navegador y termina con altura 0: el filtro queda como un hueco en
      // blanco y la persona no puede cambiar de vista (visto en /auditor/ajuste,
      // donde escondia el "Todos (985)"). En el telefono el alto siempre salio
      // del contenido, asi que no cambia nada.
      style={styles.contenedor}
      contentContainerStyle={styles.fila}
    >
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
  contenedor: { flexGrow: 0, flexShrink: 0 },
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
