import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { AvanceFila, BandaSync, BarraApp, TarjetaHoja, sincronizacionDeHojas } from '../../components/ui';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { repositorioHojas, repositorioInventario } from '../../lib/contenedor';
import type { HojaConteo } from '../../lib/dominio/tipos';
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

  const cargar = useCallback(async () => {
    if (!sesion) return;
    const activo = await repositorioInventario.activo(sesion.sucursal.id);
    if (!activo) {
      setHojas([]);
      setCargando(false);
      return;
    }
    // mias(), NUNCA todas(): un Contador no puede ver el lote entero, ni
    // por accidente.
    const mias = await repositorioHojas.mias(activo.inventarioId);
    setHojas(mias);
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
  const sync = sincronizacionDeHojas(hojas);

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <View style={styles.cabeceraHoja}>
        <BarraApp
          rotulo="Mis hojas · 1er conteo"
          sede={sesion.sucursal.nombre}
          cifras={`${hojas.length} hojas · ${totalItemsBloque} ítems · ${enProceso} en proceso`}
          onSalir={salir}
          sinBorde
        />
        <AvanceFila
          texto={`${contadosTotal} / ${totalItemsBloque} ítems contados`}
          porcentaje={totalItemsBloque === 0 ? 0 : (contadosTotal / totalItemsBloque) * 100}
        />
      </View>

      <BandaSync estado={sync.estado} mensaje={sync.mensaje} />

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
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
