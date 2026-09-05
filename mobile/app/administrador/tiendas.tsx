import { useFocusEffect } from 'expo-router';
import { MapPin, Power, SquarePen, Store, TriangleAlert, Warehouse, X } from 'lucide-react-native';
import { useCallback, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { ALTO_TAB_BAR } from '../../components/navegacion/tabs';
import { Badge, BarraApp, Button, Card, EmptyState, Select, type SelectOpcion } from '../../components/ui';
// Del contenedor: las sucursales salen de Postgres con el backend vivo.
import { repositorioTiendas } from '../../lib/contenedor';
import type { Almacen, Sucursal } from '../../lib/dominio/tipos';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';

/**
 * `Almacen` -> `SelectOpcion`. `codigo` hace de id porque es lo único que
 * el ERP necesita para filtrar stock — no hay otro identificador.
 */
function almacenAOpcion(a: Almacen): SelectOpcion {
  return { id: a.codigo, titulo: a.nombre, subtitulo: a.codigo };
}

/**
 * El almacén YA asignado a una tienda, para preseleccionar el `Select` al
 * editar. Se arma con `almacenId`/`almacenNombre` de la propia
 * `Sucursal` — el backend los guarda juntos y verificados (ver
 * `Sucursal.almacenNombre`) — no hace falta cruzar contra la lista viva
 * de `listarAlmacenes()` solo para mostrar el nombre, y así el formulario
 * sigue funcionando aunque Dynamics esté caído en este momento.
 */
function opcionDeAlmacen(tienda: Sucursal): SelectOpcion | null {
  if (!tienda.almacenId) return null;
  return { id: tienda.almacenId, titulo: tienda.almacenNombre ?? tienda.almacenId, subtitulo: tienda.almacenId };
}

export default function TiendasScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * SELECCIONAR-Y-DESPUES-ACTUAR, el mismo patron ya aprobado en Usuarios.
   *
   * Se guarda el id y no el objeto: la lista se recarga tras cada accion
   * (`cargar()`), asi que un objeto guardado quedaria viejo — con el id, la
   * tienda seleccionada se vuelve a resolver contra la lista fresca y el
   * speed dial siempre opera sobre el estado real.
   */
  const [tiendaSeleccionadaId, setTiendaSeleccionadaId] = useState<number | null>(null);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const animacionMenu = useRef(new Animated.Value(0)).current;
  const [tiendas, setTiendas] = useState<Sucursal[]>([]);
  // Se carga una sola vez con las tiendas: son los almacenes del ERP, no
  // cambian mientras el Administrador está parado en esta pantalla.
  //
  // Por defecto vienen SOLO los habilitados para inventario (10 de 70). El
  // resto son de Tránsito y Cuarentena, y sus nombres se parecen tanto a los
  // de tienda —"ALMACÉN CUARENTENA MARKET LUZURIAGA" contra "ALMACÉN
  // DISPONIBLE MARKET LUZURIAGA"— que elegir el equivocado haría contar
  // mercadería bloqueada. Ese error no se avisa: se evita no ofreciéndolo.
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  // La salida para la tienda que abre hoy, cuyo almacén todavía no está en
  // la lista. Al asociarlo, el backend lo habilita solo.
  const [mostrandoTodos, setMostrandoTodos] = useState(false);
  const [trayendoTodos, setTrayendoTodos] = useState(false);

  const [formularioAbierto, setFormularioAbierto] = useState(false);
  const [editando, setEditando] = useState<Sucursal | null>(null);
  const [nombre, setNombre] = useState('');
  const [direccion, setDireccion] = useState('');
  const [almacenSeleccionado, setAlmacenSeleccionado] = useState<SelectOpcion | null>(null);
  // Tres estados posibles al guardar (ver DatosTienda.almacenId): sin
  // tocar (no se manda nada, PATCH deja el almacén como está), elegido
  // (se manda el código) o vaciado a propósito (se manda `null`). Sin
  // este flag no hay forma de distinguir "no lo toqué" de "lo vacié".
  const [almacenTocado, setAlmacenTocado] = useState(false);
  const [selectAlmacenAbierto, setSelectAlmacenAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);

  /**
   * Trae los 70 almacenes del ERP. Es una acción explícita y no el default
   * porque el caso raro (tienda nueva) no puede volver peligroso el caso
   * común (elegir entre las diez de siempre).
   */
  async function traerTodosLosAlmacenes(): Promise<void> {
    setTrayendoTodos(true);
    try {
      const todos = await repositorioTiendas.listarAlmacenes({ todos: true });
      setAlmacenes(todos);
      setMostrandoTodos(true);
      setSelectAlmacenAbierto(true);
    } catch (error) {
      Alert.alert('No se pudo traer la lista completa', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setTrayendoTodos(false);
    }
  }

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [lista, listaAlmacenes] = await Promise.all([
        repositorioTiendas.listar(),
        // Si Dynamics no responde, la pantalla de tiendas no se puede quedar
        // en blanco por eso: se sigue viendo y gestionando la lista, solo
        // que el selector de almacén queda vacío (con su propio aviso, ver
        // más abajo) en vez de tirar toda la pantalla abajo.
        repositorioTiendas.listarAlmacenes().catch(() => []),
      ]);
      setTiendas(lista);
      setAlmacenes(listaAlmacenes);
      setMostrandoTodos(false);
    } catch (e) {
      // A diferencia de listarAlmacenes (Dynamics, ya con su propio
      // fallback), esto es Postgres: si falla, no hay tiendas que mostrar
      // y sin este catch el spinner quedaba girando para siempre.
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las tiendas.');
    } finally {
      setCargando(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar]),
  );

  function abrirFormularioNuevo(): void {
    setEditando(null);
    setNombre('');
    setDireccion('');
    // Ningún campo viene preseleccionado (criterio del cliente, ver
    // trujillo-ui/SKILL.md): un default que nadie mira es un dato que
    // nadie verifica. El almacén queda sin elegir a propósito, y ESO es
    // válido — no bloquea el alta (ver el aviso de la lista, más abajo).
    setAlmacenSeleccionado(null);
    setAlmacenTocado(false);
    setSelectAlmacenAbierto(false);
    setFormularioAbierto(true);
  }

  function abrirFormularioEditar(tienda: Sucursal): void {
    setEditando(tienda);
    setNombre(tienda.nombre);
    setDireccion(tienda.direccion ?? '');
    setAlmacenSeleccionado(opcionDeAlmacen(tienda));
    setAlmacenTocado(false);
    setSelectAlmacenAbierto(false);
    setFormularioAbierto(true);
  }

  function cerrarFormulario(): void {
    setFormularioAbierto(false);
    setEditando(null);
    setNombre('');
    setDireccion('');
    setAlmacenSeleccionado(null);
    setAlmacenTocado(false);
    setSelectAlmacenAbierto(false);
  }

  function elegirAlmacen(opcion: SelectOpcion): void {
    setAlmacenSeleccionado(opcion);
    setAlmacenTocado(true);
  }

  /** Desasocia el almacén — ver DatosTienda.almacenId: un almacén mal asignado es peor que ninguno. */
  function quitarAlmacen(): void {
    setAlmacenSeleccionado(null);
    setAlmacenTocado(true);
    setSelectAlmacenAbierto(false);
  }

  async function guardar(): Promise<void> {
    setGuardando(true);
    try {
      // Al crear NUNCA se manda `null` (crearTiendaSchema.almacenId solo
      // acepta string u omitido, no hay almacén previo que desasociar en
      // un alta) — al editar, si se tocó el campo y quedó sin elegir, se
      // manda `null` a propósito para desasociarlo.
      const almacenId = editando
        ? almacenTocado
          ? (almacenSeleccionado ? String(almacenSeleccionado.id) : null)
          : undefined
        : (almacenSeleccionado ? String(almacenSeleccionado.id) : undefined);
      const datos = {
        nombre: nombre.trim(),
        direccion: direccion.trim() || undefined,
        almacenId,
      };
      if (editando) {
        await repositorioTiendas.editar(editando.id, datos);
      } else {
        await repositorioTiendas.crear(datos);
      }
      cerrarFormulario();
      await cargar();
    } catch (error) {
      Alert.alert('No se pudo guardar la tienda', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  async function alternarActiva(tienda: Sucursal): Promise<void> {
    try {
      await repositorioTiendas.cambiarActiva(tienda.id, !(tienda.activa ?? true));
      await cargar();
    } catch (error) {
      Alert.alert('No se pudo actualizar la tienda', error instanceof Error ? error.message : 'Intentá de nuevo.');
    }
  }

  // Se resuelve contra la lista viva, no contra una copia: ver el comentario
  // de `tiendaSeleccionadaId`.
  const seleccionada = tiendas.find((t) => t.id === tiendaSeleccionadaId) ?? null;

  function alternarMenu(): void {
    const destino = menuAbierto ? 0 : 1;
    setMenuAbierto(!menuAbierto);
    Animated.spring(animacionMenu, { toValue: destino, friction: 6, tension: 45, useNativeDriver: true }).start();
  }

  function cerrarMenu(): void {
    setMenuAbierto(false);
    Animated.timing(animacionMenu, { toValue: 0, duration: 180, useNativeDriver: true }).start();
  }

  /** Tocar una tarjeta la selecciona; tocarla de nuevo la deselecciona. */
  function alternarSeleccion(tienda: Sucursal): void {
    setMenuAbierto(false);
    animacionMenu.setValue(0);
    setTiendaSeleccionadaId((actual) => (actual === tienda.id ? null : tienda.id));
  }

  const rotacionIcono = animacionMenu.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });
  const escalaOpciones = animacionMenu.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  const desplazamientoOpciones = animacionMenu.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });

  const activas = tiendas.filter((t) => t.activa !== false).length;
  const puedeGuardar = nombre.trim().length > 0 && !guardando;

  return (
    // El speed dial va como HERMANO de PantallaConTabs, nunca adentro: dentro
    // del ScrollView su `position: absolute` queda recortado por el contenido
    // y se desplaza con el scroll en vez de quedarse fijo.
    <>
      <PantallaConTabs scrollable contentStyle={[styles.contenido, { paddingBottom: ALTO_TAB_BAR + insets.bottom + 120 }]}>
      <BarraApp rotulo="Tiendas" cifras={`${activas} de ${tiendas.length} activas`} />

      <Button
        label={formularioAbierto ? 'Cancelar' : 'Nueva tienda'}
        icon={Store}
        variant={formularioAbierto ? 'outline' : 'primary'}
        onPress={() => (formularioAbierto ? cerrarFormulario() : abrirFormularioNuevo())}
      />

      {formularioAbierto ? (
        <Card style={styles.formulario}>
          <View style={styles.formularioCabecera}>
            <Store size={17} color={colors.rojo} />
            <Text style={styles.formularioTitulo}>{editando ? `Editar ${editando.nombre}` : 'Nueva tienda'}</Text>
          </View>

          <View style={styles.campo}>
            <Text style={styles.label}>Nombre</Text>
            <View style={styles.inputFila}>
              <Store size={19} color={colors.grisClaro} />
              <TextInput
                style={styles.input}
                value={nombre}
                onChangeText={setNombre}
                placeholder="Ej. Market Yungay"
                placeholderTextColor={colors.grisClaro}
              />
            </View>
          </View>

          <View style={styles.campo}>
            <Text style={styles.label}>Dirección (opcional)</Text>
            <View style={styles.inputFila}>
              <MapPin size={19} color={colors.grisClaro} />
              <TextInput
                style={styles.input}
                value={direccion}
                onChangeText={setDireccion}
                placeholder="Ej. Jr. Comercio 450"
                placeholderTextColor={colors.grisClaro}
              />
            </View>
          </View>

          {/* SELECTOR de la lista real de Dynamics, nunca texto libre: un
              código mal tipeado no falla, trae el stock de OTRA tienda, y
              la auditoría compara contra números que parecen válidos sin
              que nadie se entere hasta que no cuadra a fin de mes. */}
          <View style={styles.campo}>
            <Text style={styles.label}>Almacén de Dynamics</Text>
            <Select
              icon={Warehouse}
              valor={almacenSeleccionado}
              placeholder={almacenes.length === 0 ? 'No se pudo traer la lista de Dynamics' : 'Elegí un almacén'}
              opciones={almacenes.map(almacenAOpcion)}
              onSeleccionar={elegirAlmacen}
              disabled={almacenes.length === 0}
              accessibilityLabel="Almacén de Dynamics"
              abierto={selectAlmacenAbierto}
              onCambiarAbierto={setSelectAlmacenAbierto}
            />
            {mostrandoTodos ? (
              <Text style={styles.ayudaAlmacen}>
                Mostrando los {almacenes.length} almacenes del ERP. Los de Tránsito y Cuarentena no se inventarían: elegí uno solo si esta
                tienda es nueva. Al guardarla queda habilitado para las próximas.
              </Text>
            ) : (
              <Pressable onPress={traerTodosLosAlmacenes} disabled={trayendoTodos} accessibilityRole="button">
                <Text style={styles.enlaceAlmacen}>
                  {trayendoTodos ? 'Trayendo…' : '¿Tienda nueva? Ver todos los almacenes del ERP'}
                </Text>
              </Pressable>
            )}

            {almacenSeleccionado ? (
              // Un almacén mal asignado es peor que ninguno (decisión del
              // cliente, reflejada del lado del backend): tiene que poder
              // vaciarse, no solo reemplazarse por otro de la lista.
              <Button label="Quitar almacén" variant="outline" size="sm" onPress={quitarAlmacen} />
            ) : null}
          </View>

          <Button label={editando ? 'Guardar cambios' : 'Crear tienda'} onPress={guardar} disabled={!puedeGuardar} loading={guardando} />
        </Card>
      ) : null}

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : error ? (
        <Card style={styles.formulario}>
          <Text style={styles.formularioTitulo}>No se pudo cargar el listado</Text>
          <Text style={styles.ayudaAlmacen}>{error}</Text>
          <Button label="Reintentar" onPress={cargar} />
        </Card>
      ) : tiendas.length === 0 ? (
        <EmptyState icon={Store} title="Todavía no hay tiendas" subtitle="Creá la primera con el botón de arriba." />
      ) : (
        <View style={styles.lista}>
          <View style={styles.seccion}>
            <Text style={styles.seccionTitulo}>Sucursales</Text>
            <Text style={styles.seccionTotal}>
              {tiendas.length} sucursal{tiendas.length === 1 ? '' : 'es'}
            </Text>
          </View>
          {tiendas.map((tienda) => {
            const activa = tienda.activa !== false;
            const esSeleccionada = seleccionada?.id === tienda.id;
            return (
              <Pressable
                key={tienda.id}
                onPress={() => alternarSeleccion(tienda)}
                accessibilityRole="button"
                accessibilityState={{ selected: esSeleccionada }}
                accessibilityLabel={`${tienda.nombre}. ${esSeleccionada ? 'Seleccionada' : 'Tocá para elegirla'}`}
              >
              <Card style={[styles.fila, esSeleccionada && styles.filaSeleccionada]}>
                <View style={styles.filaCabecera}>
                  <View style={styles.filaTextos}>
                    <Text style={styles.filaNombre}>{tienda.nombre}</Text>
                    <Text style={styles.filaMeta}>
                      {tienda.direccion ?? 'Sin dirección registrada'} · {tienda.colaboradores} colaborador
                      {tienda.colaboradores === 1 ? '' : 'es'}
                    </Text>
                    {tienda.almacenId ? (
                      <Text style={styles.filaMeta}>
                        Almacén: {tienda.almacenNombre ?? tienda.almacenId} ({tienda.almacenId})
                      </Text>
                    ) : (
                      // NO se esconde: sin almacén no hay stock del ERP, y sin
                      // stock la auditoría no puede comparar nada — el
                      // Administrador tiene que verlo acá, no descubrirlo
                      // cuando el mes no cierre.
                      <View style={styles.avisoAlmacen}>
                        <TriangleAlert size={13} color={colors.falta} />
                        <Text style={styles.avisoAlmacenTexto}>
                          Sin almacén configurado: sin stock de Dynamics, la auditoría no va a poder comparar esta tienda.
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.filaBadges}>
                    <Badge label={activa ? 'Activa' : 'Inactiva'} variant={activa ? 'ok' : 'espera'} />
                    {!tienda.almacenId ? <Badge label="Sin almacén" variant="falta" /> : null}
                  </View>
                </View>
              </Card>
              </Pressable>
            );
          })}
        </View>
      )}
      </PantallaConTabs>

      {/* Capa para cerrar tocando afuera, solo con el menu desplegado. */}
      {seleccionada && menuAbierto ? (
        <Pressable style={StyleSheet.absoluteFillObject} onPress={cerrarMenu} accessibilityLabel="Cerrar acciones" />
      ) : null}

      {/* SPEED DIAL: aparece SOLO con una tienda seleccionada. Sin seleccion no
          hay boton, asi que nunca puede actuar sobre "nada". */}
      {seleccionada ? (
        <View style={[styles.speedDialContenedor, { bottom: ALTO_TAB_BAR + insets.bottom + 28 }]}>
          <Animated.View
            pointerEvents={menuAbierto ? 'auto' : 'none'}
            style={[
              styles.speedDialOpciones,
              { opacity: animacionMenu, transform: [{ translateY: desplazamientoOpciones }, { scale: escalaOpciones }] },
            ]}
          >
            {/* SOBRE QUE TIENDA. No esta en Usuarios y acá sí, a propósito:
                allá la acción peor es deshabilitar UNA cuenta; acá es
                desactivar una TIENDA entera, con sus colaboradores y su
                inventario. La tarjeta resaltada se ve al seleccionar, pero
                para cuando el menú está abierto tapa media pantalla — el
                nombre tiene que estar al lado del botón que se va a tocar. */}
            <View style={styles.speedDialEncabezado}>
              <Text style={styles.speedDialEncabezadoTexto} numberOfLines={1}>
                {seleccionada.nombre}
              </Text>
            </View>

            <Pressable
              style={styles.speedDialFila}
              onPress={() => {
                alternarMenu();
                abrirFormularioEditar(seleccionada);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Editar ${seleccionada.nombre}`}
            >
              <View style={styles.speedDialPill}>
                <Text style={styles.speedDialPillTexto}>Editar tienda</Text>
              </View>
              <View style={styles.speedDialBoton}>
                <SquarePen size={20} color={colors.tinta} />
              </View>
            </Pressable>

            {/* Desactivar es la accion destructiva de esta pantalla: va en rojo
                (icono y etiqueta), como Eliminar en Usuarios. */}
            <Pressable
              style={styles.speedDialFila}
              onPress={() => {
                alternarMenu();
                alternarActiva(seleccionada);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${seleccionada.activa !== false ? 'Desactivar' : 'Activar'} ${seleccionada.nombre}`}
            >
              <View style={styles.speedDialPill}>
                <Text style={seleccionada.activa !== false ? styles.speedDialPillTextoDestructivo : styles.speedDialPillTexto}>
                  {seleccionada.activa !== false ? 'Desactivar' : 'Activar'}
                </Text>
              </View>
              <View style={styles.speedDialBoton}>
                <Power size={20} color={seleccionada.activa !== false ? colors.rojo : colors.tinta} />
              </View>
            </Pressable>
          </Animated.View>

          <Pressable
            style={styles.speedDialFab}
            onPress={alternarMenu}
            accessibilityRole="button"
            accessibilityLabel={menuAbierto ? 'Cerrar acciones' : `Acciones de ${seleccionada.nombre}`}
          >
            <Animated.View style={{ transform: [{ rotate: rotacionIcono }] }}>
              {menuAbierto ? <X size={24} color={colors.blanco} strokeWidth={2.5} /> : <Store size={24} color={colors.blanco} strokeWidth={2.3} />}
            </Animated.View>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: 14, paddingTop: 8, gap: 14 },
  cargando: { marginTop: 24 },
  formulario: { gap: 12 },
  formularioCabecera: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  formularioTitulo: { flex: 1, fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
  seccion: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  seccionTitulo: { fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gris, fontFamily: fonts.semibold },
  seccionTotal: { fontSize: 11.5, color: colors.grisClaro, fontFamily: fonts.regular },
  enlaceAlmacen: { fontSize: 12.5, color: colors.rojo, fontFamily: fonts.semibold },
  ayudaAlmacen: { fontSize: 12, color: colors.gris, fontFamily: fonts.regular, lineHeight: 17 },
  campo: { gap: 6 },
  label: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.semibold },
  inputFila: {
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
  input: { flex: 1, fontSize: fontSize.base, color: colors.tinta, fontFamily: fonts.regular, padding: 0 },
  lista: { gap: 10 },
  fila: { gap: 10, padding: 13 },
  filaCabecera: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  filaTextos: { flex: 1, minWidth: 0 },
  filaNombre: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.bold },
  filaMeta: { marginTop: 2, fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },
  filaBadges: { flex: 0, alignItems: 'flex-end', gap: 6 },
  avisoAlmacen: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
  avisoAlmacenTexto: { flex: 1, fontSize: 11, lineHeight: 15, color: colors.falta, fontFamily: fonts.regular },
  // Misma senal que la tarjeta seleccionada en Usuarios: borde rojo y fondo
  // suave. Es lo que ata el speed dial flotante a UNA fila de la lista.
  filaSeleccionada: { borderColor: colors.rojo, borderWidth: 1.5, backgroundColor: colors.rojoSuave },
  speedDialContenedor: { position: 'absolute', right: 16, alignItems: 'flex-end', gap: 12, zIndex: 50 },
  speedDialOpciones: { alignItems: 'flex-end', gap: 12 },
  // Pill de contexto: dice SOBRE QUE tienda se va a actuar. Rojo suave para
  // separarla de las acciones (blancas) sin gritar mas que ellas.
  speedDialEncabezado: {
    backgroundColor: colors.rojoSuave,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.rojo,
    maxWidth: 240,
  },
  speedDialEncabezadoTexto: { fontSize: 12.5, color: colors.rojo, fontFamily: fonts.bold },
  speedDialFila: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
  speedDialPillTexto: { fontSize: 13, color: colors.tinta, fontFamily: fonts.semibold },
  speedDialPillTextoDestructivo: { fontSize: 13, color: colors.rojo, fontFamily: fonts.semibold },
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
});
