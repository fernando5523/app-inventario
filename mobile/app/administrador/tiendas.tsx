import { useFocusEffect } from 'expo-router';
import { MapPin, Store, TriangleAlert, Warehouse } from 'lucide-react-native';
import { useCallback, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
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
  const [cargando, setCargando] = useState(true);
  const [tiendas, setTiendas] = useState<Sucursal[]>([]);
  // Se carga una sola vez con las tiendas: son los almacenes del ERP, no
  // cambian mientras el Administrador está parado en esta pantalla.
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);

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

  const cargar = useCallback(async () => {
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
    setCargando(false);
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

  const activas = tiendas.filter((t) => t.activa !== false).length;
  const puedeGuardar = nombre.trim().length > 0 && !guardando;

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
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
            return (
              <Card key={tienda.id} style={styles.fila}>
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
                <View style={styles.filaAcciones}>
                  <Button label="Editar" variant="outline" size="sm" onPress={() => abrirFormularioEditar(tienda)} style={styles.filaBoton} />
                  <Button
                    label={activa ? 'Desactivar' : 'Activar'}
                    variant="outline"
                    size="sm"
                    onPress={() => alternarActiva(tienda)}
                    style={styles.filaBoton}
                  />
                </View>
              </Card>
            );
          })}
        </View>
      )}
    </PantallaConTabs>
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
  filaAcciones: { flexDirection: 'row', gap: 8 },
  filaBoton: { flex: 1 },
});
