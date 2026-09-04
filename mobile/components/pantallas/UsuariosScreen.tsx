import { KeyRound, Lock, MapPin, SquarePen, Trash2, User, UserCheck, UserCog, UserPlus, Users, UserX, X } from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Del contenedor, no de un adaptador concreto: con el backend vivo
// (2026-09-04) esto es lo que hace que la pantalla liste las cuentas
// REALES de Postgres. Mientras importaba `usuariosMemoria` directo, la
// perilla del contenedor no la alcanzaba y seguía mostrando el mock en
// RAM aunque el servidor respondiera.
import { repositorioTiendas, repositorioUsuarios } from '../../lib/contenedor';
import { rolesQuePuedeCrear } from '../../lib/dominio/roles';
import type { Rol, Sucursal, Usuario } from '../../lib/dominio/tipos';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';
import { ALTO_TAB_BAR } from '../navegacion/tabs';
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
  const insets = useSafeAreaInsets();
  const [cargando, setCargando] = useState(true);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [tiendas, setTiendas] = useState<Sucursal[]>([]);
  const [usuarioSeleccionado, setUsuarioSeleccionado] = useState<Usuario | null>(null);

  const [menuAbierto, setMenuAbierto] = useState(false);
  const animacionMenu = useRef(new Animated.Value(0)).current;

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

  const [modalEditarVisible, setModalEditarVisible] = useState(false);
  const [editNombre, setEditNombre] = useState('');
  const [editDni, setEditDni] = useState('');
  const [editRol, setEditRol] = useState<Rol | null>(null);
  const [editSucursal, setEditSucursal] = useState<Sucursal | null>(null);
  const [campoEditAbierto, setCampoEditAbierto] = useState<CampoAbierto>(null);
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);

  const cargar = useCallback(async () => {
    if (!sesion) return;
    // `!`, no `?.`: si sucursal fuera null para un auditor (no debería
    // pasar nunca), un `?.` degradaría en silencio a `undefined` → listar
    // TODAS las cuentas — una fuga de privacidad, no un detalle visual.
    // Mejor que truene acá a que un auditor vea cuentas de otra sucursal.
    const sucursalId = rol === 'auditor' ? sesion.sucursal!.id : undefined;
    // Las tiendas SOLO las pide el Administrador. `GET /api/tiendas` está
    // detrás de requiereRol('administrador'): con el backend real, pedirlas
    // como Auditor devuelve 403 y dejaría esta pantalla cargando para
    // siempre. Y no le hacen falta — el Auditor no elige sucursal al crear
    // (crea para la suya) ni muestra el nombre de sucursal en las fichas,
    // porque todas las que ve son de la misma.
    const [listaUsuarios, listaTiendas] = await Promise.all([
      repositorioUsuarios.listar(sucursalId),
      rol === 'administrador' ? repositorioTiendas.listar() : Promise.resolve<Sucursal[]>([]),
    ]);
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
  const seleccionadoActual = usuarios.find((u) => u.id === usuarioSeleccionado?.id) ?? null;

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

  function alternarMenu(): void {
    const destino = menuAbierto ? 0 : 1;
    setMenuAbierto(!menuAbierto);
    Animated.spring(animacionMenu, {
      toValue: destino,
      friction: 6,
      tension: 45,
      useNativeDriver: true,
    }).start();
  }

  function cerrarMenu(): void {
    setMenuAbierto(false);
    Animated.timing(animacionMenu, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }

  const rotacionIcono = animacionMenu.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });
  const opacidadOpciones = animacionMenu;
  const escalaOpciones = animacionMenu.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 1],
  });
  const desplazamientoOpciones = animacionMenu.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });

  function abrirEditar(usuario: Usuario): void {
    setEditNombre(usuario.nombre);
    setEditDni(usuario.dni);
    setEditRol(usuario.rol);
    setEditSucursal(tiendas.find((t) => t.id === usuario.sucursalId) ?? null);
    setCampoEditAbierto(null);
    setModalEditarVisible(true);
  }

  const requiereSucursalEdicion = rol === 'administrador' && editRol !== null && editRol !== 'administrador';
  const puedeGuardarEdicion =
    editNombre.trim().length > 0 &&
    editDni.trim().length >= 4 &&
    editRol !== null &&
    (!requiereSucursalEdicion || editSucursal !== null) &&
    !guardandoEdicion;

  async function guardarEdicion(): Promise<void> {
    if (!seleccionadoActual || !editRol) return;
    setGuardandoEdicion(true);
    try {
      const requiereSuc = rol === 'administrador' && editRol !== 'administrador';
      await repositorioUsuarios.editar(seleccionadoActual.id, {
        nombre: editNombre.trim(),
        dni: editDni.trim(),
        rol: editRol,
        sucursalId: editRol === 'administrador' ? undefined : requiereSuc ? editSucursal?.id : sesion?.sucursal?.id,
      });
      setModalEditarVisible(false);
      await cargar();
      Alert.alert('Cuenta editada', `Se actualizaron los datos de ${editNombre.trim()}.`);
    } catch (error) {
      Alert.alert('No se pudo editar la cuenta', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setGuardandoEdicion(false);
    }
  }

  function confirmarEliminar(usuario: Usuario): void {
    Alert.alert('Eliminar cuenta', `¿Eliminar cuenta de ${usuario.nombre}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          try {
            await repositorioUsuarios.eliminar(usuario.id);
            setUsuarioSeleccionado(null);
            setMenuAbierto(false);
            animacionMenu.setValue(0);
            await cargar();
            Alert.alert('Cuenta eliminada', `Se eliminó la cuenta de ${usuario.nombre}.`);
          } catch (error) {
            Alert.alert('No se pudo eliminar la cuenta', error instanceof Error ? error.message : 'Intentá de nuevo.');
          }
        },
      },
    ]);
  }

  return (
    <PantallaConTabs scrollable={false} contentStyle={styles.pantallaConTabs}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.contenido, { paddingBottom: ALTO_TAB_BAR + insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
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
            <View style={styles.formularioCabecera}>
              <UserPlus size={17} color={colors.rojo} />
              <Text style={styles.formularioTitulo}>Nueva cuenta</Text>
            </View>

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
            {/* Encabezado de sección: separa el formulario de la lista y dice
                cuántas cuentas alcanza a ver ESTA sesión — para el Auditor no
                son las mismas que ve el Administrador. */}
            <View style={styles.seccion}>
              <Text style={styles.seccionTitulo}>Cuentas</Text>
              <Text style={styles.seccionTotal}>
                {usuarios.length} cuenta{usuarios.length === 1 ? '' : 's'}
              </Text>
            </View>
            {usuarios.map((usuario) => {
              const esSeleccionado = seleccionadoActual?.id === usuario.id;
              return (
                <Pressable
                  key={usuario.id}
                  onPress={() =>
                    setUsuarioSeleccionado((act) => {
                      if (act?.id === usuario.id) {
                        setMenuAbierto(false);
                        animacionMenu.setValue(0);
                        return null;
                      }
                      setMenuAbierto(false);
                      animacionMenu.setValue(0);
                      return usuario;
                    })
                  }
                  accessibilityRole="button"
                  accessibilityState={{ selected: esSeleccionado }}
                >
                  <Card style={[styles.fila, esSeleccionado && styles.filaSeleccionada]}>
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
                  </Card>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      {seleccionadoActual && menuAbierto ? (
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={cerrarMenu}
          accessibilityLabel="Cerrar opciones"
        />
      ) : null}

      {seleccionadoActual ? (
        <View style={[styles.speedDialContenedor, { bottom: ALTO_TAB_BAR + insets.bottom + 28 }]}>
          <Animated.View
            pointerEvents={menuAbierto ? 'auto' : 'none'}
            style={[
              styles.speedDialOpciones,
              {
                opacity: opacidadOpciones,
                transform: [{ translateY: desplazamientoOpciones }, { scale: escalaOpciones }],
              },
            ]}
          >
            {/* 1. Editar cuenta */}
            <Pressable
              style={styles.speedDialFila}
              onPress={() => {
                alternarMenu();
                abrirEditar(seleccionadoActual);
              }}
              accessibilityRole="button"
              accessibilityLabel="Editar cuenta"
            >
              <View style={styles.speedDialPill}>
                <Text style={styles.speedDialPillTexto}>Editar cuenta</Text>
              </View>
              <View style={styles.speedDialBoton}>
                <SquarePen size={20} color={colors.tinta} />
              </View>
            </Pressable>

            {/* 2. Resetear PIN */}
            <Pressable
              style={styles.speedDialFila}
              onPress={() => {
                alternarMenu();
                setPinReset('');
                setUsuarioResetPin(seleccionadoActual);
              }}
              accessibilityRole="button"
              accessibilityLabel="Resetear PIN"
            >
              <View style={styles.speedDialPill}>
                <Text style={styles.speedDialPillTexto}>Resetear PIN</Text>
              </View>
              <View style={styles.speedDialBoton}>
                <KeyRound size={20} color={colors.tinta} />
              </View>
            </Pressable>

            {/* 3. Deshabilitar / Habilitar */}
            <Pressable
              style={styles.speedDialFila}
              onPress={() => {
                alternarMenu();
                alternarActivo(seleccionadoActual);
              }}
              accessibilityRole="button"
              accessibilityLabel={seleccionadoActual.activo ? 'Deshabilitar cuenta' : 'Habilitar cuenta'}
            >
              <View style={styles.speedDialPill}>
                <Text style={styles.speedDialPillTexto}>
                  {seleccionadoActual.activo ? 'Deshabilitar' : 'Habilitar'}
                </Text>
              </View>
              <View style={styles.speedDialBoton}>
                {seleccionadoActual.activo ? (
                  <UserX size={20} color={colors.tinta} />
                ) : (
                  <UserCheck size={20} color={colors.tinta} />
                )}
              </View>
            </Pressable>

            {/* 4. Eliminar cuenta */}
            <Pressable
              style={styles.speedDialFila}
              onPress={() => {
                alternarMenu();
                confirmarEliminar(seleccionadoActual);
              }}
              accessibilityRole="button"
              accessibilityLabel="Eliminar cuenta"
            >
              <View style={styles.speedDialPill}>
                <Text style={styles.speedDialPillTextoDestructivo}>Eliminar cuenta</Text>
              </View>
              <View style={styles.speedDialBoton}>
                <Trash2 size={20} color={colors.rojo} />
              </View>
            </Pressable>
          </Animated.View>

          {/* FAB Principal */}
          <Pressable
            style={styles.speedDialFab}
            onPress={alternarMenu}
            accessibilityRole="button"
            accessibilityLabel={menuAbierto ? 'Cerrar acciones' : 'Abrir acciones'}
          >
            <Animated.View style={{ transform: [{ rotate: rotacionIcono }] }}>
              {menuAbierto ? (
                <X size={24} color={colors.blanco} strokeWidth={2.5} />
              ) : (
                <UserCog size={24} color={colors.blanco} strokeWidth={2.3} />
              )}
            </Animated.View>
          </Pressable>
        </View>
      ) : null}

      <Modal
        visible={modalEditarVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalEditarVisible(false)}
      >
        <Pressable style={styles.modalFondo} onPress={() => setModalEditarVisible(false)} />
        <View pointerEvents="box-none" style={styles.modalCentrado}>
          <View style={styles.modalCaja}>
            <View style={styles.modalCabecera}>
              <Text style={styles.modalTitulo}>Editar cuenta</Text>
              <Pressable
                onPress={() => setModalEditarVisible(false)}
                style={styles.modalCerrar}
                accessibilityLabel="Cerrar modal de edición"
              >
                <X size={19} color={colors.gris} />
              </Pressable>
            </View>

            <CampoTexto
              label="Nombre completo"
              valor={editNombre}
              onCambiar={setEditNombre}
              icon={User}
              placeholder="Ej. Ana Villanueva"
            />
            <CampoTexto
              label="DNI"
              valor={editDni}
              onCambiar={(val) => setEditDni(val.replace(/[^0-9]/g, ''))}
              icon={User}
              placeholder="Ej. 4410"
              keyboardType="number-pad"
            />

            <View style={styles.campo}>
              <Text style={styles.label}>Rol</Text>
              <Select
                icon={Users}
                valor={editRol ? { id: editRol, titulo: NOMBRE_ROL[editRol] } : null}
                placeholder="Elegí un rol"
                opciones={opcionesRol}
                accessibilityLabel="Rol de la cuenta"
                abierto={campoEditAbierto === 'rol'}
                onCambiarAbierto={(abierto) => setCampoEditAbierto(abierto ? 'rol' : null)}
                onSeleccionar={(op) => {
                  setEditRol(op.id as Rol);
                  if (op.id === 'administrador') setEditSucursal(null);
                }}
              />
            </View>

            {requiereSucursalEdicion ? (
              <View style={styles.campo}>
                <Text style={styles.label}>Sucursal</Text>
                <Select
                  icon={MapPin}
                  valor={editSucursal ? { id: editSucursal.id, titulo: editSucursal.nombre } : null}
                  placeholder="Elegí una sucursal"
                  opciones={opcionesTienda}
                  accessibilityLabel="Sucursal de la cuenta"
                  abierto={campoEditAbierto === 'sucursal'}
                  onCambiarAbierto={(abierto) => setCampoEditAbierto(abierto ? 'sucursal' : null)}
                  onSeleccionar={(op) => setEditSucursal(tiendas.find((t) => t.id === op.id) ?? null)}
                />
              </View>
            ) : null}

            <Button
              label="Guardar cambios"
              onPress={guardarEdicion}
              disabled={!puedeGuardarEdicion}
              loading={guardandoEdicion}
            />
          </View>
        </View>
      </Modal>

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
  pantallaConTabs: { padding: 0, paddingBottom: 0, flex: 1 },
  flex: { flex: 1 },
  contenido: { paddingHorizontal: 14, paddingTop: 8, gap: 14 },
  cargando: { marginTop: 24 },
  formulario: { gap: 12 },
  formularioCabecera: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  formularioTitulo: { flex: 1, fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
  // Encabezado de sección del design system (.seccion en controles.css):
  // versalita gris a la izquierda, total tenue a la derecha.
  seccion: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  seccionTitulo: { fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gris, fontFamily: fonts.semibold },
  seccionTotal: { fontSize: 11.5, color: colors.grisClaro, fontFamily: fonts.regular },
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
  filaSeleccionada: {
    borderColor: colors.rojo,
    borderWidth: 1.5,
    backgroundColor: colors.rojoSuave,
  },
  filaCabecera: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  filaTextos: { flex: 1, minWidth: 0 },
  filaNombre: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.bold },
  filaMeta: { marginTop: 2, fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },
  filaBadges: { flex: 0, alignItems: 'flex-end', gap: 6 },
  speedDialContenedor: {
    position: 'absolute',
    right: 16,
    alignItems: 'flex-end',
    gap: 12,
    zIndex: 50,
  },
  speedDialOpciones: {
    alignItems: 'flex-end',
    gap: 12,
  },
  speedDialFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  speedDialPill: {
    backgroundColor: colors.blanco,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borde,
    elevation: 4,
    shadowColor: colors.tinta,
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  speedDialPillTexto: {
    fontSize: 13,
    color: colors.tinta,
    fontFamily: fonts.semibold,
  },
  // Eliminar es la única acción destructiva del menú: con el resto de las
  // opciones en gris neutro, necesita su propia señal para no perderse
  // entre "Editar"/"Resetear"/"Deshabilitar" — el matiz rojo va en el
  // ícono (ver Trash2 más abajo) y acá, en el texto de su etiqueta.
  speedDialPillTextoDestructivo: {
    fontSize: 13,
    color: colors.rojo,
    fontFamily: fonts.semibold,
  },
  speedDialBoton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.riel,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
    shadowColor: colors.tinta,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  speedDialFab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.rojo,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: colors.tinta,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  modalFondo: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(28,25,23,0.42)',
  },
  modalCentrado: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
  },
  modalCaja: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.campo,
    borderRadius: 16,
    padding: 17,
    gap: 14,
    elevation: 8,
    shadowColor: colors.tinta,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  modalCabecera: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 4,
  },
  modalTitulo: {
    fontSize: 16,
    color: colors.tinta,
    fontFamily: fonts.bold,
  },
  modalCerrar: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
});
