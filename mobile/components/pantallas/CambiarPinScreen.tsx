import { router } from 'expo-router';
import { KeyRound, Lock } from 'lucide-react-native';
import { useState, type JSX } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { repositorioSesion } from '../../lib/contenedor';
import { validarPinNuevo } from '../../lib/dominio/pin';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';
import { BarraApp, Button, Card, PinPuntos, TecladoPin } from '../ui';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';

const LARGO_PIN = 6;

type CampoPin = 'actual' | 'nuevo' | null;

/**
 * Único camino para que alguien deje de tener el PIN que le asignó el
 * sistema o un administrador y pase a tener uno que solo esa persona
 * conoce (ver backend/src/modules/sesion/sesion.pin.ts). Es el mismo
 * componente para los 4 roles (app/{rol}/mi-cuenta.tsx solo la instancia):
 * cambiar el PIN propio no depende de qué rol tenga la sesión.
 */
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
      // demás de la misma persona) — no hay "seguir en la app" posible acá:
      // el próximo pedido con este token volvería 401. `cerrar()` limpia
      // el estado local para que sea el mismo camino que "Salir".
      Alert.alert('PIN actualizado', 'A partir de ahora entrá con tu PIN nuevo.', [
        {
          text: 'Entendido',
          onPress: async () => {
            await cerrar();
            router.replace('/');
          },
        },
      ]);
    } catch (error) {
      // Mismo patrón que el resto de la app (login, reseteo de PIN del
      // Administrador): el mensaje del backend ya viene en castellano y
      // pensado para el operario ("El PIN actual no es correcto.",
      // "Demasiados intentos..."), se muestra tal cual.
      Alert.alert('No se pudo cambiar el PIN', error instanceof Error ? error.message : 'Intentá de nuevo.');
      setGuardando(false);
    }
  }

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <BarraApp rotulo="Mi cuenta" cifras={`${sesion.colaborador.nombre} · ${sesion.colaborador.dni}`} />

      <Card style={styles.tarjeta}>
        <View style={styles.cabecera}>
          <KeyRound size={19} color={colors.rojo} />
          <Text style={styles.titulo}>Cambiar mi PIN</Text>
        </View>
        <Text style={styles.texto}>
          Un PIN que también conoce otra persona no te identifica solo a vos. Elegí uno nuevo que no sea tu número de
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
              <Text style={styles.valorVacio}>Ingresá tu PIN actual</Text>
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
              <Text style={styles.valorVacio}>Ingresá tu PIN nuevo</Text>
            )}
          </Pressable>
        </View>

        <Button label="Guardar PIN nuevo" icon={KeyRound} disabled={!puedeGuardar} loading={guardando} onPress={guardar} />
      </Card>

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
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: 14, paddingTop: 8, gap: 14 },
  tarjeta: { gap: spacing.md },
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  titulo: { fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
  texto: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular, lineHeight: 17 },
  campo: { gap: 6 },
  label: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.semibold },
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
