import { ChevronRight } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { JSX, PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';
import { ChipIcono, type TonoChip } from './ChipIcono';

/**
 * La tarjeta blanca del diseño de la web: chip de ícono, título, y el chevron
 * a la derecha SOLO cuando lleva a algún lado.
 *
 * ---------------------------------------------------------------------------
 * EL CHEVRON NO ES ADORNO
 * ---------------------------------------------------------------------------
 * Aparece si y solo si hay `onAbrir`. Una tarjeta con flecha que no lleva a
 * ninguna parte enseña a no confiar en las flechas, y después la que sí lleva
 * no se toca. Por eso no es una prop de estilo: sale de que haya a dónde ir.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO EXTIENDE `Card`
 * ---------------------------------------------------------------------------
 * `components/ui/Card.tsx` es la tarjeta del teléfono y la usan trece
 * pantallas. Esta tiene otra anatomía -- encabezado con chip, sombra, lienzo
 * gris detrás -- y meterle un modo "web" a la otra terminaría en un componente
 * con dos diseños adentro. Decisión del usuario para toda la web: *"clonalo y
 * cambialo, en todo caso son plataformas diferentes"*.
 */
export interface TarjetaWebProps extends PropsWithChildren {
  titulo: string;
  /** Debajo del título, en gris. Para explicar de qué va la tarjeta en una línea. */
  sub?: string;
  icono?: LucideIcon;
  tono?: TonoChip;
  /** Con esto aparece el chevron y la tarjeta entera se vuelve tocable. */
  onAbrir?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function TarjetaWeb({ titulo, sub, icono, tono = 'marca', onAbrir, style, children }: TarjetaWebProps): JSX.Element {
  const encabezado = (
    <View style={styles.encabezado}>
      {icono ? <ChipIcono icono={icono} tono={tono} /> : null}
      <View style={styles.tituloBloque}>
        <Text style={styles.titulo}>{titulo}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      {onAbrir ? <ChevronRight size={19} color={colors.grisClaro} /> : null}
    </View>
  );

  return (
    <View style={[styles.tarjeta, style]}>
      {onAbrir ? (
        <Pressable onPress={onAbrir} accessibilityRole="button" accessibilityLabel={titulo}>
          {encabezado}
        </Pressable>
      ) : (
        encabezado
      )}
      {children}
    </View>
  );
}

/**
 * Un renglón de "etiqueta a la izquierda, número a la derecha", que es de lo
 * que están hechas estas tarjetas.
 *
 * `destacada` le pone la banda tintada: es para EL número que se mira, no para
 * los tres que lo acompañan. Si se destacan todos no se destaca ninguno.
 */
export function FilaDato({
  etiqueta,
  valor,
  destacada = false,
  color,
}: {
  etiqueta: string;
  valor: string;
  destacada?: boolean;
  color?: string;
}): JSX.Element {
  return (
    <View style={[styles.fila, destacada && styles.filaDestacada]}>
      <Text style={[styles.etiqueta, destacada && styles.etiquetaDestacada]}>{etiqueta}</Text>
      <Text style={[styles.valor, destacada && styles.valorDestacado, color ? { color } : null]}>{valor}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tarjeta: {
    flex: 1,
    backgroundColor: colors.blanco,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borde,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.tarjeta,
  },
  encabezado: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  tituloBloque: { flex: 1, gap: 1 },
  titulo: { fontSize: fontSize.lg, color: colors.tinta, fontFamily: fonts.bold },
  sub: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },

  fila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 5 },
  /** La banda tintada: mismo rojo suave que usan los badges de faltante. */
  filaDestacada: {
    backgroundColor: colors.rojoSuave,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 2,
  },
  etiqueta: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },
  etiquetaDestacada: { color: colors.tinta, fontFamily: fonts.semibold },
  valor: { fontSize: fontSize.base, color: colors.tinta, fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] },
  valorDestacado: { fontSize: fontSize.lg, color: colors.rojo, fontFamily: fonts.bold },
});
