import { Redirect, router } from 'expo-router';
import { BellRing, Inbox } from 'lucide-react-native';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarraAprobador } from '../../components/aprobacion/BarraAprobador';
import { TarjetaSolicitud } from '../../components/aprobacion/TarjetaSolicitud';
import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { ALTO_TAB_BAR } from '../../components/navegacion/tabs';
import { BarraApp, Button, EmptyState, ScreenContainer } from '../../components/ui';
import { esSesionVencida, mensajeParaAprobadora, traerPendientes } from '../../lib/aprobacion/aprobacion-api';
import { resumenPendientes, textoRecordatorio } from '../../lib/aprobacion/presentacion';
import { useAprobador } from '../../lib/aprobacion/sesion-aprobador';
import type { Pendientes } from '../../lib/aprobacion/tipos';
import { colors, fonts, radius, spacing } from '../../lib/theme';

/** Primera pantalla de la aprobadora: lo que espera su decisión, lo más antiguo primero. */
export default function PendientesScreen(): JSX.Element {
  const { sesion, salir } = useAprobador();
  const insets = useSafeAreaInsets();
  const [datos, setDatos] = useState<Pendientes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refrescando, setRefrescando] = useState(false);
  const token = sesion?.token;

  const cargar = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      setDatos(await traerPendientes(token));
      setError(null);
    } catch (e) {
      if (esSesionVencida(e)) {
        salir();
        return;
      }
      setError(mensajeParaAprobadora(e));
    }
  }, [token, salir]);

  useEffect(() => {
    void cargar();
  }, [cargar]);
  useRefrescoAlEnfocar(cargar);

  if (!sesion) return <Redirect href="/aprobador" />;

  const refrescar = async (): Promise<void> => {
    setRefrescando(true);
    await cargar();
    setRefrescando(false);
  };

  const recordatorio = datos ? textoRecordatorio(datos.demoradas) : null;

  return (
    <View style={styles.raiz}>
      <ScreenContainer
        scrollable
        style={{ paddingBottom: ALTO_TAB_BAR + insets.bottom }}
        contentStyle={styles.contenido}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} colors={[colors.rojo]} />}
      >
        <BarraApp
          rotulo="Aprobación de consumo interno"
          sede={sesion.aprobador.nombre}
          cifras={datos ? resumenPendientes(datos.solicitudes.length, datos.demoradas) : '—'}
          onSalir={() => {
            salir();
            router.replace('/aprobador');
          }}
        />

        {recordatorio ? (
          <View style={styles.recordatorio} accessibilityRole="alert">
            <BellRing size={18} color={colors.proceso} />
            <Text style={styles.recordatorioTexto}>{recordatorio}</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.error}>
            <Text style={styles.errorTexto}>{error}</Text>
            <Button label="Reintentar" variant="outline" size="sm" onPress={() => void cargar()} />
          </View>
        ) : null}

        {datos === null && error === null ? <ActivityIndicator color={colors.rojo} style={styles.cargando} /> : null}

        {datos && datos.solicitudes.length === 0 ? (
          <EmptyState icon={Inbox} title="No hay solicitudes por aprobar" subtitle="Cuando una tienda envíe una solicitud, aparecerá aquí." />
        ) : null}

        {datos?.solicitudes.map((s) => (
          <TarjetaSolicitud key={s.id} solicitud={s} modo="pendiente" onAbrir={() => router.push(`/aprobador/solicitud/${encodeURIComponent(s.id)}`)} />
        ))}
      </ScreenContainer>
      <View style={styles.barra}>
        <BarraAprobador activa="/aprobador/pendientes" pendientes={datos?.solicitudes.length ?? null} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: colors.fondo },
  contenido: { padding: spacing.lg, gap: spacing.md },
  barra: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  cargando: { marginTop: spacing.xxxl },
  recordatorio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.procesoSuave,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  recordatorioTexto: { flex: 1, fontFamily: fonts.semibold, fontSize: 13.5, color: colors.proceso },
  error: { gap: spacing.sm, backgroundColor: colors.faltaSuave, borderRadius: radius.md, padding: spacing.md },
  errorTexto: { fontFamily: fonts.medium, fontSize: 13.5, color: colors.falta },
});
