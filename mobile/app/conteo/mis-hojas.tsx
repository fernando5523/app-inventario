import { router } from 'expo-router';
import { ClipboardList, Lock, TriangleAlert, WifiOff } from 'lucide-react-native';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { AvanceFila, BandaSync, BarraApp, Button, EmptyState, TarjetaHoja, sincronizacionDeHojas } from '../../components/ui';
import { cargarSeguro } from '../../lib/adaptadores/_http';
import { inventarioIdSinRed, rondaActivaSinRed, ultimaDescarga } from '../../lib/adaptadores/hojas-sqlite';
import { pluralizar } from '../../lib/dominio/plural';
import { ORDINAL } from '../../lib/dominio/texto-cierre-ronda';
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
      subtitle: 'Todavía no se pudieron bajar tus hojas. Conéctate a la WiFi de la tienda y vuelve a entrar a esta pantalla.',
    };
  }
  if (motivo === 'sesion-vencida') {
    return {
      icon: Lock,
      title: 'Tu sesión venció',
      subtitle: 'Sal (arriba a la derecha) y vuelve a entrar con tu PIN para que se puedan bajar tus hojas.',
    };
  }
  if (motivo === 'error') {
    return {
      icon: TriangleAlert,
      title: 'No se pudo conectar con el servidor',
      subtitle: 'Hubo un problema al bajar tus hojas. Vuelve a entrar a esta pantalla en un momento.',
    };
  }
  if (motivo === 'incompleta') {
    return {
      icon: TriangleAlert,
      title: 'Descarga incompleta',
      subtitle: 'La descarga de tus hojas se cortó a mitad de camino y no se guardó ninguna. Vuelve a entrar a esta pantalla para reintentar.',
    };
  }
  return {
    icon: ClipboardList,
    title: 'Todavía no tienes hojas asignadas',
    subtitle: 'Cuando el coordinador te asigne hojas de este inventario, van a aparecer aquí.',
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
  // La ronda activa que se está mostrando — para el rótulo. Con red sale de
  // activo().rondaActiva; sin red, de rondaActivaSinRed. NUNCA fija en "1er":
  // en la ronda 2 el rótulo tiene que decir "2do conteo".
  const [rondaActual, setRondaActual] = useState<number | null>(null);
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
    setRondaActual(ronda);
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
    //
    // `cargarSeguro`, no un await suelto: bug real (2026-09-10) -- sin
    // envolverlo, un fallo acá (backend caído) escapaba sin control y
    // `setCargando(false)` de más abajo nunca se ejecutaba. La pantalla YA
    // tenía diseñado el motivo 'error' (ver estadoVacio arriba); lo que
    // faltaba era llegar a usarlo.
    const idInventario = inventarioId;
    const rondaActual = ronda;
    let mias: HojaConteo[] = [];
    const error = await cargarSeguro(async () => {
      mias = await repositorioHojas.mias(idInventario, rondaActual);
    });
    setHojas(mias);
    if (error) {
      setMotivoSinHojas('error');
      setDescargaIncompleta(false);
    } else {
      const resultado = ultimaDescarga(idInventario, 'mias', rondaActual);
      setMotivoSinHojas(mias.length === 0 && resultado?.ok === false ? resultado.motivo : null);
      // Con hojas para mostrar (mias.length > 0) el corte no deja la lista
      // vacía, así que `motivoSinHojas`/`estadoVacio` no llegan a verse —
      // pero la descarga SÍ se cortó, y sin este aviso las hojas guardadas
      // hasta el corte se ven idénticas a un lote completo.
      setDescargaIncompleta(mias.length > 0 && resultado?.ok === false && resultado.motivo === 'incompleta');
    }
    setCargando(false);
  }, [sesion]);

  // Enfocar la pantalla Y volver la app a primer plano (el caso que
  // reportó el cliente: el Coordinador cierra una ronda y asigna las
  // hojas de la siguiente con el Contador todavía con la app abierta EN
  // ESTA MISMA pantalla, sin cambiar de tab) -- los dos en un solo hook,
  // con el candado contra solapamiento que evita pedir todo dos veces
  // cuando los dos disparan juntos al desbloquear el teléfono. `refrescar`
  // alimenta el "tirar para refrescar" de abajo.
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar);

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
    // Por hojaId (identidad estable), NO por número: el número se repite en
    // cada ronda y Contar terminaba resolviéndolo contra otra hoja #001 (bug
    // del cliente 2026-09-08).
    router.push({ pathname: '/conteo/contar', params: { hojaId: String(hoja.id) } });
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
    <PantallaConTabs
      scrollable
      contentStyle={styles.contenido}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} colors={[colors.rojo]} tintColor={colors.rojo} />}
    >
      <View style={styles.cabeceraHoja}>
        <BarraApp
          rotulo={`Mis hojas · ${ORDINAL[rondaActual ?? 1]} conteo`}
          sede={sesion.sucursal!.nombre}
          cifras={`${hojas.length} ${pluralizar(hojas.length, 'hoja', 'hojas')} · ${totalItemsBloque} ítems · ${enProceso} en proceso`}
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
              // SIN `titulo`: la tarjeta queda en "Hoja #002" y su avance.
              //
              // Decía "acondicionadores (Góndola 001)", y las dos mitades
              // confunden por el mismo motivo: son SINTÉTICAS. `gondola` no
              // viene del ERP -- Dynamics no sabe dónde está físicamente cada
              // producto, así que crearHojas le copia el número de hoja
              // (inventarios.service.ts). "Góndola 001" no es una góndola: es
              // el número de hoja escrito dos veces. Y `zona` es la categoría
              // dominante del bloque, que en una hoja que cruza dos sectores
              // nombra solo uno.
              //
              // Mismo criterio que el Historial (1045d46, min-2): el número de
              // hoja identifica, lo demás sobra. Los dos campos SIGUEN en el
              // backend y en el modelo -- esto es solo lo que se muestra.
              <TarjetaHoja
                key={hoja.id}
                numero={hoja.numero}
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
              Mostrando {pluralizar(hojas.length, 'la', 'las')}{' '}
              <Text style={styles.pieFuerte}>
                {hojas.length} {pluralizar(hojas.length, 'hoja', 'hojas')}
              </Text>{' '}
              {pluralizar(hojas.length, 'asignada', 'asignadas')} · {enProceso} en proceso ·{' '}
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
