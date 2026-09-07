import { Barcode, Package, Tag, X } from 'lucide-react-native';
import { useEffect, useState, type JSX } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  categoriasDeHoja,
  codigosDeHoja,
  contarFiltrosActivos,
  FILTRO_VACIO,
  nombresDeHoja,
  type FiltroProductos,
} from '../../lib/dominio/filtro-productos';
import type { Producto } from '../../lib/dominio/tipos';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';
import { SelectBuscable } from './SelectBuscable';

export interface ModalFiltrosProductosProps {
  visible: boolean;
  productos: readonly Producto[];
  /** El filtro YA aplicado — con esto se inicializa el borrador al abrir. */
  filtro: FiltroProductos;
  onAplicar: (filtro: FiltroProductos) => void;
  onCerrar: () => void;
}

type CampoAbierto = 'categoria' | 'nombre' | 'codigo' | null;

/**
 * Modal de filtros de la lista de Contar: tres campos combinables —categoría,
 * nombre y código—, cada uno un `SelectBuscable`. Trabaja sobre un BORRADOR:
 * los cambios no tocan la lista hasta "Aplicar", y cerrar sin aplicar (X o
 * fondo) los descarta. "Limpiar todo" deja los tres en blanco de un toque.
 * Un solo campo abierto a la vez, para que la caja no se estire.
 *
 * La lógica de filtrado vive en `lib/dominio/filtro-productos.ts` (pura,
 * testeada); acá solo se arma el borrador y se elige cuándo aplicarlo.
 */
export function ModalFiltrosProductos({ visible, productos, filtro, onAplicar, onCerrar }: ModalFiltrosProductosProps): JSX.Element {
  const [borrador, setBorrador] = useState<FiltroProductos>(filtro);
  const [campoAbierto, setCampoAbierto] = useState<CampoAbierto>(null);

  // Al abrir, el borrador arranca del filtro YA aplicado (no de lo que quedó
  // de una edición anterior que se canceló con la X).
  useEffect(() => {
    if (visible) {
      setBorrador(filtro);
      setCampoAbierto(null);
    }
  }, [visible, filtro]);

  const activos = contarFiltrosActivos(borrador);

  function abrir(campo: Exclude<CampoAbierto, null>, abierto: boolean): void {
    setCampoAbierto(abierto ? campo : null);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCerrar}>
      <Pressable style={styles.fondo} onPress={onCerrar} accessibilityLabel="Cerrar los filtros" />
      <View pointerEvents="box-none" style={styles.centrado}>
        <View style={[styles.caja, shadow.modal]}>
          <View style={styles.cabecera}>
            <Text style={styles.titulo}>Filtrar productos</Text>
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
              label="Categoría"
              icon={Tag}
              opciones={categoriasDeHoja(productos)}
              valor={borrador.categoria}
              onCambiar={(v) => setBorrador((b) => ({ ...b, categoria: v }))}
              etiquetaVacia="Todas las categorías"
              placeholderBusqueda="Buscar categoría..."
              abierto={campoAbierto === 'categoria'}
              onCambiarAbierto={(a) => abrir('categoria', a)}
            />
            <SelectBuscable
              label="Nombre de producto"
              icon={Package}
              opciones={nombresDeHoja(productos)}
              valor={borrador.nombre}
              onCambiar={(v) => setBorrador((b) => ({ ...b, nombre: v }))}
              etiquetaVacia="Cualquier nombre"
              placeholderBusqueda="Buscar nombre..."
              abierto={campoAbierto === 'nombre'}
              onCambiarAbierto={(a) => abrir('nombre', a)}
            />
            <SelectBuscable
              label="Código de producto"
              icon={Barcode}
              opciones={codigosDeHoja(productos)}
              valor={borrador.codigo}
              onCambiar={(v) => setBorrador((b) => ({ ...b, codigo: v }))}
              etiquetaVacia="Cualquier código"
              placeholderBusqueda="Buscar código..."
              abierto={campoAbierto === 'codigo'}
              onCambiarAbierto={(a) => abrir('codigo', a)}
            />
          </ScrollView>

          <View style={styles.acciones}>
            <Pressable
              style={[styles.boton, styles.botonSecundario]}
              onPress={() => setBorrador(FILTRO_VACIO)}
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
  // flexShrink: que el cuerpo ceda y scrollee cuando no entra, en vez de
  // empujar los botones fuera de la caja.
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
