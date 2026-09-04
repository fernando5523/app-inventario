import { Check } from 'lucide-react-native';
import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { totalUnidades } from '../../lib/dominio/empaque';
import type { Conteo, Producto } from '../../lib/dominio/tipos';
import { colors, fonts, fontSize, radius } from '../../lib/theme';

export interface TarjetaProductoProps {
  producto: Producto;
  /** null = todavía sin contar. */
  conteo: Conteo | null;
  /** Confirmado por escáner — persistido en el conteo, o pendiente de uno recién escaneado. */
  confirmado: boolean;
  /** true cuando la hoja ya está finalizada: no se puede editar ni contar. */
  bloqueado: boolean;
  onPress: () => void;
}

/**
 * Tarjeta de producto (`.producto` en conteo.html) — regla número uno: en
 * NINGÚN lado de esta tarjeta aparece el stock del ERP, solo lo que el
 * operario cuenta. `totalUnidades()` es la única fuente del total, nunca
 * `cajas * factor + sueltas` a mano.
 */
export function TarjetaProducto({ producto, conteo, confirmado, bloqueado, onPress }: TarjetaProductoProps): JSX.Element {
  const contado = conteo !== null;
  const total = conteo ? totalUnidades(conteo, producto.empaques) : 0;
  // Badge del empaque por defecto (el [0], el más común) — la tarjeta es
  // compacta a propósito, el detalle de TODOS los empaques cargados va
  // en la línea de abajo, no acá arriba.
  const empaqueDefault = producto.empaques[0];
  const detalleEmpaques = conteo?.empaques.map((l) => `${l.cantidad} ${l.empaqueNombre}`).join(' + ') ?? '';

  return (
    <Pressable
      onPress={bloqueado ? undefined : onPress}
      disabled={bloqueado}
      accessibilityRole={bloqueado ? undefined : 'button'}
      accessibilityLabel={contado ? `Editar conteo de ${producto.descripcion}` : `Contar ${producto.descripcion}`}
      style={({ pressed }) => [styles.raiz, contado && styles.contado, bloqueado && styles.bloqueado, pressed && !bloqueado && styles.presionada]}
    >
      <View style={styles.cabecera}>
        {empaqueDefault ? (
          <View style={styles.empaqueBadge}>
            <Text style={styles.empaqueBadgeTexto}>
              {empaqueDefault.nombre.toUpperCase()} ×{empaqueDefault.factor}
              {producto.empaques.length > 1 ? ` +${producto.empaques.length - 1}` : ''}
            </Text>
          </View>
        ) : null}
        <Text style={styles.numero}>#{producto.codigo}</Text>
      </View>

      <Text style={styles.nombre}>{producto.descripcion}</Text>
      <View style={styles.codigoFila}>
        <Text style={styles.codigo}>Código {producto.codigoBarras}</Text>
        {confirmado ? (
          <View style={styles.confirmadoTag}>
            <Check size={10} color={colors.ok} />
            <Text style={styles.confirmadoTexto}>Confirmado</Text>
          </View>
        ) : null}
      </View>

      {contado && conteo ? (
        <View style={styles.pie}>
          <Text style={styles.detalle}>
            {detalleEmpaques ? `${detalleEmpaques} · ` : ''}Sueltas: {conteo.sueltas} und
          </Text>
          <View style={styles.totalFila}>
            <Text style={styles.totalCifra}>{total}</Text>
            <Text style={styles.totalUnidad}>und</Text>
          </View>
        </View>
      ) : (
        <View style={styles.pie}>
          <Text style={styles.detalle}>Ubicación: {producto.ubicacion ?? 'Sin ubicación'}</Text>
          {/* Vista, no Pressable: la tarjeta entera ya es la única superficie
              tocable (ver el Pressable raíz) — un segundo Pressable anidado
              acá le pelea el gesture responder al de afuera dentro del
              ScrollView. */}
          <View style={[styles.btnContar, bloqueado && styles.btnContarDeshabilitado]}>
            <Text style={styles.btnContarTexto}>+ Contar</Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  raiz: { gap: 6, padding: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.borde, backgroundColor: colors.campo },
  contado: { borderColor: 'rgba(10,107,87,0.28)' },
  bloqueado: { opacity: 0.72 },
  presionada: { backgroundColor: colors.rojoSuave },
  cabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  empaqueBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99, backgroundColor: colors.esperaSuave },
  empaqueBadgeTexto: { fontSize: 10, letterSpacing: 0.4, color: colors.gris, fontFamily: fonts.bold },
  numero: { fontSize: 11, color: colors.grisClaro, fontFamily: fonts.semibold },
  nombre: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.bold },
  codigoFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  codigo: { fontSize: fontSize.xs, color: colors.gris, fontFamily: fonts.regular },
  confirmadoTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  confirmadoTexto: { fontSize: 10.5, color: colors.ok, fontFamily: fonts.bold },
  pie: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 2 },
  detalle: { flex: 1, minWidth: 0, fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },
  totalFila: { flex: 0, flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  totalCifra: { fontSize: 18, color: colors.ok, fontFamily: fonts.bold },
  totalUnidad: { fontSize: 10.5, color: colors.ok, fontFamily: fonts.bold },
  btnContar: { paddingVertical: 8, paddingHorizontal: 13, borderRadius: radius.sm, backgroundColor: colors.rojo },
  btnContarDeshabilitado: { backgroundColor: '#DCD6D2' },
  btnContarTexto: { fontSize: 12.5, color: colors.blanco, fontFamily: fonts.bold },
});
