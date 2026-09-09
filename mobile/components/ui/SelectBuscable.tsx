import { Check, ChevronDown, Search, X } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useState, type JSX } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { filtrarOpciones } from '../../lib/dominio/filtro-productos';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';

export interface SelectBuscableProps {
  label: string;
  icon?: LucideIcon;
  /** Opciones (valores). Ya vienen ordenadas — este componente NO reordena. */
  opciones: readonly string[];
  /** Valor elegido, o `null` = ninguno (muestra `etiquetaVacia`). */
  valor: string | null;
  onCambiar: (valor: string | null) => void;
  /** La opción "sin filtro" arriba de la lista, ej. "Todas" / "Cualquiera". */
  etiquetaVacia: string;
  placeholderBusqueda: string;
  /** Controlado desde afuera para que un solo campo esté abierto a la vez. */
  abierto: boolean;
  onCambiarAbierto: (abierto: boolean) => void;
  /**
   * Si el campo de búsqueda toma el foco (y abre el teclado) apenas se
   * despliega el select. Por defecto `true` (comportamiento de siempre).
   * `ModalFiltrosProductos.tsx` (Contar) lo pone en `false` -- pedido del
   * cliente 2026-09-09: ahí el teclado tapaba la pantalla al abrir el
   * modal, sin que nadie lo haya tocado todavía. Acotado a esa pantalla:
   * `ModalFiltrosHojas.tsx` (Coordinador) no pasa esta prop y sigue igual.
   */
  autoFocusBusqueda?: boolean;
  /**
   * Si la lista desplegada FLOTA sobre lo que está debajo (`position:
   * absolute`, mismo patrón que `Select.tsx`) en vez de empujarlo dentro
   * del flujo (acordeón, comportamiento de siempre). Por defecto `false`.
   * `ModalFiltrosProductos.tsx` (Contar) lo pone en `true` -- pedido del
   * cliente 2026-09-09. Acotado a esa pantalla: `ModalFiltrosHojas.tsx`
   * (Coordinador) no pasa esta prop y sigue con el acordeón de siempre.
   */
  flotante?: boolean;
}

/**
 * Select de UN valor con BÚSQUEDA de texto adentro (estilo select2): se tipea
 * y la lista de opciones se achica, en vez de scrollear cien. Pensado para ir
 * DENTRO de un modal — la lista se despliega en línea (acordeón), con altura
 * máxima y scroll propio, así el modal no crece aunque haya 2 opciones o 100.
 * El filtrado de opciones es puro y testeado (filtro-productos.ts#filtrarOpciones).
 */
export function SelectBuscable({
  label,
  icon: Icon,
  opciones,
  valor,
  onCambiar,
  etiquetaVacia,
  placeholderBusqueda,
  abierto,
  onCambiarAbierto,
  autoFocusBusqueda = true,
  flotante = false,
}: SelectBuscableProps): JSX.Element {
  const [busqueda, setBusqueda] = useState('');
  const visibles = filtrarOpciones(opciones, busqueda);

  function elegir(v: string | null): void {
    onCambiar(v);
    setBusqueda('');
    onCambiarAbierto(false);
  }

  return (
    <View style={[styles.campo, flotante && styles.campoFlotante, flotante && abierto && styles.campoElevado]}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={[styles.control, abierto && styles.controlAbierto]}
        onPress={() => onCambiarAbierto(!abierto)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: abierto }}
      >
        {Icon ? <Icon size={18} color={colors.gris} /> : null}
        <Text style={[styles.valor, valor === null && styles.valorVacio]} numberOfLines={1} ellipsizeMode="tail">
          {valor ?? etiquetaVacia}
        </Text>
        {valor !== null ? (
          <Pressable hitSlop={8} onPress={() => onCambiar(null)} accessibilityLabel={`Quitar el filtro de ${label}`}>
            <X size={16} color={colors.gris} />
          </Pressable>
        ) : (
          <ChevronDown size={18} color={colors.rojo} />
        )}
      </Pressable>

      {abierto ? (
        <View style={[styles.desplegado, flotante && styles.desplegadoFlotante]}>
          <View style={styles.buscador}>
            <Search size={15} color={colors.grisClaro} />
            <TextInput
              style={styles.buscadorInput}
              value={busqueda}
              onChangeText={setBusqueda}
              placeholder={placeholderBusqueda}
              placeholderTextColor={colors.grisClaro}
              autoFocus={autoFocusBusqueda}
            />
          </View>
          <ScrollView
            style={styles.lista}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Pressable style={styles.opcion} onPress={() => elegir(null)}>
              <Text style={[styles.opcionTexto, valor === null && styles.opcionElegida]}>{etiquetaVacia}</Text>
              {valor === null ? <Check size={16} color={colors.rojo} /> : null}
            </Pressable>
            {visibles.map((op) => {
              const elegida = op === valor;
              return (
                <Pressable key={op} style={styles.opcion} onPress={() => elegir(op)}>
                  <Text style={[styles.opcionTexto, elegida && styles.opcionElegida]} numberOfLines={1} ellipsizeMode="tail">
                    {op}
                  </Text>
                  {elegida ? <Check size={16} color={colors.rojo} /> : null}
                </Pressable>
              );
            })}
            {visibles.length === 0 ? (
              <Text style={styles.sinResultados}>Nada coincide con “{busqueda.trim()}”.</Text>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  campo: { gap: 6 },
  campoFlotante: { position: 'relative' },
  // Elevado SOLO mientras está abierto: sin esto, el siguiente campo de la
  // lista (que pinta DESPUÉS en el orden de hermanos) taparía la lista
  // flotante de este en vez de quedar debajo suyo.
  campoElevado: { zIndex: 30 },
  label: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.semibold },
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: 13,
    backgroundColor: colors.campo,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
  },
  controlAbierto: { borderColor: colors.rojo },
  valor: { flex: 1, fontSize: fontSize.sm + 1, color: colors.tinta, fontFamily: fonts.regular },
  valorVacio: { color: colors.grisClaro },
  desplegado: {
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
    backgroundColor: colors.campo,
    overflow: 'hidden',
  },
  // Mismo patrón que Select.tsx: cuelga fuera del flujo, sobre lo que
  // sigue abajo, en vez de empujarlo (pedido del cliente 2026-09-09).
  desplegadoFlotante: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: spacing.xs,
    zIndex: 30,
    ...shadow.modal,
  },
  buscador: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    minHeight: 42,
    borderBottomWidth: 1,
    borderBottomColor: colors.borde,
  },
  buscadorInput: { flex: 1, fontSize: 14, color: colors.tinta, fontFamily: fonts.regular, padding: 0 },
  // Altura tope + scroll propio: lo que hace que el modal NO crezca con 100
  // opciones (2 categorías o 100, la caja mide lo mismo).
  lista: { maxHeight: 176 },
  opcion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#F0ECE9',
  },
  opcionTexto: { flex: 1, fontSize: 14.5, color: colors.tinta, fontFamily: fonts.regular },
  opcionElegida: { color: colors.rojo, fontFamily: fonts.semibold },
  sinResultados: { padding: 13, fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
});
