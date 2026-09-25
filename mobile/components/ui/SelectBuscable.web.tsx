import { Check, ChevronDown, Search, X } from 'lucide-react-native';
import { useEffect, useRef, useState, type JSX } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { filtrarOpciones } from '../../lib/dominio/filtro-productos';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';
import type { SelectBuscableProps } from './SelectBuscable';

/** Alto de una opción y tope de la lista: diez a la vista. Ver `altoLista`. */
const ALTO_OPCION = 37;
const ALTO_MAX_LISTA = 10 * ALTO_OPCION;

/**
 * ---------------------------------------------------------------------------
 * EL SELECT DE LA WEB: UN DESPLEGABLE, NO UN MODAL
 * ---------------------------------------------------------------------------
 * Planteo del usuario mirando la web: *"¿no bastaría un select con buscador en
 * vez de una ventana?"*. Sí. El modal es un patrón de teléfono -- en 400px no
 * hay lugar para desplegar nada y conviene robarse toda la atención. En una PC
 * el desplegable cuelga del campo y se elige de un clic; el modal suma dos
 * (abrir y cerrar) y tapa la pantalla para elegir entre diez tiendas.
 *
 * Mismas props que el del teléfono, así que Metro cambia uno por otro y
 * ninguna pantalla se entera -- incluidos los tres modales de filtros, que lo
 * usan adentro.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO SE REUSO EL DEL TELEFONO CON `flotante`
 * ---------------------------------------------------------------------------
 * MEDIDO en el navegador (login, 2026-09-24): su lista flotante se dibujaba
 * encima de los campos de abajo pero los clics sobre las opciones no
 * seleccionaban nada -- el contenido de abajo se quedaba con el toque. Por eso
 * el login web terminó con dos listas a la vista en vez de un desplegable.
 *
 * Acá el desplegable se dibuja en un contenedor con `zIndex` alto Y el campo
 * entero se envuelve en una capa con `zIndex` propio: en la web, sin un
 * contexto de apilamiento propio, el hermano que viene DESPUES en el DOM gana
 * el clic aunque esté visualmente debajo.
 *
 * ---------------------------------------------------------------------------
 * LO QUE AGREGA LA WEB Y EL TELEFONO NO TIENE
 * ---------------------------------------------------------------------------
 * `Escape` cierra, y un clic fuera también. En un teléfono eso no existe: se
 * cierra tocando la opción o el fondo del modal. Acá, un desplegable que solo
 * se cierra eligiendo algo obliga a elegir cuando uno solo quería mirar.
 */
export function SelectBuscable({
  label,
  icon: Icon,
  opciones,
  valor,
  onCambiar,
  etiquetaVacia,
  placeholderBusqueda,
  abierto,
  onCambiarAbierto,
  autoFocusBusqueda = true,
  permitirVacio = true,
}: SelectBuscableProps): JSX.Element {
  const [busqueda, setBusqueda] = useState('');
  const visibles = filtrarOpciones(opciones, busqueda);
  /**
   * EL ALTO DE LA LISTA SE CALCULA, no se deja en `maxHeight`.
   *
   * MEDIDO: un `ScrollView` con solo `maxHeight` adentro de un contenedor de
   * alto automático -- y este desplegable lo es, cuelga en absoluto -- se queda
   * en CERO en el navegador: el panel se abría con el buscador y ninguna
   * opción debajo. Ni `flexGrow: 0` ni `flexBasis: 'auto'` lo arreglaron.
   *
   * Con una altura explícita no hay ambigüedad. `ALTO_OPCION` es el alto real
   * de una fila (9 + 9 de padding + ~19 de texto) y el tope son diez a la
   * vista; de ahí en más scrollea, que es para lo que está el ScrollView.
   */
  const cuantas = visibles.length + (permitirVacio ? 1 : 0);
  const altoLista = Math.min(ALTO_MAX_LISTA, Math.max(ALTO_OPCION, cuantas * ALTO_OPCION));
  const campoRef = useRef<View>(null);

  // Escape cierra. Se engancha solo mientras está abierto: un listener global
  // por cada select de la pantalla, siempre activo, es basura que se acumula.
  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') onCambiarAbierto(false);
    };
    globalThis.addEventListener?.('keydown', alTeclear);
    return () => globalThis.removeEventListener?.('keydown', alTeclear);
  }, [abierto, onCambiarAbierto]);

  function elegir(v: string | null): void {
    onCambiar(v);
    setBusqueda('');
    onCambiarAbierto(false);
  }

  return (
    <View style={[styles.capa, abierto && styles.capaAbierta]}>
      {label !== '' ? <Text style={styles.label}>{label}</Text> : null}

      <Pressable
        ref={campoRef}
        style={[styles.campo, abierto && styles.campoAbierto]}
        onPress={() => onCambiarAbierto(!abierto)}
        accessibilityRole="button"
        accessibilityState={{ expanded: abierto }}
        accessibilityLabel={`${label}: ${valor ?? etiquetaVacia}`}
      >
        {Icon ? <Icon size={16} color={colors.gris} /> : null}
        <Text style={[styles.valor, valor === null && styles.valorVacio]} numberOfLines={1}>
          {valor ?? etiquetaVacia}
        </Text>
        {/* La cruz para limpiar solo cuando hay algo que limpiar Y se permite
            vaciar: en el selector de sucursal no existe "ninguna tienda". */}
        {permitirVacio && valor !== null ? (
          <Pressable
            onPress={() => elegir(null)}
            accessibilityRole="button"
            accessibilityLabel={`Quitar ${label}`}
            style={styles.limpiar}
          >
            <X size={14} color={colors.gris} />
          </Pressable>
        ) : null}
        <ChevronDown size={16} color={colors.gris} style={abierto ? styles.chevronAbierto : undefined} />
      </Pressable>

      {abierto ? (
        <>
          {/* La capa que cierra al hacer clic afuera. Va DETRAS del desplegable
              (zIndex menor) y cubre la pantalla: sin esto, un select abierto se
              queda abierto para siempre mientras uno trabaja en otra cosa. */}
          <Pressable style={styles.afuera} onPress={() => onCambiarAbierto(false)} accessibilityLabel="Cerrar la lista" />

          <View style={styles.desplegable}>
            <View style={styles.buscador}>
              <Search size={15} color={colors.grisClaro} />
              <TextInput
                style={styles.buscadorTexto}
                value={busqueda}
                onChangeText={setBusqueda}
                placeholder={placeholderBusqueda}
                placeholderTextColor={colors.grisClaro}
                autoFocus={autoFocusBusqueda}
                // Enter con una sola coincidencia elige esa: es lo que espera
                // quien tipeó tres letras y ya ve lo que buscaba.
                onSubmitEditing={() => {
                  if (visibles.length === 1) elegir(visibles[0]!);
                }}
              />
            </View>

            <ScrollView style={[styles.lista, { height: altoLista }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {permitirVacio ? (
                <Opcion texto={etiquetaVacia} elegida={valor === null} onPress={() => elegir(null)} />
              ) : null}
              {visibles.length === 0 ? (
                <Text style={styles.sinResultados}>Nada coincide con “{busqueda.trim()}”.</Text>
              ) : (
                visibles.map((op) => (
                  <Opcion key={op} texto={op} elegida={op === valor} onPress={() => elegir(op)} />
                ))
              )}
            </ScrollView>
          </View>
        </>
      ) : null}
    </View>
  );
}

function Opcion({ texto, elegida, onPress }: { texto: string; elegida: boolean; onPress: () => void }): JSX.Element {
  return (
    <Pressable
      style={[styles.opcion, elegida && styles.opcionElegida]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: elegida }}
    >
      <Text style={[styles.opcionTexto, elegida && styles.opcionTextoElegida]} numberOfLines={1}>
        {texto}
      </Text>
      {elegida ? <Check size={15} color={colors.rojo} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * El contexto de apilamiento del campo. Con el select ABIERTO sube por
   * encima de todo lo que venga después en la página; cerrado vuelve a su
   * lugar, para que dos selects seguidos no se peleen por estar arriba.
   */
  capa: { gap: 5 },
  capaAbierta: { zIndex: 50 },

  label: { fontSize: 12, color: colors.gris, fontFamily: fonts.semibold },

  campo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 38,
    paddingHorizontal: 11,
    backgroundColor: colors.blanco,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
  },
  /** Abierto, el borde toma el rojo de la marca: dice cuál de los campos está desplegado. */
  campoAbierto: { borderColor: colors.rojo },
  valor: { flex: 1, fontSize: 13.5, color: colors.tinta, fontFamily: fonts.semibold },
  valorVacio: { color: colors.grisClaro, fontFamily: fonts.regular },
  limpiar: { padding: 2 },
  chevronAbierto: { transform: [{ rotate: '180deg' }] },

  /** Cubre la ventana entera, por debajo del desplegable. */
  afuera: { position: 'absolute', top: -2000, left: -2000, right: -2000, bottom: -2000 },

  desplegable: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    backgroundColor: colors.blanco,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
    overflow: 'hidden',
    ...shadow.modal,
  },
  buscador: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borde,
  },
  buscadorTexto: { flex: 1, fontSize: 13, color: colors.tinta, fontFamily: fonts.regular, minHeight: 22 },

  /**
   * Diez opciones a la vista; de ahí en más se scrollea, no se estira la
   * página.
   *
   * `flexGrow: 0` ademas del `maxHeight`: un ScrollView adentro de un
   * contenedor de alto automático -- y este desplegable lo es -- se queda con
   * altura CERO en la web y la lista no se ve. Es el mismo desencuentro que
   * dejaba invisibles los chips de filtro en Ajuste final.
   */
  lista: { flexGrow: 0, flexShrink: 0 },
  opcion: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, paddingVertical: 9 },
  opcionElegida: { backgroundColor: colors.rojoSuave },
  opcionTexto: { flex: 1, fontSize: 13, color: colors.tinta, fontFamily: fonts.regular },
  opcionTextoElegida: { color: colors.rojo, fontFamily: fonts.semibold },
  sinResultados: { padding: 11, fontSize: fontSize.sm, color: colors.grisClaro, fontFamily: fonts.regular },
});
