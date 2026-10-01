import { router, useLocalSearchParams } from 'expo-router';
import {
  Ban,
  Check,
  ChevronLeft,
  Coins,
  FileSpreadsheet,
  FileX2,
  RefreshCw,
  TriangleAlert,
  Undo2,
  Upload,
  X,
} from 'lucide-react-native';
import { useCallback, useMemo, useState, type JSX } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { esErrorApi } from '../../lib/adaptadores/_http';
import { ajustesNegativosApi } from '../../lib/adaptadores/ajustes-negativos-api';
import {
  accionDeLinea,
  errorDeMotivoLinea,
  estadoNegativos,
  resumenPreview,
  TEXTO_LINEAS_BLOQUEADAS,
  textoImportacionConfirmada,
  textoMotivoAdvertencia,
  textoMotivoRechazo,
  textoQueSeConfirma,
  textosAccionLinea,
  tituloPreviewFallido,
  vistaImportar,
  type AccionLinea,
  type LineaAjusteNegativoGuardada,
  type ListadoLineasAjustesNegativos,
  type ResultadoPreviewAjustesNegativos,
} from '../../lib/dominio/ajustes-negativos';
import { elegirArchivoXlsx } from '../../lib/leer-archivo';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';
import { useRefrescoAlEnfocar } from '../hooks/useRefrescoAlEnfocar';
import { formatoFechaHora, formatoMoneda } from '../ui';
import {
  BotonIcono,
  BotonWeb,
  CeldaTexto,
  ChipIcono,
  EncabezadoPagina,
  TablaWeb,
  TarjetaWeb,
  type ColumnaTabla,
  type TinteFila,
} from '../web';

/**
 * ---------------------------------------------------------------------------
 * EL EXCEL DE NEGATIVOS, EN EL NAVEGADOR
 * ---------------------------------------------------------------------------
 * Clon de `AjustesNegativosScreen.tsx` con el diseño de la web. El del teléfono
 * NO se toca -- decisión del usuario, textual: *"no utilices la misma pantalla
 * del móvil, clónalo y cámbialo, en todo caso son plataformas diferentes"*.
 * Metro elige este archivo cuando el bundle es de web, y
 * `app/auditor/ajustes-negativos.tsx` no se enteró de nada.
 *
 * LA FUNCIONALIDAD ES LA MISMA, entera: elegir el archivo, previsualizar SIN
 * escribir nada, ver las líneas que el backend marcó dudosas sin descartarlas,
 * confirmar, y después excluir o volver a incluir líneas puntuales de lo ya
 * guardado con motivo obligatorio. Mismo adaptador
 * (`ajustesNegativosApi`), mismas reglas (`lib/dominio/ajustes-negativos.ts`),
 * mismos textos. Lo que cambia es la forma.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTABA ROTO EN EL NAVEGADOR, Y NO ERA EL DISEÑO
 * ---------------------------------------------------------------------------
 * 1. EL ARCHIVO NO SE PODÍA LEER. La pantalla llamaba a `File` de
 *    `expo-file-system`, que en web NO EXISTE: el Auditor elegía el Excel de
 *    Jocelyn desde su PC y la pantalla le contestaba "No se pudo leer el
 *    archivo" -- un mensaje que acusa al archivo de un problema que era
 *    nuestro, y que manda a pedirle otra copia a quien mandó la buena. Se
 *    arregla con `elegirArchivoXlsx()` (`lib/leer-archivo.ts` + su `.web.ts`):
 *    elige Y lee, por plataforma, y devuelve `null` cuando la persona canceló
 *    -- que no es un error y no se avisa como tal.
 *
 * 2. `Alert.alert` ES UN MÉTODO VACÍO EN REACT-NATIVE-WEB
 *    (`react-native-web/dist/exports/Alert/index.js`: `static alert() {}`). La
 *    confirmación de la importación salía por ahí: el Auditor apretaba
 *    "Confirmar importación", la importación QUEDABA ESCRITA en la base, y la
 *    pantalla no decía absolutamente nada. Acá no hay ni un `Alert`: cada aviso
 *    va en la página.
 *      - el "Importación confirmada" → la banda de resultado, con el texto de
 *        `textoImportacionConfirmada` (archivo, líneas y monto);
 *      - los errores de leer y de confirmar → la misma banda, en rojo y con
 *        una X para cerrarla;
 *      - el error de GUARDAR UNA LÍNEA → adentro del diálogo, no en la banda:
 *        el diálogo tiene su propio overlay encima de la página, así que un
 *        aviso allá abajo queda tapado justo cuando hace falta;
 *      - el error de carga inicial → una tarjeta con "Volver a intentar", que
 *        es lo que en el teléfono era tirar para refrescar;
 *      - EL MOTIVO QUE FALTA → debajo del botón del diálogo, con el `motivo` de
 *        `BotonWeb`. En el teléfono ese caso solo apagaba el botón y no decía
 *        qué faltaba.
 *
 * ---------------------------------------------------------------------------
 * LAS DOS LISTAS SON TABLAS, Y VAN CON `TablaWeb`
 * ---------------------------------------------------------------------------
 * Decisión del usuario: *"todas las tablas de la web tienen que tener este
 * diseño"*. En el teléfono las líneas son renglones de prosa apilados ("Fila 14
 * (100234): La fecha de Registrado en cae fuera del período"), que en una
 * columna de 400px es lo único que entra. En una PC lo que se hace es recorrer
 * la columna Importe y la de Estado de arriba abajo buscando la que no
 * corresponde -- y eso es una tabla. Son DOS porque responden dos preguntas
 * distintas: la del preview es "qué va a entrar si confirmo" y la de abajo es
 * "qué está contando hoy y qué saqué".
 *
 * La paginación por scroll, la cabecera y el pie los pone el componente; acá
 * solo se declaran las columnas y el tinte de cada fila.
 */

/**
 * EL TOPE DE ANCHO del contenido, aunque la ventana tenga 1.900. Misma medida y
 * mismo motivo que `auditoria.web.tsx`: sin esto cada renglón de "etiqueta a la
 * izquierda, número a la derecha" se estira medio metro y hay que barrer la
 * cabeza para juntar el concepto con su cifra -- *"parecen estirados"*.
 *
 * Va en una View ENVOLTORIO de cada bloque, NUNCA en `TarjetaWeb`: la tarjeta
 * trae `flex: 1`, que en la web es `flex: 1 1 0%` y le gana a cualquier ancho
 * que se le pase después (pasado a la tarjeta, las de auditoría se encogieron
 * hasta una letra de ancho y el texto salió en vertical).
 */
const TOPE_ANCHO = 1132;

/** Abajo de esto la banda se apila: es media pantalla en una PC, no un teléfono. */
const ANCHO_ANGOSTO = 1180;

/** Sin dato es "—", nunca un 0: un cero es una afirmación, el guion es "no sé". */
const SIN_DATO = '—';

/** El formato de moneda de la app, con su símbolo. Se inyecta al dominio, que no conoce soles. */
const soles = (n: number): string => `S/ ${formatoMoneda(n)}`;

/** Lo que pasó con la última acción: se dice en la página, no en un `Alert` que acá no existe. */
interface Aviso {
  texto: string;
  tono: 'ok' | 'error';
}

type EstadoFilaPreview = 'entra' | 'advertencia' | 'rechazada';

interface FilaPreview {
  clave: string;
  fila: number;
  /** `null` en las rechazadas: el lector del backend no llegó a sacarles el código. */
  codigo: string | null;
  nombre: string | null;
  importe: number | null;
  estado: EstadoFilaPreview;
  /** Por qué está marcada. `null` en las que entran sin nada que decir. */
  detalle: string | null;
}

/**
 * LAS DOS LISTAS DEL PREVIEW EN UNA SOLA TABLA, EN EL ORDEN DEL ARCHIVO.
 *
 * El backend devuelve `validas` y `rechazadas` aparte, y en el teléfono son dos
 * bloques. Acá se mezclan y se ordenan por número de fila a propósito: la
 * columna "Fila" es el número de fila DEL EXCEL, y quien tiene el archivo
 * abierto al lado va a buscar esa fila ahí. Con dos tablas separadas hay que
 * mirar en las dos para saber qué pasó con la fila 37.
 *
 * Lo que NO se mezcla es el significado: una rechazada NO suma y una advertida
 * SÍ (queda a criterio del Auditor excluirla después de confirmar). Eso lo
 * dicen la columna Estado y el tinte de la fila, no el orden.
 */
function filasDelPreview(preview: Extract<ResultadoPreviewAjustesNegativos, { ok: true }>): FilaPreview[] {
  const validas = preview.validas.map<FilaPreview>((v) => ({
    clave: `valida-${v.fila}`,
    fila: v.fila,
    codigo: v.codigo,
    nombre: v.nombre2,
    importe: v.importe,
    estado: v.advertencias.length > 0 ? 'advertencia' : 'entra',
    // Todas las advertencias de la línea, no la primera: dos motivos distintos
    // se destraban distinto, y quedarse con uno esconde el otro.
    detalle: v.advertencias.length > 0 ? v.advertencias.map(textoMotivoAdvertencia).join(' ') : null,
  }));

  const rechazadas = preview.rechazadas.map<FilaPreview>((r) => ({
    clave: `rechazada-${r.fila}`,
    fila: r.fila,
    codigo: null,
    nombre: null,
    importe: null,
    estado: 'rechazada',
    detalle: textoMotivoRechazo(r.motivo),
  }));

  return [...validas, ...rechazadas].sort((a, b) => a.fila - b.fila);
}

/**
 * EL TINTE DE LA FILA. Solo para lo que no es normal: rojo lo que no entra,
 * ámbar lo que entra pero espera una decisión. Las que entran limpias van sin
 * tinte -- si se pintan todas, el color deja de señalar nada.
 */
function tinteDePreview(fila: FilaPreview): TinteFila {
  if (fila.estado === 'rechazada') return 'falta';
  if (fila.estado === 'advertencia') return 'atencion';
  return null;
}

const TEXTO_ESTADO_PREVIEW: Record<EstadoFilaPreview, { texto: string; color?: string }> = {
  // Sin color: es la enorme mayoría, y el color está reservado para lo que hay
  // que mirar.
  entra: { texto: 'Entra a la suma' },
  advertencia: { texto: 'Suma, con aviso', color: colors.proceso },
  rechazada: { texto: 'No entra', color: colors.falta },
};

export function AjustesNegativosScreen(): JSX.Element {
  const params = useLocalSearchParams<{ inventarioId?: string }>();
  const inventarioId = params.inventarioId ? Number(params.inventarioId) : null;
  const { width, height } = useWindowDimensions();
  const angosto = width < ANCHO_ANGOSTO;

  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [montoNegativos, setMontoNegativos] = useState<number | null>(null);
  const [listado, setListado] = useState<ListadoLineasAjustesNegativos | null>(null);

  const [archivo, setArchivo] = useState<{ nombre: string; bytes: Uint8Array } | null>(null);
  const [previsualizando, setPrevisualizando] = useState(false);
  const [preview, setPreview] = useState<ResultadoPreviewAjustesNegativos | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const [dialogo, setDialogo] = useState<{ linea: LineaAjusteNegativoGuardada; accion: AccionLinea } | null>(null);
  const [guardandoLineaId, setGuardandoLineaId] = useState<number | null>(null);
  /**
   * El error de guardar una línea va ADENTRO del diálogo, no en la banda de la
   * página: el diálogo tiene su propio overlay encima de todo, así que un aviso
   * en la página queda tapado justo cuando hace falta -- que es el mismo agujero
   * que dejaba `Alert.alert` en la web, con otra forma.
   */
  const [errorLinea, setErrorLinea] = useState<string | null>(null);

  const [aviso, setAviso] = useState<Aviso | null>(null);

  const cargar = useCallback(async () => {
    if (inventarioId === null) {
      setCargando(false);
      return;
    }
    setErrorCarga(null);
    try {
      // Las dos llamadas juntas: el monto y el listado son la MISMA verdad
      // contada de dos formas, y pedirlas en serie deja medio segundo en el que
      // el cartel de arriba y la tabla de abajo se contradicen.
      const [estado, lineas] = await Promise.all([
        ajustesNegativosApi.estado(inventarioId),
        ajustesNegativosApi.listarLineas(inventarioId),
      ]);
      setMontoNegativos(estado.montoNegativos);
      setListado(lineas);
    } catch (e) {
      setErrorCarga(esErrorApi(e) ? e.message : 'No se pudo cargar el estado de los ajustes.');
    } finally {
      setCargando(false);
    }
  }, [inventarioId]);

  /**
   * Pausado mientras hay un diálogo abierto o algo guardándose: un refresco que
   * llega en el medio le borra el motivo a medio escribir, y eso es perder
   * trabajo de la persona (ver useRefrescoAlEnfocar.ts). `recuperarAlDespausar`
   * queda prendido porque la respuesta de excluir/incluir actualiza SU línea y
   * su monto, pero no el resto del listado.
   */
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar, {
    pausado: dialogo !== null || guardandoLineaId !== null || confirmando,
    recuperarAlDespausar: true,
  });

  async function elegirArchivo(): Promise<void> {
    if (inventarioId === null) return;
    // Elegir Y leer, en una sola llamada y por plataforma: en el navegador es
    // el `File` del DOM, sin tocar disco. Antes esto llamaba a
    // `expo-file-system` directo y acá moría con "No se pudo leer el archivo"
    // sobre un Excel perfectamente válido.
    let elegido: { nombre: string; bytes: Uint8Array } | null;
    try {
      elegido = await elegirArchivoXlsx();
    } catch (e) {
      // El selector del navegador no entregó el archivo. Es raro, y se dice tal
      // cual en vez de mostrarlo como un problema del Excel.
      setAviso({ tono: 'error', texto: e instanceof Error ? e.message : 'No se pudo abrir el archivo elegido.' });
      return;
    }
    // Canceló el diálogo del navegador: no es un error y no se avisa. Lo que YA
    // estaba en pantalla se queda como estaba.
    if (elegido === null) return;

    setPreview(null);
    setArchivo(null);
    setAviso(null);
    setPrevisualizando(true);
    try {
      setArchivo(elegido);
      // Vista previa: NO persiste nada. El monto de arriba sigue siendo el que
      // está guardado hasta que se confirme.
      setPreview(await ajustesNegativosApi.previsualizar(inventarioId, elegido.bytes));
    } catch (e) {
      setAviso({ tono: 'error', texto: esErrorApi(e) ? e.message : 'No se pudo leer el archivo.' });
    } finally {
      setPrevisualizando(false);
    }
  }

  async function confirmar(): Promise<void> {
    if (inventarioId === null || archivo === null || preview?.ok !== true) return;
    setConfirmando(true);
    setAviso(null);
    try {
      const resultado = await ajustesNegativosApi.confirmar(inventarioId, archivo.bytes, archivo.nombre);
      setPreview(null);
      setArchivo(null);
      await cargar(); // trae el listado ya persistido -- una sola fuente de verdad.
      // ESTO era el `Alert.alert` del teléfono, que en el navegador no muestra
      // NADA: sin esta banda, la importación quedaba escrita y la pantalla
      // parecía no haber hecho nada.
      setAviso({ tono: 'ok', texto: textoImportacionConfirmada(resultado, soles) });
    } catch (e) {
      setAviso({ tono: 'error', texto: esErrorApi(e) ? e.message : 'No se pudo confirmar la importación.' });
    } finally {
      setConfirmando(false);
    }
  }

  function descartarPreview(): void {
    setPreview(null);
    setArchivo(null);
    setAviso(null);
  }

  async function guardarMotivo(motivo: string): Promise<void> {
    if (inventarioId === null || dialogo === null) return;
    const { linea, accion } = dialogo;
    setGuardandoLineaId(linea.id);
    setAviso(null);
    setErrorLinea(null);
    try {
      const resultado =
        accion === 'excluir'
          ? await ajustesNegativosApi.excluirLinea(inventarioId, linea.id, motivo)
          : await ajustesNegativosApi.incluirLinea(inventarioId, linea.id, motivo);

      // El monto lo manda el servidor recalculado; NO se suma a mano acá. La
      // línea se reemplaza en su lugar para no perder el orden ni recargar la
      // tabla entera por un cambio de una fila.
      setMontoNegativos(resultado.montoNegativos);
      setListado((actual) =>
        actual
          ? { ...actual, lineas: actual.lineas.map((l) => (l.id === resultado.linea.id ? resultado.linea : l)) }
          : actual,
      );
      setDialogo(null);
      setAviso({
        tono: 'ok',
        texto:
          accion === 'excluir'
            ? `Línea ${linea.fila} excluida. El monto de ajustes quedó en ${soles(resultado.montoNegativos)}.`
            : `Línea ${linea.fila} vuelve a contar. El monto de ajustes quedó en ${soles(resultado.montoNegativos)}.`,
      });
    } catch (e) {
      // El diálogo NO se cierra: el motivo escrito se conserva para reintentar,
      // y el error se muestra ahí mismo.
      setErrorLinea(esErrorApi(e) ? e.message : 'No se pudo guardar el cambio.');
    } finally {
      setGuardandoLineaId(null);
    }
  }

  const estado = estadoNegativos(montoNegativos);
  const vista = vistaImportar(listado?.importacion ?? null);
  const puedeEditar = listado?.puedeEditar ?? false;
  const excluidas = listado?.lineas.filter((l) => l.excluida).length ?? 0;

  /**
   * Las columnas de las líneas YA GUARDADAS. "Descripción" y "Motivo" van sin
   * `ancho`: se reparten lo que sobra, y son las dos que llevan prosa. El resto
   * son cifras cortas y estirarlas solo aleja el número de su encabezado.
   */
  const columnasGuardadas = useMemo<ColumnaTabla<LineaAjusteNegativoGuardada>[]>(
    () => [
      { clave: 'fila', titulo: 'Fila', ancho: 56, alinear: 'derecha', celda: (l) => <CeldaTexto numero>{l.fila}</CeldaTexto> },
      { clave: 'codigo', titulo: 'Código', ancho: 96, celda: (l) => <CeldaTexto>{l.codigo}</CeldaTexto> },
      { clave: 'descripcion', titulo: 'Descripción', celda: (l) => <CeldaTexto>{l.descripcion}</CeldaTexto> },
      {
        clave: 'importe',
        titulo: 'Importe',
        ancho: 110,
        alinear: 'derecha',
        // La excluida se muestra en gris claro y no se tacha: lo que dice la
        // fila es que ese importe EXISTE en el archivo y no está sumando.
        celda: (l) => (
          <CeldaTexto numero fuerte={!l.excluida} color={l.excluida ? colors.grisClaro : undefined}>
            {soles(l.importe)}
          </CeldaTexto>
        ),
      },
      {
        clave: 'estado',
        titulo: 'Estado',
        ancho: 96,
        celda: (l) =>
          l.excluida ? (
            <CeldaTexto fuerte color={colors.falta}>
              Excluida
            </CeldaTexto>
          ) : (
            <CeldaTexto>Cuenta</CeldaTexto>
          ),
      },
      {
        clave: 'motivo',
        titulo: 'Motivo de la exclusión',
        // EL MOTIVO CON NOMBRE Y FECHA, no solo el texto: es el pedido de
        // Gilmer llevado a su consecuencia -- si alguien saca una línea del
        // descuento de una persona, la tabla dice quién y cuándo.
        celda: (l) =>
          l.excluida ? (
            <Text style={styles.celdaMotivo} numberOfLines={2}>
              {l.motivoExclusion ?? SIN_DATO}
              <Text style={styles.celdaMotivoQuien}>
                {` — ${l.excluidaPor?.nombre ?? SIN_DATO}${l.excluidaEn ? `, ${formatoFechaHora(l.excluidaEn)}` : ''}`}
              </Text>
            </Text>
          ) : (
            <CeldaTexto color={colors.grisClaro}>{SIN_DATO}</CeldaTexto>
          ),
      },
      {
        clave: 'accion',
        titulo: '',
        ancho: 44,
        alinear: 'centro',
        /**
         * UN botón por fila, no dos: la excluida se vuelve a incluir y la que
         * cuenta se excluye (`accionDeLinea`). Es `BotonIcono` y no `BotonWeb`
         * porque acompaña a la fila y no merece su propio renglón -- y su
         * `etiqueta` es el tooltip del navegador y el nombre accesible, así que
         * el ícono no queda mudo.
         *
         * APAGADO, NO ESCONDIDO cuando el inventario ya se liquidó: el motivo
         * está dicho en la nota de arriba de la tabla (`TEXTO_LINEAS_BLOQUEADAS`).
         */
        celda: (l) => {
          const accion = accionDeLinea(l.excluida);
          return (
            <BotonIcono
              icono={accion === 'excluir' ? Ban : Undo2}
              etiqueta={
                puedeEditar
                  ? `${textosAccionLinea(accion).etiqueta} la línea ${l.fila}`
                  : `Línea ${l.fila}: ${TEXTO_LINEAS_BLOQUEADAS}`
              }
              onPress={() => {
                setErrorLinea(null);
                setDialogo({ linea: l, accion });
              }}
              deshabilitado={!puedeEditar || guardandoLineaId !== null}
              cargando={guardandoLineaId === l.id}
            />
          );
        },
      },
    ],
    [puedeEditar, guardandoLineaId],
  );

  /** Las columnas de la VISTA PREVIA. Otra tabla porque responde otra pregunta: qué va a entrar si confirmo. */
  const columnasPreview = useMemo<ColumnaTabla<FilaPreview>[]>(
    () => [
      { clave: 'fila', titulo: 'Fila', ancho: 56, alinear: 'derecha', celda: (f) => <CeldaTexto numero>{f.fila}</CeldaTexto> },
      {
        clave: 'codigo',
        titulo: 'Código',
        ancho: 96,
        celda: (f) => <CeldaTexto color={f.codigo === null ? colors.grisClaro : undefined}>{f.codigo ?? SIN_DATO}</CeldaTexto>,
      },
      {
        clave: 'nombre',
        titulo: 'Producto',
        celda: (f) => <CeldaTexto color={f.nombre === null ? colors.grisClaro : undefined}>{f.nombre ?? SIN_DATO}</CeldaTexto>,
      },
      {
        clave: 'importe',
        titulo: 'Importe',
        ancho: 110,
        alinear: 'derecha',
        // El guion y no un 0: de una rechazada no se sabe el importe, y un cero
        // afirmaría que la fila vale cero.
        celda: (f) =>
          f.importe === null ? (
            <CeldaTexto numero color={colors.grisClaro}>
              {SIN_DATO}
            </CeldaTexto>
          ) : (
            <CeldaTexto numero fuerte>
              {soles(f.importe)}
            </CeldaTexto>
          ),
      },
      {
        clave: 'estado',
        titulo: 'Estado',
        ancho: 130,
        celda: (f) => {
          const { texto, color } = TEXTO_ESTADO_PREVIEW[f.estado];
          return (
            <CeldaTexto fuerte={f.estado !== 'entra'} color={color}>
              {texto}
            </CeldaTexto>
          );
        },
      },
      {
        clave: 'detalle',
        titulo: 'Por qué',
        /**
         * DOS RENGLONES Y NO UNO. `CeldaTexto` corta en una línea, que para una
         * cifra es lo correcto y para este texto no: "La fecha de Registrado
         * en cae fuera del perí…" deja la fila sin la explicación que es la
         * única razón de que esté marcada.
         */
        celda: (f) =>
          f.detalle === null ? (
            <CeldaTexto color={colors.grisClaro}>{SIN_DATO}</CeldaTexto>
          ) : (
            <Text style={styles.celdaMotivo} numberOfLines={2}>
              {f.detalle}
            </Text>
          ),
      },
    ],
    [],
  );

  const filasPreview = useMemo(() => (preview?.ok === true ? filasDelPreview(preview) : []), [preview]);
  const resumen = preview?.ok === true ? resumenPreview(preview) : null;

  /**
   * Las tablas scrollean DENTRO de su marco y no estiran la página: un archivo
   * de negativos puede traer cientos de líneas, y una página así de larga deja
   * el botón de confirmar a media hora de scroll.
   *
   * Y no es solo comodidad: la paginación por scroll de `TablaWeb` cuelga del
   * scroll DE LA LISTA. Sin un alto que la haga scrollear por su cuenta, la
   * lista crece con su contenido, nunca dispara `onEndReached` y se queda
   * clavada en la primera tanda.
   */
  const altoTabla = Math.max(260, Math.round(height - 620));

  return (
    <>
      <ScrollView style={styles.pagina} contentContainerStyle={styles.contenido} showsVerticalScrollIndicator={false}>
        <EncabezadoPagina
          migas={['Liquidación', 'Ajustes del mes']}
          titulo="Ajustes del mes"
          sub="El Excel de negativos del período: suma a favor del personal y baja lo que se le descuenta. Se importa, no se escribe a mano."
          onInicio={() => router.push('/auditor')}
          acciones={
            <>
              {/*
                `router.replace`, NUNCA `router.back()`: esta pantalla y
                Liquidación son rutas de archivo dentro del MISMO <Tabs> plano
                de RolTabsLayout (ninguna de las dos está en
                TABS_POR_ROL.auditor), y un Tab Navigator no lleva una pila
                lineal como un Stack -- `back()` desde una pantalla que no es
                un tab declarado puede resolver a la pestaña INICIAL. Se vio en
                vivo en la prueba end-to-end de liquidación (2026-09-11):
                "Volver a Liquidación" saltaba a Inicio. `replace` a la ruta
                explícita es determinístico, y no necesita `inventarioId`:
                Liquidación lo vuelve a calcular de la sucursal compartida.
              */}
              <BotonWeb
                etiqueta="Volver a Liquidación"
                icono={ChevronLeft}
                onPress={() => router.replace('/auditor/liquidacion')}
              />
              {/* EN EL NAVEGADOR NO HAY "TIRAR PARA REFRESCAR": no hay gesto.
                  La pantalla se recarga sola al enfocarse, pero sin un control
                  a mano la única salida es F5, que recarga la app entera. */}
              <BotonIcono
                icono={RefreshCw}
                etiqueta={refrescando ? 'Actualizando…' : 'Actualizar'}
                onPress={refrescar}
                cargando={refrescando}
              />
            </>
          }
        />

        {/*
          EL RESULTADO DE LA ÚLTIMA ACCIÓN: lo que en el teléfono es un `Alert`.

          Va acá arriba y FUERA de las ramas de carga a propósito. Confirmar
          recarga el estado, y si esa recarga falla la página se va a la tarjeta
          de error -- con el aviso metido en la otra rama, el "importación
          confirmada" no aparecía en ninguna parte y la importación ya estaba
          escrita en la base. También queda por encima de las tablas, que se
          recargan y se reordenan debajo: al pie quedaría fuera de pantalla justo
          después de confirmar.
        */}
        {aviso !== null ? (
          <View style={[styles.bloque, styles.resultado, aviso.tono === 'ok' ? styles.resultadoOk : styles.resultadoError]}>
            {aviso.tono === 'ok' ? <Check size={16} color={colors.ok} /> : <TriangleAlert size={16} color={colors.falta} />}
            <Text style={styles.resultadoTexto}>{aviso.texto}</Text>
            <Pressable onPress={() => setAviso(null)} accessibilityLabel="Cerrar el aviso" style={styles.resultadoCerrar}>
              <X size={15} color={colors.gris} />
            </Pressable>
          </View>
        ) : null}

        {inventarioId === null ? (
          <View style={styles.bloque}>
            <TarjetaWeb titulo="Falta el inventario" icono={TriangleAlert} tono="neutro">
              <Text style={styles.parrafo}>
                Esta pantalla necesita abrirse desde Liquidación, con el inventario del ciclo cerrado de la sucursal
                elegida: es Liquidación la que sabe cuál es, y adivinarlo acá importaría el Excel contra el inventario
                equivocado.
              </Text>
              <BotonWeb
                etiqueta="Ir a Liquidación"
                variante="principal"
                onPress={() => router.replace('/auditor/liquidacion')}
              />
            </TarjetaWeb>
          </View>
        ) : cargando ? (
          <ActivityIndicator color={colors.rojo} style={styles.cargando} />
        ) : errorCarga !== null ? (
          <View style={styles.bloque}>
            <TarjetaWeb titulo="No se pudo cargar el estado de los ajustes" icono={TriangleAlert} tono="neutro">
              <Text style={styles.parrafo}>{errorCarga}</Text>
              {/* En el teléfono este reintento es el gesto de tirar para
                  refrescar, que en el navegador no existe. */}
              <BotonWeb etiqueta="Volver a intentar" variante="principal" onPress={refrescar} />
            </TarjetaWeb>
          </View>
        ) : (
          <>
            {/* EL ESTADO Y EL MONTO: son el contexto de todo lo de abajo. Sin
                esto, una tabla de importes no dice si ya cuenta o no. */}
            <View style={[styles.banda, angosto && styles.bandaApilada]}>
              <View style={styles.bandaBloque}>
                <ChipIcono icono={FileSpreadsheet} tono={estado.estado === 'sin-importar' ? 'marca' : 'ok'} />
                <View style={styles.bandaTextos}>
                  <Text style={styles.bandaEtiqueta}>Ajustes de este inventario</Text>
                  <Text style={styles.bandaTitulo}>{estado.estado === 'sin-importar' ? 'Sin importar' : 'Importado'}</Text>
                  {/* Los DOS textos de `estadoNegativos`: "todavía no se
                      importó" (bloquea liquidar) y "se importó y dio 0" (no
                      bloquea nada) nunca comparten cartel. */}
                  <Text style={styles.bandaSub}>{estado.texto}</Text>
                </View>
              </View>

              <View style={[styles.cartel, estado.estado === 'sin-importar' ? styles.cartelNeutro : styles.cartelOk]}>
                <Coins size={22} color={estado.estado === 'sin-importar' ? colors.gris : colors.ok} />
                <View style={styles.cartelTextos}>
                  <Text style={styles.cartelEtiqueta}>A favor del personal</Text>
                  {/* "—" y no 0 mientras no se importó: el 0 es un hecho
                      verificado (se importó y no había), y decirlo con el mismo
                      número sería mentir por omisión. */}
                  <Text style={styles.cartelMonto}>{estado.monto === null ? SIN_DATO : soles(estado.monto)}</Text>
                </View>
              </View>
            </View>

            {/* IMPORTAR o REEMPLAZAR: es la misma tarjeta con dos lecturas, y
                `vistaImportar` decide cuál -- con un Excel ya importado el
                botón no agrega líneas, reemplaza el archivo entero. */}
            <View style={styles.bloque}>
              <TarjetaWeb titulo={vista.titulo} icono={Upload} tono="marca">
                <Text style={styles.parrafo}>
                  El archivo tiene que traer exactamente estos encabezados: Diario, Descripcion, Almacen, Codigo,
                  Nombre2, Cantidad, Precio, Importe, Motivo de ajuste, Registrado en, Responsable. Columnas de más no
                  molestan.
                </Text>
                {vista.nota !== null ? <Text style={styles.notaReemplazo}>{vista.nota}</Text> : null}
                <View style={styles.botonAcotado}>
                  <BotonWeb
                    etiqueta={previsualizando ? 'Leyendo el archivo…' : vista.boton}
                    icono={Upload}
                    variante="principal"
                    onPress={() => void elegirArchivo()}
                    deshabilitado={previsualizando || confirmando}
                    cargando={previsualizando}
                    /* Sin chevron: esto abre el selector de archivos del
                       sistema, no lleva a otra pantalla. Con la flecha se leía
                       como un enlace y hacía dudar antes de tocarlo. */
                    sinChevron
                  />
                </View>
              </TarjetaWeb>
            </View>

            {/* EL ARCHIVO ENTERO NO SE PUDO LEER: no es que no haya líneas, es
                que no hay archivo. El detalle lo manda el backend tal cual --
                dice cuáles columnas faltan y la estructura completa esperada. */}
            {preview !== null && !preview.ok ? (
              <View style={styles.bloque}>
                <TarjetaWeb titulo={tituloPreviewFallido(preview.motivo)} icono={FileX2} tono="marca" style={styles.tarjetaBloqueante}>
                  <Text style={styles.parrafoFalta}>{preview.detalle}</Text>
                  <View style={styles.botonAcotado}>
                    <BotonWeb etiqueta="Elegir otro archivo" icono={Upload} onPress={() => void elegirArchivo()} />
                  </View>
                </TarjetaWeb>
              </View>
            ) : null}

            {/* LA VISTA PREVIA NO ESCRIBIÓ NADA, y está dicho: el monto de
                arriba sigue siendo el guardado hasta que se confirme. */}
            {resumen !== null ? (
              <>
                <View style={styles.bloque}>
                  <TarjetaWeb
                    titulo="Vista previa"
                    sub={archivo?.nombre ?? undefined}
                    icono={FileSpreadsheet}
                    tono="atencion"
                  >
                    <Text style={styles.parrafo}>
                      Todavía no se guardó nada: esto es lo que el lector encontró en el archivo. El monto de arriba
                      sigue siendo el que está vigente.
                    </Text>

                    <View style={styles.resumenFila}>
                      <ResumenDato etiqueta="Entran a la suma" valor={String(resumen.validas)} />
                      <ResumenDato
                        etiqueta="Con advertencia"
                        valor={String(resumen.conAdvertencia)}
                        color={resumen.conAdvertencia > 0 ? colors.proceso : undefined}
                      />
                      <ResumenDato
                        etiqueta="No entran"
                        valor={String(resumen.rechazadas)}
                        color={resumen.rechazadas > 0 ? colors.falta : undefined}
                      />
                      <ResumenDato etiqueta="Monto que resultaría" valor={soles(resumen.totalImporte)} />
                    </View>

                    {/* LA FRASE QUE SE FIRMA, junta: las cifras sueltas de
                        arriba no dicen qué va a pasar al apretar. */}
                    <Text style={styles.parrafoFuerte}>{textoQueSeConfirma(resumen, soles)}</Text>

                    {resumen.conAdvertencia > 0 ? (
                      <Text style={styles.parrafo}>
                        Las líneas con advertencia SUMAN igual: la decisión de sacarlas es tuya y se toma abajo, después
                        de confirmar. El lector no descarta nada por su cuenta.
                      </Text>
                    ) : null}

                    <View style={[styles.accionesFila, angosto && styles.accionesApiladas]}>
                      <View style={styles.accion}>
                        <BotonWeb etiqueta="Descartar y elegir otro" onPress={descartarPreview} deshabilitado={confirmando} />
                      </View>
                      <View style={styles.accion}>
                        <BotonWeb
                          etiqueta={confirmando ? 'Confirmando…' : 'Confirmar la importación'}
                          icono={Check}
                          variante="principal"
                          onPress={() => void confirmar()}
                          deshabilitado={confirmando}
                          cargando={confirmando}
                        />
                      </View>
                    </View>
                  </TarjetaWeb>
                </View>

                <View style={styles.bloque}>
                  <TablaWeb
                    titulo="Líneas del archivo"
                    sub="En el orden del Excel: la columna Fila es la fila de ese archivo."
                    icono={FileSpreadsheet}
                    tono="atencion"
                    columnas={columnasPreview}
                    filas={filasPreview}
                    claveDe={(f) => f.clave}
                    tinteDeFila={tinteDePreview}
                    alto={altoTabla}
                    pie={(mostradas, total) =>
                      `Mostrando ${mostradas} de ${total} ${total === 1 ? 'línea' : 'líneas'} leídas · ${resumen.validas} entran, ${resumen.rechazadas} no`
                    }
                    vacio={
                      <View style={styles.vacio}>
                        <Check size={22} color={colors.ok} />
                        <Text style={styles.vacioTitulo}>El archivo se leyó bien y no trae ninguna línea de esta tienda</Text>
                        <Text style={styles.parrafo}>
                          Se puede confirmar igual: deja registrado que este mes no hubo ajustes, y eso destraba la
                          liquidación. No es lo mismo que no haber importado nada.
                        </Text>
                      </View>
                    }
                  />
                </View>
              </>
            ) : null}

            {/* LAS LÍNEAS YA GUARDADAS. Se dibuja cuando hay una importación
                real, aunque tenga CERO líneas útiles: `listado.importacion !==
                null` es "alguien importó un archivo", y eso es un hecho
                distinto de "no se importó nada". */}
            {listado !== null && listado.importacion !== null ? (
              <View style={styles.bloque}>
                <TablaWeb
                  titulo="Líneas que están contando"
                  sub={`${listado.importacion.nombreArchivo} · importado por ${listado.importacion.importadoPor.nombre} el ${formatoFechaHora(listado.importacion.importadoEn)}`}
                  icono={FileSpreadsheet}
                  tono={puedeEditar ? 'marca' : 'neutro'}
                  columnas={columnasGuardadas}
                  filas={listado.lineas}
                  claveDe={(l) => String(l.id)}
                  // Solo las excluidas llevan tinte: son la excepción que hay
                  // que poder encontrar de un barrido, y las que cuentan son la
                  // norma.
                  tinteDeFila={(l) => (l.excluida ? 'falta' : null)}
                  alto={altoTabla}
                  pie={(mostradas, total) =>
                    `Mostrando ${mostradas} de ${total} ${total === 1 ? 'línea' : 'líneas'} · ${excluidas} ${excluidas === 1 ? 'excluida' : 'excluidas'} · suma ${estado.monto === null ? SIN_DATO : soles(estado.monto)}`
                  }
                  vacio={
                    <View style={styles.vacio}>
                      <Check size={22} color={colors.ok} />
                      <Text style={styles.vacioTitulo}>El archivo importado no traía ninguna línea útil</Text>
                      <Text style={styles.parrafo}>
                        Es una importación real con monto 0, no un mes sin importar: la liquidación está destrabada.
                      </Text>
                    </View>
                  }
                  herramientas={
                    !puedeEditar ? (
                      // APAGADO Y DICHO: los botones de la última columna
                      // quedan grises, y acá está el por qué. Un botón que no
                      // responde sin explicación es una pantalla rota.
                      <View style={styles.notaBloqueo}>
                        <TriangleAlert size={14} color={colors.gris} />
                        <Text style={styles.notaBloqueoTexto}>{TEXTO_LINEAS_BLOQUEADAS}</Text>
                      </View>
                    ) : undefined
                  }
                />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Hermano del scroll, nunca adentro: ahí el overlay queda recortado y se
          desplaza con el contenido. El `key` hace que cada línea estrene su
          propio motivo -- sin eso, el texto de la anterior aparecía escrito en
          la siguiente. */}
      {dialogo !== null ? (
        <DialogoMotivoLinea
          key={`${dialogo.linea.id}-${dialogo.accion}`}
          linea={dialogo.linea}
          accion={dialogo.accion}
          guardando={guardandoLineaId !== null}
          error={errorLinea}
          onCancelar={() => {
            setDialogo(null);
            setErrorLinea(null);
          }}
          onConfirmar={(motivo) => void guardarMotivo(motivo)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

/** Una cifra del resumen de la vista previa, con su rótulo arriba. */
function ResumenDato({ etiqueta, valor, color }: { etiqueta: string; valor: string; color?: string }): JSX.Element {
  return (
    <View style={styles.resumenDato}>
      <Text style={styles.resumenEtiqueta}>{etiqueta}</Text>
      <Text style={[styles.resumenValor, color !== undefined ? { color } : null]}>{valor}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------

/**
 * EL DIÁLOGO DEL MOTIVO, que en el teléfono es un `Modal` con el botón apagado
 * y nada más.
 *
 * LO QUE ACÁ CAMBIA, y es el arreglo: cuando falta el motivo se DICE qué falta.
 * En el teléfono el botón simplemente no responde -- y en un navegador un botón
 * gris sin explicación se lee como una pantalla rota, no como un campo
 * incompleto. El texto sale de `errorDeMotivoLinea`, la misma regla que valida
 * el servidor (`liquidacion.schema.ts`: `.trim().min(1).max(500)`), y va debajo
 * del botón con el `motivo` de `BotonWeb`.
 *
 * NO se usa `window.confirm` ni `window.prompt`: no se les puede dar el rótulo,
 * ni el largo, ni distinguir cuál botón es el que guarda.
 */
function DialogoMotivoLinea({
  linea,
  accion,
  guardando,
  error: errorGuardado,
  onCancelar,
  onConfirmar,
}: {
  linea: LineaAjusteNegativoGuardada;
  accion: AccionLinea;
  guardando: boolean;
  /** Lo que contestó el servidor si el guardado falló. Se muestra ACÁ: la página está tapada por el overlay. */
  error: string | null;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
}): JSX.Element {
  const [motivo, setMotivo] = useState('');
  const textos = textosAccionLinea(accion);
  const error = errorDeMotivoLinea(accion, motivo);

  return (
    <View style={styles.modalRaiz} pointerEvents="box-none">
      <Pressable style={styles.modalFondo} onPress={onCancelar} accessibilityLabel="Cerrar" />
      <View pointerEvents="box-none" style={styles.modalCentrado}>
        <View style={[styles.dialogoCaja, shadow.modal]}>
          <View style={styles.dialogoCabecera}>
            <ChipIcono icono={accion === 'excluir' ? Ban : Undo2} tono={accion === 'excluir' ? 'marca' : 'ok'} />
            <View style={styles.dialogoTextos}>
              <Text style={styles.dialogoTitulo}>{textos.titulo}</Text>
              <Text style={styles.dialogoMeta}>
                Fila {linea.fila} · {linea.codigo} · {soles(linea.importe)}
              </Text>
            </View>
            <Pressable onPress={onCancelar} style={styles.dialogoCerrar} accessibilityLabel="Cerrar">
              <X size={18} color={colors.gris} />
            </Pressable>
          </View>

          <Text style={styles.dialogoProducto}>{linea.descripcion}</Text>

          {/* QUÉ le pasa a la plata con esto. Excluir baja el monto a favor del
              personal, así que sube lo que se le descuenta -- y al revés. Dicho
              antes de firmar, no después. */}
          <Text style={styles.parrafo}>
            {accion === 'excluir'
              ? 'Esta línea deja de sumar a favor del personal, así que lo que se le descuenta sube en ese importe. El monto de ajustes se recalcula al guardar.'
              : 'Esta línea vuelve a sumar a favor del personal, así que lo que se le descuenta baja en ese importe. El monto de ajustes se recalcula al guardar.'}
          </Text>

          <View style={styles.dialogoCampo}>
            <Text style={styles.dialogoEtiqueta}>Motivo (obligatorio)</Text>
            <TextInput
              style={[styles.dialogoInput, motivo.length > 0 && error !== null ? styles.dialogoInputError : null]}
              multiline
              numberOfLines={2}
              value={motivo}
              placeholder={textos.placeholder}
              placeholderTextColor={colors.grisClaro}
              onChangeText={setMotivo}
              accessibilityLabel="Motivo del cambio"
              autoFocus
            />
            {/* El error EN ROJO solo cuando ya escribió algo que no sirve (se
                pasó del largo). El "falta el motivo" del campo vacío va debajo
                del botón, en gris: todavía no se equivocó, le falta escribir. */}
            {motivo.length > 0 && error !== null ? <Text style={styles.dialogoError}>{error}</Text> : null}
          </View>

          {/* NO se cerró el diálogo: el motivo escrito sigue ahí y el
              reintento es apretar de nuevo. */}
          {errorGuardado !== null ? (
            <View style={[styles.resultado, styles.resultadoError]}>
              <TriangleAlert size={16} color={colors.falta} />
              <Text style={styles.resultadoTexto}>{errorGuardado}</Text>
            </View>
          ) : null}

          <View style={styles.dialogoBotones}>
            <View style={styles.accion}>
              <BotonWeb etiqueta="Cancelar" onPress={onCancelar} deshabilitado={guardando} />
            </View>
            <View style={styles.accion}>
              <BotonWeb
                etiqueta={guardando ? 'Guardando…' : textos.etiqueta}
                icono={accion === 'excluir' ? Ban : Undo2}
                variante="principal"
                onPress={() => onConfirmar(motivo.trim())}
                deshabilitado={error !== null || guardando}
                cargando={guardando}
                // QUÉ falta, no "no se puede". Esto es lo que el teléfono no dice.
                {...(error !== null ? { motivo: error } : {})}
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pagina: { flex: 1 },
  contenido: { padding: spacing.xxl, gap: spacing.lg },
  cargando: { marginTop: spacing.xxl },

  /**
   * EL ANCHO VA ACÁ, en la View que envuelve, y nunca en `TarjetaWeb` ni en
   * `TablaWeb`: la tarjeta trae `flex: 1` y se come cualquier ancho que se le
   * pase. `maxWidth: '100%'` para que en una ventana angosta el bloque se
   * encoja en vez de desbordar.
   */
  bloque: { width: TOPE_ANCHO, maxWidth: '100%' },

  banda: {
    width: TOPE_ANCHO,
    maxWidth: '100%',
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
  bandaBloque: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bandaTextos: { flex: 1, gap: 2 },
  bandaEtiqueta: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },
  bandaTitulo: { fontSize: fontSize.lg, color: colors.tinta, fontFamily: fonts.bold },
  bandaSub: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular, lineHeight: 18 },

  /** El monto en su propio cartel: es LA cifra de la pantalla, y en el renglón de al lado se perdía. */
  cartel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.md,
    minWidth: 260,
    // `flexShrink: 0` además del ancho mínimo: en la web el default de
    // `flexShrink` es 1 -- en React Native es 0 -- y sin esto el cartel se
    // comprimía hasta que el monto salía cortado.
    flexShrink: 0,
  },
  cartelOk: { backgroundColor: colors.okSuave },
  cartelNeutro: { backgroundColor: colors.esperaSuave },
  cartelTextos: { gap: 1 },
  cartelEtiqueta: {
    fontSize: fontSize.xs,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.gris,
    fontFamily: fonts.bold,
  },
  cartelMonto: { fontSize: fontSize.xl, color: colors.tinta, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },

  parrafo: { fontSize: fontSize.sm, lineHeight: 20, color: colors.gris, fontFamily: fonts.regular },
  parrafoFuerte: { fontSize: fontSize.base, lineHeight: 22, color: colors.tinta, fontFamily: fonts.semibold },
  parrafoFalta: { fontSize: fontSize.sm, lineHeight: 20, color: colors.falta, fontFamily: fonts.regular },

  /** La nota de que reimportar reemplaza: va tintada porque cambia lo que el botón de abajo significa. */
  notaReemplazo: {
    fontSize: fontSize.sm,
    lineHeight: 19,
    color: colors.tinta,
    fontFamily: fonts.regular,
    backgroundColor: colors.procesoSuave,
    borderRadius: radius.md,
    padding: spacing.md,
  },

  /** El borde rojo SOLO cuando el archivo no se pudo leer: una tarjeta que grita siempre deja de significar nada. */
  tarjetaBloqueante: { borderColor: colors.falta },

  /** Ancho acotado: un botón estirado a media fila se lee como la acción de la página, y no siempre lo es. */
  botonAcotado: { maxWidth: 320, marginTop: spacing.xs },

  resumenFila: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xxl, marginTop: spacing.xs },
  resumenDato: { minWidth: 130 },
  resumenEtiqueta: { fontSize: fontSize.xs, color: colors.gris, fontFamily: fonts.semibold },
  resumenValor: {
    marginTop: 2,
    fontSize: fontSize.xl,
    color: colors.tinta,
    fontFamily: fonts.bold,
    fontVariant: ['tabular-nums'],
  },

  accionesFila: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  accionesApiladas: { flexDirection: 'column' },
  accion: { flex: 1 },

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

  /**
   * El texto de una celda que lleva PROSA y no una cifra: dos renglones, con el
   * interlineado ajustado para que la fila no crezca de más. Mismos tokens que
   * `CeldaTexto`, que corta en una línea y para esto no sirve.
   */
  celdaMotivo: { fontSize: 13, lineHeight: 16, color: colors.tinta, fontFamily: fonts.regular },
  celdaMotivoQuien: { color: colors.gris },

  /** La nota de "ya se liquidó", en la barra de herramientas de la tabla. */
  notaBloqueo: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 6, maxWidth: 420 },
  notaBloqueoTexto: { flex: 1, fontSize: fontSize.xs, lineHeight: 16, color: colors.gris, fontFamily: fonts.regular },

  vacio: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl, maxWidth: 520 },
  vacioTitulo: { fontSize: fontSize.lg, color: colors.tinta, fontFamily: fonts.bold, textAlign: 'center' },

  modalRaiz: { ...StyleSheet.absoluteFillObject, zIndex: 50 },
  modalFondo: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  modalCentrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  dialogoCaja: {
    width: '100%',
    maxWidth: 460,
    gap: spacing.sm,
    padding: spacing.xl,
    backgroundColor: colors.blanco,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borde,
  },
  dialogoCabecera: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dialogoTextos: { flex: 1, gap: 1 },
  dialogoTitulo: { fontSize: fontSize.lg, color: colors.tinta, fontFamily: fonts.bold },
  dialogoMeta: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular, fontVariant: ['tabular-nums'] },
  dialogoCerrar: { padding: 4 },
  dialogoProducto: { fontSize: fontSize.base, color: colors.tinta, fontFamily: fonts.bold, lineHeight: 21 },

  dialogoCampo: { marginTop: spacing.sm },
  dialogoEtiqueta: { marginBottom: 6, fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.semibold },
  dialogoInput: {
    minHeight: 68,
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
    fontSize: fontSize.base,
    color: colors.tinta,
    fontFamily: fonts.regular,
    backgroundColor: colors.blanco,
    textAlignVertical: 'top',
  },
  dialogoInputError: { borderColor: colors.falta },
  dialogoError: { marginTop: 4, fontSize: fontSize.sm, color: colors.falta, fontFamily: fonts.medium },
  dialogoBotones: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
});
