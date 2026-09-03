import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { EstadoHoja } from '../../lib/dominio/tipos';
import { colors, fonts } from '../../lib/theme';
import { Badge, type BadgeVariant } from './Badge';

export interface TarjetaHojaProps {
  numero: string;
  titulo?: string;
  codigos?: string;
  estado: EstadoHoja;
  contados: number;
  total: number;
  /** false cuando la hoja todavía no tiene catálogo cargado — no se puede abrir. */
  habilitada: boolean;
  onPress: () => void;
}

const BADGE_TEXTO: Record<EstadoHoja, string> = {
  pendiente: 'Pendiente',
  'en-proceso': 'En proceso',
  finalizada: 'Finalizada',
};
const BADGE_VARIANTE: Record<EstadoHoja, BadgeVariant> = {
  pendiente: 'default',
  'en-proceso': 'proceso',
  finalizada: 'ok',
};
const BORDE_ESTADO: Record<EstadoHoja, string> = {
  pendiente: colors.borde,
  'en-proceso': 'rgba(138,90,5,0.42)',
  finalizada: 'rgba(10,107,87,0.34)',
};
const COLOR_VALOR: Record<EstadoHoja, string> = {
  pendiente: colors.grisClaro,
  'en-proceso': colors.proceso,
  finalizada: colors.ok,
};

/** Tarjeta de hoja (`.hoja-card` en las maquetas) — mismo diseño que la tarjeta de producto de conteo.html: badge + número arriba, título, código, detalle + valor destacado abajo. */
export function TarjetaHoja({ numero, titulo, codigos, estado, contados, total, habilitada, onPress }: TarjetaHojaProps): JSX.Element {
  const detalle = habilitada
    ? contados === total
      ? 'Hoja contada por completo'
      : estado === 'finalizada'
        ? 'Finalizada'
        : 'Contando ahora'
    : 'Sin catálogo cargado todavía';

  return (
    <Pressable
      onPress={habilitada ? onPress : undefined}
      disabled={!habilitada}
      accessibilityRole={habilitada ? 'button' : undefined}
      style={({ pressed }) => [
        styles.raiz,
        { borderColor: BORDE_ESTADO[estado] },
        !habilitada && styles.bloqueada,
        habilitada && pressed && styles.presionada,
      ]}
    >
      <View style={styles.cabecera}>
        <Badge label={BADGE_TEXTO[estado]} variant={BADGE_VARIANTE[estado]} />
        <Text style={styles.numero}>#{numero}</Text>
      </View>
      <Text style={styles.titulo}>{titulo ? `Hoja #${numero} · ${titulo}` : `Hoja #${numero}`}</Text>
      {codigos ? <Text style={styles.codigos}>{codigos}</Text> : null}
      <View style={styles.pie}>
        <Text style={styles.detalle}>{detalle}</Text>
        <View style={styles.valorFila}>
          <Text style={[styles.cifra, { color: COLOR_VALOR[estado] }]}>
            {contados}/{total}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  raiz: {
    gap: 6,
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: colors.campo,
  },
  bloqueada: { opacity: 0.82 },
  presionada: { backgroundColor: colors.rojoSuave },
  cabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  numero: { fontSize: 11, color: colors.grisClaro, fontFamily: fonts.semibold },
  titulo: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.bold, lineHeight: 18 },
  codigos: { fontSize: 11, color: colors.gris, fontFamily: fonts.regular },
  pie: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 2 },
  detalle: { flex: 1, minWidth: 0, fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },
  valorFila: { flex: 0, flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  cifra: { fontSize: 17, fontFamily: fonts.bold },
});
