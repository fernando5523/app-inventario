import { ChevronRight, Home } from 'lucide-react-native';
import type { JSX, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, fontSize, spacing } from '../../lib/theme';

/**
 * El encabezado de una pantalla de la web: miga de pan, título grande,
 * subtítulo, y a la derecha las acciones de la página.
 *
 * ---------------------------------------------------------------------------
 * LA MIGA DE PAN EXISTE PORQUE LA BARRA LATERAL NO ALCANZA
 * ---------------------------------------------------------------------------
 * La barra dice dónde SE PUEDE ir; la miga dice dónde SE ESTÁ, y en qué rama.
 * "Auditoría › Panel de auditoría" ubica sin tener que leer el título. En el
 * teléfono no hace falta: hay una pantalla a la vez y un botón de volver.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTE ENCABEZADO NO TRAE
 * ---------------------------------------------------------------------------
 * El diseño tiene arriba un buscador global ("productos, ítems o
 * funcionalidades") y una campana de notificaciones. NO están, a propósito: no
 * existe endpoint de búsqueda transversal ni sistema de notificaciones, y un
 * ícono que no hace nada enseña a ignorar la interfaz. Entran el día que
 * signifiquen algo.
 */
export interface EncabezadoPaginaProps {
  /** Las ramas anteriores. La última del arreglo es la sección; el título va aparte. */
  migas?: string[];
  titulo: string;
  sub?: string;
  /** Botones o selectores de la esquina derecha. */
  acciones?: ReactNode;
  onInicio?: () => void;
}

export function EncabezadoPagina({ migas = [], titulo, sub, acciones, onInicio }: EncabezadoPaginaProps): JSX.Element {
  return (
    <View style={styles.bloque}>
      <View style={styles.miga}>
        <Pressable onPress={onInicio} accessibilityRole="link" accessibilityLabel="Inicio" disabled={!onInicio}>
          <Home size={15} color={colors.grisClaro} />
        </Pressable>
        {migas.map((rama, i) => (
          <View key={rama} style={styles.migaTramo}>
            <ChevronRight size={14} color={colors.grisClaro} />
            {/* La última rama en rojo: es dónde se está parado. Las anteriores
                en gris, que son el camino. */}
            <Text style={[styles.migaTexto, i === migas.length - 1 && styles.migaActual]}>{rama}</Text>
          </View>
        ))}
      </View>

      <View style={styles.fila}>
        <View style={styles.textos}>
          <Text style={styles.titulo}>{titulo}</Text>
          {sub ? <Text style={styles.sub}>{sub}</Text> : null}
        </View>
        {acciones ? <View style={styles.acciones}>{acciones}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bloque: { gap: spacing.sm },
  miga: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  migaTramo: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  migaTexto: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.medium },
  migaActual: { color: colors.rojo, fontFamily: fonts.semibold },

  fila: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.lg },
  textos: { flex: 1, gap: 2 },
  /** Grande de verdad: es lo primero que el ojo agarra al entrar a la página. */
  titulo: { fontSize: 30, color: colors.tinta, fontFamily: fonts.bold, lineHeight: 36 },
  sub: { fontSize: fontSize.base, color: colors.gris, fontFamily: fonts.regular },
  acciones: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
