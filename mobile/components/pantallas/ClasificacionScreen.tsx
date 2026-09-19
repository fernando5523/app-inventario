import { router } from 'expo-router';
import { AlertTriangle, ChevronLeft, Search, ShieldAlert, Tag, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { repositorioClasificacion } from '../../lib/contenedor';
import {
  ADVERTENCIA_SIN_EMPAQUE,
  aplicarClasificacion,
  CLASES,
  consecuenciaDeEmpaque,
  empaqueTecleado,
  errorDeEmpaque,
  estadoClasificacion,
  explicacionClase,
  hayMasPorCargar,
  soloConClasificacion,
  textoClase,
  textoEmpaqueCompra,
  textoResponsableDynamics,
} from '../../lib/dominio/clasificacion';
import { pluralizar } from '../../lib/dominio/plural';
import type { ClaseItem, ProductoClasificable } from '../../lib/puertos/repositorios';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';
import { useRefrescoAlEnfocar } from '../hooks/useRefrescoAlEnfocar';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';
import { Badge, type BadgeVariant, BarraApp, Button, CampoTexto, ChipsFiltro, EmptyState, formatoMiles, type OpcionChip } from '../ui';

/**
 * Qué excepción tiene HOY, en una línea. Una VIEJA se muestra por lo que es
 * (empresa / empleado) y se dice que es anterior: nunca se le nombra una vía
 * que nadie eligió.
 */
function textoExcepcionActual(p: ProductoClasificable | null): string {
  if (!p?.clasificacion) return 'Sin excepción';
  const { clase, esEmpresa, empaqueCompraCorregido } = p.clasificacion;
  if (clase === null) {
    return empaqueCompraCorregido !== null
      ? `Sin cuadro forzado · empaque corregido a ${empaqueCompraCorregido}`
      : `${esEmpresa ? 'Empresa' : 'Empleado'} · anterior a las tres vías`;
  }
  return textoClase(clase);
}

/** Cuántos productos por página del catálogo (~11.800). Ver `cargar`/`cargarMas`. */
const TAMANO_PAGINA = 40;

/**
 * CUÁNDO aplica, en una línea y sin tecnicismos (pedido explícito): la
 * clasificación se evalúa al liquidar, así que solo mueve la cuenta de los
 * inventarios que todavía no se liquidaron.
 */
const AVISO_CUANDO_APLICA =
  'Lo que marques aquí cuenta para los inventarios que todavía no se liquidaron. Los ya liquidados no cambian.';

const OPCIONES_FILTRO: OpcionChip[] = [
  { id: 'todos', etiqueta: 'Todos' },
  { id: 'clasificados', etiqueta: 'Solo clasificados' },
];

/** El badge de la fila: la decisión del AUDITOR (aparte de lo que hace el sistema). */
function badgeDelAuditor(p: ProductoClasificable): { label: string; variant: BadgeVariant } | null {
  const estado = estadoClasificacion(p);
  if (estado.tipo === 'sin-clasificar') return null;
  // UNA EXCEPCIÓN VIEJA se muestra por lo que es -- empresa o no -- y se dice
  // que es anterior a las tres vías. Ponerle "Unidad" o "Paquete" sería
  // atribuirle al Auditor una decisión que nunca tomó.
  if (estado.tipo === 'vieja') {
    return { label: `${estado.esEmpresa ? 'Empresa' : 'Empleado'} · anterior`, variant: 'outline' };
  }
  // Solo se corrigió el empaque: no hay cuadro forzado que mostrar, y decir
  // uno sería atribuirle al Auditor una decisión que no tomó. Se muestra la
  // corrección, que ES lo que hizo.
  //
  // Y dice "corregido", no solo "Empaque 12": este número lo tecleó él, no
  // vino de Dynamics. En la columna donde el resto de las filas muestra el
  // símbolo del ERP tal cual, un número pelado se lee como si fuera del ERP.
  if (estado.tipo === 'solo-empaque') {
    return { label: `Empaque corregido: ${estado.empaqueCorregido}`, variant: 'proceso' };
  }
  // `proceso` (ámbar) resalta la excepción que MUEVE la cuenta; `ok` (verde) la
  // que coincide con lo que ya hacía el sistema — dos señales además del texto.
  return { label: textoClase(estado.clase), variant: estado.tipo === 'excepcion' ? 'proceso' : 'ok' };
}

/**
 * El selector de las tres vías (`.segmentado`/`.segmento` del design system).
 *
 * Son `Pressable` reales y no `View` porque acá SÍ hay una elección: es el
 * caso opuesto al grupo de rol de la pantalla 1, que muestra un dato derivado.
 * Y es la decisión más cara de esta pantalla -- mueve el faltante de un cuadro
 * a otro de la liquidación.
 */
function SelectorClase({
  valor,
  onElegir,
  disabled,
}: {
  valor: ClaseItem | null;
  onElegir: (clase: ClaseItem) => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <View style={[styles.segmentado, disabled && styles.segmentadoDeshabilitado]}>
      {CLASES.map((clase, i) => {
        const activo = valor === clase;
        return (
          <Pressable
            key={clase}
            onPress={() => onElegir(clase)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: activo, disabled }}
            accessibilityLabel={`${textoClase(clase)}: ${explicacionClase(clase)}`}
            style={[styles.segmento, i < CLASES.length - 1 && styles.segmentoConBorde, activo && styles.segmentoActivo]}
          >
            <Text style={[styles.segmentoTexto, activo && styles.segmentoTextoActivo]}>{textoClase(clase)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Clasificación de productos (Auditor). Marca por CÓDIGO qué productos asume la
 * empresa aunque Dynamics los ponga del empleado (las cervezas: se descuentan
 * para la empresa por seguimiento de robo). Busca en el catálogo (~11.800),
 * muestra por separado lo que dice Dynamics y lo que decidió el Auditor, y deja
 * clasificar/desclasificar con nota opcional.
 *
 * Sin variante en memoria (ver contenedor.ts): sin backend, avisa que no pudo
 * cargar — nunca inventa excepciones.
 */
export function ClasificacionScreen(): JSX.Element {
  const [q, setQ] = useState('');
  const [soloClasificados, setSoloClasificados] = useState(false);

  const [productos, setProductos] = useState<ProductoClasificable[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [seleccionado, setSeleccionado] = useState<ProductoClasificable | null>(null);
  /**
   * La vía elegida en el modal. `null` = todavía no eligió, y ahí NO se puede
   * guardar.
   *
   * Arranca en la clase que YA tiene la excepción, si la tiene: eso no es un
   * default que nadie mira, es el valor actual, y hay que verlo para decidir a
   * dónde moverlo. Una excepción VIEJA (clase null) arranca SIN elegir: no
   * tenía vía, y preseleccionarle una sería inventarle la decisión que este
   * cambio vino a pedirle.
   */
  const [clase, setClase] = useState<ClaseItem | null>(null);
  /**
   * El empaque corregido, como TEXTO mientras se tipea. Vacío = sin corregir,
   * que es un valor válido y es el deshacer.
   *
   * Texto y no número por lo mismo que `ModalConteo`: un "1" a medio escribir
   * camino a "12" no puede convertirse en una consecuencia mostrada con un
   * valor a medias, y "12a" no puede tirar la cuenta a NaN en silencio.
   */
  const [empaqueTexto, setEmpaqueTexto] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Un solo lugar arma el filtro: `cargar` (primera página) y `cargarMas` (la
  // siguiente) tienen que pedir EXACTAMENTE lo mismo, o "cargar más" traería
  // una página de otro filtro. Mismo criterio que HistorialScreen.
  const filtroActual = useCallback(
    (desplazamiento: number) => ({
      q: q.trim() ? q.trim() : undefined,
      soloClasificados,
      limite: TAMANO_PAGINA,
      desplazamiento,
    }),
    [q, soloClasificados],
  );

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const pagina = await repositorioClasificacion.buscar(filtroActual(0));
      setProductos(pagina.productos);
      setTotal(pagina.total);
    } catch (e) {
      // Sin esto, un fallo sin red deja el spinner girando para siempre.
      setError(e instanceof Error ? e.message : 'No se pudo cargar el catálogo.');
    } finally {
      setCargando(false);
    }
  }, [filtroActual]);

  async function cargarMas(): Promise<void> {
    if (cargandoMas) return;
    setCargandoMas(true);
    try {
      const pagina = await repositorioClasificacion.buscar(filtroActual(productos.length));
      setProductos((actuales) => [...actuales, ...pagina.productos]);
      setTotal(pagina.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron traer más productos.');
    } finally {
      setCargandoMas(false);
    }
  }

  // Al cambiar la búsqueda o el filtro: recarga desde la primera página, con un
  // pequeño respiro para no pegarle al backend en cada tecla. En el primer
  // render no corre — la carga inicial ya la dispara useRefrescoAlEnfocar.
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    const id = setTimeout(() => {
      setCargando(true);
      void cargar();
    }, 350);
    return () => clearTimeout(id);
  }, [cargar]);

  function abrir(p: ProductoClasificable): void {
    setSeleccionado(p);
    setClase(p.clasificacion?.clase ?? null);
    // El valor ACTUAL de la corrección, si la hay: no es un default que nadie
    // mira, es lo que está guardado y hay que verlo para decidir.
    setEmpaqueTexto(
      p.clasificacion?.empaqueCompraCorregido === null || p.clasificacion?.empaqueCompraCorregido === undefined
        ? ''
        : String(p.clasificacion.empaqueCompraCorregido),
    );
    setNota(p.clasificacion?.nota ?? '');
  }

  function cerrar(): void {
    setSeleccionado(null);
    setClase(null);
    setEmpaqueTexto('');
    setNota('');
  }

  /**
   * CERRAR SIN PERDER LO TECLEADO EN SILENCIO.
   *
   * El botón ATRÁS del teléfono cerraba el modal y descartaba el empaque a
   * medio escribir sin decir nada (visto en el emulador con "12" ya cargado).
   * En un teléfono el gesto de volver es constante: el Auditor lo hace por
   * reflejo y pierde el trabajo sin entender qué pasó.
   *
   * Se pregunta SOLO si hay algo distinto de lo guardado. Sin cambios, cerrar
   * es cerrar: un diálogo de confirmación en cada salida enseña a tocar
   * "Descartar" sin leer, y entonces deja de proteger nada el día que sí
   * importa.
   */
  function intentarCerrar(): void {
    if (!hayCambiosSinGuardar) {
      cerrar();
      return;
    }
    Alert.alert('Descartar los cambios', 'Lo que escribiste en este producto no se guardó todavía.', [
      { text: 'Seguir editando', style: 'cancel' },
      { text: 'Descartar', style: 'destructive', onPress: cerrar },
    ]);
  }

  async function guardarClase(): Promise<void> {
    if (!seleccionado || !hayAlgoQueGuardar) return;
    setGuardando(true);
    try {
      const clasificacion = await repositorioClasificacion.clasificar(seleccionado.codigo, {
        // SOLO la clase: `esEmpresa` lo deriva el servidor, y por eso no
        // pueden discrepar (ver DatosClasificar en el puerto).
        clase,
        // `null` cuando el campo quedó vacío: es el deshacer, y tiene que
        // viajar explícito para que el servidor borre la corrección anterior.
        empaqueCompraCorregido: correccion,
        ...(nota.trim() ? { nota: nota.trim() } : {}),
      });
      // Actualiza SOLO esa fila, sin volver a pedir las ~11.800.
      setProductos((actuales) => aplicarClasificacion(actuales, seleccionado.codigo, clasificacion));
      cerrar();
    } catch (e) {
      Alert.alert('No se pudo clasificar', e instanceof Error ? e.message : 'Intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  async function quitarExcepcion(): Promise<void> {
    if (!seleccionado) return;
    setGuardando(true);
    try {
      await repositorioClasificacion.desclasificar(seleccionado.codigo);
      setProductos((actuales) => {
        const actualizada = aplicarClasificacion(actuales, seleccionado.codigo, null);
        // Bajo "solo clasificados", el que perdió la excepción sale de la lista.
        return soloClasificados ? soloConClasificacion(actualizada) : actualizada;
      });
      cerrar();
    } catch (e) {
      Alert.alert('No se pudo quitar la excepción', e instanceof Error ? e.message : 'Intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  // Una excepción anterior a las tres vías: la pantalla lo dice y pide elegir,
  // en vez de mostrarle una vía preseleccionada que nadie eligió.
  const esExcepcionVieja = seleccionado?.clasificacion !== null && seleccionado?.clasificacion?.clase === null;
  const empaqueDelErp = seleccionado
    ? textoEmpaqueCompra(seleccionado.empaqueCompra, seleccionado.empaqueCompraSimbolo)
    : null;
  const errorEmpaque = errorDeEmpaque(empaqueTexto);
  /**
   * QUÉ VA A CAMBIAR SI GUARDA, recalculado en vivo mientras teclea. Es lo más
   * útil que tiene esta pantalla: el empaque decide si un faltante se le
   * descuenta al personal o se va al cuadro de paquetes, y eso no se deduce
   * mirando el campo. Sin esto el Auditor teclea a ciegas sobre el sueldo de
   * alguien.
   */
  /**
   * Si lo que hay en el modal difiere de lo GUARDADO. Se compara contra la
   * fila, no contra un flag de "tocó algo": abrir, tocar un segmento y volver
   * a dejarlo como estaba no es un cambio, y preguntar ahí sería ruido.
   */
  const hayCambiosSinGuardar =
    seleccionado !== null &&
    (clase !== (seleccionado.clasificacion?.clase ?? null) ||
      empaqueTexto.trim() !==
        (seleccionado.clasificacion?.empaqueCompraCorregido == null
          ? ''
          : String(seleccionado.clasificacion.empaqueCompraCorregido)) ||
      nota.trim() !== (seleccionado.clasificacion?.nota ?? ''));

  const correccion = empaqueTecleado(empaqueTexto);
  /** Hay ALGO que guardar: un cuadro forzado, o una corrección de empaque. */
  const hayAlgoQueGuardar = clase !== null || correccion !== null;
  const consecuencia =
    seleccionado && errorEmpaque === null && hayAlgoQueGuardar
      ? consecuenciaDeEmpaque(seleccionado, clase, correccion)
      : null;

  const cifras = `${formatoMiles(total)} ${soloClasificados ? pluralizar(total, 'excepción', 'excepciones') : pluralizar(total, 'producto', 'productos')}`;
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar, { pausado: seleccionado !== null });

  return (
    <>
      <PantallaConTabs
        scrollable
        contentStyle={styles.contenido}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={colors.rojo} colors={[colors.rojo]} />}
      >
        <BarraApp rotulo="Clasificación de productos" cifras={cifras} />

        <Pressable style={styles.volver} onPress={() => router.back()} accessibilityRole="button">
          <ChevronLeft size={15} color={colors.rojo} />
          <Text style={styles.volverTexto}>Volver</Text>
        </Pressable>

        <Text style={styles.aviso}>{AVISO_CUANDO_APLICA}</Text>

        <CampoTexto
          label="Buscar producto"
          valor={q}
          onCambiar={setQ}
          icon={Search}
          placeholder="Código, descripción o categoría"
          autoCapitalize="none"
        />

        <ChipsFiltro
          opciones={OPCIONES_FILTRO}
          activo={soloClasificados ? 'clasificados' : 'todos'}
          onCambiar={(id) => setSoloClasificados(id === 'clasificados')}
        />

        {cargando ? (
          <ActivityIndicator color={colors.rojo} style={styles.spinner} />
        ) : error ? (
          <EmptyState icon={ShieldAlert} title="No se pudo cargar" subtitle={error}>
            <Button label="Reintentar" variant="outline" onPress={() => { setCargando(true); void cargar(); }} />
          </EmptyState>
        ) : productos.length === 0 ? (
          <EmptyState
            icon={Search}
            title={soloClasificados ? 'Todavía no hay excepciones' : 'Sin resultados'}
            subtitle={
              soloClasificados
                ? 'Cuando marques un producto como empresa, paquete o unidad, va a aparecer aquí.'
                : 'Prueba con otro código, descripción o categoría.'
            }
          />
        ) : (
          <>
            {productos.map((p) => {
              const badge = badgeDelAuditor(p);
              return (
                <Pressable key={p.codigo} style={styles.fila} onPress={() => abrir(p)} accessibilityRole="button">
                  <View style={styles.filaTexto}>
                    <Text style={styles.codigo}>{p.codigo}</Text>
                    {/* Truncado al FINAL: se reconoce el producto por cómo empieza. */}
                    <Text style={styles.descripcion} numberOfLines={1} ellipsizeMode="tail">
                      {p.descripcion}
                    </Text>
                    <Text style={styles.categoria} numberOfLines={1} ellipsizeMode="tail">
                      {p.categoria ?? 'Sin categoría'}
                    </Text>
                  </View>
                  <View style={styles.filaEstado}>
                    {/* DOS datos separados: lo que dice Dynamics... */}
                    {/* Lo que hace el sistema HOY: el responsable del ERP y la
                        clase que derivó el snapshot. Con tres vías, el
                        responsable solo ya no alcanza -- un ítem del empleado
                        que se compra por caja es `paquete`, no `unidad`. */}
                    <Text style={styles.dynamics}>
                      Sistema: {textoResponsableDynamics(p.responsableDynamics)} · {textoClase(p.claseDynamics)}
                    </Text>
                    {/* ...y lo que decidió el Auditor (o nada). */}
                    {badge ? <Badge label={badge.label} variant={badge.variant} /> : <Text style={styles.sinExcepcion}>Sin excepción</Text>}
                  </View>
                </Pressable>
              );
            })}

            {hayMasPorCargar(productos.length, total) ? (
              <Button label="Cargar más" variant="outline" onPress={cargarMas} loading={cargandoMas} />
            ) : null}
          </>
        )}
      </PantallaConTabs>

      {/* `onRequestClose` ES el botón atrás en Android: interceptarlo acá es
          más directo que un BackHandler, y cubre el mismo gesto. */}
      <Modal visible={seleccionado !== null} transparent animationType="fade" onRequestClose={intentarCerrar}>
        <Pressable style={styles.overlay} onPress={intentarCerrar}>
          {/* onPress vacío: captura el toque para que tocar DENTRO no cierre. */}
          <Pressable style={styles.modalCaja} onPress={() => {}}>
            <View style={styles.modalCabecera}>
              <Text style={styles.modalTitulo} numberOfLines={2}>
                {seleccionado?.descripcion}
              </Text>
              <Pressable onPress={intentarCerrar} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={8}>
                <X size={20} color={colors.gris} />
              </Pressable>
            </View>
            <Text style={styles.modalCodigo}>{seleccionado?.codigo}</Text>

            {/* LOS DOS DATOS SEPARADOS, como en la fila: lo que hace el
                sistema y lo que decidió el Auditor. Ninguno pisa al otro. */}
            <View style={styles.modalDatos}>
              <View style={styles.modalDato}>
                <Text style={styles.modalDatoRotulo}>El sistema hace</Text>
                <Text style={styles.modalDatoValor}>
                  {seleccionado ? `${textoResponsableDynamics(seleccionado.responsableDynamics)} · ${textoClase(seleccionado.claseDynamics)}` : ''}
                </Text>
              </View>
              <View style={styles.modalDato}>
                <Text style={styles.modalDatoRotulo}>Tu excepción</Text>
                <Text style={styles.modalDatoValor}>{textoExcepcionActual(seleccionado)}</Text>
              </View>
            </View>

            {/* Una excepción anterior a las tres vías: se dice lo que es y se
                pide elegir, en vez de mostrarle una vía preseleccionada que
                nadie eligió. */}
            {esExcepcionVieja ? (
              <View style={styles.notaVieja}>
                <Text style={styles.notaViejaTexto}>
                  Esta excepción se cargó antes de que existieran las tres vías, así que solo dice si la asume la
                  empresa. Elige una vía para dejarla completa.
                </Text>
              </View>
            ) : null}

            {/*
              FORZAR EL CUADRO ES OPCIONAL, y por eso lo dice el rótulo.
              Era obligatorio, y eso dejaba sin camino al caso más común:
              corregir SOLO el empaque. Para guardar la corrección había que
              forzar además un cuadro — y el cuadro forzado PISA lo derivado,
              así que la corrección quedaba escrita y sin efecto. El hallazgo
              salió del emulador (producto 100009).
            */}
            <View style={styles.modalSeccionFila}>
              <Text style={styles.modalSeccion}>Forzar el cuadro</Text>
              <Text style={styles.modalSeccionOpcional}>opcional</Text>
            </View>
            <SelectorClase valor={clase} onElegir={setClase} disabled={guardando} />
            {/* El camino de VUELTA a "sin forzar": sin esto, una vez tocado un
                segmento no había forma de soltarlo sin cerrar el modal. */}
            {clase !== null ? (
              <Pressable onPress={() => setClase(null)} disabled={guardando} accessibilityRole="button">
                <Text style={styles.quitarCuadro}>Quitar el cuadro forzado — que lo decida el sistema</Text>
              </Pressable>
            ) : null}
            {/* QUÉ SIGNIFICA LA ELEGIDA, sin tooltips escondidos: es lo que le
                permite al Auditor decidir sin acordarse de una reunión. Sin
                elegir todavía, se explican las tres. */}
            {clase !== null ? (
              <Text style={styles.explicacion}>{explicacionClase(clase)}</Text>
            ) : (
              <View style={styles.explicacionesTodas}>
                <Text style={styles.explicacion}>
                  Sin forzar nada, el cuadro lo decide el sistema con el empaque de abajo. Fuerza uno solo si el
                  sistema se equivoca en ESTE producto.
                </Text>
                {CLASES.map((c) => (
                  <Text key={c} style={styles.explicacion}>
                    <Text style={styles.explicacionFuerte}>{textoClase(c)}: </Text>
                    {explicacionClase(c)}
                  </Text>
                ))}
              </View>
            )}

            {/*
              EL EMPAQUE DE COMPRA — SIEMPRE visible, no solo con "Paquete".

              Corregirlo ARREGLA LA CAUSA: es la diferencia entre forzar el
              cuadro de este producto (el "corregir 1:1" que Gilmer quiere
              evitar) y dejar que la regla lo clasifique sola de ahí en
              adelante. Esconderlo detrás de una elección haría que el camino
              barato dependa de haber elegido primero el caro.

              LOS DOS NÚMEROS A LA VISTA, etiquetados: el del ERP no se pisa.
              El del ERP es una celda inerte — CORREGIR EL EMPAQUE NO ES
              CORREGIR EL STOCK, pero tampoco es editar el snapshot: ese sigue
              diciendo lo que dijo Dynamics.
            */}
            {seleccionado ? (
              <>
                <Text style={styles.modalSeccion}>Empaque de compra</Text>
                <View style={styles.empaqueFila}>
                  <View style={styles.empaqueCelda}>
                    <Text style={styles.empaqueCeldaRotulo}>El ERP dice</Text>
                    <Text style={styles.empaqueCeldaValor}>{empaqueDelErp ?? '—'}</Text>
                  </View>
                  <View style={styles.empaqueCampo}>
                    <Text style={styles.empaqueCeldaRotulo}>Tu corrección</Text>
                    <TextInput
                      style={[styles.empaqueInput, errorEmpaque ? styles.empaqueInputError : null]}
                      keyboardType="number-pad"
                      returnKeyType="done"
                      onSubmitEditing={() => Keyboard.dismiss()}
                      value={empaqueTexto}
                      placeholder="sin corregir"
                      placeholderTextColor={colors.grisClaro}
                      onChangeText={setEmpaqueTexto}
                      editable={!guardando}
                      accessibilityLabel="Empaque de compra corregido"
                    />
                  </View>
                </View>
                {errorEmpaque ? <Text style={styles.empaqueError}>{errorEmpaque}</Text> : null}
                {/* Sin el dato del ERP no se muestra un número (null no es 1):
                    se explica la consecuencia, que acá además tiene arreglo —
                    es justamente lo que este campo destraba. */}
                {seleccionado.empaqueCompra === null && empaqueTexto.trim() === '' ? (
                  <View style={styles.empaqueAviso}>
                    <AlertTriangle size={15} color={colors.proceso} />
                    <Text style={styles.empaqueAvisoTexto}>{ADVERTENCIA_SIN_EMPAQUE}</Text>
                  </View>
                ) : null}
                <Text style={styles.explicacion}>
                  Cuántas unidades trae el empaque con el que se COMPRA. Déjalo vacío para usar el del ERP; un 1
                  significa que se compra suelto, y con eso nunca va al cuadro de paquetes.
                </Text>
              </>
            ) : null}

            {/*
              LA CONSECUENCIA, ANTES DE GUARDAR. Lo más útil de esta pantalla:
              el empaque decide si un faltante se le descuenta al personal o se
              va al cuadro de paquetes, y eso no se deduce mirando el campo.
              Sale de `claseEfectiva`, la MISMA función que usa el servidor
              para decidirlo de verdad.
            */}
            {consecuencia ? (
              <View style={[styles.consecuencia, consecuencia.cambia && styles.consecuenciaCambia]}>
                <Text style={styles.consecuenciaTitulo}>Qué va a pasar con los faltantes de este producto</Text>
                <Text style={styles.consecuenciaTexto}>
                  {consecuencia.cambia ? (
                    <>
                      Hoy va a <Text style={styles.explicacionFuerte}>{textoClase(consecuencia.claseAntes)}</Text>; al
                      guardar pasa a <Text style={styles.explicacionFuerte}>{textoClase(consecuencia.claseDespues)}</Text>.{' '}
                      {explicacionClase(consecuencia.claseDespues)}
                    </>
                  ) : (
                    <>
                      Sigue en <Text style={styles.explicacionFuerte}>{textoClase(consecuencia.claseDespues)}</Text>.{' '}
                      {explicacionClase(consecuencia.claseDespues)}
                    </>
                  )}
                </Text>
                {/* EL AVISO QUE MÁS IMPORTA de este lote: marcar Paquete sin
                    corregir el empaque no hace nada, y quien lo marcó se iría
                    convencido de que sí. Es el caso real de los DORITOS, que
                    D365 trae con empaque 1. */}
                {consecuencia.paqueteSinEfecto ? (
                  <View style={styles.empaqueAviso}>
                    <AlertTriangle size={15} color={colors.proceso} />
                    <Text style={styles.empaqueAvisoTexto}>
                      Marcaste Paquete, pero con un empaque de{' '}
                      {consecuencia.empaqueDespues === null ? 'ninguno' : consecuencia.empaqueDespues} el sistema lo
                      trata como Unidad igual. Corrige el empaque arriba para que Paquete tenga efecto.
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <CampoTexto
              label="Nota (opcional)"
              valor={nota}
              onCambiar={setNota}
              icon={Tag}
              placeholder="Por qué la clasificas así"
            />

            <Button
              label={guardando ? 'Guardando…' : seleccionado?.clasificacion ? 'Guardar el cambio' : 'Guardar la excepción'}
              onPress={guardarClase}
              loading={guardando}
              disabled={!hayAlgoQueGuardar || errorEmpaque !== null || guardando}
            />
            {/*
              QUÉ falta, no "no se puede". El texto DECÍA "elige una de las
              tres vías", y dejó de ser cierto cuando forzar el cuadro pasó a
              ser opcional: lo que falta no es elegir, es que haya algo que
              decir — un cuadro o una corrección.
            */}
            {!hayAlgoQueGuardar ? (
              <Text style={styles.hint}>
                Corrige el empaque o fuerza un cuadro: por ahora no hay nada que guardar.
              </Text>
            ) : null}

            {/* QUITAR LA EXCEPCIÓN, con su consecuencia dicha: no es "borrar",
                es volver a lo que hace el sistema -- y se nombra qué es eso.
                El camino de vuelta tiene que estar tan explicado como el de
                ida. */}
            {seleccionado?.clasificacion ? (
              <View style={styles.quitarBloque}>
                <Text style={styles.quitarExplicacion}>
                  Quitar la excepción devuelve este producto a lo que hace el sistema:{' '}
                  <Text style={styles.explicacionFuerte}>{textoClase(seleccionado.claseDynamics)}</Text>.{' '}
                  {explicacionClase(seleccionado.claseDynamics)}
                  {/* Se borra TODO lo del Auditor, empaque incluido: decir solo
                      "vuelve al cuadro X" escondería que también se pierde la
                      corrección del empaque, que es otra decisión suya. */}
                  {seleccionado.clasificacion?.empaqueCompraCorregido !== null &&
                  seleccionado.clasificacion?.empaqueCompraCorregido !== undefined
                    ? ` También se borra tu corrección del empaque (${seleccionado.clasificacion.empaqueCompraCorregido}): vuelve al del ERP.`
                    : ''}
                </Text>
                <Button label="Quitar la excepción" variant="outline" onPress={quitarExcepcion} disabled={guardando} />
              </View>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  contenido: { gap: spacing.md },

  // `.segmentado`/`.segmento` del design system, mismos valores que el
  // selector de tamaño de hoja (app/coordinador/armar.tsx): son Pressable
  // reales porque acá SÍ hay una elección.
  segmentado: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderColor: colors.rojo,
    borderRadius: radius.md,
    backgroundColor: colors.campo,
    overflow: 'hidden',
  },
  segmentadoDeshabilitado: { opacity: 0.55 },
  segmento: { flex: 1, paddingVertical: 11, alignItems: 'center' },
  segmentoConBorde: { borderRightWidth: 1.5, borderRightColor: colors.rojo },
  segmentoActivo: { backgroundColor: colors.rojo },
  segmentoTexto: { fontSize: fontSize.sm - 0.5, color: colors.tinta, fontFamily: fonts.bold },
  segmentoTextoActivo: { color: colors.blanco },

  modalSeccionFila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  modalSeccionOpcional: { fontSize: 11, color: colors.grisClaro, fontFamily: fonts.regular },
  quitarCuadro: { fontSize: 11.5, lineHeight: 16, color: colors.rojo, fontFamily: fonts.semibold },
  modalSeccion: {
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.gris,
    fontFamily: fonts.semibold,
  },
  explicacion: { fontSize: 12, lineHeight: 17, color: colors.gris, fontFamily: fonts.regular },
  explicacionesTodas: { gap: 5 },
  explicacionFuerte: { color: colors.tinta, fontFamily: fonts.bold },
  hint: { fontSize: 11.5, lineHeight: 16, color: colors.grisClaro, fontFamily: fonts.regular, textAlign: 'center' },

  /** El empaque de compra: dato traído, fondo neutro — no es un campo. */
  /** Falta el empaque: paleta `proceso` (atención), nunca el rojo de marca (que acá es el botón). */
  empaqueAviso: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: 11,
    borderRadius: radius.sm,
    backgroundColor: colors.procesoSuave,
    borderWidth: 1,
    borderColor: colors.proceso,
  },
  empaqueAvisoTexto: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.tinta, fontFamily: fonts.regular },

  /** Los dos números lado a lado: el del ERP inerte, el del Auditor editable. */
  empaqueFila: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  empaqueCelda: {
    flex: 1,
    gap: 3,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: radius.sm,
    // Neutro y SIN borde: en esta app un recuadro con borde es un input, y el
    // número del ERP no se toca.
    backgroundColor: colors.esperaSuave,
  },
  empaqueCampo: { flex: 1, gap: 3 },
  empaqueCeldaRotulo: {
    fontSize: 9.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.grisClaro,
    fontFamily: fonts.bold,
  },
  empaqueCeldaValor: { fontSize: 14, color: colors.tinta, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  empaqueInput: {
    minHeight: 42,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.sm,
    fontSize: 14,
    color: colors.tinta,
    fontFamily: fonts.bold,
    backgroundColor: colors.campo,
  },
  empaqueInputError: { borderColor: colors.falta },
  empaqueError: { fontSize: 11.5, color: colors.falta, fontFamily: fonts.medium },

  /** La consecuencia: `ok` cuando no mueve nada, `proceso` cuando sí. Nunca el rojo de marca. */
  consecuencia: { gap: spacing.sm, padding: 11, borderRadius: radius.sm, backgroundColor: colors.esperaSuave },
  consecuenciaCambia: { backgroundColor: colors.procesoSuave },
  consecuenciaTitulo: { fontSize: 11.5, color: colors.tinta, fontFamily: fonts.bold },
  consecuenciaTexto: { fontSize: 12, lineHeight: 17, color: colors.gris, fontFamily: fonts.regular },

  notaVieja: { padding: 11, borderRadius: radius.sm, backgroundColor: colors.esperaSuave },
  notaViejaTexto: { fontSize: 12, lineHeight: 17, color: colors.gris, fontFamily: fonts.regular },

  /** El camino de vuelta, separado por una línea: es otra decisión, no un paso del alta. */
  quitarBloque: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borde },
  quitarExplicacion: { fontSize: 12, lineHeight: 17, color: colors.gris, fontFamily: fonts.regular },
  volver: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  volverTexto: { color: colors.rojo, fontFamily: fonts.semibold, fontSize: fontSize.sm },
  aviso: {
    color: colors.gris,
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    backgroundColor: colors.esperaSuave,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  spinner: { marginTop: spacing.xl },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.campo,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
  },
  filaTexto: { flex: 1, gap: 2 },
  codigo: { color: colors.gris, fontFamily: fonts.semibold, fontSize: fontSize.xs },
  descripcion: { color: colors.tinta, fontFamily: fonts.semibold, fontSize: fontSize.base },
  categoria: { color: colors.grisClaro, fontFamily: fonts.regular, fontSize: fontSize.xs },
  filaEstado: { alignItems: 'flex-end', gap: 6, maxWidth: '42%' },
  dynamics: { color: colors.gris, fontFamily: fonts.regular, fontSize: fontSize.xs, textAlign: 'right' },
  sinExcepcion: { color: colors.grisClaro, fontFamily: fonts.regular, fontSize: fontSize.xs },

  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.xl },
  modalCaja: { backgroundColor: colors.blanco, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md },
  modalCabecera: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  modalTitulo: { flex: 1, color: colors.tinta, fontFamily: fonts.bold, fontSize: fontSize.lg },
  modalCodigo: { color: colors.gris, fontFamily: fonts.semibold, fontSize: fontSize.sm, marginTop: -spacing.sm },
  modalDatos: { flexDirection: 'row', gap: spacing.md },
  modalDato: {
    flex: 1,
    gap: 2,
    backgroundColor: colors.esperaSuave,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  modalDatoRotulo: { color: colors.gris, fontFamily: fonts.regular, fontSize: fontSize.xs },
  modalDatoValor: { color: colors.tinta, fontFamily: fonts.semibold, fontSize: fontSize.base },
});
