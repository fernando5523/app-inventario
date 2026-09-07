import { Eye, EyeOff, Delete, X } from 'lucide-react-native';
import { useState, type JSX } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';
import { accionAlTeclear } from '../../lib/dominio/teclado-pin';
import { PinPuntos } from './PinPuntos';

export interface TecladoPinProps {
  visible: boolean;
  titulo: string;
  valor: string;
  longitud: number;
  onCambiar: (nuevoValor: string) => void;
  /**
   * Se dispara al completar los `longitud` dígitos, con el valor FINAL como
   * argumento. Úsalo (no `onCerrar`) cuando al completar haya que HACER algo
   * con el PIN —resetearlo, enviarlo—: `onCerrar` corre en el mismo tick que
   * el `setState` de `onCambiar`, así que leer el valor del estado del padre
   * ahí devuelve el dígito ANTERIOR. Ver lib/dominio/teclado-pin.ts.
   *
   * Si no se pasa, completar cierra el teclado (comportamiento de siempre):
   * sirve para los campos que solo capturan el PIN y lo usan en otro render
   * (login, alta de cuenta, cambiar mi PIN).
   */
  onCompletar?: (valorFinal: string) => void;
  /** Cierre MANUAL: X, fondo o botón atrás. No recibe el valor. */
  onCerrar: () => void;
}

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'ver', '0', 'borrar'] as const;
const FILAS = [TECLAS.slice(0, 3), TECLAS.slice(3, 6), TECLAS.slice(6, 9), TECLAS.slice(9, 12)];

/**
 * Teclado numérico propio en modal centrado — no el del sistema. Se cierra
 * por el fondo, por la X y con el botón atrás de Android (onRequestClose).
 *
 * REGLA DEL OJO (cliente, 2026-09-07): al completar los dígitos, con el ojo
 * APAGADO se confirma solo (cero toques extra); con el ojo PRENDIDO el teclado
 * NO se cierra — muestra el PIN revelado y pide un toque en "Confirmar", para
 * poder revisarlo antes de mandarlo. Qué hacer lo decide
 * teclado-pin.ts#accionAlTeclear (pura, testeada).
 */
export function TecladoPin({ visible, titulo, valor, longitud, onCambiar, onCompletar, onCerrar }: TecladoPinProps): JSX.Element {
  const [revelado, setRevelado] = useState(false);

  function tecleaDigito(d: string): void {
    // `accionAlTeclear` es puro y devuelve el valor FINAL como dato: se lo
    // pasamos a los callbacks como argumento, nunca leemos el estado del padre
    // (que en este mismo tick todavía tiene el dígito anterior). Ver
    // teclado-pin.ts.
    const accion = accionAlTeclear(valor, d, longitud, revelado);
    if (accion.tipo === 'ignora') return;
    onCambiar(accion.valor);
    // 'confirma' = ojo apagado y completo: se confirma solo, como siempre.
    // 'espera' = ojo prendido y completo: NO se cierra; el botón "Confirmar"
    // de abajo aparece (valor ya tiene `longitud` dígitos). 'sigue' = dígito
    // intermedio: solo se actualiza el valor.
    if (accion.tipo === 'confirma') confirmar(accion.valor);
  }

  // Cierra la captura con el PIN COMPLETO: onCompletar si el consumidor hace
  // algo con él (resetear, enviar); si no, onCerrar (login / alta / cambiar).
  function confirmar(pin: string): void {
    if (onCompletar) onCompletar(pin);
    else onCerrar();
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

          {valor.length === longitud ? (
            <Pressable style={styles.confirmar} onPress={() => confirmar(valor)} accessibilityLabel="Confirmar el PIN">
              <Text style={styles.confirmarTexto}>Confirmar</Text>
            </Pressable>
          ) : null}
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
  // Grande y al pie del teclado — donde ya está el pulgar tras el último
  // dígito. Rojo = la acción (design system Trujillo).
  confirmar: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rojo,
    borderRadius: radius.md,
  },
  confirmarTexto: { fontSize: fontSize.base, color: colors.blanco, fontFamily: fonts.bold },
});
