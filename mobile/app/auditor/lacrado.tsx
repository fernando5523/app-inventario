import { router } from 'expo-router';
import { Check, Cloud, Lock, ShieldCheck } from 'lucide-react-native';
import { useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { BandaSync, Badge, BarraApp, Button } from '../../components/ui';
import { repositorioInventario, repositorioLacrado, repositorioSesion } from '../../lib/contenedor';
import type { Colaborador } from '../../lib/dominio/tipos';
import type { EstadoLacrado } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, spacing } from '../../lib/theme';

const nf = new Intl.NumberFormat('es-PE');

/**
 * Lacrado digital (mobile/design/lacrado.html) — acceso del Auditor, el
 * punto de no retorno más fuerte de todo el sistema: doble aprobación de
 * auditoría -> lacrado con hash inmutable -> envío MANUAL a Dynamics.
 *
 * El envío automático a Dynamics es fase 2 (acordado con el cliente en la
 * reunión de requisitos): esta pantalla nunca promete escribir en
 * Dynamics, solo dejar marcado que TI lo cargó a mano.
 *
 * A diferencia del mockup (que lacra directo al click), acá se agrega un
 * modal de confirmación explícito antes de ejecutar `lacrar()`: es el
 * punto de no retorno más fuerte del sistema y necesita decir, con todas
 * las letras, qué se va a congelar y que no hay vuelta atrás.
 */
export default function LacradoScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [inventarioId, setInventarioId] = useState<number | null>(null);
  const [items, setItems] = useState<number | null>(null);
  const [auditores, setAuditores] = useState<Colaborador[]>([]);
  const [estado, setEstado] = useState<EstadoLacrado | null>(null);

  const [aprobando, setAprobando] = useState<number | null>(null);
  const [lacrando, setLacrando] = useState(false);
  const [registrando, setRegistrando] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    if (!sesion) return;
    let vigente = true;

    async function cargar(): Promise<void> {
      const [activo, colaboradores] = await Promise.all([
        repositorioInventario.activo(sesion!.sucursal!.id),
        repositorioSesion.colaboradores(sesion!.sucursal!.id),
      ]);
      if (!vigente) return;

      setAuditores(colaboradores.filter((c) => c.rol === 'auditor'));

      if (activo) {
        setInventarioId(activo.inventarioId);
        setItems(activo.items);
        const estadoLacrado = await repositorioLacrado.estado(activo.inventarioId);
        if (vigente) setEstado(estadoLacrado);
      }
      if (vigente) setCargando(false);
    }

    cargar();
    return () => {
      vigente = false;
    };
  }, [sesion]);

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  async function aprobar(colaboradorId: number): Promise<void> {
    if (!inventarioId) return;
    setAprobando(colaboradorId);
    try {
      const nuevo = await repositorioLacrado.aprobar(inventarioId, colaboradorId);
      setEstado(nuevo);
    } catch (error) {
      Alert.alert('No se pudo aprobar', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setAprobando(null);
    }
  }

  async function confirmarLacrado(): Promise<void> {
    if (!inventarioId) return;
    setModalVisible(false);
    setLacrando(true);
    try {
      const nuevo = await repositorioLacrado.lacrar(inventarioId);
      setEstado(nuevo);
    } catch (error) {
      Alert.alert('No se pudo lacrar', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setLacrando(false);
    }
  }

  async function marcarDynamics(): Promise<void> {
    if (!inventarioId) return;
    setRegistrando(true);
    try {
      const nuevo = await repositorioLacrado.marcarRegistradoEnDynamics(inventarioId);
      setEstado(nuevo);
    } catch (error) {
      Alert.alert('No se pudo registrar', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setRegistrando(false);
    }
  }

  const aprobacionesHechas = estado?.aprobaciones.length ?? 0;
  const aprobacionesRequeridas = estado?.aprobacionesRequeridas ?? 2;
  const todasAprobadas = aprobacionesHechas >= aprobacionesRequeridas;
  const puedeLacrar = !!estado && !estado.lacrado && todasAprobadas && estado.todoSincronizado;

  const textoLacrado = !estado
    ? ''
    : estado.lacrado
      ? undefined // se muestra el resultado, no este texto
      : !todasAprobadas
        ? 'Aprobá las dos validaciones y confirmá que hay sincronización con Dynamics para poder lacrar.'
        : !estado.todoSincronizado
          ? 'Las dos validaciones están aprobadas, pero falta sincronización con Dynamics (WiFi de tienda) para poder lacrar.'
          : 'Todo listo: las dos validaciones están aprobadas y hay sincronización con Dynamics.';

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <BarraApp
        rotulo="Auditoría · Lacrado digital"
        sede={sesion.sucursal!.nombre}
        cifras={items ? `${nf.format(items)} ítems auditados` : undefined}
        onSalir={salir}
      />

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : !inventarioId ? (
        <Text style={styles.tarjetaTexto}>Todavía no hay un inventario en curso para esta sucursal.</Text>
      ) : (
        <>
          <BandaSync
            estado={estado?.todoSincronizado ? 'ok' : 'pendiente'}
            mensaje={estado?.todoSincronizado ? 'Sincronizado con Dynamics' : 'Pendiente de sincronizar · esperando WiFi de tienda'}
          />

          <View style={styles.tarjeta}>
            <Text style={styles.cita}>
              “Cierras el mes, firmas, sellas y lacras. El inventario queda grabado de forma inmutable; cualquier
              ajuste posterior entra en el siguiente período.”
            </Text>
            <Text style={styles.citaAutor}>— acordado en la reunión de requisitos</Text>
          </View>

          <View style={styles.tarjeta}>
            <View style={styles.tarjetaCabecera}>
              <ShieldCheck size={18} color={colors.rojo} />
              <Text style={styles.tarjetaTitulo}>Doble validación</Text>
              <Badge label={`${aprobacionesHechas} / ${aprobacionesRequeridas} aprobado`} variant={todasAprobadas ? 'ok' : 'default'} />
            </View>
            {auditores.map((auditor) => {
              const aprobado = estado?.aprobaciones.some((a) => a.colaboradorId === auditor.id) ?? false;
              return (
                <View key={auditor.id} style={styles.validacionFila}>
                  <View style={styles.personaDatos}>
                    <Text style={styles.personaNombre}>{auditor.nombre}</Text>
                    <Text style={styles.personaSub}>Auditor</Text>
                  </View>
                  {aprobado ? (
                    <Badge label="Aprobado" variant="ok" />
                  ) : (
                    <Button
                      label="Aprobar"
                      size="sm"
                      loading={aprobando === auditor.id}
                      disabled={!!estado?.lacrado}
                      onPress={() => aprobar(auditor.id)}
                    />
                  )}
                </View>
              );
            })}
          </View>

          <View style={styles.tarjeta}>
            <View style={styles.tarjetaCabecera}>
              <Lock size={18} color={colors.rojo} />
              <Text style={styles.tarjetaTitulo}>Lacrado digital</Text>
              <Badge label={estado?.lacrado ? 'Lacrado' : 'Bloqueado'} variant={estado?.lacrado ? 'ok' : 'default'} />
            </View>
            {estado?.lacrado ? (
              <View style={styles.resultadoLacrado}>
                <Check size={14} color={colors.ok} />
                <Text style={styles.resultadoTexto}>
                  Inventario lacrado. Hash ID: <Text style={styles.resultadoHash}>{estado.hash}</Text>. Los{' '}
                  {items ? nf.format(items) : ''} ítems quedan grabados de forma inmutable; cualquier ajuste entra en
                  el período siguiente.
                </Text>
              </View>
            ) : (
              <Text style={styles.tarjetaTexto}>{textoLacrado}</Text>
            )}
            {!estado?.lacrado ? (
              <Button
                label="Ejecutar lacrado digital"
                icon={Lock}
                loading={lacrando}
                disabled={!puedeLacrar}
                onPress={() => setModalVisible(true)}
              />
            ) : null}
          </View>

          <View style={[styles.tarjeta, !estado?.lacrado && styles.tarjetaBloqueada]}>
            <View style={styles.tarjetaCabecera}>
              <Cloud size={18} color={colors.rojo} />
              <Text style={styles.tarjetaTitulo}>Envío a Dynamics</Text>
              <Badge
                label={estado?.registradoManualmenteEnDynamics ? 'Registrado manualmente' : 'Pendiente'}
                variant={estado?.registradoManualmenteEnDynamics ? 'proceso' : 'default'}
              />
            </View>
            <Text style={styles.tarjetaTexto}>
              El ajuste automático a Dynamics es una funcionalidad de <Text style={styles.negrita}>fase 2</Text>. Por
              ahora, el equipo de TI registra manualmente el resultado lacrado en el ERP.
            </Text>
            <Button
              label={estado?.registradoManualmenteEnDynamics ? 'Registrado por TI' : 'Marcar como registrado manualmente'}
              icon={Check}
              variant="outline"
              loading={registrando}
              disabled={!estado?.lacrado || !!estado?.registradoManualmenteEnDynamics}
              onPress={marcarDynamics}
            />
          </View>
        </>
      )}

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalFondo}>
          <View style={styles.modalCaja}>
            <Text style={styles.modalTitulo}>Confirmar lacrado</Text>
            <Text style={styles.modalTexto}>
              Se va a lacrar el inventario de <Text style={styles.negrita}>{sesion.sucursal!.nombre}</Text>
              {items ? ` (${nf.format(items)} ítems)` : ''}. A partir de este momento el inventario del mes queda{' '}
              <Text style={styles.negrita}>congelado de forma inmutable</Text>: no hay forma de deshacerlo ni de
              editar los conteos. Cualquier ajuste posterior entra en el período siguiente.
            </Text>
            <View style={styles.modalAcciones}>
              <Button label="Cancelar" variant="outline" onPress={() => setModalVisible(false)} style={styles.modalBoton} />
              <Button label="Confirmar lacrado" icon={Lock} onPress={confirmarLacrado} style={styles.modalBoton} />
            </View>
          </View>
        </View>
      </Modal>
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md + 3 },
  cargando: { marginTop: spacing.xxxl },

  tarjeta: {
    gap: spacing.md,
    padding: 15,
    backgroundColor: colors.campo,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: 13,
  },
  tarjetaBloqueada: { opacity: 0.55 },
  tarjetaCabecera: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tarjetaTitulo: { flex: 1, fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
  tarjetaTexto: { fontSize: 12.5, lineHeight: 18, color: colors.gris, fontFamily: fonts.regular },
  negrita: { fontFamily: fonts.bold, color: colors.tinta },

  cita: { fontSize: 13.5, lineHeight: 19, color: colors.tinta, fontFamily: fonts.medium, fontStyle: 'italic' },
  citaAutor: { fontSize: 11.5, color: colors.grisClaro, fontFamily: fonts.regular },

  validacionFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: 12,
  },
  personaDatos: { gap: 2 },
  personaNombre: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.bold },
  personaSub: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },

  resultadoLacrado: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  resultadoTexto: { flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.gris, fontFamily: fonts.regular },
  resultadoHash: { fontFamily: fonts.bold, color: colors.tinta, fontVariant: ['tabular-nums'] },

  modalFondo: {
    flex: 1,
    backgroundColor: 'rgba(28,25,23,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
  },
  modalCaja: {
    width: '100%',
    maxWidth: 340,
    gap: spacing.md,
    padding: 17,
    backgroundColor: colors.campo,
    borderRadius: 16,
  },
  modalTitulo: { fontSize: 16, color: colors.tinta, fontFamily: fonts.bold },
  modalTexto: { fontSize: 13, lineHeight: 19, color: colors.gris, fontFamily: fonts.regular },
  modalAcciones: { flexDirection: 'row', gap: spacing.sm },
  modalBoton: { flex: 1 },
});
