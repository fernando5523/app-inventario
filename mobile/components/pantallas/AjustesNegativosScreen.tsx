import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import {
  AlertTriangle,
  ChevronLeft,
  FileSpreadsheet,
  FileX2,
  MessageSquare,
  Upload,
  X,
} from 'lucide-react-native';
import { useCallback, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../hooks/useRefrescoAlEnfocar';
import { ajustesNegativosApi } from '../../lib/adaptadores/ajustes-negativos-api';
import { esErrorApi } from '../../lib/adaptadores/_http';
import {
  estadoNegativos,
  textoMotivoAdvertencia,
  textoMotivoRechazo,
  type ListadoLineasAjustesNegativos,
  type ResultadoPreviewAjustesNegativos,
} from '../../lib/dominio/ajustes-negativos';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';
import { BarraApp, Badge, Button, CampoTexto, Card, formatoFechaHora, formatoMoneda } from '../ui';

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type AccionLinea = 'excluir' | 'incluir';

/**
 * Ajustes: Excel de Dynamics (Pantalla del Auditor, contra
 * backend/src/modules/liquidacion/liquidacion.ajustes-negativos.ts, e39b370 +
 * a9d92da + b83da86). Reemplaza el monto de negativos que se tipeaba a mano
 * (liquidacion.ajustes.ts) por la importación del archivo que ya arma el área
 * de negativos.
 *
 * Recibe `inventarioId` como parámetro de ruta (`router.push({ pathname:
 * '/auditor/ajustes-negativos', params: { inventarioId: String(id) } })`):
 * la pantalla de Liquidación es quien sabe qué inventario tiene el conteo
 * cerrado de la sucursal elegida -- este archivo no lo decide de nuevo.
 *
 * FLUJO: elegir archivo → vista previa (válidas/rechazadas/advertencias, sin
 * persistir nada) → confirmar (recién ahí se guarda y se recalcula
 * montoNegativos) → excluir/incluir líneas puntuales de lo YA guardado
 * (GET .../ajustes-negativos/lineas), con motivo obligatorio.
 *
 * Ver skill trujillo-ui, "Honestidad de los datos en pantalla":
 * `estadoNegativos()` distingue "todavía no se importó" (bloquea liquidar)
 * de "se importó y dio 0" (no bloquea nada) con DOS textos distintos, nunca
 * el mismo cartel para los dos. Mismo criterio en el listado de líneas: una
 * importación vigente con 0 líneas útiles SIGUE siendo una importación real
 * (`listado.importacion` no es null), no "nada importado".
 *
 * `listado.puedeEditar` bloquea excluir/incluir EN LA PANTALLA (botones
 * deshabilitados) apenas el inventario queda liquidado/lacrado -- el backend
 * ya lo bloquea también (`validarEstadoParaAjustar`), así que esto es la
 * capa "no dejar ni tocar el botón", no la única barrera.
 */
export function AjustesNegativosScreen(): JSX.Element {
  const params = useLocalSearchParams<{ inventarioId?: string }>();
  const inventarioId = params.inventarioId ? Number(params.inventarioId) : null;

  const [cargando, setCargando] = useState(true);
  const [montoNegativos, setMontoNegativos] = useState<number | null>(null);
  const [listado, setListado] = useState<ListadoLineasAjustesNegativos | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [archivo, setArchivo] = useState<{ nombre: string; bytes: Uint8Array } | null>(null);
  const [previsualizando, setPrevisualizando] = useState(false);
  const [preview, setPreview] = useState<ResultadoPreviewAjustesNegativos | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const [modalLinea, setModalLinea] = useState<{ lineaId: number; accion: AccionLinea } | null>(null);
  const [textoMotivo, setTextoMotivo] = useState('');
  const [guardandoLineaId, setGuardandoLineaId] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    if (inventarioId === null) {
      setCargando(false);
      return;
    }
    setError(null);
    try {
      const [estado, lineas] = await Promise.all([
        ajustesNegativosApi.estado(inventarioId),
        ajustesNegativosApi.listarLineas(inventarioId),
      ]);
      setMontoNegativos(estado.montoNegativos);
      setListado(lineas);
    } catch (e) {
      setError(esErrorApi(e) ? e.message : 'No se pudo cargar el estado de los ajustes.');
    } finally {
      setCargando(false);
    }
  }, [inventarioId]);

  // Ningún dato actualizado depende de navegar a otra pantalla: al enfocar y
  // al volver a primer plano se releé el estado (útil sobre todo después de
  // confirmar una importación y volver más tarde a revisar).
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar);

  async function elegirArchivo(): Promise<void> {
    if (inventarioId === null) return;
    const resultado = await DocumentPicker.getDocumentAsync({ type: TIPO_XLSX, copyToCacheDirectory: true });
    if (resultado.canceled) return;

    const asset = resultado.assets[0]!;
    setPreview(null);
    setArchivo(null);
    setError(null);
    setPrevisualizando(true);
    try {
      const bytes = await new File(asset.uri).bytes();
      setArchivo({ nombre: asset.name, bytes });
      setPreview(await ajustesNegativosApi.previsualizar(inventarioId, bytes));
    } catch (e) {
      setError(esErrorApi(e) ? e.message : 'No se pudo leer el archivo.');
    } finally {
      setPrevisualizando(false);
    }
  }

  async function confirmar(): Promise<void> {
    if (inventarioId === null || archivo === null || preview?.ok !== true) return;
    setConfirmando(true);
    setError(null);
    try {
      const resultado = await ajustesNegativosApi.confirmar(inventarioId, archivo.bytes, archivo.nombre);
      setPreview(null);
      setArchivo(null);
      await cargar(); // trae el listado de líneas ya persistidas -- una sola fuente de verdad.
      Alert.alert(
        'Importación confirmada',
        `${resultado.nombreArchivo} · ${resultado.cantidadValidas} línea${resultado.cantidadValidas === 1 ? '' : 's'} válida${resultado.cantidadValidas === 1 ? '' : 's'} · S/ ${formatoMoneda(resultado.montoNegativos)}`,
      );
    } catch (e) {
      setError(esErrorApi(e) ? e.message : 'No se pudo confirmar la importación.');
    } finally {
      setConfirmando(false);
    }
  }

  function elegirOtroArchivo(): void {
    setPreview(null);
    setArchivo(null);
    setError(null);
  }

  function abrirModalLinea(lineaId: number, accion: AccionLinea): void {
    setTextoMotivo('');
    setModalLinea({ lineaId, accion });
  }

  function cerrarModalLinea(): void {
    setModalLinea(null);
    setTextoMotivo('');
  }

  async function confirmarMotivoLinea(): Promise<void> {
    if (inventarioId === null || modalLinea === null) return;
    const motivo = textoMotivo.trim();
    if (!motivo) return;

    setGuardandoLineaId(modalLinea.lineaId);
    setError(null);
    try {
      const resultado =
        modalLinea.accion === 'excluir'
          ? await ajustesNegativosApi.excluirLinea(inventarioId, modalLinea.lineaId, motivo)
          : await ajustesNegativosApi.incluirLinea(inventarioId, modalLinea.lineaId, motivo);

      setMontoNegativos(resultado.montoNegativos);
      setListado((actual) =>
        actual
          ? { ...actual, lineas: actual.lineas.map((l) => (l.id === resultado.linea.id ? resultado.linea : l)) }
          : actual,
      );
      cerrarModalLinea();
    } catch (e) {
      setError(esErrorApi(e) ? e.message : 'No se pudo guardar el cambio.');
    } finally {
      setGuardandoLineaId(null);
    }
  }

  const estado = estadoNegativos(montoNegativos);

  return (
    <PantallaConTabs
      scrollable
      contentStyle={styles.contenido}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={colors.rojo} colors={[colors.rojo]} />}
    >
      <BarraApp rotulo="Liquidación · Ajustes" sede="Excel de Dynamics" />

      {/*
       * `router.replace`, NUNCA `router.back()`: esta pantalla y Liquidación
       * son rutas de archivo dentro del MISMO <Tabs> plano de RolTabsLayout
       * (ninguna de las dos está en TABS_POR_ROL.auditor) -- un Tab Navigator
       * no lleva una pila lineal como un Stack, así que `back()` desde una
       * pantalla que no es un tab declarado puede resolver a la pestaña
       * INICIAL (Inicio) en vez de a la pantalla anterior real. Se vio en
       * vivo en la prueba end-to-end de liquidación (2026-09-11): "Volver a
       * Liquidación" saltaba a Inicio. `replace` a la ruta explícita es
       * determinístico pase lo que pase con el historial de navegación, y
       * no necesita `inventarioId`: Liquidación lo vuelve a calcular de la
       * sucursal compartida (SucursalAuditadaProvider), no de un parámetro.
       */}
      <Pressable
        style={styles.volver}
        onPress={() => router.replace('/auditor/liquidacion')}
        accessibilityRole="button"
      >
        <ChevronLeft size={15} color={colors.rojo} />
        <Text style={styles.volverTexto}>Volver a Liquidación</Text>
      </Pressable>

      {inventarioId === null ? (
        <Card style={styles.tarjeta}>
          <Text style={styles.aviso}>
            Falta el inventario: esta pantalla necesita abrirse desde Liquidación, con el inventario del ciclo
            cerrado de la sucursal elegida.
          </Text>
        </Card>
      ) : cargando ? (
        <View style={styles.centro}>
          <ActivityIndicator color={colors.rojo} />
        </View>
      ) : (
        <>
          <Card style={styles.tarjeta}>
            <View style={styles.filaCabecera}>
              <Text style={styles.tituloTarjeta}>Estado de los negativos de este mes</Text>
              <Badge label={estado.estado === 'sin-importar' ? 'Sin importar' : 'Importado'} variant={estado.estado === 'sin-importar' ? 'falta' : 'ok'} />
            </View>
            <Text style={styles.textoEstado}>{estado.texto}</Text>
            {estado.monto !== null ? <Text style={styles.montoGrande}>S/ {formatoMoneda(estado.monto)}</Text> : null}
          </Card>

          {error ? (
            <Card style={[styles.tarjeta, styles.tarjetaError]}>
              <Text style={styles.textoError}>{error}</Text>
            </Card>
          ) : null}

          <Card style={styles.tarjeta}>
            <Text style={styles.tituloTarjeta}>Importar el Excel del mes</Text>
            <Text style={styles.ayuda}>
              El archivo tiene que traer exactamente estos encabezados: Diario, Descripcion, Almacen, Codigo,
              Nombre2, Cantidad, Precio, Importe, Motivo de ajuste, Registrado en, Responsable. Columnas de más no
              molestan. Reimportar reemplaza la importación vigente -- la anterior queda registrada, no se borra.
            </Text>
            <Button
              label={previsualizando ? 'Leyendo archivo…' : 'Elegir archivo .xlsx'}
              icon={Upload}
              onPress={elegirArchivo}
              loading={previsualizando}
              disabled={previsualizando || confirmando}
            />
          </Card>

          {preview && !preview.ok ? (
            <Card style={[styles.tarjeta, styles.tarjetaError]}>
              <View style={styles.filaCabecera}>
                <FileX2 size={18} color={colors.falta} />
                <Text style={styles.tituloError}>
                  {preview.motivo === 'columna-faltante' ? 'Faltan columnas' : 'No se pudo leer el archivo'}
                </Text>
              </View>
              {/* Tal cual lo devuelve el backend: dice cuáles faltan y la estructura completa esperada. */}
              <Text style={styles.textoError}>{preview.detalle}</Text>
              <Button label="Elegir otro archivo" variant="outline" onPress={elegirOtroArchivo} style={styles.accionSecundaria} />
            </Card>
          ) : null}

          {preview && preview.ok ? (
            <Card style={styles.tarjeta}>
              <Text style={styles.tituloTarjeta}>Vista previa — {archivo?.nombre}</Text>
              <View style={styles.resumenFila}>
                <ResumenDato etiqueta="Válidas" valor={String(preview.validas.length)} />
                <ResumenDato etiqueta="Rechazadas" valor={String(preview.rechazadas.length)} tono={preview.rechazadas.length > 0 ? 'falta' : undefined} />
                <ResumenDato etiqueta="Monto que resultaría" valor={`S/ ${formatoMoneda(preview.totalImporte)}`} />
              </View>

              {preview.rechazadas.length > 0 ? (
                <View style={styles.bloqueLineas}>
                  <Text style={styles.subtitulo}>Rechazadas — no entran a la suma</Text>
                  {preview.rechazadas.map((r) => (
                    <Text key={r.fila} style={styles.filaLinea}>
                      Fila {r.fila}: {textoMotivoRechazo(r.motivo)}
                    </Text>
                  ))}
                </View>
              ) : null}

              {preview.validas.some((v) => v.advertencias.length > 0) ? (
                <View style={styles.bloqueLineas}>
                  <Text style={styles.subtitulo}>Válidas con advertencia — igual suman, decide si excluirlas después de confirmar</Text>
                  {preview.validas
                    .filter((v) => v.advertencias.length > 0)
                    .map((v) => (
                      <Text key={v.fila} style={styles.filaLinea}>
                        Fila {v.fila} ({v.codigo}): {v.advertencias.map(textoMotivoAdvertencia).join(' · ')}
                      </Text>
                    ))}
                </View>
              ) : null}

              <View style={styles.accionesFila}>
                <Button label="Elegir otro archivo" variant="outline" onPress={elegirOtroArchivo} style={styles.botonMitad} />
                <Button
                  label={confirmando ? 'Confirmando…' : 'Confirmar importación'}
                  onPress={confirmar}
                  loading={confirmando}
                  disabled={confirmando}
                  style={styles.botonMitad}
                />
              </View>
            </Card>
          ) : null}

          {listado && listado.importacion !== null ? (
            <Card style={styles.tarjeta}>
              <View style={styles.filaCabecera}>
                <FileSpreadsheet size={18} color={colors.tinta} />
                <Text style={styles.tituloTarjeta}>Líneas importadas</Text>
              </View>
              <Text style={styles.ayuda}>
                {listado.importacion.nombreArchivo} · importado por {listado.importacion.importadoPor.nombre} el{' '}
                {formatoFechaHora(listado.importacion.importadoEn)}.
              </Text>

              {!listado.puedeEditar ? (
                <View style={styles.notaPendiente}>
                  <AlertTriangle size={14} color={colors.gris} />
                  <Text style={styles.notaPendienteTexto}>
                    Este inventario ya se liquidó: excluir o volver a incluir una línea queda bloqueado, no se puede
                    tocar la plata de algo que ya se cerró.
                  </Text>
                </View>
              ) : null}

              {listado.lineas.length === 0 ? (
                <Text style={styles.ayuda}>No había ninguna línea útil en el archivo importado.</Text>
              ) : (
                listado.lineas.map((l) => (
                  <View key={l.id} style={styles.filaLineaGuardada}>
                    <View style={styles.filaLineaTexto}>
                      <View style={styles.filaLineaCabecera}>
                        <Text style={styles.filaLineaCodigo}>
                          Fila {l.fila} · {l.codigo}
                        </Text>
                        <Text style={styles.filaLineaImporte}>S/ {formatoMoneda(l.importe)}</Text>
                      </View>
                      {l.excluida ? (
                        <Text style={styles.filaLineaExcluida}>
                          Excluida por {l.excluidaPor?.nombre ?? '—'}
                          {l.excluidaEn ? ` el ${formatoFechaHora(l.excluidaEn)}` : ''}: {l.motivoExclusion}
                        </Text>
                      ) : null}
                    </View>
                    <Button
                      label={l.excluida ? 'Volver a incluir' : 'Excluir'}
                      variant={l.excluida ? 'outline' : 'ghost'}
                      size="sm"
                      onPress={() => abrirModalLinea(l.id, l.excluida ? 'incluir' : 'excluir')}
                      disabled={!listado.puedeEditar || guardandoLineaId !== null}
                      loading={guardandoLineaId === l.id}
                    />
                  </View>
                ))
              )}
            </Card>
          ) : null}
        </>
      )}

      <Modal visible={modalLinea !== null} transparent animationType="fade" onRequestClose={cerrarModalLinea}>
        <Pressable style={styles.fondoModal} onPress={cerrarModalLinea} accessibilityLabel="Cerrar" />
        <View pointerEvents="box-none" style={styles.centradoModal}>
          <View style={[styles.cajaModal, shadow.modal]}>
            <View style={styles.filaCabecera}>
              <Text style={styles.tituloTarjeta}>
                {modalLinea?.accion === 'excluir' ? 'Excluir línea' : 'Volver a incluir línea'}
              </Text>
              <Pressable onPress={cerrarModalLinea} accessibilityLabel="Cerrar">
                <X size={19} color={colors.gris} />
              </Pressable>
            </View>
            <CampoTexto
              label="Motivo (obligatorio)"
              valor={textoMotivo}
              onCambiar={setTextoMotivo}
              icon={MessageSquare}
              placeholder="Por qué se excluye o se vuelve a incluir esta línea"
            />
            <Button
              label={guardandoLineaId !== null ? 'Guardando…' : 'Confirmar'}
              onPress={confirmarMotivoLinea}
              loading={guardandoLineaId !== null}
              disabled={textoMotivo.trim().length === 0 || guardandoLineaId !== null}
            />
          </View>
        </View>
      </Modal>
    </PantallaConTabs>
  );
}

function ResumenDato({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: 'falta' }): JSX.Element {
  return (
    <View style={styles.resumenDato}>
      <Text style={styles.resumenEtiqueta}>{etiqueta}</Text>
      <Text style={[styles.resumenValor, tono === 'falta' ? styles.resumenValorFalta : null]}>{valor}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  contenido: { gap: spacing.md },
  volver: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  volverTexto: { fontSize: 13, color: colors.rojo, fontFamily: fonts.semibold },
  centro: { paddingVertical: spacing.xxxl, alignItems: 'center' },
  tarjeta: { gap: spacing.sm },
  tarjetaError: { borderColor: colors.falta, backgroundColor: colors.faltaSuave },
  filaCabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  tituloTarjeta: { fontSize: fontSize.base, color: colors.tinta, fontFamily: fonts.bold },
  tituloError: { fontSize: fontSize.base, color: colors.falta, fontFamily: fonts.bold },
  textoEstado: { fontSize: fontSize.sm, color: colors.gris, lineHeight: 19 },
  montoGrande: { fontSize: fontSize.xl, color: colors.tinta, fontFamily: fonts.bold },
  textoError: { fontSize: fontSize.sm, color: colors.falta, lineHeight: 19 },
  ayuda: { fontSize: fontSize.sm, color: colors.gris, lineHeight: 19 },
  accionSecundaria: { marginTop: spacing.xs },
  resumenFila: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.xs },
  resumenDato: { minWidth: 100 },
  resumenEtiqueta: { fontSize: fontSize.xs, color: colors.gris },
  resumenValor: { fontSize: fontSize.lg, color: colors.tinta, fontFamily: fonts.bold, marginTop: 2 },
  resumenValorFalta: { color: colors.falta },
  bloqueLineas: { marginTop: spacing.sm, gap: 4 },
  subtitulo: { fontSize: fontSize.xs, color: colors.gris, fontFamily: fonts.semibold, marginBottom: 2 },
  filaLinea: { fontSize: fontSize.sm, color: colors.tinta, lineHeight: 18 },
  accionesFila: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  botonMitad: { flex: 1 },
  notaPendiente: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.esperaSuave,
  },
  notaPendienteTexto: { flex: 1, fontSize: fontSize.xs, color: colors.gris, lineHeight: 17 },
  aviso: { fontSize: fontSize.sm, color: colors.gris, lineHeight: 19 },
  filaLineaGuardada: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borde,
  },
  filaLineaTexto: { flex: 1, gap: 2 },
  filaLineaCabecera: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  filaLineaCodigo: { fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.semibold },
  filaLineaImporte: { fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.semibold },
  filaLineaExcluida: { fontSize: fontSize.xs, color: colors.falta, lineHeight: 16 },
  fondoModal: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  centradoModal: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  cajaModal: {
    width: '100%',
    maxWidth: 420,
    gap: spacing.md,
    padding: 17,
    backgroundColor: colors.campo,
    borderRadius: radius.lg,
  },
});
