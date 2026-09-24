import { router } from 'expo-router';
import { BarChart3, Filter, RefreshCw, Search } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { CeldaTexto, EncabezadoPagina, TablaWeb, type ColumnaTabla, type TinteFila } from '../../components/web';
import {
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
import { colors, fonts, radius, spacing } from '../../lib/theme';

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
 * Lo que ocupa la tarjeta de `TablaWeb` fuera de las filas: su encabezado con
 * el chip y las herramientas (~70), la cabecera de columnas (~40) y el pie
 * (~36). Se le resta al alto medido para saber cuánto le queda a la lista.
 */
const ALTO_CHROME_TABLA = 146;

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

/**
 * Una columna de ESTA pantalla antes de pasarla a `TablaWeb`.
 *
 * Se declara aparte y no se arma el `ColumnaTabla` directo porque el ancho de
 * "Descripción" depende de lo que sobre, y para eso hace falta sumar los
 * anchos ANTES de convertir. `numerica` viaja hasta el final: decide la
 * alineación de la columna Y el `tabular-nums` de la celda, que son dos cosas
 * distintas en `TablaWeb`.
 */
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

export default function MatrizWebScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ItemAuditoria[]>([]);
  const [filtro, setFiltro] = useState<FiltroMatriz>(FILTRO_MATRIZ_VACIO);
  const [modalFiltrosVisible, setModalFiltrosVisible] = useState(false);
  /**
   * Lo que mide la página; lo que sobra se lo lleva "Descripción".
   *
   * Se mide ACÁ y no en la tabla porque `TablaWeb` no expone su ancho: recibe
   * `anchoTotal` ya calculado. Se le resta el padding de la página a mano --
   * `onLayout` devuelve el ancho del contenedor, no el del contenido.
   */
  const [anchoDisponible, setAnchoDisponible] = useState(0);
  /**
   * El alto de la zona donde entra la tabla.
   *
   * HACE FALTA, no es cosmético: `TablaWeb` pagina por SCROLL, y su `FlatList`
   * solo dispara `onEndReached` si tiene un alto acotado. Sin esto la lista
   * crece con su contenido, nadie llega nunca al final y la tabla se queda
   * clavada en la primera tanda de 60 -- con la barra de scroll de la ventana
   * corriendo por debajo de una tabla que se sale de la pantalla.
   *
   * Se MIDE en vez de estimarse: la ventana de una PC cambia de tamaño, y un
   * alto fijo deja aire abajo en un monitor grande y corta filas en uno chico.
   */
  const [altoZona, setAltoZona] = useState(0);

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

  /**
   * Las mismas columnas, en la forma que pide `TablaWeb`.
   *
   * Todas llevan `ancho` FIJO, ninguna `flex`: con `anchoTotal` la tabla se
   * desplaza a lo ancho, y una columna elástica adentro de un contenedor más
   * ancho que la pantalla no tiene contra qué repartirse. El reparto del
   * sobrante ya lo hizo el `useMemo` de arriba.
   */
  const columnasTabla = useMemo<ColumnaTabla<ItemAuditoria>[]>(
    () =>
      columnas.map((col) => ({
        clave: col.clave,
        titulo: col.titulo,
        ancho: col.ancho,
        ...(col.numerica ? { alinear: 'derecha' as const } : {}),
        celda: (item: ItemAuditoria) => {
          const celda = col.celda(item);
          const texto = (
            <CeldaTexto
              numero={col.numerica}
              fuerte={celda.fuerte === true}
              {...(celda.color === undefined ? {} : { color: celda.color })}
            >
              {celda.texto}
            </CeldaTexto>
          );
          // LA ETIQUETA QUE EXPLICA EL GUION. "—" solo no dice nada a un
          // lector de pantalla, y es justamente el caso donde hay algo que
          // decir ("Sin hoja asignada"). Va en un `View` accesible porque
          // `CeldaTexto` no toma etiqueta: envolver es más barato que
          // agregarle una prop a la tabla compartida por un caso de una
          // pantalla.
          return celda.etiqueta === undefined ? (
            texto
          ) : (
            <View accessible accessibilityLabel={celda.etiqueta}>
              {texto}
            </View>
          );
        },
      })),
    [columnas],
  );

  const anchoTabla = useMemo(() => columnas.reduce((suma, c) => suma + c.ancho, 0), [columnas]);

  /**
   * EL TINTE, SOLO PARA LO QUE HAY QUE MIRAR. Las 979 filas que cuadran quedan
   * en blanco: si se pintan todas, el color deja de señalar nada y las 6 que
   * importan se pierden entre las demás.
   */
  const tinteDeFila = useCallback((item: ItemAuditoria): TinteFila => {
    const dif = diferenciaUnidades(item);
    if (dif === null || dif === 0) return null;
    return dif < 0 ? 'falta' : 'ok';
  }, []);

  const filtrosActivos = contarFiltrosActivos(filtro);
  const filtroTexto = textoFiltroActivo(filtro);

  if (!sesion) return <View />;

  const sucursalId = sucursalEnFoco({
    rol: sesion.colaborador.rol,
    sucursalDeSesion: sesion.sucursal?.id ?? null,
    elegida: sucursalElegida,
  });
  const nombreSucursal = sucursales.find((s) => s.id === sucursalId)?.nombre ?? sesion.sucursal?.nombre;


  return (
    // `anchoCompleto`: una tabla de diez columnas no entra en el tope de
    // lectura de 1120px, y el tope existe para un renglón de texto, no para
    // esto. Es opt-in, así que ninguna otra pantalla se entera.
    <View
      style={styles.pagina}
      onLayout={(e) => {
        // El ancho ÚTIL: el del contenedor menos su padding a los dos lados.
        // Es lo que se reparte entre las columnas, y de acá sale lo que le
        // sobra a "Descripción".
        const ancho = Math.round(e.nativeEvent.layout.width) - spacing.xxl * 2;
        setAnchoDisponible((previo) => (previo === ancho ? previo : ancho));
      }}
    >
      {/* El mismo encabezado que el Panel: miga de pan, titulo grande y la
          tienda debajo. `BarraApp` es la barra del telefono -- rotulo chiquito
          y boton de salir -- y acá el salir vive en la barra lateral. */}
      <EncabezadoPagina
        migas={['Auditoría', 'Matriz comparativa']}
        titulo="Matriz comparativa"
        sub={
          cargando
            ? 'Revisando ítem por ítem contra el stock del ERP.'
            : // `contados` estaba en el pie propio de la pantalla, que se fue
              // con la tabla compartida. No se pierde: sube acá, donde además
              // es SIEMPRE del inventario entero y no de lo que dejó el filtro.
              `${items.length} ${pluralizar(items.length, 'ítem', 'ítems')} · ${resumen.contados} ${pluralizar(resumen.contados, 'contado', 'contados')} · ${resumen.conDiferencia} con diferencia`
        }
        onInicio={() => router.push('/auditor')}
      />

      <SelectorSucursal
        label="Sucursal a auditar"
        sucursales={sucursales}
        sucursalId={sucursalId}
        onElegir={setSucursalElegida}
      />

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
      ) : (
        <View
          style={styles.zonaTabla}
          onLayout={(e) => {
            const alto = Math.round(e.nativeEvent.layout.height);
            setAltoZona((previo) => (previo === alto ? previo : alto));
          }}
        >
        <TablaWeb
          titulo="Matriz comparativa"
          sub={filtroTexto === null ? undefined : `Filtro: ${filtroTexto}`}
          icono={BarChart3}
          columnas={columnasTabla}
          filas={visibles}
          claveDe={(item) => String(item.productoId)}
          tinteDeFila={tinteDeFila}
          // ONCE COLUMNAS no entran en ninguna pantalla: con `anchoTotal` la
          // tabla se desplaza a lo ancho y la cabecera viaja con las filas.
          anchoTotal={anchoTabla}
          // El alto de las FILAS: la zona medida menos lo que ocupa el resto de
          // la tarjeta (encabezado, cabecera de columnas y pie). Se descuenta
          // con una constante porque esas tres partes son de `TablaWeb` y esta
          // pantalla no las mide; si algún día cambian de alto, lo que se nota
          // es un poco de aire abajo, no una tabla rota.
          {...(altoZona > ALTO_CHROME_TABLA ? { alto: altoZona - ALTO_CHROME_TABLA } : {})}
          // NO se pasa `onAbrirFila`: desde acá no se abre ningún detalle, y
          // una mano del cursor sobre una fila que no responde es una promesa
          // rota. Corregir un conteo vive en su propia pantalla.
          herramientas={
            <>
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

              {/* EN EL NAVEGADOR NO HAY "TIRAR PARA REFRESCAR": no hay gesto.
                  La pantalla igual se recarga sola al enfocarse y al volver al
                  frente, pero sin un control a mano la única salida es F5, que
                  recarga la app entera. */}
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
            </>
          }
          vacio={
            // La matriz completa vacía ya se resolvió arriba: si se llega acá
            // es porque el filtro no dejó pasar nada.
            <EmptyState
              icon={Search}
              title="Ningún ítem entra en este filtro"
              subtitle={
                filtroTexto === null
                  ? 'Cambia de filtro para ver otros ítems.'
                  : `Ninguno de los ${items.length} ítems de este inventario cumple con ${filtroTexto}. Abre Filtros y quita alguno.`
              }
            />
          }
        />
        </View>
      )}

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
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * SIN `backgroundColor`, a proposito: asi se ve el lienzo gris del marco
   * (`RolTabsLayout.web.tsx`). Cualquier pantalla que pinte blanco acá tapa el
   * lienzo y las tarjetas dejan de despegarse del fondo.
   */
  pagina: { flex: 1, padding: spacing.xxl, gap: spacing.lg },
  /** Se come el alto que sobra: de acá sale el `alto` que la tabla necesita para paginar. */
  zonaTabla: { flex: 1 },
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






  accion: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.rojo,
  },
  accionTexto: { fontSize: 15, color: colors.blanco, fontFamily: fonts.bold },
});
