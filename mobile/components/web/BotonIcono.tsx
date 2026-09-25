import type { LucideIcon } from 'lucide-react-native';
import type { JSX } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { colors, radius } from '../../lib/theme';

/**
 * Un botón cuadrado, solo ícono. Para acciones que acompañan a otra cosa y no
 * merecen su propio renglón -- exportar al lado del estado del inventario,
 * refrescar al lado de un título.
 *
 * ---------------------------------------------------------------------------
 * SIN ETIQUETA VISIBLE, PERO NUNCA SIN NOMBRE
 * ---------------------------------------------------------------------------
 * `etiqueta` es obligatoria aunque no se dibuje: va al `accessibilityLabel`, y
 * es lo único que tiene quien navega con lector de pantalla o se detiene con
 * el teclado. Un ícono suelto sin nombre es un botón mudo.
 *
 * Cuando está deshabilitado, `etiqueta` lleva además el motivo -- el mismo
 * criterio que `BotonWeb`: el botón no desaparece, y por qué no se puede tiene
 * que estar dicho en alguna parte.
 */
export interface BotonIconoProps {
  icono: LucideIcon;
  /** Qué hace. No se muestra: es el nombre accesible y el tooltip del navegador. */
  etiqueta: string;
  onPress: () => void;
  deshabilitado?: boolean;
  cargando?: boolean;
}

export function BotonIcono({ icono: Icono, etiqueta, onPress, deshabilitado = false, cargando = false }: BotonIconoProps): JSX.Element {
  const apagado = deshabilitado || cargando;
  return (
    <Pressable
      style={[styles.boton, apagado && styles.apagado]}
      onPress={onPress}
      disabled={apagado}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      // `title` es lo que hace aparecer el tooltip del navegador al pasar el
      // mouse: con un ícono solo, es la única forma de saber qué hace sin
      // tocarlo. En el teléfono esta prop no existe y se ignora.
      {...{ title: etiqueta }}
    >
      {cargando ? (
        <ActivityIndicator size="small" color={colors.gris} />
      ) : (
        <Icono size={18} color={apagado ? colors.grisClaro : colors.tinta} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  boton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blanco,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
  },
  apagado: { backgroundColor: colors.campoDeshabilitado, borderColor: colors.campoDeshabilitado },
});
