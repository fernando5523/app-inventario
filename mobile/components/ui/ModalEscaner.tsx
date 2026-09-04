import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Camera, Flashlight, FlashlightOff, RefreshCw, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';
import { ConfirmadorDeLecturas } from './escaner-confirmacion';
import { centroDeLectura, dentroDelMarco, MARCO_ALTO, MARCO_ANCHO } from './escaner-geometria';

/**
 * Escáner de código de barras con la cámara real (expo-camera / ML Kit).
 *
 * Regla del negocio que manda sobre todo lo demás: el escáner es
 * SECUNDARIO. Confirma que el producto que el operario tiene en la mano es
 * el de la línea de la lista — NO cuenta por sí solo. Quien decide la
 * cantidad sigue siendo la persona, en el modal de conteo.
 *
 * ---------------------------------------------------------------------------
 * EL PROBLEMA QUE RESUELVE EL FILTRO POR BOUNDS
 * ---------------------------------------------------------------------------
 * En góndola los códigos están pegados uno al lado del otro. expo-camera
 * escanea el FRAME COMPLETO, así que el código del producto de al lado entra
 * en cuadro y se lee perfecto — pero es del producto equivocado. El dato
 * llega limpio, nadie sospecha, y el error recién aparece semanas después
 * cuando no cuadra contra el ERP.
 *
 * Por eso el recuadro que se dibuja en pantalla NO es decoración: toda
 * lectura cuyo centro caiga afuera se descarta. El marco acota de verdad.
 *
 * ---------------------------------------------------------------------------
 * LO QUE REPORTÓ EL CLIENTE PROBANDO EN TRES TELÉFONOS (primera ronda)
 * ---------------------------------------------------------------------------
 * - "Funciona bien y rápido" → no se toca el pipeline de decodificación.
 * - "Por ahí lee mal cuando se apresura en cuanto detecta el código" → por
 *   eso existe `LECTURAS_PARA_CONFIRMAR`: se exige leer el MISMO código
 *   varias veces SEGUIDAS antes de aceptarlo (ver escaner-confirmacion.ts).
 *   Un código distinto en el medio reinicia el conteo a cero.
 *
 * ---------------------------------------------------------------------------
 * SEGUNDA RONDA, YA EN CAMPO (teléfono real, no emulador)
 * ---------------------------------------------------------------------------
 * - "Captura varias veces el código y muchas veces lo hace bien mal en un
 *   segundo": `LECTURAS_PARA_CONFIRMAR` subió de 2 a 3. Con 2, dos frames
 *   consecutivos (~66ms a 30fps) alcanzaban para aceptar un mal decodificado
 *   que por azar se repitiera una sola vez; con 3 hace falta que se repita
 *   dos veces seguidas, mucho menos probable. La máquina de estados en sí
 *   —que un código distinto reinicia el contador— se auditó línea por línea
 *   y ya funcionaba así antes de este cambio (ver escaner-confirmacion.test.ts,
 *   caso "A,B,A no acepta A").
 * - "No veo una opción de focalizar": expo-camera 55.x no expone foco por
 *   toque en esta versión (sin `pointOfInterest` ni método de foco en el
 *   ref). SÍ tiene `autofocus` (default `'off'`, que pese al nombre es
 *   autofoco CONTINUO — `'on'` es foco único y bloqueo, lo que no queremos
 *   acá) y `pausePreview()/resumePreview()` en el ref, que reinician el
 *   pipeline de la cámara y con eso el ciclo de autofoco en la mayoría de
 *   los dispositivos. Con eso se armó el botón "Reintentar enfoque".
 * - El filtro por bounds YA estaba activo (ver EL PROBLEMA QUE RESUELVE EL
 *   FILTRO POR BOUNDS, arriba): ninguna lectura llega al confirmador sin
 *   pasar primero por `dentroDelMarco`. Lo que este código NO puede
 *   verificar sin un teléfono físico es si `bounds`/`cornerPoints` llegan
 *   realmente en coordenadas del visor en TODOS los Android reales del
 *   cliente — la documentación de expo-camera lo promete, pero es una
 *   plataforma con historial de reportar esto de forma inconsistente según
 *   el fabricante. Si el umbral más alto no alcanza, el próximo paso es
 *   loguear `resultado.bounds` crudo en un dispositivo real y comparar
 *   contra `visor.ancho/alto`.
 */

/**
 * Los de góndola son ean13 y ean8. Se suman code128 (etiquetas internas),
 * upc_a y upc_e (importados). QR queda AFUERA a propósito: no hay productos
 * con QR y habilitarlo solo agrega superficie para leer cualquier cartel
 * pegado en la góndola.
 */
const FORMATOS = ['ean13', 'ean8', 'code128', 'upc_a', 'upc_e'] as const;

/**
 * Lecturas iguales SEGUIDAS antes de aceptar. Subido de 2 a 3 (2026-09-04)
 * tras el reporte del cliente en teléfono real: con 2, un mal decodificado
 * que por azar se repitiera una sola vez alcanzaba para aceptarse. Ver el
 * comentario de arriba y escaner-confirmacion.ts.
 */
const LECTURAS_PARA_CONFIRMAR = 3;

/** Ventana de silencio tras aceptar un código, para no dispararlo en ráfaga. */
const MS_ANTIRREBOTE = 1500;

/**
 * Cuántas lecturas seguidas sin geometría utilizable antes de avisar. No se
 * avisa a la primera: a 30fps un frame sin `bounds` es normal y se corrige
 * solo en el siguiente.
 */
const LECTURAS_SIN_GEOMETRIA_PARA_AVISAR = 45;

/**
 * Rechazo de una lectura, con un `intento` que cambia en CADA rechazo.
 *
 * El contador no es ceremonia: el modal se rehabilita al recibir un
 * rechazo, y si eso dependiera solo del mensaje, dos códigos ajenos
 * seguidos producirían el MISMO string, React no volvería a correr el
 * efecto y el escáner quedaría mudo hasta cerrar y reabrir el modal. En
 * góndola, dos lecturas ajenas seguidas es el caso NORMAL, no el raro.
 */
export interface RechazoEscaneo {
  mensaje: string;
  intento: number;
}

export interface ModalEscanerProps {
  visible: boolean;
  /** Rechazo de la última lectura (no pertenece a la hoja, o falló la consulta). null = sin error. */
  error: RechazoEscaneo | null;
  onEscanear: (codigo: string) => void;
  onCerrar: () => void;
}

export function ModalEscaner({ visible, error, onEscanear, onCerrar }: ModalEscanerProps): JSX.Element | null {
  const [permiso, pedirPermiso] = useCameraPermissions();
  const [linterna, setLinterna] = useState(false);
  const [visor, setVisor] = useState({ ancho: 0, alto: 0 });
  const [avisoGeometria, setAvisoGeometria] = useState(false);

  /**
   * TODO el estado del anti-duplicados vive en refs, NUNCA en useState, y no
   * es una preferencia de estilo: `onBarcodeScanned` dispara a ~30fps y React
   * recién re-renderiza en el tick siguiente. Con estado, varias lecturas del
   * mismo burst leen el valor VIEJO, pasan el filtro las tres, y el mismo
   * código termina contado tres veces. Ya lo pagamos una vez.
   *
   * La máquina de estados en sí (consecutivas, antirrebote) vive en
   * escaner-confirmacion.ts — acá solo la instancia, mutable, en un ref.
   */
  const confirmador = useRef(new ConfirmadorDeLecturas(LECTURAS_PARA_CONFIRMAR, MS_ANTIRREBOTE));
  const sinGeometria = useRef(0);
  const entregado = useRef(false);
  const camaraRef = useRef<CameraView>(null);

  // Cada vez que se abre el modal se limpia todo: si no, un código aceptado
  // en la apertura anterior sigue bloqueado por el anti-rebote.
  useEffect(() => {
    if (!visible) return;
    confirmador.current.reiniciar();
    sinGeometria.current = 0;
    entregado.current = false;
    setAvisoGeometria(false);
    setLinterna(false);
  }, [visible]);

  const medirVisor = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setVisor({ ancho: width, alto: height });
  }, []);

  const alLeer = useCallback(
    (resultado: BarcodeScanningResult) => {
      if (entregado.current) return;
      if (visor.ancho === 0 || visor.alto === 0) return; // todavía no se midió el visor

      const centro = centroDeLectura(resultado);

      /**
       * Sin geometría utilizable no se puede saber si el código es el que la
       * persona apuntó o el del producto de al lado. Se descarta ESTE frame
       * (no la sesión): a 30fps el siguiente casi seguro trae bounds válidos.
       * Solo si pasan muchos seguidos se avisa, en vez de aceptar a ciegas
       * —que reintroduce el bug en silencio— o cortar el escáner de golpe.
       */
      if (!centro) {
        sinGeometria.current++;
        if (sinGeometria.current >= LECTURAS_SIN_GEOMETRIA_PARA_AVISAR) setAvisoGeometria(true);
        return;
      }

      /**
       * Guarda de sistema de coordenadas: `bounds` deberían venir en las
       * coordenadas del visor, pero eso varía entre plataformas y versiones,
       * y si llegaran en píxeles del sensor el centro caería muy afuera y el
       * filtro compararía peras con manzanas. Ante la duda se trata como
       * "sin geometría" — nunca se acepta una lectura que no se pudo ubicar.
       */
      const fueraDelVisor =
        centro.x < -visor.ancho || centro.x > visor.ancho * 2 || centro.y < -visor.alto || centro.y > visor.alto * 2;
      if (fueraDelVisor) {
        sinGeometria.current++;
        if (sinGeometria.current >= LECTURAS_SIN_GEOMETRIA_PARA_AVISAR) setAvisoGeometria(true);
        return;
      }
      sinGeometria.current = 0;

      // EL FILTRO: mismo rectángulo que se dibuja, más la tolerancia.
      if (!dentroDelMarco(centro, visor)) {
        // Silencio deliberado: el código del vecino entrando y saliendo de
        // cuadro dispararía un cartel intermitente que no ayuda a nadie.
        // `descartar()` rompe cualquier racha en curso — el vecino no puede
        // "esperar su turno" para acumular vistas mientras no está en cuadro.
        confirmador.current.descartar();
        return;
      }

      const codigo = resultado.data?.trim();
      if (!codigo) return;

      if (!confirmador.current.procesar(codigo, Date.now())) return;

      entregado.current = true;

      // El operario no mira la pantalla mientras escanea: escucha y siente.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      onEscanear(codigo);
    },
    [onEscanear, visor.alto, visor.ancho],
  );

  const reintentarEnfoque = useCallback(() => {
    // pausePreview()/resumePreview() reinician el pipeline de la cámara —
    // no hay foco por toque en esta versión de expo-camera (ver el
    // comentario grande de arriba), pero reiniciar el pipeline dispara un
    // nuevo ciclo de autofoco en la mayoría de los dispositivos Android.
    const camara = camaraRef.current;
    if (!camara) return;
    camara
      .pausePreview()
      .then(() => camara.resumePreview())
      .catch(() => undefined);
  }, []);

  // Un código que no pertenece a la hoja llega como rechazo desde la
  // pantalla: se vibra distinto y se rehabilita la lectura para que pueda
  // volver a intentar sin cerrar y abrir el modal.
  //
  // La dependencia es `error?.intento`, NO el mensaje: ver RechazoEscaneo.
  useEffect(() => {
    if (!error) return;
    entregado.current = false;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  }, [error?.intento]);

  if (!visible) return null;

  return (
    // Overlay en JS, NO <Modal> nativo — ver el comentario largo en
    // ModalConteo.tsx: mismo bug de Android con el touch mal enrutado
    // tras cerrar un Modal transparent+fade.
    <View style={styles.raiz} pointerEvents="box-none">
      <Pressable style={styles.fondo} onPress={onCerrar} />
      <View pointerEvents="box-none" style={styles.centrado}>
        <View style={[styles.caja, shadow.modal]}>
          <View style={styles.cabecera}>
            <Text style={styles.titulo}>Confirmar producto con la cámara</Text>
            <Pressable onPress={onCerrar} style={styles.cerrar} accessibilityLabel="Cerrar">
              <X size={18} color={colors.gris} />
            </Pressable>
          </View>

          {/* Lo que el escáner PUEDE prometer, dicho sin adornos. Los códigos
              que trae Dynamics son todos de unidad suelta (ProductQuantity 0,
              unidad "U" en los 15 de la muestra): ninguno identifica una caja
              ni un pack. O sea que leer el código dice QUÉ producto es, y
              nada sobre cuánto hay. Si la pantalla insinuara otra cosa, el
              operario confiaría en un dato que el escáner no tiene. */}
          <Text style={styles.nota}>
            El escáner dice QUÉ producto es, no cuánto hay: el código es el mismo para una unidad que para una caja.
            Después de confirmarlo, la cantidad y el empaque los cargás vos.
          </Text>

          {!permiso ? (
            <View style={styles.visorVacio}>
              <ActivityIndicator color={colors.rojo} />
            </View>
          ) : !permiso.granted ? (
            <View style={styles.visorVacio}>
              <Camera size={28} color={colors.grisClaro} />
              <Text style={styles.permisoTexto}>
                Para escanear necesitamos permiso de la cámara. No se guarda ninguna foto: solo se lee el código.
              </Text>
              <Pressable style={styles.permisoBoton} onPress={pedirPermiso}>
                <Text style={styles.permisoBotonTexto}>Habilitar cámara</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.visor} onLayout={medirVisor}>
              <CameraView
                ref={camaraRef}
                style={StyleSheet.absoluteFill}
                facing="back"
                enableTorch={linterna}
                // 'off' es, pese al nombre, autofoco CONTINUO ("should
                // automatically focus when needed"); 'on' enfoca una vez y
                // BLOQUEA el foco — lo que no queremos con el teléfono
                // moviéndose entre productos. Es el default de expo-camera:
                // explícito acá para que nadie lo "corrija" a 'on' sin saber.
                autofocus="off"
                barcodeScannerSettings={{ barcodeTypes: [...FORMATOS] }}
                onBarcodeScanned={alLeer}
              />

              {/* El marco NO es decoración: es exactamente la zona que se
                  acepta (ver MARCO_ANCHO / MARCO_ALTO). */}
              <View pointerEvents="none" style={styles.marcoCapa}>
                <View
                  style={[
                    styles.marco,
                    { width: `${MARCO_ANCHO * 100}%`, height: `${MARCO_ALTO * 100}%` },
                    error ? styles.marcoError : null,
                  ]}
                />
              </View>

              <Pressable
                style={styles.linterna}
                onPress={() => setLinterna((v) => !v)}
                accessibilityLabel={linterna ? 'Apagar linterna' : 'Encender linterna'}
              >
                {linterna ? (
                  <FlashlightOff size={17} color={colors.tinta} />
                ) : (
                  <Flashlight size={17} color={colors.tinta} />
                )}
              </Pressable>

              {/* No hay foco por toque en esta versión de expo-camera (ver
                  el comentario grande de arriba): esto es lo que hay en su
                  lugar — reinicia el pipeline de la cámara, lo que dispara
                  un nuevo ciclo de autofoco en la mayoría de los Android. */}
              <Pressable style={styles.reenfocar} onPress={reintentarEnfoque} accessibilityLabel="Reintentar enfoque">
                <RefreshCw size={17} color={colors.tinta} />
              </Pressable>
            </View>
          )}

          {permiso?.granted ? (
            <Text style={styles.nota}>
              Poné el código DENTRO del recuadro. Lo que quede afuera no se lee, para no tomar por error el código del
              producto de al lado.
            </Text>
          ) : null}

          {avisoGeometria ? (
            <Text style={styles.aviso}>
              No se puede ubicar el código dentro del cuadro en este teléfono. Alejá un poco la cámara y centrá el
              código.
            </Text>
          ) : null}

          {error ? <Text style={styles.error}>{error.mensaje}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: { ...StyleSheet.absoluteFillObject, zIndex: 50, elevation: 50 },
  fondo: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  centrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  caja: { width: '100%', maxWidth: 330, gap: 12, padding: 17, backgroundColor: colors.campo, borderRadius: radius.xl },
  cabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  titulo: { flex: 1, fontSize: 15, color: colors.tinta, fontFamily: fonts.bold },
  cerrar: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  nota: { fontSize: fontSize.xs + 1, color: colors.gris, fontFamily: fonts.regular, lineHeight: 16 },
  visor: { height: 230, overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.tinta },
  visorVacio: {
    height: 230,
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borde,
    backgroundColor: colors.esperaSuave,
  },
  permisoTexto: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular, textAlign: 'center', lineHeight: 17 },
  permisoBoton: { paddingVertical: 11, paddingHorizontal: 18, borderRadius: radius.sm, backgroundColor: colors.rojo },
  permisoBotonTexto: { fontSize: 14, color: colors.blanco, fontFamily: fonts.bold },
  marcoCapa: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  marco: { borderWidth: 2, borderColor: colors.blanco, borderRadius: radius.sm },
  marcoError: { borderColor: colors.rojo },
  linterna: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.blanco,
  },
  reenfocar: {
    position: 'absolute',
    right: 52,
    bottom: 10,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.blanco,
  },
  aviso: { fontSize: 12.5, color: colors.proceso, fontFamily: fonts.semibold, lineHeight: 17 },
  error: { fontSize: 12.5, color: colors.rojo, fontFamily: fonts.semibold, lineHeight: 17 },
});
