import { CalendarDays, ListChecks, Search, Store, X } from 'lucide-react-native';
import { useEffect, useState, type JSX } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  FILTRO_HISTORIAL_VACIO,
  contarFiltrosHistorial,
  estadoDeEtiqueta,
  etiquetasEstado,
  etiquetasPeriodo,
  periodoDeEtiqueta,
  type FiltroHistorial,
  PERIODOS,
  FILTROS_ESTADO,
} from '../../lib/aprobacion/presentacion';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';
import { CampoTexto, SelectBuscable } from '../ui';

export interface ModalFiltrosHistorialProps {
  visible: boolean;
  /** Los almacenes del resultado cargado: las opciones salen del conjunto abierto, no de un catálogo. */
  almacenes: ReadonlyArray<{ id: string; nombre: string }>;
  /** El filtro YA aplicado — con esto se inicializa el borrador al abrir. */
  filtro: FiltroHistorial;
  onAplicar: (filtro: FiltroHistorial) => void;
  onCerrar: () => void;
}

type CampoAbierto = 'periodo' | 'estado' | 'almacen' | null;

/**
 * Filtros del Historial de la aprobadora. MISMO patrón que `ModalFiltrosHojas`
 * (components/ui): un borrador que arranca del filtro aplicado, selects
 * buscables flotantes (`SelectBuscable`, el componente compartido), "Limpiar
 * todo" y "Aplicar (n)". Nada se aplica hasta tocar "Aplicar": cerrar con la
 * ✕ o tocando afuera descarta lo editado.
 *
 * El almacén se muestra como "Nombre · CODIGO" y se guarda por código.
 */
export function ModalFiltrosHistorial({ visible, almacenes, filtro, onAplicar, onCerrar }: ModalFiltrosHistorialProps): JSX.Element {
  const [borrador, setBorrador] = useState<FiltroHistorial>(filtro);
  const [campoAbierto, setCampoAbierto] = useState<CampoAbierto>(null);

  useEffect(() => {
    if (visible) {
      setBorrador(filtro);
      setCampoAbierto(null);
    }
  }, [visible, filtro]);

  const activos = contarFiltrosHistorial(borrador);
  const etiquetaAlmacen = (id: string): string => {
    const a = almacenes.find((x) => x.id === id);
    return a ? `${a.nombre} · ${a.id}` : id;
  };
  const opcionesAlmacen = almacenes.map((a) => etiquetaAlmacen(a.id));

  function abrir(campo: Exclude<CampoAbierto, null>, abierto: boolean): void {
    setCampoAbierto(abierto ? campo : null);
  }

  const periodoEtiqueta = PERIODOS.find((p) => p.id === borrador.periodo)?.etiqueta ?? null;
  const estadoEtiqueta = borrador.estado === 'todas' ? null : (FILTROS_ESTADO.find((e) => e.id === borrador.estado)?.etiqueta ?? null);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCerrar}>
      <Pressable style={styles.fondo} onPress={onCerrar} accessibilityLabel="Cerrar los filtros" />
      {/* A diferencia de los modales de filtros del inventario, este tiene un
          campo de texto: sin esto el teclado tapa "Buscar" y los botones. */}
      <KeyboardAvoidingView behavior="padding" pointerEvents="box-none" style={styles.teclado}>
      <View pointerEvents="box-none" style={styles.centrado}>
        <View style={[styles.caja, shadow.modal]}>
          <View style={styles.cabecera}>
            <Text style={styles.titulo}>Filtrar el historial</Text>
            <Pressable onPress={onCerrar} style={styles.cerrar} accessibilityLabel="Cerrar los filtros">
              <X size={19} color={colors.gris} />
            </Pressable>
          </View>

          <View style={styles.cuerpo}>
            <SelectBuscable
              label="Periodo"
              icon={CalendarDays}
              // "Este mes" es el valor de partida y ya lo dice `etiquetaVacia`:
              // ofrecerlo dos veces es el duplicado que ModalFiltrosHojas evita con 'todas'.
              opciones={etiquetasPeriodo().filter((e) => e !== 'Este mes')}
              valor={borrador.periodo === FILTRO_HISTORIAL_VACIO.periodo ? null : periodoEtiqueta}
              onCambiar={(v) => setBorrador((b) => ({ ...b, periodo: periodoDeEtiqueta(v) }))}
              etiquetaVacia="Este mes"
              placeholderBusqueda="Buscar periodo..."
              abierto={campoAbierto === 'periodo'}
              onCambiarAbierto={(a) => abrir('periodo', a)}
              autoFocusBusqueda={false}
              flotante
            />
            <SelectBuscable
              label="Estado"
              icon={ListChecks}
              opciones={etiquetasEstado()}
              valor={estadoEtiqueta}
              onCambiar={(v) => setBorrador((b) => ({ ...b, estado: estadoDeEtiqueta(v) }))}
              etiquetaVacia="Cualquier estado"
              placeholderBusqueda="Buscar estado..."
              abierto={campoAbierto === 'estado'}
              onCambiarAbierto={(a) => abrir('estado', a)}
              autoFocusBusqueda={false}
              flotante
            />
            <SelectBuscable
              label="Almacén"
              icon={Store}
              opciones={opcionesAlmacen}
              valor={borrador.almacen === null ? null : etiquetaAlmacen(borrador.almacen)}
              onCambiar={(v) => setBorrador((b) => ({ ...b, almacen: almacenes.find((a) => etiquetaAlmacen(a.id) === v)?.id ?? null }))}
              etiquetaVacia="Todos los almacenes"
              placeholderBusqueda="Buscar almacén..."
              abierto={campoAbierto === 'almacen'}
              onCambiarAbierto={(a) => abrir('almacen', a)}
              autoFocusBusqueda={false}
              flotante
            />
            <CampoTexto
              label="Buscar"
              icon={Search}
              valor={borrador.texto}
              onCambiar={(t) => setBorrador((b) => ({ ...b, texto: t }))}
              placeholder="Número, tienda, motivo o persona"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.acciones}>
            <Pressable
              style={[styles.boton, styles.botonSecundario]}
              onPress={() => setBorrador(FILTRO_HISTORIAL_VACIO)}
              disabled={activos === 0}
              accessibilityLabel="Limpiar todos los filtros"
            >
              <Text style={[styles.botonSecundarioTexto, activos === 0 && styles.botonTextoInerte]}>Limpiar todo</Text>
            </Pressable>
            <Pressable style={[styles.boton, styles.botonPrimario]} onPress={() => onAplicar(borrador)} accessibilityLabel="Aplicar los filtros">
              <Text style={styles.botonPrimarioTexto}>{activos > 0 ? `Aplicar (${activos})` : 'Aplicar'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Los mismos estilos que ModalFiltrosHojas/ModalFiltrosProductos: margen
// lateral 14, ancho máximo 480, botones de 50 de alto.
const styles = StyleSheet.create({
  fondo: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  teclado: { flex: 1 },
  centrado: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: spacing.xl },
  caja: {
    width: '100%',
    maxWidth: 480,
    // Sin el tope de alto de los otros modales de filtros: con el teclado
    // abierto, el 82% del alto que queda corta los botones por debajo de la caja.
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
