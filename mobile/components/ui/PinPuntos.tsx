import type { JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../../lib/theme';

export interface PinPuntosProps {
  valor: string;
  longitud: number;
  /** Revela los dígitos en vez de puntos llenos. */
  revelado?: boolean;
  /** Variante grande: la que va dentro del modal del teclado. */
  grande?: boolean;
}

/**
 * Puntos de avance del PIN. Se pintan en DOS lugares (campo cerrado y modal
 * abierto) para que el avance se vea sin importar si el teclado está abierto
 * — igual que en la maqueta.
 */
export function PinPuntos({ valor, longitud, revelado = false, grande = false }: PinPuntosProps): JSX.Element {
  return (
    <View style={[styles.fila, grande && styles.filaGrande]}>
      {Array.from({ length: longitud }).map((_, i) => {
        const lleno = i < valor.length;
        if (lleno && revelado) {
          return (
            <Text key={i} style={[styles.digito, grande && styles.digitoGrande]}>
              {valor.charAt(i)}
            </Text>
          );
        }
        return (
          <View
            key={i}
            style={[
              styles.punto,
              grande && styles.puntoGrande,
              lleno && styles.puntoLleno,
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  filaGrande: { justifyContent: 'center', gap: 15, minHeight: 30 },
  punto: {
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#C9C1BB',
    backgroundColor: 'transparent',
  },
  puntoGrande: { width: 14, height: 14, borderRadius: 7 },
  puntoLleno: {
    backgroundColor: colors.tinta,
    borderColor: colors.tinta,
  },
  digito: {
    fontSize: 15,
    color: colors.tinta,
    fontFamily: fonts.bold,
    fontVariant: ['tabular-nums'],
  },
  digitoGrande: { fontSize: 19 },
});
