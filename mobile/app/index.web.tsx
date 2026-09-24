import { router } from 'expo-router';
import { Building2, Lock, ShieldCheck, UserRound } from 'lucide-react-native';
import { useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { repositorioSesion } from '../lib/contenedor';
import type { Colaborador, Sucursal } from '../lib/dominio/tipos';
import { ejecutarIngreso } from '../lib/ejecutar-ingreso';
import { mensajeDeErrorIngreso } from '../lib/mensaje-error-ingreso';
import { useSesion } from '../lib/sesion-contexto';
import { colors, fonts, radius, spacing } from '../lib/theme';

/**
 * ---------------------------------------------------------------------------
 * EL LOGIN DE LA WEB -- CLON, NO VARIANTE
 * ---------------------------------------------------------------------------
 * Metro elige este archivo en vez de `index.tsx` cuando el bundle es de
 * navegador. Decisión del usuario, textual: *"no utilices la misma pantalla
 * del móvil, clónalo y cámbialo, en todo caso son plataformas diferentes"*.
 *
 * Y acá no es una cuestión de gusto: el login del teléfono usa
 * `SelectBuscable`, una lista FLOTANTE posicionada en absoluto sobre el resto
 * del formulario. MEDIDO en el navegador: la lista se dibuja encima de los
 * campos de abajo y los toques sobre sus opciones no llegan a seleccionar
 * nada. Es un componente hecho para un dedo sobre 400px de ancho.
 *
 * Acá no hay listas flotantes: las dos columnas están SIEMPRE a la vista --
 * tiendas a la izquierda, personas a la derecha --, que es lo que se puede
 * hacer cuando sobra ancho y no falta. Se elige con el mouse, sin desplegar
 * nada.
 *
 * ---------------------------------------------------------------------------
 * LO QUE NO SE CLONA
 * ---------------------------------------------------------------------------
 * `ejecutarIngreso` y `mensajeDeErrorIngreso` son los MISMOS del teléfono: el
 * manejo del PIN vacío tras un rechazo, el 429 con su minuto exacto y el 404
 * de la cuenta que ya no existe son reglas del negocio, no de la plataforma.
 * Duplicar eso sería duplicar los bugs.
 */
const LARGO_PIN = 6;
const ANCHO_ANGOSTO = 820;

export default function LoginWeb(): JSX.Element {
  const { sesion, cargando, ingresar } = useSesion();
  const { width } = useWindowDimensions();
  const angosto = width < ANCHO_ANGOSTO;

  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [personas, setPersonas] = useState<Colaborador[]>([]);
  const [sucursal, setSucursal] = useState<Sucursal | null>(null);
  /** true = el grupo de los que no tienen tienda (auditores y administrador). */
  const [sinTienda, setSinTienda] = useState(false);
  const [persona, setPersona] = useState<Colaborador | null>(null);
  const [pin, setPin] = useState('');
  const [ingresando, setIngresando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    repositorioSesion
      .sucursales()
      .then(setSucursales)
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar las sucursales.'));
  }, []);

  // Cambiar de lado (tienda <-> grupo sin tienda) limpia lo elegido: dejar la
  // persona de la selección anterior deja el botón habilitado para entrar con
  // alguien que ya no está en la lista que se ve.
  function elegirSucursal(s: Sucursal): void {
    setSinTienda(false);
    setSucursal(s);
    setPersona(null);
    setPin('');
    setError(null);
    repositorioSesion
      .colaboradores(s.id)
      .then(setPersonas)
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el personal.'));
  }

  function elegirSinTienda(): void {
    setSinTienda(true);
    setSucursal(null);
    setPersona(null);
    setPin('');
    setError(null);
    repositorioSesion
      .administradores()
      .then(setPersonas)
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar la lista.'));
  }

  const puedeIngresar = persona !== null && pin.length === LARGO_PIN && !ingresando;

  async function entrar(): Promise<void> {
    if (persona === null) return;
    setError(null);
    await ejecutarIngreso(persona.id, pin, {
      ingresar,
      marcarIngresando: setIngresando,
      alEntrar: (nueva) => router.replace(`/${nueva.colaborador.rol}`),
      vaciarPin: () => setPin(''),
      alRechazar: (e) => setError(mensajeDeErrorIngreso(e)),
    });
  }

  if (cargando) return <View style={styles.centro}><ActivityIndicator color={colors.rojo} /></View>;
  if (sesion) {
    router.replace(`/${sesion.colaborador.rol}`);
    return <View style={styles.centro} />;
  }

  return (
    <View style={styles.fondo}>
      <View style={[styles.tarjeta, angosto && styles.tarjetaAngosta]}>
        <View style={styles.encabezado}>
          <Text style={styles.marca}>Trujillo</Text>
          <Text style={styles.titulo}>Inventario</Text>
          <Text style={styles.sub}>Elige tu tienda y tu nombre, y escribe tu clave de 6 dígitos.</Text>
        </View>

        <View style={[styles.columnas, angosto && styles.columnasApiladas]}>
          <View style={styles.columna}>
            <Text style={styles.etiqueta}>Tienda</Text>
            <ScrollView style={styles.lista} showsVerticalScrollIndicator={false}>
              {sucursales.map((s) => {
                const activa = sucursal?.id === s.id;
                return (
                  <Pressable key={s.id} style={[styles.opcion, activa && styles.opcionActiva]} onPress={() => elegirSucursal(s)}>
                    <Building2 size={15} color={activa ? colors.rojo : colors.gris} />
                    <Text style={[styles.opcionTexto, activa && styles.opcionTextoActivo]} numberOfLines={1}>
                      {s.nombre}
                    </Text>
                  </Pressable>
                );
              })}
              {/* Los que NO pertenecen a una tienda: el auditor audita toda la
                  cadena y el administrador es del sistema. Va al final de la
                  misma lista y no escondido en un enlace, que es como estaba
                  en el teléfono y costaba encontrar. */}
              <Pressable style={[styles.opcion, sinTienda && styles.opcionActiva]} onPress={elegirSinTienda}>
                <ShieldCheck size={15} color={sinTienda ? colors.rojo : colors.gris} />
                <Text style={[styles.opcionTexto, sinTienda && styles.opcionTextoActivo]} numberOfLines={1}>
                  Auditoría y administración
                </Text>
              </Pressable>
            </ScrollView>
          </View>

          <View style={styles.columna}>
            <Text style={styles.etiqueta}>Persona</Text>
            <ScrollView style={styles.lista} showsVerticalScrollIndicator={false}>
              {personas.length === 0 ? (
                <Text style={styles.vacio}>{sucursal || sinTienda ? 'No hay personas para elegir.' : 'Elige primero una tienda.'}</Text>
              ) : (
                personas.map((p) => {
                  const activa = persona?.id === p.id;
                  return (
                    <Pressable
                      key={p.id}
                      style={[styles.opcion, activa && styles.opcionActiva]}
                      onPress={() => {
                        setPersona(p);
                        setError(null);
                      }}
                    >
                      <UserRound size={15} color={activa ? colors.rojo : colors.gris} />
                      <View style={styles.opcionCuerpo}>
                        <Text style={[styles.opcionTexto, activa && styles.opcionTextoActivo]} numberOfLines={1}>
                          {p.nombre}
                        </Text>
                        <Text style={styles.opcionSub}>{p.rol}</Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>

        <View style={styles.pie}>
          <Text style={styles.etiqueta}>Clave</Text>
          <View style={styles.pinFila}>
            <Lock size={16} color={colors.gris} />
            <TextInput
              style={styles.pin}
              value={pin}
              onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, LARGO_PIN))}
              placeholder="6 dígitos"
              placeholderTextColor={colors.grisClaro}
              secureTextEntry
              inputMode="numeric"
              // Enter entra, que es lo que hace cualquiera en una PC después
              // de teclear una clave.
              onSubmitEditing={() => void (puedeIngresar && entrar())}
              editable={persona !== null}
            />
            <Pressable
              style={[styles.boton, !puedeIngresar && styles.botonApagado]}
              onPress={() => void entrar()}
              disabled={!puedeIngresar}
              accessibilityRole="button"
            >
              <Text style={styles.botonTexto}>{ingresando ? 'Entrando…' : 'Ingresar'}</Text>
            </Pressable>
          </View>
          {error !== null ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: colors.fondo, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fondo },

  tarjeta: {
    width: '100%',
    maxWidth: 760,
    backgroundColor: colors.blanco,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borde,
    padding: spacing.lg,
    gap: spacing.md,
  },
  tarjetaAngosta: { maxWidth: 460 },

  encabezado: { gap: 2 },
  marca: { fontSize: 22, color: colors.rojo, fontFamily: fonts.bold },
  titulo: { fontSize: 15, color: colors.tinta, fontFamily: fonts.semibold },
  sub: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },

  columnas: { flexDirection: 'row', gap: spacing.md },
  columnasApiladas: { flexDirection: 'column' },
  columna: { flex: 1, gap: 6 },

  etiqueta: { fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.gris, fontFamily: fonts.semibold },
  lista: { maxHeight: 260, borderWidth: 1, borderColor: colors.borde, borderRadius: radius.md },

  opcion: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 11 },
  opcionActiva: { backgroundColor: colors.campo, borderLeftWidth: 3, borderLeftColor: colors.rojo, paddingLeft: 8 },
  opcionCuerpo: { flex: 1 },
  opcionTexto: { flex: 1, fontSize: 13, color: colors.tinta, fontFamily: fonts.semibold },
  opcionTextoActivo: { color: colors.rojo },
  opcionSub: { fontSize: 10.5, color: colors.grisClaro, fontFamily: fonts.regular },
  vacio: { padding: 11, fontSize: 12.5, color: colors.grisClaro, fontFamily: fonts.regular },

  pie: { gap: 6 },
  pinFila: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  pin: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
    fontSize: 15,
    color: colors.tinta,
    fontFamily: fonts.regular,
    letterSpacing: 4,
  },
  boton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 22, borderRadius: radius.md, backgroundColor: colors.rojo },
  botonApagado: { backgroundColor: colors.grisClaro },
  botonTexto: { fontSize: 14, color: colors.blanco, fontFamily: fonts.bold },
  error: { fontSize: 12.5, color: colors.rojo, fontFamily: fonts.medium },
});
