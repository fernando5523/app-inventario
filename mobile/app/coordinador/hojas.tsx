import { router } from 'expo-router';
import { ClipboardList, Filter, Lock, TriangleAlert, WifiOff } from 'lucide-react-native';
import { useCallback, useMemo, useState, type JSX } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import {
  AvanceFila,
  BandaSync,
  BarraApp,
  EmptyState,
  ModalFiltrosHojas,
  TarjetaHoja,
  formatoMiles,
  sincronizacionDeHojas,
} from '../../components/ui';
import { cargarSeguro } from '../../lib/adaptadores/_http';
import { inventarioIdSinRed, rondaActivaSinRed, ultimaDescarga } from '../../lib/adaptadores/hojas-sqlite';
import { repositorioHojas, repositorioInventario, sincronizador } from '../../lib/contenedor';
import {
  contarFiltrosActivosModal,
  FILTRO_HOJAS_MODAL_VACIO,
  filtrarHojasModal,
  textoFiltroModalActivo,
  textoMostrando,
  type FiltroHojasModal,
} from '../../lib/dominio/filtro-hojas';
import { ORDINAL } from '../../lib/dominio/texto-cierre-ronda';
import type { HojaConteo } from '../../lib/dominio/tipos';
import type { EstadoCola } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, radius } from '../../lib/theme';

/**
 * Qué mostrar en la lista vacía — un 401 o un 500 real NO se arreglan
 * reconectando a la WiFi de la tienda, así que cada motivo tiene su propio
 * mensaje en vez de caer todos en el cartel de "sin conexión". Mismo
 * criterio que `app/conteo/mis-hojas.tsx` -- el mensaje "neutro" es el único
 * que cambia (acá no hay nada que "el Coordinador te asigne").
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
      subtitle: 'Todavía no se pudieron bajar las hojas. Conéctate a la WiFi de la tienda y vuelve a entrar a esta pantalla.',
    };
  }
  if (motivo === 'sesion-vencida') {
    return {
      icon: Lock,
      title: 'Tu sesión venció',
      subtitle: 'Sal (arriba a la derecha) y vuelve a entrar con tu PIN para que se puedan bajar las hojas.',
    };
  }
  if (motivo === 'error') {
    return {
      icon: TriangleAlert,
      title: 'No se pudo conectar con el servidor',
      subtitle: 'Hubo un problema al bajar las hojas. Vuelve a entrar a esta pantalla en un momento.',
    };
  }
  if (motivo === 'incompleta') {
    return {
      icon: TriangleAlert,
      title: 'Descarga incompleta',
      subtitle: 'La descarga de las hojas se cortó a mitad de camino y no se guardó ninguna. Vuelve a entrar a esta pantalla para reintentar.',
    };
  }
  return {
    icon: ClipboardList,
    title: 'Todavía no hay hojas en esta ronda',
    subtitle: 'Arma el inventario desde "Armar hojas": catálogo, crear hojas y asignarlas.',
  };
}

/**
 * "Hojas de esta ronda" del Coordinador -- pedido del cliente (2026-09-07):
 * que sea la MISMA pantalla que ve el Contador (`app/conteo/mis-hojas.tsx`),
 * con dos diferencias: acá se ven TODAS las hojas del lote (no `mias()`), y
 * cada tarjeta dice QUIÉN la tiene (`TarjetaHoja.asignados`, prop que el
 * Contador nunca pasa). El armado (catálogo/crear/asignar) se fue a su
 * propio tab ("Armar hojas") -- esta pantalla ya no lo mezcla.
 *
 * Los chips de un solo criterio se reemplazaron por un MODAL de tres
 * (persona/estado/número), mismo patrón que el modal de filtros de Contar
 * (`ModalFiltrosProductos`, min-4) pero con sus propios componentes
 * (`ModalFiltrosHojas`, `lib/dominio/filtro-hojas.ts`) para no tocar ese.
 */
export default function HojasScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [hojas, setHojas] = useState<HojaConteo[]>([]);
  // Mismas cuatro razones que `mis-hojas.tsx` -- ver ese archivo para el
  // detalle de por qué no pueden caer todas en un solo cartel genérico.
  const [motivoSinHojas, setMotivoSinHojas] = useState<'sin-red' | 'sesion-vencida' | 'error' | 'incompleta' | null>(null);
  const [descargaIncompleta, setDescargaIncompleta] = useState(false);
  const [rondaActual, setRondaActual] = useState<number | null>(null);
  const [estadoCola, setEstadoCola] = useState<EstadoCola>(sincronizador.estado());
  const [filtro, setFiltro] = useState<FiltroHojasModal>(FILTRO_HOJAS_MODAL_VACIO);
  const [modalFiltrosVisible, setModalFiltrosVisible] = useState(false);

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
      // SQLite -- se sigue con eso en vez de dejar la lista colgada
      // esperando una respuesta que no va a llegar (ver inventarioIdSinRed
      // en hojas-sqlite.ts).
      inventarioId = await inventarioIdSinRed();
      ronda = inventarioId ? await rondaActivaSinRed(inventarioId) : null;
      sinRedYsinLocal = inventarioId === null;
    }
    setRondaActual(ronda);
    if (!inventarioId || ronda === null) {
      setHojas([]);
      setMotivoSinHojas(sinRedYsinLocal ? 'sin-red' : null);
      setDescargaIncompleta(false);
      setCargando(false);
      return;
    }
    // todas(), NUNCA mias(): el Coordinador ve el lote entero de la ronda,
    // no solo lo que le tocaría contar a él.
    //
    // `cargarSeguro`, no un await suelto: bug real (2026-09-10) -- sin
    // envolverlo, un fallo acá (backend caído) escapaba sin control y
    // `setCargando(false)` de más abajo nunca se ejecutaba. La pantalla YA
    // tenía diseñado el motivo 'error' (ver estadoVacio arriba); lo que
    // faltaba era llegar a usarlo.
    const idInventario = inventarioId;
    const rondaCerrar = ronda;
    let todas: HojaConteo[] = [];
    const error = await cargarSeguro(async () => {
      todas = await repositorioHojas.todas(idInventario, rondaCerrar);
    });
    setHojas(todas);
    if (error) {
      setMotivoSinHojas('error');
      setDescargaIncompleta(false);
    } else {
      const resultado = ultimaDescarga(idInventario, 'todas', rondaCerrar);
      setMotivoSinHojas(todas.length === 0 && resultado?.ok === false ? resultado.motivo : null);
      setDescargaIncompleta(todas.length > 0 && resultado?.ok === false && resultado.motivo === 'incompleta');
    }
    setCargando(false);
  }, [sesion]);

  // Pausado con el modal de filtros abierto: un refresco a mitad de elegir
  // un filtro no puede pisar el borrador (mismo motivo que documenta el
  // propio hook, useRefrescoAlEnfocar.ts).
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar, { pausado: modalFiltrosVisible });

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  const visibles = useMemo(() => filtrarHojasModal(hojas, filtro), [hojas, filtro]);
  const filtroTexto = textoFiltroModalActivo(filtro);
  const filtrosActivos = contarFiltrosActivosModal(filtro);

  const totalItemsBloque = hojas.reduce((acc, h) => acc + h.productos.length, 0);
  const contadosTotal = hojas.reduce((acc, h) => acc + h.conteos.length, 0);
  const enProceso = hojas.filter((h) => h.estado === 'en-proceso').length;
  const sync = sincronizacionDeHojas(hojas, estadoCola);

  return (
    <PantallaConTabs
      scrollable
      contentStyle={styles.contenido}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} colors={[colors.rojo]} tintColor={colors.rojo} />}
    >
      <View style={styles.cabeceraHoja}>
        <BarraApp
          rotulo={`Hojas de esta ronda · ${ORDINAL[rondaActual ?? 1]} conteo`}
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

      {hojas.length > 0 ? (
        <Pressable
          style={styles.btnFiltros}
          onPress={() => setModalFiltrosVisible(true)}
          accessibilityLabel={filtrosActivos > 0 ? `Filtros, ${filtrosActivos} activo${filtrosActivos === 1 ? '' : 's'}` : 'Filtros'}
        >
          <Filter size={17} color={colors.tinta} />
          <Text style={styles.btnFiltrosTexto}>Filtros</Text>
          {filtrosActivos > 0 ? (
            <View style={styles.filtrosBadge}>
              <Text style={styles.filtrosBadgeTexto}>{filtrosActivos}</Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}

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
            </View>
          )}

          {visibles.length > 0 ? (
            <View style={styles.lista}>
              {visibles.map((hoja) => (
                // SIN `titulo`/`codigos`: mismo criterio que mis-hojas.tsx
                // (1045d46, min-2) -- zona/gondola son sintéticas, el número
                // de hoja identifica y el resto sobra. `asignados` es la
                // única diferencia real con la tarjeta del Contador.
                <TarjetaHoja
                  key={hoja.id}
                  numero={hoja.numero}
                  asignados={hoja.asignados}
                  estado={hoja.estado}
                  contados={hoja.conteos.length}
                  total={hoja.productos.length}
                  habilitada={hoja.productos.length > 0}
                />
              ))}
            </View>
          ) : (
            <EmptyState
              icon={Filter}
              title="Ninguna hoja coincide"
              subtitle="Prueba con otro filtro, o limpia los que ya elegiste."
            />
          )}

          <View style={styles.pieLista}>
            <Text style={styles.pieTexto}>
              {textoMostrando(visibles.length, hojas.length, formatoMiles)}
              {filtroTexto ? ` · filtro: ${filtroTexto}` : ''}
            </Text>
          </View>
        </>
      )}

      <ModalFiltrosHojas
        visible={modalFiltrosVisible}
        hojas={hojas}
        filtro={filtro}
        onAplicar={(nuevo) => {
          setFiltro(nuevo);
          setModalFiltrosVisible(false);
        }}
        onCerrar={() => setModalFiltrosVisible(false)}
      />
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: 14, paddingTop: 8, gap: 16 },
  cabeceraHoja: { gap: 13, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.borde },
  cargando: { marginTop: 24 },
  lista: { gap: 10 },
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
});
