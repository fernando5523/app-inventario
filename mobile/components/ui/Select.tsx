import type { LucideIcon } from 'lucide-react-native';
import { ChevronDown } from 'lucide-react-native';
import { useEffect, useRef, type JSX } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';

export interface SelectOpcion {
  id: string | number;
  titulo: string;
  subtitulo?: string;
}

export interface SelectProps {
  icon: LucideIcon;
  valor: SelectOpcion | null;
  placeholder: string;
  opciones: SelectOpcion[];
  onSeleccionar: (opcion: SelectOpcion) => void;
  disabled?: boolean;
  /** Motivo por el que está deshabilitado, ej. "Elegí primero la sucursal". */
  disabledHint?: string;
  accessibilityLabel: string;
  /**
   * Controlado desde la pantalla: así, al abrir un select, la pantalla puede
   * cerrar los demás (igual que `cerrarListas()` en login.html).
   */
  abierto: boolean;
  onCambiarAbierto: (abierto: boolean) => void;
}

/**
 * Select desplegable del design system Trujillo. La lista NO empuja el
 * contenido de abajo: cuelga en `position: absolute` sobre el resto de la
 * pantalla, igual que en login.html.
 */
export function Select({
  icon: Icon,
  valor,
  placeholder,
  opciones,
  onSeleccionar,
  disabled = false,
  disabledHint,
  accessibilityLabel,
  abierto,
  onCambiarAbierto,
}: SelectProps): JSX.Element {
  const rotacion = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(rotacion, {
      toValue: abierto ? 1 : 0,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [abierto, rotacion]);

  const chevronDeg = rotacion.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <View style={styles.campo}>
      <Pressable
        onPress={() => !disabled && onCambiarAbierto(!abierto)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled, expanded: abierto }}
        style={[styles.control, disabled && styles.controlDeshabilitado, abierto && styles.controlAbierto]}
      >
        <Icon size={20} color={disabled ? colors.grisClaro : colors.gris} />
        <View style={styles.valorContenedor}>
          {valor ? (
            <>
              <Text style={styles.valorTexto} numberOfLines={1}>
                {valor.titulo}
              </Text>
              {valor.subtitulo ? <Text style={styles.subTexto}>{valor.subtitulo}</Text> : null}
            </>
          ) : (
            <Text style={styles.valorVacio} numberOfLines={1}>
              {disabled && disabledHint ? disabledHint : placeholder}
            </Text>
          )}
        </View>
        <Animated.View style={{ transform: [{ rotate: chevronDeg }] }}>
          <ChevronDown size={18} color={disabled ? colors.grisClaro : colors.rojo} />
        </Animated.View>
      </Pressable>

      {abierto ? (
        <View style={[styles.lista, shadow.modal]}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.listaScroll}
            nestedScrollEnabled
          >
            {opciones.map((op) => {
              const seleccionada = valor?.id === op.id;
              return (
                <Pressable
                  key={op.id}
                  onPress={() => {
                    onSeleccionar(op);
                    onCambiarAbierto(false);
                  }}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: seleccionada }}
                  style={[styles.opcion, seleccionada && styles.opcionSeleccionada]}
                >
                  <Text style={[styles.opcionTitulo, seleccionada && styles.opcionTituloSeleccionada]} numberOfLines={1}>
                    {op.titulo}
                  </Text>
                  {op.subtitulo ? (
                    <Text style={[styles.opcionMeta, seleccionada && styles.opcionMetaSeleccionada]}>{op.subtitulo}</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  campo: { position: 'relative' },
  control: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 54,
    paddingHorizontal: 15,
    backgroundColor: colors.campo,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
  },
  controlAbierto: {
    borderColor: colors.rojo,
  },
  controlDeshabilitado: {
    backgroundColor: colors.campoDeshabilitado,
  },
  valorContenedor: { flex: 1, minWidth: 0 },
  valorTexto: { fontSize: fontSize.base, color: colors.tinta, fontFamily: fonts.regular },
  valorVacio: { fontSize: fontSize.base, color: colors.grisClaro, fontFamily: fonts.regular },
  subTexto: {
    fontSize: 11.5,
    color: colors.gris,
    marginTop: 1,
    fontFamily: fonts.regular,
    fontVariant: ['tabular-nums'],
  },
  lista: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: spacing.xs + 2,
    maxHeight: 262,
    backgroundColor: colors.campo,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
    zIndex: 30,
    overflow: 'hidden',
  },
  listaScroll: { maxHeight: 262 },
  opcion: {
    paddingVertical: spacing.md,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#F0ECE9',
  },
  opcionSeleccionada: {
    backgroundColor: colors.rojo,
  },
  opcionTitulo: { fontSize: 15, color: colors.tinta, fontFamily: fonts.regular },
  opcionTituloSeleccionada: { color: colors.blanco, fontFamily: fonts.semibold },
  opcionMeta: {
    fontSize: 11.5,
    color: colors.gris,
    marginTop: 1,
    fontFamily: fonts.regular,
    fontVariant: ['tabular-nums'],
  },
  opcionMetaSeleccionada: { color: 'rgba(255,255,255,0.82)' },
});
