import { Check, X } from 'lucide-react-native';
import { useEffect, useState, type JSX } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';

export interface TiendaSeleccionable {
  id: number;
  nombre: string;
}

export interface ModalExportarConsolidadoProps {
  visible: boolean;
  /** El conjunto REAL de tiendas que el actor puede ver -- nunca se inventan opciones. */
  tiendas: readonly TiendaSeleccionable[];
  exportando: boolean;
  /** `undefined` = sin selección puntual, "todas las de arriba". */
  onExportar: (sucursalIds: number[] | undefined) => void;
  onCerrar: () => void;
}

/**
 * Selector de tiendas para el consolidado -- pedido del cliente 2026-09-09:
 * una tienda, varias, o todas. Es un componente HERMANO de
 * `ModalFiltrosHojas.tsx`/`ModalFiltrosProductos.tsx`, no una edición de
 * ninguno de los dos: acá el control es un CHECKLIST de selección múltiple
 * (una lista chica y cerrada de tiendas reales, sin necesidad de buscador),
 * no un `SelectBuscable` de un solo valor -- por eso no hay desplegable
 * flotante que mostrar. Sí comparte con ellos el resto de las reglas de
 * diseño: orden ascendente (alfabético en español) y opciones acotadas al
 * conjunto real de tiendas que el actor puede ver (nunca una lista inventada).
 *
 * SOLO lo usa el Auditor (ver HistorialScreen.tsx -- dueño de la función
 * desde que el cliente lo definió, 2026-09-09). Con `tiendas={[]}` (que es
 * como el Auditor SIEMPRE lo recibe: el backend lo recorta a su propia
 * sucursal pida lo que pida) el checklist NO se muestra -- degrada a un
 * confirmar simple, para no ofrecer un selector sin ningún efecto real.
 */
export function ModalExportarConsolidado({ visible, tiendas, exportando, onExportar, onCerrar }: ModalExportarConsolidadoProps): JSX.Element {
  const [seleccionadas, setSeleccionadas] = useState<Set<number>>(new Set());

  // Al abrir, arranca sin nada tildado -- "todas" es el default explícito,
  // nunca la última selección de una apertura anterior que ya no aplica.
  useEffect(() => {
    if (visible) setSeleccionadas(new Set());
  }, [visible]);

  const ordenadas = [...tiendas].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const todasSeleccionadas = seleccionadas.size === 0;
  // Sin tiendas para elegir (caso del Auditor): el checklist no tiene nada
  // que ofrecer, así que se saca del medio en vez de mostrar una lista vacía.
  const sinSelector = tiendas.length === 0;

  function alternar(id: number): void {
    setSeleccionadas((previas) => {
      const siguiente = new Set(previas);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCerrar}>
      <Pressable style={styles.fondo} onPress={onCerrar} accessibilityLabel="Cerrar" />
      <View pointerEvents="box-none" style={styles.centrado}>
        <View style={[styles.caja, shadow.modal]}>
          <View style={styles.cabecera}>
            <Text style={styles.titulo}>Exportar consolidado</Text>
            <Pressable onPress={onCerrar} style={styles.cerrar} accessibilityLabel="Cerrar">
              <X size={19} color={colors.gris} />
            </Pressable>
          </View>

          <Text style={styles.ayuda}>
            {sinSelector
              ? 'Se exporta el período elegido de tu tienda.'
              : todasSeleccionadas
                ? 'Sin ninguna marcada: se exportan TODAS las tiendas.'
                : `${seleccionadas.size} tienda${seleccionadas.size === 1 ? '' : 's'} marcada${seleccionadas.size === 1 ? '' : 's'}.`}
          </Text>

          {sinSelector ? null : (
            <ScrollView style={styles.lista} nestedScrollEnabled>
              {ordenadas.map((tienda) => {
                const activa = seleccionadas.has(tienda.id);
                return (
                  <Pressable
                    key={tienda.id}
                    style={styles.fila}
                    onPress={() => alternar(tienda.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: activa }}
                  >
                    <View style={[styles.check, activa && styles.checkActivo]}>{activa ? <Check size={14} color={colors.blanco} /> : null}</View>
                    <Text style={styles.filaTexto} numberOfLines={1} ellipsizeMode="tail">
                      {tienda.nombre}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.acciones}>
            {sinSelector ? null : (
              <Pressable
                style={[styles.boton, styles.botonSecundario]}
                onPress={() => setSeleccionadas(new Set())}
                disabled={todasSeleccionadas}
                accessibilityLabel="Marcar todas las tiendas"
              >
                <Text style={[styles.botonSecundarioTexto, todasSeleccionadas && styles.botonTextoInerte]}>Todas</Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.boton, styles.botonPrimario]}
              onPress={() => onExportar(sinSelector || todasSeleccionadas ? undefined : [...seleccionadas])}
              disabled={exportando}
              accessibilityLabel="Exportar el consolidado"
            >
              <Text style={styles.botonPrimarioTexto}>{exportando ? 'Exportando…' : 'Exportar'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  ayuda: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
  lista: { flexGrow: 0 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.borde },
  check: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.borde,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkActivo: { backgroundColor: colors.rojo, borderColor: colors.rojo },
  filaTexto: { flex: 1, fontSize: 14.5, color: colors.tinta, fontFamily: fonts.regular },
  acciones: { flexDirection: 'row', gap: 10 },
  boton: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  botonPrimario: { backgroundColor: colors.rojo },
  botonPrimarioTexto: { fontSize: 15, color: colors.blanco, fontFamily: fonts.bold },
  botonSecundario: { backgroundColor: colors.campo, borderWidth: 1, borderColor: colors.borde },
  botonSecundarioTexto: { fontSize: 15, color: colors.tinta, fontFamily: fonts.bold },
  botonTextoInerte: { color: colors.grisClaro },
});
