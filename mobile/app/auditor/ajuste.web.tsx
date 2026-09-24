import { router } from 'expo-router';
import { Check, Lock, RefreshCw, Scale, Store, TriangleAlert, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
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

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { ChipsFiltro, SelectorSucursal, formatoMiles } from '../../components/ui';
import { interpretarCantidad } from '../../components/ui/cantidad-numerica';
import {
  BadgeEstado,
  BotonWeb,
  CeldaTexto,
  ChipIcono,
  EncabezadoPagina,
  TablaWeb,
  TarjetaWeb,
  type ColumnaTabla,
  type TinteFila,
} from '../../components/web';
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
 * abajo buscando dónde se rompe, y eso es una tabla.
 *
 * La tabla NO se dibuja acá: es `components/web/TablaWeb.tsx`, la única de la
 * web. Decisión del usuario -- *"todas las tablas de la web tienen que tener
 * este diseño"*. Esta pantalla solo declara SUS columnas, cuándo va tinte y
 * qué pasa al abrir una fila; el encabezado, la cabecera, la paginación por
 * scroll y el pie los pone el componente.
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

/** Sin dato es "—", nunca un 0: un cero es una afirmación, el guion es "no sé". */
const SIN_DATO = '—';

/** Una cifra de la tabla, o el guion gris cuando no hay dato. */
function celdaNumero(valor: number | null | undefined): JSX.Element {
  return valor === null || valor === undefined ? (
    <CeldaTexto numero color={colors.grisClaro}>
      {SIN_DATO}
    </CeldaTexto>
  ) : (
    <CeldaTexto numero>{formatoMiles(valor)}</CeldaTexto>
  );
}

/**
 * LA DIFERENCIA, CON SIGNO Y COLOR -- la misma regla que la matriz. `null` =
 * no se puede afirmar nada (sin stock del ERP o sin ningún conteo), y ahí va
 * el guion gris: un 0 diría "conté exactamente lo que decía el ERP", que es
 * justo lo contrario.
 *
 * El 0 real (cuadró) va en tinta, sin color: el color está reservado para lo
 * que hay que mirar, y la enorme mayoría de los ítems cuadran.
 */
function celdaDiferencia(item: ItemAuditoria): JSX.Element {
  const dif = diferenciaUnidades(item);
  if (dif === null)
    return (
      <CeldaTexto numero color={colors.grisClaro}>
        {SIN_DATO}
      </CeldaTexto>
    );
  if (dif === 0) return <CeldaTexto numero>0</CeldaTexto>;
  return (
    <CeldaTexto numero fuerte color={dif < 0 ? colors.falta : colors.ok}>
      {`${dif < 0 ? '-' : '+'}${formatoMiles(Math.abs(dif))}`}
    </CeldaTexto>
  );
}

/**
 * EL TINTE DE LA FILA. Solo para lo que tiene diferencia: si se pintan todas,
 * el color deja de señalar nada y las que importan se pierden entre las demás.
 * Rojo para el faltante, verde para el sobrante -- la misma lectura que la
 * columna de diferencia, dos veces.
 */
function tinteDeItem(item: ItemAuditoria): TinteFila {
  const dif = diferenciaUnidades(item);
  if (dif === null || dif === 0) return null;
  return dif < 0 ? 'falta' : 'ok';
}

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

  /**
   * LAS COLUMNAS. "Descripción" va SIN `ancho` a propósito: es la única que
   * puede usar el espacio sobrante -- el resto son cifras cortas y estirarlas
   * solo aleja el número de su encabezado.
   */
  const columnas = useMemo<ColumnaTabla<ItemAuditoria>[]>(
    () => [
      { clave: 'codigo', titulo: 'Código', ancho: 92, celda: (it) => <CeldaTexto>{it.codigo}</CeldaTexto> },
      { clave: 'descripcion', titulo: 'Descripción', celda: (it) => <CeldaTexto>{it.descripcion}</CeldaTexto> },
      // "ERP" y no "Stock": es el nombre con el que el Auditor lo pide.
      { clave: 'erp', titulo: 'ERP', ancho: 78, alinear: 'derecha', celda: (it) => celdaNumero(it.stockErp) },
      // UNA COLUMNA POR RONDA, no tres fijas: el Auditor abre un 4to o un 5to
      // conteo cuando no le cierra, y ese último es justo el que fijó el
      // número. `ordinal` es la MISMA función que nombra las rondas en el
      // Ciclo y en la matriz.
      ...Array.from({ length: rondas }, (_, indice) => ({
        clave: `ronda-${indice}`,
        titulo: ordinal(indice + 1),
        ancho: 70,
        alinear: 'derecha' as const,
        celda: (it: ItemAuditoria) => celdaNumero(it.conteos[indice]),
      })),
      { clave: 'diferencia', titulo: 'Diferencia', ancho: 96, alinear: 'derecha', celda: celdaDiferencia },
      { clave: 'estado', titulo: 'Estado', ancho: 150, celda: (it) => <BadgeEstado veredicto={veredicto(it)} /> },
    ],
    [rondas],
  );

  /**
   * La tabla scrollea DENTRO de su marco y no estira la página: con "Todos"
   * son hasta 8.000 ítems, y una página así de larga deja el botón de cerrar
   * el ajuste a media hora de scroll. El alto sale de la ventana para que en
   * un monitor grande se vean más filas sin tocar nada.
   *
   * Y no es solo comodidad: la paginación por scroll de `TablaWeb` cuelga del
   * scroll DE LA LISTA. Sin un alto que la haga scrollear por su cuenta, la
   * lista crecería con su contenido, nunca dispararía `onEndReached` y se
   * quedaría clavada en la primera tanda.
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

            <TablaWeb
              titulo="Ítems del inventario"
              sub="Cada fila abre el ajuste de ese ítem."
              icono={Scale}
              tono="atencion"
              columnas={columnas}
              filas={visibles}
              claveDe={(it) => String(it.productoId)}
              onAbrirFila={setEnEdicion}
              tinteDeFila={tinteDeItem}
              alto={altoTabla}
              // El filtro entra en la barra de herramientas del encabezado, a
              // la derecha del título: es una herramienta de ESTA tabla, y
              // suelto arriba quedaba flotando sin dueño.
              herramientas={
                <View style={styles.herramienta}>
                  <ChipsFiltro
                    opciones={[
                      { id: 'sin-cuadrar', etiqueta: 'Sin cuadrar', contador: sinCuadrar.length },
                      { id: 'todos', etiqueta: 'Todos', contador: items.length },
                    ]}
                    activo={filtro}
                    onCambiar={(id) => setFiltro(id as Filtro)}
                  />
                </View>
              }
              /*
                EL PIE DICE LAS TRES CIFRAS, no dos. Con la paginación por
                scroll hay una más que antes: lo dibujado, lo que pasó el
                filtro, y el total del inventario. Decir "60 de 985" a secas
                sobre un filtro activo sería llamar "total" a lo filtrado --
                el mismo error que la matriz ya tiene documentado en su pie.
              */
              pie={(mostradas, total) =>
                total === items.length
                  ? `Mostrando ${formatoMiles(mostradas)} de ${formatoMiles(total)} ítems`
                  : `Mostrando ${formatoMiles(mostradas)} de ${formatoMiles(total)} sin cuadrar · ${formatoMiles(items.length)} ítems en el inventario`
              }
              vacio={
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
              }
            />

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

  /**
   * El envoltorio del filtro dentro de la barra de herramientas. Existe porque
   * `ChipsFiltro` es un `ScrollView` horizontal y en react-native-web esos
   * traen `flexGrow: 1`: suelto ahí se estiraba hasta el borde y los chips
   * quedaban pegados a la izquierda en vez de a la derecha. Este `View` sin
   * flex lo mide por su contenido, y el `flexShrink` deja que se encoja (y
   * scrollee) si el encabezado queda angosto.
   */
  herramienta: { flexShrink: 1 },

  vacio: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  vacioTitulo: { fontSize: fontSize.lg, color: colors.tinta, fontFamily: fonts.bold, textAlign: 'center' },

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
