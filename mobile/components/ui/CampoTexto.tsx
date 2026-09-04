import type { LucideIcon } from 'lucide-react-native';
import type { JSX } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';

export interface CampoTextoProps {
  label: string;
  valor: string;
  onCambiar: (v: string) => void;
  icon: LucideIcon;
  placeholder: string;
  keyboardType?: 'default' | 'number-pad';
  /** Para contraseñas/secretos — oculta lo tipeado, mismo criterio que un campo de PIN. */
  secureTextEntry?: boolean;
  /** Para identificadores técnicos (tenant id, URLs) — sin esto, capitaliza como texto normal. */
  autoCapitalize?: 'none' | 'sentences';
}

/**
 * Campo de texto simple, mismo estilo visual que `Select`/el campo de
 * Clave del login (icono + borde + radio), pero editable de verdad — a
 * diferencia del resto de los campos del design system, que son
 * selección, no tipeo libre.
 */
export function CampoTexto({
  label,
  valor,
  onCambiar,
  icon: Icon,
  placeholder,
  keyboardType = 'default',
  secureTextEntry = false,
  autoCapitalize = 'sentences',
}: CampoTextoProps): JSX.Element {
  return (
    <View style={styles.campo}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputFila}>
        <Icon size={19} color={colors.grisClaro} />
        <TextInput
          style={styles.input}
          value={valor}
          onChangeText={onCambiar}
          placeholder={placeholder}
          placeholderTextColor={colors.grisClaro}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  campo: { gap: 6 },
  label: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.semibold },
  inputFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 54,
    paddingHorizontal: 15,
    backgroundColor: colors.campo,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
  },
  input: { flex: 1, fontSize: fontSize.base, color: colors.tinta, fontFamily: fonts.regular, padding: 0 },
});
