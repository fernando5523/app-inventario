import { router } from 'expo-router';
import { KeyRound, Lock, MapPin, SquarePen, Trash2, User, UserCheck, UserPlus, Users, UserX, X } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useCallback, useMemo, useState, type JSX } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { useRefrescoAlEnfocar } from '../hooks/useRefrescoAlEnfocar';
import { repositorioTiendas, repositorioUsuarios } from '../../lib/contenedor';
import { pluralizar } from '../../lib/dominio/plural';
import { rolesQuePuedeCrear } from '../../lib/dominio/roles';
import type { Rol, Sucursal, Usuario } from '../../lib/dominio/tipos';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';
import { CampoTexto, PinPuntos, Select, TecladoPin, type SelectOpcion } from '../ui';
import { BotonWeb, CeldaTexto, EncabezadoPagina, TablaWeb, TarjetaWeb, type ColumnaTabla } from '../web';

const LARGO_PIN = 6;
const ANCHO_ANGOSTO = 1180;

const NOMBRE_ROL: Record<Rol, string> = {
  administrador: 'Administrador',
  coordinador: 'Coordinador',
  conteo: 'Conteo',
  auditor: 'Auditor',
};

export interface UsuariosScreenProps {
  rol: Extract<Rol, 'administrador' | 'auditor'>;
}

type CampoAbierto = 'sucursal' | 'rol' | null;

/**
 * ---------------------------------------------------------------------------
 * LAS CUENTAS EN EL NAVEGADOR: UNA TABLA
 * ---------------------------------------------------------------------------
 * Clon de `UsuariosScreen.tsx`. Metro elige este archivo en el bundle de web y
 * el del teléfono no se toca -- decisión del usuario: *"clonalo y cambialo, en
 * todo caso son plataformas diferentes"*.
 *
 * MISMA FUNCIONALIDAD, hasta el último texto y el último `Alert`: los mismos
 * repositorios, el mismo `rolesQuePuedeCrear`, las mismas reglas de qué campos
 * hacen falta y los mismos mensajes del backend.
 *
 * ---------------------------------------------------------------------------
 * EL SPEED DIAL NO CRUZA A LA WEB
 * ---------------------------------------------------------------------------
 * En el teléfono las cuatro acciones (editar, resetear PIN, habilitar,
 * eliminar) viven en un botón flotante que se abre sobre la lista: ahí no hay
 * ancho para ponerlas en la fila, y apilarlas dentro de cada tarjeta
 * multiplicaría el alto de la lista (regla de `trujillo-ui`).
 *
 * Acá sí hay ancho, y esa regla existía JUSTAMENTE por no tenerlo. Las cuatro
 * acciones van en la última columna, sobre la fila a la que pertenecen: se ve
 * de quién es cada botón sin tener que seleccionar primero. Eliminar sigue
 * pidiendo confirmación con el nombre, que es lo que evita borrar la cuenta
 * equivocada.
 */
export function UsuariosScreen({ rol }: UsuariosScreenProps): JSX.Element {
  const { sesion } = useSesion();
  const { width } = useWindowDimensions();
  const angosto = width < ANCHO_ANGOSTO;

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  const [editando, setEditando] = useState<Usuario | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [editDni, setEditDni] = useState('');
  const [editRol, setEditRol] = useState<Rol | null>(null);
  const [editSucursal, setEditSucursal] = useState<Sucursal | null>(null);
  const [campoEditAbierto, setCampoEditAbierto] = useState<CampoAbierto>(null);
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);

  const cargar = useCallback(async () => {
    if (!sesion) return;
    setError(null);
    try {
      // `!`, no `?.`: si `sucursal` fuera null para un auditor (no debería
      // pasar nunca), un `?.` degradaría en silencio a `undefined` -> listar
      // TODAS las cuentas, que es una fuga de privacidad y no un detalle
      // visual. Mejor que truene acá.
      const sucursalId = rol === 'auditor' ? sesion.sucursal!.id : undefined;
      // Las tiendas SOLO las pide el Administrador: `GET /api/tiendas` está
      // detrás de `requiereRol('administrador')` y como Auditor devolvería 403.
      const [listaUsuarios, listaTiendas] = await Promise.all([
        repositorioUsuarios.listar(sucursalId),
        rol === 'administrador' ? repositorioTiendas.listar() : Promise.resolve<Sucursal[]>([]),
      ]);
      setUsuarios(listaUsuarios);
      setTiendas(listaTiendas);
    } catch (e) {
      // Sin esto, un fallo sin red deja el spinner girando para siempre.
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las cuentas.');
    } finally {
      setCargando(false);
    }
  }, [sesion, rol]);

  // Pausado con cualquier cosa abierta, y con `recuperarAlDespausar` para que
  // el disparo que llegue mientras se tipea corra al cerrar. Mismo criterio
  // que el teléfono.
  const { refrescar } = useRefrescoAlEnfocar(cargar, {
    recuperarAlDespausar: true,
    pausado: formularioAbierto || editando !== null || modalPinVisible || usuarioResetPin !== null || creando || guardandoEdicion,
  });

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
          // El último caso (ni admin nuevo, ni requiereSucursal) solo se da
          // con rol === 'auditor' creando para SU propia sucursal.
          sucursalId: rolNuevo === 'administrador' ? undefined : requiereSucursal ? sucursalNueva!.id : sesion!.sucursal!.id,
          pin,
        },
        rol,
      );
      limpiarFormulario();
      await cargar();
    } catch (error) {
      Alert.alert('No se pudo crear la cuenta', error instanceof Error ? error.message : 'Intenta de nuevo.');
    } finally {
      setCreando(false);
    }
  }

  async function alternarActivo(usuario: Usuario): Promise<void> {
    try {
      await repositorioUsuarios.cambiarActivo(usuario.id, !usuario.activo);
      await cargar();
    } catch (error) {
      Alert.alert('No se pudo actualizar la cuenta', error instanceof Error ? error.message : 'Intenta de nuevo.');
    }
  }

  function abrirEditar(usuario: Usuario): void {
    setEditNombre(usuario.nombre);
    setEditDni(usuario.dni);
    setEditRol(usuario.rol);
    setEditSucursal(tiendas.find((t) => t.id === usuario.sucursalId) ?? null);
    setCampoEditAbierto(null);
    setEditando(usuario);
  }

  const requiereSucursalEdicion = rol === 'administrador' && editRol !== null && editRol !== 'administrador';
  const puedeGuardarEdicion =
    editNombre.trim().length > 0 &&
    editDni.trim().length >= 4 &&
    editRol !== null &&
    (!requiereSucursalEdicion || editSucursal !== null) &&
    !guardandoEdicion;

  async function guardarEdicion(): Promise<void> {
    if (!editando || !editRol) return;
    setGuardandoEdicion(true);
    try {
      const requiereSuc = rol === 'administrador' && editRol !== 'administrador';
      await repositorioUsuarios.editar(editando.id, {
        nombre: editNombre.trim(),
        dni: editDni.trim(),
        rol: editRol,
        sucursalId: editRol === 'administrador' ? undefined : requiereSuc ? editSucursal?.id : sesion?.sucursal?.id,
      });
      setEditando(null);
      await cargar();
      Alert.alert('Cuenta editada', `Se actualizaron los datos de ${editNombre.trim()}.`);
    } catch (error) {
      Alert.alert('No se pudo editar la cuenta', error instanceof Error ? error.message : 'Intenta de nuevo.');
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
            await cargar();
            Alert.alert('Cuenta eliminada', `Se eliminó la cuenta de ${usuario.nombre}.`);
          } catch (error) {
            Alert.alert('No se pudo eliminar la cuenta', error instanceof Error ? error.message : 'Intenta de nuevo.');
          }
        },
      },
    ]);
  }

  const habilitadas = usuarios.filter((u) => u.activo).length;

  /**
   * LAS COLUMNAS, para `TablaWeb`. Son las MISMAS seis que ya había; lo único
   * que cambia es quién las dibuja.
   *
   * Sucursal solo para el Administrador: el Auditor ve únicamente las cuentas
   * de su tienda, así que una columna con el mismo nombre repetido en cada
   * fila no informa nada y le roba ancho al resto. Es el mismo criterio que
   * tenía la tabla de antes.
   *
   * NO hay `onAbrirFila`: tocar la fila no lleva a ningún lado -- las cuatro
   * acciones son botones propios, cada uno sobre su fila.
   */
  const columnas: ColumnaTabla<Usuario>[] = [
    { clave: 'nombre', titulo: 'Nombre', celda: (u) => <CeldaTexto fuerte>{u.nombre}</CeldaTexto> },
    // `numero` por el `tabular-nums`, pero a la izquierda: un DNI es un
    // identificador, no una cantidad, y alinearlo a la derecha lo haría leer
    // como un monto.
    { clave: 'dni', titulo: 'DNI', ancho: 110, celda: (u) => <CeldaTexto numero>{u.dni}</CeldaTexto> },
    {
      clave: 'rol',
      titulo: 'Rol',
      ancho: 150,
      celda: (u) => <PillUsuario texto={NOMBRE_ROL[u.rol]} tono={u.rol === 'administrador' ? 'atencion' : 'neutro'} />,
    },
    ...(rol === 'administrador'
      ? [
          {
            clave: 'sucursal',
            titulo: 'Sucursal',
            ancho: 180,
            celda: (u: Usuario) => (
              <CeldaTexto color={colors.gris}>
                {u.sucursalId ? (nombreTienda.get(u.sucursalId) ?? 'Sucursal') : '—'}
              </CeldaTexto>
            ),
          },
        ]
      : []),
    {
      clave: 'estado',
      titulo: 'Estado',
      ancho: 150,
      // Habilitada en VERDE y deshabilitada en GRIS, nunca en rojo: una cuenta
      // deshabilitada no es una falla ni un peligro, es una decisión que
      // alguien tomó. Por lo mismo la fila NO lleva tinte.
      celda: (u) => <PillUsuario texto={u.activo ? 'Habilitada' : 'Deshabilitada'} tono={u.activo ? 'ok' : 'neutro'} />,
    },
    {
      clave: 'acciones',
      titulo: 'Acciones',
      ancho: 168,
      celda: (u) => (
        <View style={styles.acciones}>
          <AccionFila icono={SquarePen} etiqueta={`Editar cuenta de ${u.nombre}`} onPress={() => abrirEditar(u)} />
          <AccionFila
            icono={KeyRound}
            etiqueta={`Resetear PIN de ${u.nombre}`}
            onPress={() => {
              setPinReset('');
              setUsuarioResetPin(u);
            }}
          />
          <AccionFila
            icono={u.activo ? UserX : UserCheck}
            etiqueta={`${u.activo ? 'Deshabilitar' : 'Habilitar'} cuenta de ${u.nombre}`}
            onPress={() => void alternarActivo(u)}
          />
          <AccionFila
            icono={Trash2}
            etiqueta={`Eliminar cuenta de ${u.nombre}`}
            peligro
            onPress={() => confirmarEliminar(u)}
          />
        </View>
      ),
    },
  ];

  return (
    <ScrollView style={styles.pagina} contentContainerStyle={styles.contenido} showsVerticalScrollIndicator={false}>
      <EncabezadoPagina
        migas={['Administración', 'Usuarios']}
        titulo="Usuarios"
        sub={
          rol === 'auditor'
            ? `Cuentas de ${sesion.sucursal!.nombre}. Nunca se borra una cuenta por descuido: se deshabilita.`
            : 'Cuentas de toda la cadena. Nunca se borra una cuenta por descuido: se deshabilita.'
        }
        onInicio={() => router.push('/')}
        acciones={
          /* EL ÚNICO ROJO de la página, y solo mientras el formulario está
             cerrado: con el formulario abierto el rojo pasa a ser "Crear
             cuenta", que es la acción de verdad en ese momento. Dos rojos a la
             vez es un formulario donde nadie sabe cuál tocar. */
          <BotonWeb
            etiqueta={formularioAbierto ? 'Cancelar' : 'Nueva cuenta'}
            icono={formularioAbierto ? X : UserPlus}
            variante={formularioAbierto ? 'secundario' : 'principal'}
            onPress={() => (formularioAbierto ? limpiarFormulario() : setFormularioAbierto(true))}
          />
        }
      />

      {formularioAbierto ? (
        <TarjetaWeb titulo="Nueva cuenta" icono={UserPlus} style={styles.formulario}>
          <View style={[styles.filaCampos, angosto && styles.filaCamposApilada]}>
            <View style={styles.campoAncho}>
              <CampoTexto label="Nombre completo" valor={nombre} onCambiar={setNombre} icon={User} placeholder="Ej. Ana Villanueva" />
            </View>
            <View style={styles.campoAncho}>
              <CampoTexto label="DNI" valor={dni} onCambiar={setDni} icon={User} placeholder="Ej. 4410" keyboardType="number-pad" />
            </View>
          </View>

          <View style={[styles.filaCampos, angosto && styles.filaCamposApilada]}>
            <View style={styles.campoAncho}>
              <Text style={styles.label}>Rol</Text>
              <Select
                icon={Users}
                valor={rolNuevo ? { id: rolNuevo, titulo: NOMBRE_ROL[rolNuevo] } : null}
                placeholder="Elige un rol"
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
              <View style={styles.campoAncho}>
                <Text style={styles.label}>Sucursal</Text>
                <Select
                  icon={MapPin}
                  valor={sucursalNueva ? { id: sucursalNueva.id, titulo: sucursalNueva.nombre } : null}
                  placeholder="Elige una sucursal"
                  opciones={opcionesTienda}
                  accessibilityLabel="Sucursal de la nueva cuenta"
                  abierto={campoAbierto === 'sucursal'}
                  onCambiarAbierto={(abierto) => setCampoAbierto(abierto ? 'sucursal' : null)}
                  onSeleccionar={(op) => setSucursalNueva(tiendas.find((t) => t.id === op.id) ?? null)}
                />
              </View>
            ) : (
              <View style={styles.campoAncho} />
            )}
          </View>

          <View style={styles.campoMitad}>
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

          <BotonWeb
            etiqueta="Crear cuenta"
            icono={UserPlus}
            variante="principal"
            deshabilitado={!puedeCrear}
            cargando={creando}
            onPress={() => void crearCuenta()}
          />
        </TarjetaWeb>
      ) : null}

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : error ? (
        <TarjetaWeb titulo="No se pudo cargar el listado" icono={Users} tono="neutro">
          <Text style={styles.ayuda}>{error}</Text>
          <BotonWeb etiqueta="Reintentar" variante="principal" onPress={() => refrescar()} />
        </TarjetaWeb>
      ) : usuarios.length === 0 ? (
        <TarjetaWeb titulo="Todavía no hay cuentas" icono={Users} tono="neutro">
          <Text style={styles.ayuda}>Crea la primera con el botón de arriba.</Text>
        </TarjetaWeb>
      ) : (
        /*
          LA TABLA ÚNICA DE LA WEB. Antes esta pantalla dibujaba su propio
          marco, su propia cabecera y sus propias filas; ahora las pone
          `TablaWeb`, que es la misma que usan la matriz y la clasificación.
          Los datos, los permisos y los textos no cambiaron.
        */
        <TablaWeb
          titulo="Cuentas"
          sub={`${usuarios.length} ${pluralizar(usuarios.length, 'cuenta', 'cuentas')} · ${habilitadas} ${pluralizar(habilitadas, 'habilitada', 'habilitadas')}`}
          icono={Users}
          columnas={columnas}
          filas={usuarios}
          claveDe={(u) => String(u.id)}
        />
      )}

      <Modal visible={editando !== null} transparent animationType="fade" onRequestClose={() => setEditando(null)}>
        <Pressable style={styles.modalFondo} onPress={() => setEditando(null)} accessibilityLabel="Cerrar modal de edición" />
        <View pointerEvents="box-none" style={styles.modalCentrado}>
          <View style={styles.modalCaja}>
            <View style={styles.modalCabecera}>
              <Text style={styles.modalTitulo}>Editar cuenta</Text>
              <Pressable onPress={() => setEditando(null)} style={styles.modalCerrar} accessibilityLabel="Cerrar modal de edición">
                <X size={19} color={colors.gris} />
              </Pressable>
            </View>

            <CampoTexto label="Nombre completo" valor={editNombre} onCambiar={setEditNombre} icon={User} placeholder="Ej. Ana Villanueva" />
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
                placeholder="Elige un rol"
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
                  placeholder="Elige una sucursal"
                  opciones={opcionesTienda}
                  accessibilityLabel="Sucursal de la cuenta"
                  abierto={campoEditAbierto === 'sucursal'}
                  onCambiarAbierto={(abierto) => setCampoEditAbierto(abierto ? 'sucursal' : null)}
                  onSeleccionar={(op) => setEditSucursal(tiendas.find((t) => t.id === op.id) ?? null)}
                />
              </View>
            ) : null}

            <BotonWeb
              etiqueta="Guardar cambios"
              variante="principal"
              deshabilitado={!puedeGuardarEdicion}
              cargando={guardandoEdicion}
              onPress={() => void guardarEdicion()}
            />
          </View>
        </View>
      </Modal>

      <TecladoPin
        visible={modalPinVisible}
        titulo="Define el PIN inicial"
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
        // `onCompletar`, NO `onCerrar`: el PIN completo viene como ARGUMENTO.
        // Leyéndolo del estado, en el mismo tick del último dígito todavía
        // tiene 5 y cae en el guard de longitud sin llamar al backend (el bug
        // de "Resetear PIN" en 2.12.0).
        onCompletar={async (nuevoPin) => {
          const usuario = usuarioResetPin;
          setUsuarioResetPin(null);
          setPinReset('');
          if (!usuario) return;
          try {
            await repositorioUsuarios.resetearPin(usuario.id, nuevoPin);
            Alert.alert('PIN actualizado', `Se asignó un PIN nuevo a ${usuario.nombre}.`);
          } catch (error) {
            Alert.alert('No se pudo resetear el PIN', error instanceof Error ? error.message : 'Intenta de nuevo.');
          }
        }}
        // Cierre manual (X, fondo, atrás): se cancela el reseteo sin tocar el
        // backend.
        onCerrar={() => {
          setUsuarioResetPin(null);
          setPinReset('');
        }}
      />
    </ScrollView>
  );
}

/**
 * La pill de rol y de estado. No se reusa `BadgeEstado` porque ese está tipado
 * contra `VeredictoAuditoria` a propósito (para que un veredicto nuevo no
 * compile), y un rol no es un veredicto. Lo que sí se comparte es la forma:
 * punto de color y texto, la misma que en la matriz.
 */
function PillUsuario({ texto, tono }: { texto: string; tono: 'ok' | 'atencion' | 'neutro' }): JSX.Element {
  const tinta = tono === 'ok' ? colors.ok : tono === 'atencion' ? colors.proceso : colors.gris;
  const fondo = tono === 'ok' ? colors.okSuave : tono === 'atencion' ? colors.procesoSuave : colors.esperaSuave;
  return (
    <View style={[styles.pill, { backgroundColor: fondo }]}>
      <View style={[styles.punto, { backgroundColor: tinta }]} />
      <Text style={[styles.pillTexto, { color: tinta }]} numberOfLines={1}>
        {texto}
      </Text>
    </View>
  );
}

/**
 * Un botón de ícono de la columna de acciones. La etiqueta accesible lleva EL
 * NOMBRE de la cuenta: cuatro íconos iguales repetidos por fila son
 * indistinguibles para un lector de pantalla si solo dicen "Editar".
 */
function AccionFila({
  icono: Icono,
  etiqueta,
  onPress,
  peligro = false,
}: {
  icono: LucideIcon;
  etiqueta: string;
  onPress: () => void;
  peligro?: boolean;
}): JSX.Element {
  return (
    <Pressable style={styles.accion} onPress={onPress} accessibilityRole="button" accessibilityLabel={etiqueta}>
      <Icono size={17} color={peligro ? colors.rojo : colors.gris} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pagina: { flex: 1 },
  contenido: { padding: spacing.xxl, gap: spacing.lg },
  cargando: { marginTop: spacing.xxl },

  formulario: { flexGrow: 0 },
  filaCampos: { flexDirection: 'row', gap: spacing.lg },
  filaCamposApilada: { flexDirection: 'column' },
  campoAncho: { flex: 1, gap: 6 },
  campoMitad: { gap: 6, maxWidth: 320 },
  campo: { gap: 6 },
  label: { fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.semibold },
  ayuda: { fontSize: fontSize.sm, lineHeight: 19, color: colors.gris, fontFamily: fonts.regular },
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

  acciones: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm },
  accion: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borde,
    backgroundColor: colors.blanco,
  },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: radius.full,
  },
  punto: { width: 6, height: 6, borderRadius: radius.full },
  pillTexto: { fontSize: fontSize.xs, fontFamily: fonts.semibold },

  modalFondo: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  modalCentrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCaja: {
    width: '100%',
    maxWidth: 520,
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.campo,
    borderRadius: radius.xl,
  },
  modalCabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  modalTitulo: { fontSize: fontSize.lg, color: colors.tinta, fontFamily: fonts.bold },
  modalCerrar: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
});
