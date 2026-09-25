import { Building2 } from 'lucide-react-native';
import { useMemo, useState, type JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import { SelectBuscable } from './SelectBuscable';
import type { SelectorSucursalProps } from './SelectorSucursal';

/**
 * El selector de sucursal en web: el desplegable, sin el modal en el medio.
 *
 * En el teléfono el campo abre una ventana con el buscador adentro, porque en
 * 400px no hay lugar para desplegar una lista de diez tiendas. Acá el
 * desplegable cuelga del campo y se elige de un clic -- planteo del usuario:
 * *"¿no bastaría un select con buscador en vez de una ventana?"*.
 *
 * El buscador NO toma el foco solo (`autoFocusBusqueda={false}`): en una PC,
 * con diez tiendas a la vista, quien abre el select casi siempre hace clic en
 * la que quiere; robarle el foco al teclado sirve cuando hay cien opciones y
 * no cuando se ven todas.
 *
 * `permitirVacio={false}`: no existe "ninguna tienda". Una pantalla de
 * auditoría sin sucursal no tiene nada que mostrar, así que la opción de
 * limpiar sería un camino a una pantalla vacía.
 */
export function SelectorSucursal({ label, sucursales, sucursalId, onElegir }: SelectorSucursalProps): JSX.Element {
  const [abierto, setAbierto] = useState(false);

  // Se trabaja con NOMBRES porque el select es de texto, y se vuelve al id al
  // elegir. Dos tiendas con el mismo nombre romperían esto -- no pasa hoy (el
  // padrón las distingue) y si pasara habría que arreglarlo en el padrón, no
  // acá: dos tiendas con el mismo nombre son indistinguibles también para la
  // persona que elige.
  const nombres = useMemo(() => sucursales.map((s) => s.nombre), [sucursales]);
  const nombreElegido = sucursales.find((s) => s.id === sucursalId)?.nombre ?? null;

  return (
    <View style={styles.marco}>
      <SelectBuscable
        label={label}
        icon={Building2}
        opciones={nombres}
        valor={nombreElegido}
        onCambiar={(nombre) => {
          const elegida = sucursales.find((s) => s.nombre === nombre);
          if (elegida) onElegir(elegida.id);
        }}
        etiquetaVacia="Elige una sucursal"
        placeholderBusqueda="Buscar sucursal…"
        abierto={abierto}
        onCambiarAbierto={setAbierto}
        autoFocusBusqueda={false}
        permitirVacio={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  /** Ancho acotado: el nombre de una tienda mide lo que mide, y un campo de
   *  1.300px para "Market Luzuriaga" es el mismo estiramiento que ya
   *  corregimos en las tarjetas. */
  marco: { maxWidth: 420 },
});
