import { router } from 'expo-router';
import { Check, Lock, RefreshCw, Scale, Store, TriangleAlert, X } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { ChipsFiltro, SelectorSucursal, formatoMiles } from '../../components/ui';
import { interpretarCantidad } from '../../components/ui/cantidad-numerica';
import { BadgeEstado, BotonWeb, ChipIcono, EncabezadoPagina, TarjetaWeb } from '../../components/web';
import { cargarSeguro } from '../../lib/adaptadores/_http';
import { repositorioAjuste, repositorioAuditoria, repositorioInventario, repositorioSesion } from '../../lib/contenedor';
import { errorDeMotivo, faseDeCierre, puedeAjustar } from '../../lib/dominio/ajuste-final';
import { conteoFinal, diferenciaUnidades, veredicto } from '../../lib/dominio/auditoria';
import { pluralizar } from '../../lib/dominio/plural';
import { sucursalEnFoco } from '../../lib/dominio/sucursal-en-foco';
import { ordinal } from '../../lib/dominio/texto-cierre-ronda';
import type { ItemAuditoria, Sucursal } from '../../lib/dominio/tipos';
import { useSesion } from '../../lib/sesion-contexto';
import { useSucursalAuditada } from '../../lib/sucursal-auditada-contexto';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';

type Filtro = 'sin-cuadrar' | 'todos';

/**
 * ---------------------------------------------------------------------------
 * EL AJUSTE FINAL EN EL NAVEGADOR
 * ---------------------------------------------------------------------------
 * Clon de `ajuste.tsx` con el diseño de la web. El del teléfono NO se toca --
 * decisión del usuario, textual: *"no utilices la misma pantalla del móvil,
 * clónalo y cámbialo, en todo caso son plataformas diferentes"*. Metro elige
 * este archivo cuando el bundle es de web.
 *
 * LA FUNCIONALIDAD ES LA MISMA: mismos repositorios, mismas reglas
 * (`puedeAjustar`, `errorDeMotivo`, `veredicto`), mismos textos y los mismos
 * estados vacíos. Lo único que cambia es la forma.
 *
 * ---------------------------------------------------------------------------
 * LA LISTA ES UNA TABLA, Y ES EL CAMBIO QUE JUSTIFICA LA PANTALLA
 * ---------------------------------------------------------------------------
 * En el teléfono cada ítem es una tarjeta: una columna de 400px no aguanta el
 * ERP, cuatro rondas y la diferencia. El Auditor los pasa con el dedo de a
 * uno. En una PC lo que hace es recorrer la columna "Diferencia" de arriba
 * abajo buscando dónde se rompe, y eso es una tabla -- la misma que ya usa
 * `matriz.web.tsx`, con una diferencia: acá cada fila SE TOCA para abrir el
 * ajuste, así que la fila es un `Pressable` y no un `View`.
 *
 * ---------------------------------------------------------------------------
 * `Alert.alert` NO EXISTE EN WEB, Y ESTA PANTALLA VIVÍA DE ÉL
 * ---------------------------------------------------------------------------
 * En react-native-web `Alert.alert` es literalmente un método vacío
 * (`node_modules/react-native-web/dist/exports/Alert/index.js`: `static
 * alert() {}`). Copiar el archivo del teléfono tal cual habría dejado el botón
 * de cerrar el ajuste MUERTO -- la confirmación nunca se muestra y la acción
 * cuelga de su callback -- y los errores de guardado mudos.
 *
 * Así que los tres usos se resuelven en la página, con los MISMOS textos:
 *   - las confirmaciones, en un diálogo con la forma de una tarjeta del
 *     diseño (`DialogoConfirmar`), con los mismos dos botones;
 *   - los errores y los avisos, en una banda arriba de la lista (`aviso`).
 * No es funcionalidad nueva: es la misma, por el único camino que este
 * entorno tiene.
 */

/** Abajo de esto las columnas se apilan: es media pantalla en una PC, no un teléfono. */
const ANCHO_ANGOSTO = 1180;

/** Alto de fila FIJO: con eso `getItemLayout` no mide 8.000 filas y el scroll no salta. */
const ALTO_FILA = 44;

/** El ancho de "Descripción" antes de repartirle el espacio sobrante. */
const ANCHO_DESCRIPCION = 320;

/** Sin dato es "—", nunca un 0: un cero es una afirmación, el guion es "no sé". */
const SIN_DATO = '—';

interface Celda {
  texto: string;
  color?: string;
  fuerte?: boolean;
}

interface Columna {
  clave: string;
  titulo: string;
  ancho: number;
  /** Derecha y `tabular-nums`: las cifras se comparan de un vistazo, columna abajo. */
  numerica: boolean;
  celda: (item: ItemAuditoria) => Celda;
  /** Cuando la celda no es texto (el badge de estado). Si está, gana sobre `celda`. */
  nodo?: (item: ItemAuditoria) => ReactNode;
}

function numero(valor: number | null | undefined): Celda {
  return valor === null || valor === undefined ? { texto: SIN_DATO, color: colors.grisClaro } : { texto: formatoMiles(valor) };
}

/**
 * LA DIFERENCIA, CON SIGNO Y COLOR -- la misma regla que la matriz. `null` =
 * no se puede afirmar nada (sin stock del ERP o sin ningún conteo), y ahí va
 * el guion gris: un 0 diría "conté exactamente lo que decía el ERP", que es
 * justo lo contrario.
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

interface FilaProps {
  item: ItemAuditoria;
  columnas: readonly Columna[];
  onPress: () => void;
}

/**
 * `memo` por lo mismo que la matriz: son cientos de filas montadas y sin esto
 * cada cambio del padre (poner un filtro) las vuelve a renderizar todas.
 */
const Fila = memo(function FilaComponent({ item, columnas, onPress }: FilaProps): JSX.Element {
  // EL TINTE ES SOLO PARA LO QUE TIENE DIFERENCIA: si se pintan todas, el
  // color deja de señalar nada y las que importan se pierden entre las demás.
  const dif = diferenciaUnidades(item);
  const tinte = dif === null || dif === 0 ? null : dif < 0 ? styles.filaFalta : styles.filaSobra;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Ajustar ${item.descripcion}`}
      style={({ pressed }) => [styles.fila, tinte, pressed && styles.filaPresionada]}
    >
      {columnas.map((columna) => {
        if (columna.nodo) {
          return (
            <View key={columna.clave} style={[styles.celdaNodo, { width: columna.ancho }]}>
              {columna.nodo(item)}
            </View>
          );
        }
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
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {celda.texto}
          </Text>
        );
      })}
    </Pressable>
  );
});

/** Lo que pasó con la última acción: se dice en la página, no en un `Alert` que acá no existe. */
interface Aviso {
  texto: string;
  tono: 'ok' | 'error';
}

export default function AjusteWebScreen(): JSX.Element {
  const { sesion } = useSesion();
  const { width, height } = useWindowDimensions();
  const angosto = width < ANCHO_ANGOSTO;

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inventarioId, setInventarioId] = useState<number | null>(null);
  const [fase, setFase] = useState<ReturnType<typeof faseDeCierre> | null>(null);
  const [items, setItems] = useState<ItemAuditoria[]>([]);
  const [filtro, setFiltro] = useState<Filtro>('sin-cuadrar');
  const [enEdicion, setEnEdicion] = useState<ItemAuditoria | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [cerrandoAjuste, setCerrandoAjuste] = useState(false);
  const [confirmarCerrar, setConfirmarCerrar] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  /** Lo que mide el marco de la tabla; lo que sobra se lo lleva "Descripción". */
  const [anchoDisponible, setAnchoDisponible] = useState(0);

  // La sucursal COMPARTIDA con Auditoría, Ciclo, Liquidación e Historial:
  // elegir acá la cambia en todas (ver lib/sucursal-auditada-contexto.tsx).
  const { elegida, elegir } = useSucursalAuditada();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  useEffect(() => {
    repositorioSesion.sucursales().then(setSucursales).catch(() => undefined);
  }, []);
  const sucursalId = sucursalEnFoco({
    rol: sesion?.colaborador.rol ?? 'auditor',
    sucursalDeSesion: sesion?.sucursal?.id ?? null,
    elegida,
  });

  const cargar = useCallback(async () => {
    if (!sesion) return;
    if (sucursalId === null) {
      setItems([]);
      setInventarioId(null);
      setFase(null);
      setCargando(false);
      return;
    }
    setError(null);
    const falla = await cargarSeguro(async () => {
      const activo = await repositorioInventario.activo(sucursalId);
      setInventarioId(activo?.inventarioId ?? null);
      setFase(activo ? faseDeCierre(activo.estado, activo.rondaActiva, activo.totalHojas, activo.ultimaRondaCerrada) : null);
      setItems(activo ? await repositorioAuditoria.matriz(activo.inventarioId) : []);
    });
    setCargando(false);
    if (falla) setError(falla.message);
  }, [sesion, sucursalId]);

  // Pausado mientras hay un valor a medio escribir: un refresco a mitad de
  // tipear el motivo borraría el borrador (ver useRefrescoAlEnfocar.ts).
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar, { pausado: enEdicion !== null || guardando });

  // Cambió la tienda elegida: recargar YA y limpiar lo anterior ANTES. La
  // banda ya dice la tienda nueva, y dejar la matriz de la otra sería un
  // número con el apellido equivocado (mismo criterio que auditoria.web.tsx).
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

  const sinCuadrar = useMemo(() => items.filter((i) => veredicto(i) === 'falta' || veredicto(i) === 'empresa'), [items]);
  const visibles = filtro === 'sin-cuadrar' ? sinCuadrar : items;

  /**
   * CUÁNTAS RONDAS TUVO ESTE INVENTARIO -- no tres fijas. El Auditor abre un
   * 4to o un 5to conteo cuando no le cierra: una tabla de tres columnas se
   * comería la última pasada, que es justo la que fijó el número.
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
      // "ERP" y no "Stock": es el nombre con el que el Auditor lo pide.
      { clave: 'erp', titulo: 'ERP', ancho: 86, numerica: true, celda: (it) => numero(it.stockErp) },
      ...Array.from({ length: rondas }, (_, indice) => ({
        clave: `ronda-${indice}`,
        // `ordinal` es la MISMA función que nombra las rondas en el Ciclo y en
        // la matriz: una sola fuente para "1er/2do/3er/4to".
        titulo: ordinal(indice + 1),
        ancho: 74,
        numerica: true,
        celda: (it: ItemAuditoria): Celda => numero(it.conteos[indice]),
      })),
      { clave: 'diferencia', titulo: 'Diferencia', ancho: 106, numerica: true, celda: celdaDiferencia },
      {
        clave: 'estado',
        titulo: 'Estado',
        ancho: 156,
        numerica: false,
        celda: () => ({ texto: '' }),
        nodo: (it) => <BadgeEstado veredicto={veredicto(it)} />,
      },
    ];
    // Lo que sobra del ancho se lo lleva la descripción, la única columna que
    // de verdad puede usarlo: el resto son cifras cortas y estirarlas solo
    // aleja el número de su encabezado.
    const sobra = Math.max(0, anchoDisponible - base.reduce((suma, c) => suma + c.ancho, 0));
    if (sobra === 0) return base;
    return base.map((c) => (c.clave === 'descripcion' ? { ...c, ancho: c.ancho + sobra } : c));
  }, [rondas, anchoDisponible]);

  const anchoTabla = useMemo(() => columnas.reduce((suma, c) => suma + c.ancho, 0), [columnas]);

  /**
   * La tabla scrollea DENTRO de su marco y no estira la página: con "Todos"
   * son hasta 8.000 ítems, y una página de 8.000 filas deja el botón de
   * cerrar el ajuste a media hora de scroll. El alto sale de la ventana para
   * que en un monitor grande se vean más filas sin tocar nada.
   */
  const altoTabla = Math.max(280, Math.round(height - 430));

  if (!sesion) return <View style={styles.centro} />;

  const enAjuste = fase !== null && puedeAjustar(fase);

  async function guardarAjuste(item: ItemAuditoria, unidades: number, motivo: string): Promise<void> {
    if (inventarioId === null) return;
    setGuardando(true);
    try {
      // `empaques: []` + las unidades como sueltas: el valor que el Auditor
      // fija ya está en la unidad del ERP (ver la cabecera de ajuste.tsx).
      await repositorioAjuste.ajustarItem(inventarioId, item.productoId, { empaques: [], sueltas: unidades, motivo });
      setEnEdicion(null);
      setAviso(null);
      // Se vuelve a pedir la matriz entera: el ajuste puede cambiar el
      // veredicto del ítem (de "falta" a "cuadrado"), y con él el filtro
      // "Sin cuadrar" y los contadores de los chips. Recalcularlo a mano acá
      // sería una segunda copia de `veredicto()`.
      await cargar();
    } catch (e) {
      setAviso({
        tono: 'error',
        texto: `No se pudo ajustar el ítem. ${e instanceof Error ? e.message : 'Revisa la conexión con la tienda y vuelve a intentarlo.'}`,
      });
    } finally {
      setGuardando(false);
    }
  }

  async function cerrarAjusteAhora(): Promise<void> {
    if (inventarioId === null) return;
    setConfirmarCerrar(false);
    setCerrandoAjuste(true);
    try {
      await repositorioAjuste.cerrarAjuste(inventarioId);
      setAviso({
        tono: 'ok',
        texto: 'Ajuste cerrado. El conteo de este inventario quedó cerrado. El paso que sigue es la liquidación.',
      });
      await cargar();
    } catch (e) {
      setAviso({
        tono: 'error',
        texto: `No se pudo cerrar el ajuste. ${e instanceof Error ? e.message : 'Intenta de nuevo en un momento.'}`,
      });
    } finally {
      setCerrandoAjuste(false);
    }
  }

  return (
    <>
      <ScrollView style={styles.pagina} contentContainerStyle={styles.contenido} showsVerticalScrollIndicator={false}>
        <EncabezadoPagina
          migas={['Auditoría', 'Ajuste final']}
          titulo="Ajuste final"
          sub="Fija el valor definitivo de cada ítem contra el stock del ERP. Cada cambio queda registrado con tu nombre."
          onInicio={() => router.push('/auditor')}
          acciones={
            // EN EL NAVEGADOR NO HAY "TIRAR PARA REFRESCAR": no hay gesto. La
            // pantalla se recarga sola al enfocarse, pero sin un control a mano
            // la única salida es F5, que recarga la app entera.
            <BotonWeb
              etiqueta={refrescando ? 'Actualizando…' : 'Actualizar'}
              icono={RefreshCw}
              onPress={refrescar}
              deshabilitado={refrescando}
            />
          }
        />

        {/* LA TIENDA Y SU ESTADO: son el contexto de todo lo de abajo. Sin
            esto, una tabla de cifras no dice de qué tienda ni de qué momento
            habla. */}
        <View style={[styles.banda, angosto && styles.bandaApilada]}>
          <View style={styles.bandaTienda}>
            <ChipIcono icono={Store} />
            <View style={styles.bandaTextos}>
              <Text style={styles.bandaEtiqueta}>Sucursal a auditar</Text>
              <SelectorSucursal label="" sucursales={sucursales} sucursalId={sucursalId} onElegir={elegir} />
              {enAjuste && !cargando ? (
                <Text style={styles.bandaSub}>
                  {formatoMiles(sinCuadrar.length)}{' '}
                  {pluralizar(sinCuadrar.length, 'ítem sin cuadrar', 'ítems sin cuadrar')} de {formatoMiles(items.length)}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Ámbar mientras el ajuste está abierto -- espera una decisión -- y
              gris cuando todavía no empezó. Nunca rojo: acá el rojo es el
              botón de cerrar, que es lo único irreversible de la pantalla. */}
          <View style={[styles.cartel, enAjuste ? styles.cartelAtencion : styles.cartelNeutro]}>
            <Scale size={22} color={enAjuste ? colors.proceso : colors.gris} />
            <View style={styles.cartelTextos}>
              <Text style={[styles.cartelTitulo, { color: enAjuste ? colors.proceso : colors.gris }]}>
                {enAjuste ? 'Ajuste final en curso' : 'El ajuste final no empezó'}
              </Text>
              <Text style={styles.cartelDetalle}>
                {enAjuste
                  ? 'Mientras dure el ajuste, el coordinador no puede corregir nada.'
                  : 'El coordinador todavía puede corregir lo que cargaron los contadores.'}
              </Text>
            </View>
          </View>
        </View>

        {cargando ? (
          <ActivityIndicator color={colors.rojo} style={styles.cargando} />
        ) : error !== null ? (
          <TarjetaWeb titulo="No se pudo cargar el ajuste" icono={TriangleAlert} tono="neutro">
            <Text style={styles.parrafo}>{error}</Text>
            <BotonWeb etiqueta="Volver a intentar" variante="principal" onPress={refrescar} />
          </TarjetaWeb>
        ) : !enAjuste ? (
          // NO dice "vuelve a intentar": mientras el ajuste no se inicie esto
          // no cambia solo, y una regla de negocio disfrazada de error deja a
          // la persona tocando un botón en loop.
          <TarjetaWeb titulo="El ajuste final todavía no empezó" icono={Lock} tono="neutro">
            <Text style={styles.parrafo}>
              El ajuste se inicia desde Ciclo de conteos, con la última ronda ya cerrada. Hasta entonces el coordinador
              todavía puede corregir lo que cargaron los contadores.
            </Text>
            <BotonWeb etiqueta="Ir al ciclo de conteos" onPress={() => router.push('/auditor/ciclo')} />
          </TarjetaWeb>
        ) : (
          <>
            <View style={styles.aviso}>
              <Scale size={16} color={colors.gris} />
              <Text style={styles.avisoTexto}>
                Toca un ítem para fijar su valor definitivo contra el stock del ERP. Cada cambio pide un motivo y queda
                registrado con tu nombre. Mientras dure el ajuste, el coordinador no puede corregir nada.
              </Text>
            </View>

            {/* El resultado de la última acción. Va ARRIBA de la lista porque
                la lista se recarga y se reordena debajo: al pie quedaría fuera
                de pantalla justo después de guardar. */}
            {aviso !== null ? (
              <View style={[styles.resultado, aviso.tono === 'ok' ? styles.resultadoOk : styles.resultadoError]}>
                {aviso.tono === 'ok' ? (
                  <Check size={16} color={colors.ok} />
                ) : (
                  <TriangleAlert size={16} color={colors.falta} />
                )}
                <Text style={styles.resultadoTexto}>{aviso.texto}</Text>
                <Pressable onPress={() => setAviso(null)} accessibilityLabel="Cerrar el aviso" style={styles.resultadoCerrar}>
                  <X size={15} color={colors.gris} />
                </Pressable>
              </View>
            ) : null}

            <TarjetaWeb
              titulo="Ítems del inventario"
              sub="Cada fila abre el ajuste de ese ítem."
              icono={Scale}
              tono="atencion"
            >
              <ChipsFiltro
                opciones={[
                  { id: 'sin-cuadrar', etiqueta: 'Sin cuadrar', contador: sinCuadrar.length },
                  { id: 'todos', etiqueta: 'Todos', contador: items.length },
                ]}
                activo={filtro}
                onCambiar={(id) => setFiltro(id as Filtro)}
              />

              {visibles.length === 0 ? (
                <View style={styles.vacio}>
                  <Check size={22} color={colors.ok} />
                  <Text style={styles.vacioTitulo}>
                    {filtro === 'sin-cuadrar' ? 'No queda ningún ítem sin cuadrar' : 'Este inventario no tiene ítems'}
                  </Text>
                  <Text style={styles.parrafo}>
                    {filtro === 'sin-cuadrar'
                      ? 'Todo lo que tiene stock del ERP y conteo coincide. Puedes cerrar el ajuste, o mirar la lista completa.'
                      : 'La matriz de auditoría llegó vacía: sin ítems no hay nada que ajustar.'}
                  </Text>
                </View>
              ) : (
                <View
                  style={[styles.marco, { height: altoTabla }]}
                  onLayout={(e) => {
                    const ancho = Math.round(e.nativeEvent.layout.width);
                    setAnchoDisponible((previo) => (previo === ancho ? previo : ancho));
                  }}
                >
                  {/*
                    EL ENCABEZADO NO SCROLLEA CON LAS FILAS, pero sí con las
                    columnas: por eso vive DENTRO del scroll horizontal y FUERA
                    de la lista vertical. Un encabezado que se va para arriba al
                    primer scrollazo deja las columnas de números sin nombre.

                    LAS BARRAS DE SCROLL SÍ SE VEN, al revés que en el teléfono:
                    en una PC no hay gesto que descubra que hay más.
                  */}
                  <ScrollView horizontal style={styles.scrollHorizontal} contentContainerStyle={styles.scrollHorizontalContenido}>
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
                        FlatList y no un `.map`: con el catálogo completo son
                        hasta 8.000 filas y montarlas de una cuelga el navegador
                        antes de pintar nada. `getItemLayout` va porque el alto
                        es fijo -- sin él la lista mide fila por fila y la barra
                        de scroll salta.
                      */}
                      <FlatList
                        style={styles.lista}
                        data={visibles}
                        extraData={columnas}
                        keyExtractor={(item) => String(item.productoId)}
                        renderItem={({ item }) => (
                          <Fila item={item} columnas={columnas} onPress={() => setEnEdicion(item)} />
                        )}
                        getItemLayout={(_datos, indice) => ({ length: ALTO_FILA, offset: ALTO_FILA * indice, index: indice })}
                        initialNumToRender={30}
                        maxToRenderPerBatch={30}
                        windowSize={11}
                      />
                    </View>
                  </ScrollView>
                </View>
              )}

              <Text style={styles.pie}>
                Mostrando {formatoMiles(visibles.length)} de <Text style={styles.pieFuerte}>{formatoMiles(items.length)} ítems</Text>
              </Text>
            </TarjetaWeb>

            {/*
              EL CIERRE VA AL FINAL, después de la lista: es lo último que se
              hace, y arriba invitaría a firmar sin haber mirado los ítems. Es
              el ÚNICO botón rojo de la pantalla.
            */}
            <TarjetaWeb titulo="Cerrar el ajuste final" icono={Lock}>
              <Text style={styles.parrafo}>
                Los valores quedan firmes y pasan a la liquidación. Después de esto nadie los cambia: ni tú ni el
                coordinador.
              </Text>
              <BotonWeb
                etiqueta={cerrandoAjuste ? 'Cerrando el ajuste…' : 'Cerrar el ajuste y fijar los valores'}
                icono={Lock}
                variante="principal"
                onPress={() => setConfirmarCerrar(true)}
                deshabilitado={cerrandoAjuste}
                cargando={cerrandoAjuste}
              />
            </TarjetaWeb>
          </>
        )}
      </ScrollView>

      {/* Hermanos del scroll, nunca adentro: ahí el overlay queda recortado y
          se desplaza con el contenido. */}
      <ModalAjusteItemWeb
        item={enEdicion}
        guardando={guardando}
        onGuardar={(unidades, motivo) => void guardarAjuste(enEdicion!, unidades, motivo)}
        onCerrar={() => setEnEdicion(null)}
      />

      {confirmarCerrar ? (
        <DialogoConfirmar
          titulo="Cerrar el ajuste final"
          cuerpo={`Esto deja firmes los ${formatoMiles(items.length)} ${pluralizar(items.length, 'valor', 'valores')} de este inventario: son los que van a la liquidación y al lacrado. Después de esto nadie los cambia, ni tú ni el coordinador. No se puede deshacer.`}
          cancelar="Seguir ajustando"
          confirmar="Cerrar el ajuste"
          onCancelar={() => setConfirmarCerrar(false)}
          onConfirmar={() => void cerrarAjusteAhora()}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * EL DIÁLOGO DE CONFIRMACIÓN, que en el teléfono es `Alert.alert`.
 *
 * En web `Alert.alert` no hace nada, así que sin esto el botón de cerrar el
 * ajuste sería un botón muerto. Tiene la forma de una tarjeta del diseño --
 * misma sombra, mismo radio, mismo lienzo -- y los MISMOS dos botones que el
 * Alert del teléfono: el destructivo a la derecha y en rojo, el de volver a la
 * izquierda.
 *
 * No se usa `window.confirm`: no se puede darle el texto largo que este cierre
 * necesita, ni distinguir cuál de los dos botones es el destructivo.
 */
function DialogoConfirmar({
  titulo,
  cuerpo,
  cancelar,
  confirmar,
  onCancelar,
  onConfirmar,
}: {
  titulo: string;
  cuerpo: string;
  cancelar: string;
  confirmar: string;
  onCancelar: () => void;
  onConfirmar: () => void;
}): JSX.Element {
  return (
    <View style={styles.modalRaiz} pointerEvents="box-none">
      <Pressable style={styles.modalFondo} onPress={onCancelar} accessibilityLabel="Cerrar" />
      <View pointerEvents="box-none" style={styles.modalCentrado}>
        <View style={[styles.dialogoCaja, shadow.modal]}>
          <Text style={styles.dialogoTitulo}>{titulo}</Text>
          <Text style={styles.parrafo}>{cuerpo}</Text>
          <View style={styles.dialogoBotones}>
            <View style={styles.dialogoBoton}>
              <BotonWeb etiqueta={cancelar} onPress={onCancelar} />
            </View>
            <View style={styles.dialogoBoton}>
              <BotonWeb etiqueta={confirmar} variante="principal" onPress={onConfirmar} />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

interface ModalAjusteItemWebProps {
  /** null = cerrado. */
  item: ItemAuditoria | null;
  guardando: boolean;
  onGuardar: (unidades: number, motivo: string) => void;
  onCerrar: () => void;
}

/**
 * El modal del ajuste con la forma del diseño nuevo: una TARJETA sobre el
 * lienzo, con su chip de ícono y sus dos celdas de comparación.
 *
 * Lo que hace es lo mismo que en el teléfono, incluida LA DIFERENCIA CONTRA EL
 * ERP RECALCULADA EN VIVO -- que es la razón de que este modal exista y no se
 * reuse `ModalConteo`: el Auditor no está cargando una cantidad, está cerrando
 * una brecha, y ver el resultado antes de guardar es su trabajo entero.
 *
 * DOS COSAS DEL TELÉFONO QUE ACÁ NO VAN:
 *  - `BackHandler`: es el botón atrás de Android. En un navegador no existe;
 *    se sale con la X o tocando afuera, que son los mismos caminos.
 *  - El `Alert` de "Descartar el ajuste": no hace nada en web. Se reemplaza
 *    por el mismo diálogo `DialogoConfirmar`, con las mismas palabras.
 */
function ModalAjusteItemWeb({ item, guardando, onGuardar, onCerrar }: ModalAjusteItemWebProps): JSX.Element | null {
  const [texto, setTexto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [confirmarDescarte, setConfirmarDescarte] = useState(false);

  // Arranca con el valor ACTUAL del ítem, no vacío: acá no se está cargando un
  // dato nuevo, se está corrigiendo uno que ya existe, y la persona necesita
  // verlo para decidir cuánto moverlo. Cada ítem estrena su propio motivo.
  useEffect(() => {
    if (item === null) return;
    const actual = conteoFinal(item);
    setTexto(actual === null ? '' : String(actual));
    setMotivo('');
    setConfirmarDescarte(false);
  }, [item]);

  if (item === null) return null;

  const cantidad = interpretarCantidad(texto);
  const faltaMotivo = errorDeMotivo(motivo);
  const puedeGuardar = cantidad.ok && faltaMotivo === null && !guardando;

  /**
   * NO DESCARTA EN SILENCIO. Se pregunta solo si hay algo distinto de lo que
   * había al abrir: confirmar en cada salida enseña a tocar "Descartar" sin
   * leer.
   */
  function intentarCerrar(): void {
    const actual = item === null ? null : conteoFinal(item);
    const sinCambios = texto === (actual === null ? '' : String(actual)) && motivo.trim() === '';
    if (sinCambios) {
      onCerrar();
      return;
    }
    setConfirmarDescarte(true);
  }

  // La diferencia que DEJARÍA este valor. Sale de `diferenciaUnidades`, la
  // misma función del dominio que pinta la tabla -- no de una resta a mano acá,
  // que sería la segunda copia de la fórmula.
  const previsualizacion = cantidad.ok
    ? diferenciaUnidades({ stockErp: item.stockErp, conteos: [cantidad.valor] })
    : null;

  return (
    <>
      <View style={styles.modalRaiz} pointerEvents="box-none">
        <Pressable style={styles.modalFondo} onPress={intentarCerrar} accessibilityLabel="Cerrar" />
        <View pointerEvents="box-none" style={styles.modalCentrado}>
          <View style={[styles.modalCaja, shadow.modal]}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalScroll}>
              <View style={styles.modalCabecera}>
                <ChipIcono icono={Scale} tono="atencion" />
                <View style={styles.modalCabeceraTextos}>
                  <Text style={styles.modalTitulo}>Ajustar valor</Text>
                  <Text style={styles.modalMeta}>Código {item.codigo}</Text>
                </View>
                <Pressable onPress={intentarCerrar} style={styles.modalCerrar} accessibilityLabel="Cerrar">
                  <X size={18} color={colors.gris} />
                </Pressable>
              </View>

              <Text style={styles.modalProducto}>{item.descripcion}</Text>

              <View style={styles.modalComparacion}>
                <View style={styles.modalCelda}>
                  <Text style={styles.modalCeldaEtiqueta}>Stock ERP</Text>
                  {/* "—" y no 0: sin stock del ERP no hay contra qué comparar,
                      y un cero afirmaría que el ERP dice que no hay ninguno. */}
                  <Text style={styles.modalCeldaValor}>{item.stockErp === null ? SIN_DATO : formatoMiles(item.stockErp)}</Text>
                </View>
                <View style={styles.modalCelda}>
                  <Text style={styles.modalCeldaEtiqueta}>Último conteo</Text>
                  <Text style={styles.modalCeldaValor}>
                    {conteoFinal(item) === null ? SIN_DATO : formatoMiles(conteoFinal(item)!)}
                  </Text>
                </View>
              </View>

              <View style={styles.modalCampo}>
                <Text style={styles.modalEtiqueta}>Valor definitivo (unidades)</Text>
                <TextInput
                  style={[styles.modalInput, !cantidad.ok && texto.length > 0 ? styles.modalInputError : null]}
                  inputMode="numeric"
                  value={texto}
                  placeholder={SIN_DATO}
                  placeholderTextColor={colors.grisClaro}
                  onChangeText={setTexto}
                  selectTextOnFocus
                  accessibilityLabel="Valor definitivo en unidades"
                />
                {!cantidad.ok && texto.length > 0 ? <Text style={styles.modalError}>{cantidad.mensaje}</Text> : null}
              </View>

              {/* EL RESULTADO, antes de guardar. Es para lo que el Auditor abrió
                  este modal: saber si con este número el ítem cuadra. */}
              {previsualizacion !== null ? (
                <View style={[styles.modalResultado, previsualizacion === 0 && styles.modalResultadoOk]}>
                  <Text style={[styles.modalResultadoTexto, previsualizacion === 0 && styles.modalResultadoTextoOk]}>
                    {previsualizacion === 0
                      ? 'Con este valor el ítem cuadra contra el ERP.'
                      : `Con este valor queda ${previsualizacion < 0 ? 'un faltante' : 'un sobrante'} de ${formatoMiles(Math.abs(previsualizacion))} ${pluralizar(Math.abs(previsualizacion), 'unidad', 'unidades')}.`}
                  </Text>
                </View>
              ) : item.stockErp === null ? (
                <View style={styles.modalResultado}>
                  <Text style={styles.modalResultadoTexto}>
                    Este ítem no tiene stock en el ERP: el valor se puede fijar igual, pero no hay contra qué compararlo.
                  </Text>
                </View>
              ) : null}

              <View style={styles.modalCampo}>
                <Text style={styles.modalEtiqueta}>Motivo del cambio</Text>
                <TextInput
                  style={[styles.modalInput, styles.modalInputMotivo]}
                  multiline
                  numberOfLines={2}
                  value={motivo}
                  placeholder="Por qué fijas este valor"
                  placeholderTextColor={colors.grisClaro}
                  onChangeText={setMotivo}
                  accessibilityLabel="Motivo del ajuste"
                />
              </View>

              <BotonWeb
                etiqueta={guardando ? 'Guardando…' : 'Guardar el ajuste'}
                icono={Check}
                variante="principal"
                onPress={() => onGuardar(cantidad.ok ? cantidad.valor : 0, motivo.trim())}
                deshabilitado={!puedeGuardar}
                cargando={guardando}
                // QUÉ falta, no "no se puede".
                {...(!cantidad.ok
                  ? { motivo: 'Escribe el valor definitivo en unidades.' }
                  : faltaMotivo !== null
                    ? { motivo: faltaMotivo }
                    : {})}
              />
            </ScrollView>
          </View>
        </View>
      </View>

      {confirmarDescarte ? (
        <DialogoConfirmar
          titulo="Descartar el ajuste"
          cuerpo="Lo que escribiste para este ítem no se guardó todavía."
          cancelar="Seguir editando"
          confirmar="Descartar"
          onCancelar={() => setConfirmarDescarte(false)}
          onConfirmar={() => {
            setConfirmarDescarte(false);
            onCerrar();
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  pagina: { flex: 1 },
  contenido: { padding: spacing.xxl, gap: spacing.lg },
  centro: { flex: 1 },
  cargando: { marginTop: spacing.xxl },

  banda: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.blanco,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borde,
    padding: spacing.lg,
    ...shadow.tarjeta,
  },
  bandaApilada: { flexDirection: 'column', alignItems: 'stretch' },
  bandaTienda: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bandaTextos: { flex: 1, gap: 2 },
  bandaEtiqueta: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },
  bandaSub: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },

  cartel: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.lg, padding: spacing.md, minWidth: 340 },
  cartelAtencion: { backgroundColor: colors.procesoSuave },
  cartelNeutro: { backgroundColor: colors.esperaSuave },
  cartelTextos: { flex: 1, gap: 1 },
  cartelTitulo: { fontSize: fontSize.lg, fontFamily: fonts.bold },
  cartelDetalle: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },

  aviso: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.esperaSuave,
  },
  avisoTexto: { flex: 1, fontSize: fontSize.sm, lineHeight: 19, color: colors.gris, fontFamily: fonts.regular },

  resultado: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  resultadoOk: { backgroundColor: colors.okSuave, borderColor: colors.ok },
  resultadoError: { backgroundColor: colors.faltaSuave, borderColor: colors.falta },
  resultadoTexto: { flex: 1, fontSize: fontSize.sm, lineHeight: 19, color: colors.tinta, fontFamily: fonts.regular },
  resultadoCerrar: { padding: 2 },

  parrafo: { fontSize: fontSize.sm, lineHeight: 20, color: colors.gris, fontFamily: fonts.regular },

  vacio: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  vacioTitulo: { fontSize: fontSize.lg, color: colors.tinta, fontFamily: fonts.bold, textAlign: 'center' },

  marco: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.lg,
    backgroundColor: colors.blanco,
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
    paddingHorizontal: 10,
    fontSize: fontSize.xs,
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
  /** Faltante y sobrante. Solo las filas con diferencia. */
  filaFalta: { backgroundColor: colors.faltaSuave },
  filaSobra: { backgroundColor: colors.okSuave },
  filaPresionada: { backgroundColor: colors.rojoSuave },

  celda: { paddingHorizontal: 10, fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.regular },
  celdaNodo: { paddingHorizontal: 10, justifyContent: 'center' },
  /**
   * Las cifras a la derecha y con `tabular-nums`: todos los dígitos ocupan lo
   * mismo, así que las unidades quedan bajo las unidades. Sin eso hay que leer
   * cifra por cifra en vez de barrer la columna con la vista.
   */
  celdaNumerica: { textAlign: 'right', fontVariant: ['tabular-nums'], fontFamily: fonts.medium },
  celdaFuerte: { fontFamily: fonts.bold },

  pie: { marginTop: spacing.sm, fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },
  pieFuerte: { color: colors.tinta, fontFamily: fonts.bold },

  modalRaiz: { ...StyleSheet.absoluteFillObject, zIndex: 50 },
  modalFondo: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  modalCentrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalCaja: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '86%',
    padding: spacing.xl,
    backgroundColor: colors.blanco,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borde,
  },
  modalScroll: { paddingBottom: spacing.xs },
  modalCabecera: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  modalCabeceraTextos: { flex: 1, gap: 1 },
  modalTitulo: { fontSize: fontSize.lg, color: colors.tinta, fontFamily: fonts.bold },
  modalMeta: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },
  modalCerrar: { padding: 4 },
  modalProducto: { marginTop: spacing.md, fontSize: fontSize.base, color: colors.tinta, fontFamily: fonts.bold, lineHeight: 21 },

  modalComparacion: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  modalCelda: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.esperaSuave,
  },
  modalCeldaEtiqueta: {
    fontSize: fontSize.xs,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.grisClaro,
    fontFamily: fonts.bold,
  },
  modalCeldaValor: { fontSize: fontSize.xl, color: colors.tinta, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },

  modalCampo: { marginTop: spacing.lg },
  modalEtiqueta: { marginBottom: 6, fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.semibold },
  modalInput: {
    minHeight: 46,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
    fontSize: fontSize.base,
    color: colors.tinta,
    fontFamily: fonts.semibold,
    backgroundColor: colors.blanco,
  },
  modalInputMotivo: { minHeight: 68, paddingTop: 10, fontFamily: fonts.regular, textAlignVertical: 'top' },
  modalInputError: { borderColor: colors.falta },
  modalError: { marginTop: 4, fontSize: fontSize.sm, color: colors.falta, fontFamily: fonts.medium },

  // El resultado usa la paleta de ESTADO (`ok` cuando cuadra, `proceso`
  // mientras no), nunca el rojo de marca: el rojo acá es el botón de guardar.
  modalResultado: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.procesoSuave },
  modalResultadoOk: { backgroundColor: colors.okSuave },
  modalResultadoTexto: { fontSize: fontSize.sm, lineHeight: 19, color: colors.proceso, fontFamily: fonts.semibold },
  modalResultadoTextoOk: { color: colors.ok },

  dialogoCaja: {
    width: '100%',
    maxWidth: 440,
    padding: spacing.xl,
    gap: spacing.sm,
    backgroundColor: colors.blanco,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borde,
  },
  dialogoTitulo: { fontSize: fontSize.xl, color: colors.tinta, fontFamily: fonts.bold },
  dialogoBotones: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  dialogoBoton: { flex: 1 },
});
