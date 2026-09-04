import { KeyRound, Lock, MapPin, User, UserPlus, Users } from 'lucide-react-native';
import { useCallback, useMemo, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

// TEMPORAL: no vienen de lib/contenedor.ts a propósito — esta tarea no lo
// toca (lo cambia el agente de integración al enchufar el HTTP real). La
// pantalla solo conoce el tipo del puerto, no el adaptador concreto —
// mover este import a contenedor.ts el día de mañana es de una línea.
import { tiendasMemoria as repositorioTiendas } from '../../lib/adaptadores/tiendas-memoria';
import { usuariosMemoria as repositorioUsuarios } from '../../lib/adaptadores/usuarios-memoria';
import { rolesQuePuedeCrear } from '../../lib/dominio/roles';
import type { Rol, Sucursal, Usuario } from '../../lib/dominio/tipos';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';
import { Badge, type BadgeVariant, BarraApp, Button, CampoTexto, Card, EmptyState, PinPuntos, Select, TecladoPin, type SelectOpcion } from '../ui';

const LARGO_PIN = 6;

const NOMBRE_ROL: Record<Rol, string> = {
  administrador: 'Administrador',
  coordinador: 'Coordinador',
  conteo: 'Conteo',
  auditor: 'Auditor',
};
const BADGE_ROL: Record<Rol, BadgeVariant> = {
  administrador: 'proceso',
  auditor: 'default',
  coordinador: 'default',
  conteo: 'outline',
};

export interface UsuariosScreenProps {
  rol: Extract<Rol, 'administrador' | 'auditor'>;
}

type CampoAbierto = 'sucursal' | 'rol' | null;

/**
 * Gestión de cuentas (mobile: pantalla nueva, sin maqueta HTML previa —
 * pedida por el cliente al sumar el rol Administrador). Un solo
 * componente para Administrador y Auditor (mismo criterio que
 * CicloScreen.tsx): la diferencia es el alcance — el Administrador ve y
 * gestiona TODAS las cuentas, el Auditor solo las de su propia sucursal.
 *
 * Regla del cliente, no solo de backend: el selector de rol en "Crear
 * cuenta" NUNCA ofrece un rol que quien crea no pueda otorgar (ver
 * rolesQuePuedeCrear en lib/dominio/roles.ts, la misma función que
 * revalida cada adaptador de RepositorioUsuarios). Nunca se borra una
 * cuenta: se deshabilita.
 */
export function UsuariosScreen({ rol }: UsuariosScreenProps): JSX.Element {
  const { sesion } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [tiendas, setTiendas] = useState<Sucursal[]>([]);

  const [formularioAbierto, setFormularioAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [dni, setDni] = useState('');
  const [rolNuevo, setRolNuevo] = useState<Rol | null>(null);
  const [sucursalNueva, setSucursalNueva] = useState<Sucursal | null>(null);
  const [pin, setPin] = useState('');
  const [modalPinVisible, setModalPinVisible] = useState(false);
  const [campoAbierto, setCampoAbierto] = useState<CampoAbierto>(null);
  const [creando, setCreando] = useState(false);

  const [usuarioResetPin, setUsuarioResetPin] = useState<Usuario | null>(null);
  const [pinReset, setPinReset] = useState('');

  const cargar = useCallback(async () => {
    if (!sesion) return;
    // `!`, no `?.`: si sucursal fuera null para un auditor (no debería
    // pasar nunca), un `?.` degradaría en silencio a `undefined` → listar
    // TODAS las cuentas — una fuga de privacidad, no un detalle visual.
    // Mejor que truene acá a que un auditor vea cuentas de otra sucursal.
    const sucursalId = rol === 'auditor' ? sesion.sucursal!.id : undefined;
    const [listaUsuarios, listaTiendas] = await Promise.all([repositorioUsuarios.listar(sucursalId), repositorioTiendas.listar()]);
    setUsuarios(listaUsuarios);
    setTiendas(listaTiendas);
    setCargando(false);
  }, [sesion, rol]);

  // useFocusEffect: habilitar/deshabilitar o crear una cuenta y volver a
  // esta pantalla (o a Inicio y de vuelta) tiene que reflejar el cambio.
  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar]),
  );

  const nombreTienda = useMemo(() => new Map(tiendas.map((t) => [t.id, t.nombre] as const)), [tiendas]);

  if (!sesion) return <View />;

  const rolesPermitidos = rolesQuePuedeCrear(rol);
  const opcionesRol: SelectOpcion[] = rolesPermitidos.map((r) => ({ id: r, titulo: NOMBRE_ROL[r] }));
  const opcionesTienda: SelectOpcion[] = tiendas.filter((t) => t.activa !== false).map((t) => ({ id: t.id, titulo: t.nombre }));

  const requiereSucursal = rol === 'administrador' && rolNuevo !== null && rolNuevo !== 'administrador';
  const puedeCrear =
    nombre.trim().length > 0 &&
    dni.trim().length > 0 &&
    rolNuevo !== null &&
    pin.length === LARGO_PIN &&
    (!requiereSucursal || sucursalNueva !== null) &&
    !creando;

  function limpiarFormulario(): void {
    setNombre('');
    setDni('');
    setRolNuevo(null);
    setSucursalNueva(null);
    setPin('');
    setFormularioAbierto(false);
  }

  async function crearCuenta(): Promise<void> {
    if (!rolNuevo) return;
    setCreando(true);
    try {
      await repositorioUsuarios.crear(
        {
          nombre: nombre.trim(),
          dni: dni.trim(),
          rol: rolNuevo,
          // El último caso (ni admin nuevo, ni requiereSucursal) solo se
          // da con rol === 'auditor' creando para SU propia sucursal.
          sucursalId: rolNuevo === 'administrador' ? undefined : requiereSucursal ? sucursalNueva!.id : sesion!.sucursal!.id,
          pin,
        },
        rol,
      );
      limpiarFormulario();
      await cargar();
    } catch (error) {
      Alert.alert('No se pudo crear la cuenta', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setCreando(false);
    }
  }

  async function alternarActivo(usuario: Usuario): Promise<void> {
    try {
      await repositorioUsuarios.cambiarActivo(usuario.id, !usuario.activo);
      await cargar();
    } catch (error) {
      Alert.alert('No se pudo actualizar la cuenta', error instanceof Error ? error.message : 'Intentá de nuevo.');
    }
  }

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <BarraApp
        rotulo="Usuarios"
        sede={rol === 'auditor' ? sesion.sucursal!.nombre : undefined}
        cifras={`${usuarios.length} cuenta${usuarios.length === 1 ? '' : 's'} · ${usuarios.filter((u) => u.activo).length} habilitadas`}
      />

      <Button
        label={formularioAbierto ? 'Cancelar' : 'Nueva cuenta'}
        icon={UserPlus}
        variant={formularioAbierto ? 'outline' : 'primary'}
        onPress={() => (formularioAbierto ? limpiarFormulario() : setFormularioAbierto(true))}
      />

      {formularioAbierto ? (
        <Card style={styles.formulario}>
          <Text style={styles.formularioTitulo}>Nueva cuenta</Text>

          <CampoTexto label="Nombre completo" valor={nombre} onCambiar={setNombre} icon={User} placeholder="Ej. Ana Villanueva" />
          <CampoTexto label="DNI" valor={dni} onCambiar={setDni} icon={User} placeholder="Ej. 4410" keyboardType="number-pad" />

          <View style={styles.campo}>
            <Text style={styles.label}>Rol</Text>
            <Select
              icon={Users}
              valor={rolNuevo ? { id: rolNuevo, titulo: NOMBRE_ROL[rolNuevo] } : null}
              placeholder="Elegí un rol"
              opciones={opcionesRol}
              accessibilityLabel="Rol de la nueva cuenta"
              abierto={campoAbierto === 'rol'}
              onCambiarAbierto={(abierto) => setCampoAbierto(abierto ? 'rol' : null)}
              onSeleccionar={(op) => {
                setRolNuevo(op.id as Rol);
                if (op.id === 'administrador') setSucursalNueva(null);
              }}
            />
          </View>

          {requiereSucursal ? (
            <View style={styles.campo}>
              <Text style={styles.label}>Sucursal</Text>
              <Select
                icon={MapPin}
                valor={sucursalNueva ? { id: sucursalNueva.id, titulo: sucursalNueva.nombre } : null}
                placeholder="Elegí una sucursal"
                opciones={opcionesTienda}
                accessibilityLabel="Sucursal de la nueva cuenta"
                abierto={campoAbierto === 'sucursal'}
                onCambiarAbierto={(abierto) => setCampoAbierto(abierto ? 'sucursal' : null)}
                onSeleccionar={(op) => setSucursalNueva(tiendas.find((t) => t.id === op.id) ?? null)}
              />
            </View>
          ) : null}

          <View style={styles.campo}>
            <Text style={styles.label}>PIN inicial</Text>
            <Pressable
              style={styles.controlClave}
              accessibilityRole="button"
              accessibilityLabel="PIN inicial"
              onPress={() => {
                setCampoAbierto(null);
                setModalPinVisible(true);
              }}
            >
              <Lock size={19} color={colors.grisClaro} />
              {pin.length > 0 ? <PinPuntos valor={pin} longitud={LARGO_PIN} /> : <Text style={styles.valorVacio}>Definir PIN de 6 dígitos</Text>}
            </Pressable>
          </View>

          <Button label="Crear cuenta" onPress={crearCuenta} disabled={!puedeCrear} loading={creando} />
        </Card>
      ) : null}

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : usuarios.length === 0 ? (
        <EmptyState icon={Users} title="Todavía no hay cuentas" subtitle="Creá la primera con el botón de arriba." />
      ) : (
        <View style={styles.lista}>
          {usuarios.map((usuario) => (
            <Card key={usuario.id} style={styles.fila}>
              <View style={styles.filaCabecera}>
                <View style={styles.filaTextos}>
                  <Text style={styles.filaNombre}>{usuario.nombre}</Text>
                  <Text style={styles.filaMeta}>
                    DNI {usuario.dni}
                    {rol === 'administrador' && usuario.sucursalId ? ` · ${nombreTienda.get(usuario.sucursalId) ?? 'Sucursal'}` : ''}
                  </Text>
                </View>
                <View style={styles.filaBadges}>
                  <Badge label={NOMBRE_ROL[usuario.rol]} variant={BADGE_ROL[usuario.rol]} />
                  <Badge label={usuario.activo ? 'Habilitada' : 'Deshabilitada'} variant={usuario.activo ? 'ok' : 'espera'} />
                </View>
              </View>
              <View style={styles.filaAcciones}>
                <Button
                  label={usuario.activo ? 'Deshabilitar' : 'Habilitar'}
                  variant="outline"
                  size="sm"
                  onPress={() => alternarActivo(usuario)}
                  style={styles.filaBoton}
                />
                <Button
                  label="Resetear PIN"
                  icon={KeyRound}
                  variant="outline"
                  size="sm"
                  onPress={() => {
                    setPinReset('');
                    setUsuarioResetPin(usuario);
                  }}
                  style={styles.filaBoton}
                />
              </View>
            </Card>
          ))}
        </View>
      )}

      <TecladoPin
        visible={modalPinVisible}
        titulo="Definí el PIN inicial"
        valor={pin}
        longitud={LARGO_PIN}
        onCambiar={setPin}
        onCerrar={() => setModalPinVisible(false)}
      />

      <TecladoPin
        visible={usuarioResetPin !== null}
        titulo={`Nuevo PIN para ${usuarioResetPin?.nombre ?? ''}`}
        valor={pinReset}
        longitud={LARGO_PIN}
        onCambiar={setPinReset}
        onCerrar={async () => {
          const usuario = usuarioResetPin;
          const nuevoPin = pinReset;
          setUsuarioResetPin(null);
          setPinReset('');
          if (!usuario || nuevoPin.length !== LARGO_PIN) return;
          try {
            await repositorioUsuarios.resetearPin(usuario.id, nuevoPin);
            Alert.alert('PIN actualizado', `Se asignó un PIN nuevo a ${usuario.nombre}.`);
          } catch (error) {
            Alert.alert('No se pudo resetear el PIN', error instanceof Error ? error.message : 'Intentá de nuevo.');
          }
        }}
      />
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: 14, paddingTop: 8, gap: 14 },
  cargando: { marginTop: 24 },
  formulario: { gap: 12 },
  formularioTitulo: { fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
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
  lista: { gap: 10 },
  fila: { gap: 10, padding: 13 },
  filaCabecera: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  filaTextos: { flex: 1, minWidth: 0 },
  filaNombre: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.bold },
  filaMeta: { marginTop: 2, fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },
  filaBadges: { flex: 0, alignItems: 'flex-end', gap: 6 },
  filaAcciones: { flexDirection: 'row', gap: 8 },
  filaBoton: { flex: 1 },
});
