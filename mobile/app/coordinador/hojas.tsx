import { router, useFocusEffect } from 'expo-router';
import { Check, CloudDownload, LayoutGrid, Users } from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { AvanceFila, BarraApp, Badge, Button, formatoFechaHora, formatoMiles, type BadgeVariant } from '../../components/ui';
import { inventarioIdSinRed } from '../../lib/adaptadores/hojas-sqlite';
import { repositorioHojas, repositorioInventario, repositorioSesion } from '../../lib/contenedor';
import { avanceParaMostrar } from '../../lib/dominio/avance-snapshot';
import { partirEnHojas } from '../../lib/dominio/lote';
import { TAMANOS_HOJA, type Colaborador, type HojaConteo, type TamanoHoja } from '../../lib/dominio/tipos';
import { ErrorSnapshot, type AvanceSnapshot, type DesgloseSnapshot, type TipoInventario } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';


/**
 * Los dos universos, con la explicación que ve el Coordinador. El orden
 * importa: mensual primero porque es el default y el que se hace todos los
 * meses; el anual es la excepción de fin de año.
 */
const TIPOS_INVENTARIO: { id: TipoInventario; etiqueta: string; explicacion: string }[] = [
  {
    id: 'mensual',
    etiqueta: 'Mensual',
    explicacion: 'Cuenta solo los productos que son responsabilidad del personal. Es el de todos los meses.',
  },
  {
    id: 'anual',
    etiqueta: 'Anual',
    explicacion: 'Cuenta todo el catálogo, incluido lo que asume la empresa. Son bastantes más ítems y lleva más tiempo.',
  },
];

type EstadoPaso = 'bloqueado' | 'pendiente' | 'hecho';

const BADGE_VARIANTE: Record<EstadoPaso, BadgeVariant> = {
  bloqueado: 'default',
  pendiente: 'default',
  hecho: 'ok',
};
const BADGE_TEXTO: Record<EstadoPaso, string> = {
  bloqueado: 'Bloqueado',
  pendiente: 'Pendiente',
  hecho: 'Hecho',
};

interface PasoTarjetaProps {
  numero: number;
  icon: typeof CloudDownload;
  titulo: string;
  estado: EstadoPaso;
  texto: string;
  children?: ReactNode;
}

function PasoTarjeta({ numero, icon: Icon, titulo, estado, texto, children }: PasoTarjetaProps): JSX.Element {
  return (
    <View style={[styles.tarjeta, estado === 'bloqueado' && styles.tarjetaBloqueada]}>
      <View style={styles.tarjetaCabecera}>
        <View style={[styles.pasoMarca, estado === 'hecho' && styles.pasoMarcaHecho]}>
          {estado === 'hecho' ? <Check size={13} color={colors.blanco} /> : <Text style={styles.pasoMarcaTexto}>{numero}</Text>}
        </View>
        <Icon size={18} color={colors.rojo} />
        <Text style={styles.tarjetaTitulo}>{titulo}</Text>
        <Badge label={BADGE_TEXTO[estado]} variant={BADGE_VARIANTE[estado]} />
      </View>
      <Text style={styles.tarjetaTexto}>{texto}</Text>
      {children}
    </View>
  );
}

interface SelectorTamanoProps {
  valor: TamanoHoja | null;
  onElegir: (tamano: TamanoHoja) => void;
  disabled: boolean;
}

/** `.segmentado`/`.segmento` del design system: a diferencia del rol
 * (dato derivado, se muestra), acá el Coordinador SÍ elige — por eso son
 * Pressable reales, no View. */
function SelectorTamano({ valor, onElegir, disabled }: SelectorTamanoProps): JSX.Element {
  return (
    <View style={[styles.segmentado, disabled && styles.segmentadoDeshabilitado]}>
      {TAMANOS_HOJA.map((tamano, i) => {
        const activo = valor === tamano;
        return (
          <Pressable
            key={tamano}
            onPress={() => onElegir(tamano)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: activo, disabled }}
            style={[styles.segmento, i < TAMANOS_HOJA.length - 1 && styles.segmentoConBorde, activo && styles.segmentoActivo]}
          >
            <Text style={[styles.segmentoTexto, activo && styles.segmentoTextoActivo]}>{tamano}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface SelectorTipoProps {
  valor: TipoInventario;
  onElegir: (tipo: TipoInventario) => void;
  disabled: boolean;
}

/**
 * Qué universo se cuenta. Es `.segmentado` y no `.roles` porque acá SÍ hay
 * una elección real — y de las más caras del sistema: el mensual mide ~6.300
 * ítems y el anual ~11.800. Que alguien cuente el anual creyendo que cuenta
 * el mensual es una jornada de once personas perdida.
 *
 * Se elige ANTES de traer el catálogo, no después: el tipo define qué se
 * trae, no cómo se muestra.
 */
function SelectorTipo({ valor, onElegir, disabled }: SelectorTipoProps): JSX.Element {
  return (
    <View style={styles.campoTipo}>
      <Text style={styles.etiquetaTipo}>Tipo de inventario</Text>
      <View style={[styles.segmentado, disabled && styles.segmentadoDeshabilitado]}>
        {TIPOS_INVENTARIO.map((tipo, i) => {
          const activo = valor === tipo.id;
          return (
            <Pressable
              key={tipo.id}
              onPress={() => onElegir(tipo.id)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: activo, disabled }}
              style={[styles.segmento, i < TIPOS_INVENTARIO.length - 1 && styles.segmentoConBorde, activo && styles.segmentoActivo]}
            >
              <Text style={[styles.segmentoTexto, activo && styles.segmentoTextoActivo]}>{tipo.etiqueta}</Text>
            </Pressable>
          );
        })}
      </View>
      {/* La diferencia, en una línea y sin tecnicismos: es lo único que
          separa contar 6.300 ítems de contar 11.800. */}
      <Text style={styles.ayudaTipo}>{TIPOS_INVENTARIO.find((t) => t.id === valor)?.explicacion}</Text>
    </View>
  );
}

interface ResumenSnapshotProps {
  items: number | null;
  desglose: DesgloseSnapshot | null;
  tipo: TipoInventario;
}

/**
 * De dónde salió el número. Es lo que el Coordinador va a mirar el día que
 * alguien pregunte "¿por qué esta hoja no tiene tal producto?".
 *
 * Si el servidor no informó el desglose, se muestra solo el total y una
 * línea que dice qué criterio se aplicó — nunca ceros inventados: "0 sin
 * stock" y "no sé cuántos quedaron sin stock" son afirmaciones distintas, y
 * en un inventario esa diferencia se paga.
 */
function ResumenSnapshot({ items, desglose, tipo }: ResumenSnapshotProps): JSX.Element | null {
  if (items === null) return null;

  const fuera: { etiqueta: string; valor: number }[] = [];
  if (desglose?.sinStock !== undefined) fuera.push({ etiqueta: 'sin stock en el almacén', valor: desglose.sinStock });
  if (desglose?.noActivos !== undefined) fuera.push({ etiqueta: 'no activos en Dynamics', valor: desglose.noActivos });
  if (desglose?.deEmpresa !== undefined) fuera.push({ etiqueta: 'a cargo de la empresa', valor: desglose.deEmpresa });
  if (desglose?.sinResponsable !== undefined) fuera.push({ etiqueta: 'sin responsable asignado', valor: desglose.sinResponsable });

  return (
    <View style={styles.resumenSnapshot}>
      <View style={styles.resumenFila}>
        <Text style={styles.resumenEtiqueta}>Entraron al inventario</Text>
        <Text style={styles.resumenValor}>{formatoMiles(items)} ítems</Text>
      </View>

      {fuera.length > 0 ? (
        <>
          <Text style={styles.resumenSubtitulo}>Quedaron afuera</Text>
          {fuera.map((f) => (
            <View key={f.etiqueta} style={styles.resumenFila}>
              <Text style={styles.resumenEtiqueta}>{f.etiqueta}</Text>
              <Text style={styles.resumenValorTenue}>{formatoMiles(f.valor)}</Text>
            </View>
          ))}
        </>
      ) : (
        <Text style={styles.resumenNota}>
          {tipo === 'mensual'
            ? 'Se contaron los productos activos, con stock en el almacén de la sucursal y que son responsabilidad del personal. El resto quedó afuera.'
            : 'Se contó todo el catálogo activo con stock en el almacén de la sucursal, incluido lo que asume la empresa.'}
        </Text>
      )}
    </View>
  );
}

/**
 * Panel del Coordinador — 3 pasos en orden, cada uno bloqueado hasta que
 * el anterior termina (mobile/design/hojas.html, ya validada). Un solo
 * CTA al pie cuya acción cambia según el paso activo, igual que en la
 * maqueta: nunca dos botones habilitados a la vez.
 *
 * NO se portó la 4ta opción "Otro" (tamaño personalizado) de la maqueta:
 * `RepositorioInventario.crearHojas` está tipado a `TamanoHoja` (20|30|50),
 * no a un entero arbitrario. Ampliar el puerto para aceptarlo queda para
 * cuando se pida esa tarea — acá solo se ofrecen los 3 tamaños que el
 * puerto ya soporta.
 */
export default function HojasScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();

  const [cargandoInicial, setCargandoInicial] = useState(true);
  const [errorInicial, setErrorInicial] = useState<string | null>(null);
  const [inventarioId, setInventarioId] = useState<number | null>(null);
  const [items, setItems] = useState<number | null>(null);
  const [tomadoEn, setTomadoEn] = useState<string | null>(null);
  const [hojas, setHojas] = useState<HojaConteo[]>([]);
  const [tamanoCreado, setTamanoCreado] = useState<TamanoHoja | null>(null);
  const [contadores, setContadores] = useState<Colaborador[]>([]);

  const [tipoElegido, setTipoElegido] = useState<TipoInventario>('mensual');
  const [desglose, setDesglose] = useState<DesgloseSnapshot | null>(null);
  const [tamanoElegido, setTamanoElegido] = useState<TamanoHoja | null>(null);
  const [trayendoSnapshot, setTrayendoSnapshot] = useState(false);
  const [avanceSnapshot, setAvanceSnapshot] = useState<AvanceSnapshot | null>(null);
  const [creandoHojas, setCreandoHojas] = useState(false);
  const [asignando, setAsignando] = useState(false);

  // AbortController, no un booleano "cancelado": es lo mismo que va a usar
  // el adaptador HTTP real para cortar un fetch de OData en vuelo — el
  // puerto (RepositorioInventario.traerSnapshot) toma el mismo `signal`.
  const controladorSnapshotRef = useRef<AbortController | null>(null);

  const cargar = useCallback(async () => {
    if (!sesion) return;
    setErrorInicial(null);
    // El snapshot (items/tomadoEn/rondaActiva) SOLO lo tiene el servidor —
    // sin red, se cae al inventario que ya se descargó localmente (mismo
    // patrón que f558689 en Inicio/Mis hojas): sin eso, el Coordinador
    // quedaba con un spinner infinito por no poder ni siquiera VER las
    // hojas que ya existen, aunque estén completas en SQLite.
    let inventarioActivo: number | null;
    let itemsSnapshot: number | null = null;
    let tomadoEnSnapshot: string | null = null;
    let tamanoSnapshot: TamanoHoja | null = null;
    let rondaActiva = 1;
    // Distingue "el servidor contestó y no hay inventario todavía" (estado
    // normal: hay que tomar el snapshot en el paso 1) de "no se pudo ni
    // preguntar" (sin red) — confundirlas mostraría "no se pudo conectar"
    // en el arranque normal de un inventario nuevo.
    let activoFallo = false;
    try {
      const activo = await repositorioInventario.activo(sesion.sucursal!.id);
      inventarioActivo = activo?.inventarioId ?? null;
      itemsSnapshot = activo?.items ?? null;
      tomadoEnSnapshot = activo?.tomadoEn ?? null;
      tamanoSnapshot = activo?.tamanoHoja ?? null;
      rondaActiva = activo?.rondaActiva ?? 1;
    } catch {
      activoFallo = true;
      inventarioActivo = await inventarioIdSinRed();
    }

    // El padrón de colaboradores no tiene fallback local ni bloquea ver las
    // hojas ya creadas: si falla, se sigue con la lista vacía (el paso 3 de
    // "asignar" simplemente no tendrá a quién repartir hasta que vuelva la red).
    let colaboradores: Colaborador[] = [];
    try {
      colaboradores = await repositorioSesion.colaboradores(sesion.sucursal!.id);
    } catch {
      // silencioso a propósito, ver el comentario de arriba.
    }
    setContadores(colaboradores.filter((c) => c.rol === 'conteo'));

    if (inventarioActivo) {
      setInventarioId(inventarioActivo);
      setItems(itemsSnapshot);
      setTomadoEn(tomadoEnSnapshot);
      setTamanoCreado(tamanoSnapshot);
      try {
        // Las hojas de la ronda activa (`?? 1`: si todavía no hay hojas,
        // rondaActiva es null y no hay ninguna que traer de ninguna ronda —
        // el 1 es inocuo). El paso 3 (asignar) también reparte las hojas
        // nuevas de un reconteo, que nacen sin asignar. `repositorioHojas`
        // ya cae solo a SQLite sin red (hojas-sqlite.ts), así que esto no
        // necesita su propio fallback — solo no dejar que un error acá
        // tire abajo el `setCargandoInicial(false)` de más abajo.
        const todas = await repositorioHojas.todas(inventarioActivo, rondaActiva);
        setHojas(todas);
      } catch (e) {
        setErrorInicial(e instanceof Error ? e.message : 'No se pudieron cargar las hojas.');
      }
    } else if (activoFallo) {
      // Sin red Y sin nada descargado localmente: ahí sí es un fallo real
      // que hay que decir, no el "todavía no hay inventario" normal del
      // arranque de un ciclo.
      setErrorInicial('No se pudo conectar con el servidor ni encontrar un inventario descargado localmente.');
    }
    setCargandoInicial(false);
  }, [sesion]);

  // useFocusEffect, no useEffect: volver a esta pantalla (por ejemplo tras
  // recuperar la señal) tiene que reintentar sola, igual que el resto de
  // las pantallas de acceso ya arregladas.
  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar]),
  );

  /**
   * ¿Sabemos que esta sucursal NO tiene almacén de Dynamics asociado?
   *
   * `null` es el backend diciendo explícitamente "no tiene". `undefined` es
   * "el dato no vino" — y esa diferencia decide si se bloquea o no: hoy
   * `POST /api/sesion/ingresar` todavía NO manda el almacén en
   * `sesion.sucursal`, así que casi siempre llega `undefined`. Bloquear por
   * `undefined` dejaría muertas también las sucursales que SÍ tienen
   * almacén, que es peor que el problema que se quiere evitar.
   *
   * Así, cuando el login empiece a mandar el campo, el bloqueo empieza a
   * funcionar solo. Y mientras tanto la red de seguridad es el código de
   * error `sin-almacen`, que llega igual — solo que después de intentar.
   */
  const sinAlmacen = sesion?.sucursal?.almacenId === null;

  const paso1Hecho = inventarioId !== null;
  const paso2Hecho = hojas.length > 0;
  const paso3Hecho = paso2Hecho && hojas.every((h) => h.asignados.length > 0);

  // Resultado ANTES de crear: el Coordinador tiene que ver cuántas hojas
  // va a generar antes de generarlas. partirEnHojas() es el mismo cálculo
  // que usa el puerto — nunca se duplica ni se hardcodea acá.
  const previa = useMemo(() => {
    if (!items || !tamanoElegido) return null;
    const tamanos = partirEnHojas(items, tamanoElegido);
    const ultima = tamanos[tamanos.length - 1] ?? 0;
    return { total: tamanos.length, parcial: ultima !== tamanoElegido ? ultima : 0 };
  }, [items, tamanoElegido]);

  const resultadoReparto = useMemo(() => {
    if (!paso3Hecho || contadores.length === 0) return null;
    const conteos = new Map<string, number>();
    for (const hoja of hojas) {
      const nombre = hoja.asignados[0];
      conteos.set(nombre, (conteos.get(nombre) ?? 0) + 1);
    }
    const valores = [...conteos.values()];
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    return min === max ? `${min} hojas por persona` : `${min}–${max} hojas por persona`;
  }, [paso3Hecho, contadores, hojas]);

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  function manejarErrorSnapshot(error: unknown): void {
    if (!(error instanceof ErrorSnapshot)) {
      Alert.alert('No se pudo traer el catálogo', error instanceof Error ? error.message : 'Intentá de nuevo.');
      return;
    }
    switch (error.codigo) {
      case 'cancelado':
        // Lo pidió la propia persona — no es un error, no hay nada que avisar.
        return;
      case 'sin-red':
        Alert.alert('Sin conexión con la tienda', 'Revisá el WiFi de la tienda y volvé a intentar cuando vuelva.');
        return;
      case 'dynamics-no-configurado':
        if (sesion!.colaborador.rol === 'administrador') {
          Alert.alert('Dynamics no está configurado', error.message, [
            { text: 'Cerrar', style: 'cancel' },
            { text: 'Ir a configurar', onPress: () => router.push('/administrador/config') },
          ]);
        } else {
          Alert.alert('Dynamics no está configurado', `${error.message} Pedile a un Administrador que cargue las credenciales.`);
        }
        return;
      case 'sin-almacen':
        // Distinto de "faltan credenciales": esto se arregla en Tiendas, no
        // en Configuración, y solo lo puede hacer un Administrador.
        if (sesion!.colaborador.rol === 'administrador') {
          Alert.alert('La sucursal no tiene almacén', error.message, [
            { text: 'Cerrar', style: 'cancel' },
            { text: 'Ir a Tiendas', onPress: () => router.push('/administrador/tiendas') },
          ]);
        } else {
          Alert.alert(
            'La sucursal no tiene almacén',
            `${error.message} Pedile a un Administrador que le asocie el almacén de Dynamics a esta tienda.`,
          );
        }
        return;
      case 'credenciales-rechazadas':
        Alert.alert(
          'Dynamics rechazó las credenciales',
          'La conexión con la tienda anduvo bien, pero Dynamics no aceptó las credenciales configuradas. Avisale a un Administrador.',
        );
        return;
      case 'timeout':
        Alert.alert('Se cortó a mitad de camino', 'Podés reintentar: no quedó nada a medio hacer.');
        return;
      default:
        Alert.alert('No se pudo traer el catálogo', error.message);
    }
  }

  async function traerSnapshot(): Promise<void> {
    // Cinturón de seguridad además de `loading` en el botón (ver más
    // abajo): dos snapshots en simultáneo duplican trabajo y pueden
    // dejar dos inventarios activos.
    if (trayendoSnapshot) return;

    setTrayendoSnapshot(true);
    setAvanceSnapshot(null);
    const controlador = new AbortController();
    controladorSnapshotRef.current = controlador;
    try {
      const resultado = await repositorioInventario.traerSnapshot(sesion!.sucursal!.id, {
        tipo: tipoElegido,
        onAvance: setAvanceSnapshot,
        signal: controlador.signal,
      });
      setInventarioId(resultado.inventarioId);
      setItems(resultado.items);
      setTomadoEn(resultado.tomadoEn);
      // `?? null`: si el servidor no informó el desglose, se guarda la
      // ausencia. La pantalla calla en vez de mostrar ceros que se leerían
      // como "no se excluyó ninguno".
      setDesglose(resultado.desglose ?? null);
    } catch (error) {
      manejarErrorSnapshot(error);
    } finally {
      setTrayendoSnapshot(false);
      setAvanceSnapshot(null);
      controladorSnapshotRef.current = null;
    }
  }

  function cancelarSnapshot(): void {
    controladorSnapshotRef.current?.abort();
  }

  async function crearHojasAhora(): Promise<void> {
    if (!inventarioId || !tamanoElegido) return;
    setCreandoHojas(true);
    try {
      const nuevas = await repositorioInventario.crearHojas(inventarioId, tamanoElegido);
      setHojas(nuevas);
      setTamanoCreado(tamanoElegido);
    } catch (error) {
      Alert.alert('No se pudieron crear las hojas', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setCreandoHojas(false);
    }
  }

  async function asignarAhora(): Promise<void> {
    if (!inventarioId) return;
    setAsignando(true);
    try {
      const actualizadas = await repositorioInventario.asignarHojas(
        inventarioId,
        contadores.map((c) => c.id),
      );
      setHojas(actualizadas);
    } catch (error) {
      Alert.alert('No se pudieron repartir las hojas', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setAsignando(false);
    }
  }

  // "N hojas CREADAS" y "saldrían N hojas" (preview, antes de crearlas) son
  // afirmaciones distintas -- antes `hojas.length || previa.total` las
  // mezclaba bajo el mismo texto, y alguien que solo mirara la barra de
  // arriba podía leer una previsualización como un hecho ya consumado.
  const sufijoPlural = (n: number) => (n === 1 ? '' : 's');
  const cifras = items
    ? hojas.length > 0
      ? `${formatoMiles(hojas.length)} hoja${sufijoPlural(hojas.length)} creada${sufijoPlural(hojas.length)} · ${formatoMiles(items)} ítem${sufijoPlural(items)}`
      : previa
        ? `Saldrían ${formatoMiles(previa.total)} hoja${sufijoPlural(previa.total)} · ${formatoMiles(items)} ítem${sufijoPlural(items)}`
        : `${formatoMiles(items)} ítem${sufijoPlural(items)}`
    : undefined;

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <BarraApp rotulo="Gestión masiva" sede={sesion.sucursal!.nombre} cifras={cifras} onSalir={salir} />

      {cargandoInicial ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargandoInicial} />
      ) : errorInicial ? (
        <View style={styles.tarjeta}>
          <Text style={styles.tarjetaTitulo}>No se pudo cargar la gestión de hojas</Text>
          <Text style={styles.tarjetaTexto}>{errorInicial}</Text>
          <Button label="Reintentar" onPress={cargar} />
        </View>
      ) : (
        <>
          <PasoTarjeta
            numero={1}
            icon={CloudDownload}
            titulo="Catálogo de Dynamics"
            estado={paso1Hecho ? 'hecho' : 'pendiente'}
            texto={
              sinAlmacen
                ? 'Esta sucursal todavía no tiene asociado un almacén de Dynamics, y sin almacén no hay stock contra el cual contar. Un Administrador se lo asigna en Tiendas.'
                : paso1Hecho && items && tomadoEn
                  ? `${formatoMiles(items)} ítems traídos de Dynamics · ${formatoFechaHora(tomadoEn)}. Es una lectura del catálogo — no escribe ni ajusta nada en Dynamics.`
                  : trayendoSnapshot
                    ? 'Trayendo el catálogo por páginas — con la WiFi de la tienda puede tardar varios minutos, no te vayas de la pantalla.'
                    : 'Trae de Dynamics los productos con stock en el almacén de esta sucursal: es la foto contra la que se compara todo el inventario. Es una lectura — no escribe ni ajusta nada en Dynamics.'
            }
          >
            {/* El motivo escrito y la salida, como en "Elegí primero la
                sucursal" del login: un botón deshabilitado sin explicación
                obliga a adivinar. */}
            {sinAlmacen ? (
              <View style={styles.avisoBloqueo}>
                <Text style={styles.avisoBloqueoTexto}>
                  Sin almacén configurado no se puede armar el inventario: el stock no vive en el catálogo de
                  productos, se consulta por almacén.
                </Text>
                {sesion.colaborador.rol === 'administrador' ? (
                  <Button
                    label="Ir a configurar el almacén"
                    variant="outline"
                    size="sm"
                    onPress={() => router.push('/administrador/tiendas')}
                  />
                ) : (
                  <Text style={styles.avisoBloqueoTexto}>Pedile a un Administrador que la configure.</Text>
                )}
              </View>
            ) : null}

            {/* Antes de traer: qué universo. Después, ya no se puede cambiar
                sin rehacer el snapshot, así que desaparece. */}
            {!paso1Hecho && !sinAlmacen ? (
              <SelectorTipo valor={tipoElegido} onElegir={setTipoElegido} disabled={trayendoSnapshot} />
            ) : null}

            {paso1Hecho ? <ResumenSnapshot items={items} desglose={desglose} tipo={tipoElegido} /> : null}

            {trayendoSnapshot ? (
              <>
                {/*
                  EL AVANCE ES REAL y avanza por página de OData: el backend
                  lo publica en `GET /api/d365/snapshot/progreso` y el
                  adaptador lo sondea en paralelo al POST
                  (inventario-api.ts#sondearProgreso).

                  Qué decir en cada estado vive en
                  `dominio/avance-snapshot.ts`, con test — incluido por qué ya
                  no hay un 4% fijo acá.
                */}
                <AvanceFila {...avanceParaMostrar(avanceSnapshot, formatoMiles)} />
                <Button label="Cancelar" variant="outline" size="sm" onPress={cancelarSnapshot} />
              </>
            ) : null}
          </PasoTarjeta>

          <PasoTarjeta
            numero={2}
            icon={LayoutGrid}
            titulo="Crear hojas de conteo"
            estado={!paso1Hecho ? 'bloqueado' : paso2Hecho ? 'hecho' : 'pendiente'}
            texto={
              !paso1Hecho
                ? 'Traé primero el catálogo de Dynamics para poder crear las hojas.'
                : paso2Hecho
                  ? `${formatoMiles(hojas.length)} hojas creadas de ${tamanoCreado} ítems (${formatoMiles(items ?? 0)} ítems en total)${
                      hojas[hojas.length - 1] && hojas[hojas.length - 1].tamano !== tamanoCreado
                        ? ` · la última con ${hojas[hojas.length - 1].tamano} ítems`
                        : ''
                    }.`
                  : 'Elegí cuántos ítems por hoja querés y mirá cuántas hojas salen antes de crearlas.'
            }
          >
            {paso1Hecho && !paso2Hecho ? (
              <>
                <SelectorTamano valor={tamanoElegido} onElegir={setTamanoElegido} disabled={creandoHojas} />
                {previa ? (
                  <Text style={styles.previaTexto}>
                    → {formatoMiles(previa.total)} hojas de {tamanoElegido} ítems
                    {previa.parcial > 0 ? ` · la última con ${previa.parcial} ítems` : ''}
                  </Text>
                ) : null}
              </>
            ) : null}
          </PasoTarjeta>

          <PasoTarjeta
            numero={3}
            icon={Users}
            titulo="Asignar hojas de conteo"
            estado={!paso2Hecho ? 'bloqueado' : paso3Hecho ? 'hecho' : 'pendiente'}
            texto={
              !paso2Hecho
                ? 'Creá primero las hojas de conteo para poder asignarlas.'
                : paso3Hecho && resultadoReparto
                  ? `Las ${formatoMiles(hojas.length)} hojas ya están repartidas entre los ${contadores.length} contadores presentes, en bloques contiguos (${resultadoReparto}).`
                  : `Repartí las ${formatoMiles(hojas.length)} hojas entre los ${contadores.length} contadores presentes, en bloques contiguos. Contar es caminar la góndola, no saltar de punta a punta.`
            }
          />

          <Button
            label={
              !paso1Hecho
                ? sinAlmacen
                  ? 'Falta configurar el almacén'
                  : `Traer catálogo ${tipoElegido === 'anual' ? 'anual' : 'mensual'} de Dynamics`
                : !paso2Hecho
                  ? tamanoElegido
                    ? `Crear ${previa ? formatoMiles(previa.total) : ''} hojas de ${tamanoElegido} ítems`
                    : 'Elegí el tamaño de hoja'
                  : !paso3Hecho
                    ? 'Repartir automáticamente'
                    : 'Hojas repartidas'
            }
            icon={!paso1Hecho ? CloudDownload : !paso2Hecho ? LayoutGrid : !paso3Hecho ? Users : Check}
            size="lg"
            loading={trayendoSnapshot || creandoHojas || asignando}
            // Sin almacén no se deja avanzar, y el propio label dice por qué:
            // un botón gris sin motivo obliga a la persona a adivinar.
            disabled={sinAlmacen || (paso1Hecho && !paso2Hecho && !tamanoElegido) || paso3Hecho}
            onPress={!paso1Hecho ? traerSnapshot : !paso2Hecho ? crearHojasAhora : !paso3Hecho ? asignarAhora : undefined}
          />
        </>
      )}
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md + 3 },
  cargandoInicial: { marginTop: spacing.xxxl },

  tarjeta: {
    gap: spacing.md,
    padding: 15,
    backgroundColor: colors.campo,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: 13,
  },
  tarjetaBloqueada: { opacity: 0.55 },
  tarjetaCabecera: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tarjetaTitulo: { flex: 1, fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
  tarjetaTexto: { fontSize: 12.5, lineHeight: 18, color: colors.gris, fontFamily: fonts.regular },

  pasoMarca: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.esperaSuave,
  },
  pasoMarcaHecho: { backgroundColor: colors.ok },
  pasoMarcaTexto: { fontSize: 12, color: colors.espera, fontFamily: fonts.bold },

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
  campoTipo: { gap: 6 },
  etiquetaTipo: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.semibold },
  ayudaTipo: { fontSize: 12, lineHeight: 16.5, color: colors.gris, fontFamily: fonts.regular },

  avisoBloqueo: {
    gap: 10,
    padding: 11,
    borderRadius: radius.md,
    backgroundColor: colors.procesoSuave,
  },
  avisoBloqueoTexto: { fontSize: 12.5, lineHeight: 17, color: colors.proceso, fontFamily: fonts.medium },

  resumenSnapshot: {
    gap: 5,
    padding: 11,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borde,
  },
  resumenFila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  resumenEtiqueta: { flex: 1, fontSize: 12, color: colors.gris, fontFamily: fonts.regular },
  resumenValor: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.bold },
  resumenValorTenue: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.semibold },
  resumenSubtitulo: {
    marginTop: 4,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.grisClaro,
    fontFamily: fonts.semibold,
  },
  resumenNota: { fontSize: 11.5, lineHeight: 16, color: colors.gris, fontFamily: fonts.regular },

  previaTexto: { fontSize: 12.5, fontWeight: '600', color: colors.proceso, fontFamily: fonts.semibold },
});
