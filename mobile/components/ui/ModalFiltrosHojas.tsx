import { Hash, ListChecks, Users, X } from 'lucide-react-native';
import { useEffect, useState, type JSX } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  contarFiltrosActivosModal,
  ETIQUETA_FILTRO,
  FILTRO_HOJAS_MODAL_VACIO,
  FILTROS_HOJAS,
  numerosDeHojas,
  personasDeHojas,
  type FiltroHojas,
  type FiltroHojasModal,
} from '../../lib/dominio/filtro-hojas';
import type { HojaConteo } from '../../lib/dominio/tipos';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';
import { SelectBuscable } from './SelectBuscable';

export interface ModalFiltrosHojasProps {
  visible: boolean;
  hojas: readonly HojaConteo[];
  /** El filtro YA aplicado — con esto se inicializa el borrador al abrir. */
  filtro: FiltroHojasModal;
  onAplicar: (filtro: FiltroHojasModal) => void;
  onCerrar: () => void;
}

type CampoAbierto = 'persona' | 'estado' | 'numero' | null;

// 'todas' no es una opción del select de estado -- ES el "sin filtro" que ya
// resuelve `etiquetaVacia`. Ofrecerla dos veces (el hueco Y una opción que
// dice lo mismo) es la clase de duplicado que confunde cuál de las dos usar.
const ETIQUETAS_ESTADO = FILTROS_HOJAS.filter((f): f is Exclude<FiltroHojas, 'todas'> => f !== 'todas').map(
  (f) => ETIQUETA_FILTRO[f],
);

function estadoDeEtiqueta(etiqueta: string | null): FiltroHojas {
  const encontrado = FILTROS_HOJAS.find((f) => ETIQUETA_FILTRO[f] === etiqueta);
  return encontrado ?? 'todas';
}

/**
 * Modal de filtros de "Hojas de esta ronda" (Coordinador): mismo patrón que
 * `ModalFiltrosProductos.tsx` (min-4) -- un `SelectBuscable` por campo, un
 * BORRADOR que no toca la lista hasta "Aplicar", un solo campo abierto a la
 * vez. Es un componente HERMANO, no una edición de aquel: los criterios acá
 * son de HOJA (persona/estado/número), no de producto, y así el modal de
 * Contar no se toca ni un poco.
 *
 * La lógica de filtrado vive en `lib/dominio/filtro-hojas.ts` (pura, testeada).
 */
export function ModalFiltrosHojas({ visible, hojas, filtro, onAplicar, onCerrar }: ModalFiltrosHojasProps): JSX.Element {
  const [borrador, setBorrador] = useState<FiltroHojasModal>(filtro);
  const [campoAbierto, setCampoAbierto] = useState<CampoAbierto>(null);

  // Al abrir, el borrador arranca del filtro YA aplicado (no de lo que quedó
  // de una edición anterior que se canceló con la X).
  useEffect(() => {
    if (visible) {
      setBorrador(filtro);
      setCampoAbierto(null);
    }
  }, [visible, filtro]);

  const activos = contarFiltrosActivosModal(borrador);

  function abrir(campo: Exclude<CampoAbierto, null>, abierto: boolean): void {
    setCampoAbierto(abierto ? campo : null);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCerrar}>
      <Pressable style={styles.fondo} onPress={onCerrar} accessibilityLabel="Cerrar los filtros" />
      <View pointerEvents="box-none" style={styles.centrado}>
        <View style={[styles.caja, shadow.modal]}>
          <View style={styles.cabecera}>
            <Text style={styles.titulo}>Filtrar hojas</Text>
            <Pressable onPress={onCerrar} style={styles.cerrar} accessibilityLabel="Cerrar los filtros">
              <X size={19} color={colors.gris} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.cuerpo}
            contentContainerStyle={styles.cuerpoContenido}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            <SelectBuscable
              label="Persona asignada"
              icon={Users}
              opciones={personasDeHojas(hojas)}
              valor={borrador.persona}
              onCambiar={(v) => setBorrador((b) => ({ ...b, persona: v }))}
              etiquetaVacia="Cualquier persona"
              placeholderBusqueda="Buscar persona..."
              abierto={campoAbierto === 'persona'}
              onCambiarAbierto={(a) => abrir('persona', a)}
            />
            <SelectBuscable
              label="Estado"
              icon={ListChecks}
              opciones={ETIQUETAS_ESTADO}
              valor={borrador.estado === 'todas' ? null : ETIQUETA_FILTRO[borrador.estado]}
              onCambiar={(v) => setBorrador((b) => ({ ...b, estado: estadoDeEtiqueta(v) }))}
              etiquetaVacia="Cualquier estado"
              placeholderBusqueda="Buscar estado..."
              abierto={campoAbierto === 'estado'}
              onCambiarAbierto={(a) => abrir('estado', a)}
            />
            <SelectBuscable
              label="Número de hoja"
              icon={Hash}
              opciones={numerosDeHojas(hojas)}
              valor={borrador.numero}
              onCambiar={(v) => setBorrador((b) => ({ ...b, numero: v }))}
              etiquetaVacia="Cualquier número"
              placeholderBusqueda="Buscar número..."
              abierto={campoAbierto === 'numero'}
              onCambiarAbierto={(a) => abrir('numero', a)}
            />
          </ScrollView>

          <View style={styles.acciones}>
            <Pressable
              style={[styles.boton, styles.botonSecundario]}
              onPress={() => setBorrador(FILTRO_HOJAS_MODAL_VACIO)}
              disabled={activos === 0}
              accessibilityLabel="Limpiar todos los filtros"
            >
              <Text style={[styles.botonSecundarioTexto, activos === 0 && styles.botonTextoInerte]}>Limpiar todo</Text>
            </Pressable>
            <Pressable
              style={[styles.boton, styles.botonPrimario]}
              onPress={() => onAplicar(borrador)}
              accessibilityLabel="Aplicar los filtros"
            >
              <Text style={styles.botonPrimarioTexto}>{activos > 0 ? `Aplicar (${activos})` : 'Aplicar'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  centrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  caja: {
    width: '100%',
    maxWidth: 340,
    maxHeight: '82%',
    gap: spacing.md,
    padding: 17,
    backgroundColor: colors.campo,
    borderRadius: radius.xl,
  },
  cabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  titulo: { fontSize: fontSize.base, color: colors.tinta, fontFamily: fonts.bold },
  cerrar: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  cuerpo: { flexShrink: 1 },
  cuerpoContenido: { gap: 14, paddingBottom: 2 },
  acciones: { flexDirection: 'row', gap: 10 },
  boton: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  botonPrimario: { backgroundColor: colors.rojo },
  botonPrimarioTexto: { fontSize: 15, color: colors.blanco, fontFamily: fonts.bold },
  botonSecundario: { backgroundColor: colors.campo, borderWidth: 1, borderColor: colors.borde },
  botonSecundarioTexto: { fontSize: 15, color: colors.tinta, fontFamily: fonts.bold },
  botonTextoInerte: { color: colors.grisClaro },
});
