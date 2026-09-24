import { router } from 'expo-router';
import { BarChart3, Filter, RefreshCw, Search } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import {
  BandaSync,
  BarraApp,
  EmptyState,
  formatoMiles,
  ModalFiltrosMatriz,
  SelectorSucursal,
} from '../../components/ui';
import { repositorioAuditoria, repositorioInventario, repositorioSesion } from '../../lib/contenedor';
import { cuadroDelItem, diferenciaUnidades, resumirAuditoria, veredicto } from '../../lib/dominio/auditoria';
import {
  aplicarFiltroMatriz,
  categoriaDe,
  contarFiltrosActivos,
  ETIQUETA_CUADRO,
  FILTRO_MATRIZ_VACIO,
  SIN_HOJA,
  textoFiltroActivo,
  type FiltroMatriz,
} from '../../lib/dominio/filtro-matriz';
import { pluralizar } from '../../lib/dominio/plural';
import { sucursalEnFoco } from '../../lib/dominio/sucursal-en-foco';
import { ordinal } from '../../lib/dominio/texto-cierre-ronda';
import type { ItemAuditoria, Sucursal, VeredictoAuditoria } from '../../lib/dominio/tipos';
import { useSesion } from '../../lib/sesion-contexto';
import { useSucursalAuditada } from '../../lib/sucursal-auditada-contexto';
import { colors, fonts, radius } from '../../lib/theme';

/**
 * ---------------------------------------------------------------------------
 * LA MATRIZ DEL AUDITOR EN EL NAVEGADOR: UNA TABLA
 * ---------------------------------------------------------------------------
 * Metro elige este archivo en vez de `matriz.tsx` cuando el bundle es de web.
 * El del teléfono NO se toca. Es un CLON, no una variante con condicionales
 * adentro -- decisión del usuario, textual: *"no utilices la misma pantalla
 * del móvil, clónalo y cámbialo, en todo caso son plataformas diferentes"*.
 * Mismo criterio que `RolTabsLayout.web.tsx` y `InicioScreen.web.tsx`.
 *
 * POR QUÉ CAMBIA LA FORMA: en el teléfono cada ítem es una tarjeta, porque una
 * columna de 400px no aguanta diez columnas. Comparar 985 ítems a razón de una
 * tarjeta por pantallazo es lo que el Auditor hace con el dedo; en una PC lo
 * que se quiere es recorrer la columna "Diferencia" de arriba abajo y ver
 * dónde se rompe. Eso es una tabla, y la tabla solo existe acá.
 *
 * LO QUE **NO** CAMBIA es el negocio: el filtro (`lib/dominio/filtro-matriz`),
 * el modal de filtros y las cuentas (`lib/dominio/auditoria`) son los MISMOS
 * módulos que usa el teléfono, importados, no copiados. Si un día la
 * diferencia se calcula distinto, se calcula distinto en las dos plataformas o
 * en ninguna -- dos copias de esa fórmula es cómo una pantalla termina
 * mostrando un número y el cierre otro.
 *
 * ESTA PANTALLA SÍ MUESTRA CIFRAS DEL ERP a propósito: el conteo ciego aplica
 * a quien CUENTA, no a quien audita. El permiso ya lo resuelve el backend
 * (`auditoria.permisos.ts#validarAccesoALaMatriz`).
 */

/**
 * Alto de fila FIJO, y por eso la descripción trunca en una línea: con un alto
 * conocido, `getItemLayout` le ahorra a la lista medir 985 filas y el scroll
 * deja de dar saltos. Incluye el borde inferior (React Native mide border-box).
 */
const ALTO_FILA = 38;

/** El ancho de "Descripción" antes de repartirle el espacio sobrante. */
const ANCHO_DESCRIPCION = 300;

interface Celda {
  texto: string;
  color?: string;
  /** Para la diferencia: el único dato de la fila que se lee en negrita. */
  fuerte?: boolean;
  /** Lo que el "—" quiere decir, cuando el guion solo no alcanza. */
  etiqueta?: string;
}

interface Columna {
  clave: string;
  titulo: string;
  ancho: number;
  /** Derecha y `tabular-nums`: las cifras se comparan de un vistazo, columna abajo. */
  numerica: boolean;
  celda: (item: ItemAuditoria) => Celda;
}

/** Sin dato es "—", nunca un 0: un cero es una afirmación, el guion es "no sé". */
const SIN_DATO = '—';

function numero(valor: number | null | undefined): Celda {
  return valor === null || valor === undefined ? { texto: SIN_DATO, color: colors.grisClaro } : { texto: formatoMiles(valor) };
}

/**
 * LA DIFERENCIA, CON SIGNO Y COLOR. `null` = no se puede afirmar nada (sin
 * stock del ERP o sin ningún conteo), y ahí va el guion gris: un 0 ahí diría
 * "conté exactamente lo que decía el ERP", que es justo lo contrario.
 *
 * El 0 real (cuadró) va en tinta, sin color: el color de esta tabla está
 * reservado para lo que hay que mirar, y 979 de los 985 ítems cuadran.
 */
function celdaDiferencia(item: ItemAuditoria): Celda {
  const dif = diferenciaUnidades(item);
  if (dif === null) return { texto: SIN_DATO, color: colors.grisClaro };
  if (dif === 0) return { texto: '0' };
  return {
    texto: `${dif < 0 ? '-' : '+'}${formatoMiles(Math.abs(dif))}`,
    color: dif < 0 ? colors.falta : colors.ok,
    fuerte: true,
  };
}

/**
 * EL CUADRO, EN UNA ETIQUETA QUE ENTRA EN LA COLUMNA.
 *
 * Los tres cuadros reales salen de `ETIQUETA_CUADRO` -- las MISMAS palabras
 * que el modal de filtros ofrece en "En qué cuadro cayó", para que filtrar por
 * "Al personal" y leer "Al personal" en la columna sean la misma cosa. Y el
 * cuadro se lee de `cuadroDelItem` (el reparto que resolvió el servidor), no
 * de la clase del ítem: son distintos y confundirlos ya costó caro.
 *
 * Los dos estados SIN dato no se colapsan en uno: "Sin contar" (hay ERP, nadie
 * lo contó) y "Sin dato del ERP" (el snapshot no trajo stock) son problemas
 * distintos y se resuelven distinto. Son las palabras que ya usa la tarjeta
 * del teléfono. El filtro los junta bajo "Sin dato" porque ahí es un cajón de
 * búsqueda; una fila tiene lugar para decir cuál de los dos es.
 */
function celdaCuadro(item: ItemAuditoria, v: VeredictoAuditoria): Celda {
  if (v === 'sin_erp') return { texto: 'Sin dato del ERP', color: colors.gris };
  if (v === 'sin_contar') return { texto: 'Sin contar', color: colors.gris };
  if (v === 'cuadrado') return { texto: 'Cuadró', color: colors.gris };
  const cuadro = cuadroDelItem(item.atribucion);
  if (cuadro === 'personal') return { texto: ETIQUETA_CUADRO.personal };
  if (cuadro === 'paquetes') return { texto: ETIQUETA_CUADRO.paquetes };
  if (cuadro === 'empresa') return { texto: ETIQUETA_CUADRO.empresa };
  // Hay diferencia pero el servidor no repartió ni una unidad. No se inventa un
  // cuadro para tapar el hueco: se dice que no está repartida.
  return { texto: 'Sin repartir', color: colors.gris };
}

interface FilaProps {
  item: ItemAuditoria;
  columnas: readonly Columna[];
}

/**
 * `memo` por la misma razón que la tarjeta del teléfono: son cientos de filas
 * montadas, y sin esto cada cambio del padre (poner un filtro) las vuelve a
 * renderizar todas. `item` y `columnas` son referencias estables.
 */
const Fila = memo(function FilaComponent({ item, columnas }: FilaProps): JSX.Element {
  // EL TINTE DE LA FILA ES SOLO PARA LO QUE TIENE DIFERENCIA. Las 979 que
  // cuadran quedan en blanco: si se pintan todas, el color deja de señalar
  // nada y las 6 que importan se pierden entre las demás.
  const dif = diferenciaUnidades(item);
  const tinte = dif === null || dif === 0 ? null : dif < 0 ? styles.filaFalta : styles.filaSobra;
  return (
    <View style={[styles.fila, tinte]}>
      {columnas.map((columna) => {
        const celda = columna.celda(item);
        return (
          <Text
            key={columna.clave}
            style={[
              styles.celda,
              { width: columna.ancho },
              columna.numerica ? styles.celdaNumerica : null,
              celda.fuerte ? styles.celdaFuerte : null,
              celda.color === undefined ? null : { color: celda.color },
            ]}
            // Trunca al FINAL, nunca al medio: la persona sigue reconociendo el
            // producto por cómo empieza el nombre.
            numberOfLines={1}
            ellipsizeMode="tail"
            {...(celda.etiqueta === undefined ? {} : { accessibilityLabel: celda.etiqueta })}
          >
            {celda.texto}
          </Text>
        );
      })}
    </View>
  );
});

export default function MatrizWebScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ItemAuditoria[]>([]);
  const [filtro, setFiltro] = useState<FiltroMatriz>(FILTRO_MATRIZ_VACIO);
  const [modalFiltrosVisible, setModalFiltrosVisible] = useState(false);
  /** Lo que mide el marco de la tabla; lo que sobra se lo lleva "Descripción". */
  const [anchoDisponible, setAnchoDisponible] = useState(0);

  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  // LA MISMA sucursal compartida que el Panel, el Ciclo, el Historial y el
  // Inicio: entrar acá desde el panel no puede cambiar de tienda por el camino.
  const { elegida: sucursalElegida, elegir: setSucursalElegida } = useSucursalAuditada();
  useEffect(() => {
    repositorioSesion.sucursales().then(setSucursales);
  }, []);

  const cargar = useCallback(async () => {
    if (!sesion) return;
    const sucursalId = sucursalEnFoco({
      rol: sesion.colaborador.rol,
      sucursalDeSesion: sesion.sucursal?.id ?? null,
      elegida: sucursalElegida,
    });
    if (sucursalId === null) {
      setItems([]);
      setCargando(false);
      return;
    }
    setError(null);
    try {
      const activo = await repositorioInventario.activo(sucursalId);
      if (!activo) {
        setItems([]);
        setCargando(false);
        return;
      }
      setItems(await repositorioAuditoria.matriz(activo.inventarioId));
    } catch (e) {
      // Sin esto, un fallo sin red deja el spinner girando para siempre.
      setError(e instanceof Error ? e.message : 'No se pudo cargar la matriz de auditoría.');
    } finally {
      setCargando(false);
    }
  }, [sesion, sucursalElegida]);

  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar);

  // Cambió la sucursal: recargar YA y limpiar la matriz ANTES de que llegue la
  // nueva -- la barra ya dice la tienda nueva, y mostrar los ítems de la
  // anterior sería un número con el apellido equivocado.
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    setItems([]);
    setCargando(true);
    void cargar();
  }, [cargar]);

  const resumen = useMemo(() => resumirAuditoria(items), [items]);
  const visibles = useMemo(
    () => aplicarFiltroMatriz(items, filtro, resumen.veredictoPorId),
    [items, filtro, resumen],
  );

  /**
   * CUÁNTAS RONDAS TUVO ESTE INVENTARIO -- no tres fijas. El Auditor abre un
   * 4to o un 5to conteo cuando no le cierra, y el de Luzuriaga tuvo 4: una
   * tabla de tres columnas se comería la última pasada, que es justo la que
   * fijó el número. Sale del dato (`conteos.length`), no de una constante.
   */
  const rondas = useMemo(() => items.reduce((max, it) => Math.max(max, it.conteos.length), 0), [items]);

  const columnas = useMemo<Columna[]>(() => {
    const base: Columna[] = [
      { clave: 'codigo', titulo: 'Código', ancho: 92, numerica: false, celda: (it) => ({ texto: it.codigo }) },
      {
        clave: 'descripcion',
        titulo: 'Descripción',
        ancho: ANCHO_DESCRIPCION,
        numerica: false,
        celda: (it) => ({ texto: it.descripcion }),
      },
      {
        clave: 'hoja',
        titulo: 'Hoja',
        ancho: 74,
        numerica: false,
        // El guion es el mismo "no hay dato" que usa el resto de la fila; la
        // frase completa del dominio queda en la etiqueta accesible y en el
        // filtro, que es donde hay lugar para escribirla.
        celda: (it) =>
          it.hoja === '' ? { texto: SIN_DATO, color: colors.grisClaro, etiqueta: SIN_HOJA } : { texto: it.hoja },
      },
      {
        clave: 'categoria',
        titulo: 'Categoría',
        ancho: 190,
        numerica: false,
        celda: (it) => ({ texto: categoriaDe(it) }),
      },
      // "ERP" y no "Stock": es el nombre con el que el Auditor lo pide.
      { clave: 'erp', titulo: 'ERP', ancho: 86, numerica: true, celda: (it) => numero(it.stockErp) },
      ...Array.from({ length: rondas }, (_, indice) => ({
        clave: `ronda-${indice}`,
        // `ordinal` es la MISMA función que nombra las rondas en el Ciclo y en
        // el ajuste final: una sola fuente para "1er/2do/3er/4to", y responde
        // para cualquier ronda en vez de cortarse en la 3ra.
        titulo: ordinal(indice + 1),
        ancho: 74,
        numerica: true,
        celda: (it: ItemAuditoria): Celda => numero(it.conteos[indice]),
      })),
      { clave: 'diferencia', titulo: 'Diferencia', ancho: 106, numerica: true, celda: celdaDiferencia },
      {
        clave: 'cuadro',
        titulo: 'Cuadro',
        ancho: 164,
        numerica: false,
        celda: (it) => celdaCuadro(it, veredicto(it)),
      },
    ];
    // Lo que sobra del ancho se lo lleva la descripción, que es la única
    // columna que de verdad puede usarlo: el resto son cifras cortas y
    // estirarlas solo aleja el número de su encabezado.
    const sobra = Math.max(0, anchoDisponible - base.reduce((suma, c) => suma + c.ancho, 0));
    if (sobra === 0) return base;
    return base.map((c) => (c.clave === 'descripcion' ? { ...c, ancho: c.ancho + sobra } : c));
  }, [rondas, anchoDisponible]);

  const anchoTabla = useMemo(() => columnas.reduce((suma, c) => suma + c.ancho, 0), [columnas]);

  const filtrosActivos = contarFiltrosActivos(filtro);
  const filtroTexto = textoFiltroActivo(filtro);

  if (!sesion) return <View />;

  const sucursalId = sucursalEnFoco({
    rol: sesion.colaborador.rol,
    sucursalDeSesion: sesion.sucursal?.id ?? null,
    elegida: sucursalElegida,
  });
  const nombreSucursal = sucursales.find((s) => s.id === sucursalId)?.nombre ?? sesion.sucursal?.nombre;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  return (
    // `anchoCompleto`: una tabla de diez columnas no entra en el tope de
    // lectura de 1120px, y el tope existe para un renglón de texto, no para
    // esto. Es opt-in, así que ninguna otra pantalla se entera.
    <PantallaConTabs anchoCompleto contentStyle={styles.contenido}>
      <BarraApp
        rotulo="Auditoría · Matriz comparativa"
        sede={nombreSucursal}
        cifras={
          cargando
            ? undefined
            : `${items.length} ${pluralizar(items.length, 'ítem', 'ítems')} · ${resumen.conDiferencia} con diferencia`
        }
        onSalir={salir}
      />

      <BandaSync estado="ok" mensaje="Sincronizado" />

      <SelectorSucursal
        label="Sucursal a auditar"
        sucursales={sucursales}
        sucursalId={sucursalId}
        onElegir={setSucursalElegida}
      />

      <View style={styles.barraHerramientas}>
        <Pressable
          style={styles.btnFiltros}
          onPress={() => setModalFiltrosVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={
            filtrosActivos > 0 ? `Filtros, ${filtrosActivos} activo${filtrosActivos === 1 ? '' : 's'}` : 'Filtros'
          }
        >
          <Filter size={17} color={colors.tinta} />
          <Text style={styles.btnFiltrosTexto}>Filtros</Text>
          {filtrosActivos > 0 ? (
            <View style={styles.filtrosBadge}>
              <Text style={styles.filtrosBadgeTexto}>{filtrosActivos}</Text>
            </View>
          ) : null}
        </Pressable>

        {/* EN EL NAVEGADOR NO HAY "TIRAR PARA REFRESCAR": no hay gesto. La
            pantalla igual se recarga sola al enfocarse y al volver al frente
            (useRefrescoAlEnfocar), pero sin un control a mano la única salida
            es F5, que recarga la app entera. */}
        <Pressable
          style={styles.btnActualizar}
          onPress={refrescar}
          disabled={refrescando}
          accessibilityRole="button"
          accessibilityLabel="Actualizar la matriz"
        >
          <RefreshCw size={16} color={refrescando ? colors.grisClaro : colors.tinta} />
          <Text style={[styles.btnActualizarTexto, refrescando ? styles.btnActualizarInerte : null]}>
            {refrescando ? 'Actualizando…' : 'Actualizar'}
          </Text>
        </Pressable>

        {/* QUÉ está aplicado: el badge dice cuántos, esto dice cuáles. */}
        {filtroTexto !== null ? <Text style={styles.filtroActivo}>Filtro: {filtroTexto}</Text> : null}
      </View>

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : error ? (
        <View style={styles.tarjeta}>
          <Text style={styles.tarjetaTitulo}>No se pudo cargar la matriz</Text>
          <Text style={styles.tarjetaTexto}>{error}</Text>
          <Pressable style={styles.accion} onPress={() => void cargar()}>
            <Text style={styles.accionTexto}>Reintentar</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="Todavía no hay nada para auditar"
          subtitle="No hay un inventario en curso para esta sucursal, o el ciclo de conteos no cerró ningún ítem todavía."
        />
      ) : visibles.length === 0 ? (
        // La matriz completa vacía ya se resolvió arriba: si se llega acá es
        // porque el filtro no dejó pasar nada.
        <EmptyState
          icon={Search}
          title="Ningún ítem entra en este filtro"
          subtitle={
            filtroTexto === null
              ? 'Cambia de filtro para ver otros ítems.'
              : `Ninguno de los ${items.length} ítems de este inventario cumple con ${filtroTexto}. Abre Filtros y quita alguno.`
          }
        />
      ) : (
        <View
          style={styles.marco}
          onLayout={(e) => {
            const ancho = Math.round(e.nativeEvent.layout.width);
            setAnchoDisponible((previo) => (previo === ancho ? previo : ancho));
          }}
        >
          {/*
            EL ENCABEZADO NO SCROLLEA CON LAS FILAS, pero sí con las columnas:
            por eso vive DENTRO del scroll horizontal y FUERA de la lista
            vertical. Con 985 filas, un encabezado que se va para arriba al
            primer scrollazo deja diez columnas de números sin nombre.
          */}
          {/*
            LAS BARRAS DE SCROLL SÍ SE VEN, al revés que en el teléfono (donde
            la skill las pide ocultas). En una PC no hay gesto que descubra que
            hay más: la barra horizontal es lo único que avisa que quedan
            columnas a la derecha, y la vertical es la que dice en qué parte de
            las 985 filas está parado. Ocultarlas sería copiar un criterio
            táctil a una plataforma que no tiene el gesto.
          */}
          <ScrollView
            horizontal
            style={styles.scrollHorizontal}
            contentContainerStyle={styles.scrollHorizontalContenido}
          >
            <View style={{ width: anchoTabla }}>
              <View style={styles.encabezado}>
                {columnas.map((columna) => (
                  <Text
                    key={columna.clave}
                    style={[
                      styles.encabezadoCelda,
                      { width: columna.ancho },
                      columna.numerica ? styles.celdaNumerica : null,
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {columna.titulo}
                  </Text>
                ))}
              </View>

              {/*
                FlatList y no un `.map`: 985 filas montadas de una cuelgan el
                navegador antes de pintar nada (con el catálogo completo son
                hasta 8.000). `getItemLayout` va porque el alto es fijo -- sin
                él la lista mide fila por fila y la barra de scroll salta.

                Sin `removeClippedSubviews`: en web deja filas en blanco al
                scrollear rápido, y acá no compra nada (el navegador ya no
                dibuja lo que está fuera de la ventana).
              */}
              <FlatList
                style={styles.lista}
                data={visibles}
                extraData={columnas}
                keyExtractor={(item) => String(item.productoId)}
                renderItem={({ item }) => <Fila item={item} columnas={columnas} />}
                getItemLayout={(_datos, indice) => ({
                  length: ALTO_FILA,
                  offset: ALTO_FILA * indice,
                  index: indice,
                })}
                initialNumToRender={30}
                maxToRenderPerBatch={30}
                windowSize={11}
              />
            </View>
          </ScrollView>
        </View>
      )}

      {items.length > 0 && !cargando && error === null && visibles.length > 0 ? (
        <View style={styles.pie}>
          {/*
            EL TOTAL ES EL DEL INVENTARIO, no el del filtro. Si se muestra el
            del filtro, se dice que es del filtro -- por eso la frase tiene las
            dos cifras y no una sola. Es el MISMO texto que el pie del teléfono.
          */}
          <Text style={styles.pieTexto}>
            Mostrando {visibles.length} de <Text style={styles.pieFuerte}>{items.length} ítems</Text> ·{' '}
            {resumen.contados} {pluralizar(resumen.contados, 'contado', 'contados')} · {resumen.conDiferencia} con
            diferencia en total
          </Text>
        </View>
      ) : null}

      {/* Fuera de la tabla: es un `Modal`, se monta sobre todo. `onAplicar` es
          el ÚNICO camino por el que el filtro llega a la lista. Es el MISMO
          componente que usa el teléfono. */}
      <ModalFiltrosMatriz
        visible={modalFiltrosVisible}
        items={items}
        veredictoPorId={resumen.veredictoPorId}
        filtro={filtro}
        onAplicar={(f) => {
          setFiltro(f);
          setModalFiltrosVisible(false);
        }}
        onCerrar={() => setModalFiltrosVisible(false)}
      />
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: 16, paddingTop: 8, gap: 14 },
  cargando: { marginTop: 24 },
  tarjeta: {
    padding: 15,
    gap: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.borde,
    backgroundColor: colors.campo,
  },
  tarjetaTitulo: { fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
  tarjetaTexto: { fontSize: 12.5, lineHeight: 18, color: colors.gris, fontFamily: fonts.regular },

  barraHerramientas: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  btnFiltros: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    minHeight: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borde,
    backgroundColor: colors.campo,
  },
  btnFiltrosTexto: { fontSize: 14, color: colors.tinta, fontFamily: fonts.semibold },
  filtrosBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.rojo,
  },
  filtrosBadgeTexto: { fontSize: 12, color: colors.blanco, fontFamily: fonts.bold },
  btnActualizar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    minHeight: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borde,
    backgroundColor: colors.campo,
  },
  btnActualizarTexto: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.semibold },
  btnActualizarInerte: { color: colors.grisClaro },
  /** Qué está aplicado: dato, no acción — gris y sin peso. */
  filtroActivo: { flex: 1, fontSize: 11.5, lineHeight: 16, color: colors.gris, fontFamily: fonts.regular },

  marco: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
    backgroundColor: colors.campo,
    overflow: 'hidden',
  },
  scrollHorizontal: { flex: 1 },
  scrollHorizontalContenido: { flexGrow: 1 },
  lista: { flex: 1 },

  encabezado: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ALTO_FILA,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.borde,
    backgroundColor: colors.esperaSuave,
  },
  encabezadoCelda: {
    paddingHorizontal: 8,
    fontSize: 11.5,
    color: colors.gris,
    fontFamily: fonts.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ALTO_FILA,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.borde,
  },
  /** Faltante y sobrante. Solo las filas con diferencia: son 6 de 985. */
  filaFalta: { backgroundColor: colors.faltaSuave },
  filaSobra: { backgroundColor: colors.okSuave },

  celda: {
    paddingHorizontal: 8,
    fontSize: 13,
    color: colors.tinta,
    fontFamily: fonts.regular,
  },
  /**
   * Las cifras a la derecha y con `tabular-nums`: todos los dígitos ocupan lo
   * mismo, así que las unidades quedan bajo las unidades y las decenas bajo
   * las decenas. Sin eso, una columna de números con la fuente proporcional se
   * desalinea y hay que leer cifra por cifra en vez de barrerla con la vista.
   */
  celdaNumerica: {
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    fontFamily: fonts.medium,
  },
  celdaFuerte: { fontFamily: fonts.bold },

  pie: { padding: 11, borderRadius: 11, backgroundColor: colors.esperaSuave },
  pieTexto: { fontSize: 12.5, lineHeight: 18, color: colors.gris, fontFamily: fonts.regular },
  pieFuerte: { color: colors.tinta, fontFamily: fonts.bold },

  accion: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.rojo,
  },
  accionTexto: { fontSize: 15, color: colors.blanco, fontFamily: fonts.bold },
});
