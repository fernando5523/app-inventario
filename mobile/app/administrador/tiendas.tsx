import { useFocusEffect } from 'expo-router';
import { MapPin, Store } from 'lucide-react-native';
import { useCallback, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { Badge, BarraApp, Button, Card, EmptyState } from '../../components/ui';
// TEMPORAL: no viene de lib/contenedor.ts a propósito — esta tarea no lo
// toca (lo cambia el agente de integración al enchufar el HTTP real). La
// pantalla solo conoce el tipo del puerto, no el adaptador concreto.
import { tiendasMemoria as repositorioTiendas } from '../../lib/adaptadores/tiendas-memoria';
import type { Sucursal } from '../../lib/dominio/tipos';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';

export default function TiendasScreen(): JSX.Element {
  const [cargando, setCargando] = useState(true);
  const [tiendas, setTiendas] = useState<Sucursal[]>([]);

  const [formularioAbierto, setFormularioAbierto] = useState(false);
  const [editando, setEditando] = useState<Sucursal | null>(null);
  const [nombre, setNombre] = useState('');
  const [direccion, setDireccion] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const lista = await repositorioTiendas.listar();
    setTiendas(lista);
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
    setFormularioAbierto(true);
  }

  function abrirFormularioEditar(tienda: Sucursal): void {
    setEditando(tienda);
    setNombre(tienda.nombre);
    setDireccion(tienda.direccion ?? '');
    setFormularioAbierto(true);
  }

  function cerrarFormulario(): void {
    setFormularioAbierto(false);
    setEditando(null);
    setNombre('');
    setDireccion('');
  }

  async function guardar(): Promise<void> {
    setGuardando(true);
    try {
      const datos = { nombre: nombre.trim(), direccion: direccion.trim() || undefined };
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
          <Text style={styles.formularioTitulo}>{editando ? `Editar ${editando.nombre}` : 'Nueva tienda'}</Text>

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

          <Button label={editando ? 'Guardar cambios' : 'Crear tienda'} onPress={guardar} disabled={!puedeGuardar} loading={guardando} />
        </Card>
      ) : null}

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : tiendas.length === 0 ? (
        <EmptyState icon={Store} title="Todavía no hay tiendas" subtitle="Creá la primera con el botón de arriba." />
      ) : (
        <View style={styles.lista}>
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
                  </View>
                  <Badge label={activa ? 'Activa' : 'Inactiva'} variant={activa ? 'ok' : 'espera'} />
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
  formularioTitulo: { fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
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
  filaAcciones: { flexDirection: 'row', gap: 8 },
  filaBoton: { flex: 1 },
});
