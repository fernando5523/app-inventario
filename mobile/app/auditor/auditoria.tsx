import { router } from 'expo-router';
import { BarChart3 } from 'lucide-react-native';
import { useCallback, useMemo, useState, type JSX } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import {
  BandaSync,
  BarraApp,
  ChipsFiltro,
  EmptyState,
  TarjetaItemAuditoria,
  formatoMoneda as formatoNumeroMoneda,
  type OpcionChip,
} from '../../components/ui';
import { repositorioAuditoria, repositorioInventario } from '../../lib/contenedor';
import { resumirAuditoria } from '../../lib/dominio/auditoria';
import type { ItemAuditoria, VeredictoAuditoria } from '../../lib/dominio/tipos';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, radius } from '../../lib/theme';

type FiltroId = 'todos' | 'cuadrado' | 'falta' | 'empresa' | 'sin_dato';

const FILTROS: { id: FiltroId; etiqueta: string }[] = [
  { id: 'todos', etiqueta: 'Todos' },
  { id: 'cuadrado', etiqueta: 'Cuadrados' },
  { id: 'falta', etiqueta: 'Faltante' },
  { id: 'empresa', etiqueta: 'Empresa' },
  // Los que todavía no se pueden auditar: sin conteo o sin stock del ERP.
  { id: 'sin_dato', etiqueta: 'Sin dato' },
];

/** `sin_dato` junta los dos veredictos de "no sé"; el resto mapea 1 a 1. */
function coincideFiltro(v: VeredictoAuditoria, filtro: Exclude<FiltroId, 'todos'>): boolean {
  if (filtro === 'sin_dato') return v === 'sin_contar' || v === 'sin_erp';
  return v === filtro;
}

function formatoMoneda(valor: number): string {
  const signo = valor < 0 ? '-' : '+';
  return `${signo}S/ ${formatoNumeroMoneda(Math.abs(valor))}`;
}

/**
 * Panel de auditoría (mobile/design/auditoria.html) — matriz comparativa
 * ERP vs los 3 conteos. Esta pantalla SÍ muestra cifras del ERP a
 * propósito: el conteo ciego aplica a quien CUENTA (app/conteo/contar.tsx),
 * no a quien audita — el Auditor existe justamente para comparar contra
 * Dynamics.
 */
export default function AuditoriaScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ItemAuditoria[]>([]);
  const [filtro, setFiltro] = useState<FiltroId>('todos');

  const cargar = useCallback(async () => {
    if (!sesion) return;
    setError(null);
    try {
      const activo = await repositorioInventario.activo(sesion.sucursal!.id);
      if (!activo) {
        setCargando(false);
        return;
      }
      const matriz = await repositorioAuditoria.matriz(activo.inventarioId);
      setItems(matriz);
    } catch (e) {
      // Sin esto, un fallo sin red dejaba el spinner girando para siempre:
      // la excepción cortaba la función antes de llegar al
      // `setCargando(false)` de abajo (mismo bug que f558689 arregló).
      setError(e instanceof Error ? e.message : 'No se pudo cargar la matriz de auditoría.');
    } finally {
      setCargando(false);
    }
  }, [sesion]);

  // Los tabs quedan montados una vez visitados — sin esto, la matriz sigue
  // mostrando datos viejos si el ciclo de conteos avanzó mientras el Auditor
  // estaba en otra pestaña. Ahora también refresca al volver la app del
  // segundo plano, que es el caso que faltaba: el Auditor deja el teléfono
  // sobre el mostrador con la matriz abierta mientras se cierra la ronda.
  // Ver components/hooks/useRefrescoAlEnfocar.ts.
  //
  // Sin `pausado`: esta pantalla no edita nada, solo filtra (y el filtro es
  // estado local que `cargar` no toca).
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar);

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  function irALacrado(): void {
    // El destino correcto para el Auditor es lacrado, no liquidación: en
    // auditoria.html (maqueta) el botón decía "Generar liquidación", pero
    // esa pantalla es del Coordinador — el Auditor cierra el ciclo con
    // aprobación y lacrado (app/auditor/lacrado.tsx).
    router.push('/auditor/lacrado');
  }

  /**
   * UN SOLO recorrido de `items` (hasta 8.000 en el catálogo real), en el
   * dominio: `resumirAuditoria` saca los contadores, los netos en plata Y el
   * mapa de veredictos que usa el filtro. La fuente es la MISMA cuenta que
   * corre el backend (auditoria.calculos.ts), para que la pantalla no vuelva a
   * discrepar del cierre — ese fue el bug: la pantalla recalculaba con una
   * versión vieja que leía un ítem SIN contar como "cuadrado".
   *
   * Las cifras de la cabecera salen de acá, de recorrer `items` completo —
   * nunca de `visibles` (la lista ya filtrada): filtrar por "Faltante" no
   * puede hacer que el encabezado diga "3 de 3 auditados".
   */
  const resumen = useMemo(() => resumirAuditoria(items), [items]);
  const { cuadrados, auditables, contados, sinContar, sinDatoErp, conDiferencia, faltanteNeto, sobranteNeto, asumidoEmpresa } =
    resumen;

  const opciones: OpcionChip[] = useMemo(
    () =>
      FILTROS.map((f) => ({
        id: f.id,
        etiqueta: f.etiqueta,
        contador:
          f.id === 'todos'
            ? items.length
            : f.id === 'cuadrado'
              ? resumen.cuadrados
              : f.id === 'falta'
                ? resumen.conFalta
                : f.id === 'empresa'
                  ? resumen.deEmpresa
                  : resumen.sinContar + resumen.sinDatoErp,
      })),
    [items.length, resumen],
  );

  // Filtra usando el veredicto YA CALCULADO en `resumen` (Map, lookup O(1))
  // en vez de volver a llamar `veredicto(it)` por ítem en cada render.
  const visibles = useMemo(
    () =>
      filtro === 'todos'
        ? items
        : items.filter((it) => {
            const v = resumen.veredictoPorId.get(it.productoId);
            return v !== undefined && coincideFiltro(v, filtro);
          }),
    [items, filtro, resumen],
  );

  return (
    <PantallaConTabs contentStyle={styles.contenido}>
      <BarraApp
        rotulo="Auditoría · Panel de auditoría"
        sede={sesion.sucursal!.nombre}
        cifras={cargando ? undefined : `${contados} de ${items.length} ítems contados · ${conDiferencia} con diferencia`}
        onSalir={salir}
      />

      <BandaSync estado="ok" mensaje="Sincronizado" />

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : error ? (
        <View style={styles.tarjetaResumen}>
          <Text style={styles.resumenTitulo}>No se pudo cargar la auditoría</Text>
          <Text style={styles.tarjetaTexto}>{error}</Text>
          <Pressable style={styles.accion} onPress={cargar}>
            <Text style={styles.accionTexto}>Reintentar</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="Todavía no hay nada para auditar"
          subtitle="No hay un inventario en curso para esta sucursal, o el ciclo de conteos no cerró ningún ítem todavía."
        />
      ) : (
        // FlatList, no ScrollView+map: con el catálogo real (hasta 8.000
        // ítems) un `.map` monta TODAS las tarjetas de una, en el hilo de
        // JS, antes de pintar nada — con el inventario real de 1.230 ítems
        // eso es lo que le daba el ANR al Auditor. FlatList solo monta lo
        // que entra en pantalla (+ el colchón de initialNumToRender/
        // windowSize) y el resto se monta a medida que aparece scrolleando.
        //
        // No puede ir dentro del ScrollView de PantallaConTabs: una lista
        // virtualizada adentro de OTRA lista que también scrollea no
        // virtualiza nada (y React Native tira warning) — por eso
        // `PantallaConTabs` perdió el `scrollable` de acá arriba, y esta
        // FlatList es la única que scrollea. El padding/gap de
        // `styles.contenido` sigue aplicando igual: cuando `scrollable` es
        // false, `ScreenContainer` lo pone en un `View` con `flex: 1` en
        // vez de en el `contentContainerStyle` de un `ScrollView`, y esta
        // FlatList (también `flex: 1`) ocupa ese espacio y scrollea sola.
        <FlatList
          style={styles.flatList}
          data={visibles}
          keyExtractor={(item) => String(item.productoId)}
          renderItem={({ item }) => <TarjetaItemAuditoria item={item} />}
          ItemSeparatorComponent={() => <View style={styles.separador} />}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={colors.rojo} colors={[colors.rojo]} />}
          ListHeaderComponent={
            <View style={styles.headerLista}>
              <View style={styles.tarjetaResumen}>
                <Text style={styles.resumenTitulo}>Resultado del conteo</Text>
                <View style={styles.resumenFila}>
                  <Text style={styles.resumenEtiqueta}>Cuadrado</Text>
                  {/* Denominador = AUDITABLES (con ERP y con conteo), nunca el
                      total: un ítem que nadie contó no entra al "cuadrado X de Y". */}
                  <Text style={[styles.resumenValor, cuadrados > 0 && { color: colors.ok }]}>
                    {cuadrados} <Text style={styles.resumenPct}>de {auditables} auditables</Text>
                  </Text>
                </View>
                {sinContar > 0 ? (
                  <View style={styles.resumenFila}>
                    <Text style={styles.resumenEtiqueta}>Sin contar</Text>
                    {/* Neutro a propósito: un vacío no es ni éxito ni faltante. */}
                    <Text style={[styles.resumenValor, styles.resumenNeutro]}>{sinContar}</Text>
                  </View>
                ) : null}
                {sinDatoErp > 0 ? (
                  <View style={styles.resumenFila}>
                    <Text style={styles.resumenEtiqueta}>Sin dato del ERP</Text>
                    <Text style={[styles.resumenValor, styles.resumenNeutro]}>{sinDatoErp}</Text>
                  </View>
                ) : null}
                <View style={styles.resumenFila}>
                  <Text style={styles.resumenEtiqueta}>Faltante neto</Text>
                  <Text style={[styles.resumenValor, faltanteNeto !== 0 && { color: colors.proceso }]}>{formatoMoneda(faltanteNeto)}</Text>
                </View>
                <View style={styles.resumenFila}>
                  <Text style={styles.resumenEtiqueta}>Sobrante neto</Text>
                  <Text style={[styles.resumenValor, sobranteNeto !== 0 && { color: colors.ok }]}>{formatoMoneda(sobranteNeto)}</Text>
                </View>
                {asumidoEmpresa !== 0 ? (
                  <View style={styles.resumenFila}>
                    <Text style={styles.resumenEtiqueta}>Asumido por la empresa</Text>
                    <Text style={styles.resumenValor}>{formatoMoneda(asumidoEmpresa)}</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.seccion}>
                <Text style={styles.seccionTitulo}>Matriz comparativa</Text>
                <Text style={styles.seccionTotal}>{conDiferencia} ítems con diferencia</Text>
              </View>

              <ChipsFiltro opciones={opciones} activo={filtro} onCambiar={(id) => setFiltro(id as FiltroId)} />
            </View>
          }
          ListFooterComponent={
            <View style={styles.footerLista}>
              <View style={styles.pieLista}>
                <Text style={styles.pieTexto}>
                  Mostrando {visibles.length} de <Text style={styles.pieFuerte}>{items.length} ítems</Text> · {contados} contados · {conDiferencia} con
                  diferencia en total
                </Text>
              </View>

              <Pressable style={styles.accion} onPress={irALacrado}>
                <Text style={styles.accionTexto}>Ir a aprobación y lacrado</Text>
              </Pressable>
            </View>
          }
        />
      )}
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: 14, paddingTop: 8, gap: 16 },
  cargando: { marginTop: 24 },
  tarjetaResumen: { padding: 15, gap: 10, borderRadius: 13, borderWidth: 1, borderColor: colors.borde, backgroundColor: colors.campo },
  resumenTitulo: { fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
  tarjetaTexto: { fontSize: 12.5, lineHeight: 18, color: colors.gris, fontFamily: fonts.regular },
  resumenFila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  resumenEtiqueta: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
  resumenValor: { fontSize: 16, color: colors.tinta, fontFamily: fonts.bold },
  resumenNeutro: { color: colors.gris },
  resumenPct: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.medium },
  seccion: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  seccionTitulo: { fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gris, fontFamily: fonts.semibold },
  seccionTotal: { fontSize: 11.5, color: colors.grisClaro, fontFamily: fonts.regular },
  flatList: { flex: 1 },
  headerLista: { gap: 16, marginBottom: 16 },
  footerLista: { gap: 16, marginTop: 16 },
  separador: { height: 10 },
  pieLista: { padding: 12, borderRadius: 11, backgroundColor: colors.esperaSuave },
  pieTexto: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
  pieFuerte: { color: colors.tinta, fontFamily: fonts.bold },
  accion: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.rojo },
  accionTexto: { fontSize: 15, color: colors.blanco, fontFamily: fonts.bold },
});
