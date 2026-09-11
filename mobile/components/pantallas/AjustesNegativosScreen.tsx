import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  FileSpreadsheet,
  FileX2,
  Upload,
} from 'lucide-react-native';
import { useCallback, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../hooks/useRefrescoAlEnfocar';
import { ajustesNegativosApi, type ConfirmarAjustesNegativosResultado } from '../../lib/adaptadores/ajustes-negativos-api';
import {
  estadoNegativos,
  textoMotivoAdvertencia,
  textoMotivoRechazo,
  type ResultadoPreviewAjustesNegativos,
} from '../../lib/dominio/ajustes-negativos';
import { esErrorApi } from '../../lib/adaptadores/_http';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';
import { BarraApp, Badge, Button, Card, formatoFechaHora, formatoMoneda } from '../ui';

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Ajustes: Excel de Dynamics (Pantalla del Auditor, contra
 * backend/src/modules/liquidacion/liquidacion.ajustes-negativos.ts, e39b370).
 * Reemplaza el monto de negativos que se tipeaba a mano (liquidacion.ajustes.ts)
 * por la importación del archivo que ya arma el área de negativos.
 *
 * Recibe `inventarioId` como parámetro de ruta (`router.push({ pathname:
 * '/auditor/ajustes-negativos', params: { inventarioId: String(id) } })`):
 * la pantalla de Liquidación es quien sabe qué inventario tiene el conteo
 * cerrado de la sucursal elegida -- este archivo no lo decide de nuevo.
 *
 * FLUJO: elegir archivo → vista previa (válidas/rechazadas/advertencias, sin
 * persistir nada) → confirmar (recién ahí se guarda y se recalcula
 * montoNegativos). Ver skill trujillo-ui, "Honestidad de los datos en
 * pantalla": `estadoNegativos()` distingue "todavía no se importó" (bloquea
 * liquidar) de "se importó y dio 0" (no bloquea nada) con DOS textos
 * distintos, nunca el mismo cartel para los dos.
 *
 * PENDIENTE, y no es de esta pantalla: excluir/incluir una línea puntual
 * necesita su `id` en la base, y hoy no existe un endpoint que LISTE las
 * líneas ya guardadas de la importación vigente (el backend solo expone
 * PATCH .../lineas/:id/excluir|incluir, que ya sabe usar
 * ajustes-negativos-api.ts). Mientras no exista ese GET, esta pantalla
 * muestra las líneas de la última vista previa como REVISIÓN de lo
 * importado, sin botones de acción -- fingir que andan sería peor que no
 * tenerlos (skill trujillo-ui, misma sección).
 */
export function AjustesNegativosScreen(): JSX.Element {
  const params = useLocalSearchParams<{ inventarioId?: string }>();
  const inventarioId = params.inventarioId ? Number(params.inventarioId) : null;

  const [cargando, setCargando] = useState(true);
  const [montoNegativos, setMontoNegativos] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [archivo, setArchivo] = useState<{ nombre: string; bytes: Uint8Array } | null>(null);
  const [previsualizando, setPrevisualizando] = useState(false);
  const [preview, setPreview] = useState<ResultadoPreviewAjustesNegativos | null>(null);

  const [confirmando, setConfirmando] = useState(false);
  const [confirmado, setConfirmado] = useState<ConfirmarAjustesNegativosResultado | null>(null);

  const cargar = useCallback(async () => {
    if (inventarioId === null) {
      setCargando(false);
      return;
    }
    setError(null);
    try {
      const estado = await ajustesNegativosApi.estado(inventarioId);
      setMontoNegativos(estado.montoNegativos);
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
    setConfirmado(null);
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
      setConfirmado(resultado);
      setMontoNegativos(resultado.montoNegativos);
      setPreview(null);
      setArchivo(null);
    } catch (e) {
      setError(esErrorApi(e) ? e.message : 'No se pudo confirmar la importación.');
    } finally {
      setConfirmando(false);
    }
  }

  function elegirOtroArchivo(): void {
    setPreview(null);
    setArchivo(null);
    setConfirmado(null);
    setError(null);
    Alert.alert(
      'Elegir otro archivo',
      'La línea de "Elegir archivo" reemplaza la vista previa actual -- nada se pierde, todavía no se confirmó nada.',
      [{ text: 'Entendido' }],
    );
  }

  const estado = estadoNegativos(montoNegativos);

  return (
    <PantallaConTabs
      scrollable
      contentStyle={styles.contenido}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={colors.rojo} colors={[colors.rojo]} />}
    >
      <BarraApp rotulo="Liquidación · Ajustes" sede="Excel de Dynamics" />

      <Pressable style={styles.volver} onPress={() => router.back()} accessibilityRole="button">
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
              molestan.
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
                  <Text style={styles.subtitulo}>Válidas con advertencia — igual suman, decidí si excluirlas después de confirmar</Text>
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

          {confirmado ? (
            <Card style={styles.tarjeta}>
              <View style={styles.filaCabecera}>
                <CheckCircle2 size={18} color={colors.ok} />
                <Text style={styles.tituloTarjeta}>Importación confirmada</Text>
              </View>
              <Text style={styles.ayuda}>
                {confirmado.nombreArchivo} · {formatoFechaHora(confirmado.importadoEn)}
              </Text>
              <View style={styles.resumenFila}>
                <ResumenDato etiqueta="Válidas guardadas" valor={String(confirmado.cantidadValidas)} />
                <ResumenDato etiqueta="Rechazadas" valor={String(confirmado.cantidadRechazadas)} />
                <ResumenDato etiqueta="Monto" valor={`S/ ${formatoMoneda(confirmado.montoNegativos)}`} />
              </View>
              <View style={styles.notaPendiente}>
                <AlertTriangle size={14} color={colors.gris} />
                <Text style={styles.notaPendienteTexto}>
                  Excluir o volver a incluir una línea puntual todavía no está disponible acá: hace falta un
                  endpoint del backend que liste las líneas ya guardadas con su identificador. Se puede reimportar
                  un archivo corregido: la importación anterior queda registrada, no se borra.
                </Text>
              </View>
            </Card>
          ) : null}
        </>
      )}
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
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.esperaSuave,
  },
  notaPendienteTexto: { flex: 1, fontSize: fontSize.xs, color: colors.gris, lineHeight: 17 },
  aviso: { fontSize: fontSize.sm, color: colors.gris, lineHeight: 19 },
});
