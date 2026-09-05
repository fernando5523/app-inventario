import { router, useFocusEffect } from 'expo-router';
import { ClipboardList, Lock, TriangleAlert, WifiOff } from 'lucide-react-native';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { AvanceFila, BandaSync, BarraApp, Button, EmptyState, TarjetaHoja, sincronizacionDeHojas } from '../../components/ui';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { inventarioIdSinRed, rondaActivaSinRed, ultimaDescarga } from '../../lib/adaptadores/hojas-sqlite';
import { repositorioHojas, repositorioInventario, sincronizador } from '../../lib/contenedor';
import type { HojaConteo } from '../../lib/dominio/tipos';
import type { EstadoCola } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts } from '../../lib/theme';

/**
 * Qué mostrar en la lista vacía — un 401 o un 500 real NO se arreglan
 * reconectando a la WiFi de la tienda, así que cada motivo tiene su propio
 * mensaje en vez de caer todos en el cartel de "sin conexión".
 */
function estadoVacio(motivo: 'sin-red' | 'sesion-vencida' | 'error' | 'incompleta' | null): {
  icon: typeof WifiOff;
  title: string;
  subtitle: string;
} {
  if (motivo === 'sin-red') {
    return {
      icon: WifiOff,
      title: 'Sin conexión',
      subtitle: 'Todavía no se pudieron bajar tus hojas. Conectate a la WiFi de la tienda y volvé a entrar a esta pantalla.',
    };
  }
  if (motivo === 'sesion-vencida') {
    return {
      icon: Lock,
      title: 'Tu sesión venció',
      subtitle: 'Salí (arriba a la derecha) y volvé a entrar con tu PIN para que se puedan bajar tus hojas.',
    };
  }
  if (motivo === 'error') {
    return {
      icon: TriangleAlert,
      title: 'No se pudo conectar con el servidor',
      subtitle: 'Hubo un problema al bajar tus hojas. Volvé a entrar a esta pantalla en un momento.',
    };
  }
  if (motivo === 'incompleta') {
    return {
      icon: TriangleAlert,
      title: 'Descarga incompleta',
      subtitle: 'La descarga de tus hojas se cortó a mitad de camino y no se guardó ninguna. Volvé a entrar a esta pantalla para reintentar.',
    };
  }
  return {
    icon: ClipboardList,
    title: 'Todavía no tenés hojas asignadas',
    subtitle: 'Cuando el coordinador te asigne hojas de este inventario, van a aparecer acá.',
  };
}

export default function MisHojasScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [hojas, setHojas] = useState<HojaConteo[]>([]);
  // Distingue las razones por las que esta pantalla puede terminar en "0
  // hojas" — confundirlas es exactamente la pantalla vacía sin explicación
  // que reportó el cliente, y un 401/500 real no se arregla reconectando a
  // la WiFi de la tienda, así que necesitan un mensaje propio:
  //   - sin red y sin nada bajado todavía → avisar que hace falta señal.
  //   - sesión vencida → decirle que vuelva a entrar con su PIN.
  //   - el servidor respondió mal (500, etc.) → error genérico, reintentar.
  //   - con red y sin error, pero de verdad no tiene ninguna asignada → mensaje neutro.
  const [motivoSinHojas, setMotivoSinHojas] = useState<'sin-red' | 'sesion-vencida' | 'error' | 'incompleta' | null>(null);
  // Caso distinto del de arriba: la descarga se cortó a medias pero SÍ
  // alcanzó a guardar algunas hojas antes del corte — la lista no está
  // vacía (por eso `estadoVacio` no aplica acá), pero mostrarla sin avisar
  // sería dejar creer que esas son TODAS las hojas del lote.
  const [descargaIncompleta, setDescargaIncompleta] = useState(false);
  const [estadoCola, setEstadoCola] = useState<EstadoCola>(sincronizador.estado());
  useEffect(() => sincronizador.suscribir(setEstadoCola), []);

  const cargar = useCallback(async () => {
    if (!sesion) return;
    let inventarioId: number | null;
    let ronda: number | null;
    let sinRedYsinLocal = false;
    try {
      const activo = await repositorioInventario.activo(sesion.sucursal!.id);
      inventarioId = activo?.inventarioId ?? null;
      ronda = activo?.rondaActiva ?? null;
    } catch {
      // Sin red (u otra falla): el avance de hoy puede estar completo en
      // SQLite — se sigue con eso en vez de dejar la lista colgada
      // esperando una respuesta que no va a llegar (ver inventarioIdSinRed
      // en hojas-sqlite.ts).
      inventarioId = await inventarioIdSinRed();
      ronda = inventarioId ? await rondaActivaSinRed(inventarioId) : null;
      sinRedYsinLocal = inventarioId === null;
    }
    if (!inventarioId || ronda === null) {
      setHojas([]);
      // Sin esto, "sin conexión y nunca se descargó nada" caería en el
      // mensaje neutro de "todavía no tenés hojas asignadas" — que invita
      // a esperar a que el coordinador reparta, cuando el problema real es
      // que no hay señal.
      setMotivoSinHojas(sinRedYsinLocal ? 'sin-red' : null);
      setDescargaIncompleta(false);
      setCargando(false);
      return;
    }
    // mias(), NUNCA todas(): un Contador no puede ver el lote entero, ni
    // por accidente. `mias()` ya intenta la descarga inicial sola
    // (hojas-sqlite.ts#descargarSiHaceFalta) — acá solo se lee el
    // resultado, nunca dos veces la misma lógica.
    const mias = await repositorioHojas.mias(inventarioId, ronda);
    setHojas(mias);
    const resultado = ultimaDescarga(inventarioId, 'mias', ronda);
    setMotivoSinHojas(mias.length === 0 && resultado?.ok === false ? resultado.motivo : null);
    // Con hojas para mostrar (mias.length > 0) el corte no deja la lista
    // vacía, así que `motivoSinHojas`/`estadoVacio` no llegan a verse —
    // pero la descarga SÍ se cortó, y sin este aviso las hojas guardadas
    // hasta el corte se ven idénticas a un lote completo.
    setDescargaIncompleta(mias.length > 0 && resultado?.ok === false && resultado.motivo === 'incompleta');
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
  // productos.length, NUNCA tamano: tamano es el tamaño NOMINAL del lote
  // pedido al crear las hojas (20/30/50) — la última hoja de un
  // inventario real queda parcial cuando el catálogo no completa el
  // lote, y eso es correcto. Sumar tamano infla el total (25×50=1.250
  // contra 1.236 ítems reales) y la barra de avance nunca llega al 100%.
  const totalItemsBloque = hojas.reduce((acc, h) => acc + h.productos.length, 0);
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
        <EmptyState {...estadoVacio(motivoSinHojas)} />
      ) : (
        <>
          {descargaIncompleta && (
            <View style={styles.avisoIncompleta}>
              <Text style={styles.avisoIncompletaTexto}>
                Descarga incompleta: se cortó a mitad de camino. Puede faltar alguna hoja.
              </Text>
              <Button label="Reintentar" size="sm" onPress={cargar} />
            </View>
          )}
          <View style={styles.lista}>
            {hojas.map((hoja) => (
              <TarjetaHoja
                key={hoja.id}
                numero={hoja.numero}
                titulo={`${hoja.zona} (Góndola ${hoja.gondola})`}
                estado={hoja.estado}
                contados={hoja.conteos.length}
                total={hoja.productos.length}
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
  avisoIncompleta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 12,
    borderRadius: 11,
    backgroundColor: colors.faltaSuave,
  },
  avisoIncompletaTexto: { flex: 1, fontSize: 12.5, color: colors.falta, fontFamily: fonts.medium },
  pieLista: { padding: 12, borderRadius: 11, backgroundColor: colors.esperaSuave },
  pieTexto: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
  pieFuerte: { color: colors.tinta, fontFamily: fonts.bold },
});
