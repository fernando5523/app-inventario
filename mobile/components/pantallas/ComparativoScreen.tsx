import { useFocusEffect } from 'expo-router';
import { TrendingDown, TrendingUp } from 'lucide-react-native';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { repositorioHistorial, repositorioSesion } from '../../lib/contenedor';
import type { Rol, Sucursal } from '../../lib/dominio/tipos';
import type { ComparativoMensual, PuntoComparativoMensual } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts } from '../../lib/theme';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';
import { BarraApp, ChipsFiltro, EmptyState, formatoMiles, formatoMoneda, formatoPct, MESES_CORTOS, type OpcionChip } from '../ui';

const TODAS = 'todas';

export interface ComparativoScreenProps {
  rol: Extract<Rol, 'administrador' | 'auditor'>;
}

function periodoLegible(anio: number, mes: number): string {
  return `${MESES_CORTOS[mes - 1]} ${anio}`;
}

/**
 * Comparativo mensual (`GET /api/historial/comparativo`) — el endpoint ya
 * existía en el backend y no lo consumía nadie (historial-como-registro.md,
 * punto 8). Es la respuesta directa a "control mensual": una fila por mes,
 * cifras crudas, nunca un gráfico que las esconda detrás de una curva —
 * un faltante de S/ 1.550 tiene que leerse como el número que es, no como
 * "más o menos ahí" en un eje que nadie etiquetó con precisión.
 *
 * Mismo alcance por rol que HistorialScreen: el Administrador puede elegir
 * sucursal o ver todas, el Auditor recibe siempre la suya (recortado por
 * el backend, el control ni se ofrece acá).
 */
export function ComparativoScreen({ rol }: ComparativoScreenProps): JSX.Element {
  const { sesion } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comparativo, setComparativo] = useState<ComparativoMensual | null>(null);

  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [filtroSucursalId, setFiltroSucursalId] = useState<number | typeof TODAS>(TODAS);

  useEffect(() => {
    if (rol !== 'administrador') return;
    repositorioSesion.sucursales().then(setSucursales);
  }, [rol]);

  const cargar = useCallback(async () => {
    if (!sesion) return;
    setError(null);
    setCargando(true);
    try {
      // El Auditor no manda sucursalId: el backend la resuelve del token y
      // punto -- mandarla igual no cambiaría nada, solo agregaría una
      // decisión que este rol no tiene.
      const sucursalId = rol === 'auditor' ? undefined : filtroSucursalId === TODAS ? undefined : filtroSucursalId;
      setComparativo(await repositorioHistorial.comparativo({ sucursalId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el comparativo.');
    } finally {
      setCargando(false);
    }
  }, [sesion, rol, filtroSucursalId]);

  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar]),
  );

  if (!sesion) return <View />;

  const opcionesSucursal: OpcionChip[] = [
    { id: TODAS, etiqueta: 'Todas' },
    ...sucursales.map((s) => ({ id: String(s.id), etiqueta: s.nombre })),
  ];

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <BarraApp
        rotulo="Comparativo mensual"
        sede={rol === 'auditor' ? sesion.sucursal!.nombre : undefined}
        cifras={cargando ? undefined : `${comparativo?.serie.length ?? 0} período${comparativo?.serie.length === 1 ? '' : 's'} con datos completos`}
      />

      <Text style={styles.ayuda}>
        Serie mes a mes de faltante neto y % cuadrado, con la variación contra el mes anterior. Solo entran los meses
        con asistencia y ajustes ya registrados — los que faltan se listan abajo, no se ocultan.
      </Text>

      {rol === 'administrador' ? (
        <View style={styles.filtroBloque}>
          <Text style={styles.filtroLabel}>Sucursal</Text>
          <ChipsFiltro
            opciones={opcionesSucursal}
            activo={String(filtroSucursalId)}
            onCambiar={(id) => setFiltroSucursalId(id === TODAS ? TODAS : Number(id))}
          />
        </View>
      ) : null}

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : error ? (
        <View style={styles.tarjeta}>
          <Text style={styles.tarjetaTitulo}>No se pudo cargar el comparativo</Text>
          <Text style={styles.ayuda}>{error}</Text>
        </View>
      ) : !comparativo || comparativo.serie.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="Todavía no hay períodos comparables"
          subtitle="Hace falta al menos un inventario cerrado con asistencia y ajustes ya cargados."
        />
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.tabla}>
              <View style={[styles.fila, styles.filaCabecera]}>
                <Text style={[styles.celda, styles.celdaCabecera, styles.colPeriodo]}>Período</Text>
                <Text style={[styles.celda, styles.celdaCabecera, styles.colNumero]}>Ítems</Text>
                <Text style={[styles.celda, styles.celdaCabecera, styles.colNumero]}>Cuadrados</Text>
                <Text style={[styles.celda, styles.celdaCabecera, styles.colMonto]}>Faltante neto</Text>
                <Text style={[styles.celda, styles.celdaCabecera, styles.colVariacion]}>Vs. mes anterior</Text>
              </View>
              {/* Cronológico ascendente tal como lo manda el backend
                  (compararPeriodos depende de ese orden para la variación) —
                  se invierte SOLO acá, para leer la tabla del más reciente
                  para abajo, como cualquier registro. */}
              {[...comparativo.serie].reverse().map((p) => (
                <FilaComparativo key={p.inventarioId} punto={p} />
              ))}
            </View>
          </ScrollView>

          {comparativo.excluidos.length > 0 ? (
            <View style={styles.tarjeta}>
              <Text style={styles.tarjetaTitulo}>Períodos sin datos completos</Text>
              <Text style={styles.ayuda}>
                Existen, pero no entran a la serie porque falta un dato para calcular el faltante neto — no se
                omiten en silencio.
              </Text>
              {comparativo.excluidos.map((e) => (
                <View key={e.inventarioId} style={styles.excluidoFila}>
                  <Text style={styles.excluidoPeriodo}>{e.periodo}</Text>
                  <Text style={styles.excluidoMotivo}>{e.motivo}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
    </PantallaConTabs>
  );
}

function FilaComparativo({ punto }: { punto: PuntoComparativoMensual }): JSX.Element {
  const variacion = punto.variacionFaltantePct;
  // Sube el faltante = peor = rojo. Baja = mejor = verde. `null` (primer
  // punto de la serie completa) no tiene con qué compararse — no es ni
  // mejor ni peor, es la ausencia del dato.
  const tonoVariacion = variacion === null ? undefined : variacion > 0 ? colors.falta : variacion < 0 ? colors.ok : colors.gris;

  return (
    <View style={styles.fila}>
      <Text style={[styles.celda, styles.colPeriodo, styles.celdaPeriodo]}>{periodoLegible(punto.periodoAnio, punto.periodoMes)}</Text>
      <Text style={[styles.celda, styles.colNumero]}>{formatoMiles(punto.itemsTotales)}</Text>
      <Text style={[styles.celda, styles.colNumero]}>
        {formatoMiles(punto.itemsTotales - punto.itemsConDiferencia)} ({formatoPct(punto.porcentajeCuadrado)}%)
      </Text>
      <Text style={[styles.celda, styles.colMonto, styles.celdaFalta]}>S/ {formatoMoneda(punto.montoFaltanteNeto)}</Text>
      <View style={[styles.celda, styles.colVariacion, styles.celdaVariacion]}>
        {variacion === null ? (
          <Text style={styles.variacionSinDato}>—</Text>
        ) : (
          <>
            {variacion > 0 ? <TrendingUp size={13} color={tonoVariacion} /> : variacion < 0 ? <TrendingDown size={13} color={tonoVariacion} /> : null}
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
  contenido: { paddingHorizontal: 14, paddingTop: 8, gap: 14 },
  ayuda: { fontSize: 12.5, lineHeight: 17.5, color: colors.gris, fontFamily: fonts.regular },
  cargando: { marginTop: 24 },

  filtroBloque: { gap: 6 },
  filtroLabel: { fontSize: 11, letterSpacing: 0.5, color: colors.gris, fontFamily: fonts.semibold },

  tarjeta: { gap: 8, padding: 15, backgroundColor: colors.campo, borderWidth: 1, borderColor: colors.borde, borderRadius: 13 },
  tarjetaTitulo: { fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },

  tabla: { borderWidth: 1, borderColor: colors.borde, borderRadius: 11, overflow: 'hidden' },
  fila: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borde },
  filaCabecera: { backgroundColor: colors.esperaSuave, borderBottomWidth: 1.5, borderBottomColor: colors.borde },
  celda: { paddingVertical: 10, paddingHorizontal: 12, fontSize: 12.5, color: colors.tinta, fontFamily: fonts.regular },
  celdaCabecera: { fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.gris, fontFamily: fonts.semibold },
  celdaPeriodo: { fontFamily: fonts.bold },
  celdaFalta: { color: colors.falta, fontFamily: fonts.bold },
  colPeriodo: { width: 96 },
  colNumero: { width: 96, textAlign: 'right' },
  colMonto: { width: 130, textAlign: 'right' },
  colVariacion: { width: 110 },
  celdaVariacion: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  variacionTexto: { fontSize: 12.5, fontFamily: fonts.bold },
  variacionSinDato: { fontSize: 12.5, color: colors.grisClaro, fontFamily: fonts.regular, textAlign: 'right', width: '100%' },

  excluidoFila: { gap: 1, paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.borde },
  excluidoPeriodo: { fontSize: 12.5, color: colors.tinta, fontFamily: fonts.semibold },
  excluidoMotivo: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },
});
