import { Barcode, ClipboardList, Layers, Package, Tag, X } from 'lucide-react-native';
import { useEffect, useState, type JSX } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  contarFiltrosActivos,
  elegirCampo,
  ETIQUETA_CUADRO,
  FILTRO_MATRIZ_VACIO,
  opcionesEnCascada,
  type CuadroFiltro,
  type FiltroMatriz,
} from '../../lib/dominio/filtro-matriz';
import type { ItemAuditoria, VeredictoAuditoria } from '../../lib/dominio/tipos';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';
import { SelectBuscable } from './SelectBuscable';

export interface ModalFiltrosMatrizProps {
  visible: boolean;
  items: readonly ItemAuditoria[];
  /** El veredicto ya calculado por la pantalla — ver `aplicarFiltroMatriz`. */
  veredictoPorId: ReadonlyMap<number, VeredictoAuditoria>;
  /** El filtro YA aplicado — con esto se inicializa el borrador al abrir. */
  filtro: FiltroMatriz;
  onAplicar: (filtro: FiltroMatriz) => void;
  onCerrar: () => void;
}

type CampoAbierto = keyof FiltroMatriz | null;

/**
 * Modal de filtros de la MATRIZ de auditoría: cinco campos combinables —hoja,
 * cuadro, categoría, descripción y código—, cada uno un `SelectBuscable` con
 * `flotante` (su lista cuelga sobre lo de abajo, no lo empuja).
 *
 * ES EL GEMELO de `ModalFiltrosProductos` y se calcó a propósito: el Auditor y
 * el Contador usan el MISMO control, así que aprender uno es aprender el otro.
 * Trabaja sobre un BORRADOR —los cambios no tocan la lista hasta "Aplicar", y
 * cerrar sin aplicar (X o fondo) los descarta—, "Limpiar todo" deja los cinco
 * en blanco de un toque, y hay un solo campo abierto a la vez para que dos
 * listas flotantes no se pisen.
 *
 * POR QUÉ NO SE REUSÓ el de productos: aquel opera sobre `Producto[]` de UNA
 * hoja; éste sobre `ItemAuditoria[]` de TODAS, con el veredicto y el reparto
 * del servidor. Unificarlos obligaría a uno a fingir los campos del otro.
 *
 * La lógica vive en `lib/dominio/filtro-matriz.ts` (pura, testeada); acá solo
 * se arma el borrador y se elige cuándo aplicarlo.
 */
export function ModalFiltrosMatriz({
  visible,
  items,
  veredictoPorId,
  filtro,
  onAplicar,
  onCerrar,
}: ModalFiltrosMatrizProps): JSX.Element {
  const [borrador, setBorrador] = useState<FiltroMatriz>(filtro);
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
  const opciones = opcionesEnCascada(items, borrador, veredictoPorId);

  function abrir(campo: Exclude<CampoAbierto, null>, abierto: boolean): void {
    setCampoAbierto(abierto ? campo : null);
  }

  function cambiar(campo: keyof FiltroMatriz, valor: string | null): void {
    setBorrador((b) => elegirCampo(items, b, campo, valor, veredictoPorId));
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCerrar}>
      <Pressable style={styles.fondo} onPress={onCerrar} accessibilityLabel="Cerrar los filtros" />
      <View pointerEvents="box-none" style={styles.centrado}>
        <View style={[styles.caja, shadow.modal]}>
          <View style={styles.cabecera}>
            <Text style={styles.titulo}>Filtrar la matriz</Text>
            <Pressable onPress={onCerrar} style={styles.cerrar} accessibilityLabel="Cerrar los filtros">
              <X size={19} color={colors.gris} />
            </Pressable>
          </View>

          {/* View simple, no ScrollView: con la lista FLOTANDO ningún campo
              abierto estira este contenedor, así que no hace falta el scroll
              propio que un acordeón necesitaría. De paso evita que Android
              recorte la lista flotante contra los bordes de un ScrollView. */}
          <View style={styles.cuerpo}>
            {/* LA HOJA PRIMERO: es lo que se pidió agregar, y es el corte más
                grueso -- 20 hojas sobre 980 ítems. Elegirla acota todo lo
                demás por la cascada. */}
            <SelectBuscable
              label="Hoja"
              icon={ClipboardList}
              opciones={opciones.hoja}
              valor={borrador.hoja}
              onCambiar={(v) => cambiar('hoja', v)}
              etiquetaVacia="Todas las hojas"
              placeholderBusqueda="Buscar hoja..."
              abierto={campoAbierto === 'hoja'}
              onCambiarAbierto={(a) => abrir('hoja', a)}
              autoFocusBusqueda={false}
              flotante
            />
            {/* El eje que antes eran los chips. Se muestran las ETIQUETAS y se
                guarda el id: "Al personal" es lo que la persona reconoce, y
                `personal` lo que entiende el dominio. */}
            <SelectBuscable
              label="En qué cuadro cayó"
              icon={Layers}
              opciones={opciones.cuadro.map((c) => ETIQUETA_CUADRO[c])}
              valor={borrador.cuadro === null ? null : ETIQUETA_CUADRO[borrador.cuadro]}
              onCambiar={(etiqueta) =>
                cambiar(
                  'cuadro',
                  etiqueta === null
                    ? null
                    : (opciones.cuadro.find((c) => ETIQUETA_CUADRO[c] === etiqueta) as CuadroFiltro | undefined) ?? null,
                )
              }
              etiquetaVacia="Todos los cuadros"
              placeholderBusqueda="Buscar cuadro..."
              abierto={campoAbierto === 'cuadro'}
              onCambiarAbierto={(a) => abrir('cuadro', a)}
              autoFocusBusqueda={false}
              flotante
            />
            <SelectBuscable
              label="Categoría"
              icon={Tag}
              opciones={opciones.categoria}
              valor={borrador.categoria}
              onCambiar={(v) => cambiar('categoria', v)}
              etiquetaVacia="Todas las categorías"
              placeholderBusqueda="Buscar categoría..."
              abierto={campoAbierto === 'categoria'}
              onCambiarAbierto={(a) => abrir('categoria', a)}
              autoFocusBusqueda={false}
              flotante
            />
            <SelectBuscable
              label="Descripción"
              icon={Package}
              opciones={opciones.descripcion}
              valor={borrador.descripcion}
              onCambiar={(v) => cambiar('descripcion', v)}
              etiquetaVacia="Cualquier descripción"
              placeholderBusqueda="Buscar descripción..."
              abierto={campoAbierto === 'descripcion'}
              onCambiarAbierto={(a) => abrir('descripcion', a)}
              autoFocusBusqueda={false}
              flotante
            />
            <SelectBuscable
              label="Código"
              icon={Barcode}
              opciones={opciones.codigo}
              valor={borrador.codigo}
              onCambiar={(v) => cambiar('codigo', v)}
              etiquetaVacia="Cualquier código"
              placeholderBusqueda="Buscar código..."
              abierto={campoAbierto === 'codigo'}
              onCambiarAbierto={(a) => abrir('codigo', a)}
              autoFocusBusqueda={false}
              flotante
            />
          </View>

          <View style={styles.acciones}>
            <Pressable
              style={[styles.boton, styles.botonSecundario]}
              onPress={() => setBorrador(FILTRO_MATRIZ_VACIO)}
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
  // Mismo margen y ancho que `ModalFiltrosProductos`: son el mismo control en
  // dos pantallas, y una diferencia de 2px se lee como un descuido.
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
  acciones: { flexDirection: 'row', gap: 10 },
  boton: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  botonPrimario: { backgroundColor: colors.rojo },
  botonPrimarioTexto: { fontSize: 15, color: colors.blanco, fontFamily: fonts.bold },
  botonSecundario: { backgroundColor: colors.campo, borderWidth: 1, borderColor: colors.borde },
  botonSecundarioTexto: { fontSize: 15, color: colors.tinta, fontFamily: fonts.bold },
  botonTextoInerte: { color: colors.grisClaro },
});
