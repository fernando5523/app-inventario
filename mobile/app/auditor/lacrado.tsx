import { router } from 'expo-router';
import { Check, Cloud, Lock, ShieldCheck } from 'lucide-react-native';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Modal, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { BandaSync, Badge, BarraApp, Button, formatoFechaHora, formatoMiles } from '../../components/ui';
import { repositorioHistorial, repositorioLacrado, repositorioSesion } from '../../lib/contenedor';
import { sucursalEnFoco } from '../../lib/dominio/sucursal-en-foco';
import { textoAuditoresInsuficientes } from '../../lib/dominio/texto-firmas';
import type { Colaborador, Sucursal } from '../../lib/dominio/tipos';
import type { EstadoLacrado } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { useSucursalAuditada } from '../../lib/sucursal-auditada-contexto';
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
  const [error, setError] = useState<string | null>(null);
  const [inventarioId, setInventarioId] = useState<number | null>(null);
  const [items, setItems] = useState<number | null>(null);
  const [periodo, setPeriodo] = useState<string | null>(null);
  const [auditores, setAuditores] = useState<Colaborador[]>([]);
  const [estado, setEstado] = useState<EstadoLacrado | null>(null);

  // Sigue la sucursal COMPARTIDA que el auditor eligió en Auditoría/Ciclo/
  // Historial (contexto), NO la de su ficha: audita toda la cadena. El padrón
  // resuelve el nombre para la barra y la confirmación de lacrado.
  const { elegida } = useSucursalAuditada();
  const [padronSucursales, setPadronSucursales] = useState<Sucursal[]>([]);
  useEffect(() => {
    repositorioSesion.sucursales().then(setPadronSucursales);
  }, []);
  const sucursalId = sucursalEnFoco({
    rol: sesion?.colaborador.rol ?? 'auditor',
    sucursalDeSesion: sesion?.sucursal?.id ?? null,
    elegida,
  });
  const nombreSucursal = padronSucursales.find((s) => s.id === sucursalId)?.nombre ?? sesion?.sucursal?.nombre;

  const [aprobando, setAprobando] = useState(false);
  const [lacrando, setLacrando] = useState(false);
  const [registrando, setRegistrando] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  const cargar = useCallback(async () => {
    if (!sesion || sucursalId === null) {
      setCargando(false);
      return;
    }
    setError(null);
    try {
      const [pagina, sinTienda] = await Promise.all([
        repositorioHistorial.listar({ sucursalId }),
        // Los firmantes son los auditores DEL SISTEMA (auditan toda la cadena),
        // NO los de la tienda: contar "los de esta sucursal" da 0 desde que el
        // auditor dejó de pertenecer a una sucursal. Vienen del grupo
        // "administradores" del login, filtrado a rol auditor.
        repositorioSesion.administradores(),
      ]);

      setAuditores(sinTienda.filter((c) => c.rol === 'auditor'));

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
        setEstado(estadoLacrado);
      }
    } catch (e) {
      // Sin esto, un fallo sin red dejaba el spinner girando para siempre
      // (mismo bug que f558689 arregló) — y encima esta pantalla usaba
      // `useEffect` con deps `[sesion]`, así que ni siquiera reintentaba
      // solo al volver a visitarla.
      setError(e instanceof Error ? e.message : 'No se pudo cargar el estado del lacrado.');
    } finally {
      setCargando(false);
    }
  }, [sesion, sucursalId]);

  // Cambió la tienda elegida (o la sesión): `cargar` cambia de identidad, pero
  // useRefrescoAlEnfocar NO recarga por eso (solo al enfocar/volver a primer
  // plano -- guarda `cargar` en un ref a propósito). Así que acá se dispara la
  // recarga, Y se limpia lo que se ve ANTES: la barra ya dice el nombre nuevo,
  // mostrar el inventario de la tienda anterior sería un número con el apellido
  // equivocado (skill, Honestidad de los datos en pantalla).
  useEffect(() => {
    setInventarioId(null);
    setItems(null);
    setPeriodo(null);
    setEstado(null);
    setCargando(true);
    void cargar();
  }, [cargar]);

  // Volver a esta pantalla (por ejemplo, después de que la otra persona firme
  // desde su sesión) tiene que reflejar el estado real, no el que había al
  // entrar la primera vez. Y ahora también al volver la app del segundo
  // plano: ESTA es la pantalla donde más importa -- las dos aprobaciones que
  // habilitan el lacrado las dan dos personas distintas, en dos teléfonos, y
  // quien espera la firma del otro tiene la app abierta mirando. Ver
  // components/hooks/useRefrescoAlEnfocar.ts.
  //
  // PAUSADO con el modal abierto o una acción en vuelo: aprobar y lacrar son
  // irreversibles, y un refresco que redibuje la pantalla debajo de un modal
  // de confirmación es la peor forma de que alguien apriete lo que no era.
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar, {
    pausado: modalVisible || aprobando || lacrando || registrando,
  });

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
      Alert.alert('No se pudo aprobar', error instanceof Error ? error.message : 'Intenta de nuevo.');
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
      Alert.alert('No se pudo lacrar', error instanceof Error ? error.message : 'Intenta de nuevo.');
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
      Alert.alert('No se pudo registrar', error instanceof Error ? error.message : 'Intenta de nuevo.');
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

  // Cuantas cuentas de Auditor hacen falta ADEMÁS de las que ya hay para
  // poder alguna vez llegar al mínimo -- generaliza el viejo
  // "otrosAuditores.length === 0" (que solo contemplaba el caso de 2).
  const auditoresInsuficientes = auditores.length < aprobacionesRequeridas;

  /**
   * El aviso más importante de la pantalla: dice con todas las letras qué
   * falta y quién lo tiene que poner. Sin esto, el auditor logueado ve una
   * fila que no puede tocar y no sabe si está roto o si le falta un
   * permiso. Todo el texto sale de `aprobacionesRequeridas` (que a su vez
   * sale de `estado.aprobacionesRequeridas`, ver EstadoLacradoDto en el
   * backend) -- nunca de un "dos" escrito a mano, para que un cambio en la
   * configuración del servidor se refleje solo, sin tocar esta pantalla.
   */
  const avisoFirmas = !estado
    ? null
    : estado.lacrado
      ? null
      : auditoresInsuficientes
        ? textoAuditoresInsuficientes(auditores.length, aprobacionesRequeridas)
        : todasAprobadas
          ? aprobacionesRequeridas === 1
            ? 'Tu firma quedó registrada. Ya se puede ejecutar el lacrado.'
            : `Las ${aprobacionesRequeridas} firmas quedaron registradas. Ya se puede ejecutar el lacrado.`
          : !miFirma && aprobacionesHechas === 0
            ? aprobacionesRequeridas === 1
              ? 'Puedes registrar tu firma ahora: con esa alcanza para habilitar el lacrado.'
              : `Todavía no hay ninguna firma. Puedes registrar la tuya ahora; ${pendientes.length === 1 ? 'la siguiente la tiene que registrar' : 'las siguientes las tienen que registrar'} ${nombresPendientes}, ingresando con su propio PIN.`
            : !miFirma
              ? `Ya hay ${aprobacionesHechas === 1 ? 'una firma registrada' : `${aprobacionesHechas} firmas registradas`}. Falta la tuya para completar la validación.`
              : `Tu firma ya quedó registrada. ${pendientes.length === 1 ? 'Falta la de' : 'Faltan las de'} ${nombresPendientes}, y solo esa persona puede ponerla: tiene que ingresar con su propio PIN, desde otro equipo o cerrando esta sesión con el botón de arriba a la derecha.`;

  const textoLacrado = !estado
    ? ''
    : estado.lacrado
      ? undefined // se muestra el resultado, no este texto
      : !todasAprobadas
        ? `Faltan firmas de auditoría (${aprobacionesHechas} de ${aprobacionesRequeridas}). El lacrado se habilita recién con ${aprobacionesRequeridas === 1 ? 'esa firma' : 'todas ellas'}, y también hace falta sincronización con Dynamics.`
        : !estado.todoSincronizado
          ? `${aprobacionesRequeridas === 1 ? 'La firma está registrada' : 'Las firmas están registradas'}, pero falta sincronización con Dynamics (WiFi de tienda) para poder lacrar.`
          : `Todo listo: ${aprobacionesRequeridas === 1 ? 'la firma está registrada' : 'las firmas están registradas'} y hay sincronización con Dynamics.`;

  return (
    <PantallaConTabs
      scrollable
      contentStyle={styles.contenido}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={colors.rojo} colors={[colors.rojo]} />}
    >
      <BarraApp
        rotulo="Auditoría · Lacrado digital"
        sede={nombreSucursal}
        // "ítems del inventario", no "ítems auditados": `items` es el total
        // del snapshot (repositorioInventario.activo()), no la cantidad
        // que de verdad se comparó contra Dynamics -- eso lo dice
        // app/auditor/auditoria.tsx con su propio total (RepositorioAuditoria
        // .matriz()). Decir "auditados" acá sería la misma inconsistencia
        // que la auditoría marcó entre Inicio/Auditoría/Lacrado: tres
        // pantallas, tres cifras distintas para lo que suena a la misma cosa.
        cifras={items ? `${periodo ? `${periodo} · ` : ''}${formatoMiles(items)} ítems del inventario` : undefined}
        onSalir={salir}
      />

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : error ? (
        <View style={styles.tarjeta}>
          <Text style={styles.tarjetaTitulo}>No se pudo cargar el lacrado</Text>
          <Text style={styles.tarjetaTexto}>{error}</Text>
          <Button label="Reintentar" onPress={cargar} />
        </View>
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
              <Text style={styles.tarjetaTitulo}>{aprobacionesRequeridas === 1 ? 'Validación de auditoría' : 'Doble validación'}</Text>
              <Badge label={`${aprobacionesHechas} / ${aprobacionesRequeridas} firmado`} variant={todasAprobadas ? 'ok' : 'default'} />
            </View>

            <Text style={styles.tarjetaTexto}>
              {aprobacionesRequeridas === 1 ? (
                <>
                  Hace falta la firma de <Text style={styles.negrita}>un auditor</Text>, desde su propia sesión.
                </>
              ) : (
                <>
                  Hacen falta las firmas de <Text style={styles.negrita}>{aprobacionesRequeridas} auditores distintos</Text>, cada uno
                  desde su propia sesión.
                </>
              )}{' '}
              Nadie puede aprobar en nombre de otro: la única fila con botón es la de quien está logueado.
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
                    // entienda quién falta, pero esta no es tocable por
                    // quien no es esa persona.
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
              Se va a lacrar el inventario de <Text style={styles.negrita}>{nombreSucursal}</Text>
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
