import { router } from 'expo-router';
import { Store, TrendingDown, TrendingUp } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useRefrescoAlEnfocar } from '../hooks/useRefrescoAlEnfocar';
import { repositorioHistorial, repositorioSesion } from '../../lib/contenedor';
import type { Rol, Sucursal } from '../../lib/dominio/tipos';
import type { ComparativoMensual, PuntoComparativoMensual } from '../../lib/puertos/repositorios';
import { sucursalEnFoco } from '../../lib/dominio/sucursal-en-foco';
import { useSesion } from '../../lib/sesion-contexto';
import { useSucursalAuditada } from '../../lib/sucursal-auditada-contexto';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';
import { formatoMiles, formatoMoneda, formatoPct, MESES_CORTOS, SelectorSucursal } from '../ui';
import { BotonWeb, ChipIcono, EncabezadoPagina, TarjetaWeb } from '../web';
import type { ComparativoScreenProps } from './ComparativoScreen';

/**
 * ---------------------------------------------------------------------------
 * EL COMPARATIVO MENSUAL EN WEB
 * ---------------------------------------------------------------------------
 * Clon de `ComparativoScreen.tsx` con el diseño de la web. El del teléfono no
 * se toca: *"no utilices la misma pantalla del móvil, clónalo y cámbialo, en
 * todo caso son plataformas diferentes"*.
 *
 * LO QUE NO CAMBIA: el mismo `repositorioHistorial.comparativo`, la misma
 * regla de UNA sola sucursal (sin "Todas"), los mismos estados vacíos y los
 * mismos textos. Es un rediseño.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ NADIE HABÍA PODIDO ABRIR ESTA PANTALLA
 * ---------------------------------------------------------------------------
 * No es un problema de esta pantalla ni del navegador: la ruta
 * `/auditor/comparativo` (y también `/administrador/comparativo`) EXISTE y
 * funciona, pero NO está en `components/navegacion/accesos.ts`. Ni la barra
 * lateral de la web ni las tarjetas del Inicio del teléfono la ofrecen, así
 * que solo se llega escribiendo la URL a mano. Arreglarlo es una línea en ese
 * archivo, que es compartido por los cuatro roles y no es de este lote.
 *
 * ---------------------------------------------------------------------------
 * LA TABLA NO ES UNA TARJETA
 * ---------------------------------------------------------------------------
 * `TarjetaWeb` lleva título, y esta tabla no tiene uno en el teléfono. Antes
 * que inventarle un rótulo para poder meterla en una tarjeta, va en su propio
 * marco con los mismos tokens (blanco, borde, radio, sombra). El bloque de
 * períodos excluidos SÍ es una tarjeta, porque sí tiene su título.
 */
const ANCHO_ANGOSTO = 1180;

function periodoLegible(anio: number, mes: number): string {
  return `${MESES_CORTOS[mes - 1]} ${anio}`;
}

export function ComparativoScreen({ rol }: ComparativoScreenProps): JSX.Element {
  const { sesion } = useSesion();
  const { width } = useWindowDimensions();
  const angosto = width < ANCHO_ANGOSTO;

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comparativo, setComparativo] = useState<ComparativoMensual | null>(null);

  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  // El Administrador elige explícitamente (arranca en `null`, sin "Todas"). El
  // Auditor usa la sucursal COMPARTIDA con sus otras pantallas (contexto):
  // cambiarla acá la cambia en Auditoría/Ciclo/Historial/Inicio, y al revés.
  const [filtroSucursalId, setFiltroSucursalId] = useState<number | null>(null);
  const { elegida, elegir } = useSucursalAuditada();

  /**
   * EL PADRÓN, EN CADA REFRESCO Y NO UNA SOLA VEZ AL MONTAR: una tienda recién
   * creada tiene que poder elegirse sin reiniciar. SIN RED NO SE VACÍA -- el
   * `catch` conserva el padrón anterior, porque un selector vacío diría "no hay
   * tiendas" cuando lo que pasó es que no se pudo preguntar.
   */
  const cargarSucursales = useCallback(async () => {
    try {
      setSucursales(await repositorioSesion.sucursales());
    } catch {
      /* se conserva el padrón que ya estaba: ver arriba */
    }
  }, []);

  // La sucursal EFECTIVA: para el Auditor, la del contexto (o su ficha como
  // default inicial); para el Administrador, su elección local. `null` = todavía
  // no hay ninguna -> la pantalla pide elegir, nunca "todas" mezcladas.
  const filtroActivo =
    rol === 'auditor'
      ? sucursalEnFoco({ rol, sucursalDeSesion: sesion?.sucursal?.id ?? null, elegida })
      : filtroSucursalId;

  const cargar = useCallback(async () => {
    if (!sesion) {
      setCargando(false);
      return;
    }
    await cargarSucursales();
    if (filtroActivo === null) {
      // Sin tienda elegida no hay nada honesto que pedir: mostrar "todas"
      // mezcladas es exactamente el dato que miente que esto vino a evitar.
      setCargando(false);
      return;
    }
    setError(null);
    try {
      setComparativo(await repositorioHistorial.comparativo({ sucursalId: filtroActivo }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el comparativo.');
    } finally {
      setCargando(false);
    }
  }, [sesion, filtroActivo, cargarSucursales]);

  // Al enfocar Y al volver la pestaña al frente. En el navegador NO hay "tirar
  // para refrescar" (no existe el gesto): la salida manual es el botón del
  // estado de error, que es donde hace falta.
  const { refrescar } = useRefrescoAlEnfocar(cargar);

  // Cambió la tienda: recargar YA y limpiar la tabla ANTES de que llegue lo
  // nuevo, para no mostrar la serie de otra tienda bajo el nombre nuevo. El
  // primer render lo saltea: esa carga la hace el hook.
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    setComparativo(null);
    setCargando(true);
    void cargar();
  }, [cargar]);

  if (!sesion) return <View style={styles.centro} />;

  // El nombre de la tienda EFECTIVAMENTE mostrada -- nunca "todas": el rótulo
  // tiene que decir exactamente qué se está viendo.
  const nombreSeleccionada =
    filtroActivo === null
      ? null
      : (sucursales.find((s) => s.id === filtroActivo)?.nombre ??
        (filtroActivo === sesion.sucursal?.id ? sesion.sucursal.nombre : null));

  const periodos = comparativo?.serie.length ?? 0;

  return (
    <ScrollView style={styles.pagina} contentContainerStyle={styles.contenido} showsVerticalScrollIndicator={false}>
      <EncabezadoPagina
        migas={[rol === 'auditor' ? 'Auditoría' : 'Historial', 'Comparativo mensual']}
        titulo="Comparativo mensual"
        onInicio={() => router.push(rol === 'auditor' ? '/auditor' : '/administrador')}
      />

      {/* El párrafo de ayuda va como párrafo y no como subtítulo del
          encabezado: son tres frases, y el `sub` del encabezado es de una
          línea. El texto es el MISMO que el del teléfono. */}
      <Text style={styles.ayuda}>
        Serie mes a mes de UNA tienda: faltante neto y % cuadrado, con la variación contra el mes anterior de esa
        misma tienda. Solo entran los meses con asistencia y ajustes ya registrados — los que faltan se listan abajo,
        no se ocultan.
      </Text>

      {/* LA TIENDA es el contexto de todo lo de abajo: sin ella, una tabla de
          montos no dice de qué negocio habla. */}
      <View style={[styles.banda, angosto && styles.bandaApilada]}>
        <View style={styles.bandaTienda}>
          <ChipIcono icono={Store} />
          <View style={styles.bandaTextos}>
            <Text style={styles.bandaEtiqueta}>Sucursal</Text>
            <SelectorSucursal
              label=""
              sucursales={sucursales}
              sucursalId={filtroActivo}
              onElegir={(id) => (rol === 'auditor' ? elegir(id) : setFiltroSucursalId(id))}
            />
            {nombreSeleccionada !== null && !cargando && filtroActivo !== null ? (
              <Text style={styles.bandaSub}>
                {periodos} período{periodos === 1 ? '' : 's'} con datos completos
              </Text>
            ) : null}
          </View>
        </View>
      </View>

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : error ? (
        <TarjetaWeb titulo="No se pudo cargar el comparativo" icono={TrendingUp} tono="neutro">
          <Text style={styles.ayuda}>{error}</Text>
          {/* El único botón rojo de la pantalla. En el teléfono este reintento
              es el gesto de tirar para refrescar, que en el navegador no
              existe -- es la misma recarga, con el control que la web sí
              puede ofrecer. */}
          <BotonWeb etiqueta="Reintentar" variante="principal" onPress={refrescar} />
        </TarjetaWeb>
      ) : filtroActivo === null ? (
        <TarjetaWeb titulo="Elige una tienda" icono={TrendingUp} tono="neutro">
          <Text style={styles.ayuda}>
            El comparativo es por sucursal: mezclar varias en una sola serie compararía meses de negocios distintos.
          </Text>
        </TarjetaWeb>
      ) : !comparativo || comparativo.serie.length === 0 ? (
        <TarjetaWeb titulo="Todavía no hay períodos comparables" icono={TrendingUp} tono="neutro">
          <Text style={styles.ayuda}>
            Hace falta al menos un inventario cerrado con asistencia y ajustes ya cargados.
          </Text>
        </TarjetaWeb>
      ) : (
        <>
          <View style={styles.marco}>
            <View style={styles.filaCabecera}>
              <Text style={[styles.celda, styles.celdaCabecera, styles.colPeriodo]}>Período</Text>
              <Text style={[styles.celda, styles.celdaCabecera, styles.colNumero]}>Ítems</Text>
              <Text style={[styles.celda, styles.celdaCabecera, styles.colCuadrados]}>Cuadrados</Text>
              <Text style={[styles.celda, styles.celdaCabecera, styles.colMonto]}>Faltante neto</Text>
              <Text style={[styles.celda, styles.celdaCabecera, styles.colVariacion]}>Vs. mes anterior</Text>
            </View>
            {/* Cronológico ascendente tal como lo manda el backend
                (compararPeriodos depende de ese orden para la variación) — se
                invierte SOLO acá, para leer la tabla del más reciente para
                abajo, como cualquier registro. */}
            {[...comparativo.serie].reverse().map((p) => (
              <FilaComparativo key={p.inventarioId} punto={p} />
            ))}
          </View>

          {comparativo.excluidos.length > 0 ? (
            <TarjetaWeb titulo="Períodos sin datos completos" icono={TrendingDown} tono="atencion">
              <Text style={styles.ayuda}>
                Existen, pero no entran a la serie porque falta un dato para calcular el faltante neto — no se omiten
                en silencio.
              </Text>
              {comparativo.excluidos.map((e) => (
                <View key={e.inventarioId} style={styles.excluidoFila}>
                  <Text style={styles.excluidoPeriodo}>{e.periodo}</Text>
                  <Text style={styles.excluidoMotivo}>{e.motivo}</Text>
                </View>
              ))}
            </TarjetaWeb>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function FilaComparativo({ punto }: { punto: PuntoComparativoMensual }): JSX.Element {
  const variacion = punto.variacionFaltantePct;
  // Sube el faltante = peor = rojo. Baja = mejor = verde. `null` (primer punto
  // de la serie completa) no tiene con qué compararse — no es ni mejor ni
  // peor, es la ausencia del dato, y va en gris.
  const tonoVariacion =
    variacion === null ? undefined : variacion > 0 ? colors.falta : variacion < 0 ? colors.ok : colors.gris;

  return (
    <View style={styles.fila}>
      <Text style={[styles.celda, styles.colPeriodo, styles.celdaPeriodo]}>
        {periodoLegible(punto.periodoAnio, punto.periodoMes)}
      </Text>
      <Text style={[styles.celda, styles.colNumero]}>{formatoMiles(punto.itemsTotales)}</Text>
      <Text style={[styles.celda, styles.colCuadrados]}>
        {formatoMiles(punto.itemsTotales - punto.itemsConDiferencia)} ({formatoPct(punto.porcentajeCuadrado)}%)
      </Text>
      <Text style={[styles.celda, styles.colMonto, styles.celdaFalta]}>S/ {formatoMoneda(punto.montoFaltanteNeto)}</Text>
      <View style={[styles.celda, styles.colVariacion, styles.celdaVariacion]}>
        {variacion === null ? (
          <Text style={styles.variacionSinDato}>—</Text>
        ) : (
          <>
            {variacion > 0 ? (
              <TrendingUp size={14} color={tonoVariacion} />
            ) : variacion < 0 ? (
              <TrendingDown size={14} color={tonoVariacion} />
            ) : null}
            <Text style={[styles.variacionTexto, tonoVariacion ? { color: tonoVariacion } : null]}>
              {variacion > 0 ? '+' : ''}
              {formatoPct(variacion)}%
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pagina: { flex: 1 },
  contenido: { padding: spacing.xxl, gap: spacing.lg },
  centro: { flex: 1 },
  cargando: { marginTop: spacing.xxl },
  ayuda: { fontSize: fontSize.sm, lineHeight: 20, color: colors.gris, fontFamily: fonts.regular },

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

  marco: {
    backgroundColor: colors.blanco,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borde,
    overflow: 'hidden',
    ...shadow.tarjeta,
  },
  filaCabecera: { flexDirection: 'row', backgroundColor: colors.lienzo, borderBottomWidth: 1, borderBottomColor: colors.borde },
  fila: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borde },
  celda: { paddingVertical: 13, paddingHorizontal: spacing.lg, fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.regular },
  celdaCabecera: {
    paddingVertical: 11,
    fontSize: fontSize.xs,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.gris,
    fontFamily: fonts.bold,
  },
  celdaPeriodo: { fontFamily: fonts.bold },
  celdaFalta: { color: colors.falta, fontFamily: fonts.bold },
  /** Las columnas se reparten el ancho: en un monitor la tabla no es una tira de 500px. */
  colPeriodo: { flex: 1.1, minWidth: 110 },
  colNumero: { flex: 1, minWidth: 96, textAlign: 'right', fontVariant: ['tabular-nums'] },
  colCuadrados: { flex: 1.5, minWidth: 140, textAlign: 'right', fontVariant: ['tabular-nums'] },
  colMonto: { flex: 1.5, minWidth: 140, textAlign: 'right', fontVariant: ['tabular-nums'] },
  colVariacion: { flex: 1.3, minWidth: 130 },
  celdaVariacion: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  variacionTexto: { fontSize: fontSize.sm, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  variacionSinDato: { fontSize: fontSize.sm, color: colors.grisClaro, fontFamily: fonts.regular, textAlign: 'right', width: '100%' },

  excluidoFila: { gap: 1, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borde },
  excluidoPeriodo: { fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.semibold },
  excluidoMotivo: { fontSize: fontSize.xs, lineHeight: 16, color: colors.gris, fontFamily: fonts.regular },
});
