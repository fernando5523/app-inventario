import { ScanLine, X } from 'lucide-react-native';
import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Producto } from '../../lib/dominio/tipos';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';

export interface OpcionEscaneo {
  etiqueta: string;
  codigo: string;
}

export interface ModalEscanerProps {
  visible: boolean;
  /** Productos reales de la hoja para simular una lectura — nunca códigos inventados de otro lado. */
  opciones: OpcionEscaneo[];
  /** Mensaje de error cuando el código simulado no pertenece a la hoja. null = sin error. */
  error: string | null;
  onEscanear: (codigo: string) => void;
  onCerrar: () => void;
}

/**
 * Simulador de escáner — la cámara real (expo-camera) todavía no se
 * conecta acá a propósito: primero se valida el flujo completo (confirma,
 * no cuenta) con datos simulados, después se enchufa expo-camera sin
 * tocar esta lógica.
 */
export function ModalEscaner({ visible, opciones, error, onEscanear, onCerrar }: ModalEscanerProps): JSX.Element | null {
  if (!visible) return null;

  return (
    // Overlay en JS, NO <Modal> nativo — ver el comentario largo en
    // ModalConteo.tsx: mismo bug de Android con el touch mal enrutado
    // tras cerrar un Modal transparent+fade.
    <View style={styles.raiz} pointerEvents="box-none">
      <Pressable style={styles.fondo} onPress={onCerrar} />
      <View pointerEvents="box-none" style={styles.centrado}>
        <View style={[styles.caja, shadow.modal]}>
          <View style={styles.cabecera}>
            <Text style={styles.titulo}>Confirmar producto con la cámara</Text>
            <Pressable onPress={onCerrar} style={styles.cerrar} accessibilityLabel="Cerrar">
              <X size={18} color={colors.gris} />
            </Pressable>
          </View>

          <Text style={styles.nota}>
            El escáner confirma que el producto que tenés en la mano es el de la lista — no reemplaza ingresar la cantidad.
          </Text>

          <View style={styles.visor}>
            <ScanLine size={30} color={colors.grisClaro} />
          </View>

          <Text style={styles.nota}>Simulá una lectura:</Text>

          <View style={styles.opciones}>
            {opciones.map((op) => (
              <Pressable key={op.codigo} style={styles.opcion} onPress={() => onEscanear(op.codigo)}>
                <Text style={styles.opcionEtiqueta} numberOfLines={1}>
                  {op.etiqueta}
                </Text>
                <Text style={styles.opcionCodigo}>{op.codigo}</Text>
              </Pressable>
            ))}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </View>
    </View>
  );
}

/** Arma las opciones del modal a partir de productos REALES de la hoja — 2 que sí pertenecen y 1 código que a propósito no coincide con ninguno, para poder demostrar el aviso de "no pertenece a la hoja". */
export function opcionesDeEscaneo(productos: Producto[]): OpcionEscaneo[] {
  const reales = productos.slice(0, 2).map((p) => ({ etiqueta: p.descripcion, codigo: p.codigoBarras }));
  return [...reales, { etiqueta: 'Código de otra hoja', codigo: '0000000000' }];
}

const styles = StyleSheet.create({
  raiz: { ...StyleSheet.absoluteFillObject, zIndex: 50, elevation: 50 },
  fondo: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  centrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  caja: { width: '100%', maxWidth: 310, gap: 12, padding: 17, backgroundColor: colors.campo, borderRadius: radius.xl },
  cabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  titulo: { flex: 1, fontSize: 15, color: colors.tinta, fontFamily: fonts.bold },
  cerrar: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  nota: { fontSize: fontSize.xs + 1, color: colors.gris, fontFamily: fonts.regular, lineHeight: 16 },
  visor: {
    height: 110,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borde,
    backgroundColor: colors.esperaSuave,
  },
  opciones: { gap: 8 },
  opcion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: 11,
    borderRadius: radius.sm,
    backgroundColor: colors.esperaSuave,
  },
  opcionEtiqueta: { flex: 1, minWidth: 0, fontSize: 13, color: colors.tinta, fontFamily: fonts.semibold },
  opcionCodigo: { fontSize: 11, color: colors.gris, fontFamily: fonts.regular },
  error: { fontSize: 12.5, color: colors.proceso, fontFamily: fonts.semibold },
});
