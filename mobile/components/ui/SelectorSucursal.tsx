import { Building2, ChevronDown, X } from 'lucide-react-native';
import { useState, type JSX } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { idDeSucursal, nombreDeSucursal, nombresSucursalesOrdenados } from '../../lib/dominio/selector-sucursal';
import type { Sucursal } from '../../lib/dominio/tipos';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';
import { SelectBuscable } from './SelectBuscable';

export interface SelectorSucursalProps {
  /** Rótulo del campo -- "Sucursal a auditar" en la mayoría, "Sucursal" en Comparativo. */
  label: string;
  sucursales: readonly Sucursal[];
  /** El id de la sucursal enfocada (la elegida, o la de la ficha como default), o `null`. */
  sucursalId: number | null;
  onElegir: (id: number) => void;
}

/**
 * El selector de sucursal del Auditor, con el MISMO diseño de filtro en modal
 * que Contar y Gestión de hojas (ModalFiltrosProductos / ModalFiltrosHojas):
 * un campo que muestra la sucursal elegida y abre un modal con búsqueda tipo
 * select2 (SelectBuscable). Reemplaza a los chips en fila, que se cortaban en
 * el borde con 10 tiendas ("Ma...").
 *
 * Compartido por las 4 pantallas que lo renderizan (Panel de Auditoría, Ciclo,
 * Historial, Comparativo). La sucursal elegida vive en el contexto compartido
 * (sucursal-auditada-contexto.tsx): cada pantalla pasa su `onElegir`, así que
 * elegir en una la deja elegida en las demás.
 *
 * SIN opción "todas" (permitirVacio=false en SelectBuscable): una pantalla de
 * auditoría mira UN inventario de UNA sucursal, y Comparativo exige una tienda
 * -- nunca "todas".
 */
export function SelectorSucursal({ label, sucursales, sucursalId, onElegir }: SelectorSucursalProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  // El SelectBuscable arranca ABIERTO al abrir el modal: es el único campo, no
  // tiene sentido pedir un toque extra para desplegar la búsqueda.
  const [abierto, setAbierto] = useState(true);

  const nombre = nombreDeSucursal(sucursales, sucursalId);
  const opciones = nombresSucursalesOrdenados(sucursales);

  function abrir(): void {
    setAbierto(true);
    setVisible(true);
  }

  function elegir(nombreElegido: string | null): void {
    if (nombreElegido !== null) {
      const id = idDeSucursal(sucursales, nombreElegido);
      if (id !== null) onElegir(id);
    }
    setVisible(false);
  }

  return (
    <View style={styles.bloque}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={styles.control}
        onPress={abrir}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: visible }}
      >
        <Building2 size={18} color={colors.gris} />
        <Text style={[styles.valor, nombre === null && styles.valorVacio]} numberOfLines={1} ellipsizeMode="tail">
          {nombre ?? 'Elegir sucursal'}
        </Text>
        <ChevronDown size={18} color={colors.rojo} />
      </Pressable>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.fondo} onPress={() => setVisible(false)} accessibilityLabel="Cerrar" />
        <View pointerEvents="box-none" style={styles.centrado}>
          <View style={[styles.caja, shadow.modal]}>
            <View style={styles.cabecera}>
              <Text style={styles.titulo}>{label}</Text>
              <Pressable onPress={() => setVisible(false)} style={styles.cerrar} accessibilityLabel="Cerrar">
                <X size={19} color={colors.gris} />
              </Pressable>
            </View>
            <View style={styles.cuerpo}>
              <SelectBuscable
                label="Sucursal"
                icon={Building2}
                opciones={opciones}
                valor={nombre}
                onCambiar={elegir}
                etiquetaVacia="Elegir sucursal"
                placeholderBusqueda="Buscar sucursal..."
                abierto={abierto}
                onCambiarAbierto={setAbierto}
                autoFocusBusqueda={false}
                permitirVacio={false}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  bloque: { gap: 6 },
  label: { fontSize: 11, letterSpacing: 0.5, color: colors.gris, fontFamily: fonts.semibold },
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
  valor: { flex: 1, fontSize: fontSize.sm + 1, color: colors.tinta, fontFamily: fonts.regular },
  valorVacio: { color: colors.grisClaro },

  // Mismo modal que ModalFiltrosProductos: fondo tenue, caja centrada y ancha.
  fondo: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  centrado: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: spacing.xl },
  caja: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '82%',
    gap: spacing.md,
    padding: 17,
    backgroundColor: colors.campo,
    borderRadius: radius.xl,
  },
  cabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  titulo: { fontSize: fontSize.base, color: colors.tinta, fontFamily: fonts.bold },
  cerrar: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  cuerpo: { gap: 14 },
});
