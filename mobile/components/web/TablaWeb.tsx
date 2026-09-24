import type { LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useState, type JSX, type ReactNode } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';
import { ChipIcono, type TonoChip } from './ChipIcono';

/**
 * ---------------------------------------------------------------------------
 * LA TABLA DE LA WEB. UNA SOLA, PARA TODAS LAS PANTALLAS
 * ---------------------------------------------------------------------------
 * Decisión del usuario: *"todas las tablas de la web tienen que tener este
 * diseño"*. Si cada pantalla dibuja la suya, en dos semanas hay cinco tablas
 * parecidas y ninguna igual -- y el día que haya que cambiar el alto de una
 * fila hay que cambiarlo en cinco lugares.
 *
 * Trae: encabezado con chip de ícono, barra de herramientas a la derecha
 * (buscador, filtros, exportar), cabecera de columnas fija, filas con tinte
 * opcional según su estado, y el pie que dice cuánto se está mostrando.
 *
 * ---------------------------------------------------------------------------
 * PAGINACIÓN POR SCROLL, NO POR BOTONES
 * ---------------------------------------------------------------------------
 * Pedido del usuario. Arranca con `POR_TANDA` filas y suma otra tanda cada vez
 * que el scroll llega al final. No es una paginación contra el servidor: los
 * datos ya están todos en memoria (la matriz baja los 985 de una) y lo que se
 * corta es el DIBUJO.
 *
 * Para qué sirve entonces: montar 985 filas de once celdas cada una es lo que
 * hacía que el navegador se trabara al entrar. Con tandas, la pantalla
 * aparece de inmediato y el resto llega a medida que hace falta -- y quien
 * busca un producto puntual nunca baja hasta el fondo.
 *
 * `onEndReachedThreshold: 0.4` y no 0: que la tanda siguiente empiece a
 * montarse ANTES de tocar el fondo es lo que hace que no se vea el salto.
 */
const POR_TANDA = 60;

export type AlineacionColumna = 'izquierda' | 'derecha' | 'centro';

export interface ColumnaTabla<T> {
  /** Solo para React: no se muestra. */
  clave: string;
  titulo: string;
  /** Ancho fijo en px. Sin esto, la columna se reparte lo que sobra. */
  ancho?: number;
  alinear?: AlineacionColumna;
  celda: (fila: T) => ReactNode;
}

/** El tinte de una fila. `null` = sin tinte, que es lo normal. */
export type TinteFila = 'falta' | 'ok' | 'atencion' | null;

export interface TablaWebProps<T> {
  titulo: string;
  sub?: string;
  icono?: LucideIcon;
  tono?: TonoChip;
  columnas: ColumnaTabla<T>[];
  filas: readonly T[];
  claveDe: (fila: T) => string;
  onAbrirFila?: (fila: T) => void;
  tinteDeFila?: (fila: T) => TinteFila;
  /** Buscador, filtros y exportar: van a la derecha del título. */
  herramientas?: ReactNode;
  /** Qué decir cuando no hay ni una fila. */
  vacio?: ReactNode;
  /** El texto del pie. Sin esto se arma solo: "Mostrando 60 de 985". */
  pie?: (mostradas: number, total: number) => string;
  /** Alto máximo de la zona de filas. Sin esto, la tabla crece con su contenido. */
  alto?: number;
  /**
   * Ancho total de las columnas, para las tablas que NO entran en la pantalla.
   *
   * Con esto la tabla se vuelve desplazable a lo ancho, y la cabecera viaja
   * junto con las filas -- si se quedara quieta, al correrse a la derecha los
   * números quedarían bajo el encabezado equivocado, que es peor que no tener
   * encabezado. Lo usa la matriz, que tiene once columnas (una por ronda).
   *
   * Sin esta prop las columnas se reparten el ancho disponible, que es lo que
   * quieren las tablas de cinco o seis columnas.
   */
  anchoTotal?: number;
}

export function TablaWeb<T>({
  titulo,
  sub,
  icono,
  tono = 'marca',
  columnas,
  filas,
  claveDe,
  onAbrirFila,
  tinteDeFila,
  herramientas,
  vacio,
  pie,
  alto,
  anchoTotal,
}: TablaWebProps<T>): JSX.Element {
  const [mostradas, setMostradas] = useState(POR_TANDA);

  // Cambió el filtro o la búsqueda: se vuelve a la primera tanda. Sin esto,
  // filtrar de 985 a 6 dejaba "mostrando 180 de 6", y al revés dejaba montadas
  // filas de un resultado anterior.
  useEffect(() => {
    setMostradas(POR_TANDA);
  }, [filas]);

  const siguienteTanda = useCallback(() => {
    setMostradas((actual) => (actual >= filas.length ? actual : actual + POR_TANDA));
  }, [filas.length]);

  const visibles = filas.slice(0, mostradas);

  return (
    <View style={styles.tarjeta}>
      <View style={styles.encabezado}>
        {icono ? <ChipIcono icono={icono} tono={tono} /> : null}
        <View style={styles.tituloBloque}>
          <Text style={styles.titulo}>{titulo}</Text>
          {sub ? <Text style={styles.sub}>{sub}</Text> : null}
        </View>
        {herramientas ? <View style={styles.herramientas}>{herramientas}</View> : null}
      </View>

      <Envoltura anchoTotal={anchoTotal}>
      <View style={[styles.cabecera, anchoTotal !== undefined ? { width: anchoTotal } : null]}>
        {columnas.map((col) => (
          <Text
            key={col.clave}
            style={[styles.cabeceraTexto, anchoDe(col), alineacionDe(col)]}
            numberOfLines={1}
          >
            {col.titulo}
          </Text>
        ))}
      </View>

      {filas.length === 0 ? (
        <View style={styles.vacio}>{vacio ?? <Text style={styles.vacioTexto}>No hay nada para mostrar.</Text>}</View>
      ) : (
        <FlatList
          data={visibles}
          keyExtractor={claveDe}
          style={alto !== undefined ? { maxHeight: alto } : undefined}
          onEndReached={siguienteTanda}
          onEndReachedThreshold={0.4}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={7}
          removeClippedSubviews
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <Fila
              columnas={columnas}
              item={item}
              tinte={tinteDeFila?.(item) ?? null}
              onAbrir={onAbrirFila === undefined ? undefined : () => onAbrirFila(item)}
              ancho={anchoTotal}
            />
          )}
        />
      )}
      </Envoltura>

      <View style={styles.pie}>
        <Text style={styles.pieTexto}>
          {pie
            ? pie(visibles.length, filas.length)
            : `Mostrando ${visibles.length} de ${filas.length}`}
        </Text>
      </View>
    </View>
  );
}

/**
 * Con `anchoTotal`, la cabecera y las filas viajan juntas adentro de un scroll
 * horizontal. Sin él, no se envuelve nada: un ScrollView de más introduce su
 * propio contenedor flex y descoloca los anchos de columna.
 */
function Envoltura({ anchoTotal, children }: { anchoTotal?: number; children: ReactNode }): JSX.Element {
  if (anchoTotal === undefined) return <>{children}</>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ width: anchoTotal }}>
      <View style={{ width: anchoTotal }}>{children}</View>
    </ScrollView>
  );
}

/**
 * Una fila. `memo` no hace falta acá porque `FlatList` ya solo monta lo que se
 * ve; lo que sí importa es que la fila NO sea `Pressable` cuando no hay a
 * dónde ir: un cursor de mano sobre algo que no responde es una promesa rota.
 */
function Fila<T>({
  columnas,
  item,
  tinte,
  onAbrir,
  ancho,
}: {
  columnas: ColumnaTabla<T>[];
  item: T;
  tinte: TinteFila;
  onAbrir?: () => void;
  ancho?: number;
}): JSX.Element {
  const contenido = (
    <View style={[styles.fila, tinte !== null ? tintes[tinte] : null, ancho !== undefined ? { width: ancho } : null]}>
      {columnas.map((col) => (
        <View key={col.clave} style={[anchoDe(col), styles.celda, alineacionCaja(col)]}>
          {col.celda(item)}
        </View>
      ))}
    </View>
  );

  if (onAbrir === undefined) return contenido;
  return (
    <Pressable onPress={onAbrir} accessibilityRole="button">
      {contenido}
    </Pressable>
  );
}

function anchoDe<T>(col: ColumnaTabla<T>): { width: number; flexGrow: 0; flexShrink: 0 } | { flex: 1 } {
  // `flexShrink: 0` junto al ancho: en la web el default es 1 -- en React
  // Native es 0 -- y sin esto las columnas angostas se comprimen hasta que el
  // número no entra.
  return col.ancho === undefined ? { flex: 1 } : { width: col.ancho, flexGrow: 0, flexShrink: 0 };
}

function alineacionDe<T>(col: ColumnaTabla<T>): { textAlign: 'left' | 'right' | 'center' } {
  if (col.alinear === 'derecha') return { textAlign: 'right' };
  if (col.alinear === 'centro') return { textAlign: 'center' };
  return { textAlign: 'left' };
}

function alineacionCaja<T>(col: ColumnaTabla<T>): { alignItems: 'flex-start' | 'flex-end' | 'center' } {
  if (col.alinear === 'derecha') return { alignItems: 'flex-end' };
  if (col.alinear === 'centro') return { alignItems: 'center' };
  return { alignItems: 'flex-start' };
}

const tintes = StyleSheet.create({
  /** Rojo apenas insinuado: marca la fila sin apagar los números de adentro. */
  falta: { backgroundColor: colors.faltaSuave },
  ok: { backgroundColor: colors.okSuave },
  atencion: { backgroundColor: colors.procesoSuave },
});

const styles = StyleSheet.create({
  tarjeta: {
    backgroundColor: colors.blanco,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borde,
    overflow: 'hidden',
    ...shadow.tarjeta,
  },
  encabezado: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  tituloBloque: { gap: 1 },
  titulo: { fontSize: fontSize.lg, color: colors.tinta, fontFamily: fonts.bold },
  sub: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },
  /** Empujadas a la derecha: el título manda a la izquierda, las acciones al otro extremo. */
  herramientas: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },

  cabecera: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    backgroundColor: colors.lienzo,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borde,
  },
  cabeceraTexto: { fontSize: 12, color: colors.gris, fontFamily: fonts.semibold },

  fila: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.borde,
  },
  celda: { justifyContent: 'center' },

  vacio: { padding: spacing.xxl, alignItems: 'center' },
  vacioTexto: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },

  pie: { paddingHorizontal: spacing.lg, paddingVertical: 10, backgroundColor: colors.lienzo },
  pieTexto: { fontSize: 12, color: colors.gris, fontFamily: fonts.regular },
});

/**
 * Texto de celda con el estilo de la tabla. Existe para que las pantallas no
 * tengan que importar la tipografía ni acordarse de `tabular-nums` en cada
 * número: sin eso las columnas de cifras bailan de fila en fila.
 */
export function CeldaTexto({
  children,
  fuerte = false,
  color,
  numero = false,
}: {
  children: ReactNode;
  fuerte?: boolean;
  color?: string;
  numero?: boolean;
}): JSX.Element {
  return (
    <Text
      style={[
        celdaEstilos.texto,
        fuerte && celdaEstilos.fuerte,
        numero && celdaEstilos.numero,
        color !== undefined ? { color } : null,
      ]}
      numberOfLines={1}
    >
      {children}
    </Text>
  );
}

const celdaEstilos = StyleSheet.create({
  texto: { fontSize: 13, color: colors.tinta, fontFamily: fonts.regular },
  fuerte: { fontFamily: fonts.bold },
  numero: { fontVariant: ['tabular-nums'] },
});
