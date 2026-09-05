import Constants from 'expo-constants';
import { router } from 'expo-router';
import { ArrowRight, Lock, MapPin, User } from 'lucide-react-native';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  Button,
  EstrellaMarca,
  GrupoRol,
  PinPuntos,
  ScreenContainer,
  Select,
  TecladoPin,
  type SelectOpcion,
} from '../components/ui';
import { repositorioSesion } from '../lib/contenedor';
import { ejecutarIngreso } from '../lib/ejecutar-ingreso';
import { mensajeDeErrorIngreso } from '../lib/mensaje-error-ingreso';
import type { Colaborador, Sucursal } from '../lib/dominio/tipos';
import { useSesion } from '../lib/sesion-contexto';
import { colors, fonts, fontSize, radius, spacing } from '../lib/theme';

const LARGO_PIN = 6;

function textoColaboradores(s: Sucursal): string {
  return `${s.colaboradores} colaborador${s.colaboradores === 1 ? '' : 'es'}`;
}

type CampoAbierto = 'sucursal' | 'persona' | null;

export default function LoginScreen(): JSX.Element {
  const { sesion, cargando, ingresar } = useSesion();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [colaboradoresDisponibles, setColaboradoresDisponibles] = useState<Colaborador[]>([]);
  const [administradores, setAdministradores] = useState<Colaborador[]>([]);

  /**
   * El Administrador es del sistema, no de una tienda (`sesion.sucursal`
   * queda `null` para este rol) — camino de login SEPARADO en vez de
   * meterlo en el combo de una sucursal cualquiera. Mezclarlo ahí lo haría
   * aparecer en el padrón de las 4 tiendas a la vez, con un colaborador que
   * en los hechos no pertenece a ninguna (ver mobile/README.md §Login).
   */
  const [modoAdmin, setModoAdmin] = useState(false);

  // Nada preseleccionado: criterio explícito del cliente — un default que
  // nadie mira es un dato que nadie verifica.
  const [sucursal, setSucursal] = useState<Sucursal | null>(null);
  const [persona, setPersona] = useState<Colaborador | null>(null);
  const [pin, setPin] = useState('');
  const [pinVisible, setPinVisible] = useState(false);
  const [modalPinVisible, setModalPinVisible] = useState(false);
  const [campoAbierto, setCampoAbierto] = useState<CampoAbierto>(null);
  const [ingresando, setIngresando] = useState(false);

  // Sesión guardada de un arranque anterior: no hace falta volver a
  // loguearse, se entra directo al grupo de tabs que le corresponde.
  useEffect(() => {
    if (!cargando && sesion) router.replace(`/${sesion.colaborador.rol}`);
  }, [cargando, sesion]);

  useEffect(() => {
    repositorioSesion.sucursales().then(setSucursales);
  }, []);

  useEffect(() => {
    if (!sucursal) {
      setColaboradoresDisponibles([]);
      return;
    }
    repositorioSesion.colaboradores(sucursal.id).then(setColaboradoresDisponibles);
  }, [sucursal]);

  // Se pide recién al entrar en modoAdmin (no en el arranque de la
  // pantalla): es el mismo criterio que ya se usa para colaboradores de una
  // sucursal — no traer del backend lo que todavía nadie pidió ver.
  useEffect(() => {
    if (!modoAdmin) return;
    repositorioSesion.administradores().then(setAdministradores);
  }, [modoAdmin]);

  function alternarModoAdmin(): void {
    setModoAdmin((actual) => !actual);
    setSucursal(null);
    setPersona(null);
    setPin('');
    setCampoAbierto(null);
  }

  const opcionesSucursal: SelectOpcion[] = useMemo(
    () => sucursales.map((s) => ({ id: s.id, titulo: s.nombre, subtitulo: textoColaboradores(s) })),
    [sucursales],
  );

  const opcionesPersona: SelectOpcion[] = useMemo(
    () =>
      (modoAdmin ? administradores : colaboradoresDisponibles).map((p) => ({
        id: p.id,
        titulo: p.nombre,
        subtitulo: `DNI ••••${p.dni}`,
      })),
    [modoAdmin, administradores, colaboradoresDisponibles],
  );

  const valorSucursal: SelectOpcion | null = sucursal
    ? { id: sucursal.id, titulo: sucursal.nombre, subtitulo: textoColaboradores(sucursal) }
    : null;

  const valorPersona: SelectOpcion | null = persona
    ? { id: persona.id, titulo: persona.nombre, subtitulo: `DNI ••••${persona.dni}` }
    : null;

  const puedeIngresar = (modoAdmin || !!sucursal) && !!persona && pin.length === LARGO_PIN && !ingresando;

  async function manejarIngreso(): Promise<void> {
    if (!persona) return;
    await ejecutarIngreso(persona.id, pin, {
      ingresar,
      alEntrar: (nuevaSesion) => router.replace(`/${nuevaSesion.colaborador.rol}`),
      // Vaciar el PIN ANTES del aviso: sin esto los 6 puntos quedan puestos y
      // el reintento cae sobre un campo lleno — con 8 intentos/15 min por
      // colaborador, la persona se autobloquea sin entender por qué.
      vaciarPin: () => setPin(''),
      // Al cerrar el aviso, reabrir el teclado: el campo ya quedó vacío y el
      // foco listo para reintentar, sin tener que volver a tocar "Clave". El
      // mensaje lo arma `mensajeDeErrorIngreso`: para un 429 con tiempo del
      // servidor, dice el minuto exacto en vez del "unos minutos" vago.
      alRechazar: (error) =>
        Alert.alert('No se pudo ingresar', mensajeDeErrorIngreso(error), [
          { text: 'Reintentar', onPress: () => setModalPinVisible(true) },
        ]),
      marcarIngresando: setIngresando,
    });
  }

  const version = Constants.expoConfig?.version ?? '—';

  // Mientras se revisa si hay una sesión guardada (o mientras se redirige
  // a ella) no tiene sentido mostrar el formulario en blanco un instante.
  if (cargando || sesion) return <ScreenContainer />;

  return (
    <ScreenContainer scrollable contentStyle={styles.contenido}>
      <View style={styles.formulario}>
        <View style={styles.marca}>
          {/* eslint-disable-next-line @typescript-eslint/no-require-imports */}
          <Image source={require('../assets/logo-trujillo.png')} style={styles.logo} resizeMode="contain" />
        </View>

        <View style={styles.saludo}>
          <View style={styles.saludoFila}>
            <EstrellaMarca size={19} color={colors.dorado} />
            <Text style={styles.saludoTitulo}>Bienvenido</Text>
          </View>
          <Text style={styles.saludoSub}>Ingresa para continuar</Text>
        </View>

        <View style={styles.campos}>
          {!modoAdmin && (
            <View style={styles.campo}>
              <Text style={styles.label}>Sucursal</Text>
              <Select
                icon={MapPin}
                valor={valorSucursal}
                placeholder="Selecciona una sucursal"
                opciones={opcionesSucursal}
                accessibilityLabel="Sucursal"
                abierto={campoAbierto === 'sucursal'}
                onCambiarAbierto={(abierto) => setCampoAbierto(abierto ? 'sucursal' : null)}
                onSeleccionar={(opcion) => {
                  const elegida = sucursales.find((s) => s.id === opcion.id) ?? null;
                  setSucursal(elegida);
                  setPersona(null);
                }}
              />
            </View>
          )}

          <View style={styles.campo}>
            <Text style={styles.label}>Persona</Text>
            <Select
              icon={User}
              valor={valorPersona}
              placeholder={modoAdmin ? 'Selecciona un administrador' : 'Selecciona una persona'}
              opciones={opcionesPersona}
              disabled={!modoAdmin && !sucursal}
              disabledHint="Elegí primero la sucursal"
              accessibilityLabel="Persona"
              abierto={campoAbierto === 'persona'}
              onCambiarAbierto={(abierto) => setCampoAbierto(abierto ? 'persona' : null)}
              onSeleccionar={(opcion) => {
                const disponibles = modoAdmin ? administradores : colaboradoresDisponibles;
                const elegida = disponibles.find((p) => p.id === opcion.id) ?? null;
                setPersona(elegida);
              }}
            />
            <Pressable onPress={alternarModoAdmin} accessibilityRole="button">
              <Text style={styles.olvide}>
                {modoAdmin ? '← Volver al ingreso de tienda' : '¿Sos administrador del sistema? Ingresá acá'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.campo}>
            <Text style={styles.label}>Clave</Text>
            <Pressable
              style={styles.controlClave}
              accessibilityRole="button"
              accessibilityLabel="Clave"
              onPress={() => {
                setCampoAbierto(null);
                setModalPinVisible(true);
              }}
            >
              <Lock size={19} color={colors.grisClaro} />
              {pin.length > 0 ? (
                <PinPuntos valor={pin} longitud={LARGO_PIN} revelado={pinVisible} />
              ) : (
                <Text style={styles.valorVacio}>Ingresa tu clave</Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => Alert.alert('Recuperar clave', 'Todavía no está disponible en esta versión.')}
              accessibilityRole="button"
            >
              <Text style={styles.olvide}>¿Olvidaste tu clave?</Text>
            </Pressable>
          </View>

          <View style={styles.campo}>
            <View style={styles.rolCabecera}>
              <Text style={styles.label}>Rol</Text>
              <Text style={styles.rolNota}>Lo define la persona</Text>
            </View>
            <GrupoRol activo={persona?.rol ?? null} />
          </View>
        </View>

        <Button
          label="Ingresar"
          icon={ArrowRight}
          iconPosition="right"
          size="lg"
          disabled={!puedeIngresar}
          loading={ingresando}
          onPress={manejarIngreso}
        />
      </View>

      <View style={styles.pie}>
        <View style={styles.taglineFila}>
          <EstrellaMarca size={13} color={colors.dorado} />
          <Text style={styles.taglineTexto}>porque mereces lo mejor</Text>
          <EstrellaMarca size={13} color={colors.rojo} />
        </View>
        <Text style={styles.version}>v{version}</Text>
      </View>

      <TecladoPin
        visible={modalPinVisible}
        titulo="Ingresa tu clave"
        valor={pin}
        longitud={LARGO_PIN}
        onCambiar={setPin}
        onCerrar={() => setModalPinVisible(false)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  contenido: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  formulario: {
    gap: spacing.xl,
  },
  marca: { alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.xs },
  logo: { width: 172, height: 62 },
  saludo: { gap: 2 },
  saludoFila: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  saludoTitulo: { fontSize: fontSize.xxl, color: colors.rojo, fontFamily: fonts.marca },
  saludoSub: { fontSize: fontSize.base - 1, color: colors.gris, fontFamily: fonts.regular },
  campos: { gap: spacing.md + 3 },
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
  olvide: { alignSelf: 'flex-start', marginTop: 2, fontSize: 13.5, color: colors.rojo, fontFamily: fonts.regular },
  rolCabecera: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  rolNota: { fontSize: fontSize.xs, color: colors.grisClaro, fontFamily: fonts.medium },
  pie: { alignItems: 'center', gap: 5, paddingTop: spacing.xl },
  taglineFila: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  taglineTexto: { fontSize: 13.5, color: colors.rojo, fontFamily: fonts.marca },
  version: { fontSize: fontSize.xs, color: colors.grisClaro, fontFamily: fonts.medium },
});
