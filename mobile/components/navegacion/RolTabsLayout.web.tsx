import { Redirect, Slot, usePathname, router } from 'expo-router';
import { LogOut } from 'lucide-react-native';
import type { JSX } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { iconoDeRuta } from './iconos-ruta';
import { useNavegacion } from '../../lib/navegacion-contexto';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';
import type { RolTabsLayoutProps } from './RolTabsLayout';

/**
 * ---------------------------------------------------------------------------
 * LA MISMA RUTA, OTRA PLATAFORMA
 * ---------------------------------------------------------------------------
 * Metro resuelve `RolTabsLayout.web.tsx` en vez de `RolTabsLayout.tsx` cuando
 * el bundle es para navegador. El archivo que importa no cambia ni se entera:
 * `app/auditor/_layout.tsx` sigue diciendo `import { RolTabsLayout }`.
 *
 * Es un CLON, no una variante con condicionales adentro -- decisión del
 * usuario, textual: *"no utilices la misma pantalla del móvil, clónalo y
 * cámbialo, en todo caso son plataformas diferentes"*. Un solo archivo lleno
 * de `Platform.OS === 'web' ? ... : ...` termina siendo dos pantallas mal
 * escritas dentro de una.
 *
 * ---------------------------------------------------------------------------
 * BARRA LATERAL, NO PESTAÑAS ABAJO
 * ---------------------------------------------------------------------------
 * En el teléfono son cuatro pestañas al pie, que es donde llega el pulgar. En
 * una PC el pulgar no existe y la pantalla es ancha: el lugar muerto es la
 * izquierda, y ahí entra la lista COMPLETA de accesos del rol -- las nueve del
 * Auditor, no las cuatro que caben abajo. El Auditor deja de tener que volver
 * al Inicio para entrar a Liquidación o a Clasificación.
 *
 * Por eso usa `<Slot />` y no `<Tabs>`: `Tabs` dibuja su propio contenedor con
 * la barra pegada al borde inferior y limita la navegación a las pestañas
 * declaradas. Con `Slot` la ruta se resuelve igual (expo-router la matchea por
 * archivo) y el marco lo decide este layout.
 *
 * ---------------------------------------------------------------------------
 * RESPONSIVO A PANTALLAS
 * ---------------------------------------------------------------------------
 * Abajo de `ANCHO_ANGOSTO` la barra pasa de columna a fila arriba: es una
 * ventana angosta en una PC -- media pantalla, un monitor viejo --, NO un
 * teléfono. El teléfono tiene su propio archivo y no pasa por acá.
 */
const ANCHO_BARRA = 286;
const ANCHO_ANGOSTO = 900;

export function RolTabsLayout({ rol }: RolTabsLayoutProps): JSX.Element | null {
  const { sesion, cargando, cerrar } = useSesion();
  const { accesos } = useNavegacion(rol);
  const { width } = useWindowDimensions();
  const ruta = usePathname();
  const angosto = width < ANCHO_ANGOSTO;

  if (cargando) return null;
  if (!sesion) return <Redirect href="/" />;
  if (sesion.colaborador.rol !== rol) return <Redirect href={`/${sesion.colaborador.rol}`} />;

  const inicio = `/${rol}`;
  /**
   * El Inicio no viene en `accesos` (en el teléfono es la primera pestaña), y
   * en la barra tiene que estar: es a donde se vuelve. Se agrega acá y no en
   * el catálogo del backend para no cambiarle el home a las tres plataformas
   * por una necesidad de esta.
   */
  const enlaces = [{ titulo: 'Inicio', sub: 'Estado del inventario', ruta: inicio }, ...accesos];

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  return (
    <View style={[styles.marco, angosto && styles.marcoAngosto]}>
      <View style={[styles.barra, angosto && styles.barraAngosta]}>
        <View style={[styles.marca, angosto && styles.marcaAngosta]}>
          <Text style={styles.marcaTitulo}>Trujillo</Text>
          {!angosto ? (
            <Text style={styles.marcaSub} numberOfLines={2}>
              {sesion.colaborador.nombre} · {rol}
            </Text>
          ) : null}
        </View>

        <ScrollView
          horizontal={angosto}
          style={styles.lista}
          contentContainerStyle={angosto ? styles.listaAngostaContenido : undefined}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
        >
          {enlaces.map((acceso) => {
            const destino = acceso.ruta ?? inicio;
            // `startsWith` y no igualdad: una pantalla de detalle cuelga de su
            // ruta madre y tiene que dejarla marcada. El Inicio se compara
            // exacto, si no queda encendido siempre.
            const activo = destino === inicio ? ruta === inicio : ruta.startsWith(destino);
            // El icono sale de la RUTA, no del backend: los iconos son
            // componentes y no viajan por HTTP. Ver `iconos-ruta.ts`.
            const Icono = iconoDeRuta(destino);
            return (
              <Pressable
                key={destino}
                style={[styles.enlace, angosto && styles.enlaceAngosto, activo && styles.enlaceActivo]}
                onPress={() => router.push(destino as never)}
                accessibilityRole="link"
                accessibilityState={{ selected: activo }}
              >
                <Icono size={19} color={activo ? colors.rojo : colors.gris} />
                <View style={styles.enlaceTextos}>
                  <Text style={[styles.enlaceTitulo, activo && styles.enlaceTituloActivo]} numberOfLines={1}>
                    {acceso.titulo}
                  </Text>
                  {!angosto ? (
                    <Text style={styles.enlaceSub} numberOfLines={1}>
                      {acceso.sub}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable style={[styles.salir, angosto && styles.salirAngosto]} onPress={() => void salir()} accessibilityRole="button">
          <LogOut size={16} color={colors.gris} />
          {!angosto ? <Text style={styles.salirTexto}>Cerrar sesión</Text> : null}
        </Pressable>
      </View>

      <View style={styles.contenido}>
        <Slot />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // El LIENZO gris: es lo que hace que las tarjetas blancas se lean como
  // piezas y no como manchas. Ver `colors.lienzo` para por qué solo en web.
  marco: { flex: 1, flexDirection: 'row', backgroundColor: colors.lienzo },
  marcoAngosto: { flexDirection: 'column' },

  barra: {
    width: ANCHO_BARRA,
    borderRightWidth: 1,
    borderRightColor: colors.borde,
    backgroundColor: colors.blanco,
    paddingVertical: spacing.md,
  },
  barraAngosta: {
    width: '100%',
    borderRightWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.borde,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },

  marca: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: 2 },
  marcaAngosta: { paddingBottom: 0 },
  // `fonts.marca` (Baloo2) y no la del cuerpo: es el logotipo, el mismo que
  // usa el teléfono en la pantalla de ingreso.
  marcaTitulo: { fontSize: 30, color: colors.rojo, fontFamily: fonts.marca },
  marcaSub: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },

  lista: { flex: 1 },
  listaAngostaContenido: { alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm },

  enlace: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 11,
    paddingHorizontal: spacing.xl,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  enlaceTextos: { flex: 1, gap: 1 },
  enlaceAngosto: {
    borderLeftWidth: 0,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  // El activo se pinta con el rojo suave, no con blanco: sobre una barra
  // blanca el blanco no marca nada, y este es el mismo tinte que usan las
  // bandas de los montos que se descuentan.
  enlaceActivo: { borderLeftColor: colors.rojo, backgroundColor: colors.rojoSuave, borderBottomColor: colors.rojo },
  enlaceTitulo: { fontSize: fontSize.base, color: colors.tinta, fontFamily: fonts.semibold },
  enlaceTituloActivo: { color: colors.rojo, fontFamily: fonts.bold },
  enlaceSub: { fontSize: 12, color: colors.grisClaro, fontFamily: fonts.regular },

  salir: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.xl,
    marginTop: spacing.sm,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
  },
  salirAngosto: { marginTop: 0, marginRight: spacing.sm, marginLeft: 0 },
  salirTexto: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.semibold },

  contenido: { flex: 1 },
});
