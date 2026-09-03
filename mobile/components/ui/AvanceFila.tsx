import type { JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../../lib/theme';

export interface AvanceFilaProps {
  texto: string;
  /** 0-100. Se recorta al rango — un valor fuera de rango no debe romper la barra. */
  porcentaje: number;
}

/** Cifra + barra de progreso (`.avance-fila` en las maquetas) — se agrupa con BarraApp (prop `sinBorde`) en un solo bloque de cabecera. */
export function AvanceFila({ texto, porcentaje }: AvanceFilaProps): JSX.Element {
  const ancho = Math.max(0, Math.min(100, porcentaje));
  return (
    <View style={styles.raiz}>
      <Text style={styles.cifra}>{texto}</Text>
      <View style={styles.barra}>
        <View style={[styles.relleno, { width: `${ancho}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: { gap: 6 },
  cifra: { fontSize: 12.5, color: colors.tinta, fontFamily: fonts.bold },
  // #EDE9E6 = --riel de las maquetas (fondo neutro de barras de progreso).
  // No está en lib/theme.ts todavía — fuera de mi alcance agregarlo ahí.
  barra: { width: '100%', height: 5, borderRadius: 99, backgroundColor: '#EDE9E6', overflow: 'hidden' },
  relleno: { height: '100%', borderRadius: 99, backgroundColor: colors.rojo },
});
