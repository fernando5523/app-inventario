import { Minus, Plus, X } from 'lucide-react-native';
import { useEffect, useState, type JSX } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { totalUnidades, validarConteo } from '../../lib/dominio/empaque';
import type { Conteo, Producto } from '../../lib/dominio/tipos';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';

export interface ModalConteoProps {
  visible: boolean;
  producto: Producto | null;
  /** null = registro nuevo. No-null = ya tiene conteo guardado, se edita. */
  conteoInicial: Conteo | null;
  /** Viene de un escaneo pendiente que todavía no se guardó. */
  confirmadoPorEscaner: boolean;
  onGuardar: (conteo: Conteo) => void;
  onCerrar: () => void;
}

/**
 * Modal de registro de conteo — empaques cerrados + unidades sueltas, con
 * el total calculado en vivo. `totalUnidades()` es la ÚNICA fuente de esa
 * cuenta (lib/dominio/empaque.ts): nunca se hace `cajas * factor + sueltas`
 * a mano acá.
 */
export function ModalConteo({
  visible,
  producto,
  conteoInicial,
  confirmadoPorEscaner,
  onGuardar,
  onCerrar,
}: ModalConteoProps): JSX.Element | null {
  const [cajas, setCajas] = useState(0);
  const [sueltas, setSueltas] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setCajas(conteoInicial?.empaques ?? 0);
    setSueltas(conteoInicial?.sueltas ?? 0);
  }, [visible, producto?.id, conteoInicial]);

  if (!visible || !producto) return null;

  const conteoBorrador: Conteo = {
    productoId: producto.id,
    empaques: cajas,
    sueltas,
    confirmadoPorEscaner,
    contadoEn: conteoInicial?.contadoEn ?? '',
  };
  const total = totalUnidades(conteoBorrador, producto.empaque);
  const advertencias = validarConteo(conteoBorrador, producto.empaque);

  function guardar(): void {
    onGuardar({ ...conteoBorrador, contadoEn: new Date().toISOString() });
  }

  return (
    // Overlay en JS, NO <Modal> nativo: en Android, cerrar un Modal
    // transparent+fade deja al primer toque siguiente mal enrutado (le
    // llega al Pressable que tenía el responder antes de abrirse, no a lo
    // que hay debajo ahora). Mismo patrón ya probado en el modal de
    // "¿Finalizar?" de contar.tsx — se renderiza como hermano del
    // ScrollView de la pantalla, nunca adentro, para que el
    // absoluteFillObject cubra la pantalla entera y no quede recortado
    // por el contenido scrolleable.
    <View style={styles.raiz} pointerEvents="box-none">
      <Pressable style={styles.fondo} onPress={onCerrar} />
      <View pointerEvents="box-none" style={styles.centrado}>
        <View style={[styles.caja, shadow.modal]}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.cabecera}>
              <Text style={styles.titulo}>{conteoInicial ? 'Editar conteo' : 'Registrar conteo'}</Text>
              <Pressable onPress={onCerrar} style={styles.cerrar} accessibilityLabel="Cerrar">
                <X size={18} color={colors.gris} />
              </Pressable>
            </View>

            <View style={styles.productoBloque}>
              <View style={styles.empaqueBadge}>
                <Text style={styles.empaqueBadgeTexto}>
                  {producto.empaque.nombre.toUpperCase()} ×{producto.empaque.factor}
                </Text>
              </View>
              <Text style={styles.nombreProducto}>{producto.descripcion}</Text>
              <Text style={styles.meta}>
                Código {producto.codigoBarras}
                {producto.ubicacion ? ` · ${producto.ubicacion}` : ''}
              </Text>
            </View>

            <View style={styles.campo}>
              <View style={styles.campoEtiquetaFila}>
                <Text style={styles.campoEtiqueta}>Empaques cerrados</Text>
                <Text style={styles.factor}>
                  Factor: {producto.empaque.factor} und/{producto.empaque.nombre.toLowerCase()}
                </Text>
              </View>
              <View style={styles.stepper}>
                <Pressable
                  style={styles.stepperBtn}
                  onPress={() => setCajas((v) => Math.max(0, v - 1))}
                  accessibilityLabel="Restar una caja"
                >
                  <Minus size={16} color={colors.tinta} />
                </Pressable>
                <Text style={styles.stepperValor}>{cajas}</Text>
                <Pressable style={styles.stepperBtn} onPress={() => setCajas((v) => v + 1)} accessibilityLabel="Sumar una caja">
                  <Plus size={16} color={colors.tinta} />
                </Pressable>
              </View>
            </View>

            <View style={styles.campo}>
              <Text style={styles.campoEtiqueta}>Unidades sueltas</Text>
              <View style={styles.stepper}>
                <Pressable
                  style={styles.stepperBtn}
                  onPress={() => setSueltas((v) => Math.max(0, v - 1))}
                  accessibilityLabel="Restar una unidad"
                >
                  <Minus size={16} color={colors.tinta} />
                </Pressable>
                <Text style={styles.stepperValor}>{sueltas}</Text>
                <Pressable style={styles.stepperBtn} onPress={() => setSueltas((v) => v + 1)} accessibilityLabel="Sumar una unidad">
                  <Plus size={16} color={colors.tinta} />
                </Pressable>
              </View>
            </View>

            <View style={styles.atajos}>
              <Pressable style={styles.atajoChip} onPress={() => setCajas((v) => v + 1)}>
                <Text style={styles.atajoChipTexto}>+1 Caja</Text>
              </Pressable>
              <Pressable style={styles.atajoChip} onPress={() => setCajas((v) => v + 5)}>
                <Text style={styles.atajoChipTexto}>+5 Cajas</Text>
              </Pressable>
              <Pressable style={styles.atajoChip} onPress={() => setSueltas((v) => v + 5)}>
                <Text style={styles.atajoChipTexto}>+5 Und</Text>
              </Pressable>
              <Pressable
                style={[styles.atajoChip, styles.atajoChipBorrar]}
                onPress={() => {
                  setCajas(0);
                  setSueltas(0);
                }}
              >
                <Text style={styles.atajoChipBorrarTexto}>Borrar</Text>
              </Pressable>
            </View>

            {advertencias.length > 0 ? (
              <View style={styles.advertencias}>
                {advertencias.map((a) => (
                  <Text key={a.tipo} style={styles.advertenciaTexto}>
                    {a.mensaje}
                  </Text>
                ))}
              </View>
            ) : null}

            <View style={styles.totalVivo}>
              <Text style={styles.totalEtiqueta}>Total contado</Text>
              <Text style={styles.totalValor}>{total} und</Text>
              <Text style={styles.totalDesglose}>
                {cajas} {cajas === 1 ? 'Caja' : 'Cajas'} ({cajas * producto.empaque.factor} und) + {sueltas} Sueltas
              </Text>
            </View>

            <Pressable style={styles.guardar} onPress={guardar}>
              <Text style={styles.guardarTexto}>Guardar registro en hoja</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: { ...StyleSheet.absoluteFillObject, zIndex: 50, elevation: 50 },
  fondo: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  centrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  caja: {
    width: '100%',
    maxWidth: 320,
    maxHeight: '86%',
    padding: 17,
    backgroundColor: colors.campo,
    borderRadius: radius.xl,
  },
  cabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: 12 },
  titulo: { fontSize: 15, color: colors.tinta, fontFamily: fonts.bold },
  cerrar: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  productoBloque: { gap: 2, marginBottom: 14 },
  empaqueBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 99,
    backgroundColor: colors.esperaSuave,
  },
  empaqueBadgeTexto: { fontSize: 10.5, letterSpacing: 0.5, color: colors.gris, fontFamily: fonts.bold },
  nombreProducto: { marginTop: 4, fontSize: 14, color: colors.tinta, fontFamily: fonts.bold },
  meta: { marginTop: 2, fontSize: fontSize.xs, color: colors.gris, fontFamily: fonts.regular },
  campo: { marginBottom: 12, gap: 6 },
  campoEtiquetaFila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  campoEtiqueta: { fontSize: 13, color: colors.tinta, fontFamily: fonts.semibold },
  factor: { fontSize: fontSize.xs, color: colors.gris, fontFamily: fonts.regular },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.sm,
  },
  stepperValor: { flex: 1, textAlign: 'center', fontSize: 18, color: colors.tinta, fontFamily: fonts.bold },
  atajos: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 },
  atajoChip: { paddingVertical: 7, paddingHorizontal: 11, borderRadius: 99, backgroundColor: colors.rojoSuave },
  atajoChipTexto: { fontSize: 12, color: colors.rojo, fontFamily: fonts.bold },
  atajoChipBorrar: { backgroundColor: colors.esperaSuave },
  atajoChipBorrarTexto: { fontSize: 12, color: colors.espera, fontFamily: fonts.bold },
  advertencias: { marginBottom: 12, gap: 4 },
  advertenciaTexto: { fontSize: 11.5, color: colors.proceso, fontFamily: fonts.medium },
  totalVivo: {
    alignItems: 'center',
    gap: 2,
    padding: 12,
    marginBottom: 14,
    borderRadius: radius.md,
    backgroundColor: colors.okSuave,
  },
  totalEtiqueta: { fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ok, fontFamily: fonts.semibold },
  totalValor: { fontSize: 22, color: colors.ok, fontFamily: fonts.bold },
  totalDesglose: { fontSize: 11.5, color: colors.ok, fontFamily: fonts.regular },
  guardar: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.rojo,
  },
  guardarTexto: { fontSize: 14.5, color: colors.blanco, fontFamily: fonts.bold },
});
