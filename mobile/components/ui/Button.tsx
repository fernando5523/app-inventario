import type { LucideIcon } from 'lucide-react-native';
import type { JSX } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';

/**
 * En Trujillo el rojo es SIEMPRE la acción — no hay variantes de "peligro" o
 * "éxito" para botones, eso es lo que distingue a un botón de un badge de
 * estado. `primary` es la única variante rellena.
 */
export type ButtonVariant = 'primary' | 'outline' | 'ghost';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  /** Lado del ícono respecto del label. `left` por defecto — no rompe usos existentes. */
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

const VARIANTS: Record<ButtonVariant, { container: ViewStyle; text: string; icon: string }> = {
  primary: {
    container: { backgroundColor: colors.rojo },
    text: colors.blanco,
    // El ícono va en dorado dentro del botón de acción principal, tal cual
    // .ingresar svg en la maqueta — es la única excepción al "rojo = accion".
    icon: colors.dorado,
  },
  outline: {
    container: { backgroundColor: colors.campo, borderWidth: 1, borderColor: colors.borde },
    text: colors.tinta,
    icon: colors.gris,
  },
  ghost: {
    container: { backgroundColor: 'transparent' },
    text: colors.tinta,
    icon: colors.gris,
  },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  style,
}: ButtonProps): JSX.Element {
  const v = VARIANTS[variant];
  const isDisabled = disabled || loading;

  const sizeStyle = size === 'lg' ? styles.lg : size === 'sm' ? styles.sm : styles.md;
  const fontStyle = size === 'lg' ? fontSize.lg : size === 'sm' ? fontSize.sm : fontSize.base;

  const marca = loading ? (
    <ActivityIndicator size="small" color={v.icon} />
  ) : Icon ? (
    <Icon size={size === 'sm' ? 16 : 20} color={v.icon} />
  ) : null;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        sizeStyle,
        v.container,
        pressed && !isDisabled && variant === 'primary' ? styles.pressedPrimary : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
    >
      {iconPosition === 'left' ? marca : null}
      <Text style={[styles.label, { color: v.text, fontSize: fontStyle }]}>{label}</Text>
      {iconPosition === 'right' ? marca : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.sm,
  },
  sm: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
  },
  md: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  lg: {
    minHeight: 56,
    paddingHorizontal: spacing.xl,
  },
  label: {
    fontFamily: fonts.bold,
    letterSpacing: 0.2,
  },
  pressedPrimary: {
    backgroundColor: colors.rojoHover,
  },
  disabled: {
    backgroundColor: '#DCD6D2',
  },
});
