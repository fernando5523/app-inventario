import { Hash, ListChecks, Users, X } from 'lucide-react-native';
import { useEffect, useState, type JSX } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  contarFiltrosActivosModal,
  elegirCampo,
  ETIQUETA_FILTRO,
  FILTRO_HOJAS_MODAL_VACIO,
  FILTROS_HOJAS,
  opcionesEnCascada,
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

function estadoDeEtiqueta(etiqueta: string | null): FiltroHojas {
  const encontrado = FILTROS_HOJAS.find((f) => ETIQUETA_FILTRO[f] === etiqueta);
  return encontrado ?? 'todas';
}

/**
 * Modal de filtros de "Hojas de esta ronda" (Coordinador): mismo patrón que
 * `ModalFiltrosProductos.tsx` (Contar) -- un `SelectBuscable` por campo, un
 * BORRADOR que no toca la lista hasta "Aplicar", un solo campo abierto a la
 * vez, los tres EN CASCADA (af4810f: elegir un campo recorta los otros dos
 * a lo que sigue siendo posible, y limpia cualquiera que dejó de tener
 * sentido), `flotante` (la lista cuelga sobre lo de abajo, no lo empuja) y
 * SIN autofoco en la búsqueda -- pedido del cliente 2026-09-09: "todos los
 * filtros con el diseño de Contar siguen las mismas reglas". Es un
 * componente HERMANO, no una edición de aquel: los criterios acá son de
 * HOJA (persona/estado/número), no de producto, y así el modal de Contar
 * no se toca ni un poco.
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
  const opciones = opcionesEnCascada(hojas, borrador);
  // 'todas' no es una opción del select de estado -- ES el "sin filtro" que
  // ya resuelve `etiquetaVacia`. Ofrecerla dos veces (el hueco Y una opción
  // que dice lo mismo) es la clase de duplicado que confunde cuál de las
  // dos usar.
  const etiquetasEstado = opciones.estado.map((f) => ETIQUETA_FILTRO[f]);

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

          {/* View simple, no ScrollView: con la lista FLOTANDO (`flotante`)
              ningún campo abierto estira este contenedor -- ya no hace
              falta el scroll propio que el acordeón de antes necesitaba
              para no reventar la caja. De paso evita que Android recorte
              la lista flotante contra los bordes de un ScrollView. */}
          <View style={styles.cuerpo}>
            <SelectBuscable
              label="Persona asignada"
              icon={Users}
              opciones={opciones.persona}
              valor={borrador.persona}
              onCambiar={(v) => setBorrador((b) => elegirCampo(hojas, b, 'persona', v))}
              etiquetaVacia="Cualquier persona"
              placeholderBusqueda="Buscar persona..."
              abierto={campoAbierto === 'persona'}
              onCambiarAbierto={(a) => abrir('persona', a)}
              autoFocusBusqueda={false}
              flotante
            />
            <SelectBuscable
              label="Estado"
              icon={ListChecks}
              opciones={etiquetasEstado}
              valor={borrador.estado === 'todas' ? null : ETIQUETA_FILTRO[borrador.estado]}
              onCambiar={(v) => setBorrador((b) => elegirCampo(hojas, b, 'estado', estadoDeEtiqueta(v)))}
              etiquetaVacia="Cualquier estado"
              placeholderBusqueda="Buscar estado..."
              abierto={campoAbierto === 'estado'}
              onCambiarAbierto={(a) => abrir('estado', a)}
              autoFocusBusqueda={false}
              flotante
            />
            <SelectBuscable
              label="Número de hoja"
              icon={Hash}
              opciones={opciones.numero}
              valor={borrador.numero}
              onCambiar={(v) => setBorrador((b) => elegirCampo(hojas, b, 'numero', v))}
              etiquetaVacia="Cualquier número"
              placeholderBusqueda="Buscar número..."
              abierto={campoAbierto === 'numero'}
              onCambiarAbierto={(a) => abrir('numero', a)}
              autoFocusBusqueda={false}
              flotante
            />
          </View>

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
  // Margen lateral acotado (14, igual que ModalFiltrosProductos.tsx) --
  // pedido del cliente 2026-09-09: incluso mismas reglas que Contar.
  centrado: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: spacing.xl },
  caja: {
    width: '100%',
    // Antes 340 -- mismo motivo y mismo valor que ModalFiltrosProductos.tsx.
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
  acciones: { flexDirection: 'row', gap: 10 },
  boton: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  botonPrimario: { backgroundColor: colors.rojo },
  botonPrimarioTexto: { fontSize: 15, color: colors.blanco, fontFamily: fonts.bold },
  botonSecundario: { backgroundColor: colors.campo, borderWidth: 1, borderColor: colors.borde },
  botonSecundarioTexto: { fontSize: 15, color: colors.tinta, fontFamily: fonts.bold },
  botonTextoInerte: { color: colors.grisClaro },
});
