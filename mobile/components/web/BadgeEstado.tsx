import type { JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { VeredictoAuditoria } from '../../lib/dominio/tipos';
import { colors, fonts, fontSize, radius } from '../../lib/theme';

/**
 * El estado de un ítem, como pill con punto de color.
 *
 * ---------------------------------------------------------------------------
 * CINCO ESTADOS, NO TRES
 * ---------------------------------------------------------------------------
 * El mockup muestra Faltante / Sobrante / Cuadrado. Faltan dos, y no son
 * detalles: `empresa` (la diferencia existe pero la absorbe gerencia) y
 * `sin_dato` (el ERP no trajo stock, o nadie lo contó todavía).
 *
 * Pintar un `sin_dato` como "Cuadrado" es EL peor error posible en esta
 * pantalla, y ya pasó una vez: 11.835 productos sin stock cargado se
 * reportaron como "100% cuadrado". Por eso el tipo de esta prop es el
 * veredicto completo del dominio -- si mañana aparece un sexto estado, esto
 * deja de compilar en vez de mostrarlo mal.
 *
 * ---------------------------------------------------------------------------
 * EL PUNTO ANTES DEL TEXTO
 * ---------------------------------------------------------------------------
 * La forma se lee antes que la palabra: en una tabla de 985 filas el ojo
 * barre la columna de estados por color, y solo lee la que lo frena. El punto
 * da ese color sin teñir el renglón entero.
 */
export interface BadgeEstadoProps {
  veredicto: VeredictoAuditoria;
}

const ESTILOS: Record<VeredictoAuditoria, { etiqueta: string; tinta: string; fondo: string }> = {
  cuadrado: { etiqueta: 'Cuadrado', tinta: colors.gris, fondo: colors.esperaSuave },
  falta: { etiqueta: 'Con diferencia', tinta: colors.falta, fondo: colors.faltaSuave },
  empresa: { etiqueta: 'Empresa', tinta: colors.proceso, fondo: colors.procesoSuave },
  sin_erp: { etiqueta: 'Sin dato del ERP', tinta: colors.gris, fondo: colors.esperaSuave },
  sin_contar: { etiqueta: 'Sin contar', tinta: colors.gris, fondo: colors.esperaSuave },
};

export function BadgeEstado({ veredicto }: BadgeEstadoProps): JSX.Element {
  const { etiqueta, tinta, fondo } = ESTILOS[veredicto];
  return (
    <View style={[styles.pill, { backgroundColor: fondo }]}>
      <View style={[styles.punto, { backgroundColor: tinta }]} />
      <Text style={[styles.texto, { color: tinta }]} numberOfLines={1}>
        {etiqueta}
      </Text>
    </View>
  );
}

/**
 * La misma pill, pero para el SIGNO de una diferencia: falta en rojo, sobra en
 * verde. Se separa del veredicto porque responde otra pregunta -- el veredicto
 * dice "hay diferencia", esto dice "para qué lado".
 */
export function BadgeDiferencia({ unidades }: { unidades: number }): JSX.Element {
  const falta = unidades < 0;
  const tinta = falta ? colors.falta : colors.ok;
  const fondo = falta ? colors.faltaSuave : colors.okSuave;
  return (
    <View style={[styles.pill, { backgroundColor: fondo }]}>
      <View style={[styles.punto, { backgroundColor: tinta }]} />
      <Text style={[styles.texto, { color: tinta }]}>{falta ? 'Faltante' : 'Sobrante'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: radius.full,
  },
  punto: { width: 6, height: 6, borderRadius: radius.full },
  texto: { fontSize: fontSize.xs, fontFamily: fonts.semibold },
});
