import { ChevronRight } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { JSX } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';

/**
 * Los dos botones del diseño de la web.
 *
 * `principal` -- rojo lleno, ícono a la izquierda, chevron a la derecha. Es LA
 * acción de la pantalla y hay UNA por pantalla. Dos botones rojos compitiendo
 * es un formulario donde nadie sabe cuál toca.
 *
 * `secundario` -- blanco con borde, y puede llevar un subtítulo: "Revisar ítem
 * por ítem / 985 ítems · 6 con diferencia". Ese segundo renglón es lo que hace
 * que se pueda decidir si entrar SIN entrar.
 *
 * ---------------------------------------------------------------------------
 * APAGADO, NO ESCONDIDO
 * ---------------------------------------------------------------------------
 * `deshabilitado` lo deja visible y gris, y `motivo` explica por qué debajo.
 * Un botón que desaparece deja a la persona buscando algo que vio ayer -- la
 * misma lección que la planilla de cuadros, que se queda apagada con su
 * motivo en vez de irse.
 */
export interface BotonWebProps {
  etiqueta: string;
  sub?: string;
  icono?: LucideIcon;
  variante?: 'principal' | 'secundario';
  onPress: () => void;
  deshabilitado?: boolean;
  cargando?: boolean;
  /** Por qué no se puede. Se muestra debajo, en gris, solo si está deshabilitado. */
  motivo?: string;
}

export function BotonWeb({
  etiqueta,
  sub,
  icono: Icono,
  variante = 'secundario',
  onPress,
  deshabilitado = false,
  cargando = false,
  motivo,
}: BotonWebProps): JSX.Element {
  const principal = variante === 'principal';
  const apagado = deshabilitado || cargando;
  const tinta = principal ? colors.blanco : colors.tinta;

  return (
    <View style={styles.bloque}>
      <Pressable
        style={[
          styles.boton,
          sub ? styles.botonConSub : null,
          principal ? styles.principal : styles.secundario,
          apagado && (principal ? styles.principalApagado : styles.secundarioApagado),
        ]}
        onPress={onPress}
        disabled={apagado}
        accessibilityRole="button"
        accessibilityLabel={motivo && deshabilitado ? `${etiqueta}: ${motivo}` : etiqueta}
      >
        {cargando ? (
          <ActivityIndicator size="small" color={tinta} />
        ) : Icono ? (
          <Icono size={16} color={apagado && !principal ? colors.grisClaro : tinta} />
        ) : null}
        <View style={styles.textos}>
          <Text style={[styles.etiqueta, { color: apagado && !principal ? colors.grisClaro : tinta }]} numberOfLines={1}>
            {etiqueta}
          </Text>
          {sub ? (
            <Text style={[styles.sub, principal && styles.subPrincipal]} numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </View>
        <ChevronRight size={16} color={principal ? colors.blanco : colors.grisClaro} />
      </Pressable>
      {deshabilitado && motivo ? <Text style={styles.motivo}>{motivo}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bloque: { gap: 6 },
  /**
   * ALTO DE MOUSE, NO DE DEDO.
   *
   * Arrancó en 52px, que es la medida del teléfono: un dedo necesita 44-48px
   * para no errarle. Un puntero acierta en 36 y los botones de 52 en una
   * pantalla ancha se ven inflados -- corrección del usuario mirando la web.
   *
   * 40 es el piso cómodo con mouse. El secundario CON subtítulo crece a 52
   * porque ahí hay dos renglones de texto, no porque sea un botón más
   * importante.
   */
  boton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  botonConSub: { minHeight: 52, paddingVertical: 7 },
  principal: { backgroundColor: colors.rojo },
  principalApagado: { backgroundColor: colors.grisClaro },
  secundario: { backgroundColor: colors.blanco, borderWidth: 1, borderColor: colors.borde },
  secundarioApagado: { backgroundColor: colors.campoDeshabilitado, borderColor: colors.campoDeshabilitado },

  textos: { flex: 1, gap: 1 },
  etiqueta: { fontSize: 13.5, fontFamily: fonts.bold },
  sub: { fontSize: 12, color: colors.gris, fontFamily: fonts.regular },
  /** Sobre el rojo, el subtítulo va en blanco apagado y no en gris: el gris no contrasta. */
  subPrincipal: { color: 'rgba(255,255,255,0.82)' },
  motivo: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular, paddingHorizontal: 2 },
});
