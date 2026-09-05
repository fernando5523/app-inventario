import { useFocusEffect } from 'expo-router';
import { Minus, Plus, Settings, ShieldCheck } from 'lucide-react-native';
import { useCallback, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { Badge, BarraApp, Button, Card, formatoPct } from '../../components/ui';
// Del contenedor: los parámetros del ciclo salen de Postgres y se editan
// acá. Las credenciales de Dynamics NO: se cargan en el servidor con
// `npm run config:dynamics` y esta pantalla solo las muestra. Ver el
// comentario de la tarjeta "Integración con Dynamics" más abajo.
import { repositorioConfig, repositorioConfigDynamics } from '../../lib/contenedor';
import { TAMANOS_HOJA, type ConfigSistema, type TamanoHoja } from '../../lib/dominio/tipos';
import type { EstadoConfigDynamics } from '../../lib/puertos/repositorios';
import { colors, fonts, fontSize, radius } from '../../lib/theme';

/** De dónde salen las credenciales que el backend está usando de verdad. */
const ORIGEN: Record<'base' | 'entorno' | 'ninguno', string> = {
  base: 'Base de datos',
  entorno: 'Variables del servidor (.env)',
  ninguno: 'Sin configurar',
};

const PASO_UMBRAL = 0.05;
const MIN_UMBRAL = 0.05;
const MAX_UMBRAL = 1;
const MIN_CONTEOS = 1;
const MAX_CONTEOS = 5;

export default function ConfiguracionScreen(): JSX.Element {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigSistema | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [dynamics, setDynamics] = useState<EstadoConfigDynamics | null>(null);
  const [probando, setProbando] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [actual, dynamicsActual] = await Promise.all([repositorioConfig.obtener(), repositorioConfigDynamics.obtener()]);
      setConfig(actual);
      setDynamics(dynamicsActual);
    } catch (e) {
      // Sin esto, un fallo acá (sin red, servidor caído) dejaba el spinner
      // girando para siempre: `setCargando(false)` nunca se alcanzaba
      // porque la excepción cortaba la función antes de llegar (mismo bug
      // que f558689 arregló en Inicio/Mis hojas/Contar).
      setError(e instanceof Error ? e.message : 'No se pudo cargar la configuración.');
    } finally {
      setCargando(false);
    }
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

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : error || !config ? (
        <Card style={styles.tarjeta}>
          <Text style={styles.titulo}>No se pudo cargar la configuración</Text>
          <Text style={styles.texto}>{error ?? 'Intentá de nuevo.'}</Text>
          <Button label="Reintentar" onPress={cargar} />
        </Card>
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

          {/* SOLO LECTURA — a propósito.

              Las credenciales de Azure AD se cargan en el SERVIDOR, con
              `npm run config:dynamics` desde backend/. No es una restricción
              caprichosa: un `client_secret` de Azure son 40+ caracteres sin
              sentido, y tipearlos en el teclado de un teléfono produce un
              error que después se diagnostica como "la integración no anda"
              — Azure responde 401 sin decir cuál de los cuatro campos está
              mal.

              Lo que SÍ queda acá es el diagnóstico: de dónde salen las
              credenciales que se están usando y un botón para probarlas
              contra Azure. Sin eso, el Administrador no tendría forma de
              saber por qué el Coordinador no puede traer el catálogo. */}
          <Card style={styles.tarjeta}>
            <View style={styles.tituloFila}>
              <Text style={styles.titulo}>Integración con Dynamics</Text>
              {dynamics?.secretoConfigurado ? <Badge label="Configurado" variant="ok" /> : <Badge label="Sin configurar" variant="espera" />}
            </View>
            <Text style={styles.texto}>
              Se configura en el servidor, no desde el teléfono. Acá se ve qué credenciales está usando el sistema para que el paso 1 del
              Coordinador ("Catálogo de Dynamics") traiga los ítems reales. Solo lectura del catálogo — nunca escribe en Dynamics.
            </Text>

            <View style={styles.datos}>
              <View style={styles.datoFila}>
                <Text style={styles.datoEtiqueta}>Origen</Text>
                <Text style={styles.datoValor}>{ORIGEN[dynamics?.origen ?? 'ninguno']}</Text>
              </View>
              <View style={styles.datoFila}>
                <Text style={styles.datoEtiqueta}>Tenant</Text>
                <Text style={styles.datoValor} numberOfLines={1}>{dynamics?.tenantId || '—'}</Text>
              </View>
              <View style={styles.datoFila}>
                <Text style={styles.datoEtiqueta}>Client ID</Text>
                <Text style={styles.datoValor} numberOfLines={1}>{dynamics?.clientId || '—'}</Text>
              </View>
              <View style={styles.datoFila}>
                <Text style={styles.datoEtiqueta}>URL</Text>
                <Text style={styles.datoValor} numberOfLines={1}>{dynamics?.urlBase || '—'}</Text>
              </View>
              <View style={styles.datoFila}>
                <Text style={styles.datoEtiqueta}>Client secret</Text>
                {/* NUNCA el valor, ni enmascarado. Un secreto que la pantalla
                    puede mostrar es un secreto que alguien puede fotografiar.
                    Esto es lo único que se dice: si hay uno. */}
                <Text style={styles.datoValor}>{dynamics?.secretoConfigurado ? 'Cargado — no se muestra' : 'Falta cargarlo'}</Text>
              </View>
            </View>

            <Button
              label="Probar conexión"
              icon={ShieldCheck}
              variant="outline"
              onPress={probarConexionDynamics}
              disabled={!dynamics?.secretoConfigurado}
              loading={probando}
            />
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
  datos: { gap: 7 },
  datoFila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  datoEtiqueta: { flex: 0, fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
  datoValor: { flex: 1, minWidth: 0, textAlign: 'right', fontSize: 12.5, color: colors.tinta, fontFamily: fonts.semibold },
});
