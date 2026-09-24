import { router } from 'expo-router';
import { Check, Cloud, Lock, RefreshCw, ShieldCheck, Store } from 'lucide-react-native';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { BandaSync, formatoFechaHora, formatoMiles } from '../../components/ui';
import { BotonWeb, ChipIcono, EncabezadoPagina, TarjetaWeb } from '../../components/web';
import { repositorioHistorial, repositorioLacrado, repositorioSesion } from '../../lib/contenedor';
import { pluralizar } from '../../lib/dominio/plural';
import { sucursalEnFoco } from '../../lib/dominio/sucursal-en-foco';
import { textoAuditoresInsuficientes } from '../../lib/dominio/texto-firmas';
import type { Colaborador, Sucursal } from '../../lib/dominio/tipos';
import type { EstadoLacrado } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { useSucursalAuditada } from '../../lib/sucursal-auditada-contexto';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';

/**
 * ---------------------------------------------------------------------------
 * EL LACRADO EN EL NAVEGADOR
 * ---------------------------------------------------------------------------
 * Metro elige este archivo en vez de `lacrado.tsx` cuando el bundle es de web.
 * El del teléfono NO se toca: es un CLON, no una variante con `Platform.OS`
 * adentro — mismo criterio que `auditoria.web.tsx`, `matriz.web.tsx` y
 * `RolTabsLayout.web.tsx`.
 *
 * LA FUNCIONALIDAD ES LA MISMA, hasta el último texto: los tres repositorios,
 * las mismas condiciones para aprobar y lacrar, el mismo modal de
 * confirmación. Lo único que cambia es la FORMA.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ES UNA PANTALLA DE DOS COLUMNAS Y NO UNA COLUMNA QUE SE SCROLLEA
 * ---------------------------------------------------------------------------
 * Esta es la firma: el punto de no retorno más fuerte del sistema. Lo que hay
 * que leer ANTES de apretar el botón rojo — quién firmó, qué falta, qué queda
 * congelado — tiene que estar a la vista AL MISMO TIEMPO que el botón. En el
 * teléfono no hay alternativa: son cuatro tarjetas una abajo de la otra y se
 * baja con el dedo. En un monitor sí la hay, y bajar para firmar es
 * exactamente cómo se firma sin haber leído.
 *
 * Por eso la cita de la reunión de requisitos — "Cierras el mes, firmas,
 * sellas y lacras..." — viajó adentro de la tarjeta del lacrado, pegada al
 * botón. En el teléfono está arriba de todo porque es lo primero que se ve;
 * acá lo primero que se ve es todo junto, y su lugar es al lado de la acción
 * que describe.
 *
 * ---------------------------------------------------------------------------
 * `Alert.alert` NO EXISTE EN EL NAVEGADOR
 * ---------------------------------------------------------------------------
 * `react-native-web` lo exporta como `static alert() {}` — un cuerpo vacío. No
 * avisa, no falla, no hace nada. El teléfono reporta con él los tres errores
 * de esta pantalla (aprobar, lacrar, marcar en Dynamics); acá eso sería una
 * aprobación que falla en silencio en la pantalla donde menos se puede
 * permitir. Los MISMOS títulos y los MISMOS mensajes salen en una banda dentro
 * de la página (ver `aviso`).
 *
 * El modal de confirmación del lacrado sí es un `Modal` de React Native en las
 * dos plataformas, así que ese se clona tal cual.
 */
const ANCHO_ANGOSTO = 1180;

interface EstadoDelCartel {
  titulo: string;
  detalle: string;
  tono: 'ok' | 'atencion' | 'neutro';
}

/**
 * EN QUÉ PUNTO DEL CIERRE ESTÁ, derivado del estado real y no de un texto
 * fijo. El color sigue la regla de la app: verde = ya está; ámbar = espera una
 * decisión de alguien; gris = no hay nada que decir todavía.
 *
 * El rojo NO aparece acá a propósito: en esta pantalla el rojo es el botón de
 * lacrar. Un cartel rojo al lado le sacaría el único lugar donde significa
 * "esto no se deshace".
 */
function cartelDe(estado: EstadoLacrado | null): EstadoDelCartel {
  if (estado === null) {
    return { titulo: 'Sin inventario para lacrar', detalle: 'Esta tienda no tiene un inventario con el conteo cerrado.', tono: 'neutro' };
  }
  if (estado.lacrado) {
    return { titulo: 'Lacrado', detalle: 'Cerrado y sellado: no se toca más.', tono: 'ok' };
  }
  const hechas = estado.aprobaciones.length;
  const requeridas = estado.aprobacionesRequeridas;
  if (hechas < requeridas) {
    return {
      titulo: pluralizar(requeridas, 'Falta la firma', 'Faltan firmas'),
      detalle: `${hechas} de ${requeridas} ${pluralizar(requeridas, 'firma de auditoría registrada', 'firmas de auditoría registradas')}.`,
      tono: 'atencion',
    };
  }
  if (!estado.todoSincronizado) {
    return {
      titulo: 'Falta sincronizar',
      detalle: `${requeridas === 1 ? 'La firma está registrada' : 'Las firmas están registradas'}, pero falta Dynamics.`,
      tono: 'atencion',
    };
  }
  return { titulo: 'Listo para lacrar', detalle: 'Falta ejecutar el lacrado, y no se puede deshacer.', tono: 'atencion' };
}

/** El título y el detalle de un error de acción. Lo que en el teléfono es un `Alert.alert`. */
interface AvisoDeAccion {
  titulo: string;
  detalle: string;
}

export default function LacradoWeb(): JSX.Element {
  const { sesion } = useSesion();
  const { width } = useWindowDimensions();
  const angosto = width < ANCHO_ANGOSTO;

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inventarioId, setInventarioId] = useState<number | null>(null);
  const [items, setItems] = useState<number | null>(null);
  const [periodo, setPeriodo] = useState<string | null>(null);
  const [auditores, setAuditores] = useState<Colaborador[]>([]);
  const [estado, setEstado] = useState<EstadoLacrado | null>(null);

  // Sigue la sucursal COMPARTIDA que el auditor eligió en Auditoría/Ciclo/
  // Historial (contexto), NO la de su ficha: audita toda la cadena. El padrón
  // resuelve el nombre para la banda y la confirmación de lacrado.
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
  const [aviso, setAviso] = useState<AvisoDeAccion | null>(null);

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
       * `repositorioInventario.activo()`: `activo()` devuelve el inventario
       * ABIERTO, que es exactamente el único que NO se puede lacrar. Se toma
       * el más reciente que ya cerró el conteo y todavía no está lacrado; el
       * listado viene ordenado del más nuevo al más viejo.
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
      // Sin esto, un fallo sin red dejaba el spinner girando para siempre.
      setError(e instanceof Error ? e.message : 'No se pudo cargar el estado del lacrado.');
    } finally {
      setCargando(false);
    }
  }, [sesion, sucursalId]);

  // Cambió la tienda elegida (o la sesión): `cargar` cambia de identidad, pero
  // useRefrescoAlEnfocar NO recarga por eso. Acá se dispara la recarga, Y se
  // limpia lo que se ve ANTES: la banda ya dice el nombre nuevo, y mostrar el
  // inventario de la tienda anterior sería un número con el apellido
  // equivocado (skill, Honestidad de los datos en pantalla).
  useEffect(() => {
    setInventarioId(null);
    setItems(null);
    setPeriodo(null);
    setEstado(null);
    setAviso(null);
    setCargando(true);
    void cargar();
  }, [cargar]);

  // Las dos aprobaciones que habilitan el lacrado las dan dos personas
  // distintas, en dos equipos, y quien espera la firma del otro tiene la
  // pantalla abierta mirando. PAUSADO con el modal abierto o una acción en
  // vuelo: aprobar y lacrar son irreversibles.
  const { refrescar } = useRefrescoAlEnfocar(cargar, {
    pausado: modalVisible || aprobando || lacrando || registrando,
  });

  if (!sesion) return <View style={styles.centro} />;

  /**
   * Sin argumento a propósito: la única firma que esta pantalla puede
   * registrar es la de quien está en sesión, y el adaptador la resuelve solo.
   * No hay forma de pedirle que apruebe por otro.
   */
  async function aprobar(): Promise<void> {
    if (!inventarioId) return;
    setAprobando(true);
    setAviso(null);
    try {
      const nuevo = await repositorioLacrado.aprobar(inventarioId);
      setEstado(nuevo);
    } catch (error) {
      setAviso({ titulo: 'No se pudo aprobar', detalle: error instanceof Error ? error.message : 'Intenta de nuevo.' });
    } finally {
      setAprobando(false);
    }
  }

  async function confirmarLacrado(): Promise<void> {
    if (!inventarioId) return;
    setModalVisible(false);
    setLacrando(true);
    setAviso(null);
    try {
      const nuevo = await repositorioLacrado.lacrar(inventarioId);
      setEstado(nuevo);
    } catch (error) {
      setAviso({ titulo: 'No se pudo lacrar', detalle: error instanceof Error ? error.message : 'Intenta de nuevo.' });
    } finally {
      setLacrando(false);
    }
  }

  async function marcarDynamics(): Promise<void> {
    if (!inventarioId) return;
    setRegistrando(true);
    setAviso(null);
    try {
      const nuevo = await repositorioLacrado.marcarRegistradoEnDynamics(inventarioId);
      setEstado(nuevo);
    } catch (error) {
      setAviso({ titulo: 'No se pudo registrar', detalle: error instanceof Error ? error.message : 'Intenta de nuevo.' });
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

  // Cuántas cuentas de Auditor hacen falta ADEMÁS de las que ya hay para poder
  // alguna vez llegar al mínimo.
  const auditoresInsuficientes = auditores.length < aprobacionesRequeridas;

  /**
   * El aviso más importante de la pantalla: dice con todas las letras qué
   * falta y quién lo tiene que poner. Todo el texto sale de
   * `aprobacionesRequeridas` (que a su vez sale del servidor) — nunca de un
   * "dos" escrito a mano.
   */
  const avisoFirmas = !estado
    ? null
    : estado.lacrado
      ? null
      : auditoresInsuficientes
        ? textoAuditoresInsuficientes(auditores.length, aprobacionesRequeridas)
        : todasAprobadas
          ? miFirma && aprobacionesRequeridas === 1
            ? 'Tu firma quedó registrada. Ya se puede ejecutar el lacrado.'
            : `${pluralizar(aprobacionesRequeridas, 'La firma quedó registrada', `Las ${aprobacionesRequeridas} firmas quedaron registradas`)}. Ya se puede ejecutar el lacrado.`
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
        ? `${pluralizar(aprobacionesRequeridas, 'Falta la firma', 'Faltan firmas')} de auditoría (${aprobacionesHechas} de ${aprobacionesRequeridas}). El lacrado se habilita recién con ${pluralizar(aprobacionesRequeridas, 'esa firma', 'todas ellas')}, y también hace falta sincronización con Dynamics.`
        : !estado.todoSincronizado
          ? `${aprobacionesRequeridas === 1 ? 'La firma está registrada' : 'Las firmas están registradas'}, pero falta sincronización con Dynamics (WiFi de tienda) para poder lacrar.`
          : `Todo listo: ${aprobacionesRequeridas === 1 ? 'la firma está registrada' : 'las firmas están registradas'} y hay sincronización con Dynamics.`;

  const cartel = cartelDe(estado);
  // "ítems del inventario", no "ítems auditados": `items` es el total del
  // snapshot, no la cantidad que de verdad se comparó contra Dynamics.
  const cifras = items === null ? null : `${periodo ? `${periodo} · ` : ''}${formatoMiles(items)} ítems del inventario`;

  return (
    <ScrollView style={styles.pagina} contentContainerStyle={styles.contenido} showsVerticalScrollIndicator={false}>
      <EncabezadoPagina
        migas={['Auditoría', 'Lacrado digital']}
        titulo="Lacrado digital"
        sub="La doble validación de auditoría y el sello inmutable del inventario del mes."
        onInicio={() => router.push('/auditor')}
        acciones={<View style={styles.accionEncabezado}><BotonWeb etiqueta="Actualizar" icono={RefreshCw} onPress={refrescar} /></View>}
      />

      {/* LA TIENDA Y EN QUÉ PUNTO ESTÁ: el contexto de todo lo de abajo. Sin
          esto, dos tarjetas de firmas no dicen de qué inventario hablan. */}
      <View style={[styles.banda, angosto && styles.bandaApilada]}>
        <View style={styles.bandaTienda}>
          <ChipIcono icono={Store} />
          <View style={styles.bandaTextos}>
            <Text style={styles.bandaEtiqueta}>Inventario a lacrar</Text>
            <Text style={styles.bandaTitulo}>{nombreSucursal ?? 'Sin tienda'}</Text>
            {cifras !== null ? <Text style={styles.bandaSub}>{cifras}</Text> : null}
          </View>
        </View>

        <View style={[styles.cartel, estilosCartel[cartel.tono]]}>
          <ShieldCheck size={22} color={tintaCartel[cartel.tono]} />
          <View style={styles.cartelTextos}>
            <Text style={[styles.cartelTitulo, { color: tintaCartel[cartel.tono] }]}>{cartel.titulo}</Text>
            <Text style={styles.cartelDetalle}>{cartel.detalle}</Text>
          </View>
        </View>
      </View>

      {/* Lo que en el teléfono sería un `Alert.alert`. Ver el encabezado. */}
      {aviso !== null ? (
        <View style={styles.avisoAccion}>
          <Text style={styles.avisoAccionTitulo}>{aviso.titulo}</Text>
          <Text style={styles.avisoAccionTexto}>{aviso.detalle}</Text>
        </View>
      ) : null}

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : error !== null ? (
        <TarjetaWeb titulo="No se pudo cargar el lacrado" icono={Lock} tono="neutro">
          <Text style={styles.parrafo}>{error}</Text>
          <BotonWeb etiqueta="Reintentar" variante="principal" onPress={() => void cargar()} />
        </TarjetaWeb>
      ) : !inventarioId ? (
        <TarjetaWeb titulo="Todavía no hay nada que lacrar" icono={Lock} tono="neutro">
          <Text style={styles.parrafo}>
            No hay ningún inventario listo para lacrar en esta sucursal. El lacrado llega cuando el conteo del ciclo ya
            cerró: mientras las cantidades todavía se pueden recontar, no hay nada que sellar.
          </Text>
        </TarjetaWeb>
      ) : (
        <>
          {/* Se dibuja SOLO cuando hay algo pendiente: con todo sincronizado
              `BandaSync` devuelve null, igual que en el teléfono. */}
          <BandaSync
            estado={estado?.todoSincronizado ? 'ok' : 'pendiente'}
            mensaje={estado?.todoSincronizado ? 'Sincronizado con Dynamics' : 'Pendiente de sincronizar · esperando WiFi de tienda'}
          />

          <View style={[styles.fila, angosto && styles.filaApilada]}>
            {/* LAS FIRMAS: la columna ancha. Es la lista que hay que leer
                antes de decidir, y crece con la cantidad de auditores. */}
            <TarjetaWeb
              titulo={aprobacionesRequeridas === 1 ? 'Validación de auditoría' : 'Doble validación'}
              sub={`${aprobacionesHechas} de ${aprobacionesRequeridas} ${pluralizar(aprobacionesRequeridas, 'firma', 'firmas')}`}
              icono={ShieldCheck}
              tono={todasAprobadas ? 'ok' : 'atencion'}
              style={styles.columnaAncha}
            >
              <Text style={styles.parrafo}>
                {aprobacionesRequeridas === 1 ? (
                  <>
                    Hace falta la firma de <Text style={styles.negrita}>un auditor</Text>, desde su propia sesión.
                  </>
                ) : (
                  <>
                    Hacen falta las firmas de <Text style={styles.negrita}>{aprobacionesRequeridas} auditores distintos</Text>, cada
                    uno desde su propia sesión.
                  </>
                )}{' '}
                Nadie puede aprobar en nombre de otro: la única fila con botón es la de quien está logueado.
              </Text>

              {auditores.map((auditor) => {
                const aprobacion = estado?.aprobaciones.find((a) => a.colaboradorId === auditor.id);
                const esMiFila = auditor.id === yo;
                return (
                  <View key={auditor.id} style={[styles.firmaFila, esMiFila && styles.firmaFilaPropia]}>
                    <View style={styles.firmaDatos}>
                      <Text style={styles.firmaNombre}>{auditor.nombre}</Text>
                      <Text style={styles.firmaSub}>
                        {aprobacion ? `Firmó el ${formatoFechaHora(aprobacion.fecha)}` : 'Auditor'}
                        {esMiFila ? ' · sesión actual' : ''}
                      </Text>
                    </View>
                    {aprobacion ? (
                      <Pill texto="Aprobado" tinta={colors.ok} fondo={colors.okSuave} />
                    ) : esMiFila ? (
                      // El ÚNICO botón de acción que no es el rojo. Secundario
                      // a propósito: el rojo de esta pantalla es lacrar, y dos
                      // rojos compitiendo es un formulario donde no se sabe
                      // cuál toca.
                      <View style={styles.firmaBoton}>
                        <BotonWeb
                          etiqueta="Aprobar"
                          icono={Check}
                          onPress={() => void aprobar()}
                          cargando={aprobando}
                          deshabilitado={!!estado?.lacrado}
                        />
                      </View>
                    ) : (
                      // Sin botón, y a propósito: la fila se ve para que se
                      // entienda quién falta, pero no es tocable por quien no
                      // es esa persona.
                      <Pill texto="Falta su firma" tinta={colors.gris} fondo={colors.esperaSuave} />
                    )}
                  </View>
                );
              })}

              {avisoFirmas ? <Text style={styles.avisoFirmas}>{avisoFirmas}</Text> : null}
            </TarjetaWeb>

            <View style={styles.columnaAngosta}>
              <TarjetaWeb
                titulo="Lacrado digital"
                sub={estado?.lacrado ? 'Lacrado' : 'Bloqueado'}
                icono={Lock}
                tono={estado?.lacrado ? 'ok' : 'marca'}
              >
                {/* LA CITA VIAJÓ ACÁ, pegada al botón: es lo que hay que haber
                    leído antes de firmar, y en el teléfono estaba cuatro
                    tarjetas más arriba. */}
                <View style={styles.citaBloque}>
                  <Text style={styles.cita}>
                    “Cierras el mes, firmas, sellas y lacras. El inventario queda grabado de forma inmutable; cualquier
                    ajuste posterior entra en el siguiente período.”
                  </Text>
                  <Text style={styles.citaAutor}>— acordado en la reunión de requisitos</Text>
                </View>

                {estado?.lacrado ? (
                  <View style={styles.resultadoLacrado}>
                    <Check size={16} color={colors.ok} />
                    <Text style={styles.resultadoTexto}>
                      Inventario lacrado. Hash ID: <Text style={styles.resultadoHash}>{estado.hash}</Text>. Los{' '}
                      {items ? formatoMiles(items) : ''} ítems quedan grabados de forma inmutable; cualquier ajuste entra
                      en el período siguiente.
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.parrafo}>{textoLacrado}</Text>
                )}

                {!estado?.lacrado ? (
                  // EL botón de la pantalla. Es el único rojo, y cuando no se
                  // puede queda APAGADO y a la vista, no escondido.
                  <BotonWeb
                    etiqueta="Ejecutar lacrado digital"
                    icono={Lock}
                    variante="principal"
                    onPress={() => setModalVisible(true)}
                    cargando={lacrando}
                    deshabilitado={!puedeLacrar}
                  />
                ) : null}
              </TarjetaWeb>

              <TarjetaWeb
                titulo="Envío a Dynamics"
                sub={estado?.registradoManualmenteEnDynamics ? 'Registrado manualmente' : 'Pendiente'}
                icono={Cloud}
                tono={estado?.registradoManualmenteEnDynamics ? 'ok' : 'neutro'}
                // Apagada mientras no se lacró: `exactOptionalPropertyTypes`
                // no acepta `style={undefined}`, así que la prop no se manda.
                {...(estado?.lacrado ? {} : { style: styles.tarjetaBloqueada })}
              >
                <Text style={styles.parrafo}>
                  El ajuste automático a Dynamics es una funcionalidad de <Text style={styles.negrita}>fase 2</Text>. Por
                  ahora, el equipo de TI registra manualmente el resultado lacrado en el ERP.
                </Text>
                <BotonWeb
                  etiqueta={estado?.registradoManualmenteEnDynamics ? 'Registrado por TI' : 'Marcar como registrado manualmente'}
                  icono={Check}
                  onPress={() => void marcarDynamics()}
                  cargando={registrando}
                  deshabilitado={!estado?.lacrado || !!estado?.registradoManualmenteEnDynamics}
                />
              </TarjetaWeb>
            </View>
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
              <Text style={styles.negrita}>congelado de forma inmutable</Text>: no hay forma de deshacerlo ni de editar
              los conteos. Cualquier ajuste posterior entra en el período siguiente.
            </Text>
            <View style={styles.modalAcciones}>
              <View style={styles.modalBoton}>
                <BotonWeb etiqueta="Cancelar" onPress={() => setModalVisible(false)} />
              </View>
              <View style={styles.modalBoton}>
                <BotonWeb etiqueta="Confirmar lacrado" icono={Lock} variante="principal" onPress={() => void confirmarLacrado()} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

/**
 * La pill de estado de una firma. No usa `BadgeEstado` porque ese componente
 * tipa su prop como `VeredictoAuditoria` — los cinco estados de un ÍTEM del
 * inventario — y "Aprobado" / "Falta su firma" no son ninguno de ellos.
 * Forzarlos ahí le sacaría a ese tipo justo la garantía que lo hace valer.
 */
function Pill({ texto, tinta, fondo }: { texto: string; tinta: string; fondo: string }): JSX.Element {
  return (
    <View style={[styles.pill, { backgroundColor: fondo }]}>
      <View style={[styles.pillPunto, { backgroundColor: tinta }]} />
      <Text style={[styles.pillTexto, { color: tinta }]} numberOfLines={1}>
        {texto}
      </Text>
    </View>
  );
}

const tintaCartel = { ok: colors.ok, atencion: colors.proceso, neutro: colors.gris } as const;

const estilosCartel = StyleSheet.create({
  ok: { backgroundColor: colors.okSuave },
  atencion: { backgroundColor: colors.procesoSuave },
  neutro: { backgroundColor: colors.esperaSuave },
});

const styles = StyleSheet.create({
  pagina: { flex: 1 },
  contenido: { padding: spacing.xxl, gap: spacing.lg },
  centro: { flex: 1 },
  cargando: { marginTop: spacing.xxl },
  /** Acotado: el botón del encabezado es un recargar, no la acción de la página. */
  accionEncabezado: { width: 170 },

  banda: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.blanco,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borde,
    padding: spacing.lg,
    ...shadow.tarjeta,
  },
  bandaApilada: { flexDirection: 'column', alignItems: 'stretch' },
  bandaTienda: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bandaTextos: { flex: 1, gap: 2 },
  bandaEtiqueta: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },
  bandaTitulo: { fontSize: fontSize.lg, color: colors.tinta, fontFamily: fonts.bold },
  bandaSub: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },

  cartel: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.lg, padding: spacing.md, minWidth: 320 },
  cartelTextos: { flex: 1, gap: 1 },
  cartelTitulo: { fontSize: fontSize.lg, fontFamily: fonts.bold },
  cartelDetalle: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },

  /**
   * El error de una acción. Va arriba de todo y en la paleta `falta`: algo que
   * la persona pidió no se hizo, y en esta pantalla eso no puede pasar en
   * silencio.
   */
  avisoAccion: {
    gap: 2,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.falta,
    backgroundColor: colors.faltaSuave,
  },
  avisoAccionTitulo: { fontSize: fontSize.base, color: colors.falta, fontFamily: fonts.bold },
  avisoAccionTexto: { fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.regular, lineHeight: 19 },

  fila: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  filaApilada: { flexDirection: 'column' },
  /** Las firmas mandan: se llevan casi dos tercios del ancho. */
  columnaAncha: { flex: 1.45 },
  columnaAngosta: { flex: 1, gap: spacing.lg },

  parrafo: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular, lineHeight: 20 },
  negrita: { fontFamily: fonts.bold, color: colors.tinta },

  citaBloque: { gap: 3, paddingLeft: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.rojoSuave },
  cita: { fontSize: fontSize.base, lineHeight: 22, color: colors.tinta, fontFamily: fonts.medium, fontStyle: 'italic' },
  citaAutor: { fontSize: fontSize.xs, color: colors.grisClaro, fontFamily: fonts.regular },

  firmaFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.lg,
  },
  /**
   * La fila propia se distingue por el borde, no por el rojo de marca: el rojo
   * es la acción. Si además tiñera la fila, competirían.
   */
  firmaFilaPropia: { borderColor: colors.tinta, borderWidth: 1.5 },
  firmaDatos: { flex: 1, minWidth: 0, gap: 2 },
  firmaNombre: { fontSize: fontSize.base, color: colors.tinta, fontFamily: fonts.bold },
  firmaSub: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },
  /** Ancho acotado: un botón estirado a media fila se lee como la acción de la página, y no lo es. */
  firmaBoton: { width: 170 },

  avisoFirmas: {
    fontSize: fontSize.sm,
    lineHeight: 19,
    color: colors.proceso,
    fontFamily: fonts.medium,
    backgroundColor: colors.procesoSuave,
    padding: spacing.md,
    borderRadius: radius.md,
  },

  resultadoLacrado: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  resultadoTexto: { flex: 1, fontSize: fontSize.sm, lineHeight: 20, color: colors.gris, fontFamily: fonts.regular },
  resultadoHash: { fontFamily: fonts.bold, color: colors.tinta, fontVariant: ['tabular-nums'] },

  /** Apagada mientras no se lacró: se ve, pero se lee que todavía no es su turno. */
  tarjetaBloqueada: { opacity: 0.55 },

  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 10, borderRadius: radius.full },
  pillPunto: { width: 6, height: 6, borderRadius: radius.full },
  pillTexto: { fontSize: fontSize.xs, fontFamily: fonts.semibold },

  modalFondo: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  modalCaja: {
    width: '100%',
    maxWidth: 520,
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.blanco,
    borderRadius: radius.xl,
    ...shadow.modal,
  },
  modalTitulo: { fontSize: fontSize.xl, color: colors.tinta, fontFamily: fonts.bold },
  modalTexto: { fontSize: fontSize.base, lineHeight: 23, color: colors.gris, fontFamily: fonts.regular },
  modalAcciones: { flexDirection: 'row', gap: spacing.md },
  modalBoton: { flex: 1 },
});
