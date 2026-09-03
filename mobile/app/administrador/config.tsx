import { useFocusEffect } from 'expo-router';
import { Minus, Plus, Settings } from 'lucide-react-native';
import { useCallback, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { BarraApp, Button, Card, formatoPct } from '../../components/ui';
// TEMPORAL: no viene de lib/contenedor.ts a propósito — esta tarea no lo
// toca (lo cambia el agente de integración al enchufar el HTTP real). La
// pantalla solo conoce el tipo del puerto, no el adaptador concreto.
import { configMemoria as repositorioConfig } from '../../lib/adaptadores/config-memoria';
import { TAMANOS_HOJA, type ConfigSistema, type TamanoHoja } from '../../lib/dominio/tipos';
import { colors, fonts, fontSize, radius } from '../../lib/theme';

const PASO_UMBRAL = 0.05;
const MIN_CONTEOS = 1;
const MAX_CONTEOS = 5;

export default function ConfiguracionScreen(): JSX.Element {
  const [cargando, setCargando] = useState(true);
  const [config, setConfig] = useState<ConfigSistema | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const actual = await repositorioConfig.obtener();
    setConfig(actual);
    setCargando(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar]),
  );

  async function guardar(): Promise<void> {
    if (!config) return;
    setGuardando(true);
    try {
      const actualizado = await repositorioConfig.actualizar(config);
      setConfig(actualizado);
      Alert.alert('Configuración guardada', 'Los nuevos valores rigen desde ahora.');
    } catch (error) {
      Alert.alert('No se pudo guardar', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <BarraApp rotulo="Configuración" cifras="Parámetros del sistema" />

      {cargando || !config ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : (
        <>
          <Card style={styles.tarjeta}>
            <Text style={styles.titulo}>Tamaño de hoja por defecto</Text>
            <Text style={styles.texto}>Cuántos ítems entran por hoja al crear un inventario nuevo. El Coordinador puede elegir otro al armar las hojas.</Text>
            <View style={styles.segmentado}>
              {TAMANOS_HOJA.map((tamano, i) => {
                const activo = tamano === config.tamanoHojaDefecto;
                return (
                  <Pressable
                    key={tamano}
                    onPress={() => setConfig({ ...config, tamanoHojaDefecto: tamano as TamanoHoja })}
                    accessibilityRole="button"
                    accessibilityState={{ selected: activo }}
                    style={[styles.segmento, i < TAMANOS_HOJA.length - 1 && styles.segmentoConBorde, activo && styles.segmentoActivo]}
                  >
                    <Text style={[styles.segmentoTexto, activo && styles.segmentoTextoActivo]}>{tamano} ítems</Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          <Card style={styles.tarjeta}>
            <Text style={styles.titulo}>Conteos del ciclo</Text>
            <Text style={styles.texto}>Cuántas pasadas tiene el ciclo de conteo (hoy: 1er conteo + 2 reconteos = 3).</Text>
            <View style={styles.stepper}>
              <Pressable
                style={styles.stepperBtn}
                onPress={() => setConfig({ ...config, conteosDelCiclo: Math.max(MIN_CONTEOS, config.conteosDelCiclo - 1) })}
                accessibilityLabel="Restar un conteo"
              >
                <Minus size={16} color={colors.tinta} />
              </Pressable>
              <Text style={styles.stepperValor}>{config.conteosDelCiclo}</Text>
              <Pressable
                style={styles.stepperBtn}
                onPress={() => setConfig({ ...config, conteosDelCiclo: Math.min(MAX_CONTEOS, config.conteosDelCiclo + 1) })}
                accessibilityLabel="Sumar un conteo"
              >
                <Plus size={16} color={colors.tinta} />
              </Pressable>
            </View>
          </Card>

          <Card style={styles.tarjeta}>
            <Text style={styles.titulo}>Umbral de media unidad de paquete</Text>
            <Text style={styles.texto}>
              Desde qué fracción del paquete una diferencia se descuenta por paquete completo en vez de por unidad suelta ("mitad del
              paquete más uno" — hoy lo define el Auditor caso por caso, esto es el default).
            </Text>
            <View style={styles.stepper}>
              <Pressable
                style={styles.stepperBtn}
                onPress={() => setConfig({ ...config, umbralMediaUnidad: Math.max(PASO_UMBRAL, Number((config.umbralMediaUnidad - PASO_UMBRAL).toFixed(2))) })}
                accessibilityLabel="Bajar el umbral"
              >
                <Minus size={16} color={colors.tinta} />
              </Pressable>
              <Text style={styles.stepperValor}>{formatoPct(config.umbralMediaUnidad * 100, 0)}%</Text>
              <Pressable
                style={styles.stepperBtn}
                onPress={() => setConfig({ ...config, umbralMediaUnidad: Math.min(1, Number((config.umbralMediaUnidad + PASO_UMBRAL).toFixed(2))) })}
                accessibilityLabel="Subir el umbral"
              >
                <Plus size={16} color={colors.tinta} />
              </Pressable>
            </View>
          </Card>

          <Button label="Guardar cambios" icon={Settings} onPress={guardar} loading={guardando} />
        </>
      )}
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: 14, paddingTop: 8, gap: 14 },
  cargando: { marginTop: 24 },
  tarjeta: { gap: 10 },
  titulo: { fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
  texto: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular, lineHeight: 17 },
  segmentado: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderColor: colors.rojo,
    borderRadius: radius.md,
    backgroundColor: colors.campo,
    overflow: 'hidden',
  },
  segmento: { flex: 1, paddingVertical: 11, alignItems: 'center' },
  segmentoConBorde: { borderRightWidth: 1.5, borderRightColor: colors.rojo },
  segmentoActivo: { backgroundColor: colors.rojo },
  segmentoTexto: { fontSize: fontSize.sm - 0.5, color: colors.tinta, fontFamily: fonts.bold },
  segmentoTextoActivo: { color: colors.blanco },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.sm,
  },
  stepperValor: { flex: 1, textAlign: 'center', fontSize: 18, color: colors.tinta, fontFamily: fonts.bold },
});
