import { router } from 'expo-router';
import { Check, Lock, Scale, TriangleAlert, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import {
  Badge,
  BarraApp,
  Button,
  ChipsFiltro,
  EmptyState,
  SelectorSucursal,
  TarjetaItemAuditoria,
  formatoMiles,
} from '../../components/ui';
import { interpretarCantidad } from '../../components/ui/cantidad-numerica';
import { cargarSeguro } from '../../lib/adaptadores/_http';
import { repositorioAjuste, repositorioAuditoria, repositorioInventario, repositorioSesion } from '../../lib/contenedor';
import { errorDeMotivo, faseDeCierre, puedeAjustar } from '../../lib/dominio/ajuste-final';
import { conteoFinal, diferenciaUnidades, veredicto } from '../../lib/dominio/auditoria';
import { pluralizar } from '../../lib/dominio/plural';
import { sucursalEnFoco } from '../../lib/dominio/sucursal-en-foco';
import type { ItemAuditoria, Sucursal } from '../../lib/dominio/tipos';
import { useSesion } from '../../lib/sesion-contexto';
import { useSucursalAuditada } from '../../lib/sucursal-auditada-contexto';
import { colors, fonts, radius, shadow, spacing } from '../../lib/theme';

type Filtro = 'sin-cuadrar' | 'todos';

/**
 * AJUSTE FINAL DEL AUDITOR — la pantalla donde cambia los valores contados
 * VIENDO EL STOCK.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ACÁ SÍ SE VE EL ERP
 * ---------------------------------------------------------------------------
 * Es lo contrario de la pantalla de corrección del Coordinador, y a propósito.
 * El conteo ciego protege el conteo: quien cuenta (y quien corrige lo contado)
 * no puede ver contra qué se compara, o "contar" se convierte en "copiar el
 * sistema". El Auditor entra DESPUÉS de todas las pasadas y su trabajo es
 * justamente comparar: esconderle el stock no protegería nada, solo le haría
 * imposible su tarea.
 *
 * ---------------------------------------------------------------------------
 * EL VALOR SE INGRESA EN UNIDADES
 * ---------------------------------------------------------------------------
 * Un solo campo, no cajas + sueltas. El Auditor no está recontando góndola:
 * está fijando la cifra final contra un stock del ERP que viene en unidades, y
 * pedirle que la exprese en empaques lo obligaría a hacer una división mental
 * para comparar dos números que ya están en la misma unidad. Viaja como
 * `{ empaques: [], sueltas: <unidades> }`, que es el cuerpo del contrato.
 *
 * ---------------------------------------------------------------------------
 * PRIMERO LOS QUE NO CUADRAN
 * ---------------------------------------------------------------------------
 * El filtro arranca en "Sin cuadrar" porque es lo único que el ajuste puede
 * cambiar de verdad: sobre 8.000 ítems, mostrar primero los 8.000 esconde los
 * 40 que importan. "Todos" está a un toque para quien quiera revisarlo entero.
 */
export default function AjusteScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inventarioId, setInventarioId] = useState<number | null>(null);
  const [fase, setFase] = useState<ReturnType<typeof faseDeCierre> | null>(null);
  const [items, setItems] = useState<ItemAuditoria[]>([]);
  const [filtro, setFiltro] = useState<Filtro>('sin-cuadrar');
  const [enEdicion, setEnEdicion] = useState<ItemAuditoria | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [cerrandoAjuste, setCerrandoAjuste] = useState(false);

  // La sucursal COMPARTIDA con Auditoría, Ciclo, Liquidación e Historial:
  // elegir acá la cambia en todas (ver lib/sucursal-auditada-contexto.tsx).
  const { elegida, elegir } = useSucursalAuditada();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  useEffect(() => {
    repositorioSesion.sucursales().then(setSucursales);
  }, []);
  const sucursalId = sucursalEnFoco({
    rol: sesion?.colaborador.rol ?? 'auditor',
    sucursalDeSesion: sesion?.sucursal?.id ?? null,
    elegida,
  });

  const cargar = useCallback(async () => {
    if (!sesion) return;
    if (sucursalId === null) {
      setItems([]);
      setInventarioId(null);
      setFase(null);
      setCargando(false);
      return;
    }
    setError(null);
    const falla = await cargarSeguro(async () => {
      const activo = await repositorioInventario.activo(sucursalId);
      setInventarioId(activo?.inventarioId ?? null);
      setFase(activo ? faseDeCierre(activo.estado, activo.rondaActiva, activo.totalHojas, activo.ultimaRondaCerrada) : null);
      setItems(activo ? await repositorioAuditoria.matriz(activo.inventarioId) : []);
    });
    setCargando(false);
    if (falla) setError(falla.message);
  }, [sesion, sucursalId]);

  // Pausado mientras hay un valor a medio escribir: un refresco a mitad de
  // tipear el motivo borraría el borrador (ver useRefrescoAlEnfocar.ts).
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar, { pausado: enEdicion !== null || guardando });

  // Cambió la tienda elegida: recargar YA y limpiar lo anterior ANTES. La
  // barra ya dice la tienda nueva, y dejar la matriz de la otra sería un
  // número con el apellido equivocado (mismo criterio que auditoria.tsx).
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    setItems([]);
    setCargando(true);
    void cargar();
  }, [cargar]);

  const sinCuadrar = useMemo(() => items.filter((i) => veredicto(i) === 'falta' || veredicto(i) === 'empresa'), [items]);
  const visibles = filtro === 'sin-cuadrar' ? sinCuadrar : items;

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  const enAjuste = fase !== null && puedeAjustar(fase);
  const nombreSucursal = sucursales.find((s) => s.id === sucursalId)?.nombre ?? sesion.sucursal?.nombre;

  async function guardarAjuste(item: ItemAuditoria, unidades: number, motivo: string): Promise<void> {
    if (inventarioId === null) return;
    setGuardando(true);
    try {
      // `empaques: []` + las unidades como sueltas: ver la cabecera. El valor
      // que el Auditor fija ya está en la unidad del ERP.
      await repositorioAjuste.ajustarItem(inventarioId, item.productoId, { empaques: [], sueltas: unidades, motivo });
      setEnEdicion(null);
      // Se vuelve a pedir la matriz entera: el ajuste puede cambiar el
      // veredicto del ítem (de "falta" a "cuadrado"), y con él el filtro
      // "Sin cuadrar" y los contadores de los chips. Recalcularlo a mano acá
      // sería una segunda copia de `veredicto()`.
      await cargar();
    } catch (e) {
      Alert.alert(
        'No se pudo ajustar el ítem',
        e instanceof Error ? e.message : 'Revisa la conexión con la tienda y vuelve a intentarlo.',
      );
    } finally {
      setGuardando(false);
    }
  }

  function confirmarCierre(): void {
    if (inventarioId === null) return;
    Alert.alert(
      'Cerrar el ajuste final',
      `Esto deja firmes los ${formatoMiles(items.length)} ${pluralizar(items.length, 'valor', 'valores')} de este inventario: son los que van a la liquidación y al lacrado. Después de esto nadie los cambia, ni tú ni el coordinador. No se puede deshacer.`,
      [
        { text: 'Seguir ajustando', style: 'cancel' },
        { text: 'Cerrar el ajuste', style: 'destructive', onPress: () => void cerrarAjusteAhora() },
      ],
    );
  }

  async function cerrarAjusteAhora(): Promise<void> {
    if (inventarioId === null) return;
    setCerrandoAjuste(true);
    try {
      await repositorioAjuste.cerrarAjuste(inventarioId);
      Alert.alert(
        'Ajuste cerrado',
        'El conteo de este inventario quedó cerrado. El paso que sigue es la liquidación.',
      );
      await cargar();
    } catch (e) {
      Alert.alert('No se pudo cerrar el ajuste', e instanceof Error ? e.message : 'Intenta de nuevo en un momento.');
    } finally {
      setCerrandoAjuste(false);
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
          rotulo="Auditoría · Ajuste final"
          sede={nombreSucursal}
          cifras={
            enAjuste
              ? `${formatoMiles(sinCuadrar.length)} ${pluralizar(sinCuadrar.length, 'ítem sin cuadrar', 'ítems sin cuadrar')} de ${formatoMiles(items.length)}`
              : undefined
          }
          onSalir={salir}
        />

        <SelectorSucursal label="Sucursal a auditar" sucursales={sucursales} sucursalId={sucursalId} onElegir={elegir} />

        {cargando ? (
          <ActivityIndicator color={colors.rojo} style={styles.spinner} />
        ) : error !== null ? (
          <EmptyState icon={TriangleAlert} title="No se pudo cargar el ajuste" subtitle={error}>
            <Button label="Volver a intentar" onPress={refrescar} />
          </EmptyState>
        ) : !enAjuste ? (
          // NO dice "vuelve a intentar": mientras el ajuste no se inicie esto
          // no cambia solo, y una regla de negocio disfrazada de error deja a
          // la persona tocando un botón en loop.
          <EmptyState
            icon={Lock}
            title="El ajuste final todavía no empezó"
            subtitle="El ajuste se inicia desde Ciclo de conteos, con la última ronda ya cerrada. Hasta entonces el coordinador todavía puede corregir lo que cargaron los contadores."
          >
            <Button label="Ir al ciclo de conteos" variant="outline" onPress={() => router.push('/auditor/ciclo')} />
          </EmptyState>
        ) : (
          <>
            <View style={styles.aviso}>
              <Scale size={16} color={colors.gris} />
              <Text style={styles.avisoTexto}>
                Toca un ítem para fijar su valor definitivo contra el stock del ERP. Cada cambio pide un motivo y queda
                registrado con tu nombre. Mientras dure el ajuste, el coordinador no puede corregir nada.
              </Text>
            </View>

            <ChipsFiltro
              opciones={[
                { id: 'sin-cuadrar', etiqueta: 'Sin cuadrar', contador: sinCuadrar.length },
                { id: 'todos', etiqueta: 'Todos', contador: items.length },
              ]}
              activo={filtro}
              onCambiar={(id) => setFiltro(id as Filtro)}
            />

            {visibles.length === 0 ? (
              <EmptyState
                icon={Check}
                title={filtro === 'sin-cuadrar' ? 'No queda ningún ítem sin cuadrar' : 'Este inventario no tiene ítems'}
                subtitle={
                  filtro === 'sin-cuadrar'
                    ? 'Todo lo que tiene stock del ERP y conteo coincide. Puedes cerrar el ajuste, o mirar la lista completa.'
                    : 'La matriz de auditoría llegó vacía: sin ítems no hay nada que ajustar.'
                }
              />
            ) : (
              <View style={styles.lista}>
                {visibles.map((item) => (
                  <Pressable
                    key={item.productoId}
                    onPress={() => setEnEdicion(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Ajustar ${item.descripcion}`}
                  >
                    {/* La MISMA tarjeta de la matriz de auditoría: ERP, una
                        celda por ronda y el veredicto. Reusarla es lo que
                        garantiza que el número que el Auditor ajusta sea el
                        mismo que vio en Auditoría -- si esta pantalla dibujara
                        su propia fila, el día que difieran nadie sabría cuál
                        creer. */}
                    <TarjetaItemAuditoria item={item} />
                  </Pressable>
                ))}
              </View>
            )}

            {/*
              EL CIERRE VA AL FINAL, después de la lista: es lo último que se
              hace, y arriba invitaría a firmar sin haber mirado los ítems.
            */}
            <View style={styles.tarjeta}>
              <Text style={styles.tarjetaTitulo}>Cerrar el ajuste final</Text>
              <Text style={styles.tarjetaTexto}>
                Los valores quedan firmes y pasan a la liquidación. Después de esto nadie los cambia: ni tú ni el
                coordinador.
              </Text>
              <Button
                label={cerrandoAjuste ? 'Cerrando el ajuste…' : 'Cerrar el ajuste y fijar los valores'}
                icon={Lock}
                onPress={confirmarCierre}
                disabled={cerrandoAjuste}
                loading={cerrandoAjuste}
              />
            </View>
          </>
        )}
      </PantallaConTabs>

      {/* Hermano del scroll, nunca adentro: ahí el overlay queda recortado y
          se desplaza con el contenido (mismo patrón que ModalConteo). */}
      <ModalAjusteItem
        item={enEdicion}
        guardando={guardando}
        onGuardar={(unidades, motivo) => void guardarAjuste(enEdicion!, unidades, motivo)}
        onCerrar={() => setEnEdicion(null)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

interface ModalAjusteItemProps {
  /** null = cerrado. */
  item: ItemAuditoria | null;
  guardando: boolean;
  onGuardar: (unidades: number, motivo: string) => void;
  onCerrar: () => void;
}

/**
 * El modal del ajuste: un valor en unidades, el motivo, y LA DIFERENCIA
 * CONTRA EL ERP RECALCULADA EN VIVO.
 *
 * Esa diferencia en vivo es la razón de que este modal exista y no se reuse
 * `ModalConteo`: el Auditor no está cargando una cantidad, está cerrando una
 * brecha. Ver el resultado antes de guardar es su trabajo entero -- sin eso
 * tendría que guardar, mirar la tarjeta, y volver a abrir si no dio.
 *
 * No es `<Modal>` nativo por el mismo bug de Android que documenta
 * ModalConteo.tsx: cerrar un Modal transparent+fade deja el primer toque
 * siguiente mal enrutado.
 */
function ModalAjusteItem({ item, guardando, onGuardar, onCerrar }: ModalAjusteItemProps): JSX.Element | null {
  const [texto, setTexto] = useState('');
  const [motivo, setMotivo] = useState('');

  // Arranca con el valor ACTUAL del ítem, no vacío: acá no se está cargando un
  // dato nuevo (donde un default sería "un dato que nadie verifica"), se está
  // corrigiendo uno que ya existe, y la persona necesita verlo para decidir
  // cuánto moverlo. Cada ítem estrena su propio motivo.
  useEffect(() => {
    if (item === null) return;
    const actual = conteoFinal(item);
    setTexto(actual === null ? '' : String(actual));
    setMotivo('');
  }, [item]);

  /**
   * EL BOTÓN ATRÁS CIERRA EL MODAL, no la pantalla.
   *
   * Sin esto el back de Android se lo lleva el navegador: sale del ajuste
   * entero y el valor a medio escribir se pierde sin aviso. Y como el teclado
   * tapaba el botón de guardar, el back era una de las salidas que la gente
   * probaba -- terminaba en la pantalla anterior creyendo que había cancelado
   * solo el modal.
   *
   * Se registra SOLO con el modal abierto (`item !== null`) para no robarle el
   * back a la navegación normal de la pantalla.
   */
  useEffect(() => {
    if (item === null) return;
    const suscripcion = BackHandler.addEventListener('hardwareBackPress', () => {
      intentarCerrar();
      return true;
    });
    return () => suscripcion.remove();
  });

  /**
   * Y TAMPOCO DESCARTA EN SILENCIO. Antes el back cerraba el modal y se
   * llevaba el valor y el motivo a medio escribir sin decir nada. Se pregunta
   * solo si hay algo distinto de lo que había al abrir: confirmar en cada
   * salida enseña a tocar "Descartar" sin leer.
   */
  function intentarCerrar(): void {
    const actual = item === null ? null : conteoFinal(item);
    const sinCambios = texto === (actual === null ? '' : String(actual)) && motivo.trim() === '';
    if (sinCambios) {
      onCerrar();
      return;
    }
    Alert.alert('Descartar el ajuste', 'Lo que escribiste para este ítem no se guardó todavía.', [
      { text: 'Seguir editando', style: 'cancel' },
      { text: 'Descartar', style: 'destructive', onPress: onCerrar },
    ]);
  }

  if (item === null) return null;

  const cantidad = interpretarCantidad(texto);
  const faltaMotivo = errorDeMotivo(motivo);
  const puedeGuardar = cantidad.ok && faltaMotivo === null && !guardando;

  // La diferencia que DEJARÍA este valor. Sale de `diferenciaUnidades`, la
  // misma función del dominio que pinta la tarjeta -- no de una resta a mano
  // acá, que sería la segunda copia de la fórmula.
  const previsualizacion = cantidad.ok
    ? diferenciaUnidades({ stockErp: item.stockErp, conteos: [cantidad.valor] })
    : null;

  return (
    <View style={styles.modalRaiz} pointerEvents="box-none">
      <Pressable style={styles.modalFondo} onPress={intentarCerrar} />
      <View pointerEvents="box-none" style={styles.modalCentrado}>
        <View style={[styles.modalCaja, shadow.modal]}>
          {/*
            `keyboardShouldPersistTaps="handled"` — EL ARREGLO DEL BOTÓN
            INALCANZABLE (probado en el emulador contra el backend real).

            Por default un ScrollView usa "never": con el teclado abierto, el
            PRIMER toque en cualquier hijo se consume para bajar el teclado y
            NO llega al control. En este modal el motivo es multilínea (no
            tiene tecla "listo" propia), así que el teclado quedaba abierto
            siempre y "Guardar el ajuste" nunca recibía un toque: no se pudo
            guardar ni una vez desde la app.

            Con "handled" el toque llega al botón a la primera, y un toque en
            un texto sigue bajando el teclado. Va también en ModalConteo, que
            tenía la misma trampa latente y solo se salvaba por ser más corto.
          */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.modalScroll}
          >
            <View style={styles.modalCabecera}>
              <Text style={styles.modalTitulo}>Ajustar valor</Text>
              <Pressable onPress={intentarCerrar} style={styles.modalCerrar} accessibilityLabel="Cerrar">
                <X size={18} color={colors.gris} />
              </Pressable>
            </View>

            <Text style={styles.modalProducto}>{item.descripcion}</Text>
            <Text style={styles.modalMeta}>Código {item.codigo}</Text>

            <View style={styles.modalComparacion}>
              <View style={styles.modalCelda}>
                <Text style={styles.modalCeldaEtiqueta}>Stock ERP</Text>
                {/* "—" y no 0: sin stock del ERP no hay contra qué comparar,
                    y un cero afirmaría que el ERP dice que no hay ninguno. */}
                <Text style={styles.modalCeldaValor}>{item.stockErp === null ? '—' : formatoMiles(item.stockErp)}</Text>
              </View>
              <View style={styles.modalCelda}>
                <Text style={styles.modalCeldaEtiqueta}>Último conteo</Text>
                <Text style={styles.modalCeldaValor}>
                  {conteoFinal(item) === null ? '—' : formatoMiles(conteoFinal(item)!)}
                </Text>
              </View>
            </View>

            <View style={styles.modalCampo}>
              <Text style={styles.modalEtiqueta}>Valor definitivo (unidades)</Text>
              <TextInput
                style={[styles.modalInput, !cantidad.ok && texto.length > 0 ? styles.modalInputError : null]}
                keyboardType="number-pad"
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                value={texto}
                placeholder="—"
                placeholderTextColor={colors.grisClaro}
                onChangeText={setTexto}
                selectTextOnFocus
                accessibilityLabel="Valor definitivo en unidades"
              />
              {!cantidad.ok && texto.length > 0 ? <Text style={styles.modalError}>{cantidad.mensaje}</Text> : null}
            </View>

            {/* EL RESULTADO, antes de guardar. Es para lo que el Auditor abrió
                este modal: saber si con este número el ítem cuadra. */}
            {previsualizacion !== null ? (
              <View style={[styles.modalResultado, previsualizacion === 0 && styles.modalResultadoOk]}>
                <Text style={[styles.modalResultadoTexto, previsualizacion === 0 && styles.modalResultadoTextoOk]}>
                  {previsualizacion === 0
                    ? 'Con este valor el ítem cuadra contra el ERP.'
                    : `Con este valor queda ${previsualizacion < 0 ? 'un faltante' : 'un sobrante'} de ${formatoMiles(Math.abs(previsualizacion))} ${pluralizar(Math.abs(previsualizacion), 'unidad', 'unidades')}.`}
                </Text>
              </View>
            ) : item.stockErp === null ? (
              <View style={styles.modalResultado}>
                <Text style={styles.modalResultadoTexto}>
                  Este ítem no tiene stock en el ERP: el valor se puede fijar igual, pero no hay contra qué compararlo.
                </Text>
              </View>
            ) : null}

            <View style={styles.modalCampo}>
              <Text style={styles.modalEtiqueta}>Motivo del cambio</Text>
              <TextInput
                style={[styles.modalInput, styles.modalInputMotivo]}
                multiline
                numberOfLines={2}
                // Un motivo no lleva saltos de línea, así que la tecla de
                // Enter se usa para CERRAR el teclado en vez de gastarla en un
                // salto que nadie quiere. Es la salida que faltaba: sin ella,
                // el único modo de bajar el teclado era tocar afuera, que
                // cerraba el modal y descartaba el cambio.
                submitBehavior="blurAndSubmit"
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                value={motivo}
                placeholder="Por qué fijas este valor"
                placeholderTextColor={colors.grisClaro}
                onChangeText={setMotivo}
                accessibilityLabel="Motivo del ajuste"
              />
            </View>

            {/*
              PRESSABLE PLANO, igual que el de ModalConteo, y NO el `Button`
              compartido: ese pone `accessibilityState={{ disabled }}`, y con
              el botón deshabilitado -- que es justo el estado mientras se
              tipea el motivo -- uiautomator dejaba de verlo en el árbol de
              accesibilidad. Un control que desaparece del árbol no se puede
              probar ni operar con lector de pantalla, aunque se vea.
            */}
            <Pressable
              style={[styles.guardar, !puedeGuardar && styles.guardarDeshabilitado]}
              onPress={() => onGuardar(cantidad.ok ? cantidad.valor : 0, motivo.trim())}
              disabled={!puedeGuardar}
              accessibilityLabel={`Guardar el ajuste de ${item.descripcion}`}
            >
              <Text style={[styles.guardarTexto, !puedeGuardar && styles.guardarTextoDeshabilitado]}>
                {guardando ? 'Guardando…' : 'Guardar el ajuste'}
              </Text>
            </Pressable>
            {/* QUÉ falta, no "no se puede". */}
            {!cantidad.ok ? (
              <Text style={styles.modalHint}>Escribe el valor definitivo en unidades.</Text>
            ) : faltaMotivo !== null ? (
              <Text style={styles.modalHint}>{faltaMotivo}</Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </View>
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
    backgroundColor: colors.esperaSuave,
  },
  avisoTexto: { flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.gris, fontFamily: fonts.regular },

  lista: { gap: 10 },

  tarjeta: {
    gap: spacing.sm,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.lg,
    backgroundColor: colors.campo,
  },
  tarjetaTitulo: { fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
  tarjetaTexto: { fontSize: 12.5, lineHeight: 18, color: colors.gris, fontFamily: fonts.regular },

  modalRaiz: { ...StyleSheet.absoluteFillObject, zIndex: 50, elevation: 50 },
  modalFondo: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  modalCentrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalCaja: {
    width: '100%',
    maxWidth: 330,
    maxHeight: '86%',
    padding: 17,
    backgroundColor: colors.campo,
    borderRadius: radius.xl,
  },
  modalCabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  modalTitulo: { fontSize: 15, color: colors.tinta, fontFamily: fonts.bold },
  modalCerrar: { padding: 4 },
  modalProducto: { marginTop: 10, fontSize: 14, color: colors.tinta, fontFamily: fonts.bold, lineHeight: 19 },
  modalMeta: { marginTop: 2, fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },

  modalComparacion: { flexDirection: 'row', gap: 8, marginTop: 12 },
  modalCelda: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.esperaSuave,
  },
  modalCeldaEtiqueta: {
    fontSize: 9.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.grisClaro,
    fontFamily: fonts.bold,
  },
  modalCeldaValor: { fontSize: 16, color: colors.tinta, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },

  modalCampo: { marginTop: 14 },
  modalEtiqueta: { marginBottom: 6, fontSize: 12, color: colors.gris, fontFamily: fonts.semibold },
  modalInput: {
    minHeight: 46,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.sm,
    fontSize: 15,
    color: colors.tinta,
    fontFamily: fonts.semibold,
    backgroundColor: colors.campo,
  },
  modalInputMotivo: { minHeight: 62, paddingTop: 10, fontFamily: fonts.regular, textAlignVertical: 'top' },
  modalInputError: { borderColor: colors.falta },
  modalError: { marginTop: 4, fontSize: 11.5, color: colors.falta, fontFamily: fonts.medium },

  // El resultado usa la paleta de ESTADO (`ok` cuando cuadra, `proceso`
  // mientras no), nunca el rojo de marca: el rojo acá es el botón de guardar.
  modalResultado: { marginTop: 12, padding: 11, borderRadius: radius.sm, backgroundColor: colors.procesoSuave },
  modalResultadoOk: { backgroundColor: colors.okSuave },
  modalResultadoTexto: { fontSize: 12.5, lineHeight: 17, color: colors.proceso, fontFamily: fonts.semibold },
  modalResultadoTextoOk: { color: colors.ok },

  modalHint: { marginTop: 8, fontSize: 11.5, lineHeight: 16, color: colors.grisClaro, fontFamily: fonts.regular },

  /**
   * Aire al final del scroll: con el teclado abierto el botón quedaba justo
   * en el borde de lo visible, así que "llegar al final" no alcanzaba para
   * poder tocarlo -- mismo problema que el tab bar sobre el último ítem de una
   * lista (ver PantallaConTabs.tsx).
   */
  modalScroll: { paddingBottom: spacing.md },
  guardar: {
    marginTop: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.rojo,
  },
  guardarTexto: { fontSize: 14.5, color: colors.blanco, fontFamily: fonts.bold },
  guardarDeshabilitado: { backgroundColor: '#DCD6D2' },
  guardarTextoDeshabilitado: { color: colors.gris },
});
