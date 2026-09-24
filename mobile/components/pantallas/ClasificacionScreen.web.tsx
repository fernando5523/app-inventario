import { router } from 'expo-router';
import { AlertTriangle, Search, Tag, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

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
import { limiteParaRefrescar } from '../../lib/dominio/paginacion';
import { pluralizar } from '../../lib/dominio/plural';
import type { ClaseItem, ProductoClasificable } from '../../lib/puertos/repositorios';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';
import { useRefrescoAlEnfocar } from '../hooks/useRefrescoAlEnfocar';
import { CampoTexto, ChipsFiltro, formatoMiles, type OpcionChip } from '../ui';
import { BotonWeb, CeldaTexto, EncabezadoPagina, TablaWeb, type ColumnaTabla } from '../web';

const TAMANO_PAGINA = 40;
const AVISO_CUANDO_APLICA =
  'Lo que marques aquí cuenta para los inventarios que todavía no se liquidaron. Los ya liquidados no cambian.';

const OPCIONES_FILTRO: OpcionChip[] = [
  { id: 'todos', etiqueta: 'Todos' },
  { id: 'clasificados', etiqueta: 'Solo clasificados' },
];

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

type TonoPill = 'ok' | 'atencion' | 'neutro';

/**
 * La decisión del AUDITOR, como pill. `null` = no tomó ninguna, y ahí la
 * columna dice "Sin excepción" en gris tenue: no es un estado de error.
 *
 * Mismos textos y mismos criterios que el badge del teléfono, incluidos los
 * dos casos que no son una vía: la excepción VIEJA (anterior a las tres) y la
 * corrección de empaque SOLA, que se muestra diciendo "corregido" porque ese
 * número lo tecleó el Auditor y no vino de Dynamics.
 */
function pillDelAuditor(p: ProductoClasificable): { texto: string; tono: TonoPill } | null {
  const estado = estadoClasificacion(p);
  if (estado.tipo === 'sin-clasificar') return null;
  if (estado.tipo === 'vieja') {
    return { texto: `${estado.esEmpresa ? 'Empresa' : 'Empleado'} · anterior`, tono: 'neutro' };
  }
  if (estado.tipo === 'solo-empaque') {
    return { texto: `Empaque corregido: ${estado.empaqueCorregido}`, tono: 'atencion' };
  }
  // Ámbar la excepción que MUEVE la cuenta; verde la que coincide con lo que
  // el sistema ya hacía. Dos señales además del texto.
  return { texto: textoClase(estado.clase), tono: estado.tipo === 'excepcion' ? 'atencion' : 'ok' };
}

function Pill({ texto, tono }: { texto: string; tono: TonoPill }): JSX.Element {
  const tinta = tono === 'ok' ? colors.ok : tono === 'atencion' ? colors.proceso : colors.gris;
  const fondo = tono === 'ok' ? colors.okSuave : tono === 'atencion' ? colors.procesoSuave : colors.esperaSuave;
  return (
    <View style={[styles.pill, { backgroundColor: fondo }]}>
      <View style={[styles.punto, { backgroundColor: tinta }]} />
      <Text style={[styles.pillTexto, { color: tinta }]} numberOfLines={1}>
        {texto}
      </Text>
    </View>
  );
}

/**
 * El buscador que vive DENTRO del encabezado de la tabla. Compacto a
 * propósito: el `CampoTexto` del design system trae su rótulo arriba y ocupa
 * dos renglones, que en una barra de herramientas de una sola línea no entran.
 *
 * El rótulo no se pierde -- pasa a `accessibilityLabel`, que es donde sigue
 * sirviendo. El texto de ayuda del campo es el MISMO de antes.
 */
function BuscadorTabla({ valor, onCambiar }: { valor: string; onCambiar: (v: string) => void }): JSX.Element {
  return (
    <View style={styles.buscador}>
      <Search size={16} color={colors.grisClaro} />
      <TextInput
        style={styles.buscadorInput}
        value={valor}
        onChangeText={onCambiar}
        placeholder="Código, descripción o categoría"
        placeholderTextColor={colors.grisClaro}
        autoCapitalize="none"
        accessibilityLabel="Buscar producto"
      />
    </View>
  );
}

/**
 * LAS CINCO COLUMNAS, las mismas que ya había. La separación entre "lo que
 * hace el sistema" y "tu excepción" es el punto de la pantalla: fundirlas
 * escondería justamente dónde no coinciden.
 *
 * Va fuera del componente porque no depende de nada del render: así la
 * identidad del arreglo es estable y `TablaWeb` no rearma nada de más.
 */
const COLUMNAS: ColumnaTabla<ProductoClasificable>[] = [
  { clave: 'codigo', titulo: 'Código', ancho: 96, celda: (p) => <CeldaTexto numero color={colors.gris}>{p.codigo}</CeldaTexto> },
  // Truncado al FINAL (lo hace `CeldaTexto`): se reconoce el producto por cómo
  // empieza el nombre.
  { clave: 'descripcion', titulo: 'Descripción', celda: (p) => <CeldaTexto fuerte>{p.descripcion}</CeldaTexto> },
  {
    clave: 'categoria',
    titulo: 'Categoría',
    ancho: 170,
    celda: (p) => <CeldaTexto color={colors.gris}>{p.categoria ?? 'Sin categoría'}</CeldaTexto>,
  },
  {
    clave: 'sistema',
    titulo: 'Lo que hace el sistema',
    ancho: 200,
    celda: (p) => (
      <CeldaTexto color={colors.gris}>
        {textoResponsableDynamics(p.responsableDynamics)} · {textoClase(p.claseDynamics)}
      </CeldaTexto>
    ),
  },
  {
    clave: 'excepcion',
    titulo: 'Tu excepción',
    ancho: 210,
    celda: (p) => {
      const pill = pillDelAuditor(p);
      return pill ? <Pill texto={pill.texto} tono={pill.tono} /> : <CeldaTexto color={colors.grisClaro}>Sin excepción</CeldaTexto>;
    },
  },
];

/**
 * Identidad estable para "la tabla no tiene filas". Un `[]` nuevo en cada
 * render haría que `TablaWeb` reiniciara su tanda en cada render.
 */
const SIN_FILAS: ProductoClasificable[] = [];

/**
 * El selector de las tres vías. Son `Pressable` reales y no `View` porque acá
 * SÍ hay una elección, y es la más cara de esta pantalla: mueve el faltante de
 * un cuadro a otro de la liquidación.
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
 * ---------------------------------------------------------------------------
 * CLASIFICACIÓN DE PRODUCTOS EN EL NAVEGADOR: UNA TABLA
 * ---------------------------------------------------------------------------
 * Clon de `ClasificacionScreen.tsx`; el del teléfono no se toca. Mismos
 * repositorios, mismo dominio (`lib/dominio/clasificacion`), mismos textos y
 * mismos mensajes: es un rediseño, no una pantalla nueva.
 *
 * POR QUÉ CAMBIA LA FORMA: en el teléfono cada producto es una tarjeta de tres
 * renglones, porque una columna de 400px no aguanta cuatro datos en fila. Acá
 * la pregunta que se hace el Auditor es "¿dónde el sistema y yo no coincidimos?",
 * y eso se responde barriendo dos columnas —lo que dice el sistema y lo que
 * decidió él— de arriba abajo. Eso es una tabla.
 *
 * EL MODAL NO CAMBIA, y es a propósito: ahí se decide sobre el sueldo de
 * alguien, y cada párrafo de ese formulario salió de un hallazgo (el empaque
 * que no se podía corregir solo, el Paquete sin efecto, el botón atrás que
 * descartaba lo tecleado). Rediseñarlo sería reabrir todas esas decisiones.
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
  const [clase, setClase] = useState<ClaseItem | null>(null);
  const [empaqueTexto, setEmpaqueTexto] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  const filtroActual = useCallback(
    (desplazamiento: number) => ({
      q: q.trim() ? q.trim() : undefined,
      soloClasificados,
      limite: TAMANO_PAGINA,
      desplazamiento,
    }),
    [q, soloClasificados],
  );

  const productosRef = useRef(0);
  productosRef.current = productos.length;

  const cargar = useCallback(async () => {
    setError(null);
    try {
      // Todas las páginas que ya estaban, no solo la primera: quien cargó 120
      // productos y vuelve a la pantalla no puede encontrarse con 40.
      const cuantos = limiteParaRefrescar(productosRef.current, TAMANO_PAGINA);
      const pagina = await repositorioClasificacion.buscar({ ...filtroActual(0), limite: cuantos });
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

  // Al cambiar la búsqueda o el filtro: recarga desde la primera página, con
  // un respiro para no pegarle al backend en cada tecla. El primer render no
  // corre — esa carga la dispara `useRefrescoAlEnfocar`.
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

  function sembrarCampos(p: ProductoClasificable): void {
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

  function abrir(p: ProductoClasificable): void {
    setSeleccionado(p);
    sembrarCampos(p);
    void confirmarContraElServidor(p);
  }

  /**
   * RELEE ESTE PRODUCTO DEL SERVIDOR AL ABRIRLO. `ClasificacionProducto` es
   * por CÓDIGO y cross-tienda, así que dos auditores tocan la misma fila y la
   * copia de la lista puede tener horas. De ahí sale la frase que decide todo
   * ("Hoy va a Unidad; al guardar pasa a Paquete"), y con la copia vencida esa
   * frase afirma un "hoy" que ya no es.
   *
   * No bloquea el modal, y NO PISA LO TECLEADO: si la respuesta llega cuando
   * la persona ya movió algo, se actualiza el producto pero no se vuelven a
   * sembrar los campos.
   */
  async function confirmarContraElServidor(p: ProductoClasificable): Promise<void> {
    try {
      // `q` pega contra código, descripción y categoría, así que un código
      // puede traer vecinos: se busca la coincidencia EXACTA.
      const pagina = await repositorioClasificacion.buscar({ q: p.codigo, limite: 20, desplazamiento: 0 });
      const fresco = pagina.productos.find((x) => x.codigo === p.codigo);
      if (fresco === undefined) return;

      setProductos((actuales) => aplicarClasificacion(actuales, p.codigo, fresco.clasificacion));
      setSeleccionado((actual) => {
        // Cerró el modal, o abrió otro producto, mientras esto viajaba.
        if (actual === null || actual.codigo !== p.codigo) return actual;
        if (!hayCambiosSinGuardarRef.current) sembrarCampos(fresco);
        return fresco;
      });
    } catch {
      /* se sigue con la copia de la lista: ver arriba */
    }
  }

  function cerrar(): void {
    setSeleccionado(null);
    setClase(null);
    setEmpaqueTexto('');
    setNota('');
  }

  /**
   * CERRAR SIN PERDER LO TECLEADO EN SILENCIO. Se pregunta SOLO si hay algo
   * distinto de lo guardado: un diálogo en cada salida enseña a tocar
   * "Descartar" sin leer, y entonces deja de proteger nada el día que importa.
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
        // pueden discrepar.
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

  const esExcepcionVieja = seleccionado?.clasificacion !== null && seleccionado?.clasificacion?.clase === null;
  const empaqueDelErp = seleccionado
    ? textoEmpaqueCompra(seleccionado.empaqueCompra, seleccionado.empaqueCompraSimbolo)
    : null;
  const errorEmpaque = errorDeEmpaque(empaqueTexto);

  const hayCambiosSinGuardar =
    seleccionado !== null &&
    (clase !== (seleccionado.clasificacion?.clase ?? null) ||
      empaqueTexto.trim() !==
        (seleccionado.clasificacion?.empaqueCompraCorregido == null
          ? ''
          : String(seleccionado.clasificacion.empaqueCompraCorregido)) ||
      nota.trim() !== (seleccionado.clasificacion?.nota ?? ''));

  // En un ref para que `confirmarContraElServidor` lo lea CUANDO VUELVE la
  // respuesta y no cuando salió el pedido.
  const hayCambiosSinGuardarRef = useRef(false);
  hayCambiosSinGuardarRef.current = hayCambiosSinGuardar;

  const correccion = empaqueTecleado(empaqueTexto);
  /** Hay ALGO que guardar: un cuadro forzado, o una corrección de empaque. */
  const hayAlgoQueGuardar = clase !== null || correccion !== null;
  const consecuencia =
    seleccionado && errorEmpaque === null && hayAlgoQueGuardar
      ? consecuenciaDeEmpaque(seleccionado, clase, correccion)
      : null;

  const cifras = `${formatoMiles(total)} ${soloClasificados ? pluralizar(total, 'excepción', 'excepciones') : pluralizar(total, 'producto', 'productos')}`;

  /**
   * Cargando o con error, la tabla va SIN FILAS y muestra su `vacio` -- que es
   * exactamente lo que hacía antes, cuando el spinner y el cartel de error
   * reemplazaban la tabla entera. En particular, un fallo de "Cargar más"
   * sigue dejando el listado en su cartel de error en vez de mostrar media
   * lista con un error escondido.
   */
  const filasDeLaTabla = cargando || error !== null ? SIN_FILAS : productos;
  // `recuperarAlDespausar`: el disparo que llegue con un producto abierto no
  // se tira -- corre al cerrar el modal.
  useRefrescoAlEnfocar(cargar, { pausado: seleccionado !== null, recuperarAlDespausar: true });

  return (
    <ScrollView style={styles.pagina} contentContainerStyle={styles.contenido} showsVerticalScrollIndicator={false}>
      <EncabezadoPagina
        migas={['Auditoría', 'Clasificación de productos']}
        titulo="Clasificación de productos"
        sub={AVISO_CUANDO_APLICA}
        onInicio={() => router.push('/')}
      />

      {/*
        LA TABLA ÚNICA DE LA WEB, Y EL BUSCADOR ADENTRO DE SU ENCABEZADO.
        Antes el buscador y los chips vivían en una tarjeta aparte arriba de la
        tabla; ahora van donde se usan, a la derecha del título.

        SE DIBUJA SIEMPRE, incluso cargando o sin resultados, y eso no es un
        detalle: con el buscador dentro del encabezado, esconder la tabla
        cuando la búsqueda no devuelve nada escondería también el campo con el
        que se escribió esa búsqueda -- justo cuando hace falta para
        corregirla. Los tres estados (cargando, error, sin resultados) van en
        `vacio`, con los mismos textos de siempre.
      */}
      <TablaWeb
        titulo="Catálogo"
        icono={Tag}
        columnas={COLUMNAS}
        filas={filasDeLaTabla}
        claveDe={(p) => p.codigo}
        onAbrirFila={abrir}
        herramientas={
          <>
            <BuscadorTabla valor={q} onCambiar={setQ} />
            <ChipsFiltro
              opciones={OPCIONES_FILTRO}
              activo={soloClasificados ? 'clasificados' : 'todos'}
              onCambiar={(id) => setSoloClasificados(id === 'clasificados')}
            />
          </>
        }
        /*
          EL TOTAL ES EL DEL CATÁLOGO, no el de lo que se trajo. `filas.length`
          son los productos que hay EN MEMORIA (40 por página), y decir
          "Mostrando 40 de 40" sobre un catálogo de 11.800 sería el cero que
          miente de siempre, con otro disfraz. `cifras` ya trae el total real
          del servidor y su plural.
        */
        pie={(mostradas) => (cargando ? cifras : `Mostrando ${formatoMiles(mostradas)} de ${cifras}`)}
        vacio={
          cargando ? (
            <ActivityIndicator color={colors.rojo} />
          ) : error ? (
            <View style={styles.vacioBloque}>
              <Text style={styles.ayuda}>{error}</Text>
              <BotonWeb
                etiqueta="Reintentar"
                variante="principal"
                onPress={() => {
                  setCargando(true);
                  void cargar();
                }}
              />
            </View>
          ) : (
            <View style={styles.vacioBloque}>
              <Text style={styles.vacioTitulo}>
                {soloClasificados ? 'Todavía no hay excepciones' : 'Sin resultados'}
              </Text>
              <Text style={styles.ayuda}>
                {soloClasificados
                  ? 'Cuando marques un producto como empresa, paquete o unidad, va a aparecer aquí.'
                  : 'Prueba con otro código, descripción o categoría.'}
              </Text>
            </View>
          )
        }
      />

      {/*
        "CARGAR MÁS" SE QUEDA, y no es la paginación que hace la tabla. La de
        `TablaWeb` corta el DIBUJO de filas que ya están en memoria; esta trae
        del SERVIDOR las que todavía no llegaron -- el catálogo son ~11.800
        productos y acá entran de a 40. Sacarla dejaría 40 productos como techo
        de la pantalla.
      */}
      {hayMasPorCargar(productos.length, total) ? (
        <BotonWeb etiqueta="Cargar más" cargando={cargandoMas} onPress={() => void cargarMas()} />
      ) : null}

      <Modal visible={seleccionado !== null} transparent animationType="fade" onRequestClose={intentarCerrar}>
        <Pressable style={styles.overlay} onPress={intentarCerrar} accessibilityLabel="Cerrar" />
        <View pointerEvents="box-none" style={styles.modalCentrado}>
          {/* `onPress` vacío: captura el toque para que tocar DENTRO no cierre. */}
          <Pressable style={styles.modalCaja} onPress={() => {}}>
            <ScrollView contentContainerStyle={styles.modalCuerpo} showsVerticalScrollIndicator={false}>
              <View style={styles.modalCabecera}>
                <Text style={styles.modalTitulo} numberOfLines={2}>
                  {seleccionado?.descripcion}
                </Text>
                <Pressable onPress={intentarCerrar} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={8}>
                  <X size={20} color={colors.gris} />
                </Pressable>
              </View>
              <Text style={styles.modalCodigo}>{seleccionado?.codigo}</Text>

              <View style={styles.modalDatos}>
                <View style={styles.modalDato}>
                  <Text style={styles.modalDatoRotulo}>El sistema hace</Text>
                  <Text style={styles.modalDatoValor}>
                    {seleccionado
                      ? `${textoResponsableDynamics(seleccionado.responsableDynamics)} · ${textoClase(seleccionado.claseDynamics)}`
                      : ''}
                  </Text>
                </View>
                <View style={styles.modalDato}>
                  <Text style={styles.modalDatoRotulo}>Tu excepción</Text>
                  <Text style={styles.modalDatoValor}>{textoExcepcionActual(seleccionado)}</Text>
                </View>
              </View>

              {esExcepcionVieja ? (
                <View style={styles.notaVieja}>
                  <Text style={styles.notaViejaTexto}>
                    Esta excepción se cargó antes de que existieran las tres vías, así que solo dice si la asume la
                    empresa. Elige una vía para dejarla completa.
                  </Text>
                </View>
              ) : null}

              <View style={styles.modalSeccionFila}>
                <Text style={styles.modalSeccion}>Forzar el cuadro</Text>
                <Text style={styles.modalSeccionOpcional}>opcional</Text>
              </View>
              <SelectorClase valor={clase} onElegir={setClase} disabled={guardando} />
              {clase !== null ? (
                <Pressable onPress={() => setClase(null)} disabled={guardando} accessibilityRole="button">
                  <Text style={styles.quitarCuadro}>Quitar el cuadro forzado — que lo decida el sistema</Text>
                </Pressable>
              ) : null}
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

              {consecuencia ? (
                <View style={[styles.consecuencia, consecuencia.cambia && styles.consecuenciaCambia]}>
                  <Text style={styles.consecuenciaTitulo}>Qué va a pasar con los faltantes de este producto</Text>
                  <Text style={styles.consecuenciaTexto}>
                    {consecuencia.cambia ? (
                      <>
                        Hoy va a <Text style={styles.explicacionFuerte}>{textoClase(consecuencia.claseAntes)}</Text>; al
                        guardar pasa a{' '}
                        <Text style={styles.explicacionFuerte}>{textoClase(consecuencia.claseDespues)}</Text>.{' '}
                        {explicacionClase(consecuencia.claseDespues)}
                      </>
                    ) : (
                      <>
                        Sigue en <Text style={styles.explicacionFuerte}>{textoClase(consecuencia.claseDespues)}</Text>.{' '}
                        {explicacionClase(consecuencia.claseDespues)}
                      </>
                    )}
                  </Text>
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

              <BotonWeb
                etiqueta={guardando ? 'Guardando…' : seleccionado?.clasificacion ? 'Guardar el cambio' : 'Guardar la excepción'}
                variante="principal"
                cargando={guardando}
                deshabilitado={!hayAlgoQueGuardar || errorEmpaque !== null || guardando}
                onPress={() => void guardarClase()}
              />
              {!hayAlgoQueGuardar ? (
                <Text style={styles.hint}>Corrige el empaque o fuerza un cuadro: por ahora no hay nada que guardar.</Text>
              ) : null}

              {seleccionado?.clasificacion ? (
                <View style={styles.quitarBloque}>
                  <Text style={styles.quitarExplicacion}>
                    Quitar la excepción devuelve este producto a lo que hace el sistema:{' '}
                    <Text style={styles.explicacionFuerte}>{textoClase(seleccionado.claseDynamics)}</Text>.{' '}
                    {explicacionClase(seleccionado.claseDynamics)}
                    {seleccionado.clasificacion?.empaqueCompraCorregido !== null &&
                    seleccionado.clasificacion?.empaqueCompraCorregido !== undefined
                      ? ` También se borra tu corrección del empaque (${seleccionado.clasificacion.empaqueCompraCorregido}): vuelve al del ERP.`
                      : ''}
                  </Text>
                  <BotonWeb etiqueta="Quitar la excepción" deshabilitado={guardando} onPress={() => void quitarExcepcion()} />
                </View>
              ) : null}
            </ScrollView>
          </Pressable>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pagina: { flex: 1 },
  contenido: { padding: spacing.xxl, gap: spacing.lg },

  /** El buscador de la barra de herramientas: una sola línea, alto de control chico. */
  buscador: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    width: 300,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
    backgroundColor: colors.campo,
  },
  // Sin tocar el `outline` del navegador: los tipos de React Native no lo
  // admiten, y ningún otro campo de la app lo apaga. El halo de foco queda
  // como en el resto de los inputs.
  buscadorInput: { flex: 1, fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.regular },

  /** Los tres estados sin filas (cargando, error, sin resultados) dentro de la tabla. */
  vacioBloque: { gap: spacing.md, alignItems: 'center', maxWidth: 460 },
  vacioTitulo: { fontSize: fontSize.lg, color: colors.tinta, fontFamily: fonts.bold, textAlign: 'center' },
  ayuda: { fontSize: fontSize.sm, lineHeight: 19, color: colors.gris, fontFamily: fonts.regular },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: radius.full,
  },
  punto: { width: 6, height: 6, borderRadius: radius.full },
  pillTexto: { fontSize: fontSize.xs, fontFamily: fonts.semibold },

  // `.segmentado`/`.segmento` del design system: Pressable reales porque acá
  // SÍ hay una elección.
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

  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  modalCentrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCaja: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '88%',
    backgroundColor: colors.campo,
    borderRadius: radius.xl,
  },
  modalCuerpo: { padding: spacing.lg, gap: spacing.md },
  modalCabecera: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  modalTitulo: { flex: 1, fontSize: fontSize.lg, color: colors.tinta, fontFamily: fonts.bold },
  modalCodigo: { fontSize: fontSize.sm, color: colors.grisClaro, fontFamily: fonts.regular, marginTop: -6 },
  modalDatos: { flexDirection: 'row', gap: spacing.md },
  modalDato: { flex: 1, gap: 2, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.esperaSuave },
  modalDatoRotulo: { fontSize: fontSize.xs, color: colors.gris, fontFamily: fonts.medium },
  modalDatoValor: { fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.semibold },

  notaVieja: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.procesoSuave },
  notaViejaTexto: { fontSize: fontSize.sm, lineHeight: 18, color: colors.tinta, fontFamily: fonts.regular },

  modalSeccionFila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  modalSeccionOpcional: { fontSize: 11, color: colors.grisClaro, fontFamily: fonts.regular },
  modalSeccion: {
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.gris,
    fontFamily: fonts.semibold,
  },
  quitarCuadro: { fontSize: 11.5, lineHeight: 16, color: colors.rojo, fontFamily: fonts.semibold },
  explicacion: { fontSize: 12, lineHeight: 17, color: colors.gris, fontFamily: fonts.regular },
  explicacionesTodas: { gap: 5 },
  explicacionFuerte: { color: colors.tinta, fontFamily: fonts.bold },

  empaqueFila: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  empaqueCelda: {
    flex: 1,
    gap: 3,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.esperaSuave,
  },
  empaqueCampo: { flex: 1, gap: 3 },
  empaqueCeldaRotulo: { fontSize: fontSize.xs, color: colors.gris, fontFamily: fonts.medium },
  empaqueCeldaValor: { fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  empaqueInput: {
    minHeight: 46,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
    backgroundColor: colors.blanco,
    fontSize: fontSize.base,
    color: colors.tinta,
    fontFamily: fonts.semibold,
  },
  empaqueInputError: { borderColor: colors.falta },
  empaqueError: { fontSize: 11.5, color: colors.falta, fontFamily: fonts.medium },
  empaqueAviso: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.procesoSuave,
  },
  empaqueAvisoTexto: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.tinta, fontFamily: fonts.regular },

  consecuencia: { gap: 6, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.esperaSuave },
  consecuenciaCambia: { backgroundColor: colors.rojoSuave },
  consecuenciaTitulo: { fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.bold },
  consecuenciaTexto: { fontSize: 12, lineHeight: 17, color: colors.gris, fontFamily: fonts.regular },

  hint: { fontSize: 11.5, lineHeight: 16, color: colors.gris, fontFamily: fonts.regular },
  quitarBloque: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borde },
  quitarExplicacion: { fontSize: 12, lineHeight: 17, color: colors.gris, fontFamily: fonts.regular },
});
