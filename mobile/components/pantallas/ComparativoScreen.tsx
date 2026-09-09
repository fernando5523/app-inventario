import { TrendingDown, TrendingUp } from 'lucide-react-native';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../hooks/useRefrescoAlEnfocar';
import { repositorioHistorial, repositorioSesion } from '../../lib/contenedor';
import type { Rol, Sucursal } from '../../lib/dominio/tipos';
import type { ComparativoMensual, PuntoComparativoMensual } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts } from '../../lib/theme';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';
import { BarraApp, ChipsFiltro, EmptyState, formatoMiles, formatoMoneda, formatoPct, MESES_CORTOS, type OpcionChip } from '../ui';

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
 * SIEMPRE de UNA sola sucursal, sin opción "Todas" (corrección del cliente,
 * 2026-09-09): con el Auditor accediendo ahora a todas las tiendas, pedir
 * "todas" acá mezclaría inventarios de sucursales distintas en una sola
 * serie cronológica -- y "variación contra el mes anterior" terminaría
 * comparando Market Bolívar contra Market Carhuaz sin decirlo. Un dato que
 * miente es peor que no mostrar nada (skill trujillo-ui, "Honestidad de
 * los datos en pantalla"). El backend además agrupa por sucursal antes de
 * calcular la variación (historial.calculos.ts#compararPeriodosPorSucursal)
 * como segunda barrera, pero esta pantalla ni siquiera se lo pide.
 *
 * Los dos roles eligen tienda con el MISMO selector -- el Auditor ya no
 * está recortado a la suya, así que ofrecérselo es una elección con efecto
 * real, no decorativa (ver skill trujillo-ui, sección Filtros). Arranca
 * viendo la suya (evita una pantalla vacía al entrar) pero puede cambiarla.
 */
export function ComparativoScreen({ rol }: ComparativoScreenProps): JSX.Element {
  const { sesion } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comparativo, setComparativo] = useState<ComparativoMensual | null>(null);

  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  // `null` = todavía no se eligió ninguna -- nunca "todas" (ver comentario
  // de arriba). El Administrador arranca en `null` (elige explícitamente);
  // el Auditor arranca en la suya por el efecto de abajo.
  const [filtroSucursalId, setFiltroSucursalId] = useState<number | null>(null);

  // El padrón lo necesitan los dos roles ahora (antes solo el Administrador
  // podía elegir). Es el mismo endpoint del login (`GET /api/sesion/sucursales`),
  // sin gate de permiso.
  useEffect(() => {
    repositorioSesion.sucursales().then(setSucursales);
  }, []);

  // Default del Auditor: SU sucursal, para no abrir la pantalla vacía --
  // pero queda como una selección más, que puede cambiar (ya no es un
  // recorte fijo). Solo la primera vez: si ya eligió otra, no se la pisa.
  useEffect(() => {
    if (rol === 'auditor' && sesion?.sucursal && filtroSucursalId === null) {
      setFiltroSucursalId(sesion.sucursal.id);
    }
  }, [rol, sesion, filtroSucursalId]);

  const cargar = useCallback(async () => {
    if (!sesion || filtroSucursalId === null) {
      // Sin tienda elegida no hay nada honesto que pedir: mostrar "todas"
      // mezcladas es exactamente el dato que miente que esto vino a evitar.
      setCargando(false);
      return;
    }
    setError(null);
    // El spinner de pantalla completa SOLO en la primera carga (el
    // `useState(true)` de arriba lo deja prendido hasta que termine). En un
    // refresco posterior se mantiene la tabla que ya se ve mientras llega el
    // dato nuevo -- taparla con un spinner cada vez que se vuelve a esta
    // pestaña se siente peor que el dato viejo que el refresco viene a
    // arreglar. Ver useRefrescoAlEnfocar.
    try {
      setComparativo(await repositorioHistorial.comparativo({ sucursalId: filtroSucursalId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el comparativo.');
    } finally {
      setCargando(false);
    }
  }, [sesion, filtroSucursalId]);

  // Al enfocar Y al volver la app a primer plano — "cualquier dato
  // actualizado no debe depender de cerrar sesión y volver" (pedido del
  // cliente). Ver components/hooks/useRefrescoAlEnfocar.ts.
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar);

  if (!sesion) return <View />;

  const opcionesSucursal: OpcionChip[] = sucursales.map((s) => ({ id: String(s.id), etiqueta: s.nombre }));
  // El nombre de la tienda EFECTIVAMENTE mostrada -- nunca "todas": el
  // rótulo tiene que decir exactamente qué se está viendo (skill
  // trujillo-ui, "Honestidad de los datos en pantalla").
  const nombreSeleccionada =
    filtroSucursalId === null
      ? null
      : (sucursales.find((s) => s.id === filtroSucursalId)?.nombre ??
        (filtroSucursalId === sesion.sucursal?.id ? sesion.sucursal.nombre : null));

  return (
    <PantallaConTabs
      scrollable
      contentStyle={styles.contenido}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={colors.rojo} colors={[colors.rojo]} />}
    >
      <BarraApp
        rotulo="Comparativo mensual"
        sede={nombreSeleccionada ?? undefined}
        cifras={cargando || filtroSucursalId === null ? undefined : `${comparativo?.serie.length ?? 0} período${comparativo?.serie.length === 1 ? '' : 's'} con datos completos`}
      />

      <Text style={styles.ayuda}>
        Serie mes a mes de UNA tienda: faltante neto y % cuadrado, con la variación contra el mes anterior de esa
        misma tienda. Solo entran los meses con asistencia y ajustes ya registrados — los que faltan se listan abajo,
        no se ocultan.
      </Text>

      <View style={styles.filtroBloque}>
        <Text style={styles.filtroLabel}>Sucursal</Text>
        <ChipsFiltro
          opciones={opcionesSucursal}
          activo={filtroSucursalId === null ? '' : String(filtroSucursalId)}
          onCambiar={(id) => setFiltroSucursalId(Number(id))}
        />
      </View>

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : error ? (
        <View style={styles.tarjeta}>
          <Text style={styles.tarjetaTitulo}>No se pudo cargar el comparativo</Text>
          <Text style={styles.ayuda}>{error}</Text>
        </View>
      ) : filtroSucursalId === null ? (
        <EmptyState
          icon={TrendingUp}
          title="Elige una tienda"
          subtitle="El comparativo es por sucursal: mezclar varias en una sola serie compararía meses de negocios distintos."
        />
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
