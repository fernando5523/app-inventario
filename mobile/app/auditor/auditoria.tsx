import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { BarChart3, ChevronRight, FileSpreadsheet, PencilLine } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import {
  BandaSync,
  BarraApp,
  ChipsFiltro,
  EmptyState,
  SelectorSucursal,
  TarjetaItemAuditoria,
  formatoMoneda as formatoNumeroMoneda,
  type OpcionChip,
} from '../../components/ui';
import { repositorioAuditoria, repositorioHistorial, repositorioInventario, repositorioSesion } from '../../lib/contenedor';
import { cuadroDelItem, resumirAuditoria } from '../../lib/dominio/auditoria';
import { estadoExportacionCuadros, nombreCuadrosDeRespaldo, notaExportacionCuadros } from '../../lib/dominio/exportar-cuadros';
import { pluralizar } from '../../lib/dominio/plural';
import { sucursalEnFoco } from '../../lib/dominio/sucursal-en-foco';
import type { ItemAuditoria, Sucursal, VeredictoAuditoria } from '../../lib/dominio/tipos';
import type { CuadroDeDiferencias, EstadoInventario, ResumenAuditoriaServidor } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { useSucursalAuditada } from '../../lib/sucursal-auditada-contexto';
import { colors, fonts, radius } from '../../lib/theme';

/**
 * LOS FILTROS SIGUEN A LOS CUADROS, no al veredicto de dos vías.
 *
 * Estaban en Todos / Cuadrados / Faltante / Empresa, que es el mundo de antes
 * de que el faltante se repartiera: "Faltante" juntaba en un solo chip lo que
 * se le descuenta al personal y lo que sale por paquetes -- dos cosas que el
 * cliente audita por separado y que en el inventario 8059 son S/20 y S/440.
 *
 * Ahora los tres chips del medio son los tres CUADROS, así que coinciden con
 * la tarjeta de totales de arriba: si esa dice "por paquete: 2 ítems", el chip
 * dice 2 y la lista muestra esos 2.
 */
type FiltroId = 'todos' | 'cuadrado' | 'personal' | 'paquetes' | 'empresa' | 'sin_dato';

const FILTROS: { id: FiltroId; etiqueta: string }[] = [
  { id: 'todos', etiqueta: 'Todos' },
  { id: 'cuadrado', etiqueta: 'Cuadrados' },
  { id: 'personal', etiqueta: 'Al personal' },
  { id: 'paquetes', etiqueta: 'Por paquete' },
  { id: 'empresa', etiqueta: 'Empresa' },
  // Los que todavía no se pueden auditar: sin conteo o sin stock del ERP.
  { id: 'sin_dato', etiqueta: 'Sin dato' },
];

/**
 * Si un ítem entra en un filtro. Los de cuadro salen del REPARTO del servidor
 * (`cuadroDelItem`) y no del veredicto: son ejes distintos, y un ítem con
 * veredicto `falta` puede caer en cualquiera de los dos cuadros.
 */
function coincideFiltro(item: ItemAuditoria, v: VeredictoAuditoria, filtro: Exclude<FiltroId, 'todos'>): boolean {
  if (filtro === 'sin_dato') return v === 'sin_contar' || v === 'sin_erp';
  if (filtro === 'cuadrado') return v === 'cuadrado';
  const cuadro = cuadroDelItem(item.atribucion);
  if (filtro === 'personal') return cuadro === 'personal';
  if (filtro === 'paquetes') return cuadro === 'paquetes';
  return cuadro === 'empresa';
}

/**
 * Panel de auditoría (mobile/design/auditoria.html) — matriz comparativa
 * ERP vs los 3 conteos. Esta pantalla SÍ muestra cifras del ERP a
 * propósito: el conteo ciego aplica a quien CUENTA (app/conteo/contar.tsx),
 * no a quien audita — el Auditor existe justamente para comparar contra
 * Dynamics.
 */
/**
 * Un monto del servidor. `undefined` = todavía no llegó, y ahí va "—", NUNCA
 * "S/ 0,00": un cero inventado sobre un faltante dice "no falta nada", que es
 * una afirmación distinta de "todavía no lo sé".
 */
function montoOSinDato(valor: number | undefined, esFaltante: boolean): string {
  if (valor === undefined) return '—';
  // `formatoNumeroMoneda` (el crudo) y no el `formatoMoneda` de este archivo:
  // ese ya antepone el signo, y acá lo decide `esFaltante` -- el servidor manda
  // los montos SIEMPRE en positivo (ver `CuadroDeDiferencias` en el puerto).
  return `${esFaltante && valor !== 0 ? '-' : ''}S/ ${formatoNumeroMoneda(valor)}`;
}

/**
 * Una fila de cuadro: su total y de cuántos ítems salió. Espeja una de las
 * tablas del Excel de Gilmer, que siempre termina en un total.
 *
 * Muestra faltante y sobrante por separado y NO su resta: en su Excel son dos
 * cuadros distintos, y netearlos escondería que hay 877 de faltante debajo de
 * un neto chico.
 */
function CuadroFila({
  titulo,
  cuadro,
  destacado = false,
}: {
  titulo: string;
  cuadro: CuadroDeDiferencias;
  destacado?: boolean;
}): JSX.Element {
  return (
    <View style={[styles.cuadro, destacado && styles.cuadroDestacado]}>
      <Text style={[styles.cuadroTitulo, destacado && styles.cuadroTituloDestacado]}>{titulo}</Text>
      {cuadro.items === 0 ? (
        // "Nada en este cuadro" es información, no un hueco: significa que
        // ninguna diferencia cayó acá, y eso el Auditor lo quiere saber.
        <Text style={styles.cuadroVacio}>Sin diferencias en este cuadro</Text>
      ) : (
        <>
          <View style={styles.cuadroFila}>
            <Text style={styles.cuadroEtiqueta}>
              Faltante · {cuadro.unidadesFaltantes} {pluralizar(cuadro.unidadesFaltantes, 'unidad', 'unidades')}
            </Text>
            <Text style={[styles.cuadroValor, cuadro.valorFaltante !== 0 && { color: colors.proceso }]}>
              -S/ {formatoNumeroMoneda(cuadro.valorFaltante)}
            </Text>
          </View>
          {cuadro.unidadesSobrantes > 0 ? (
            <View style={styles.cuadroFila}>
              <Text style={styles.cuadroEtiqueta}>
                Sobrante · {cuadro.unidadesSobrantes} {pluralizar(cuadro.unidadesSobrantes, 'unidad', 'unidades')}
              </Text>
              <Text style={[styles.cuadroValor, { color: colors.ok }]}>+S/ {formatoNumeroMoneda(cuadro.valorSobrante)}</Text>
            </View>
          ) : null}
          <Text style={styles.cuadroPie}>
            {cuadro.items} {pluralizar(cuadro.items, 'ítem', 'ítems')}
          </Text>
        </>
      )}
    </View>
  );
}

export default function AuditoriaScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ItemAuditoria[]>([]);
  /**
   * EL RESUMEN DEL SERVIDOR: los montos y los cuadros.
   *
   * Los CONTEOS se siguen resumiendo acá (`resumirAuditoria` sobre la matriz),
   * pero el reparto entre cuadros no se puede hacer desde el teléfono: depende
   * del umbral congelado en el inventario, que no viaja en ninguna respuesta.
   * `null` mientras no llegó, y ahí los montos se muestran como "—": un 0
   * inventado diría "no falta nada".
   */
  const [resumenServidor, setResumenServidor] = useState<ResumenAuditoriaServidor | null>(null);
  const [filtro, setFiltro] = useState<FiltroId>('todos');
  /**
   * EL INVENTARIO EN FOCO, con su estado. Antes solo se usaba el `inventarioId`
   * de `activo()` para pedir la matriz y se descartaba el resto; la descarga de
   * la planilla necesita las dos cosas: el id para pedirla y el ESTADO para
   * decidir si tiene sentido bajarla (ver dominio/exportar-cuadros.ts).
   * `null` = no hay inventario abierto en esta sucursal.
   */
  const [enFoco, setEnFoco] = useState<{ id: number; estado: EstadoInventario } | null>(null);
  const [bajandoPlanilla, setBajandoPlanilla] = useState(false);

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
      setResumenServidor(null);
      setEnFoco(null);
      setCargando(false);
      return;
    }
    setError(null);
    try {
      const activo = await repositorioInventario.activo(sucursalId);
      if (!activo) {
        setItems([]);
        setResumenServidor(null);
        setEnFoco(null);
        setCargando(false);
        return;
      }
      setEnFoco({ id: activo.inventarioId, estado: activo.estado });
      // Las dos en paralelo: no dependen entre sí, y el resumen es el que
      // trae los montos y los cuadros.
      const [matriz, resumen] = await Promise.all([
        repositorioAuditoria.matriz(activo.inventarioId),
        repositorioAuditoria.resumen(activo.inventarioId),
      ]);
      setItems(matriz);
      setResumenServidor(resumen);
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
    setResumenServidor(null);
    // Y el inventario en foco: si no, el botón de la planilla quedaría
    // apuntando al inventario de la tienda ANTERIOR mientras llega la nueva --
    // bajaría el archivo de otra sucursal con la barra diciendo esta.
    setEnFoco(null);
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

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  /**
   * LA PLANILLA DE CUADROS: se baja a un archivo TEMPORAL (caché del teléfono,
   * no Descargas) y de ahí se abre el selector nativo para compartir -- mismo
   * flujo que el export de diferencias del Historial
   * (HistorialScreen#exportarDiferencias), porque el destino es el mismo:
   * WhatsApp o correo, no el teléfono.
   *
   * LA DIFERENCIA está en el nombre: acá viene del servidor
   * (`Content-Disposition`) en vez de rearmarse en el teléfono, porque el panel
   * no tiene el período ni el nombre de la sucursal. Si no viniera, se guarda
   * con un nombre mínimo y HONESTO en vez de un `download.xlsx` -- ver
   * dominio/exportar-cuadros.ts.
   */
  async function bajarPlanillaDeCuadros(): Promise<void> {
    if (!enFoco) return;
    setBajandoPlanilla(true);
    try {
      const puedeCompartir = await Sharing.isAvailableAsync();
      if (!puedeCompartir) {
        Alert.alert('No se puede compartir', 'Este dispositivo no tiene disponible el selector nativo para compartir archivos.');
        return;
      }
      const { bytes, nombreArchivo } = await repositorioHistorial.exportarCuadros(enFoco.id);
      const archivo = new File(Paths.cache, nombreArchivo ?? nombreCuadrosDeRespaldo(enFoco.id));
      if (archivo.exists) archivo.delete();
      archivo.write(new Uint8Array(bytes));
      await Sharing.shareAsync(archivo.uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        // Nombra LA PLANILLA y no "el Excel": el Auditor tiene dos .xlsx de
        // este inventario, y el selector nativo es lo último que ve antes de
        // mandarlo.
        dialogTitle: 'Compartir la planilla de cuadros',
        UTI: 'org.openxmlformats.spreadsheetml.sheet',
      });
    } catch (e) {
      Alert.alert('No se pudo bajar la planilla', e instanceof Error ? e.message : 'Intenta de nuevo.');
    } finally {
      setBajandoPlanilla(false);
    }
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
  const { cuadrados, auditables, contados, sinContar, sinDatoErp, conDiferencia } = resumen;
  /**
   * LOS MONTOS SALEN DEL SERVIDOR, no de `resumen`.
   *
   * `resumirAuditoria` sabe sumar faltantes, pero no sabe repartirlos entre
   * cuadros -- y mostrar su total al lado de los cuadros del servidor daría
   * dos números con el mismo nombre. Acá se usa el local SOLO para los
   * conteos y el `veredictoPorId` del filtro, que el servidor no manda.
   */
  const cuadros = resumenServidor?.porClase ?? null;

  /**
   * SI LA PLANILLA DE CUADROS TIENE SENTIDO HOY, y si no, por qué no. El botón
   * NO desaparece: el Auditor que viene a bajar el archivo que arma a mano
   * tiene que encontrar el camino y leer qué falta, no un hueco (misma lección
   * que el export del Historial, ver dominio/exportar-cuadros.ts).
   *
   * `auditables` y no `items.length`: lo que hace inútil al archivo es no tener
   * con qué comparar, no tener pocos ítems.
   */
  const planilla = enFoco === null ? null : estadoExportacionCuadros(enFoco.estado, resumen.auditables);
  const notaPlanilla = enFoco === null ? null : notaExportacionCuadros(enFoco.estado);
  const planillaBloqueada = planilla !== null && !planilla.puedeExportar;

  const opciones: OpcionChip[] = useMemo(
    () =>
      FILTROS.map((f) => ({
        id: f.id,
        etiqueta: f.etiqueta,
        // Los contadores de los CUADROS salen del resumen del servidor -- los
        // mismos números de la tarjeta de totales. Contarlos acá sobre la
        // matriz daría una segunda cuenta que puede discrepar de la de arriba.
        contador:
          f.id === 'todos'
            ? items.length
            : f.id === 'cuadrado'
              ? resumen.cuadrados
              : f.id === 'sin_dato'
                ? resumen.sinContar + resumen.sinDatoErp
                : f.id === 'personal'
                  ? cuadros?.unidad.items
                  : f.id === 'paquetes'
                    ? cuadros?.paquete.items
                    : cuadros?.empresa.items,
      })),
    [items.length, resumen, cuadros],
  );

  // Filtra usando el veredicto YA CALCULADO en `resumen` (Map, lookup O(1))
  // en vez de volver a llamar `veredicto(it)` por ítem en cada render.
  const visibles = useMemo(
    () =>
      filtro === 'todos'
        ? items
        : items.filter((it) => {
            const v = resumen.veredictoPorId.get(it.productoId);
            return v !== undefined && coincideFiltro(it, v, filtro);
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
      <SelectorSucursal
        label="Sucursal a auditar"
        sucursales={sucursales}
        sucursalId={sucursalId}
        onElegir={setSucursalElegida}
      />

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
                {/*
                  EL BRUTO Y EL DESCONTABLE, SEPARADOS.
                  Se veía solo el bruto, y con 44 de 46 unidades yéndose al
                  cuadro de paquetes "Faltante del conteo -S/460" hacía pensar
                  que se le descontaban S/460 al personal cuando se le
                  descuentan S/20. El número que le importa al Auditor es el
                  segundo, así que va destacado y con su explicación.
                */}
                <View style={styles.resumenFila}>
                  {/* "del conteo", NO "neto": esta cifra es el faltante que surge de
                      comparar el conteo contra el ERP, ANTES de los ajustes de la
                      liquidación. El neto que se descuenta es otro número y sale de
                      la pantalla de Liquidación (ver la nota de abajo). */}
                  <Text style={styles.resumenEtiqueta}>Faltante del conteo (bruto)</Text>
                  <Text style={styles.resumenValor}>{montoOSinDato(resumenServidor?.valorFaltante, true)}</Text>
                </View>
                <View style={[styles.resumenFila, styles.resumenFilaDestacada]}>
                  <Text style={styles.resumenEtiquetaFuerte}>Se le descuenta al personal</Text>
                  <Text style={[styles.resumenValor, styles.resumenValorFuerte]}>
                    {montoOSinDato(resumenServidor?.valorFaltanteDescontable, true)}
                  </Text>
                </View>
                <Text style={styles.resumenNota}>
                  La diferencia entre los dos sale por los cuadros de abajo: lo que va a paquetes se audita aparte y lo
                  que asume la empresa no se le descuenta a nadie.
                </Text>
                <View style={styles.resumenFila}>
                  <Text style={styles.resumenEtiqueta}>Sobrante del conteo</Text>
                  <Text style={[styles.resumenValor, { color: colors.ok }]}>
                    {montoOSinDato(resumenServidor?.valorSobrante, false)}
                  </Text>
                </View>
                <Text style={styles.resumenNota}>
                  El monto que se le descuenta a cada persona sale de la Liquidación, que también tiene en cuenta los ajustes del mes y los sobrantes.
                </Text>
              </View>

              {/*
                LOS CUADROS, como los arma Gilmer a mano.
                Su Excel de julio (hoja FALTANTES) tiene cuatro tablas con su
                total: PRODUCTOS FALTANTES ÚNICOS, FALTANTE POR PAQUETE,
                SOBRANTE POR PAQUETE y los sobrantes únicos, más la hoja
                EMPRESA. Esta tarjeta es eso: dónde cayó cada sol, y cuál de
                los cuatro es el único que toca un sueldo.
              */}
              {cuadros ? (
                <View style={styles.tarjetaResumen}>
                  <Text style={styles.resumenTitulo}>A qué cuadro fue cada diferencia</Text>
                  <CuadroFila
                    titulo="Únicos — se le descuentan al personal"
                    cuadro={cuadros.unidad}
                    destacado
                  />
                  <CuadroFila
                    titulo="Por paquete — se auditan aparte, fuera del descuento"
                    cuadro={cuadros.paquete}
                  />
                  {/* El de empresa solo si tiene algo: un cuadro en cero que
                      aparece siempre le agrega ruido a la pantalla sin decir
                      nada. Los otros dos van siempre porque su ausencia SÍ es
                      información ("no hubo nada por paquete"). */}
                  {cuadros.empresa.items > 0 ? (
                    <CuadroFila titulo="Empresa — los absorbe gerencia" cuadro={cuadros.empresa} />
                  ) : null}
                  <Text style={styles.resumenNota}>
                    Un ítem va entero a un solo cuadro: el faltante no se parte. Lo que cae en “por paquete” se revisa
                    aparte y no entra al descuento del personal.
                  </Text>
                </View>
              ) : null}

              {/*
                EL CAMINO A CORREGIR, DONDE SE ENCUENTRA EL PROBLEMA.
                Esta matriz es el lugar donde el Auditor ve que un ítem no
                cuadra; mandarlo a buscar la pantalla de corrección por el menú
                de Inicio es pedirle que se acuerde de que existe. La pantalla
                de destino explica la regla (se corrige lo CONTADO, el stock no
                se toca) y dice si la ventana ya se cerró.
              */}
              <Pressable
                style={styles.irACorregir}
                onPress={() => router.push('/auditor/corregir')}
                accessibilityRole="button"
                accessibilityLabel="Corregir lo contado"
              >
                <PencilLine size={16} color={colors.tinta} />
                <Text style={styles.irACorregirTexto}>
                  ¿Un conteo quedó mal cargado? Corrígelo — el stock no se toca
                </Text>
                <ChevronRight size={16} color={colors.gris} />
              </Pressable>

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
                  Mostrando {visibles.length} de <Text style={styles.pieFuerte}>{items.length} ítems</Text> · {contados}{' '}
                  {pluralizar(contados, 'contado', 'contados')} · {conDiferencia} con diferencia en total
                </Text>
              </View>

              {/*
                LA PLANILLA DEL CLIENTE, en el paso del cierre donde se la mira.
                Va acá y no en el Historial porque esta pantalla ES los cuatro
                cuadros: el archivo baja los MISMOS números que están arriba, y
                tenerlo al lado del camino a aprobación y lacrado lo pone en el
                orden real del cierre (revisar los cuadros → bajar la planilla →
                lacrar).

                `outline` neutro y no el rojo: la acción principal del pie sigue
                siendo el lacrado. Y cuando no se puede, el botón SE QUEDA
                apagado con el motivo debajo -- que desaparezca deja al Auditor
                buscando un botón que existe.
              */}
              {planilla !== null ? (
                <View style={styles.planilla}>
                  <Pressable
                    style={[styles.planillaBtn, (planillaBloqueada || bajandoPlanilla) && styles.planillaBtnApagado]}
                    onPress={bajarPlanillaDeCuadros}
                    disabled={planillaBloqueada || bajandoPlanilla}
                    accessibilityRole="button"
                    /* El motivo va DENTRO del label: quien usa lector de
                       pantalla tiene que oír por qué no se puede, no solo que
                       el botón está ahí. Sin `accessibilityState.disabled`, que
                       lo saca del árbol de accesibilidad (el bug del modal de
                       ajuste, donde el botón existía y no se lo podía tocar). */
                    accessibilityLabel={
                      planilla.puedeExportar
                        ? 'Descargar la planilla de cuadros en Excel y compartir'
                        : `Descargar la planilla de cuadros: no disponible todavía. ${planilla.motivo}`
                    }
                  >
                    {bajandoPlanilla ? (
                      <ActivityIndicator color={colors.tinta} size="small" />
                    ) : (
                      <FileSpreadsheet size={17} color={planillaBloqueada ? colors.grisClaro : colors.tinta} />
                    )}
                    <Text style={[styles.planillaBtnTexto, planillaBloqueada && styles.planillaBtnTextoApagado]}>
                      Descargar la planilla de cuadros (Excel)
                    </Text>
                  </Pressable>
                  {/* QUÉ SE BAJA, nombrando las hojas y diciendo que NO es la
                      otra exportación: el Auditor tiene dos .xlsx del mismo
                      inventario, y si baja el equivocado lo descubre recién al
                      abrirlo. */}
                  <Text style={styles.planillaAyuda}>
                    Las cuatro hojas del formato mensual: FALTANTES, SOBRANTES, EMPRESA y DESCUENTO. No es la
                    exportación de diferencias del Historial, que baja una sola tabla para analizar.
                  </Text>
                  {planillaBloqueada ? (
                    <Text style={styles.planillaMotivo}>{planilla.motivo}</Text>
                  ) : notaPlanilla !== null ? (
                    <Text style={styles.planillaMotivo}>{notaPlanilla}</Text>
                  ) : null}
                </View>
              ) : null}

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
  resumenNota: { fontSize: 11.5, lineHeight: 16, color: colors.gris, fontFamily: fonts.regular, marginTop: 2 },
  /** Acceso a la corrección: `outline` neutro, no el rojo de acción — la acción principal de esta pantalla sigue siendo el lacrado del pie. */
  irACorregir: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
    backgroundColor: colors.campo,
  },
  irACorregirTexto: { flex: 1, fontSize: 12.5, lineHeight: 17, color: colors.tinta, fontFamily: fonts.semibold },
  cuadro: { gap: 3, padding: 11, borderRadius: radius.md, backgroundColor: colors.esperaSuave },
  /** El de `unidad` es el ÚNICO que toca un sueldo: se destaca con la paleta de atención. */
  cuadroDestacado: { backgroundColor: colors.procesoSuave, borderWidth: 1, borderColor: colors.proceso },
  cuadroTitulo: { fontSize: 12, color: colors.gris, fontFamily: fonts.semibold, lineHeight: 16 },
  cuadroTituloDestacado: { color: colors.tinta, fontFamily: fonts.bold },
  cuadroFila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  cuadroEtiqueta: { flex: 1, fontSize: 12, color: colors.gris, fontFamily: fonts.regular },
  cuadroValor: { fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  cuadroPie: { fontSize: 10.5, color: colors.grisClaro, fontFamily: fonts.regular },
  cuadroVacio: { fontSize: 11.5, color: colors.grisClaro, fontFamily: fonts.regular },

  resumenFilaDestacada: { paddingTop: 7, borderTopWidth: 1, borderTopColor: colors.borde },
  resumenEtiquetaFuerte: { fontSize: 12.5, color: colors.tinta, fontFamily: fonts.bold },
  resumenValorFuerte: { fontSize: 17, color: colors.proceso },

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
  /** La planilla: mismo `outline` neutro que `irACorregir` -- el rojo del pie es la acción principal. */
  planilla: { gap: 7 },
  planillaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minHeight: 46,
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
    backgroundColor: colors.campo,
  },
  /** Apagado, NO invisible: el motivo de abajo explica por qué. */
  planillaBtnApagado: { backgroundColor: colors.esperaSuave, borderColor: colors.esperaSuave },
  planillaBtnTexto: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.tinta, fontFamily: fonts.semibold },
  planillaBtnTextoApagado: { color: colors.grisClaro },
  planillaAyuda: { fontSize: 11.5, lineHeight: 16, color: colors.gris, fontFamily: fonts.regular },
  /** El motivo (o la salvedad): paleta `proceso` de atención, nunca el rojo de marca. */
  planillaMotivo: { fontSize: 11.5, lineHeight: 16, color: colors.proceso, fontFamily: fonts.medium },
  accion: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.rojo },
  accionTexto: { fontSize: 15, color: colors.blanco, fontFamily: fonts.bold },
});
