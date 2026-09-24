import { router } from 'expo-router';
import { BarChart3, Boxes, CheckCircle2, ClipboardList, Lock, PencilLine, Store, Zap } from 'lucide-react-native';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { EncabezadoPagina, FilaDato, TarjetaWeb, BotonWeb, ChipIcono } from '../../components/web';
import { formatoMoneda, SelectorSucursal } from '../../components/ui';
import { repositorioAuditoria, repositorioInventario, repositorioSesion } from '../../lib/contenedor';
import { pagaLaEmpresa } from '../../lib/dominio/auditoria';
import { pluralizar } from '../../lib/dominio/plural';
import { sucursalEnFoco } from '../../lib/dominio/sucursal-en-foco';
import type { Sucursal } from '../../lib/dominio/tipos';
import type { EstadoInventario, ResumenAuditoriaServidor } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { useSucursalAuditada } from '../../lib/sucursal-auditada-contexto';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';

/**
 * ---------------------------------------------------------------------------
 * EL PANEL DE AUDITORÍA EN WEB
 * ---------------------------------------------------------------------------
 * Clon de `auditoria.tsx` con el diseño que aprobó el usuario: encabezado con
 * miga de pan, la tienda y su estado en una banda, y TRES tarjetas en fila --
 * resultado, empresa y acciones.
 *
 * Los números son LOS MISMOS y salen del mismo `resumen()` del servidor. Lo
 * único que cambia es la forma: en el teléfono es una columna que se scrollea;
 * acá entra todo sin bajar, que es lo que permite decidir de un vistazo.
 *
 * ---------------------------------------------------------------------------
 * "CONTEO FINALIZADO" NO VA EN ROJO
 * ---------------------------------------------------------------------------
 * El mockup pintaba ese cartel de rojo. En este sistema el rojo significa
 * falta o peligro -- el faltante, el botón de lacrar -- y justo debajo hay dos
 * bandas rojas que SÍ son plata que se descuenta. Un "todo listo" del mismo
 * color le enseña al ojo que el rojo no significa nada.
 *
 * Acá el cartel toma el color de LO QUE PASA: verde cuando el ciclo cerró,
 * ámbar mientras espera una decisión, gris cuando todavía se cuenta.
 */
const ANCHO_ANGOSTO = 1180;

/**
 * EL TOPE DE ANCHO del contenido, aunque la ventana tenga 1.900.
 *
 * Sin esto cada fila de "etiqueta a la izquierda, número a la derecha" se
 * estira medio metro y hay que barrer la cabeza para juntar el concepto con su
 * cifra -- *"parecen estirados"*. La matriz es la excepción y usa todo el
 * ancho: ahí el ancho de más son columnas, no aire.
 *
 * Va en cada BLOQUE y como ANCHO FIJO, no como porcentaje: el contenedor del
 * scroll se ajusta a su contenido, así que un `width: 100%` adentro se resuelve
 * contra algo que a su vez depende de él y la página terminaba encogida a la
 * mitad. 1.132 = las tres columnas (430 + 330 + 340) más sus dos separaciones.
 */
const TOPE_ANCHO = 1132;

interface EstadoDelCartel {
  titulo: string;
  detalle: string;
  tono: 'ok' | 'atencion' | 'neutro';
}

/**
 * El cartel de estado, derivado del estado REAL del inventario y no de un
 * texto fijo. Son cinco estados en la base y cada uno habilita cosas
 * distintas: decir "listo para aprobación" sobre un inventario que todavía se
 * está contando manda a alguien a una pantalla que lo va a rechazar.
 */
function cartelDe(estado: EstadoInventario | null): EstadoDelCartel {
  if (estado === null) return { titulo: 'Sin inventario abierto', detalle: 'Esta tienda no tiene un inventario en curso.', tono: 'neutro' };
  if (estado === 'en_curso') return { titulo: 'Conteo en curso', detalle: 'Todavía se está contando: los números pueden cambiar.', tono: 'neutro' };
  if (estado === 'ajuste_auditor') return { titulo: 'Ajuste final en curso', detalle: 'Estás fijando los valores definitivos contra el stock.', tono: 'atencion' };
  if (estado === 'conteo_cerrado') return { titulo: 'Conteo finalizado', detalle: 'Listo para revisión y aprobación.', tono: 'ok' };
  if (estado === 'liquidado') return { titulo: 'Liquidado', detalle: 'La planilla está firme. Falta lacrar.', tono: 'atencion' };
  if (estado === 'lacrado') return { titulo: 'Lacrado', detalle: 'Cerrado y sellado: no se toca más.', tono: 'ok' };
  return { titulo: 'Anulado', detalle: 'Este inventario no produjo resultados.', tono: 'neutro' };
}

export default function PanelAuditoriaWeb(): JSX.Element {
  const { sesion } = useSesion();
  const { width } = useWindowDimensions();
  const angosto = width < ANCHO_ANGOSTO;

  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const { elegida: sucursalElegida, elegir: setSucursalElegida } = useSucursalAuditada();
  const [resumen, setResumen] = useState<ResumenAuditoriaServidor | null>(null);
  const [estado, setEstado] = useState<EstadoInventario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    repositorioSesion.sucursales().then(setSucursales).catch(() => undefined);
  }, []);

  const cargar = useCallback(async () => {
    if (!sesion) return;
    const sucursalId = sucursalEnFoco({
      rol: sesion.colaborador.rol,
      sucursalDeSesion: sesion.sucursal?.id ?? null,
      elegida: sucursalElegida,
    });
    if (sucursalId === null) {
      setResumen(null);
      setEstado(null);
      setCargando(false);
      return;
    }
    setError(null);
    try {
      const activo = await repositorioInventario.activo(sucursalId);
      if (!activo) {
        setResumen(null);
        setEstado(null);
        setCargando(false);
        return;
      }
      setEstado(activo.estado);
      // Solo el resumen: la matriz vive en su propia pantalla desde que se
      // separó, y pedirla acá serían 16 páginas de API para pintar cifras que
      // el servidor ya calcula.
      setResumen(await repositorioAuditoria.resumen(activo.inventarioId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el resumen de auditoría.');
    } finally {
      setCargando(false);
    }
  }, [sesion, sucursalElegida]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!sesion) return <View style={styles.centro} />;

  const sucursalId = sucursalEnFoco({
    rol: sesion.colaborador.rol,
    sucursalDeSesion: sesion.sucursal?.id ?? null,
    elegida: sucursalElegida,
  });
  const cartel = cartelDe(estado);
  const cuadros = resumen?.porClase ?? null;
  const conDiferencia = resumen === null ? 0 : resumen.conFalta + resumen.deEmpresa;

  /** "-S/ 161,70" / "S/ 130,40". El signo lo decide quién llama, no el dato. */
  const monto = (valor: number | undefined, negativo: boolean): string =>
    valor === undefined ? '—' : `${negativo && valor !== 0 ? '-' : ''}S/ ${formatoMoneda(valor)}`;

  return (
    <ScrollView style={styles.pagina} contentContainerStyle={styles.contenido} showsVerticalScrollIndicator={false}>
      <EncabezadoPagina
        migas={['Auditoría', 'Panel de auditoría']}
        titulo="Panel de auditoría"
        sub="Compara los conteos físicos contra el ERP y revisa las diferencias antes de la aprobación."
        onInicio={() => router.push('/auditor')}
      />

      {/* LA TIENDA Y SU ESTADO, en una banda: son el contexto de todo lo de
          abajo. Sin esto, tres tarjetas de números no dicen de qué tienda ni
          de qué momento hablan. */}
      <View style={[styles.banda, angosto && styles.bandaApilada]}>
        <View style={styles.bandaTienda}>
          <ChipIcono icono={Store} />
          <View style={styles.bandaTextos}>
            <Text style={styles.bandaEtiqueta}>Sucursal a auditar</Text>
            <SelectorSucursal
              label=""
              sucursales={sucursales}
              sucursalId={sucursalId}
              onElegir={setSucursalElegida}
            />
            {resumen ? (
              <Text style={styles.bandaSub}>
                {resumen.contados} de {resumen.items} ítems contados · {conDiferencia}{' '}
                {pluralizar(conDiferencia, 'con diferencia', 'con diferencia')}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={[styles.cartel, estilosCartel[cartel.tono]]}>
          <CheckCircle2 size={22} color={tintaCartel[cartel.tono]} />
          <View style={styles.cartelTextos}>
            <Text style={[styles.cartelTitulo, { color: tintaCartel[cartel.tono] }]}>{cartel.titulo}</Text>
            <Text style={styles.cartelDetalle}>{cartel.detalle}</Text>
          </View>
        </View>
      </View>

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : error !== null ? (
        <TarjetaWeb titulo="No se pudo cargar la auditoría" icono={BarChart3} tono="neutro">
          <Text style={styles.error}>{error}</Text>
          <BotonWeb etiqueta="Reintentar" variante="principal" onPress={() => void cargar()} />
        </TarjetaWeb>
      ) : resumen === null ? (
        <TarjetaWeb titulo="Todavía no hay nada para auditar" icono={BarChart3} tono="neutro">
          <Text style={styles.vacio}>
            No hay un inventario en curso en esta sucursal, o el ciclo de conteos no cerró ningún ítem todavía.
          </Text>
        </TarjetaWeb>
      ) : (
        <>
          <View style={[styles.fila, angosto && styles.filaApilada]}>
            <View style={styles.colAncha}>
            <TarjetaWeb titulo="Resultado del conteo" icono={BarChart3}>
              <FilaDato
                etiqueta="Cuadrado"
                valor={`${resumen.cuadrados} de ${resumen.auditables} auditables`}
                color={resumen.cuadrados > 0 ? colors.ok : undefined}
              />
              <FilaDato etiqueta="Faltante del conteo" valor={monto(resumen.valorFaltante, true)} />
              <FilaDato etiqueta="Sobrante del conteo" valor={monto(resumen.valorSobrante, false)} color={colors.ok} />
              <FilaDato etiqueta="Se le descuenta al personal" valor={monto(cuadros?.unidad.valorFaltante, true)} destacada />
              <FilaDato etiqueta="Se audita aparte (paquete)" valor={monto(cuadros?.paquete.valorFaltante, true)} />
              <FilaDato etiqueta="Lo asume la empresa" valor={monto(cuadros?.empresa.valorFaltante, true)} />
            </TarjetaWeb>

            </View>

            <View style={styles.colMedia}>
            <TarjetaWeb titulo="Productos de empresa" icono={Boxes} tono="atencion">
              <FilaDato etiqueta="Productos contados" valor={String(resumen.contadosDeEmpresa)} />
              <FilaDato etiqueta="Faltante" valor={monto(cuadros?.empresa.valorFaltante, true)} />
              <FilaDato etiqueta="Sobrante" valor={monto(cuadros?.empresa.valorSobrante, false)} color={colors.ok} />
              <FilaDato
                etiqueta="Paga la empresa"
                valor={cuadros === null ? '—' : monto(pagaLaEmpresa(cuadros.empresa), true)}
                destacada
              />
            </TarjetaWeb>

            </View>

            <View style={styles.colAcciones}>
            <TarjetaWeb titulo="Acciones" icono={Zap} tono="ok">
              <BotonWeb
                etiqueta="Ir a aprobación y lacrado"
                icono={Lock}
                variante="principal"
                onPress={() => router.push('/auditor/lacrado')}
              />
              <BotonWeb
                etiqueta="Revisar ítem por ítem"
                sub={`${resumen.items} ítems · ${conDiferencia} con diferencia`}
                icono={ClipboardList}
                onPress={() => router.push('/auditor/matriz')}
              />
            </TarjetaWeb>
            </View>
          </View>

          <View style={styles.banner}>
            <BotonWeb
              etiqueta="¿Un conteo quedó mal cargado? Corrígelo — el stock no se toca"
              icono={PencilLine}
              onPress={() => router.push('/auditor/corregir')}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}

const tintaCartel = { ok: colors.ok, atencion: colors.proceso, neutro: colors.gris } as const;

const estilosCartel = StyleSheet.create({
  ok: { backgroundColor: colors.okSuave },
  atencion: { backgroundColor: colors.procesoSuave },
  neutro: { backgroundColor: colors.esperaSuave },
});

const styles = StyleSheet.create({
  pagina: { flex: 1 },
  /**
   * UN TOPE DE ANCHO, aunque la ventana tenga 1.900.
   *
   * Sin esto cada fila de "etiqueta a la izquierda, número a la derecha" se
   * estira medio metro y hay que barrer la cabeza para juntar el concepto con
   * su cifra -- *"parecen estirados"*. La matriz es la excepción y por eso usa
   * todo el ancho: ahí el ancho de más son columnas, no aire.
   *
   * Pegado a la IZQUIERDA y no centrado: la barra lateral ya está a ese lado y
   * el ojo viene de ahí; centrarlo abriría un pasillo vacío entre el menú y el
   * contenido.
   */
  contenido: { padding: spacing.xxl, gap: spacing.lg },
  centro: { flex: 1 },
  cargando: { marginTop: spacing.xxl },

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
  bandaTienda: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bandaTextos: { flex: 1, gap: 2 },
  bandaEtiqueta: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },
  bandaSub: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },

  cartel: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.lg, padding: spacing.md, minWidth: 320 },
  cartelTextos: { flex: 1, gap: 1 },
  cartelTitulo: { fontSize: fontSize.lg, fontFamily: fonts.bold },
  cartelDetalle: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },

  fila: { flexDirection: 'row', gap: spacing.lg, alignItems: 'stretch', width: TOPE_ANCHO, maxWidth: '100%' },
  /**
   * LAS TRES TARJETAS NO MIDEN LO MISMO, y no es capricho: miden lo que
   * necesita su contenido. En tercios iguales, la de Acciones -- dos botones y
   * nada más -- quedaba con medio metro de blanco abajo y los botones
   * estirados de borde a borde. Corrección del usuario: *"parecen estirados"*.
   *
   * La de Resultado es la que más filas tiene, así que se lleva la parte más
   * ancha; la de Acciones toma un ancho fijo, el de sus botones.
   */
  /**
   * ANCHOS FIJOS y no fracciones del ancho disponible.
   *
   * Con `flex: 1` cada tarjeta se estiraba hasta donde diera la ventana, y en
   * un monitor ancho la etiqueta quedaba a medio metro de su cifra. Con una
   * medida propia, una fila se lee de un golpe de vista en cualquier pantalla
   * -- que es de lo que se trata esta tarjeta.
   *
   * La de Resultado es la más ancha porque tiene las etiquetas más largas
   * ("Se le descuenta al personal"); la de Acciones mide lo que miden sus
   * botones.
   */
  // `flexShrink: 0` ademas del ancho: en la web el default de `flexShrink` es
  // 1 (en React Native es 0), asi que sin esto las tarjetas se encogian hasta
  // el tamaño de su texto y el ancho pedido no se respetaba. Es el mismo
  // desencuentro que cortaba los badges de Usuarios.
  /**
   * EL ANCHO VA EN UNA COLUMNA QUE ENVUELVE, no en la tarjeta.
   *
   * `TarjetaWeb` trae `flex: 1` en su estilo base, y en la web ese atajo se
   * traduce a `flex: 1 1 0%`: le gana a cualquier `flexBasis` que se le pase
   * después, así que el ancho pedido se ignoraba y la tarjeta se encogía hasta
   * el tamaño de su texto. Envolviéndola, el ancho lo fija la columna y la
   * tarjeta simplemente la llena.
   *
   * `flexShrink: 0` porque en la web el default es 1 -- en React Native es 0 --
   * y sin eso las columnas también se encogen. Es el mismo desencuentro que
   * cortaba los badges de Usuarios.
   */
  colAncha: { width: 430, flexGrow: 0, flexShrink: 0 },
  colMedia: { width: 330, flexGrow: 0, flexShrink: 0 },
  colAcciones: { width: 340, flexGrow: 0, flexShrink: 0 },
  /** El banner de corregir tampoco cruza la pantalla: un renglón de texto de
   *  1.300px obliga a barrer la cabeza para llegar del ícono al chevron. */
  banner: { maxWidth: 620 },
  filaApilada: { flexDirection: 'column' },

  error: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },
  vacio: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular, lineHeight: 20 },
});
