import { Layers, LogOut } from 'lucide-react-native';
import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, spacing } from '../../lib/theme';

export interface BarraAppProps {
  rotulo: string;
  /** Omitila en pantallas que ya la muestran en otro lado (ej. Contar, que solo necesita el rótulo). */
  sede?: string;
  /** Cifras del contexto (hojas, ítems, etc). Omitila si el rol no debe verlas — ver conteo ciego. */
  cifras?: string;
  /** Sin esta prop no se pinta el botón de salir (ej. Contar, colgado de un tab, no es el lugar para cerrar sesión). */
  onSalir?: () => void;
  /** Para agruparla con una fila de avance debajo, en un solo bloque visual con un único borde (patrón `.cabecera-hoja` de conteo.html/mis-hojas.html). */
  sinBorde?: boolean;
}

/** Barra superior de contexto (`.barra-app` en las maquetas) — sede, cifras y salida, arriba de toda pantalla operativa. */
export function BarraApp({ rotulo, sede, cifras, onSalir, sinBorde = false }: BarraAppProps): JSX.Element {
  return (
    <View style={[styles.raiz, sinBorde && styles.sinBorde]}>
      <View style={styles.contexto}>
        <View style={styles.rotuloFila}>
          <Layers size={13} color={colors.rojo} />
          <Text style={styles.rotulo}>{rotulo}</Text>
        </View>
        {sede ? <Text style={styles.sede}>{sede}</Text> : null}
        {cifras ? <Text style={styles.cifras}>{cifras}</Text> : null}
      </View>
      {onSalir ? (
        <Pressable onPress={onSalir} style={styles.salir} accessibilityRole="button" accessibilityLabel="Cerrar sesión">
          <LogOut size={19} color={colors.gris} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borde,
  },
  sinBorde: { paddingBottom: 0, borderBottomWidth: 0 },
  contexto: { flex: 1, minWidth: 0 },
  rotuloFila: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rotulo: {
    fontSize: 10.5,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.rojo,
    fontFamily: fonts.bold,
  },
  sede: { marginTop: 3, fontSize: 16, color: colors.tinta, fontFamily: fonts.bold },
  cifras: { marginTop: 2, fontSize: 12, color: colors.gris, fontFamily: fonts.regular },
  salir: {
    width: 38,
    height: 38,
    flex: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.sm + 1,
  },
});
