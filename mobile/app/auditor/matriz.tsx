import { router } from 'expo-router';
import { BarChart3, Filter, Search } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import {
  BandaSync,
  BarraApp,
  EmptyState,
  ModalFiltrosMatriz,
  SelectorSucursal,
  TarjetaItemAuditoria,
} from '../../components/ui';
import { repositorioAuditoria, repositorioInventario, repositorioSesion } from '../../lib/contenedor';
import { resumirAuditoria } from '../../lib/dominio/auditoria';
import {
  aplicarFiltroMatriz,
  contarFiltrosActivos,
  FILTRO_MATRIZ_VACIO,
  textoFiltroActivo,
  type FiltroMatriz,
} from '../../lib/dominio/filtro-matriz';
import { pluralizar } from '../../lib/dominio/plural';
import { sucursalEnFoco } from '../../lib/dominio/sucursal-en-foco';
import type { ItemAuditoria, Sucursal } from '../../lib/dominio/tipos';
import { useSesion } from '../../lib/sesion-contexto';
import { useSucursalAuditada } from '../../lib/sucursal-auditada-contexto';
import { colors, fonts, radius } from '../../lib/theme';

/**
 * LA MATRIZ COMPARATIVA, ÍTEM POR ÍTEM — salió del Panel de auditoría el
 * 2026-09-22.
 *
 * POR QUÉ ES UNA PANTALLA APARTE: el panel mezclaba dos tareas distintas.
 * DECIDIR (¿cuánto falta?, ¿a qué cuadro fue?, bajo la planilla, lacro) es
 * mirar cinco cifras y apretar dos botones; REVISAR (¿qué pasó con este
 * producto?) es recorrer hasta 8.000 renglones. Con los 980 ítems reales de
 * Luzuriaga las dos convivían en la misma lista y los botones del cierre
 * quedaban después de las 980 tarjetas: el Auditor preguntó si tenía que
 * scrollearlas todas para llegar, y la respuesta era que sí.
 *
 * ESTA PANTALLA SÍ MUESTRA CIFRAS DEL ERP a propósito: el conteo ciego aplica
 * a quien CUENTA (app/conteo/contar.tsx), no a quien audita — el Auditor
 * existe justamente para comparar contra Dynamics. El permiso de la matriz ya
 * lo resuelve el backend (`auditoria.permisos.ts#validarAccesoALaMatriz`);
 * acá no se decide nada de eso.
 */
export default function MatrizScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ItemAuditoria[]>([]);
  const [filtro, setFiltro] = useState<FiltroMatriz>(FILTRO_MATRIZ_VACIO);
  const [modalFiltrosVisible, setModalFiltrosVisible] = useState(false);

  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  // LA MISMA sucursal compartida que el Panel, el Ciclo, el Historial y el
  // Inicio: entrar acá desde el panel no puede cambiar de tienda por el
  // camino, y elegir otra acá tiene que valer cuando se vuelva.
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
      setItems(await repositorioAuditoria.matriz(activo.inventarioId));
    } catch (e) {
      // Sin esto, un fallo sin red deja el spinner girando para siempre: la
      // excepción corta la función antes del `setCargando(false)` de abajo.
      setError(e instanceof Error ? e.message : 'No se pudo cargar la matriz de auditoría.');
    } finally {
      setCargando(false);
    }
  }, [sesion, sucursalElegida]);

  // Al enfocar y al volver la app a primer plano. Sin `pausado`: esta pantalla
  // no edita nada, y el filtro y la búsqueda son estado local que `cargar` no
  // toca.
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar);

  // Cambió la sucursal (`cargar` cambia con ella): recargar YA, y limpiar la
  // matriz ANTES de que llegue la nueva -- la barra ya dice la tienda nueva, y
  // mostrar los ítems de la anterior sería un número con el apellido
  // equivocado. El primer render lo saltea: esa carga la hace el hook.
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

  /**
   * UN SOLO recorrido de `items` (hasta 8.000): saca los contadores Y el mapa
   * de veredictos que usa el filtro. Es la MISMA cuenta que corre el backend
   * (auditoria.calculos.ts) -- ese fue el bug que la separó: la pantalla
   * recalculaba con una versión vieja que leía un ítem SIN contar como
   * "cuadrado".
   *
   * LOS TRES `useMemo` VAN ARRIBA DEL `if (!sesion)` de más abajo, no después:
   * un hook detrás de un return condicional rompe la regla de los hooks de
   * React (el orden de los hooks tiene que ser el mismo en cada render).
   */
  const resumen = useMemo(() => resumirAuditoria(items), [items]);

  /**
   * LO QUE EL FILTRO DEJA PASAR. Los cinco campos se combinan con Y, y el
   * veredicto ya calculado arriba se le pasa al dominio en vez de recalcularlo
   * por ítem: sobre 980 filas, y en cada render, se nota.
   */
  const visibles = useMemo(
    () => aplicarFiltroMatriz(items, filtro, resumen.veredictoPorId),
    [items, filtro, resumen],
  );

  const filtrosActivos = contarFiltrosActivos(filtro);
  const filtroTexto = textoFiltroActivo(filtro);

  if (!sesion) return <View />;

  const sucursalId = sucursalEnFoco({
    rol: sesion.colaborador.rol,
    sucursalDeSesion: sesion.sucursal?.id ?? null,
    elegida: sucursalElegida,
  });
  const nombreSucursal = sucursales.find((s) => s.id === sucursalId)?.nombre ?? sesion.sucursal?.nombre;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  return (
    <PantallaConTabs contentStyle={styles.contenido}>
      <BarraApp
        rotulo="Auditoría · Matriz comparativa"
        sede={nombreSucursal}
        cifras={
          cargando
            ? undefined
            : `${items.length} ${pluralizar(items.length, 'ítem', 'ítems')} · ${resumen.conDiferencia} con diferencia`
        }
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
        <View style={styles.tarjeta}>
          <Text style={styles.tarjetaTitulo}>No se pudo cargar la matriz</Text>
          <Text style={styles.tarjetaTexto}>{error}</Text>
          <Pressable style={styles.accion} onPress={() => void cargar()}>
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
        // ítems) un `.map` monta TODAS las tarjetas de una, en el hilo de JS,
        // antes de pintar nada -- con el inventario real de 1.230 ítems eso es
        // lo que le daba el ANR al Auditor.
        //
        // No puede ir dentro del ScrollView de PantallaConTabs: una lista
        // virtualizada adentro de OTRA que también scrollea no virtualiza nada
        // (y React Native tira warning) -- por eso esta pantalla NO pasa
        // `scrollable` y esta FlatList es la única que scrollea. El
        // padding/gap de `styles.contenido` sigue aplicando: sin `scrollable`,
        // `ScreenContainer` lo pone en un `View` con `flex: 1`, y esta
        // FlatList (también `flex: 1`) ocupa ese espacio.
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
          // El teclado del buscador no puede comerse el primer toque de una
          // tarjeta: sin esto, el primer tap solo cierra el teclado (el mismo
          // bug del modal de ajuste, donde no se llegaba al botón de guardar).
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={colors.rojo} colors={[colors.rojo]} />
          }
          ListHeaderComponent={
            <View style={styles.header}>
              {/*
                UN BOTON, NO CHIPS NI BUSCADOR SUELTO. Es el mismo cambio que
                ya se hizo en Contar (2026-09-07, decisión del cliente): los
                chips no escalan. Acá eran seis en una fila con scroll
                horizontal, y con la hoja adentro serían veinte opciones más --
                un chip que hay que scrollear para encontrar no se usa. El
                badge dice cuántos campos hay puestos.
              */}
              <Pressable
                style={styles.btnFiltros}
                onPress={() => setModalFiltrosVisible(true)}
                accessibilityRole="button"
                accessibilityLabel={
                  filtrosActivos > 0
                    ? `Filtros, ${filtrosActivos} activo${filtrosActivos === 1 ? '' : 's'}`
                    : 'Filtros'
                }
              >
                <Filter size={17} color={colors.tinta} />
                <Text style={styles.btnFiltrosTexto}>Filtros</Text>
                {filtrosActivos > 0 ? (
                  <View style={styles.filtrosBadge}>
                    <Text style={styles.filtrosBadgeTexto}>{filtrosActivos}</Text>
                  </View>
                ) : null}
              </Pressable>

              {/* QUE ESTA APLICADO, debajo del botón: el badge dice cuántos,
                  esto dice cuáles. Sin esto hay que abrir el modal para saber
                  por qué la lista muestra 3 de 980. */}
              {filtroTexto !== null ? <Text style={styles.filtroActivo}>Filtro: {filtroTexto}</Text> : null}
            </View>
          }
          ListEmptyComponent={
            // La lista completa vacía ya se resolvió arriba (`items.length ===
            // 0`), así que si se llega acá es porque el filtro no dejó nada.
            <EmptyState
              icon={Search}
              title="Ningún ítem entra en este filtro"
              subtitle={
                filtroTexto === null
                  ? 'Cambia de filtro para ver otros ítems.'
                  : `Ninguno de los ${items.length} ítems de este inventario cumple con ${filtroTexto}. Abre Filtros y quita alguno.`
              }
            />
          }
          ListFooterComponent={
            visibles.length === 0 ? null : (
              <View style={styles.pie}>
                {/*
                  EL TOTAL ES EL DEL INVENTARIO, no el del filtro. Si se
                  muestra el del filtro, se dice que es del filtro -- por eso
                  la frase tiene las dos cifras y no una sola.
                */}
                <Text style={styles.pieTexto}>
                  Mostrando {visibles.length} de <Text style={styles.pieFuerte}>{items.length} ítems</Text> ·{' '}
                  {resumen.contados} {pluralizar(resumen.contados, 'contado', 'contados')} · {resumen.conDiferencia} con
                  diferencia en total
                </Text>
              </View>
            )
          }
        />
      )}

      {/* Fuera de la FlatList: es un `Modal` de React Native, se monta sobre
          todo. `onAplicar` es el ÚNICO camino por el que el filtro llega a la
          lista -- la X y el fondo descartan el borrador. */}
      <ModalFiltrosMatriz
        visible={modalFiltrosVisible}
        items={items}
        veredictoPorId={resumen.veredictoPorId}
        filtro={filtro}
        onAplicar={(f) => {
          setFiltro(f);
          setModalFiltrosVisible(false);
        }}
        onCerrar={() => setModalFiltrosVisible(false)}
      />
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: 14, paddingTop: 8, gap: 16 },
  cargando: { marginTop: 24 },
  tarjeta: {
    padding: 15,
    gap: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.borde,
    backgroundColor: colors.campo,
  },
  tarjetaTitulo: {
    fontSize: 14.5,
    color: colors.tinta,
    fontFamily: fonts.bold,
  },
  tarjetaTexto: {
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.gris,
    fontFamily: fonts.regular,
  },
  flatList: { flex: 1 },
  header: { gap: 8, paddingBottom: 12 },
  /** El botón de filtros: MISMO control que el de Contar, con sus medidas. */
  btnFiltros: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borde,
    backgroundColor: colors.campo,
  },
  btnFiltrosTexto: { flex: 1, fontSize: 14, color: colors.tinta, fontFamily: fonts.semibold },
  filtrosBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.rojo,
  },
  filtrosBadgeTexto: { fontSize: 12, color: colors.blanco, fontFamily: fonts.bold },
  /** Qué está aplicado: dato, no acción — gris y sin peso. */
  filtroActivo: { fontSize: 11.5, lineHeight: 16, color: colors.gris, fontFamily: fonts.regular },
  separador: { height: 10 },
  pie: {
    marginTop: 16,
    padding: 12,
    borderRadius: 11,
    backgroundColor: colors.esperaSuave,
  },
  pieTexto: {
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.gris,
    fontFamily: fonts.regular,
  },
  pieFuerte: { color: colors.tinta, fontFamily: fonts.bold },
  accion: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.rojo,
  },
  accionTexto: { fontSize: 15, color: colors.blanco, fontFamily: fonts.bold },
});
