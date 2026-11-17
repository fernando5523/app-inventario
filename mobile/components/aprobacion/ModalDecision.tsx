import { X } from 'lucide-react-native';
import { useEffect, useState, type JSX } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';
import { Button } from '../ui';

export interface ModalDecisionProps {
  visible: boolean;
  titulo: string;
  /** Qué se está decidiendo (producto y cantidad, o "3 productos"). */
  detalle: string;
  /** Lo que queda firme. Regla de la casa: una acción irreversible lo dice antes. */
  consecuencia: string;
  etiquetaConfirmar: string;
  /** Muestra el campo de comentario (al rechazar). */
  conComentario: boolean;
  ocupado: boolean;
  onConfirmar: (comentario: string) => void;
  onCerrar: () => void;
}

/** Confirmación de una decisión. Se cierra por el fondo, la ✕ o al terminar. */
export function ModalDecision(p: ModalDecisionProps): JSX.Element {
  const [comentario, setComentario] = useState('');
  useEffect(() => {
    if (p.visible) setComentario('');
  }, [p.visible]);

  return (
    <Modal visible={p.visible} transparent animationType="fade" onRequestClose={p.ocupado ? () => undefined : p.onCerrar}>
      <KeyboardAvoidingView behavior="padding" style={styles.raiz}>
        <Pressable style={styles.fondo} onPress={p.ocupado ? undefined : p.onCerrar} accessibilityLabel="Cerrar" />
        <View style={styles.caja}>
          <View style={styles.cabecera}>
            <Text style={styles.titulo}>{p.titulo}</Text>
            <Pressable onPress={p.onCerrar} disabled={p.ocupado} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={10}>
              <X size={20} color={colors.gris} />
            </Pressable>
          </View>
          <Text style={styles.detalle}>{p.detalle}</Text>
          <Text style={styles.consecuencia}>{p.consecuencia}</Text>
          {p.conComentario ? (
            <View style={styles.campo}>
              <Text style={styles.label}>Motivo del rechazo (opcional)</Text>
              <TextInput
                value={comentario}
                onChangeText={setComentario}
                placeholder="Ej.: no corresponde a consumo de la tienda"
                placeholderTextColor={colors.grisClaro}
                style={styles.input}
                maxLength={200}
                multiline
                editable={!p.ocupado}
              />
            </View>
          ) : null}
          <Button label={p.etiquetaConfirmar} size="lg" loading={p.ocupado} disabled={p.ocupado} onPress={() => p.onConfirmar(comentario)} />
          <Button label="Volver" variant="ghost" disabled={p.ocupado} onPress={p.onCerrar} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  raiz: { flex: 1, justifyContent: 'flex-end' },
  fondo: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  caja: {
    backgroundColor: colors.blanco,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: spacing.xl,
    gap: spacing.md,
    ...shadow.modal,
  },
  cabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titulo: { fontFamily: fonts.bold, fontSize: fontSize.lg, color: colors.tinta, flex: 1 },
  detalle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.tinta },
  consecuencia: { fontFamily: fonts.regular, fontSize: 13.5, color: colors.gris, lineHeight: 19 },
  campo: { gap: 6 },
  label: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.semibold },
  input: {
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 64,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.tinta,
    textAlignVertical: 'top',
  },
});
