import { router } from 'expo-router';
import { BarChart3 } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
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
import { repositorioAuditoria, repositorioInventario, repositorioSesion } from '../../lib/contenedor';
import { resumirAuditoria } from '../../lib/dominio/auditoria';
import { pluralizar } from '../../lib/dominio/plural';
import { sucursalEnFoco } from '../../lib/dominio/sucursal-en-foco';
import type { ItemAuditoria, Sucursal, VeredictoAuditoria } from '../../lib/dominio/tipos';
import { useSesion } from '../../lib/sesion-contexto';
import { useSucursalAuditada } from '../../lib/sucursal-auditada-contexto';
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

  // El Auditor NO tiene tienda: audita toda la cadena y ELIGE cuál mirar. El
  // padrón de sucursales es el mismo endpoint del login (`GET /api/sesion/
  // sucursales`), sin gate de permiso. `sucursalElegida` null = todavía no
  // eligió (arranca en la de su ficha, ver sucursalEnFoco), cambiable.
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  // COMPARTIDA entre las pantallas del auditor: elegir acá también cambia el
  // Ciclo, el Historial y el Inicio (ver lib/sucursal-auditada-contexto.tsx).
  const { elegida: sucursalElegida, elegir: setSucursalElegida } = useSucursalAuditada();
  useEffect(() => {
    repositorioSesion.sucursales().then(setSucursales);
  }, []);

  const cargar = useCallback(async () => {
    if (!sesion) return;
    const sucursalId = sucursalEnFoco({
      rol: sesion.colaborador.rol,
      sucursalDeSesion: sesion.sucursal?.id ?? null,
      elegida: sucursalElegida,
    });
    // Sin sucursal elegida no hay inventario que pedir. Y al cambiar de
    // sucursal se limpia lo anterior: la matriz de Market Bolívar no puede
    // quedar en pantalla cuando ya se pidió la de Carhuaz.
    if (sucursalId === null) {
      setItems([]);
      setCargando(false);
      return;
    }
    setError(null);
    try {
      const activo = await repositorioInventario.activo(sucursalId);
      if (!activo) {
        setItems([]);
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
  }, [sesion, sucursalElegida]);

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

  // Cambió la sucursal elegida (`cargar` cambia con ella): recargar YA --
  // useRefrescoAlEnfocar solo recarga al enfocar. Y limpiar la matriz ANTES de
  // que llegue la nueva: la barra ya dice la tienda nueva, mostrar los ítems de
  // la anterior sería un número con el apellido equivocado (skill, Honestidad
  // de los datos). El primer render lo saltea (esa carga la hace el hook).
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

  if (!sesion) return <View />;

  // La sucursal EFECTIVA (la elegida, o la de la ficha como default): manda en
  // la barra, en el chip activo y en lo que se pide. Ver sucursalEnFoco.
  const sucursalId = sucursalEnFoco({
    rol: sesion.colaborador.rol,
    sucursalDeSesion: sesion.sucursal?.id ?? null,
    elegida: sucursalElegida,
  });
  const nombreSucursal = sucursales.find((s) => s.id === sucursalId)?.nombre ?? sesion.sucursal?.nombre;
  // Opciones del conjunto REAL (el padrón), en el orden del backend (id asc).
  const opcionesSucursal: OpcionChip[] = sucursales.map((s) => ({ id: String(s.id), etiqueta: s.nombre }));

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  function irALacrado(): void {
    // Va a aprobación y lacrado (app/auditor/lacrado.tsx). La maqueta
    // (auditoria.html) decía "Generar liquidación": la liquidación también es
    // del Auditor desde el 2026-09-11, y se abre desde Inicio ("Liquidación y
    // nómina"), antes del lacrado.
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
        sede={nombreSucursal}
        cifras={cargando ? undefined : `${contados} de ${items.length} ítems contados · ${conDiferencia} con diferencia`}
        onSalir={salir}
      />

      <BandaSync estado="ok" mensaje="Sincronizado" />

      {/* El Auditor no tiene tienda: elige la que audita. Siempre visible
          (también con la matriz vacía), para poder cambiar de sucursal cuando
          la actual no tiene inventario en curso. */}
      <View style={styles.filtroSucursal}>
        <Text style={styles.filtroSucursalLabel}>Sucursal a auditar</Text>
        <ChipsFiltro
          opciones={opcionesSucursal}
          activo={sucursalId === null ? '' : String(sucursalId)}
          onCambiar={(id) => setSucursalElegida(Number(id))}
        />
      </View>

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
                  {/* "del conteo", NO "neto": esta cifra es el faltante que surge de
                      comparar el conteo contra el ERP, ANTES de los ajustes de la
                      liquidación. El neto que se descuenta es otro número y sale de
                      la pantalla de Liquidación (ver la nota de abajo). */}
                  <Text style={styles.resumenEtiqueta}>Faltante del conteo</Text>
                  <Text style={[styles.resumenValor, faltanteNeto !== 0 && { color: colors.proceso }]}>{formatoMoneda(faltanteNeto)}</Text>
                </View>
                <View style={styles.resumenFila}>
                  <Text style={styles.resumenEtiqueta}>Sobrante del conteo</Text>
                  <Text style={[styles.resumenValor, sobranteNeto !== 0 && { color: colors.ok }]}>{formatoMoneda(sobranteNeto)}</Text>
                </View>
                {asumidoEmpresa !== 0 ? (
                  <View style={styles.resumenFila}>
                    <Text style={styles.resumenEtiqueta}>Asumido por la empresa</Text>
                    <Text style={styles.resumenValor}>{formatoMoneda(asumidoEmpresa)}</Text>
                  </View>
                ) : null}
                <Text style={styles.resumenNota}>
                  El monto que se le descuenta a cada persona sale de la Liquidación, que también tiene en cuenta los ajustes del mes y los sobrantes.
                </Text>
              </View>

              <View style={styles.seccion}>
                <Text style={styles.seccionTitulo}>Matriz comparativa</Text>
                <Text style={styles.seccionTotal}>{conDiferencia} {pluralizar(conDiferencia, 'ítem', 'ítems')} con diferencia</Text>
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
  filtroSucursal: { gap: 6 },
  filtroSucursalLabel: { fontSize: 11, letterSpacing: 0.5, color: colors.gris, fontFamily: fonts.semibold },
  cargando: { marginTop: 24 },
  tarjetaResumen: { padding: 15, gap: 10, borderRadius: 13, borderWidth: 1, borderColor: colors.borde, backgroundColor: colors.campo },
  resumenTitulo: { fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
  tarjetaTexto: { fontSize: 12.5, lineHeight: 18, color: colors.gris, fontFamily: fonts.regular },
  resumenFila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  resumenEtiqueta: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
  resumenValor: { fontSize: 16, color: colors.tinta, fontFamily: fonts.bold },
  resumenNeutro: { color: colors.gris },
  resumenPct: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.medium },
  resumenNota: { fontSize: 11.5, lineHeight: 16, color: colors.gris, fontFamily: fonts.regular, marginTop: 2 },
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
