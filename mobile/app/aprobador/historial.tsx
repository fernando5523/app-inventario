import { Redirect, router } from 'expo-router';
import { Filter, History } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarraAprobador } from '../../components/aprobacion/BarraAprobador';
import { ModalFiltrosHistorial } from '../../components/aprobacion/ModalFiltrosHistorial';
import { TarjetaSolicitud } from '../../components/aprobacion/TarjetaSolicitud';
import { ALTO_TAB_BAR } from '../../components/navegacion/tabs';
import { BarraApp, Button, EmptyState, ScreenContainer } from '../../components/ui';
import { esSesionVencida, mensajeParaAprobadora, traerHistorial } from '../../lib/aprobacion/aprobacion-api';
import {
  FILTRO_HISTORIAL_VACIO,
  almacenesDe,
  contarFiltrosHistorial,
  filtrosDeHistorial,
  textoFiltroHistorial,
  textoMostrandoHistorial,
  type FiltroHistorial,
} from '../../lib/aprobacion/presentacion';
import { useAprobador } from '../../lib/aprobacion/sesion-aprobador';
import type { SolicitudResumen } from '../../lib/aprobacion/tipos';
import { colors, fonts, radius, spacing } from '../../lib/theme';

/**
 * Lo ya decidido: registradas, rechazadas y con error. Los filtros viven en un
 * modal (mismo patrón que "Hojas de esta ronda" del Coordinador): en pantalla
 * queda el botón "Filtros" con cuántos hay puestos, y la lista.
 *
 * Periodo, estado y búsqueda van al servidor; el almacén se filtra aquí, con
 * opciones que salen del resultado (regla de la casa: las opciones de un
 * filtro salen del conjunto abierto, no de un catálogo).
 */
export default function HistorialScreen(): JSX.Element {
  const { sesion, salir } = useAprobador();
  const insets = useSafeAreaInsets();
  const [filtro, setFiltro] = useState<FiltroHistorial>(FILTRO_HISTORIAL_VACIO);
  const [modalVisible, setModalVisible] = useState(false);
  const [lista, setLista] = useState<SolicitudResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refrescando, setRefrescando] = useState(false);
  const token = sesion?.token;
  const { periodo, estado, texto } = filtro;

  const cargar = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      const { solicitudes } = await traerHistorial(token, filtrosDeHistorial(periodo, estado, texto));
      setLista(solicitudes);
      setError(null);
    } catch (e) {
      if (esSesionVencida(e)) {
        salir();
        return;
      }
      setError(mensajeParaAprobadora(e));
    }
  }, [token, periodo, estado, texto, salir]);

  useEffect(() => {
    setLista(null);
    void cargar();
  }, [cargar]);

  const almacenes = useMemo(() => almacenesDe(lista ?? []), [lista]);

  // Si el almacén elegido ya no está en el resultado (cambió el periodo), el
  // filtro se limpia solo: nunca queda puesto un filtro sin filas.
  useEffect(() => {
    if (filtro.almacen !== null && lista !== null && !almacenes.some((a) => a.id === filtro.almacen)) {
      setFiltro((f) => ({ ...f, almacen: null }));
    }
  }, [almacenes, filtro.almacen, lista]);

  if (!sesion) return <Redirect href="/aprobador" />;

  const visibles = (lista ?? []).filter((s) => filtro.almacen === null || s.almacenId === filtro.almacen);
  const activos = contarFiltrosHistorial(filtro);

  return (
    <View style={styles.raiz}>
      <ScreenContainer
        scrollable
        style={{ paddingBottom: ALTO_TAB_BAR + insets.bottom }}
        contentStyle={styles.contenido}
        refreshControl={
          <RefreshControl
            refreshing={refrescando}
            onRefresh={async () => {
              setRefrescando(true);
              await cargar();
              setRefrescando(false);
            }}
            colors={[colors.rojo]}
          />
        }
      >
        <BarraApp
          rotulo="Historial de aprobaciones"
          sede={sesion.aprobador.nombre}
          cifras={lista === null ? '—' : textoMostrandoHistorial(visibles.length, lista.length)}
          onSalir={() => {
            salir();
            router.replace('/aprobador');
          }}
        />

        <Pressable
          style={styles.btnFiltros}
          onPress={() => setModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={activos > 0 ? `Filtros, ${activos} activo${activos === 1 ? '' : 's'}` : 'Filtros'}
        >
          <Filter size={17} color={colors.tinta} />
          <View style={styles.btnFiltrosCuerpo}>
            <Text style={styles.btnFiltrosTexto}>Filtros</Text>
            <Text style={styles.btnFiltrosResumen} numberOfLines={1}>
              {textoFiltroHistorial(filtro)}
            </Text>
          </View>
          {activos > 0 ? (
            <View style={styles.filtrosBadge}>
              <Text style={styles.filtrosBadgeTexto}>{activos}</Text>
            </View>
          ) : null}
        </Pressable>

        {error ? (
          <View style={styles.error}>
            <Text style={styles.errorTexto}>{error}</Text>
            <Button label="Reintentar" variant="outline" size="sm" onPress={() => void cargar()} />
          </View>
        ) : null}

        {lista === null && error === null ? <ActivityIndicator color={colors.rojo} style={styles.cargando} /> : null}

        {lista !== null && visibles.length === 0 ? (
          <EmptyState icon={History} title="No hay solicitudes con estos filtros" subtitle="Prueba con otro periodo o limpia los filtros." />
        ) : null}

        {visibles.map((s) => (
          <TarjetaSolicitud key={s.id} solicitud={s} modo="historial" onAbrir={() => router.push(`/aprobador/solicitud/${encodeURIComponent(s.id)}`)} />
        ))}
      </ScreenContainer>

      <View style={styles.barra}>
        <BarraAprobador activa="/aprobador/historial" />
      </View>

      <ModalFiltrosHistorial
        visible={modalVisible}
        almacenes={almacenes}
        filtro={filtro}
        onAplicar={(f) => {
          setFiltro(f);
          setModalVisible(false);
        }}
        onCerrar={() => setModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: colors.fondo },
  contenido: { padding: spacing.lg, gap: spacing.md },
  barra: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  cargando: { marginTop: spacing.xxxl },
  // Mismo botón que "Hojas de esta ronda" (app/coordinador/hojas.tsx).
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
  btnFiltrosCuerpo: { flex: 1, paddingVertical: 6 },
  btnFiltrosTexto: { fontSize: 14, color: colors.tinta, fontFamily: fonts.semibold },
  btnFiltrosResumen: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
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
  error: { gap: spacing.sm, backgroundColor: colors.faltaSuave, borderRadius: radius.md, padding: spacing.md },
  errorTexto: { fontFamily: fonts.medium, fontSize: 13.5, color: colors.falta },
});
