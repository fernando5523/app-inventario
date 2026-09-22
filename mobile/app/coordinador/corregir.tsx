import { router, useLocalSearchParams } from 'expo-router';
import { ClipboardList, Lock, Search, TriangleAlert } from 'lucide-react-native';
import { useCallback, useMemo, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { BarraApp, Badge, Button, EmptyState, ModalConteo, TarjetaProducto } from '../../components/ui';
import { cargarSeguro } from '../../lib/adaptadores/_http';
import { repositorioAjuste, repositorioHojas, repositorioInventario } from '../../lib/contenedor';
import { faseDeCierre, motivoSinCorregir, puedeCorregirLoContado } from '../../lib/dominio/ajuste-final';
import { pluralizar } from '../../lib/dominio/plural';
import type { Conteo, HojaConteo, Producto } from '../../lib/dominio/tipos';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, radius, spacing } from '../../lib/theme';

/**
 * CORREGIR CONTEOS — pantalla del COORDINADOR.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTO CAMBIA
 * ---------------------------------------------------------------------------
 * Hasta ahora finalizar una hoja era el punto de no retorno: lo que cargó el
 * contador quedaba firme aunque estuviera mal. El cliente pidió que el
 * Coordinador pueda corregirlo, en cualquier ronda, con la ronda abierta y
 * también con la ronda ya cerrada.
 *
 * ---------------------------------------------------------------------------
 * SIN STOCK DEL ERP. NI ACÁ, NI EN LO QUE LE LLEGA
 * ---------------------------------------------------------------------------
 * La pantalla usa `TarjetaProducto` y `ModalConteo`, los MISMOS componentes
 * del Contador, y eso no es ahorro de trabajo: son los dos que por diseño no
 * saben qué es el stock del ERP (ver la cabecera de TarjetaProducto). Si el
 * Coordinador pudiera ver el stock mientras corrige, la corrección dejaría de
 * ser "acá había 12" y pasaría a ser "pongo lo que dice el sistema" -- que es
 * exactamente lo que las pasadas de conteo vinieron a evitar. El que compara
 * contra el ERP es el Auditor, en el ajuste final, y esa es su pantalla.
 *
 * Lo único que se agrega es el MOTIVO obligatorio (`pedirMotivo`): estos
 * valores descuentan plata de un sueldo y quedan sellados en el lacrado, así
 * que un cambio sin explicación es un descuento que nadie puede defender.
 */
export default function CorregirScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const { hojaId, ronda } = useLocalSearchParams<{ hojaId?: string; ronda?: string }>();
  const hojaIdNumero = Number(hojaId);
  const rondaNumero = Number(ronda);

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoja, setHoja] = useState<HojaConteo | null>(null);
  const [fase, setFase] = useState<ReturnType<typeof faseDeCierre> | null>(null);
  const [modalProducto, setModalProducto] = useState<Producto | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    if (!sesion || !Number.isFinite(hojaIdNumero)) return;
    setError(null);
    const falla = await cargarSeguro(async () => {
      const activo = await repositorioInventario.activo(sesion.sucursal!.id);
      if (!activo) {
        // Sin inventario abierto no hay nada que corregir, y la pantalla lo
        // dice en vez de mostrar una hoja huérfana.
        setHoja(null);
        setFase(null);
        return;
      }
      setFase(faseDeCierre(activo.estado, activo.rondaActiva, activo.totalHojas));

      // `todas()` y NUNCA `mias()`: el Coordinador corrige lo que cargaron
      // OTROS, así que la hoja casi nunca es suya. Va contra el servidor (la
      // ronda pasada por parámetro), no contra lo que este teléfono tenga
      // local: lo que se corrige es el conteo del equipo, no la copia de quien
      // mira la pantalla.
      const rondaAPedir = Number.isFinite(rondaNumero) ? rondaNumero : (activo.rondaActiva ?? 1);
      const todas = await repositorioHojas.todas(activo.inventarioId, rondaAPedir);
      setHoja(todas.find((h) => h.id === hojaIdNumero) ?? null);
    });
    setCargando(false);
    if (falla) setError(falla.message);
  }, [sesion, hojaIdNumero, rondaNumero]);

  // Pausado con el modal abierto: un refresco a mitad de tipear un motivo
  // borraría el borrador (regla del hook, ver useRefrescoAlEnfocar.ts).
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar, { pausado: modalProducto !== null || guardando });

  const conteoPorProducto = useMemo(() => {
    const mapa = new Map<number, Conteo>();
    for (const conteo of hoja?.conteos ?? []) mapa.set(conteo.productoId, conteo);
    return mapa;
  }, [hoja]);

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  const bloqueo = fase === null ? null : motivoSinCorregir(fase);
  const sePuedeCorregir = fase !== null && puedeCorregirLoContado(fase);
  const contados = hoja?.conteos.length ?? 0;
  const total = hoja?.productos.length ?? 0;

  async function guardarCorreccion(conteo: Conteo, motivo: string): Promise<void> {
    if (hoja === null) return;
    setGuardando(true);
    try {
      await repositorioAjuste.corregirConteo(hoja.id, conteo.productoId, {
        empaques: conteo.empaques,
        sueltas: conteo.sueltas,
        motivo,
      });
      setModalProducto(null);
      // Se vuelve a pedir la hoja en vez de tocar el estado local: la
      // corrección la escribe el SERVIDOR (con su bitácora), y una copia
      // optimista mostraría como guardado algo que puede haber sido
      // rechazado por una regla que este teléfono no conoce.
      await cargar();
    } catch (e) {
      // El mensaje del servidor tal cual: dice qué regla se topó ("el auditor
      // ya empezó el ajuste"), y eso es lo accionable.
      Alert.alert(
        'No se pudo corregir el conteo',
        e instanceof Error ? e.message : 'Revisa la conexión con la tienda y vuelve a intentarlo.',
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <PantallaConTabs
        scrollable
        contentStyle={styles.contenido}
        refreshControl={
          <RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={colors.rojo} colors={[colors.rojo]} />
        }
      >
        <BarraApp
          rotulo={hoja ? `Corregir conteos · Hoja #${hoja.numero}` : 'Corregir conteos'}
          sede={sesion.sucursal!.nombre}
          cifras={hoja ? `${contados} de ${total} ${pluralizar(total, 'ítem contado', 'ítems contados')}` : undefined}
          onSalir={salir}
        />

        {cargando ? (
          <ActivityIndicator color={colors.rojo} style={styles.spinner} />
        ) : error !== null ? (
          <EmptyState icon={TriangleAlert} title="No se pudo cargar la hoja" subtitle={error}>
            <Button label="Volver a intentar" onPress={refrescar} />
          </EmptyState>
        ) : hoja === null ? (
          <EmptyState
            icon={ClipboardList}
            title="Esta hoja ya no está en la ronda activa"
            subtitle="Las hojas se numeran de nuevo en cada ronda. Vuelve a Gestión de hojas y abre la que quieres corregir desde la lista."
          >
            <Button label="Ir a Gestión de hojas" variant="outline" onPress={() => router.replace('/coordinador/hojas')} />
          </EmptyState>
        ) : (
          <>
            {/*
              QUIÉN PUEDE Y HASTA CUÁNDO, arriba de todo y siempre visible --
              no solo cuando ya no se puede. La ventana de corrección se cierra
              sola cuando el Auditor arranca el ajuste, y la persona tiene que
              poder anticiparlo en vez de descubrirlo cuando el botón falla.
            */}
            <View style={[styles.aviso, !sePuedeCorregir && styles.avisoCerrado]}>
              {sePuedeCorregir ? (
                <Text style={styles.avisoTexto}>
                  Puedes corregir cualquier valor de esta hoja, aunque la ronda ya esté cerrada. Cada cambio pide un
                  motivo y queda registrado con tu nombre. Dejas de poder cuando el auditor empiece el ajuste final.
                </Text>
              ) : (
                <>
                  <Lock size={15} color={colors.gris} />
                  <Text style={styles.avisoTexto}>{bloqueo}</Text>
                </>
              )}
            </View>

            <View style={styles.seccion}>
              <Text style={styles.seccionTitulo}>Ítems de la hoja</Text>
              <Badge
                label={`${contados} / ${total}`}
                variant={total > 0 && contados === total ? 'ok' : 'default'}
              />
            </View>

            {hoja.productos.length === 0 ? (
              <EmptyState
                icon={Search}
                title="Esta hoja todavía no tiene catálogo"
                subtitle="Sus ítems se cargan al armar el inventario. Sin catálogo no hay valores que corregir."
              />
            ) : (
              <View style={styles.lista}>
                {hoja.productos.map((producto) => (
                  <TarjetaProducto
                    key={producto.id}
                    producto={producto}
                    conteo={conteoPorProducto.get(producto.id) ?? null}
                    // La confirmación por escáner es del conteo ORIGINAL: una
                    // corrección a mano nunca la hereda ni la inventa.
                    confirmado={conteoPorProducto.get(producto.id)?.confirmadoPorEscaner ?? false}
                    bloqueado={!sePuedeCorregir}
                    onPress={() => setModalProducto(producto)}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </PantallaConTabs>

      {/*
        Hermano del scroll, nunca adentro: dentro del ScrollView el overlay
        queda recortado y se desplaza con el contenido (mismo patrón que
        contar.tsx y el speed dial de Usuarios).
      */}
      <ModalConteo
        visible={modalProducto !== null && sePuedeCorregir}
        producto={modalProducto}
        conteoInicial={modalProducto ? (conteoPorProducto.get(modalProducto.id) ?? null) : null}
        confirmadoPorEscaner={false}
        pedirMotivo
        tituloMotivo="Reemplaza el valor que cargó quien contó. Queda registrado con tu nombre y la hora."
        onGuardar={(conteo, motivo) => void guardarCorreccion(conteo, motivo)}
        onCerrar={() => setModalProducto(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: 14, paddingTop: 8, gap: spacing.lg },
  spinner: { marginTop: spacing.xxxl },

  aviso: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: 12,
    borderRadius: radius.md,
    // `esperaSuave` y no `procesoSuave`: poder corregir no es una advertencia,
    // es información. El tono de atención se reserva para cuando ya NO se puede.
    backgroundColor: colors.esperaSuave,
  },
  avisoCerrado: { backgroundColor: colors.procesoSuave },
  avisoTexto: { flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.gris, fontFamily: fonts.regular },

  seccion: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  seccionTitulo: {
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.gris,
    fontFamily: fonts.semibold,
  },
  lista: { gap: 10 },
});
