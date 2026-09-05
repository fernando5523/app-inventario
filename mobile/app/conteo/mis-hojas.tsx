import { router, useFocusEffect } from 'expo-router';
import { ClipboardList, WifiOff } from 'lucide-react-native';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { AvanceFila, BandaSync, BarraApp, EmptyState, TarjetaHoja, sincronizacionDeHojas } from '../../components/ui';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { ultimaDescarga } from '../../lib/adaptadores/hojas-sqlite';
import { repositorioHojas, repositorioInventario, sincronizador } from '../../lib/contenedor';
import type { HojaConteo } from '../../lib/dominio/tipos';
import type { EstadoCola } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts } from '../../lib/theme';

function codigosDeHoja(hoja: HojaConteo): string | undefined {
  // Solo se puede derivar el rango de códigos de la hoja que SÍ tiene
  // catálogo cargado (ver Producto.codigo) — no hay un campo de rango en
  // HojaConteo, y no se inventa una fórmula que el puerto no expone.
  if (hoja.productos.length === 0) return undefined;
  const primero = hoja.productos[0].codigo;
  const ultimo = hoja.productos[hoja.productos.length - 1].codigo;
  return `Códigos ${primero}-${ultimo}`;
}

export default function MisHojasScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [hojas, setHojas] = useState<HojaConteo[]>([]);
  // Distingue las DOS razones muy distintas por las que esta pantalla
  // puede terminar en "0 hojas" — confundirlas es exactamente la pantalla
  // vacía sin explicación que reportó el cliente:
  //   - sin red Y sin nada bajado todavía → avisar que hace falta señal.
  //   - con red, pero de verdad no tiene ninguna asignada → mensaje neutro.
  const [sinRedSinDatos, setSinRedSinDatos] = useState(false);
  const [estadoCola, setEstadoCola] = useState<EstadoCola>(sincronizador.estado());
  useEffect(() => sincronizador.suscribir(setEstadoCola), []);

  const cargar = useCallback(async () => {
    if (!sesion) return;
    const activo = await repositorioInventario.activo(sesion.sucursal!.id);
    if (!activo) {
      setHojas([]);
      setCargando(false);
      return;
    }
    // mias(), NUNCA todas(): un Contador no puede ver el lote entero, ni
    // por accidente. `mias()` ya intenta la descarga inicial sola
    // (hojas-sqlite.ts#descargarSiHaceFalta) — acá solo se lee el
    // resultado, nunca dos veces la misma lógica.
    const mias = await repositorioHojas.mias(activo.inventarioId);
    setHojas(mias);
    setSinRedSinDatos(mias.length === 0 && ultimaDescarga(activo.inventarioId, 'mias')?.ok === false);
    setCargando(false);
  }, [sesion]);

  // useFocusEffect, no useEffect: los tabs quedan montados una vez
  // visitados (React Navigation), así que sin esto esta lista sigue
  // mostrando "En proceso" para una hoja que ya se finalizó en Contar.
  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar]),
  );

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  function abrirHoja(hoja: HojaConteo): void {
    if (hoja.productos.length === 0) {
      Alert.alert('Sin catálogo cargado', `La Hoja #${hoja.numero} todavía no tiene productos cargados.`);
      return;
    }
    router.push({ pathname: '/conteo/contar', params: { numero: hoja.numero } });
  }

  const contadosTotal = hojas.reduce((acc, h) => acc + h.conteos.length, 0);
  const totalItemsBloque = hojas.reduce((acc, h) => acc + h.tamano, 0);
  const enProceso = hojas.filter((h) => h.estado === 'en-proceso').length;
  const finalizadas = hojas.filter((h) => h.estado === 'finalizada').length;
  const pendientes = hojas.filter((h) => h.estado === 'pendiente').length;
  const sync = sincronizacionDeHojas(hojas, estadoCola);

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <View style={styles.cabeceraHoja}>
        <BarraApp
          rotulo="Mis hojas · 1er conteo"
          sede={sesion.sucursal!.nombre}
          cifras={`${hojas.length} hojas · ${totalItemsBloque} ítems · ${enProceso} en proceso`}
          onSalir={salir}
          sinBorde
        />
        <AvanceFila
          texto={`${contadosTotal} / ${totalItemsBloque} ítems contados`}
          porcentaje={totalItemsBloque === 0 ? 0 : (contadosTotal / totalItemsBloque) * 100}
        />
      </View>

      <BandaSync estado={sync.estado} mensaje={sync.mensaje} onSincronizar={() => sincronizador.sincronizar()} />

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : hojas.length === 0 ? (
        sinRedSinDatos ? (
          <EmptyState
            icon={WifiOff}
            title="Sin conexión"
            subtitle="Todavía no se pudieron bajar tus hojas. Conectate a la WiFi de la tienda y volvé a entrar a esta pantalla."
          />
        ) : (
          <EmptyState
            icon={ClipboardList}
            title="Todavía no tenés hojas asignadas"
            subtitle="Cuando el coordinador te asigne hojas de este inventario, van a aparecer acá."
          />
        )
      ) : (
        <>
          <View style={styles.lista}>
            {hojas.map((hoja) => (
              <TarjetaHoja
                key={hoja.id}
                numero={hoja.numero}
                titulo={`${hoja.zona} (Góndola ${hoja.gondola})`}
                codigos={codigosDeHoja(hoja)}
                estado={hoja.estado}
                contados={hoja.conteos.length}
                total={hoja.tamano}
                habilitada={hoja.productos.length > 0}
                onPress={() => abrirHoja(hoja)}
              />
            ))}
          </View>

          <View style={styles.pieLista}>
            <Text style={styles.pieTexto}>
              Mostrando las <Text style={styles.pieFuerte}>{hojas.length} hojas</Text> asignadas · {enProceso} en proceso ·{' '}
              {finalizadas} finalizadas · {pendientes} pendientes
            </Text>
          </View>
        </>
      )}
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: 14, paddingTop: 8, gap: 16 },
  cabeceraHoja: { gap: 13, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.borde },
  cargando: { marginTop: 24 },
  lista: { gap: 10 },
  pieLista: { padding: 12, borderRadius: 11, backgroundColor: colors.esperaSuave },
  pieTexto: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
  pieFuerte: { color: colors.tinta, fontFamily: fonts.bold },
});
