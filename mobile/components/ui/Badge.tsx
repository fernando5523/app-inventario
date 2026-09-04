import type { JSX } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';

/** Paleta semántica de estados (ver SKILL.md): nunca usar rojo para esto. */
export type BadgeVariant = 'default' | 'ok' | 'proceso' | 'espera' | 'outline' | 'falta';

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  style?: StyleProp<ViewStyle>;
}

export function Badge({ label, variant = 'default', style }: BadgeProps): JSX.Element {
  return (
    <View style={[styles.base, styles[variant], style]}>
      <Text style={[styles.text, styles[`${variant}Text`]]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: fontSize.xs,
    letterSpacing: 0.3,
    fontFamily: fonts.bold,
  },
  default: {
    backgroundColor: colors.esperaSuave,
  },
  defaultText: {
    color: colors.espera,
  },
  ok: {
    backgroundColor: colors.okSuave,
  },
  okText: {
    color: colors.ok,
  },
  proceso: {
    backgroundColor: colors.procesoSuave,
  },
  procesoText: {
    color: colors.proceso,
  },
  espera: {
    backgroundColor: colors.esperaSuave,
  },
  esperaText: {
    color: colors.espera,
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.borde,
  },
  outlineText: {
    color: colors.tinta,
  },
  // No es un estado del ciclo de conteo (ok/proceso/espera) -- es una
  // ADVERTENCIA de configuración incompleta con consecuencia real (ej.
  // sucursal sin almacén de Dynamics: sin stock, la auditoría no puede
  // comparar nada). Mismo criterio que BandaSync's 'error'.
  falta: {
    backgroundColor: colors.faltaSuave,
  },
  faltaText: {
    color: colors.falta,
  },
});
