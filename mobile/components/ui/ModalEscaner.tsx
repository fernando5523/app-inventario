import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Camera, Flashlight, FlashlightOff, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';

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
 * LO QUE REPORTÓ EL CLIENTE PROBANDO EN TRES TELÉFONOS
 * ---------------------------------------------------------------------------
 * - "Funciona bien y rápido" → no se toca el pipeline de decodificación.
 * - "No necesita estar enfocado" → ML Kit decodifica sin esperar autofocus;
 *   no se agrega ningún paso de enfoque manual que lo haría más lento.
 * - "Por ahí lee mal cuando se apresura en cuanto detecta el código" → por
 *   eso `LECTURAS_PARA_CONFIRMAR`: se exige leer el MISMO código dos veces
 *   seguidas antes de aceptarlo. A ~30fps son unos 60ms, imperceptible para
 *   la persona, pero descarta el mal decodificado de un frame suelto.
 */

/**
 * Los de góndola son ean13 y ean8. Se suman code128 (etiquetas internas),
 * upc_a y upc_e (importados). QR queda AFUERA a propósito: no hay productos
 * con QR y habilitarlo solo agrega superficie para leer cualquier cartel
 * pegado en la góndola.
 */
const FORMATOS = ['ean13', 'ean8', 'code128', 'upc_a', 'upc_e'] as const;

/** Proporción del visor que ocupa el recuadro. Es la MISMA constante que
 *  dibuja el marco y que filtra las lecturas: si se separaran, el marco
 *  volvería a mentir sobre qué zona lee de verdad. */
const MARCO_ANCHO = 0.82;
const MARCO_ALTO = 0.4;

/**
 * Margen de tolerancia sobre el recuadro dibujado, en proporción del visor.
 * Existe porque `bounds` es aproximado por contrato: la doc de expo-camera
 * avisa que "no tiene por qué acotar el código entero" y que a veces
 * representa el área que usó el escáner. Sin un poco de aire, un código bien
 * apuntado se rechazaría por unos píxeles. Es el número a ajustar si en
 * campo se cuela un vecino (bajarlo) o cuesta capturar (subirlo).
 */
const TOLERANCIA = 0.06;

/** Dos lecturas iguales seguidas antes de aceptar. Ver el comentario de arriba. */
const LECTURAS_PARA_CONFIRMAR = 2;

/** Ventana de silencio tras aceptar un código, para no dispararlo en ráfaga. */
const MS_ANTIRREBOTE = 1500;

/**
 * Cuántas lecturas seguidas sin geometría utilizable antes de avisar. No se
 * avisa a la primera: a 30fps un frame sin `bounds` es normal y se corrige
 * solo en el siguiente.
 */
const LECTURAS_SIN_GEOMETRIA_PARA_AVISAR = 45;

export interface ModalEscanerProps {
  visible: boolean;
  /** Mensaje cuando el código leído no pertenece a la hoja. null = sin error. */
  error: string | null;
  onEscanear: (codigo: string) => void;
  onCerrar: () => void;
}

interface Punto {
  x: number;
  y: number;
}

/**
 * Dónde apareció el código dentro del visor.
 *
 * Se prefieren los `cornerPoints` sobre `bounds` porque son los cuatro
 * vértices reales del código; `bounds` es el rectángulo que los envuelve y,
 * según la doc, "puede representar un rectángulo vacío". Si ninguno de los
 * dos sirve, devuelve null — y una lectura sin ubicación NO se acepta: no
 * poder ubicarla es exactamente el caso que este filtro existe para atajar.
 */
function centroDeLectura(resultado: BarcodeScanningResult): Punto | null {
  const puntos = resultado.cornerPoints;
  if (puntos && puntos.length >= 3) {
    const xs = puntos.map((p) => p.x);
    const ys = puntos.map((p) => p.y);
    const ancho = Math.max(...xs) - Math.min(...xs);
    const alto = Math.max(...ys) - Math.min(...ys);
    // Extensión cero = polígono degenerado (algunos dispositivos devuelven
    // los cuatro puntos en 0,0 en vez de omitir el campo).
    if (ancho > 0 && alto > 0) {
      return { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length };
    }
  }

  const b = resultado.bounds;
  if (b?.size && b.size.width > 0 && b.size.height > 0) {
    return { x: b.origin.x + b.size.width / 2, y: b.origin.y + b.size.height / 2 };
  }

  return null;
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
   */
  const ultimoAceptado = useRef<{ codigo: string; en: number } | null>(null);
  const candidato = useRef<{ codigo: string; vistas: number } | null>(null);
  const sinGeometria = useRef(0);
  const entregado = useRef(false);

  // Cada vez que se abre el modal se limpia todo: si no, un código aceptado
  // en la apertura anterior sigue bloqueado por el anti-rebote.
  useEffect(() => {
    if (!visible) return;
    ultimoAceptado.current = null;
    candidato.current = null;
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
      const medioAncho = (MARCO_ANCHO / 2 + TOLERANCIA) * visor.ancho;
      const medioAlto = (MARCO_ALTO / 2 + TOLERANCIA) * visor.alto;
      const dentro =
        Math.abs(centro.x - visor.ancho / 2) <= medioAncho && Math.abs(centro.y - visor.alto / 2) <= medioAlto;

      if (!dentro) {
        // Silencio deliberado: el código del vecino entrando y saliendo de
        // cuadro dispararía un cartel intermitente que no ayuda a nadie.
        candidato.current = null;
        return;
      }

      const codigo = resultado.data?.trim();
      if (!codigo) return;

      const ahora = Date.now();
      const previo = ultimoAceptado.current;
      if (previo && previo.codigo === codigo && ahora - previo.en < MS_ANTIRREBOTE) return;

      // Confirmación por repetición: contra el "lee mal cuando se apresura".
      if (candidato.current?.codigo === codigo) {
        candidato.current.vistas++;
      } else {
        candidato.current = { codigo, vistas: 1 };
      }
      if (candidato.current.vistas < LECTURAS_PARA_CONFIRMAR) return;

      ultimoAceptado.current = { codigo, en: ahora };
      candidato.current = null;
      entregado.current = true;

      // El operario no mira la pantalla mientras escanea: escucha y siente.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      onEscanear(codigo);
    },
    [onEscanear, visor.alto, visor.ancho],
  );

  // Un código que no pertenece a la hoja llega como `error` desde la
  // pantalla: se vibra distinto y se rehabilita la lectura para que pueda
  // volver a intentar sin cerrar y abrir el modal.
  useEffect(() => {
    if (!error) return;
    entregado.current = false;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  }, [error]);

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

          <Text style={styles.nota}>
            El escáner confirma que el producto que tenés en la mano es el de la lista — no reemplaza ingresar la cantidad.
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
                style={StyleSheet.absoluteFill}
                facing="back"
                enableTorch={linterna}
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

          {error ? <Text style={styles.error}>{error}</Text> : null}
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
  aviso: { fontSize: 12.5, color: colors.proceso, fontFamily: fonts.semibold, lineHeight: 17 },
  error: { fontSize: 12.5, color: colors.rojo, fontFamily: fonts.semibold, lineHeight: 17 },
});
