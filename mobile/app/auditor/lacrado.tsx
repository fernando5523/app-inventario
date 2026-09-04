import { router } from 'expo-router';
import { Check, Cloud, Lock, ShieldCheck } from 'lucide-react-native';
import { useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, View } from 'react-native';

import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { BandaSync, Badge, BarraApp, Button, formatoFechaHora, formatoMiles } from '../../components/ui';
import { repositorioHistorial, repositorioLacrado, repositorioSesion } from '../../lib/contenedor';
import type { Colaborador } from '../../lib/dominio/tipos';
import type { EstadoLacrado } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, spacing } from '../../lib/theme';

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
  const [periodo, setPeriodo] = useState<string | null>(null);
  const [auditores, setAuditores] = useState<Colaborador[]>([]);
  const [estado, setEstado] = useState<EstadoLacrado | null>(null);

  const [aprobando, setAprobando] = useState(false);
  const [lacrando, setLacrando] = useState(false);
  const [registrando, setRegistrando] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    if (!sesion) return;
    let vigente = true;

    async function cargar(): Promise<void> {
      const [pagina, colaboradores] = await Promise.all([
        repositorioHistorial.listar({ sucursalId: sesion!.sucursal!.id }),
        repositorioSesion.colaboradores(sesion!.sucursal!.id),
      ]);
      if (!vigente) return;

      setAuditores(colaboradores.filter((c) => c.rol === 'auditor'));

      /**
       * El inventario A LACRAR sale del historial, no de
       * `repositorioInventario.activo()`, y la diferencia no es de plomería:
       * `activo()` devuelve el inventario ABIERTO, que es exactamente el
       * único que NO se puede lacrar — todavía se están contando las
       * cantidades. El backend lo rechaza (409: el estado tiene que ser
       * `conteo_cerrado` o `liquidado`), así que la pantalla apuntaba al
       * inventario equivocado y solo se enteraba al apretar el botón.
       *
       * Se toma el más reciente que ya cerró el conteo y todavía no está
       * lacrado; el listado viene ordenado del más nuevo al más viejo. Un
       * inventario ya lacrado no vuelve acá: se mira desde el Historial.
       */
      const pendiente = pagina.inventarios.find((i) => i.estado === 'conteo_cerrado' || i.estado === 'liquidado');

      if (pendiente) {
        setInventarioId(pendiente.id);
        setItems(pendiente.snapshotItems);
        setPeriodo(pendiente.periodo);
        const estadoLacrado = await repositorioLacrado.estado(pendiente.id);
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

  /**
   * Sin argumento a propósito: la única firma que esta pantalla puede
   * registrar es la de quien está en sesión, y el adaptador la resuelve
   * solo. No hay forma de pedirle que apruebe por otro.
   */
  async function aprobar(): Promise<void> {
    if (!inventarioId) return;
    setAprobando(true);
    try {
      const nuevo = await repositorioLacrado.aprobar(inventarioId);
      setEstado(nuevo);
    } catch (error) {
      Alert.alert('No se pudo aprobar', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setAprobando(false);
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

  // Quién está firmando: la ÚNICA fila con botón es la de esta persona.
  const yo = sesion.colaborador.id;
  const miFirma = estado?.aprobaciones.find((a) => a.colaboradorId === yo);
  const otrosAuditores = auditores.filter((a) => a.id !== yo);
  const pendientes = otrosAuditores.filter((a) => !estado?.aprobaciones.some((x) => x.colaboradorId === a.id));
  const nombresPendientes = pendientes.map((a) => a.nombre).join(' y ');

  /**
   * El aviso más importante de la pantalla: dice con todas las letras que
   * la segunda firma la tiene que poner OTRA persona en OTRA sesión. Sin
   * esto, el auditor logueado ve una fila que no puede tocar y no sabe si
   * está roto o si le falta un permiso.
   */
  const avisoFirmas = !estado
    ? null
    : estado.lacrado
      ? null
      : otrosAuditores.length === 0
        ? 'Esta sucursal tiene una sola cuenta de Auditor cargada, así que la doble validación no se puede completar: hace falta una segunda cuenta de Auditor (se da de alta en Usuarios). El lacrado necesita dos personas distintas, no dos toques.'
        : todasAprobadas
          ? 'Las dos firmas quedaron registradas. Ya se puede ejecutar el lacrado.'
          : !miFirma && pendientes.length === otrosAuditores.length
            ? `Todavía no hay ninguna firma. Podés registrar la tuya ahora; la segunda la tiene que registrar ${nombresPendientes}, ingresando con su propio PIN.`
            : !miFirma
              ? 'La otra firma ya está registrada. Falta la tuya para completar la doble validación.'
              : `Tu firma ya quedó registrada. Falta la de ${nombresPendientes}, y solo esa persona puede ponerla: tiene que ingresar con su propio PIN, desde otro equipo o cerrando esta sesión con el botón de arriba a la derecha.`;

  const textoLacrado = !estado
    ? ''
    : estado.lacrado
      ? undefined // se muestra el resultado, no este texto
      : !todasAprobadas
        ? `Faltan firmas de auditoría (${aprobacionesHechas} de ${aprobacionesRequeridas}). El lacrado se habilita recién con las dos, y también hace falta sincronización con Dynamics.`
        : !estado.todoSincronizado
          ? 'Las dos firmas están registradas, pero falta sincronización con Dynamics (WiFi de tienda) para poder lacrar.'
          : 'Todo listo: las dos firmas están registradas y hay sincronización con Dynamics.';

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <BarraApp
        rotulo="Auditoría · Lacrado digital"
        sede={sesion.sucursal!.nombre}
        // "ítems del inventario", no "ítems auditados": `items` es el total
        // del snapshot (repositorioInventario.activo()), no la cantidad
        // que de verdad se comparó contra Dynamics -- eso lo dice
        // app/auditor/auditoria.tsx con su propio total real (hoy, 3
        // ítems de ejemplo, ver auditoria-memoria.ts). Decir "auditados"
        // acá es la misma inconsistencia que la auditoría marcó entre
        // Inicio/Auditoría/Lacrado: tres pantallas, tres cifras distintas
        // para lo que suena a la misma cosa.
        cifras={items ? `${periodo ? `${periodo} · ` : ''}${formatoMiles(items)} ítems del inventario` : undefined}
        onSalir={salir}
      />

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : !inventarioId ? (
        <Text style={styles.tarjetaTexto}>
          No hay ningún inventario listo para lacrar en esta sucursal. El lacrado llega cuando el conteo del ciclo ya
          cerró: mientras las cantidades todavía se pueden recontar, no hay nada que sellar.
        </Text>
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
              <Badge label={`${aprobacionesHechas} / ${aprobacionesRequeridas} firmado`} variant={todasAprobadas ? 'ok' : 'default'} />
            </View>

            <Text style={styles.tarjetaTexto}>
              Hacen falta las firmas de <Text style={styles.negrita}>dos auditores distintos</Text>, cada uno desde su
              propia sesión. Nadie puede aprobar en nombre de otro: la única fila con botón es la de quien está
              logueado.
            </Text>

            {auditores.map((auditor) => {
              const aprobacion = estado?.aprobaciones.find((a) => a.colaboradorId === auditor.id);
              const esMiFila = auditor.id === yo;
              return (
                <View key={auditor.id} style={[styles.validacionFila, esMiFila && styles.validacionFilaPropia]}>
                  <View style={styles.personaDatos}>
                    <Text style={styles.personaNombre}>{auditor.nombre}</Text>
                    <Text style={styles.personaSub}>
                      {aprobacion ? `Firmó el ${formatoFechaHora(aprobacion.fecha)}` : 'Auditor'}
                      {esMiFila ? ' · sesión actual' : ''}
                    </Text>
                  </View>
                  {aprobacion ? (
                    <Badge label="Aprobado" variant="ok" />
                  ) : esMiFila ? (
                    <Button label="Aprobar" size="sm" loading={aprobando} disabled={!!estado?.lacrado} onPress={aprobar} />
                  ) : (
                    // Sin botón, y a propósito: la fila se ve para que se
                    // entienda que faltan dos firmas, pero esta no es
                    // tocable por quien no es esa persona.
                    <Badge label="Falta su firma" variant="default" />
                  )}
                </View>
              );
            })}

            {avisoFirmas ? <Text style={styles.avisoFirmas}>{avisoFirmas}</Text> : null}
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
                  {items ? formatoMiles(items) : ''} ítems quedan grabados de forma inmutable; cualquier ajuste entra en
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
              {items ? ` (${formatoMiles(items)} ítems)` : ''}. A partir de este momento el inventario del mes queda{' '}
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
  /**
   * La fila propia se distingue por el borde, no por el rojo de marca: el
   * rojo es la acción (el botón "Aprobar" que ya está adentro). Si además
   * tiñera la fila, competirían.
   */
  validacionFilaPropia: { borderColor: colors.tinta, borderWidth: 1.5 },
  avisoFirmas: {
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.proceso,
    fontFamily: fonts.medium,
    backgroundColor: colors.procesoSuave,
    padding: 11,
    borderRadius: 10,
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
