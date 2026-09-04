import { useFocusEffect } from 'expo-router';
import { Cloud, KeyRound, Link2, Minus, Plus, Settings, ShieldCheck } from 'lucide-react-native';
import { useCallback, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { Badge, BarraApp, Button, CampoTexto, Card, formatoPct } from '../../components/ui';
// Del contenedor: los parámetros del ciclo salen de Postgres; las
// credenciales de Dynamics siguen en memoria porque no hay endpoint (y un
// endpoint que devuelva un client secret es lo que esta pantalla promete
// que nunca va a existir). Cuál es cuál lo decide contenedor.ts, no acá.
import { repositorioConfig, repositorioConfigDynamics } from '../../lib/contenedor';
import { TAMANOS_HOJA, type ConfigSistema, type TamanoHoja } from '../../lib/dominio/tipos';
import type { EstadoConfigDynamics } from '../../lib/puertos/repositorios';
import { colors, fonts, fontSize, radius } from '../../lib/theme';

const PASO_UMBRAL = 0.05;
const MIN_UMBRAL = 0.05;
const MAX_UMBRAL = 1;
const MIN_CONTEOS = 1;
const MAX_CONTEOS = 5;

export default function ConfiguracionScreen(): JSX.Element {
  const [cargando, setCargando] = useState(true);
  const [config, setConfig] = useState<ConfigSistema | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [dynamics, setDynamics] = useState<EstadoConfigDynamics | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [urlBase, setUrlBase] = useState('');
  const [reemplazandoSecreto, setReemplazandoSecreto] = useState(false);
  const [nuevoSecreto, setNuevoSecreto] = useState('');
  const [guardandoDynamics, setGuardandoDynamics] = useState(false);
  const [probando, setProbando] = useState(false);

  const cargar = useCallback(async () => {
    const [actual, dynamicsActual] = await Promise.all([repositorioConfig.obtener(), repositorioConfigDynamics.obtener()]);
    setConfig(actual);
    setDynamics(dynamicsActual);
    setTenantId(dynamicsActual.tenantId);
    setClientId(dynamicsActual.clientId);
    setUrlBase(dynamicsActual.urlBase);
    // Sin nada guardado todavía, no hay "configurado" que mostrar: se
    // arranca directo en modo edición del secreto.
    setReemplazandoSecreto(!dynamicsActual.secretoConfigurado);
    setNuevoSecreto('');
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

  const puedeGuardarDynamics =
    tenantId.trim().length > 0 && clientId.trim().length > 0 && urlBase.trim().length > 0 && (!reemplazandoSecreto || nuevoSecreto.length > 0);

  async function guardarDynamics(): Promise<void> {
    setGuardandoDynamics(true);
    try {
      const actualizado = await repositorioConfigDynamics.guardar({
        tenantId,
        clientId,
        urlBase,
        clientSecret: reemplazandoSecreto ? nuevoSecreto : undefined,
      });
      setDynamics(actualizado);
      setReemplazandoSecreto(false);
      setNuevoSecreto('');
      Alert.alert('Credenciales guardadas', 'El Coordinador ya puede traer el catálogo de esta tienda.');
    } catch (error) {
      Alert.alert('No se pudo guardar', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setGuardandoDynamics(false);
    }
  }

  async function probarConexionDynamics(): Promise<void> {
    setProbando(true);
    try {
      const resultado = await repositorioConfigDynamics.probarConexion();
      Alert.alert(resultado.ok ? 'Conexión correcta' : 'No se pudo conectar', resultado.mensaje);
    } catch (error) {
      Alert.alert('No se pudo probar la conexión', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setProbando(false);
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
              {/* Deshabilitado en el límite, no silenciosamente inerte: un
                  botón que se puede tocar y no hace nada se lee como que la
                  pantalla se colgó. */}
              <Pressable
                style={[styles.stepperBtn, config.conteosDelCiclo <= MIN_CONTEOS && styles.stepperBtnInerte]}
                disabled={config.conteosDelCiclo <= MIN_CONTEOS}
                onPress={() => setConfig({ ...config, conteosDelCiclo: Math.max(MIN_CONTEOS, config.conteosDelCiclo - 1) })}
                accessibilityLabel="Restar un conteo"
              >
                <Minus size={16} color={config.conteosDelCiclo <= MIN_CONTEOS ? colors.grisClaro : colors.tinta} />
              </Pressable>
              <Text style={styles.stepperValor}>{config.conteosDelCiclo}</Text>
              <Pressable
                style={[styles.stepperBtn, config.conteosDelCiclo >= MAX_CONTEOS && styles.stepperBtnInerte]}
                disabled={config.conteosDelCiclo >= MAX_CONTEOS}
                onPress={() => setConfig({ ...config, conteosDelCiclo: Math.min(MAX_CONTEOS, config.conteosDelCiclo + 1) })}
                accessibilityLabel="Sumar un conteo"
              >
                <Plus size={16} color={config.conteosDelCiclo >= MAX_CONTEOS ? colors.grisClaro : colors.tinta} />
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
                style={[styles.stepperBtn, config.umbralMediaUnidad <= MIN_UMBRAL && styles.stepperBtnInerte]}
                disabled={config.umbralMediaUnidad <= MIN_UMBRAL}
                onPress={() => setConfig({ ...config, umbralMediaUnidad: Math.max(MIN_UMBRAL, Number((config.umbralMediaUnidad - PASO_UMBRAL).toFixed(2))) })}
                accessibilityLabel="Bajar el umbral"
              >
                <Minus size={16} color={config.umbralMediaUnidad <= MIN_UMBRAL ? colors.grisClaro : colors.tinta} />
              </Pressable>
              <Text style={styles.stepperValor}>{formatoPct(config.umbralMediaUnidad * 100, 0)}%</Text>
              <Pressable
                style={[styles.stepperBtn, config.umbralMediaUnidad >= MAX_UMBRAL && styles.stepperBtnInerte]}
                disabled={config.umbralMediaUnidad >= MAX_UMBRAL}
                onPress={() => setConfig({ ...config, umbralMediaUnidad: Math.min(MAX_UMBRAL, Number((config.umbralMediaUnidad + PASO_UMBRAL).toFixed(2))) })}
                accessibilityLabel="Subir el umbral"
              >
                <Plus size={16} color={config.umbralMediaUnidad >= MAX_UMBRAL ? colors.grisClaro : colors.tinta} />
              </Pressable>
            </View>
          </Card>

          <Button label="Guardar cambios" icon={Settings} onPress={guardar} loading={guardando} />

          <Card style={styles.tarjeta}>
            <View style={styles.tituloFila}>
              <Text style={styles.titulo}>Integración con Dynamics</Text>
              {dynamics?.secretoConfigurado ? <Badge label="Configurado" variant="ok" /> : <Badge label="Sin configurar" variant="espera" /> }
            </View>
            <Text style={styles.texto}>
              Credenciales de Azure AD para que el paso 1 del Coordinador ("Catálogo de Dynamics") traiga los ítems reales. Solo lectura del
              catálogo — nunca escribe ni ajusta nada en Dynamics.
            </Text>

            <CampoTexto label="Tenant ID" valor={tenantId} onCambiar={setTenantId} icon={Cloud} placeholder="00000000-0000-0000-0000-000000000000" autoCapitalize="none" />
            <CampoTexto label="Client ID" valor={clientId} onCambiar={setClientId} icon={KeyRound} placeholder="00000000-0000-0000-0000-000000000000" autoCapitalize="none" />
            <CampoTexto label="URL base" valor={urlBase} onCambiar={setUrlBase} icon={Link2} placeholder="https://org.crm.dynamics.com" autoCapitalize="none" />

            {reemplazandoSecreto ? (
              <View style={styles.campo}>
                <CampoTexto
                  label="Client secret"
                  valor={nuevoSecreto}
                  onCambiar={setNuevoSecreto}
                  icon={ShieldCheck}
                  placeholder="Pegá el secreto nuevo"
                  autoCapitalize="none"
                  secureTextEntry
                />
                {dynamics?.secretoConfigurado ? (
                  <Pressable
                    onPress={() => {
                      setReemplazandoSecreto(false);
                      setNuevoSecreto('');
                    }}
                  >
                    <Text style={styles.cancelarSecreto}>Cancelar — dejar el secreto ya guardado</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View style={styles.campo}>
                <Text style={styles.label}>Client secret</Text>
                <View style={styles.secretoFila}>
                  <View style={styles.secretoConfiguradoFila}>
                    <ShieldCheck size={18} color={colors.ok} />
                    {/* NUNCA el valor real — un secreto que la pantalla puede
                        mostrar de vuelta es un secreto que alguien puede
                        fotografiar. Esto es lo único que se lee: si HAY uno. */}
                    <Text style={styles.secretoConfiguradoTexto}>Configurado — no se muestra por seguridad</Text>
                  </View>
                  <Button label="Reemplazar" variant="outline" size="sm" onPress={() => setReemplazandoSecreto(true)} />
                </View>
              </View>
            )}

            <View style={styles.accionesDynamics}>
              <Button label="Guardar credenciales" onPress={guardarDynamics} disabled={!puedeGuardarDynamics} loading={guardandoDynamics} style={styles.accionDynamics} />
              <Button
                label="Probar conexión"
                icon={ShieldCheck}
                variant="outline"
                onPress={probarConexionDynamics}
                disabled={!dynamics?.secretoConfigurado}
                loading={probando}
                style={styles.accionDynamics}
              />
            </View>
          </Card>
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
  stepperBtnInerte: { opacity: 0.5 },
  stepperValor: { flex: 1, textAlign: 'center', fontSize: 18, color: colors.tinta, fontFamily: fonts.bold },

  tituloFila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  campo: { gap: 6 },
  label: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.semibold },
  secretoFila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  secretoConfiguradoFila: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  secretoConfiguradoTexto: { flex: 1, minWidth: 0, fontSize: 12.5, color: colors.ok, fontFamily: fonts.semibold },
  cancelarSecreto: { fontSize: 12.5, color: colors.rojo, fontFamily: fonts.regular },
  accionesDynamics: { flexDirection: 'row', gap: 10 },
  accionDynamics: { flex: 1 },
});
