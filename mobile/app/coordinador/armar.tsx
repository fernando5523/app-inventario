import { router } from 'expo-router';
import { AlertTriangle, Check, CloudDownload, LayoutGrid, UserCheck, Users } from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { faseDeCierre, type FaseDeCierre } from '../../lib/dominio/ajuste-final';
import {
  AvanceFila,
  BarraApp,
  Badge,
  Button,
  diaEnLima,
  formatoFechaHora,
  formatoMiles,
  type BadgeVariant,
} from '../../components/ui';
import { inventarioIdSinRed, ultimaDescarga } from '../../lib/adaptadores/hojas-sqlite';
import { repositorioAsistencia, repositorioHojas, repositorioInventario } from '../../lib/contenedor';
import { contadoresPresentes, filasDeAsistencia } from '../../lib/dominio/asistencia';
import { avanceParaMostrar } from '../../lib/dominio/avance-snapshot';
import { textoDeCriterios } from '../../lib/dominio/criterios-snapshot';
import { rotuloHojasCreadas } from '../../lib/dominio/rotulo-armado';
import { partirEnHojas } from '../../lib/dominio/lote';
import { pluralizar } from '../../lib/dominio/plural';
import { TAMANOS_HOJA, type HojaConteo, type TamanoHoja } from '../../lib/dominio/tipos';
import type { AsistenciaInventario } from '../../lib/puertos/repositorios';
import {
  ErrorSnapshot,
  type AvanceSnapshot,
  type CriteriosSnapshot,
  type DesgloseSnapshot,
  type EstadoInventario,
  type TipoInventario,
} from '../../lib/puertos/repositorios';
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
  /** Qué filtros corrieron. `null` = el servidor no lo informó: no se afirma ninguno. */
  criterios: CriteriosSnapshot | null;
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
function ResumenSnapshot({ items, desglose, criterios, tipo }: ResumenSnapshotProps): JSX.Element | null {
  if (items === null) return null;

  const texto = textoDeCriterios(items, tipo, criterios ?? undefined, formatoMiles);

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
      ) : null}

      {/* QUÉ ENTRÓ, según lo que de verdad se filtró en ESTA corrida.
          Antes acá había un texto fijo que afirmaba siempre los tres
          criterios ("productos activos, con stock en el almacén y
          responsabilidad del personal") -- y el de estado activo no existe,
          y los otros dos se caen si falta el almacén o si no se pudo leer el
          responsable. Ver dominio/criterios-snapshot.ts. */}
      <Text style={styles.resumenNota}>{texto.resumen}</Text>
      {texto.advertencia ? <Text style={styles.resumenAdvertencia}>{texto.advertencia}</Text> : null}
    </View>
  );
}

/**
 * Panel del Coordinador — 3 pasos en orden, cada uno bloqueado hasta que
 * el anterior termina (mobile/design/hojas.html, ya validada). Un solo
 * CTA al pie cuya acción cambia según el paso activo, igual que en la
 * maqueta: nunca dos botones habilitados a la vez.
 *
 * Pantalla PROPIA (pedido del cliente, 2026-09-07): antes convivía con
 * "Hojas de esta ronda" en la misma pantalla, con un colapsable cuando
 * terminaba. Acá, en su propio tab, los 3 pasos se ven SIEMPRE completos —
 * el colapso ya no tiene sentido cuando esta pantalla no compite por
 * espacio con ninguna lista.
 *
 * NO se portó la 4ta opción "Otro" (tamaño personalizado) de la maqueta:
 * `RepositorioInventario.crearHojas` está tipado a `TamanoHoja` (20|30|50),
 * no a un entero arbitrario. Ampliar el puerto para aceptarlo queda para
 * cuando se pida esa tarea — acá solo se ofrecen los 3 tamaños que el
 * puerto ya soporta.
 */
export default function ArmarHojasScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();

  const [cargandoInicial, setCargandoInicial] = useState(true);
  const [errorInicial, setErrorInicial] = useState<string | null>(null);
  const [inventarioId, setInventarioId] = useState<number | null>(null);
  const [items, setItems] = useState<number | null>(null);
  const [tomadoEn, setTomadoEn] = useState<string | null>(null);
  const [hojas, setHojas] = useState<HojaConteo[]>([]);
  // La ronda a la que pertenecen `hojas` (el reconteo es 2 y 3). El rótulo del
  // paso 2 la NECESITA: sin ella un "1 hoja creada" no dice de qué ronda es, y
  // ese número sin apellido mostraba las cifras de la ronda 1 en las rondas
  // 2 y 3 (BUG B).
  const [ronda, setRonda] = useState(1);
  /**
   * La fase del cierre. `null` = todavía no se sabe (o no hay inventario).
   *
   * El armado solo tiene sentido mientras haya una ronda abierta. Antes eso
   * se daba por hecho -- `activo()` solo devolvía inventarios `en_curso` con
   * ronda -- y ahora ya no: entre la última ronda cerrada y el ajuste del
   * auditor, y durante el ajuste, el inventario sigue abierto pero no hay
   * nada que crear ni repartir. Ver dominio/ajuste-final.ts.
   */
  const [fase, setFase] = useState<FaseDeCierre | null>(null);
  /**
   * LA ASISTENCIA DEL DÍA. `null` = no se pudo traer, que NO es lo mismo que
   * "nadie marcó" -- y la diferencia decide qué dice el paso 3.
   *
   * Antes acá había un padrón crudo (`colaboradores` filtrado por rol) y el
   * reparto salía de ahí sin mirar la asistencia. Ver `contadoresPresentes`
   * en dominio/asistencia.ts para el bug que eso causaba.
   */
  const [asistencia, setAsistencia] = useState<AsistenciaInventario | null>(null);
  const [asistenciaFallo, setAsistenciaFallo] = useState(false);
  /** `true` = las hojas que se muestran salen de la copia local sin haberse podido contrastar. */
  const [hojasSinVerificar, setHojasSinVerificar] = useState(false);

  const [tipoElegido, setTipoElegido] = useState<TipoInventario>('mensual');
  const [desglose, setDesglose] = useState<DesgloseSnapshot | null>(null);
  const [criterios, setCriterios] = useState<CriteriosSnapshot | null>(null);
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
    // `null` y NO 1: "no hay ronda" y "ronda 1" son cosas distintas, y desde
    // que el conteo puede terminar con el inventario todavía abierto, el
    // default a 1 traía las hojas de la PRIMERA ronda y las rotulaba como si
    // se estuvieran armando ahora.
    let rondaActiva: number | null = null;
    let estadoActivo: EstadoInventario | null = null;
    // Cuántas hojas tuvo este inventario EN TOTAL, no las de la ronda: es lo
    // que distingue "todavía no se crearon" de "se cerraron todas". Ver
    // dominio/ajuste-final.ts#faseDeCierre.
    let totalHojas = 0;
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
      rondaActiva = activo?.rondaActiva ?? null;
      estadoActivo = activo?.estado ?? null;
      totalHojas = activo?.totalHojas ?? 0;
    } catch {
      activoFallo = true;
      inventarioActivo = await inventarioIdSinRed();
    }

    /**
     * LA ASISTENCIA DEL DÍA -- de acá sale a quiénes se les reparte.
     *
     * Antes se traía el padrón crudo y su fallo se tragaba en silencio: la
     * lista quedaba vacía y el paso 3 "simplemente no tenía a quién
     * repartir". Ese patrón NO sirve acá, y es el mismo bug con otra cara:
     * si no se pudo verificar quién vino, repartir entre todos los del
     * padrón es exactamente lo que había que dejar de hacer. Por eso el
     * fallo se RECUERDA (`asistenciaFallo`) y el paso 3 lo dice.
     *
     * Se pide después de `activo()` porque necesita el inventarioId, y solo
     * si hay uno: sin inventario no hay asistencia que traer.
     */
    setAsistenciaFallo(false);
    if (inventarioActivo !== null) {
      try {
        setAsistencia(await repositorioAsistencia.deInventario(inventarioActivo));
      } catch {
        setAsistencia(null);
        setAsistenciaFallo(true);
      }
    } else {
      setAsistencia(null);
    }

    if (inventarioActivo) {
      setInventarioId(inventarioActivo);
      setItems(itemsSnapshot);
      setTomadoEn(tomadoEnSnapshot);
      setRonda(rondaActiva ?? 1);
      setFase(estadoActivo === null ? null : faseDeCierre(estadoActivo, rondaActiva, totalHojas));
      if (rondaActiva === null) {
        // Sin ronda abierta no hay hojas que traer: o todavía no se creó
        // ninguna (paso 1), o el conteo ya terminó. Pedir las de la ronda 1
        // en el segundo caso mostraría hojas viejas como si fueran el armado
        // en curso.
        setHojas([]);
        setHojasSinVerificar(false);
      } else {
        try {
          // Las hojas de la ronda activa. Acá solo se usan para saber en qué
          // paso está el armado (2 y 3) -- la LISTA en sí vive en "Hojas".
          const todas = await repositorioHojas.todas(inventarioActivo, rondaActiva);
          setHojas(todas);
          /**
           * SI LO QUE SE ESTA MOSTRANDO SE PUDO VERIFICAR CONTRA EL SERVIDOR.
           *
           * `todas()` NO lanza cuando la descarga falla: `descargarHojas`
           * atrapa el error y sigue con la copia local (hojas-sqlite.ts). Sin
           * mirar esto, el paso 3 podía afirmar "las 26 hojas ya están
           * repartidas" con el reparto de ayer y sin ninguna marca de que no
           * se habló con el servidor. Gestión de hojas ya lo consultaba; acá
           * faltaba.
           *
           * La copia local NO se descarta ni se vacía -- sin red es lo bueno.
           * Lo único que cambia es que la pantalla lo dice.
           */
          const descarga = ultimaDescarga(inventarioActivo, 'todas', rondaActiva);
          setHojasSinVerificar(descarga?.ok === false);
        } catch (e) {
          setErrorInicial(e instanceof Error ? e.message : 'No se pudo cargar el estado del armado.');
        }
      }
    } else if (activoFallo) {
      // Sin red Y sin nada descargado localmente: ahí sí es un fallo real
      // que hay que decir, no el "todavía no hay inventario" normal del
      // arranque de un ciclo.
      setErrorInicial('No se pudo conectar con el servidor ni encontrar un inventario descargado localmente.');
    }
    setCargandoInicial(false);
  }, [sesion]);

  /**
   * `useRefrescoAlEnfocar` y ya no `useFocusEffect` a secas.
   *
   * El anterior disparaba al NAVEGAR a esta pantalla, pero no cuando la app
   * vuelve de segundo plano -- y ese es justo el caso que reportó el usuario:
   * salió de la app mientras Dynamics sincronizaba el catálogo, volvió, y el
   * paso 1 seguía mostrando los ítems de antes hasta que navegara a otra
   * pestaña y regresara. Es el MISMO hook que usan Gestión de hojas,
   * Asistencia y Ciclo: un solo comportamiento para toda la app.
   *
   * Pausado mientras se reparte o se crean hojas: un refresco a mitad de una
   * de esas acciones pisaría `hojas` con el estado de ANTES, y las dos ya
   * re-piden lo suyo al terminar.
   */
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar, {
    pausado: asignando || creandoHojas || trayendoSnapshot,
  });

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
  // SOLO para el check visual (verde "Hecho") -- `paso1Hecho` sigue
  // decidiendo la ACCION del botón sin tocar (offline: hay inventarioId
  // local pero todavía no `items`/`tomadoEn`, y ahí el botón tiene que
  // seguir mandando a "crear hojas", no a "traer catálogo" de nuevo). Bug
  // real de honestidad (2026-09-10, ver d365-catalogo.service.ts#crearSnapshot):
  // la pantalla no puede pintar el check verde sin poder mostrar CON QUÉ
  // datos -- cantidad e instante exacto -- respalda ese "Hecho".
  const paso1Confirmado = paso1Hecho && items !== null && tomadoEn !== null;
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

  /**
   * LOS CONTADORES PRESENTES HOY. La regla vive en el dominio
   * (`contadoresPresentes`): marca del día Y rol `conteo`.
   */
  const hoy = diaEnLima(new Date());
  const presentes = useMemo(
    () => (asistencia ? contadoresPresentes(filasDeAsistencia(asistencia.personal, asistencia.marcas, hoy)) : []),
    [asistencia, hoy],
  );

  /**
   * EN QUÉ DE LOS CUATRO CASOS ESTÁ EL PASO 3, y los cuatro tienen texto
   * propio. El orden importa: se pregunta primero por lo que impide saber, y
   * recién al final por lo que habilita.
   *
   *  `no-verificada`  no se pudo traer la asistencia. NO se reparte -- caer a
   *                   "todos los del padrón" es volver al bug con otra cara.
   *  `sin-tomar`      se trajo y nadie marcó todavía. El reparto no arranca
   *                   la jornada: la asistencia sí.
   *  `sin-contadores` marcaron, pero ninguno de rol `conteo` (vinieron el
   *                   coordinador y el auditor). No hay entre quiénes repartir.
   *  `listo`          hay presentes. Recién acá el texto puede decir
   *                   "contadores presentes" sin estar afirmando de más.
   */
  const casoAsistencia: 'no-verificada' | 'sin-tomar' | 'sin-contadores' | 'listo' =
    asistenciaFallo || asistencia === null
      ? 'no-verificada'
      : asistencia.marcas.filter((m) => m.dia === hoy).length === 0
        ? 'sin-tomar'
        : presentes.length === 0
          ? 'sin-contadores'
          : 'listo';

  /**
   * EL QUE LLEGA TARDE. Después de repartir, alguien aparece, el Coordinador
   * le marca la entrada y vuelve acá: hay que poder repartir de nuevo.
   *
   * Se compara por NOMBRE porque es lo único que trae `hoja.asignados` -- el
   * servidor devuelve los nombres ya resueltos, no los ids. Alcanza: son los
   * nombres del mismo padrón, y una coincidencia falsa (dos personas con el
   * mismo nombre en una tienda) haría que no se ofrezca repartir de nuevo, no
   * que se reparta mal.
   */
  const repartoDesactualizado = useMemo(() => {
    if (!paso3Hecho || casoAsistencia !== 'listo') return false;
    const conHojas = new Set(hojas.flatMap((h) => h.asignados));
    const presentesAhora = new Set(presentes.map((p) => p.nombre));
    if (conHojas.size !== presentesAhora.size) return true;
    return [...presentesAhora].some((nombre) => !conHojas.has(nombre));
  }, [paso3Hecho, casoAsistencia, hojas, presentes]);

  const resultadoReparto = useMemo(() => {
    if (!paso3Hecho || presentes.length === 0) return null;
    const conteos = new Map<string, number>();
    for (const hoja of hojas) {
      const nombre = hoja.asignados[0];
      conteos.set(nombre, (conteos.get(nombre) ?? 0) + 1);
    }
    const valores = [...conteos.values()];
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    // Con pocas hojas y varios contadores el reparto parejo da UNA por
    // persona. El rango (min–max) va siempre en plural: lo manda el máximo.
    return min === max ? `${min} ${pluralizar(min, 'hoja', 'hojas')} por persona` : `${min}–${max} hojas por persona`;
  }, [paso3Hecho, presentes, hojas]);

  // El texto del paso 3 concuerda con SUS DOS cifras: una ronda de reconteo
  // puede tener UNA hoja, y una tienda chica UN solo contador presente. Con un
  // solo contador no hay nada que "repartir entre" -- se le asigna todo, así
  // que cambian también el verbo y la preposición.
  const lasHojas = pluralizar(hojas.length, 'la única hoja', `las ${formatoMiles(hojas.length)} hojas`);
  const repartoHecho = pluralizar(
    presentes.length,
    `${pluralizar(hojas.length, 'está asignada', 'están asignadas')} al contador presente`,
    `${pluralizar(hojas.length, 'está repartida', 'están repartidas')} entre los ${presentes.length} contadores presentes`,
  );
  const repartoPendiente = pluralizar(
    presentes.length,
    `Asigna ${lasHojas} al contador presente`,
    `Reparte ${lasHojas} entre los ${presentes.length} contadores presentes`,
  );

  /**
   * EL TEXTO DEL PASO 3 SEGÚN EL CASO.
   *
   * "contadores presentes" solo aparece en `listo`, que es el único donde se
   * miró la asistencia y hay a quién repartir. En los otros tres el texto
   * dice qué falta y adónde ir -- nunca afirma quién vino.
   */
  const textoPaso3 = !paso2Hecho
    ? 'Crea primero las hojas de conteo para poder asignarlas.'
    : casoAsistencia === 'no-verificada'
      ? 'No se pudo verificar quién asistió hoy. Sin eso no se reparten las hojas: repartirlas entre todo el padrón le daría hojas a quien no vino, y esas hojas quedan sin contar.'
      : casoAsistencia === 'sin-tomar'
        ? 'Todavía no se tomó la asistencia de hoy. Márcala primero: las hojas se reparten entre quienes llegaron, no entre todo el padrón.'
        : casoAsistencia === 'sin-contadores'
          ? 'Hoy marcaron entrada el coordinador y el auditor, pero ningún contador. No hay entre quiénes repartir las hojas.'
          : paso3Hecho && resultadoReparto
            ? `${pluralizar(hojas.length, 'La única hoja', `Las ${formatoMiles(hojas.length)} hojas`)} ya ${repartoHecho}, en bloques contiguos (${resultadoReparto}).`
            : `${repartoPendiente}, en bloques contiguos. Contar es caminar la góndola, no saltar de punta a punta.`;

  /** Solo se reparte con la asistencia verificada Y con alguien a quien darle hojas. */
  const puedeRepartir = casoAsistencia === 'listo';

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  function manejarErrorSnapshot(error: unknown): void {
    if (!(error instanceof ErrorSnapshot)) {
      Alert.alert('No se pudo traer el catálogo', error instanceof Error ? error.message : 'Intenta de nuevo.');
      return;
    }
    switch (error.codigo) {
      case 'cancelado':
        // Lo pidió la propia persona — no es un error, no hay nada que avisar.
        return;
      case 'sin-red':
        Alert.alert('Sin conexión con la tienda', 'Revisa el WiFi de la tienda y vuelve a intentar cuando vuelva.');
        return;
      case 'dynamics-no-configurado':
        if (sesion!.colaborador.rol === 'administrador') {
          Alert.alert('Dynamics no está configurado', error.message, [
            { text: 'Cerrar', style: 'cancel' },
            { text: 'Ir a configurar', onPress: () => router.push('/administrador/config') },
          ]);
        } else {
          Alert.alert('Dynamics no está configurado', `${error.message} Pídele a un Administrador que cargue las credenciales.`);
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
            `${error.message} Pídele a un Administrador que le asocie el almacén de Dynamics a esta tienda.`,
          );
        }
        return;
      case 'credenciales-rechazadas':
        Alert.alert(
          'Dynamics rechazó las credenciales',
          'La conexión con la tienda funcionó bien, pero Dynamics no aceptó las credenciales configuradas. Avísale a un Administrador.',
        );
        return;
      case 'timeout':
        Alert.alert('Se cortó a mitad de camino', 'Puedes reintentar: no quedó nada a medio hacer.');
        return;
      case 'inventario-ya-existe':
        // Regla de negocio, no falla técnica: la tienda ya tiene su inventario
        // de este mes. Reintentar NUNCA va a funcionar, así que no se ofrece —
        // solo la verdad que ya redactó el backend, con el estado real del
        // inventario ("... ya tiene su inventario mensual de septiembre 2026
        // (#34, conteo cerrado).").
        Alert.alert('Ese inventario ya existe', error.message);
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
      // Mismo criterio que `desglose`: `?? null` = el servidor no lo informó,
      // y ahí la pantalla no afirma ningún filtro en vez de asumir los tres.
      setCriterios(resultado.criterios ?? null);
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
    } catch (error) {
      Alert.alert('No se pudieron crear las hojas', error instanceof Error ? error.message : 'Intenta de nuevo.');
    } finally {
      setCreandoHojas(false);
    }
  }

  async function asignarAhora(): Promise<void> {
    // La guarda de verdad, no solo el botón deshabilitado: sin asistencia
    // verificada no se manda nada al servidor. `asignarHojas` NO valida
    // asistencia a propósito (los scripts de siembra reparten sin ella, y el
    // Coordinador es la autoridad sobre quién está en su tienda), así que
    // esta es la única barrera y tiene que estar acá.
    if (!inventarioId || !puedeRepartir) return;
    setAsignando(true);
    try {
      const actualizadas = await repositorioInventario.asignarHojas(
        inventarioId,
        presentes.map((p) => p.id),
      );
      setHojas(actualizadas);
    } catch (error) {
      Alert.alert('No se pudieron repartir las hojas', error instanceof Error ? error.message : 'Intenta de nuevo.');
    } finally {
      setAsignando(false);
    }
  }

  // "N hojas CREADAS" y "saldrían N hojas" (preview, antes de crearlas) son
  // afirmaciones distintas -- antes `hojas.length || previa.total` las
  // mezclaba bajo el mismo texto, y alguien que solo mirara la barra de
  // arriba podía leer una previsualización como un hecho ya consumado.
  const sufijoPlural = (n: number) => (n === 1 ? '' : 's');
  /**
   * Hay inventario abierto pero ninguna ronda: el armado no aplica. No se
   * confunde con "todavía no hay inventario" (donde el paso 1 SÍ aplica: hay
   * que traer el catálogo), ni con "no se sabe" por falta de red.
   */
  /**
   * El armado no aplica porque el conteo YA TERMINO -- no porque todavía no
   * haya empezado.
   *
   * `'sin-hojas'` queda AFUERA a propósito, y es el bug que esto cierra: un
   * inventario con el catálogo traído y cero hojas caía acá y la pantalla
   * decía "El conteo de este inventario terminó", dejando al Coordinador sin
   * forma de crear las hojas -- que es exactamente a lo que había entrado.
   */
  const conteoTerminado = fase !== null && fase !== 'contando' && fase !== 'sin-hojas';

  const cifras = items
    ? hojas.length > 0
      ? `${formatoMiles(hojas.length)} hoja${sufijoPlural(hojas.length)} creada${sufijoPlural(hojas.length)} · ${formatoMiles(items)} ítem${sufijoPlural(items)}`
      : previa
        ? `Saldrían ${formatoMiles(previa.total)} hoja${sufijoPlural(previa.total)} · ${formatoMiles(items)} ítem${sufijoPlural(items)}`
        : `${formatoMiles(items)} ítem${sufijoPlural(items)}`
    : undefined;

  return (
    <PantallaConTabs
      scrollable
      contentStyle={styles.contenido}
      refreshControl={
        <RefreshControl refreshing={refrescando} onRefresh={refrescar} colors={[colors.rojo]} tintColor={colors.rojo} />
      }
    >
      <BarraApp rotulo="Armar hojas" sede={sesion.sucursal!.nombre} cifras={cifras} onSalir={salir} />

      {/*
        LO QUE SE MUESTRA NO SE PUDO CONTRASTAR CON EL SERVIDOR. La copia
        local sigue siendo la buena -- sin red es lo único que hay --, pero
        decirlo cambia la decisión: el Coordinador no reparte de nuevo ni da
        por hecho un reparto que quizá ya no es el del servidor.
      */}
      {hojasSinVerificar ? (
        <View style={styles.avisoTarde}>
          <AlertTriangle size={16} color={colors.proceso} />
          <Text style={styles.avisoTardeTexto}>
            No se pudo contrastar con el servidor: lo que ves es la última copia descargada en este teléfono. Tirá
            para refrescar cuando vuelva la señal.
          </Text>
        </View>
      ) : null}

      {cargandoInicial ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargandoInicial} />
      ) : conteoTerminado ? (
        /*
          EL CONTEO TERMINÓ: los tres pasos del armado no aplican y el
          servidor los rechazaría. Se reemplaza el wizard entero en vez de
          dejarlo deshabilitado -- tres pasos grises sin explicación hacen
          pensar que algo se rompió, y acá no se rompió nada: el inventario
          avanzó de etapa.

          Lo que SÍ le queda al Coordinador -- corregir valores mientras el
          auditor no empiece el ajuste -- se dice acá, porque es la única
          acción que le queda y no es evidente desde esta pantalla.
        */
        <View style={styles.tarjeta}>
          <Text style={styles.tarjetaTitulo}>El conteo de este inventario terminó</Text>
          <Text style={styles.tarjetaTexto}>
            {fase === 'ajuste'
              ? 'El auditor está haciendo el ajuste final: fija él los valores definitivos contra el stock. Ya no se crean ni se reparten hojas, y tampoco se pueden corregir conteos.'
              : 'Se cerraron todas las rondas y el auditor decide qué sigue: otra pasada de conteo, o el ajuste final. Mientras no empiece el ajuste, todavía puedes corregir valores desde las hojas de la última ronda.'}
          </Text>
          <Button label="Ir a Gestión de hojas" variant="outline" onPress={() => router.push('/coordinador/hojas')} />
        </View>
      ) : errorInicial ? (
        <View style={styles.tarjeta}>
          <Text style={styles.tarjetaTitulo}>No se pudo cargar el armado</Text>
          <Text style={styles.tarjetaTexto}>{errorInicial}</Text>
          <Button label="Reintentar" onPress={cargar} />
        </View>
      ) : (
        <>
          <PasoTarjeta
            numero={1}
            icon={CloudDownload}
            titulo="Catálogo de Dynamics"
            estado={paso1Confirmado ? 'hecho' : 'pendiente'}
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
            {/* El motivo escrito y la salida, como en "Elige primero la
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
                  <Text style={styles.avisoBloqueoTexto}>Pídele a un Administrador que la configure.</Text>
                )}
              </View>
            ) : null}

            {/* Antes de traer: qué universo. Después, ya no se puede cambiar
                sin rehacer el snapshot, así que desaparece. */}
            {!paso1Hecho && !sinAlmacen ? (
              <SelectorTipo valor={tipoElegido} onElegir={setTipoElegido} disabled={trayendoSnapshot} />
            ) : null}

            {paso1Hecho ? <ResumenSnapshot items={items} desglose={desglose} criterios={criterios} tipo={tipoElegido} /> : null}

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
                ? 'Trae primero el catálogo de Dynamics para poder crear las hojas.'
                : paso2Hecho
                  ? rotuloHojasCreadas(hojas, ronda, formatoMiles)
                  : 'Elige cuántos ítems por hoja quieres y mira cuántas hojas salen antes de crearlas.'
            }
          >
            {paso1Hecho && !paso2Hecho ? (
              <>
                <SelectorTamano valor={tamanoElegido} onElegir={setTamanoElegido} disabled={creandoHojas} />
                {previa ? (
                  <Text style={styles.previaTexto}>
                    → {formatoMiles(previa.total)} {pluralizar(previa.total, 'hoja', 'hojas')} de {tamanoElegido} ítems
                    {previa.parcial > 0 ? ` · la última con ${previa.parcial} ${pluralizar(previa.parcial, 'ítem', 'ítems')}` : ''}
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
            texto={textoPaso3}
          />

          {/*
            EL CAMINO A LA ASISTENCIA. Sin esto el paso 3 diría "márcala
            primero" y dejaría a la persona buscando dónde -- la pantalla está
            en el inicio, no en esta barra. El botón es el punto entero del
            cambio: que la asistencia deje de ser un trámite paralelo y sea lo
            que habilita el reparto.
          */}
          {paso2Hecho && !paso3Hecho && casoAsistencia !== 'listo' ? (
            <Button
              label={casoAsistencia === 'no-verificada' ? 'Reintentar' : 'Tomar asistencia de hoy'}
              icon={casoAsistencia === 'no-verificada' ? undefined : UserCheck}
              size="lg"
              variant="outline"
              onPress={() => {
                if (casoAsistencia === 'no-verificada') cargar();
                else router.push('/coordinador/asistencia');
              }}
            />
          ) : null}

          {/*
            EL QUE LLEGA TARDE, que pasa todos los días: se repartió, apareció
            alguien más, el Coordinador le marcó la entrada y volvió acá. Sin
            este aviso la pantalla diría "ya están repartidas" y no habría
            forma de incluirlo -- el botón de repartir desaparece con el paso
            hecho.
          */}
          {repartoDesactualizado ? (
            <View style={styles.avisoTarde}>
              <AlertTriangle size={16} color={colors.proceso} />
              <Text style={styles.avisoTardeTexto}>
                La asistencia cambió después de repartir: ahora hay {presentes.length}{' '}
                {pluralizar(presentes.length, 'contador presente', 'contadores presentes')} y las hojas están
                repartidas entre otra gente. Vuelve a repartir para incluir a quien llegó.
              </Text>
            </View>
          ) : null}

          {repartoDesactualizado ? (
            <Button
              label={`Repartir de nuevo entre ${presentes.length} ${pluralizar(presentes.length, 'contador', 'contadores')}`}
              icon={Users}
              size="lg"
              loading={asignando}
              onPress={asignarAhora}
            />
          ) : null}

          {!paso3Hecho ? (
            <Button
              label={
                !paso1Hecho
                  ? sinAlmacen
                    ? 'Falta configurar el almacén'
                    : `Traer catálogo ${tipoElegido === 'anual' ? 'anual' : 'mensual'} de Dynamics`
                  : !paso2Hecho
                    ? tamanoElegido
                      ? `Crear ${previa ? formatoMiles(previa.total) : ''} ${pluralizar(previa?.total ?? 0, 'hoja', 'hojas')} de ${tamanoElegido} ítems`
                      : 'Elige el tamaño de hoja'
                    : casoAsistencia === 'listo'
                      ? `Repartir entre ${presentes.length} ${pluralizar(presentes.length, 'contador presente', 'contadores presentes')}`
                      : 'Falta tomar la asistencia'
              }
              icon={!paso1Hecho ? CloudDownload : !paso2Hecho ? LayoutGrid : Users}
              size="lg"
              loading={trayendoSnapshot || creandoHojas || asignando}
              // Sin almacén no se deja avanzar, y el propio label dice por qué:
              // un botón gris sin motivo obliga a la persona a adivinar.
              // Con las hojas creadas, el botón solo reparte si la asistencia
              // se verificó y hay a quién: su propio label dice por qué no.
              disabled={
                sinAlmacen ||
                (paso1Hecho && !paso2Hecho && !tamanoElegido) ||
                (paso2Hecho && !puedeRepartir)
              }
              onPress={!paso1Hecho ? traerSnapshot : !paso2Hecho ? crearHojasAhora : asignarAhora}
            />
          ) : (
            // Ya está todo hecho y esta pantalla ya no compite con ninguna
            // lista -- decir dónde seguir en vez de dejar la pantalla "sin
            // nada más que ofrecer" después del último paso.
            <Text style={styles.listoTexto}>Listo. La lista y el avance de cada hoja están en "Hojas".</Text>
          )}
        </>
      )}
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md + 3 },

  avisoTarde: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.procesoSuave,
  },
  avisoTardeTexto: { flex: 1, fontSize: 12.5, lineHeight: 17, color: colors.tinta, fontFamily: fonts.regular },
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
  // Ámbar y NO rojo: el Coordinador no hizo nada mal y casi nunca puede
  // arreglar lo que falta (configurar un almacén es del Administrador). Es
  // información que tiene que ver, no una alarma que lo asuste.
  resumenAdvertencia: { marginTop: 4, fontSize: 11.5, lineHeight: 16, color: colors.proceso, fontFamily: fonts.medium },

  previaTexto: { fontSize: 12.5, fontWeight: '600', color: colors.proceso, fontFamily: fonts.semibold },

  listoTexto: {
    padding: 13,
    borderRadius: radius.md,
    backgroundColor: colors.okSuave,
    fontSize: 12.5,
    lineHeight: 17.5,
    color: colors.ok,
    fontFamily: fonts.medium,
    textAlign: 'center',
  },
});
