import { router } from 'expo-router';
import { KeyRound, Lock } from 'lucide-react-native';
import { useState, type JSX } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { repositorioSesion } from '../../lib/contenedor';
import { validarPinNuevo } from '../../lib/dominio/pin';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';
import { PinPuntos, TecladoPin } from '../ui';
import { BotonWeb, EncabezadoPagina, TarjetaWeb } from '../web';

const LARGO_PIN = 6;

type CampoPin = 'actual' | 'nuevo' | null;

/**
 * ---------------------------------------------------------------------------
 * CAMBIAR MI PIN, EN EL NAVEGADOR
 * ---------------------------------------------------------------------------
 * Clon de `CambiarPinScreen.tsx`. Metro elige este archivo en el bundle de
 * web; el del teléfono no se toca -- decisión del usuario para toda la web:
 * *"no utilices la misma pantalla del móvil, clónalo y cámbialo, en todo caso
 * son plataformas diferentes"*.
 *
 * LA FUNCIONALIDAD ES LA MISMA, hasta el último texto: `validarPinNuevo`, el
 * mismo `repositorioSesion.cambiarPin`, los mismos mensajes del backend y el
 * mismo cierre de sesión al terminar.
 *
 * ---------------------------------------------------------------------------
 * ANCHA NO ES MEJOR
 * ---------------------------------------------------------------------------
 * Esta página tiene dos campos y un botón. Estirarla a los 1.120px de las
 * demás dejaría dos controles perdidos en un campo de blanco, con la etiqueta
 * a medio metro de su casilla. Se acota a un ancho de formulario y se centra:
 * el ancho de la ventana no es una obligación de usarlo.
 *
 * EL TECLADO NUMÉRICO SE QUEDA, y es deliberado aunque en una PC haya teclado
 * físico. El PIN se escribe igual en los dos lados, y ese componente es el que
 * ya oculta los dígitos, corta en 6 y no deja pegar. Cambiarlo por un `input`
 * sería una funcionalidad distinta, no un rediseño.
 */
const ANCHO_FORMULARIO = 520;

export function CambiarPinScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [pinActual, setPinActual] = useState('');
  const [pinNuevo, setPinNuevo] = useState('');
  const [campoAbierto, setCampoAbierto] = useState<CampoPin>(null);
  const [guardando, setGuardando] = useState(false);

  if (!sesion) return <View />;

  const puedeGuardar = pinActual.length === LARGO_PIN && pinNuevo.length === LARGO_PIN && !guardando;

  async function guardar(): Promise<void> {
    // Se revalida acá (no solo se confía en `puedeGuardar`): el botón se
    // deshabilita, pero nada impide que este chequeo quede como la última
    // palabra antes de gastar un viaje a la red.
    if (pinActual.length !== LARGO_PIN || pinNuevo.length !== LARGO_PIN) return;

    const rechazo = validarPinNuevo(pinActual, pinNuevo, sesion!.colaborador.id);
    if (rechazo) {
      Alert.alert('Ese PIN no sirve', rechazo);
      return;
    }

    setGuardando(true);
    try {
      await repositorioSesion.cambiarPin(pinActual, pinNuevo);
      // El backend ya cerró esta sesión al aplicar el cambio (y todas las
      // demás de la misma persona): el próximo pedido con este token volvería
      // 401. `cerrar()` limpia el estado local, que es el mismo camino que
      // "Salir".
      Alert.alert('PIN actualizado', 'A partir de ahora entra con tu PIN nuevo.', [
        {
          text: 'Entendido',
          onPress: async () => {
            await cerrar();
            router.replace('/');
          },
        },
      ]);
    } catch (error) {
      // El mensaje del backend ya viene en castellano y pensado para quien lo
      // lee ("El PIN actual no es correcto.", "Demasiados intentos..."): se
      // muestra tal cual, igual que en el login y en el reseteo del Admin.
      Alert.alert('No se pudo cambiar el PIN', error instanceof Error ? error.message : 'Intenta de nuevo.');
      setGuardando(false);
    }
  }

  return (
    <ScrollView style={styles.pagina} contentContainerStyle={styles.contenido} showsVerticalScrollIndicator={false}>
      <EncabezadoPagina
        migas={['Mi cuenta', 'Cambiar mi PIN']}
        titulo="Cambiar mi PIN"
        sub={`${sesion.colaborador.nombre} · ${sesion.colaborador.dni}`}
        onInicio={() => router.push('/')}
      />

      <View style={styles.centrado}>
        <TarjetaWeb titulo="Cambiar mi PIN" icono={KeyRound} style={styles.tarjeta}>
          <Text style={styles.texto}>
            Un PIN que también conoce otra persona no te identifica solo a ti. Elige uno nuevo que no sea tu número de
            colaborador ni una secuencia fácil.
          </Text>

          <View style={styles.campo}>
            <Text style={styles.label}>PIN actual</Text>
            <Pressable
              style={styles.controlClave}
              accessibilityRole="button"
              accessibilityLabel="PIN actual"
              onPress={() => setCampoAbierto('actual')}
            >
              <Lock size={19} color={colors.grisClaro} />
              {pinActual.length > 0 ? (
                <PinPuntos valor={pinActual} longitud={LARGO_PIN} revelado={false} />
              ) : (
                <Text style={styles.valorVacio}>Ingresa tu PIN actual</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.campo}>
            <Text style={styles.label}>PIN nuevo</Text>
            <Pressable
              style={styles.controlClave}
              accessibilityRole="button"
              accessibilityLabel="PIN nuevo"
              onPress={() => setCampoAbierto('nuevo')}
            >
              <Lock size={19} color={colors.grisClaro} />
              {pinNuevo.length > 0 ? (
                <PinPuntos valor={pinNuevo} longitud={LARGO_PIN} revelado={false} />
              ) : (
                <Text style={styles.valorVacio}>Ingresa tu PIN nuevo</Text>
              )}
            </Pressable>
          </View>

          {/* EL ÚNICO BOTÓN ROJO de la página, que es la acción que la trajo. */}
          <BotonWeb
            etiqueta="Guardar PIN nuevo"
            icono={KeyRound}
            variante="principal"
            deshabilitado={!puedeGuardar}
            cargando={guardando}
            onPress={() => void guardar()}
          />
        </TarjetaWeb>
      </View>

      <TecladoPin
        visible={campoAbierto === 'actual'}
        titulo="Tu PIN actual"
        valor={pinActual}
        longitud={LARGO_PIN}
        onCambiar={setPinActual}
        onCerrar={() => setCampoAbierto(null)}
      />
      <TecladoPin
        visible={campoAbierto === 'nuevo'}
        titulo="Tu PIN nuevo"
        valor={pinNuevo}
        longitud={LARGO_PIN}
        onCambiar={setPinNuevo}
        onCerrar={() => setCampoAbierto(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pagina: { flex: 1 },
  contenido: { padding: spacing.xxl, gap: spacing.lg },
  /** `alignItems` y no un ancho en la tarjeta: la tarjeta es `flex: 1` por dentro. */
  centrado: { alignItems: 'center' },
  tarjeta: { width: '100%', maxWidth: ANCHO_FORMULARIO, flexGrow: 0 },

  texto: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular, lineHeight: 19 },
  campo: { gap: 6, marginTop: spacing.xs },
  label: { fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.semibold },
  controlClave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 54,
    paddingHorizontal: 15,
    backgroundColor: colors.campo,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
  },
  valorVacio: { flex: 1, fontSize: fontSize.base, color: colors.grisClaro, fontFamily: fonts.regular },
});
