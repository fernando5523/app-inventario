import { router } from 'expo-router';
import { CalendarCheck, CalendarDays, Check, ClipboardList, TriangleAlert, Users } from 'lucide-react-native';
import { useCallback, useMemo, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import {
  Badge,
  BarraApp,
  Button,
  EmptyState,
  diaEnLima,
  formatoDiaJornada,
  formatoDiaJornadaLargo,
  formatoHora,
} from '../../components/ui';
import { cargarSeguro } from '../../lib/adaptadores/_http';
import { repositorioAsistencia, repositorioInventario } from '../../lib/contenedor';
import { filasDeAsistencia, presentesEnElDia, textoDiasAsistidos } from '../../lib/dominio/asistencia';
import { pluralizar } from '../../lib/dominio/plural';
import type { Rol } from '../../lib/dominio/tipos';
import type { AsistenciaInventario, PersonaDeAsistencia } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, radius, spacing } from '../../lib/theme';

const NOMBRE_ROL: Record<Rol, string> = {
  administrador: 'Administrador',
  auditor: 'Auditor',
  coordinador: 'Coordinador',
  conteo: 'Conteo',
};

/**
 * El inventario terminó (o no empezó): no hay dónde marcar.
 *
 * NO dice "vuelve a intentar": mientras no haya un inventario en curso,
 * reintentar no va a funcionar nunca, y una regla de negocio disfrazada de
 * error deja a la persona tocando un botón en loop. Dice qué falta hacer y
 * qué pasa con la asistencia una vez cerrado el conteo.
 */
const SIN_INVENTARIO =
  'La asistencia se registra mientras el inventario está abierto. Arma el inventario desde «Armar hojas»; una vez que se cierra el conteo, la asistencia queda firme y la usa la liquidación.';

/**
 * ASISTENCIA DEL INVENTARIO — pantalla del COORDINADOR.
 *
 * ---------------------------------------------------------------------------
 * QUÉ CAMBIA, Y POR QUÉ ESTA PANTALLA EXISTE
 * ---------------------------------------------------------------------------
 * Hasta ahora el sistema ADIVINABA quién asistió: quien tuviera una hoja con
 * al menos un conteo. El costo aceptado era que quien venía y no llegaba a
 * contar figuraba como ausente -- y se le descontaba del sueldo por eso.
 *
 * Acá el Coordinador lo REGISTRA: una marca de entrada por persona y por día.
 * Los días distintos con al menos una marca son la duración del inventario, y
 * la multa pasó a ser `días faltados x tarifa por día`.
 *
 * ---------------------------------------------------------------------------
 * SE MARCA EL DÍA DE HOY, Y NO HAY SELECTOR DE FECHA
 * ---------------------------------------------------------------------------
 * A propósito. El día no es una preferencia de vista: decide contra qué
 * jornada queda la marca, cuántos días duró el inventario y, por lo tanto, la
 * multa de todo el personal. Un selector con "hoy" ya puesto sería justo lo
 * que la skill del design system llama un dato autocompletado que nadie
 * verifica -- y acá terminaría en once entradas cargadas en un día que nadie
 * trabajó.
 *
 * El día se MUESTRA como dato derivado (hora de Lima, no la del equipo: ver
 * `diaEnLima`), y los días ya registrados están a la vista para que se pueda
 * controlar que la cuenta es la que tiene que ser.
 *
 * ---------------------------------------------------------------------------
 * NO HAY COLA OFFLINE
 * ---------------------------------------------------------------------------
 * Al revés que las hojas de conteo. Una marca es un hecho puntual del día, no
 * una jornada de trabajo que no se puede perder: si no hay red, la pantalla
 * lo dice y la persona vuelve a marcar. Encolarla haría que una entrada
 * "registrada" apareciera horas después, cuando el día ya podría estar
 * cerrado. Ver `RepositorioAsistencia` en puertos/repositorios.ts.
 */
export default function AsistenciaScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inventarioId, setInventarioId] = useState<number | null>(null);
  const [asistencia, setAsistencia] = useState<AsistenciaInventario | null>(null);
  /** Id de la persona cuya marca se está escribiendo: su fila muestra el spinner, el resto sigue viva. */
  const [enCurso, setEnCurso] = useState<number | null>(null);

  /**
   * El día se resuelve en cada render y no se guarda en estado: el equipo
   * puede quedarse abierto cruzando la medianoche, y un día congelado al
   * montar la pantalla seguiría marcando contra el día de ayer.
   */
  const hoy = diaEnLima(new Date());

  const cargar = useCallback(async () => {
    if (!sesion) return;
    setError(null);
    const falla = await cargarSeguro(async () => {
      const activo = await repositorioInventario.activo(sesion.sucursal!.id);
      setInventarioId(activo?.inventarioId ?? null);
      // Sin inventario en curso no se pide la asistencia: el `null` de acá es
      // lo que hace que la pantalla explique por qué no hay nada, en vez de
      // mostrar una lista vacía que se lee como "nadie vino".
      setAsistencia(activo ? await repositorioAsistencia.deInventario(activo.inventarioId) : null);
    });
    // `setCargando(false)` incondicional: sin esto, un fallo sin red dejaba
    // el spinner girando para siempre (ver cargarSeguro en _http.ts).
    setCargando(false);
    if (falla) setError(falla.message);
  }, [sesion]);

  // Al enfocar y al volver la app a primer plano. Pausado mientras se escribe
  // una marca: un refresco a mitad de camino mostraría la lista sin la entrada
  // que se está registrando justo ahora.
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar, { pausado: enCurso !== null });

  const filas = useMemo(
    () => (asistencia ? filasDeAsistencia(asistencia.personal, asistencia.marcas, hoy) : []),
    [asistencia, hoy],
  );
  const diasDelInventario = asistencia?.dias.length ?? null;
  const presentesHoy = presentesEnElDia(filas);

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  /**
   * Escribe la marca y RECARGA del servidor, en vez de tocar el estado local.
   *
   * Registrar la primera entrada de un día agrega ese día al inventario, o
   * sea que cambia el denominador de todo el mundo: el "2 de 3 días" de las
   * otras diez filas pasa a ser "2 de 4". Actualizar solo la fila tocada
   * dejaría las demás mintiendo hasta el próximo refresco.
   */
  async function escribir(persona: PersonaDeAsistencia, quitar: boolean): Promise<void> {
    if (inventarioId === null) return;
    setEnCurso(persona.id);
    try {
      if (quitar) await repositorioAsistencia.quitar(inventarioId, persona.id, hoy);
      else await repositorioAsistencia.marcar(inventarioId, persona.id, hoy);
      setAsistencia(await repositorioAsistencia.deInventario(inventarioId));
    } catch (e) {
      // El mensaje del servidor tal cual: dice qué pasó (no eres el
      // Coordinador de esta tienda, el conteo ya se cerró) y eso es lo
      // accionable. Uno genérico lo borraría.
      Alert.alert(
        quitar ? 'No se pudo quitar la entrada' : 'No se pudo registrar la entrada',
        e instanceof Error ? e.message : 'Revisa la conexión con la tienda y vuelve a marcarla.',
      );
    } finally {
      setEnCurso(null);
    }
  }

  /**
   * Quitar una marca pide confirmación y NOMBRA a quién y qué día -- el resto
   * de la pantalla es de una sola acción, y sin el nombre delante es fácil
   * borrarle la jornada a la persona de al lado. No es irreversible (se
   * vuelve a marcar), así que no lleva el tono de un punto de no retorno.
   */
  function confirmarQuitar(persona: PersonaDeAsistencia): void {
    Alert.alert(
      'Quitar la entrada',
      `Se borra la entrada de ${persona.nombre} del ${formatoDiaJornadaLargo(hoy)}. Si de verdad vino, vuelve a marcarla: la hora quedará registrada de nuevo.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Quitar', style: 'destructive', onPress: () => void escribir(persona, true) },
      ],
    );
  }

  return (
    <PantallaConTabs
      scrollable
      contentStyle={styles.contenido}
      refreshControl={
        <RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={colors.rojo} colors={[colors.rojo]} />
      }
    >
      <BarraApp
        rotulo="Asistencia del inventario"
        sede={sesion.sucursal!.nombre}
        // "—" y no 0 cuando no se pudo traer: un cero inventado acá dice que
        // el inventario duró cero días y que no vino nadie.
        cifras={
          asistencia === null || diasDelInventario === null
            ? '— personas · — días registrados'
            : `${asistencia.personal.length} ${pluralizar(asistencia.personal.length, 'persona', 'personas')} · ${diasDelInventario} ${pluralizar(diasDelInventario, 'día registrado', 'días registrados')}`
        }
        onSalir={salir}
      />

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.spinner} />
      ) : error !== null ? (
        <EmptyState icon={TriangleAlert} title="No se pudo cargar la asistencia" subtitle={error}>
          <Button label="Volver a intentar" onPress={refrescar} />
        </EmptyState>
      ) : inventarioId === null ? (
        <EmptyState icon={ClipboardList} title="Todavía no hay un inventario en curso" subtitle={SIN_INVENTARIO} />
      ) : (
        <>
          <View style={styles.tarjeta}>
            <View style={styles.tarjetaCabecera}>
              <CalendarCheck size={18} color={colors.rojo} />
              <Text style={styles.tarjetaTitulo}>Entrada de hoy</Text>
              <Badge
                label={`${presentesHoy} / ${filas.length}`}
                variant={filas.length > 0 && presentesHoy === filas.length ? 'ok' : 'default'}
              />
            </View>
            <Text style={styles.diaDeHoy}>{formatoDiaJornadaLargo(hoy)}</Text>
            <Text style={styles.tarjetaTexto}>
              Marca la entrada de cada persona a medida que llega. Solo entrada: no se marca salida, porque la jornada se
              cobra por día trabajado.
            </Text>
          </View>

          <View style={styles.tarjeta}>
            <View style={styles.tarjetaCabecera}>
              <CalendarDays size={18} color={colors.rojo} />
              <Text style={styles.tarjetaTitulo}>Días del inventario</Text>
              {/* "—" y no 0: un cero acá afirma que el inventario duró cero días. */}
              <Badge
                label={
                  diasDelInventario === null ? '— días' : `${diasDelInventario} ${pluralizar(diasDelInventario, 'día', 'días')}`
                }
              />
            </View>
            {/*
              Por qué esta tarjeta no es decorativa: este número es el
              denominador de la multa de todas las personas de la lista. Que el
              Coordinador lo vea acá es lo que le permite notar un día de más
              —una marca cargada en la fecha equivocada— ANTES de que se
              convierta en una falta para los diez que sí vinieron.
            */}
            <Text style={styles.tarjetaTexto}>
              Un día entra al inventario cuando se registra la primera entrada de ese día. Estos son los días contra los
              que se mide la asistencia de cada persona.
            </Text>
            {asistencia !== null && asistencia.dias.length > 0 ? (
              <View style={styles.dias}>
                {asistencia.dias.map((dia) => {
                  const cuantos = asistencia.marcas.filter((m) => m.dia === dia).length;
                  const esHoy = dia === hoy;
                  return (
                    <View key={dia} style={[styles.diaChip, esHoy && styles.diaChipHoy]}>
                      <Text style={[styles.diaChipFecha, esHoy && styles.diaChipFechaHoy]}>{formatoDiaJornada(dia)}</Text>
                      <Text style={styles.diaChipCuenta}>
                        {cuantos} {pluralizar(cuantos, 'persona', 'personas')}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.sinDias}>
                Todavía no hay ningún día registrado. El inventario empieza a contar días con la primera entrada que
                marques.
              </Text>
            )}
          </View>

          <View style={styles.seccion}>
            <Text style={styles.seccionTitulo}>Personal de tienda</Text>
            <Text style={styles.seccionTotal}>
              {filas.length} {pluralizar(filas.length, 'persona', 'personas')}
            </Text>
          </View>

          {filas.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Esta tienda no tiene personal cargado"
              subtitle="La asistencia se marca sobre el personal de tienda (coordinación y conteo). Un Administrador o un Auditor dan de alta las cuentas en «Usuarios»."
            />
          ) : (
            <View style={styles.lista}>
              {filas.map(({ persona, diasAsistidos, marcaDelDia }) => {
                const presente = marcaDelDia !== null;
                const escribiendo = enCurso === persona.id;
                return (
                  <View key={persona.id} style={[styles.personaFila, presente && styles.personaFilaPresente]}>
                    <View style={styles.personaDatos}>
                      <Text style={styles.personaNombre}>{persona.nombre}</Text>
                      <Text style={styles.personaSub}>
                        {NOMBRE_ROL[persona.rol]} · {textoDiasAsistidos(diasAsistidos, diasDelInventario)}
                      </Text>
                      {/*
                        Tres señales para el mismo estado, no solo el texto: el
                        borde de la fila, el check verde y la hora. En una lista
                        que se escanea de arriba abajo mientras entra la gente,
                        el color es lo que se ve sin leer.
                      */}
                      {marcaDelDia !== null ? (
                        <View style={styles.entradaFila}>
                          <Check size={13} color={colors.ok} />
                          <Text style={styles.entradaTexto}>Entrada {formatoHora(marcaDelDia.registradoEn)}</Text>
                        </View>
                      ) : null}
                    </View>
                    {presente ? (
                      <Button
                        label="Quitar"
                        variant="ghost"
                        size="sm"
                        loading={escribiendo}
                        // Con once botones iguales en la lista, el nombre es
                        // lo único que distingue de quién es esta entrada.
                        accessibilityLabel={`Quitar la entrada de ${persona.nombre}`}
                        onPress={() => confirmarQuitar(persona)}
                      />
                    ) : (
                      <Button
                        label="Marcar entrada"
                        size="sm"
                        loading={escribiendo}
                        accessibilityLabel={`Marcar la entrada de ${persona.nombre}`}
                        onPress={() => void escribir(persona, false)}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { gap: spacing.lg },
  spinner: { marginTop: spacing.xxxl },

  tarjeta: {
    gap: spacing.sm,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.lg,
    backgroundColor: colors.campo,
  },
  tarjetaCabecera: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tarjetaTitulo: { flex: 1, fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
  tarjetaTexto: { fontSize: 12.5, lineHeight: 18, color: colors.gris, fontFamily: fonts.regular },
  /** El día que se está marcando: dato derivado, pero el más importante de la pantalla. */
  diaDeHoy: { fontSize: 17, color: colors.tinta, fontFamily: fonts.bold },

  dias: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 2 },
  diaChip: {
    alignItems: 'center',
    gap: 1,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borde,
    backgroundColor: colors.esperaSuave,
  },
  /**
   * El día de hoy se distingue con la paleta de ESTADO (`ok`), no con el rojo
   * de marca: el rojo es la acción, y acá la acción son los botones de la
   * lista. Si el chip también fuera rojo, competirían.
   */
  diaChipHoy: { borderColor: colors.ok, backgroundColor: colors.okSuave },
  diaChipFecha: { fontSize: 12.5, color: colors.tinta, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  diaChipFechaHoy: { color: colors.ok },
  diaChipCuenta: { fontSize: 10.5, color: colors.gris, fontFamily: fonts.regular },
  sinDias: { fontSize: 12.5, lineHeight: 18, color: colors.grisClaro, fontFamily: fonts.regular },

  seccion: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  seccionTitulo: { fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.gris, fontFamily: fonts.semibold },
  seccionTotal: { fontSize: 11.5, color: colors.grisClaro, fontFamily: fonts.regular },

  lista: { gap: 9 },
  personaFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: 12,
    backgroundColor: colors.campo,
  },
  personaFilaPresente: { borderColor: 'rgba(10,107,87,0.32)' },
  personaDatos: { flex: 1, minWidth: 0, gap: 2 },
  personaNombre: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.bold },
  personaSub: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },
  entradaFila: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  entradaTexto: { fontSize: 11.5, color: colors.ok, fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] },
});
