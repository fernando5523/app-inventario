import { Eye, EyeOff, Delete, X } from 'lucide-react-native';
import { useState, type JSX } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';
import { PinPuntos } from './PinPuntos';

export interface TecladoPinProps {
  visible: boolean;
  titulo: string;
  valor: string;
  longitud: number;
  onCambiar: (nuevoValor: string) => void;
  onCerrar: () => void;
}

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'ver', '0', 'borrar'] as const;
const FILAS = [TECLAS.slice(0, 3), TECLAS.slice(3, 6), TECLAS.slice(6, 9), TECLAS.slice(9, 12)];

/**
 * Teclado numérico propio en modal centrado — no el del sistema. Se cierra
 * por el fondo, por la X, con el botón atrás de Android (onRequestClose) y
 * solo al completar los dígitos (mismo comportamiento que login.html).
 */
export function TecladoPin({ visible, titulo, valor, longitud, onCambiar, onCerrar }: TecladoPinProps): JSX.Element {
  const [revelado, setRevelado] = useState(false);

  function tecleaDigito(d: string): void {
    if (valor.length >= longitud) return;
    const nuevo = valor + d;
    onCambiar(nuevo);
    if (nuevo.length === longitud) onCerrar();
  }

  function borrarDigito(): void {
    onCambiar(valor.slice(0, -1));
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCerrar}>
      <Pressable style={styles.fondo} onPress={onCerrar} accessibilityLabel="Cerrar el teclado" />
      <View pointerEvents="box-none" style={styles.centrado}>
        <View style={[styles.caja, shadow.modal]}>
          <View style={styles.cabecera}>
            <Text style={styles.titulo}>{titulo}</Text>
            <Pressable onPress={onCerrar} style={styles.cerrar} accessibilityLabel="Cerrar el teclado">
              <X size={19} color={colors.gris} />
            </Pressable>
          </View>

          <PinPuntos valor={valor} longitud={longitud} revelado={revelado} grande />

          <View style={styles.teclado}>
            {FILAS.map((fila, i) => (
              <View key={i} style={styles.filaTeclado}>
                {fila.map((t) => {
                  if (t === 'ver') {
                    return (
                      <Pressable
                        key={t}
                        style={styles.tecla}
                        onPress={() => setRevelado((v) => !v)}
                        accessibilityLabel={revelado ? 'Ocultar la clave' : 'Mostrar la clave'}
                        accessibilityState={{ selected: revelado }}
                      >
                        {revelado ? <EyeOff size={22} color={colors.gris} /> : <Eye size={22} color={colors.gris} />}
                      </Pressable>
                    );
                  }
                  if (t === 'borrar') {
                    return (
                      <Pressable key={t} style={styles.tecla} onPress={borrarDigito} accessibilityLabel="Borrar un dígito">
                        <Delete size={22} color={colors.gris} />
                      </Pressable>
                    );
                  }
                  return (
                    <Pressable key={t} style={styles.tecla} onPress={() => tecleaDigito(t)}>
                      <Text style={styles.tectext}>{t}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  centrado: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  caja: {
    width: '100%',
    maxWidth: 310,
    gap: spacing.lg - 1,
    padding: 17,
    backgroundColor: colors.campo,
    borderRadius: radius.xl,
  },
  cabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  titulo: { fontSize: fontSize.base - 0.5, color: colors.tinta, fontFamily: fonts.bold },
  cerrar: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  teclado: { gap: 9 },
  filaTeclado: { flexDirection: 'row', gap: 9 },
  tecla: {
    flex: 1,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.campo,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
  },
  tectext: {
    fontSize: fontSize.xl,
    color: colors.tinta,
    fontFamily: fonts.semibold,
    fontVariant: ['tabular-nums'],
  },
});
