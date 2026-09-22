/**
 * ACCESOS Y MENÚS POR ROL — la pantalla donde el Administrador deja de
 * depender de que alguien recompile la app.
 *
 * Pedido del cliente, textual: *"en la app actualmente tiene accesos rápidos,
 * que estos pueden ser manejados por el administrador por medio de roles al
 * igual que los menús ... De esta manera como administrador controlamos todo
 * esto y no está hardcodeado."*
 *
 * ---------------------------------------------------------------------------
 * LAS TRES COSAS QUE DECIDEN SI ESTA PANTALLA SE USA O SE TOCA UNA VEZ
 * ---------------------------------------------------------------------------
 *  1. EL EFECTO ANTES DE GUARDAR. Apagar un acceso puede dejar a alguien sin
 *     poder trabajar un lunes a las 7 de la mañana. Acá se lee "el Coordinador
 *     va a pasar de 4 accesos a 3, deja de ver Asistencia del inventario"
 *     ANTES de confirmar, no el lunes.
 *  2. EL PORQUÉ DE CADA ORDEN, a la vista. El que mueve "Liquidación" arriba
 *     de "Ajuste" tiene que poder leer que ese orden es el del cierre: se
 *     ajusta, se liquida, se lacra. Esas notas viven en el catálogo del
 *     backend y viajan en el DTO.
 *  3. VOLVER A FÁBRICA. La salida cuando alguien se equivoca y no se acuerda
 *     de cómo estaba.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTA PANTALLA NO PUEDE HACER
 * ---------------------------------------------------------------------------
 * Darle a un rol la pantalla de otro. La lista blanca son las rutas del grupo
 * de cada rol, y por eso acá no hay un "agregar acceso": no existe un
 * elemento que este rol no tenga ya en su lista. Si el Coordinador pudiera
 * recibir el Panel de auditoría, vería el stock del ERP con el ciclo abierto
 * y el conteo ciego se termina.
 */

import { AlertTriangle, ArrowDown, ArrowUp, Info, RotateCcw } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, StyleSheet, Switch, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { BarraApp, Button, Card } from '../../components/ui';
import {
  guardarConfiguracion,
  restablecerConfiguracion,
  traerConfiguracion,
  type ConfiguracionDeUnRol,
  type TipoNavegacion,
} from '../../lib/adaptadores/navegacion-admin-api';
import { calcularEfecto, mover, type ElementoConfigurable } from '../../lib/dominio/navegacion-efecto';
import { useRefrescarNavegacion } from '../../lib/navegacion-contexto';
import type { Rol } from '../../lib/dominio/tipos';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';

const ROLES: Array<{ rol: Rol; etiqueta: string }> = [
  { rol: 'coordinador', etiqueta: 'Coordinador' },
  { rol: 'conteo', etiqueta: 'Conteo' },
  { rol: 'auditor', etiqueta: 'Auditor' },
  { rol: 'administrador', etiqueta: 'Administrador' },
];

const TIPOS: Array<{ tipo: TipoNavegacion; etiqueta: string; ayuda: string }> = [
  { tipo: 'acceso', etiqueta: 'Accesos del inicio', ayuda: 'Las tarjetas de la pantalla de inicio.' },
  { tipo: 'tab', etiqueta: 'Barra de abajo', ayuda: 'Los botones fijos del pie de la app.' },
];

/** Una fila en pantalla: el elemento del servidor más lo que se editó acá. */
interface Fila extends ElementoConfigurable {
  sub: string;
  nota?: string;
}

/** Del DTO del servidor a las filas que se editan. Accesos y tabs, igual. */
function aFilas(config: ConfiguracionDeUnRol, tipo: TipoNavegacion): Fila[] {
  return tipo === 'acceso'
    ? config.accesos.map((a) => ({
        clave: a.ruta,
        nombre: a.titulo,
        sub: a.sub,
        visible: a.visible,
        ...(a.nota === undefined ? {} : { nota: a.nota }),
      }))
    : config.tabs.map((t) => ({
        clave: t.name,
        nombre: t.etiqueta,
        sub: `Pantalla "${t.name}"`,
        visible: t.visible,
        ...(t.nota === undefined ? {} : { nota: t.nota }),
      }));
}

export default function NavegacionScreen(): JSX.Element {
  /**
   * AVISARLE AL PROVIDER que la navegación cambió.
   *
   * Sin esto, `guardar()` solo actualizaba el estado local de ESTA pantalla:
   * el Administrador apagaba un acceso, veía la lista de acá actualizada, y
   * su propia barra de tabs seguía siendo la vieja hasta cerrar y reabrir la
   * app. Es el caso más visible de todos porque se reproduce con un solo
   * teléfono, sin esperar a que otro rol entre.
   */
  const refrescarNavegacion = useRefrescarNavegacion();

  const [rol, setRol] = useState<Rol>('coordinador');
  const [tipo, setTipo] = useState<TipoNavegacion>('acceso');

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  /** Lo que confirmó el SERVIDOR. `filas` es lo que se ve y se edita. */
  const [confirmado, setConfirmado] = useState<ConfiguracionDeUnRol | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);

  /**
   * `tipo` EN UN REF para que el efecto de carga no dependa de él.
   *
   * Si `tipo` fuera dependencia, tocar "Barra de abajo" dispararía otro
   * pedido al servidor para traer exactamente lo mismo (la respuesta trae
   * accesos Y tabs juntos) y de paso descartaría lo que la persona estuviera
   * editando. El ref deja que la carga use el tipo vigente sin volver a
   * correr por él.
   */
  const tipoRef = useRef<TipoNavegacion>(tipo);
  tipoRef.current = tipo;

  /**
   * LA CARGA, Y QUIEN ES DUEÑO DEL SPINNER.
   *
   * ---------------------------------------------------------------------
   * BUG REAL (2026-09-19, encontrado en el emulador): LA PANTALLA SE MORIA
   * AL CAMBIAR DE ROL
   * ---------------------------------------------------------------------
   * El primer render cargaba bien y cualquier cambio de rol dejaba el
   * spinner girando para siempre -- y volver al rol que SI había cargado
   * tampoco lo recuperaba. Sin excepción, sin error de red, sin nada en
   * logcat: el backend contestaba los cuatro roles en 3 ms.
   *
   * La causa: `cambiarRol` hacía `setCargando(true)` y esperaba que algo
   * recargara. No recargaba nadie. `useRefrescoAlEnfocar` guarda `cargar`
   * en un ref A PROPOSITO (está documentado en el hook) y solo dispara al
   * ENFOCAR la pantalla o al volver a primer plano; que `cargar` cambie de
   * identidad no lo despierta. Con la pantalla ya enfocada, ese evento no
   * vuelve a ocurrir nunca.
   *
   * ---------------------------------------------------------------------
   * EL ARREGLO ES QUE ESO NO SE PUEDA VOLVER A ESCRIBIR
   * ---------------------------------------------------------------------
   * No alcanzaba con llamar a `cargar()` desde `cambiarRol`: el mismo error
   * se repite el día que se agregue otro disparador. Ahora ESTE EFECTO es
   * el único dueño de `cargando` -- lo prende al empezar y lo apaga al
   * terminar --, así que no existe forma de prender el spinner sin arrancar
   * una carga. `cambiarRol` no toca `cargando`.
   *
   * Depende SOLO de `rol`: cambiar de tipo (accesos/barra) no vuelve a
   * pedir nada, se re-deriva de lo que ya está en `confirmado`.
   *
   * `vigente` corta la carrera de tocar dos chips seguidos: cada corrida
   * invalida a la anterior, así que la respuesta lenta de un rol que ya no
   * está en pantalla no pisa a la del rol actual.
   */
  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError(null);

    traerConfiguracion(rol)
      .then((config) => {
        if (!vigente) return;
        setConfirmado(config);
        setFilas(aFilas(config, tipoRef.current));
      })
      .catch((e: unknown) => {
        // Sin respaldo, a diferencia del home: si no se puede leer el estado
        // real, no se puede dejar que nadie lo cambie a ciegas.
        if (vigente) setError(e instanceof Error ? e.message : 'No se pudo cargar la configuración.');
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });

    return () => {
      vigente = false;
    };
  }, [rol]);

  const filasConfirmadas = useMemo<Fila[]>(
    () => (confirmado === null ? [] : aFilas(confirmado, tipo)),
    [confirmado, tipo],
  );

  const efecto = useMemo(() => calcularEfecto(filasConfirmadas, filas), [filasConfirmadas, filas]);

  /** Recarga a mano: el "tirar para refrescar" y el volver a la pantalla. */
  const cargar = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const config = await traerConfiguracion(rol);
      setConfirmado(config);
      setFilas(aFilas(config, tipoRef.current));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la configuración.');
    }
  }, [rol]);

  /**
   * PAUSADO MIENTRAS HAY CAMBIOS SIN GUARDAR. Es para lo que existe la
   * bandera (ver el hook): un refresco automático -- volver de otra app,
   * volver a esta pantalla -- pisaría los toggles y el orden que la persona
   * acaba de mover, y eso es perderle trabajo, no un parpadeo.
   */
  useRefrescoAlEnfocar(cargar, { pausado: efecto.cambia });

  const prendidos = filas.filter((f) => f.visible).length;
  const maximoTabs = confirmado?.maximoTabs ?? 4;
  const pasaElLimite = tipo === 'tab' && prendidos > maximoTabs;

  function cambiarRol(nuevo: Rol): void {
    if (nuevo === rol) return;
    // Se descarta lo editado sin guardar: arrastrarlo a otro rol sería
    // aplicarle a alguien un cambio pensado para otro.
    //
    // NO toca `cargando`: el efecto de arriba es el único dueño del spinner,
    // y esa es justamente la razón por la que esta pantalla se moría.
    setRol(nuevo);
    setConfirmado(null);
    setFilas([]);
  }

  function cambiarTipo(nuevo: TipoNavegacion): void {
    if (nuevo === tipo || confirmado === null) return;
    setTipo(nuevo);
    setFilas(aFilas(confirmado, nuevo));
  }

  function alternar(clave: string): void {
    setFilas((actuales) => actuales.map((f) => (f.clave === clave ? { ...f, visible: !f.visible } : f)));
  }

  function moverFila(desde: number, hacia: number): void {
    setFilas((actuales) => mover(actuales, desde, hacia));
  }

  async function guardar(): Promise<void> {
    setGuardando(true);
    try {
      const config = await guardarConfiguracion(
        rol,
        tipo,
        filas.map((f) => ({ clave: f.clave, visible: f.visible })),
      );
      setConfirmado(config);
      setFilas(aFilas(config, tipo));
      // Lo que se acaba de guardar puede ser del rol de quien está mirando:
      // su home y su barra tienen que reflejarlo YA, no en el próximo login.
      refrescarNavegacion();
    } catch (e) {
      // El mensaje del servidor tal cual: dice QUÉ falta (el límite de tabs
      // explica por qué son 4). Uno genérico borraría justo lo accionable.
      Alert.alert('No se pudo guardar', e instanceof Error ? e.message : 'Error desconocido.');
    } finally {
      setGuardando(false);
    }
  }

  function confirmarRestablecer(): void {
    Alert.alert(
      'Volver al valor de fábrica',
      `${TIPOS.find((t) => t.tipo === tipo)?.etiqueta} del ${ROLES.find((r) => r.rol === rol)?.etiqueta} vuelve a como vino la app: todo prendido y en el orden original.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Volver a fábrica',
          style: 'destructive',
          onPress: () => {
            setGuardando(true);
            restablecerConfiguracion(rol, tipo)
              .then((config) => {
                setConfirmado(config);
                setFilas(aFilas(config, tipo));
                // Volver a fábrica también cambia lo que ve la gente.
                refrescarNavegacion();
              })
              .catch((e: unknown) =>
                Alert.alert('No se pudo restablecer', e instanceof Error ? e.message : 'Error desconocido.'),
              )
              .finally(() => setGuardando(false));
          },
        },
      ],
    );
  }

  const etiquetaRol = ROLES.find((r) => r.rol === rol)?.etiqueta ?? rol;
  const puedeGuardar = efecto.cambia && !efecto.quedaVacio && !pasaElLimite && !guardando;

  return (
    <PantallaConTabs
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void cargar()} tintColor={colors.rojo} />}
    >
      <BarraApp rotulo="Accesos y menús" />

      {/* A QUÉ ROL se le está configurando. Primero, porque todo lo de abajo
          depende de esto y cambiarlo descarta lo editado. */}
      <Card>
        <Text style={styles.titulo}>Rol</Text>
        <View style={styles.grupo}>
          {ROLES.map((r) => (
            <Pressable
              key={r.rol}
              accessibilityRole="button"
              accessibilityState={r.rol === rol ? { selected: true } : {}}
              onPress={() => cambiarRol(r.rol)}
              style={[styles.opcion, r.rol === rol && styles.opcionActiva]}
            >
              <Text style={[styles.opcionTexto, r.rol === rol && styles.opcionTextoActivo]}>{r.etiqueta}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.titulo, styles.tituloSeparado]}>Qué se configura</Text>
        <View style={styles.grupo}>
          {TIPOS.map((t) => (
            <Pressable
              key={t.tipo}
              accessibilityRole="button"
              accessibilityState={t.tipo === tipo ? { selected: true } : {}}
              onPress={() => cambiarTipo(t.tipo)}
              style={[styles.opcion, t.tipo === tipo && styles.opcionActiva]}
            >
              <Text style={[styles.opcionTexto, t.tipo === tipo && styles.opcionTextoActivo]}>{t.etiqueta}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.ayuda}>{TIPOS.find((t) => t.tipo === tipo)?.ayuda}</Text>
      </Card>

      {cargando ? (
        <Card>
          <ActivityIndicator color={colors.rojo} />
        </Card>
      ) : error !== null ? (
        <Card>
          <Text style={styles.error}>{error}</Text>
          <Button label="Reintentar" onPress={() => void cargar()} />
        </Card>
      ) : (
        <>
          {/* LA LISTA. Los apagados SE VEN apagados, no escondidos: si
              desaparecieran no habría forma de volver a prenderlos. */}
          <Card>
            <Text style={styles.titulo}>
              {TIPOS.find((t) => t.tipo === tipo)?.etiqueta} del {etiquetaRol}
            </Text>
            <Text style={styles.ayuda}>
              {prendidos} de {filas.length} {prendidos === 1 ? 'prendido' : 'prendidos'}
              {tipo === 'tab' ? ` · la barra aguanta ${maximoTabs}` : ''}
            </Text>

            {filas.map((fila, i) => (
              <View key={fila.clave} style={[styles.fila, !fila.visible && styles.filaApagada]}>
                <View style={styles.filaTexto}>
                  <Text style={[styles.filaNombre, !fila.visible && styles.filaNombreApagado]}>{fila.nombre}</Text>
                  <Text style={styles.filaSub}>{fila.sub}</Text>
                  {/* EL PORQUÉ, a la vista de quien va a mover esto. */}
                  {fila.nota !== undefined ? (
                    <View style={styles.nota}>
                      <Info size={13} color={colors.gris} />
                      <Text style={styles.notaTexto}>{fila.nota}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.filaControles}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Subir ${fila.nombre}`}
                    disabled={i === 0}
                    onPress={() => moverFila(i, i - 1)}
                    style={[styles.flecha, i === 0 && styles.flechaApagada]}
                  >
                    <ArrowUp size={16} color={i === 0 ? colors.grisClaro : colors.tinta} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Bajar ${fila.nombre}`}
                    disabled={i === filas.length - 1}
                    onPress={() => moverFila(i, i + 1)}
                    style={[styles.flecha, i === filas.length - 1 && styles.flechaApagada]}
                  >
                    <ArrowDown size={16} color={i === filas.length - 1 ? colors.grisClaro : colors.tinta} />
                  </Pressable>
                  <Switch
                    accessibilityLabel={`Mostrar ${fila.nombre}`}
                    value={fila.visible}
                    onValueChange={() => alternar(fila.clave)}
                    trackColor={{ false: colors.grisClaro, true: colors.ok }}
                  />
                </View>
              </View>
            ))}
          </Card>

          {/* EL EFECTO, ANTES DE GUARDAR. Lo más importante de la pantalla. */}
          <Card>
            <Text style={styles.titulo}>Qué va a pasar</Text>
            {efecto.cambia ? (
              <View style={[styles.efecto, styles.efectoCambia]}>
                <Text style={styles.efectoTexto}>
                  El <Text style={styles.fuerte}>{etiquetaRol}</Text> va a pasar de{' '}
                  <Text style={styles.fuerte}>{efecto.visiblesAntes}</Text> a{' '}
                  <Text style={styles.fuerte}>{efecto.visiblesDespues}</Text>{' '}
                  {tipo === 'acceso' ? 'accesos' : 'entradas en la barra'}.
                </Text>
                {efecto.seApagan.length > 0 ? (
                  <Text style={styles.efectoTexto}>
                    Deja de ver: <Text style={styles.fuerte}>{efecto.seApagan.join(', ')}</Text>.
                  </Text>
                ) : null}
                {efecto.sePrenden.length > 0 ? (
                  <Text style={styles.efectoTexto}>
                    Pasa a ver: <Text style={styles.fuerte}>{efecto.sePrenden.join(', ')}</Text>.
                  </Text>
                ) : null}
                {efecto.cambiaElOrden ? <Text style={styles.efectoTexto}>Y cambia el orden.</Text> : null}
              </View>
            ) : (
              <View style={styles.efecto}>
                <Text style={styles.efectoTexto}>Nada: todavía no cambiaste nada.</Text>
              </View>
            )}

            {/* LOS DOS FRENOS, con su razón dicha. */}
            {efecto.quedaVacio ? (
              <View style={styles.aviso}>
                <AlertTriangle size={15} color={colors.rojo} />
                <Text style={styles.avisoTexto}>
                  Apagaste todo. El {etiquetaRol} abriría la app sin nada por donde empezar, así que esto no se puede
                  guardar. Dejá al menos uno prendido.
                </Text>
              </View>
            ) : null}
            {pasaElLimite ? (
              <View style={styles.aviso}>
                <AlertTriangle size={15} color={colors.rojo} />
                <Text style={styles.avisoTexto}>
                  La barra de abajo aguanta {maximoTabs} entradas y dejaste {prendidos} prendidas. Con una más quedan
                  tan angostas que &quot;Armar hojas&quot; no entra sin cortarse. Apagá una antes de prender otra.
                </Text>
              </View>
            ) : null}

            <Button
              label="Guardar"
              onPress={() => void guardar()}
              loading={guardando}
              disabled={!puedeGuardar}
            />
          </Card>

          {/* LA SALIDA cuando alguien se equivoca y no se acuerda de cómo estaba. */}
          <Card>
            <Text style={styles.titulo}>Volver al valor de fábrica</Text>
            <Text style={styles.ayuda}>
              Deja {TIPOS.find((t) => t.tipo === tipo)?.etiqueta.toLowerCase()} del {etiquetaRol} como vino la app: todo
              prendido y en el orden original.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={confirmarRestablecer}
              disabled={guardando}
              style={styles.restablecer}
            >
              <RotateCcw size={15} color={colors.rojo} />
              <Text style={styles.restablecerTexto}>Volver a fábrica</Text>
            </Pressable>
          </Card>
        </>
      )}
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  titulo: { fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.bold },
  tituloSeparado: { marginTop: spacing.md },
  ayuda: { fontSize: 12, lineHeight: 16, color: colors.gris, fontFamily: fonts.regular },
  error: { fontSize: 13, color: colors.rojo, fontFamily: fonts.regular },
  fuerte: { fontFamily: fonts.bold, color: colors.tinta },

  grupo: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  opcion: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borde,
    backgroundColor: colors.blanco,
  },
  opcionActiva: { backgroundColor: colors.rojo, borderColor: colors.rojo },
  opcionTexto: { fontSize: 12.5, color: colors.tinta, fontFamily: fonts.medium },
  opcionTextoActivo: { color: colors.blanco },

  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borde,
  },
  // Apagado se VE apagado, no desaparece: si no, no habría cómo prenderlo.
  filaApagada: { opacity: 0.55 },
  filaTexto: { flex: 1, gap: 2 },
  filaNombre: { fontSize: 13, color: colors.tinta, fontFamily: fonts.medium },
  filaNombreApagado: { textDecorationLine: 'line-through' },
  filaSub: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },
  nota: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, paddingRight: spacing.sm },
  notaTexto: { flex: 1, fontSize: 11, lineHeight: 15, color: colors.gris, fontFamily: fonts.regular },
  filaControles: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  flecha: { padding: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.campo },
  flechaApagada: { opacity: 0.4 },

  efecto: { gap: spacing.xs, padding: 11, borderRadius: radius.sm, backgroundColor: colors.esperaSuave },
  efectoCambia: { backgroundColor: colors.procesoSuave },
  efectoTexto: { fontSize: 12, lineHeight: 17, color: colors.gris, fontFamily: fonts.regular },

  aviso: { flexDirection: 'row', gap: spacing.sm, padding: 11, borderRadius: radius.sm, backgroundColor: colors.rojoSuave },
  avisoTexto: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.tinta, fontFamily: fonts.regular },

  restablecer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  restablecerTexto: { fontSize: 13, color: colors.rojo, fontFamily: fonts.medium },
});
