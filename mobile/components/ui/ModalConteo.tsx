import { ScanLine, X } from 'lucide-react-native';
import { useEffect, useState, type JSX } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { errorDeMotivo, STOCK_NO_SE_CORRIGE } from '../../lib/dominio/ajuste-final';
import {
  etiquetaDeEmpaque, desgloseConteo, lineasDeTotal, validarConteo } from '../../lib/dominio/empaque';
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
  /**
   * PIDE UN MOTIVO OBLIGATORIO antes de guardar. `false` por default, o sea:
   * el conteo de siempre sigue funcionando exactamente igual.
   *
   * Opt-in a propósito, que es la regla para una prop que cambia el
   * comportamiento de un componente COMPARTIDO: este modal lo usan el
   * Contador (que carga el valor original) y las dos pantallas de corrección
   * (Coordinador y Auditor). Pedirle el motivo al Contador por cada producto
   * de una hoja de 50 sería insoportable y no aportaría nada: su valor es el
   * primero, no cambia ninguno anterior. El motivo importa cuando se PISA un
   * valor que ya existía, porque es lo único que va a explicar el descuento
   * seis meses después.
   */
  pedirMotivo?: boolean;
  /** Qué se está por cambiar, arriba del campo de motivo. Solo con `pedirMotivo`. */
  tituloMotivo?: string;
  /**
   * EL STOCK DEL ERP, SOLO COMO REFERENCIA. Ausente por default, y ausente es
   * lo que pasan el Contador y el Coordinador: para ellos rige el conteo
   * ciego, y este modal no sabe qué es el stock salvo que alguien se lo diga.
   *
   * SOLO lo pasa la corrección del AUDITOR. Él ve el stock porque su trabajo
   * es comparar; esconderle el número no protegería nada y le haría imposible
   * la tarea. Que sea una prop opcional y no un dato que el modal busque por
   * su cuenta es justamente lo que mantiene la garantía: para ver el stock
   * hay que pedirlo explícitamente desde una pantalla que tenga derecho.
   *
   * `null` = el snapshot no trajo stock para ese ítem: se muestra "—", nunca
   * un 0 (que afirmaría que el ERP dice que no hay ninguno).
   *
   * NUNCA es editable. Ver `STOCK_NO_SE_CORRIGE` en dominio/ajuste-final.ts:
   * corregir lo contado no es corregir el stock, y la pantalla no puede dejar
   * lugar a esa confusión.
   */
  stockErpDeReferencia?: number | null;
  /**
   * `motivo` llega vacío cuando `pedirMotivo` es false. Quien no lo pide
   * puede seguir recibiendo un handler de un solo parámetro -- por eso
   * `contar.tsx` no cambió ni una línea.
   */
  onGuardar: (conteo: Conteo, motivo: string) => void;
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
 * Los campos arrancan VACÍOS y SIN foco (decisión del cliente 2026-09-09): el
 * teclado ya no se abre solo tapando la pantalla, y "vacío" no es "0" — guardar
 * se habilita recién cuando la persona ingresó al menos un valor (un 0 tecleado
 * cuenta: "vine, miré y no había"). El total se muestra como conversión
 * EXPLÍCITA (una línea por empaque: "2 Caja × 12 = 24 und", más las sueltas) con
 * `lineasDeTotal`, y sale del MISMO `desgloseConteo` que produce el número que
 * se guarda — no pueden diferir. Los nombres de empaque van tal cual los da el
 * sistema, sin pluralizar.
 */
export function ModalConteo({
  visible,
  producto,
  conteoInicial,
  confirmadoPorEscaner,
  empaquePreseleccionado,
  pedirMotivo = false,
  tituloMotivo,
  stockErpDeReferencia,
  onGuardar,
  onCerrar,
}: ModalConteoProps): JSX.Element | null {
  const [motivo, setMotivo] = useState('');
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [erroresCantidad, setErroresCantidad] = useState<Record<string, string | null>>({});
  const [sueltas, setSueltas] = useState(0);
  const [textoSueltas, setTextoSueltas] = useState('0');
  const [errorSueltas, setErrorSueltas] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    // El motivo NO se arrastra de un producto al anterior: cada cambio tiene
    // el suyo, y reusar el de la fila de arriba sería firmar un cambio con la
    // explicación de otro.
    setMotivo('');
    const iniciales: Record<string, number> = {};
    const textosIniciales: Record<string, string> = {};
    for (const linea of conteoInicial?.empaques ?? []) {
      iniciales[linea.empaqueNombre] = linea.cantidad;
      textosIniciales[linea.empaqueNombre] = String(linea.cantidad);
    }
    // Solo para un registro NUEVO: si ya había un conteo guardado, lo que
    // el escáner acaba de confirmar es "esto es lo que tenés en la mano",
    // no una razón para pisar un valor que la persona ya había cargado.
    if (!conteoInicial && empaquePreseleccionado && !(empaquePreseleccionado in iniciales)) {
      iniciales[empaquePreseleccionado] = 1;
      textosIniciales[empaquePreseleccionado] = '1';
    }
    setCantidades(iniciales);
    setTextos(textosIniciales);
    setErroresCantidad({});
    // VACÍO ≠ 0 (decisión del cliente 2026-09-09): en un registro NUEVO los
    // campos arrancan vacíos, no en "0". El número `sueltas` que alimenta el
    // total es 0, pero el TEXTO vacío es lo que distingue "no ingresó nada"
    // (no cuenta como conteo) de "tecleó 0" (sí cuenta: vio y no había).
    setSueltas(conteoInicial?.sueltas ?? 0);
    setTextoSueltas(conteoInicial ? String(conteoInicial.sueltas) : '');
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

  // VACÍO ≠ 0: guardar solo se habilita cuando la persona ingresó AL MENOS un
  // valor -- un 0 tecleado incluido, que SÍ cuenta como "vine, miré y no había".
  // Con todos los campos vacíos no se guarda ningún conteo: el producto queda
  // "sin contar" y sigue bloqueando la finalización de la hoja, que es justo lo
  // que el cliente quiere (que se vea que alguien lo miró de verdad).
  const hayValorIngresado =
    textoSueltas.trim() !== '' || producto.empaques.some((e) => (textos[e.nombre]?.trim() ?? '') !== '');
  const hayError = errorSueltas !== null || Object.values(erroresCantidad).some((m) => m !== null);
  // `errorDeMotivo` es la MISMA regla que valida el adaptador: si la pantalla
  // aceptara lo que el adaptador rechaza, la persona vería el modal cerrarse
  // y el cambio fallar después, sin entender cuál de las dos cosas pasó.
  const faltaMotivo = pedirMotivo ? errorDeMotivo(motivo) : null;
  const puedeGuardar = hayValorIngresado && !hayError && faltaMotivo === null;

  function guardar(): void {
    if (!puedeGuardar) return;
    onGuardar({ ...conteoBorrador, contadoEn: new Date().toISOString() }, motivo.trim());
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
          {/*
            `keyboardShouldPersistTaps="handled"`: por default es "never", y
            con el teclado abierto el PRIMER toque en cualquier hijo se
            consume para bajarlo -- el botón de guardar no lo recibe. Acá se
            salvaba de casualidad (el modal es corto y el teclado no tapaba el
            botón), pero en el modal de ajuste del auditor la misma trampa
            hizo imposible guardar: se arregló en los dos.
          */}
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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

            {/*
              EL STOCK, ARRIBA DE LOS CAMPOS Y FUERA DE ELLOS.
              Va en una celda inerte —un `View` con un `Text`, no un input— y
              con el rótulo "referencia" y la frase del dominio debajo. El
              cliente fue textual: corregir lo CONTADO no es corregir el STOCK,
              y la pantalla no puede dejar lugar a esa confusión. Un campo con
              borde al lado de los otros dos, aunque estuviera deshabilitado,
              ya la dejaría.

              Separado del bloque de campos por su propio recuadro para que se
              lea como lo que es: un dato traído, no algo que esta persona
              cargó ni puede cargar.
            */}
            {stockErpDeReferencia !== undefined ? (
              <View style={styles.referenciaErp}>
                <View style={styles.referenciaFila}>
                  <Text style={styles.referenciaEtiqueta}>Stock del sistema (referencia)</Text>
                  <Text style={styles.referenciaValor}>
                    {stockErpDeReferencia === null ? '—' : stockErpDeReferencia}
                  </Text>
                </View>
                <Text style={styles.referenciaNota}>{STOCK_NO_SE_CORRIGE}</Text>
              </View>
            ) : null}

            {producto.empaques.map((empaque) => (
              <View key={empaque.nombre} style={styles.campo}>
                {/* El nombre verbatim del sistema + a cuánto equivale: con
                    "PF" a secas nadie sabe si son 36 o 144. Ver
                    `etiquetaDeEmpaque`. */}
                <Text style={styles.campoEtiqueta}>{etiquetaDeEmpaque(empaque)}</Text>
                <TextInput
                  style={[styles.input, erroresCantidad[empaque.nombre] ? styles.inputError : null]}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  // Vacío, no "0": el campo arranca sin nada y sin foco (el
                  // teclado ya no se abre solo tapando la pantalla).
                  value={textos[empaque.nombre] ?? ''}
                  placeholder="—"
                  placeholderTextColor={colors.grisClaro}
                  onChangeText={(texto) => cambiarTexto(empaque.nombre, texto)}
                  selectTextOnFocus
                  accessibilityLabel={`Cantidad de ${etiquetaDeEmpaque(empaque)}`}
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
                placeholder="—"
                placeholderTextColor={colors.grisClaro}
                onChangeText={cambiarTextoSueltas}
                selectTextOnFocus
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

            {/*
              EL MOTIVO, pegado al botón y no arriba del todo: es lo último
              que se completa y lo que habilita el guardado, así que tiene que
              estar donde la vista ya está cuando el valor nuevo ya se tecleó.
              Multilínea porque "contó dos cajas de la góndola de al lado" no
              entra en una sola.
            */}
            {pedirMotivo ? (
              <View style={styles.campo}>
                <Text style={styles.campoEtiqueta}>Motivo del cambio</Text>
                <TextInput
                  style={[styles.input, styles.inputMotivo, faltaMotivo && motivo.length > 0 ? styles.inputError : null]}
                  multiline
                  numberOfLines={2}
                  // Un motivo no lleva saltos de línea: la tecla de Enter se
                  // usa para CERRAR el teclado, que es la única salida propia
                  // que tiene un campo multilínea.
                  submitBehavior="blurAndSubmit"
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  // Sin autoFocus: el teclado no se abre solo al entrar, misma
                  // regla que el buscador de los selects (ver la skill).
                  value={motivo}
                  placeholder="Por qué cambias este valor"
                  placeholderTextColor={colors.grisClaro}
                  onChangeText={setMotivo}
                  accessibilityLabel="Motivo del cambio"
                />
                <Text style={styles.motivoAyuda}>
                  {tituloMotivo ?? 'Queda registrado junto al cambio, con tu nombre y la hora.'}
                </Text>
              </View>
            ) : null}

            <Pressable
              style={[styles.guardar, !puedeGuardar && styles.guardarDeshabilitado]}
              onPress={guardar}
              disabled={!puedeGuardar}
            >
              <Text style={[styles.guardarTexto, !puedeGuardar && styles.guardarTextoDeshabilitado]}>
                {pedirMotivo ? 'Guardar el cambio' : 'Guardar registro en hoja'}
              </Text>
            </Pressable>
            {/* QUÉ falta, no "no se puede": el botón apagado sin motivo deja
                a la persona tocándolo sin saber qué le pide. */}
            {!hayValorIngresado ? (
              <Text style={styles.hintGuardar}>Ingresa la cantidad. Si miraste y no había ninguno, teclea 0.</Text>
            ) : faltaMotivo !== null ? (
              <Text style={styles.hintGuardar}>{faltaMotivo}</Text>
            ) : null}
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
  inputMotivo: { minHeight: 62, paddingTop: 10, textAlignVertical: 'top' },
  /**
   * La referencia del ERP. Paleta NEUTRA (`esperaSuave`), nunca la de un
   * campo (`campo` + borde): tiene que leerse como un dato traído, no como
   * algo que se pueda tocar. Sin `borderWidth` a propósito -- un recuadro con
   * borde es, en esta app, la forma de un input.
   */
  referenciaErp: { marginTop: 12, gap: 4, padding: 11, borderRadius: radius.sm, backgroundColor: colors.esperaSuave },
  referenciaFila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  referenciaEtiqueta: { flex: 1, fontSize: 12, color: colors.gris, fontFamily: fonts.semibold },
  referenciaValor: { fontSize: 17, color: colors.tinta, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  referenciaNota: { fontSize: 11, lineHeight: 15, color: colors.grisClaro, fontFamily: fonts.regular },
  motivoAyuda: { marginTop: 4, fontSize: 11, lineHeight: 15, color: colors.grisClaro, fontFamily: fonts.regular },
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
  guardarDeshabilitado: { backgroundColor: '#DCD6D2' },
  guardarTextoDeshabilitado: { color: colors.gris },
  hintGuardar: { marginTop: 10, fontSize: 12, color: colors.gris, fontFamily: fonts.regular, textAlign: 'center', lineHeight: 16 },
});
