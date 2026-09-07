import { ScanLine, X } from 'lucide-react-native';
import { useEffect, useState, type JSX } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { desgloseConteo, lineasDeTotal, validarConteo } from '../../lib/dominio/empaque';
import type { Conteo, LineaEmpaque, Producto } from '../../lib/dominio/tipos';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';
import { interpretarCantidad } from './cantidad-numerica';

export interface ModalConteoProps {
  visible: boolean;
  producto: Producto | null;
  /** null = registro nuevo. No-null = ya tiene conteo guardado, se edita. */
  conteoInicial: Conteo | null;
  /** Viene de un escaneo pendiente que todavía no se guardó. */
  confirmadoPorEscaner: boolean;
  /**
   * Nombre del empaque que confirmó el escáner (si escaneó un código de
   * EMPAQUE, no de unidad — hoy poco común: ver el comentario de
   * `ultimoEscaneo` en app/conteo/contar.tsx). Solo pre-carga "1" en ese
   * empaque para un registro NUEVO — nunca pisa un conteo que ya existía.
   */
  empaquePreseleccionado?: string;
  onGuardar: (conteo: Conteo) => void;
  onCerrar: () => void;
}

/**
 * Modal de registro de conteo — un campo numérico por cada empaque
 * cerrado que el producto puede traer (decisión del cliente: puede
 * tener más de uno, Caja Y Pack del mismo producto) más las unidades
 * sueltas, con el total calculado en vivo. `totalUnidades()` es la
 * ÚNICA fuente de esa cuenta (lib/dominio/empaque.ts): nunca se suma a
 * mano acá.
 *
 * Decisión del cliente (5 sep 2026): tipear la cantidad en vez de tocar
 * +/- (hasta 47 toques para cargar una caja grande). `cantidades` sigue
 * siendo el número que se usa para el total; `textos` es lo que el
 * campo muestra mientras se tipea — se separan porque un texto a medio
 * escribir ("1" antes de completar "12") no puede pisar el total en
 * vivo con un valor a medias, y "12a" no puede tirar el conteo a NaN
 * silenciosamente. `interpretarCantidad()` (cantidad-numerica.ts) es la
 * única que decide si lo tipeado es un entero válido.
 *
 * Con UN solo empaque (el caso común) el campo del primero recibe foco
 * automático al abrir. El total se muestra como conversión EXPLÍCITA (una
 * línea por empaque: "2 Caja × 12 = 24 und", más las sueltas) con
 * `lineasDeTotal`, y sale del MISMO `desgloseConteo` que produce el número
 * que se guarda — no pueden diferir. Los nombres de empaque van tal cual los
 * da el sistema, sin pluralizar.
 */
export function ModalConteo({
  visible,
  producto,
  conteoInicial,
  confirmadoPorEscaner,
  empaquePreseleccionado,
  onGuardar,
  onCerrar,
}: ModalConteoProps): JSX.Element | null {
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [erroresCantidad, setErroresCantidad] = useState<Record<string, string | null>>({});
  const [sueltas, setSueltas] = useState(0);
  const [textoSueltas, setTextoSueltas] = useState('0');
  const [errorSueltas, setErrorSueltas] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const iniciales: Record<string, number> = {};
    for (const linea of conteoInicial?.empaques ?? []) {
      iniciales[linea.empaqueNombre] = linea.cantidad;
    }
    // Solo para un registro NUEVO: si ya había un conteo guardado, lo que
    // el escáner acaba de confirmar es "esto es lo que tenés en la mano",
    // no una razón para pisar un valor que la persona ya había cargado.
    if (!conteoInicial && empaquePreseleccionado && !(empaquePreseleccionado in iniciales)) {
      iniciales[empaquePreseleccionado] = 1;
    }
    setCantidades(iniciales);
    setTextos(Object.fromEntries(Object.entries(iniciales).map(([nombre, valor]) => [nombre, String(valor)])));
    setErroresCantidad({});
    setSueltas(conteoInicial?.sueltas ?? 0);
    setTextoSueltas(String(conteoInicial?.sueltas ?? 0));
    setErrorSueltas(null);
  }, [visible, producto?.id, conteoInicial, empaquePreseleccionado]);

  if (!visible || !producto) return null;

  function cambiarTexto(empaqueNombre: string, texto: string): void {
    setTextos((actual) => ({ ...actual, [empaqueNombre]: texto }));
    const resultado = interpretarCantidad(texto);
    if (resultado.ok) {
      setCantidades((actual) => ({ ...actual, [empaqueNombre]: resultado.valor }));
      setErroresCantidad((actual) => ({ ...actual, [empaqueNombre]: null }));
    } else {
      // No se toca `cantidades`: el total en vivo se queda en el último
      // valor válido mientras se muestra el aviso, nunca en NaN.
      setErroresCantidad((actual) => ({ ...actual, [empaqueNombre]: resultado.mensaje }));
    }
  }

  function cambiarTextoSueltas(texto: string): void {
    setTextoSueltas(texto);
    const resultado = interpretarCantidad(texto);
    if (resultado.ok) {
      setSueltas(resultado.valor);
      setErrorSueltas(null);
    } else {
      setErrorSueltas(resultado.mensaje);
    }
  }

  // Solo las líneas con algo cargado: un conteo no lista un empaque en 0
  // nada más porque el producto lo ofrece (ver tipos.ts#Conteo).
  const lineas: LineaEmpaque[] = producto.empaques
    .map((e) => ({ empaqueNombre: e.nombre, cantidad: cantidades[e.nombre] ?? 0 }))
    .filter((l) => l.cantidad > 0);

  const conteoBorrador: Conteo = {
    productoId: producto.id,
    empaques: lineas,
    sueltas,
    confirmadoPorEscaner,
    contadoEn: conteoInicial?.contadoEn ?? '',
  };
  // El total y su conversión salen del MISMO desgloseConteo: lo que se
  // muestra ("2 Caja × 12 = 24 und" + total) es exactamente lo que se guarda.
  const desglose = desgloseConteo(conteoBorrador, producto.empaques);
  const total = desglose.total;
  const lineasTotal = lineasDeTotal(desglose);
  const advertencias = validarConteo(conteoBorrador, producto.empaques);

  function guardar(): void {
    onGuardar({ ...conteoBorrador, contadoEn: new Date().toISOString() });
  }

  return (
    // Overlay en JS, NO <Modal> nativo: en Android, cerrar un Modal
    // transparent+fade deja al primer toque siguiente mal enrutado (le
    // llega al Pressable que tenía el responder antes de abrirse, no a lo
    // que hay debajo ahora). Mismo patrón ya probado en el modal de
    // "¿Finalizar?" de contar.tsx — se renderiza como hermano del
    // ScrollView de la pantalla, nunca adentro, para que el
    // absoluteFillObject cubra la pantalla entera y no quede recortado
    // por el contenido scrolleable.
    <View style={styles.raiz} pointerEvents="box-none">
      <Pressable style={styles.fondo} onPress={onCerrar} />
      <View pointerEvents="box-none" style={styles.centrado}>
        <View style={[styles.caja, shadow.modal]}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.cabecera}>
              <Text style={styles.titulo}>{conteoInicial ? 'Editar conteo' : 'Registrar conteo'}</Text>
              <Pressable onPress={onCerrar} style={styles.cerrar} accessibilityLabel="Cerrar">
                <X size={18} color={colors.gris} />
              </Pressable>
            </View>

            <View style={styles.productoBloque}>
              <Text style={styles.nombreProducto}>{producto.descripcion}</Text>
              <Text style={styles.meta}>
                Código {producto.codigoBarras}
                {producto.ubicacion ? ` · ${producto.ubicacion}` : ''}
              </Text>
            </View>

            {/* Encadena el escaneo con este modal. Sin esta banda, el
                operario escanea, se le abre un formulario en cero y parece
                que faltó un paso: no queda claro que el escáner YA hizo lo
                suyo (decir qué producto es) y que lo que sigue —cuánto y en
                qué presentación— es suyo por diseño, no por una limitación
                que alguien olvidó resolver. Los códigos de Dynamics son
                todos de unidad suelta: ninguno puede decir si hay una caja
                en la mano. */}
            {confirmadoPorEscaner ? (
              <View style={styles.confirmadoBanda}>
                <ScanLine size={15} color={colors.ok} />
                <Text style={styles.confirmadoTexto}>
                  {empaquePreseleccionado
                    ? `Producto confirmado con la cámara, y el código era el del empaque ${empaquePreseleccionado}. Ajusta la cantidad si tienes más de uno.`
                    : 'Producto confirmado con la cámara. El código no dice cuántas hay: indica abajo cuántos empaques cerrados y cuántas unidades sueltas tienes.'}
                </Text>
              </View>
            ) : null}

            {producto.empaques.map((empaque, indice) => (
              <View key={empaque.nombre} style={styles.campo}>
                <Text style={styles.campoEtiqueta}>{empaque.nombre}</Text>
                <TextInput
                  style={[styles.input, erroresCantidad[empaque.nombre] ? styles.inputError : null]}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  value={textos[empaque.nombre] ?? String(cantidades[empaque.nombre] ?? 0)}
                  onChangeText={(texto) => cambiarTexto(empaque.nombre, texto)}
                  selectTextOnFocus
                  autoFocus={indice === 0}
                  accessibilityLabel={`Cantidad de ${empaque.nombre}`}
                />
                {erroresCantidad[empaque.nombre] ? (
                  <Text style={styles.inputErrorTexto}>{erroresCantidad[empaque.nombre]}</Text>
                ) : null}
              </View>
            ))}

            <View style={styles.campo}>
              <Text style={styles.campoEtiqueta}>Unidades sueltas</Text>
              <TextInput
                style={[styles.input, errorSueltas ? styles.inputError : null]}
                keyboardType="number-pad"
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                value={textoSueltas}
                onChangeText={cambiarTextoSueltas}
                selectTextOnFocus
                autoFocus={producto.empaques.length === 0}
                accessibilityLabel="Unidades sueltas"
              />
              {errorSueltas ? <Text style={styles.inputErrorTexto}>{errorSueltas}</Text> : null}
            </View>

            {advertencias.length > 0 ? (
              <View style={styles.advertencias}>
                {advertencias.map((a, i) => (
                  <Text key={`${a.tipo}-${i}`} style={styles.advertenciaTexto}>
                    {a.mensaje}
                  </Text>
                ))}
              </View>
            ) : null}

            {/* La conversión a la vista y en vivo: una línea por empaque
                ("2 Caja × 12 = 24 und") + las sueltas, y el TOTAL abajo. Todo
                sale de `desgloseConteo`, la MISMA cuenta que se guarda. */}
            <View style={styles.totalVivo}>
              {lineasTotal.map((linea, i) => (
                <Text key={`total-${i}`} style={styles.totalLinea}>
                  {linea}
                </Text>
              ))}
              <Text style={styles.totalValor}>TOTAL {total} und</Text>
            </View>

            <Pressable style={styles.guardar} onPress={guardar}>
              <Text style={styles.guardarTexto}>Guardar registro en hoja</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: { ...StyleSheet.absoluteFillObject, zIndex: 50, elevation: 50 },
  fondo: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  centrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  caja: {
    width: '100%',
    maxWidth: 320,
    maxHeight: '86%',
    padding: 17,
    backgroundColor: colors.campo,
    borderRadius: radius.xl,
  },
  cabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: 12 },
  titulo: { fontSize: 15, color: colors.tinta, fontFamily: fonts.bold },
  cerrar: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  productoBloque: { gap: 2, marginBottom: 14 },
  nombreProducto: { marginTop: 4, fontSize: 14, color: colors.tinta, fontFamily: fonts.bold },
  meta: { marginTop: 2, fontSize: fontSize.xs, color: colors.gris, fontFamily: fonts.regular },
  confirmadoBanda: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 12,
    padding: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.okSuave,
  },
  confirmadoTexto: { flex: 1, fontSize: 12, lineHeight: 16.5, color: colors.ok, fontFamily: fonts.medium },
  campo: { marginBottom: 12, gap: 6 },
  campoEtiqueta: { fontSize: 13, color: colors.tinta, fontFamily: fonts.semibold },
  input: {
    height: 44,
    paddingHorizontal: 12,
    textAlign: 'center',
    fontSize: 18,
    color: colors.tinta,
    fontFamily: fonts.bold,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.sm,
    backgroundColor: colors.blanco,
  },
  inputError: { borderColor: colors.falta },
  inputErrorTexto: { marginTop: 4, fontSize: 11.5, color: colors.falta, fontFamily: fonts.medium },
  advertencias: { marginBottom: 12, gap: 4 },
  advertenciaTexto: { fontSize: 11.5, color: colors.proceso, fontFamily: fonts.medium },
  totalVivo: {
    alignItems: 'center',
    gap: 2,
    padding: 12,
    marginBottom: 14,
    borderRadius: radius.md,
    backgroundColor: colors.okSuave,
  },
  totalLinea: { fontSize: 12.5, color: colors.ok, fontFamily: fonts.regular },
  totalValor: { fontSize: 22, color: colors.ok, fontFamily: fonts.bold, marginTop: 2 },
  guardar: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.rojo,
  },
  guardarTexto: { fontSize: 14.5, color: colors.blanco, fontFamily: fonts.bold },
});
