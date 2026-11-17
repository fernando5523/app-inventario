import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, CircleSlash, XCircle } from 'lucide-react-native';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ModalDecision } from '../../../components/aprobacion/ModalDecision';
import { Badge, Button, ScreenContainer, formatoFechaHora, formatoMoneda } from '../../../components/ui';
import { decidirLinea, decidirTodas, esSesionVencida, mensajeParaAprobadora, traerSolicitud } from '../../../lib/aprobacion/aprobacion-api';
import {
  ETIQUETA_DECISION,
  ETIQUETA_ESTADO,
  VARIANTE_DECISION,
  VARIANTE_ESTADO,
  fechaDeSolicitud,
  pendientesDe,
  textoCantidad,
  textoEspera,
  textoProductos,
} from '../../../lib/aprobacion/presentacion';
import { useAprobador } from '../../../lib/aprobacion/sesion-aprobador';
import type { LineaSolicitud, SolicitudDetalle } from '../../../lib/aprobacion/tipos';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../../lib/theme';

type Masiva = { aprobar: boolean } | null;

/** Una solicitud con sus productos: aquí la aprobadora decide. */
export default function DetalleSolicitud(): JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sesion, salir } = useAprobador();
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<SolicitudDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; aprobado: boolean } | null>(null);
  const [refrescando, setRefrescando] = useState(false);
  const [lineaAbierta, setLineaAbierta] = useState<LineaSolicitud | null>(null);
  const [masiva, setMasiva] = useState<Masiva>(null);
  const [ocupado, setOcupado] = useState(false);
  const token = sesion?.token;

  const manejarError = useCallback(
    (e: unknown): void => {
      if (esSesionVencida(e)) {
        salir();
        return;
      }
      setError(mensajeParaAprobadora(e));
    },
    [salir],
  );

  const cargar = useCallback(async (): Promise<void> => {
    if (!token || !id) return;
    try {
      setS(await traerSolicitud(token, id));
      setError(null);
    } catch (e) {
      manejarError(e);
    }
  }, [token, id, manejarError]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!sesion) return <Redirect href="/aprobador" />;

  const pend = s ? pendientesDe(s.lineas) : { cantidad: 0, importe: 0 };
  const puedeDecidir = s?.estado === 'pendiente' && pend.cantidad > 0;

  const decidirUna = async (linea: LineaSolicitud, aprobar: boolean, comentario: string): Promise<void> => {
    if (!token || !s) return;
    setOcupado(true);
    setAviso(null);
    try {
      const actualizada = await decidirLinea(token, s.id, linea.linea, aprobar, comentario);
      setS(actualizada);
      setLineaAbierta(null);
      setError(null);
      setAviso({ texto: `${linea.codigo} ${aprobar ? 'aprobado' : 'rechazado'}.`, aprobado: aprobar });
    } catch (e) {
      manejarError(e);
      setLineaAbierta(null);
      void cargar();
    } finally {
      setOcupado(false);
    }
  };

  const decidirResto = async (aprobar: boolean, comentario: string): Promise<void> => {
    if (!token || !s) return;
    setOcupado(true);
    setAviso(null);
    try {
      const r = await decidirTodas(token, s.id, aprobar, comentario);
      setS(r.solicitud);
      setMasiva(null);
      setError(r.error ? `Se decidieron ${r.decididas} productos y uno no se pudo guardar: ${r.error}` : null);
    } catch (e) {
      manejarError(e);
      setMasiva(null);
      void cargar();
    } finally {
      setOcupado(false);
    }
  };

  const esUltima = pend.cantidad === 1;

  return (
    <View style={styles.raiz}>
      <ScreenContainer
        scrollable
        style={puedeDecidir ? { paddingBottom: 132 + insets.bottom } : undefined}
        contentStyle={styles.contenido}
        refreshControl={
          <RefreshControl
            refreshing={refrescando}
            onRefresh={async () => {
              setRefrescando(true);
              await cargar();
              setRefrescando(false);
            }}
            colors={[colors.rojo]}
          />
        }
      >
        <View style={styles.cabecera}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Volver" hitSlop={10}>
            <ArrowLeft size={22} color={colors.tinta} />
          </Pressable>
          <Text style={styles.titulo}>Solicitud {id}</Text>
          {s ? <Badge label={ETIQUETA_ESTADO[s.estado]} variant={VARIANTE_ESTADO[s.estado]} /> : null}
        </View>

        {s === null && error === null ? <ActivityIndicator color={colors.rojo} style={styles.cargando} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {/* Un rechazo no es un éxito: se confirma en neutro, no en verde. */}
        {aviso ? <Text style={[styles.aviso, !aviso.aprobado && styles.avisoNeutro]}>{aviso.texto}</Text> : null}

        {s ? (
          <>
            <Resultado s={s} />

            <View style={styles.tarjeta}>
              <Dato etiqueta="Almacén" valor={`${s.almacenNombre || '—'} (${s.almacenId})`} />
              <Dato etiqueta="Fecha" valor={fechaDeSolicitud(s.fecha)} />
              <Dato etiqueta="Motivo del retiro" valor={s.motivo || '—'} />
              <Dato etiqueta="Quién retira" valor={s.retiraNombre || '—'} />
              <Dato etiqueta="Autorizado por" valor={s.autorizaNombre || '—'} />
              <Dato etiqueta="Solicitado por" valor={s.solicitaNombre || '—'} />
              <Dato
                etiqueta="Enviada"
                valor={s.enviadaEn ? `${formatoFechaHora(s.enviadaEn)}${s.estado === 'pendiente' ? ` · ${textoEspera(s.horasEsperando)}` : ''}` : '—'}
              />
            </View>

            <View style={styles.seccion}>
              <Text style={styles.seccionTitulo}>{textoProductos(s.lineas.length)}</Text>
              <Text style={styles.seccionTotal}>Total S/ {formatoMoneda(s.importeTotal)}</Text>
            </View>
            {puedeDecidir ? <Text style={styles.ayuda}>Toca un producto para aprobarlo o rechazarlo.</Text> : null}

            {s.lineas.map((l) => {
              const decidible = s.estado === 'pendiente' && l.decision === 'pendiente';
              return (
                <Pressable
                  key={l.linea}
                  onPress={decidible ? () => setLineaAbierta(l) : undefined}
                  disabled={!decidible}
                  accessibilityRole={decidible ? 'button' : 'text'}
                  accessibilityLabel={decidible ? `Decidir ${l.nombre}` : `${l.nombre}: ${ETIQUETA_DECISION[l.decision]}`}
                  style={({ pressed }) => [styles.linea, decidible && styles.lineaPendiente, pressed && styles.presionada]}
                >
                  <View style={styles.lineaFila}>
                    <Text style={styles.lineaCodigo}>{l.codigo}</Text>
                    <Badge label={ETIQUETA_DECISION[l.decision]} variant={VARIANTE_DECISION[l.decision]} />
                  </View>
                  <Text style={styles.lineaNombre} numberOfLines={2}>
                    {l.nombre}
                  </Text>
                  <View style={styles.lineaFila}>
                    <Text style={styles.lineaCantidad}>{textoCantidad(l)}</Text>
                    <View style={styles.lineaImporteFila}>
                      <Text style={styles.lineaImporte}>S/ {formatoMoneda(l.importe)}</Text>
                      {decidible ? <ChevronRight size={18} color={colors.grisClaro} /> : null}
                    </View>
                  </View>
                  {l.precio === 0 ? <Text style={styles.sinPrecio}>Sin precio de venta en este almacén</Text> : (
                    <Text style={styles.lineaPrecio}>Precio S/ {formatoMoneda(l.precio)} por {l.unidad}</Text>
                  )}
                  {l.decision !== 'pendiente' ? (
                    <Text style={styles.lineaDecision}>
                      {ETIQUETA_DECISION[l.decision]} por {l.decididoPor || '—'}
                      {l.decididoEn ? ` · ${formatoFechaHora(l.decididoEn)}` : ''}
                      {l.comentario ? ` · "${l.comentario}"` : ''}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </>
        ) : null}
      </ScreenContainer>

      {puedeDecidir ? (
        <View style={[styles.accionFija, { paddingBottom: spacing.md + insets.bottom }]}>
          <Button label={`Aprobar ${pend.cantidad === 1 ? 'el producto' : `los ${pend.cantidad}`} (S/ ${formatoMoneda(pend.importe)})`} size="lg" onPress={() => setMasiva({ aprobar: true })} />
          <Button label={pend.cantidad === 1 ? 'Rechazar el producto' : 'Rechazar todo'} variant="outline" onPress={() => setMasiva({ aprobar: false })} />
        </View>
      ) : null}

      {s && lineaAbierta ? (
        <ModalLinea
          linea={lineaAbierta}
          esUltima={esUltima}
          ocupado={ocupado}
          onCerrar={() => setLineaAbierta(null)}
          onDecidir={(aprobar, comentario) => void decidirUna(lineaAbierta, aprobar, comentario)}
        />
      ) : null}

      <ModalDecision
        visible={masiva !== null}
        titulo={masiva?.aprobar ? 'Aprobar todo' : 'Rechazar todo'}
        detalle={`${textoProductos(pend.cantidad)} por decidir · S/ ${formatoMoneda(pend.importe)}`}
        consecuencia={
          masiva?.aprobar
            ? 'Al aprobar, Dynamics registra la salida del inventario de los productos aprobados. No se puede deshacer.'
            : 'Los productos rechazados no salen del inventario. Si no queda ninguno aprobado, la solicitud se cierra como rechazada. No se puede deshacer.'
        }
        etiquetaConfirmar={masiva?.aprobar ? 'Sí, aprobar y registrar' : 'Sí, rechazar'}
        conComentario={masiva?.aprobar === false}
        ocupado={ocupado}
        onConfirmar={(comentario) => masiva && void decidirResto(masiva.aprobar, comentario)}
        onCerrar={() => setMasiva(null)}
      />
    </View>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }): JSX.Element {
  return (
    <View style={styles.dato}>
      <Text style={styles.datoEtiqueta}>{etiqueta}</Text>
      <Text style={styles.datoValor}>{valor}</Text>
    </View>
  );
}

/** El resultado final, en términos de lo que pasó con el inventario. */
function Resultado({ s }: { s: SolicitudDetalle }): JSX.Element | null {
  switch (s.estado) {
    case 'registrada':
      return (
        <View style={[styles.resultado, styles.resultadoOk]}>
          <CheckCircle2 size={20} color={colors.ok} />
          <Text style={[styles.resultadoTexto, { color: colors.ok }]}>
            Salida registrada en Dynamics{s.diario ? ` (diario ${s.diario})` : ''} por S/ {formatoMoneda(s.importeAprobado)}.
          </Text>
        </View>
      );
    case 'rechazada':
      return (
        <View style={[styles.resultado, styles.resultadoNeutro]}>
          <XCircle size={20} color={colors.gris} />
          <Text style={[styles.resultadoTexto, { color: colors.gris }]}>Solicitud rechazada: no salió nada del inventario.</Text>
        </View>
      );
    case 'error-registro':
      return (
        <View style={[styles.resultado, styles.resultadoError]}>
          <AlertTriangle size={20} color={colors.falta} />
          <Text style={[styles.resultadoTexto, { color: colors.falta }]}>
            Tu decisión quedó guardada, pero Dynamics no pudo registrar la salida
            {s.mensajeRegistro ? `: ${s.mensajeRegistro}` : '.'} Joselin lo revisará en Dynamics; no tienes que hacer nada más.
          </Text>
        </View>
      );
    case 'anulada':
      return (
        <View style={[styles.resultado, styles.resultadoNeutro]}>
          <CircleSlash size={20} color={colors.gris} />
          <Text style={[styles.resultadoTexto, { color: colors.gris }]}>La tienda anuló esta solicitud.</Text>
        </View>
      );
    default:
      return null;
  }
}

interface ModalLineaProps {
  linea: LineaSolicitud;
  esUltima: boolean;
  ocupado: boolean;
  onDecidir: (aprobar: boolean, comentario: string) => void;
  onCerrar: () => void;
}

/** Decidir un producto. Si es el último por decidir, avisa que con eso se registra la salida. */
function ModalLinea({ linea, esUltima, ocupado, onDecidir, onCerrar }: ModalLineaProps): JSX.Element {
  const [comentario, setComentario] = useState('');
  return (
    <Modal visible transparent animationType="fade" onRequestClose={ocupado ? () => undefined : onCerrar}>
      <KeyboardAvoidingView behavior="padding" style={styles.modalRaiz}>
        <Pressable style={styles.modalFondo} onPress={ocupado ? undefined : onCerrar} accessibilityLabel="Cerrar" />
        <View style={styles.modalCaja}>
          <Text style={styles.modalTitulo}>{linea.nombre}</Text>
          <Text style={styles.modalDetalle}>
            {linea.codigo} · {textoCantidad(linea)} · S/ {formatoMoneda(linea.importe)}
          </Text>
          {esUltima ? (
            <Text style={styles.modalConsecuencia}>
              Es el último producto por decidir: al decidirlo, Dynamics registra la salida de los productos aprobados. No se puede deshacer.
            </Text>
          ) : null}
          <Text style={styles.modalLabel}>Comentario (opcional)</Text>
          <TextInput
            value={comentario}
            onChangeText={setComentario}
            placeholder="Ej.: no corresponde a consumo de la tienda"
            placeholderTextColor={colors.grisClaro}
            style={styles.modalInput}
            maxLength={200}
            multiline
            editable={!ocupado}
          />
          <Button label={esUltima ? 'Aprobar y registrar' : 'Aprobar'} size="lg" loading={ocupado} disabled={ocupado} onPress={() => onDecidir(true, comentario)} />
          <Button label="Rechazar" variant="outline" disabled={ocupado} onPress={() => onDecidir(false, comentario)} />
          <Button label="Volver" variant="ghost" disabled={ocupado} onPress={onCerrar} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: colors.fondo },
  contenido: { padding: spacing.lg, gap: spacing.md },
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  titulo: { flex: 1, fontFamily: fonts.bold, fontSize: fontSize.lg, color: colors.tinta },
  cargando: { marginTop: spacing.xxxl },
  error: { fontFamily: fonts.medium, fontSize: 13.5, color: colors.falta, backgroundColor: colors.faltaSuave, borderRadius: radius.md, padding: spacing.md },
  aviso: { fontFamily: fonts.medium, fontSize: 13.5, color: colors.ok, backgroundColor: colors.okSuave, borderRadius: radius.md, padding: spacing.md },
  avisoNeutro: { color: colors.tinta, backgroundColor: colors.esperaSuave },
  tarjeta: { borderWidth: 1, borderColor: colors.borde, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  dato: { gap: 1 },
  datoEtiqueta: { fontFamily: fonts.medium, fontSize: 12, color: colors.gris },
  datoValor: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.tinta },
  seccion: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: spacing.sm },
  seccionTitulo: { fontFamily: fonts.bold, fontSize: 15.5, color: colors.tinta },
  seccionTotal: { fontFamily: fonts.bold, fontSize: 15.5, color: colors.tinta },
  ayuda: { fontFamily: fonts.regular, fontSize: 13, color: colors.gris, marginTop: -spacing.sm },
  linea: { borderWidth: 1, borderColor: colors.borde, borderRadius: radius.lg, padding: spacing.md, gap: 3 },
  lineaPendiente: { borderColor: colors.proceso, borderLeftWidth: 4 },
  presionada: { backgroundColor: colors.rojoSuave },
  lineaFila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  lineaCodigo: { fontFamily: fonts.bold, fontSize: 14, color: colors.tinta },
  lineaNombre: { fontFamily: fonts.semibold, fontSize: 14, color: colors.tinta },
  lineaCantidad: { fontFamily: fonts.medium, fontSize: 13.5, color: colors.tinta },
  lineaImporteFila: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  lineaImporte: { fontFamily: fonts.bold, fontSize: 14.5, color: colors.tinta },
  lineaPrecio: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.gris },
  sinPrecio: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.proceso },
  lineaDecision: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.gris, marginTop: 2 },
  resultado: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', borderRadius: radius.md, padding: spacing.md },
  resultadoOk: { backgroundColor: colors.okSuave },
  resultadoNeutro: { backgroundColor: colors.esperaSuave },
  resultadoError: { backgroundColor: colors.faltaSuave },
  resultadoTexto: { flex: 1, fontFamily: fonts.semibold, fontSize: 13.5, lineHeight: 19 },
  accionFija: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.blanco,
    borderTopWidth: 1,
    borderTopColor: colors.borde,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
    ...shadow.tarjeta,
  },
  modalRaiz: { flex: 1, justifyContent: 'flex-end' },
  modalFondo: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  modalCaja: {
    backgroundColor: colors.blanco,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: spacing.xl,
    gap: spacing.md,
    ...shadow.modal,
  },
  modalTitulo: { fontFamily: fonts.bold, fontSize: fontSize.lg, color: colors.tinta },
  modalDetalle: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.tinta },
  modalConsecuencia: { fontFamily: fonts.regular, fontSize: 13.5, color: colors.proceso, backgroundColor: colors.procesoSuave, borderRadius: radius.md, padding: spacing.md, lineHeight: 19 },
  modalLabel: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.tinta },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 56,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.tinta,
    textAlignVertical: 'top',
  },
});
