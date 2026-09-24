import type { LucideIcon } from 'lucide-react-native';
import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radius } from '../../lib/theme';

/**
 * El ícono metido en un cuadrado redondeado con fondo tintado.
 *
 * Es la pieza que más se repite en el diseño de la web: encabeza cada tarjeta,
 * cada renglón de la barra lateral y cada bloque de la tabla. Vive en un
 * componente y no suelto en cada pantalla porque de lo contrario el tamaño y
 * el radio terminan distintos en cada lugar -- y un chip de 34px al lado de
 * uno de 40 se nota aunque nadie sepa decir por qué.
 *
 * ---------------------------------------------------------------------------
 * EL TONO DICE DE QUÉ HABLA LA TARJETA
 * ---------------------------------------------------------------------------
 * No es decoración: `marca` (rojo suave) es lo propio del inventario,
 * `ok` lo que cerró bien, `atencion` lo que espera una decisión. Se usa la
 * MISMA paleta que los badges y los montos, así que un chip verde arriba de un
 * número verde no es casualidad -- es el mismo significado dos veces.
 */
export type TonoChip = 'marca' | 'ok' | 'atencion' | 'neutro';

export interface ChipIconoProps {
  icono: LucideIcon;
  tono?: TonoChip;
  /** 38 por defecto: el del encabezado de tarjeta. 30 para la barra lateral y la tabla. */
  tamano?: number;
}

const TONOS: Record<TonoChip, { fondo: string; tinta: string }> = {
  marca: { fondo: colors.rojoSuave, tinta: colors.rojo },
  ok: { fondo: colors.okSuave, tinta: colors.ok },
  atencion: { fondo: colors.procesoSuave, tinta: colors.proceso },
  neutro: { fondo: colors.esperaSuave, tinta: colors.gris },
};

export function ChipIcono({ icono: Icono, tono = 'marca', tamano = 38 }: ChipIconoProps): JSX.Element {
  const { fondo, tinta } = TONOS[tono];
  return (
    <View style={[styles.chip, { width: tamano, height: tamano, backgroundColor: fondo }]}>
      {/* El ícono ocupa ~55% del chip: más chico se pierde, más grande toca los
          bordes y el cuadrado deja de leerse como un chip. */}
      <Icono size={Math.round(tamano * 0.55)} color={tinta} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
