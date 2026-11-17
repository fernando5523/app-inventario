import { ChevronRight, Clock } from 'lucide-react-native';
import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ETIQUETA_ESTADO, VARIANTE_ESTADO, fechaDeSolicitud, textoEspera, textoProductos } from '../../lib/aprobacion/presentacion';
import type { SolicitudResumen } from '../../lib/aprobacion/tipos';
import { colors, fonts, radius, spacing } from '../../lib/theme';
import { Badge, formatoMoneda } from '../ui';

export interface TarjetaSolicitudProps {
  solicitud: SolicitudResumen;
  /** En Pendientes se muestra la espera; en Historial, el estado final. */
  modo: 'pendiente' | 'historial';
  onAbrir: () => void;
}

/**
 * Una solicitud en la lista. Toda la tarjeta abre el detalle: no lleva botón
 * (regla de la casa: si la tarjeta abre algo, no se repite la acción adentro).
 * La espera se comunica por dos vías: el badge y el borde de la tarjeta.
 */
export function TarjetaSolicitud({ solicitud: s, modo, onAbrir }: TarjetaSolicitudProps): JSX.Element {
  const demorada = modo === 'pendiente' && s.demorada;
  return (
    <Pressable
      onPress={onAbrir}
      accessibilityRole="button"
      accessibilityLabel={`Abrir la solicitud ${s.id} de ${s.almacenNombre || s.almacenId}`}
      style={({ pressed }) => [styles.tarjeta, demorada && styles.demorada, pressed && styles.presionada]}
    >
      <View style={styles.fila}>
        <Text style={styles.numero}>{s.id}</Text>
        {modo === 'pendiente' ? (
          <View style={[styles.espera, demorada && styles.esperaDemorada]}>
            <Clock size={12} color={demorada ? colors.proceso : colors.gris} />
            <Text style={[styles.esperaTexto, demorada && styles.esperaTextoDemorada]}>{textoEspera(s.horasEsperando)}</Text>
          </View>
        ) : (
          <Badge label={ETIQUETA_ESTADO[s.estado]} variant={VARIANTE_ESTADO[s.estado]} />
        )}
      </View>
      <Text style={styles.almacen} numberOfLines={1}>
        {s.almacenNombre || s.almacenId}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {s.almacenId}
        {s.fecha ? ` · ${fechaDeSolicitud(s.fecha)}` : ''}
      </Text>
      <Text style={styles.personas} numberOfLines={2}>
        Solicita: {s.solicitaNombre || '—'} · Autoriza: {s.autorizaNombre || '—'}
      </Text>
      <View style={[styles.fila, styles.pie]}>
        <Text style={styles.productos}>{textoProductos(s.productos)}</Text>
        <View style={styles.importeFila}>
          <Text style={styles.importe}>S/ {formatoMoneda(modo === 'historial' && s.estado === 'registrada' ? s.importeAprobado : s.importeTotal)}</Text>
          <ChevronRight size={18} color={colors.grisClaro} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tarjeta: {
    backgroundColor: colors.blanco,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 3,
  },
  demorada: { borderColor: colors.proceso, borderLeftWidth: 4 },
  presionada: { backgroundColor: colors.rojoSuave },
  fila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  numero: { fontFamily: fonts.bold, fontSize: 15, color: colors.tinta },
  espera: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: colors.esperaSuave,
  },
  esperaDemorada: { backgroundColor: colors.procesoSuave },
  esperaTexto: { fontFamily: fonts.semibold, fontSize: 12, color: colors.gris },
  esperaTextoDemorada: { color: colors.proceso },
  almacen: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.tinta, marginTop: 2 },
  meta: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.gris },
  personas: { fontFamily: fonts.regular, fontSize: 13, color: colors.tinta },
  pie: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.riel },
  productos: { fontFamily: fonts.medium, fontSize: 13, color: colors.gris },
  importeFila: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  importe: { fontFamily: fonts.bold, fontSize: 15, color: colors.tinta },
});
