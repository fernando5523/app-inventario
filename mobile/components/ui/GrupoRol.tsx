import type { JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, fontSize, radius } from '../../lib/theme';
import type { Rol } from '../../lib/dominio/tipos';

const ORDEN: Rol[] = ['administrador', 'coordinador', 'conteo', 'auditor'];
const ETIQUETAS: Record<Rol, string> = {
  administrador: 'Admin.',
  coordinador: 'Coord.',
  conteo: 'Conteo',
  auditor: 'Auditor',
};

export interface GrupoRolProps {
  /** Rol activo, derivado de la persona elegida. `null` = nadie elegido. */
  activo: Rol | null;
}

/**
 * El rol se MUESTRA, no se elige — por eso son `View`, nunca `Pressable`.
 * Atenuado mientras no hay persona seleccionada.
 */
export function GrupoRol({ activo }: GrupoRolProps): JSX.Element {
  return (
    <View style={[styles.grupo, !activo && styles.inerte]} accessibilityRole="none">
      {ORDEN.map((rol, i) => {
        const esActivo = rol === activo;
        return (
          <View
            key={rol}
            style={[styles.rol, i < ORDEN.length - 1 && styles.rolConBorde, esActivo && styles.rolActivo]}
          >
            <Text style={[styles.texto, esActivo && styles.textoActivo]}>{ETIQUETAS[rol]}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grupo: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderColor: colors.rojo,
    borderRadius: radius.md,
    backgroundColor: colors.campo,
    overflow: 'hidden',
  },
  inerte: { opacity: 0.38 },
  rol: {
    flex: 1,
    paddingVertical: 13,
    paddingHorizontal: 4,
    alignItems: 'center',
    backgroundColor: colors.campo,
  },
  rolConBorde: {
    borderRightWidth: 1.5,
    borderRightColor: colors.rojo,
  },
  rolActivo: {
    backgroundColor: colors.rojo,
  },
  texto: {
    fontSize: fontSize.sm - 0.5,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.tinta,
    fontFamily: fonts.bold,
  },
  textoActivo: {
    color: colors.blanco,
  },
});
