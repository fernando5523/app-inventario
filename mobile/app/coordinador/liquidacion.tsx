import { router, useFocusEffect } from 'expo-router';
import { AlertTriangle, ClipboardEdit, Layers, Scale, Wallet } from 'lucide-react-native';
import { useCallback, useMemo, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { BarraApp, Badge, Button, formatoFechaHora } from '../../components/ui';
import { repositorioLiquidacion } from '../../lib/contenedor';
import { textoDeAjustes, validarAjustes } from '../../lib/dominio/ajustes-formulario';
import { asistentesConCentavoExtra } from '../../lib/dominio/reparto-visible';
import type {
  AjustesDelMes,
  Conciliacion,
  DatosAjustes,
  DetalleLiquidacion,
  Liquidacion,
} from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';

const nf = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const soles = (n: number) => `S/ ${nf.format(n)}`;

/**
 * Por qué un monto vino en `null`: nunca "cero", nunca un guión sin
 * explicación. `ResultadoInventario.colaboradoresAsistieron`/
 * `montoNegativos` son NULLABLE en la base (ver el schema) porque hoy no
 * existe ningún mecanismo para registrar asistencia ni cargar los ajustes
 * del mes — un campo vacío sin decir por qué es casi tan malo como un
 * número inventado: quien lo ve piensa que la app se rompió.
 */
function motivoSinCalcular(advertencia: Liquidacion['advertencia']): string {
  const razones: string[] = [];
  if (advertencia.asistenciaSinRegistrar) razones.push('falta registrar la asistencia');
  if (advertencia.ajustesSinRegistrar) razones.push('faltan los ajustes del mes');
  return razones.length > 0 ? `No se puede calcular: ${razones.join(' y ')}.` : 'No se puede calcular todavía.';
}

/** Igual criterio, para el monto que depende ÚNICAMENTE de los ajustes del mes. */
const MOTIVO_SIN_AJUSTES = 'No se puede calcular: faltan los ajustes del mes.';

type Filtro = 'todos' | 'asistio' | 'falto';

const NOMBRE_ROL: Record<string, string> = { coordinador: 'Coordinador', conteo: 'Conteo', auditor: 'Auditor' };

function filtrar(planilla: DetalleLiquidacion[], filtro: Filtro): DetalleLiquidacion[] {
  if (filtro === 'asistio') return planilla.filter((p) => p.asistio);
  if (filtro === 'falto') return planilla.filter((p) => !p.asistio);
  return planilla;
}

/**
 * Liquidación y nómina (mobile/design/liquidacion.html) — acceso del
 * Coordinador, cierre de fin de mes: faltante neto -> cuota base -> multas
 * por inasistencia, y la planilla de los 11 colaboradores filtrable.
 *
 * Los montos en soles son los mismos del mockup (el propio mockup los
 * marca como ilustrativos) — vienen de `repositorioLiquidacion`, ninguno
 * está clavado en esta pantalla.
 */
export default function LiquidacionScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liquidacion, setLiquidacion] = useState<Liquidacion | null>(null);
  const [conciliacion, setConciliacion] = useState<Conciliacion | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [ajustes, setAjustes] = useState<AjustesDelMes | null>(null);
  const [guardandoAjustes, setGuardandoAjustes] = useState(false);

  const cargar = useCallback(async () => {
    if (!sesion) return;
    setError(null);
    try {
      // Piden lo mismo (el último ciclo cerrado de la sucursal): si uno es
      // null el otro también lo es, pero se piden en paralelo en vez de
      // encadenados porque no dependen entre sí.
      const [resultadoLiq, resultadoConc] = await Promise.all([
        repositorioLiquidacion.deSucursal(sesion.sucursal!.id),
        repositorioLiquidacion.conciliacion(sesion.sucursal!.id),
      ]);
      setLiquidacion(resultadoLiq);
      setConciliacion(resultadoConc);

      // Los ajustes SÍ van encadenados: cuelgan del inventario, y el id sale
      // de la liquidación que se acaba de traer. Sin ciclo cerrado no hay
      // inventario del que cargar ajustes.
      setAjustes(resultadoLiq === null ? null : await repositorioLiquidacion.ajustes(resultadoLiq.inventarioId));
    } catch (e) {
      // Sin esto, un fallo sin red dejaba el spinner girando para siempre
      // (mismo bug que f558689 arregló), y `useEffect` con deps `[sesion]`
      // tampoco reintentaba solo al volver a esta pantalla.
      setError(e instanceof Error ? e.message : 'No se pudo cargar la liquidación.');
    } finally {
      setCargando(false);
    }
  }, [sesion]);

  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar]),
  );

  const visibles = useMemo(() => (liquidacion ? filtrar(liquidacion.planilla, filtro) : []), [liquidacion, filtro]);

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  /**
   * Guardar los ajustes RECARGA todo, no solo la tarjeta: al pasar de `null`
   * a un monto, el backend puede calcular el faltante neto, la cuota y la
   * planilla entera. Actualizar solo la tarjeta dejaría el resto de la
   * pantalla diciendo "no se puede calcular" al lado de unos ajustes ya
   * cargados — el tipo de contradicción que hace desconfiar de todo lo demás.
   */
  async function guardarAjustes(datos: DatosAjustes): Promise<void> {
    if (!liquidacion) return;
    setGuardandoAjustes(true);
    try {
      await repositorioLiquidacion.registrarAjustes(liquidacion.inventarioId, datos);
      await cargar();
    } catch (e) {
      Alert.alert(
        'No se pudieron guardar los ajustes',
        e instanceof Error ? e.message : 'Probá de nuevo en un momento.',
      );
    } finally {
      setGuardandoAjustes(false);
    }
  }

  /**
   * `totalFaltas`/`cuotaBase`/`bonoAsistencia` nacen o faltan JUNTOS: los
   * tres dependen de los mismos dos datos (asistencia/ajustes del mes, ver
   * motivoSinCalcular) — nunca uno sin los otros dos. Un solo flag en vez
   * de tres chequeos sueltos evita que un caso quede a medio blindar.
   */
  const datosCompletos =
    liquidacion !== null &&
    liquidacion.totalFaltas !== null &&
    liquidacion.cuotaBase !== null &&
    liquidacion.bonoAsistencia !== null;

  const asistieron = datosCompletos ? liquidacion.planilla.length - liquidacion.totalFaltas! : null;

  // A cuántos asistentes les tocó el centavo extra del reparto. La regla vive
  // en lib/dominio/reparto-visible.ts, no acá: así se prueba sin montar la
  // pantalla (ver reparto-visible.test.ts).
  const conCentavoExtra = datosCompletos
    ? asistentesConCentavoExtra(liquidacion.planilla, liquidacion.cuotaBase!, liquidacion.bonoAsistencia!)
    : 0;
  const hayCentavoDeReparto = conCentavoExtra > 0;

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <BarraApp
        rotulo="Gestión masiva"
        sede={`Liquidación · ${sesion.sucursal!.nombre}`}
        cifras={liquidacion ? `${liquidacion.periodo} · ${liquidacion.planilla.length} colaboradores` : undefined}
        onSalir={salir}
      />

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : error || !liquidacion ? (
        <View style={styles.tarjeta}>
          <Text style={styles.tarjetaTitulo}>No se pudo cargar la liquidación</Text>
          <Text style={styles.tarjetaTexto}>{error ?? 'Intentá de nuevo.'}</Text>
          <Button label="Reintentar" onPress={cargar} />
        </View>
      ) : (
        <>
          {/*
            LOS AJUSTES VAN PRIMERO, antes del resumen, y no es cosmético:
            mientras no estén cargados, el faltante neto y la cuota por
            persona son `null` y toda la pantalla de abajo muestra "no se
            puede calcular". Poner la tarjeta acá arriba es poner primero lo
            único accionable.
          */}
          <TarjetaAjustes
            inventarioId={liquidacion.inventarioId}
            estado={ajustes}
            guardando={guardandoAjustes}
            onGuardar={guardarAjustes}
          />

          <View style={styles.tarjeta}>
            <View style={styles.tarjetaCabecera}>
              <Wallet size={18} color={colors.rojo} />
              <Text style={styles.tarjetaTitulo}>Faltante neto a descontar</Text>
            </View>
            <View style={styles.resumen}>
              <View style={styles.resumenFila}>
                <Text style={styles.resumenEtiqueta}>Faltante bruto</Text>
                <Text style={[styles.resumenValor, styles.resumenFalta]}>{soles(liquidacion.faltanteBruto)}</Text>
              </View>
              <View style={styles.resumenFila}>
                <Text style={styles.resumenEtiqueta}>(–) Negativos del mes</Text>
                <Text style={[styles.resumenValor, liquidacion.negativosDelMes === null && styles.resumenSinCalcular]}>
                  {liquidacion.negativosDelMes === null ? MOTIVO_SIN_AJUSTES : `-${soles(liquidacion.negativosDelMes)}`}
                </Text>
              </View>
              <View style={styles.resumenFila}>
                <Text style={styles.resumenEtiqueta}>(–) Faltante empresa</Text>
                <Text style={styles.resumenValor}>-{soles(liquidacion.faltanteEmpresa)}</Text>
              </View>
              <View style={[styles.resumenFila, styles.resumenFilaSeparada]}>
                <Text style={styles.resumenEtiqueta}>Faltante neto a descontar</Text>
                <Text style={[styles.resumenValor, styles.resumenFalta, liquidacion.faltanteNeto === null && styles.resumenSinCalcular]}>
                  {liquidacion.faltanteNeto === null ? motivoSinCalcular(liquidacion.advertencia) : soles(liquidacion.faltanteNeto)}
                </Text>
              </View>
              <View style={styles.resumenFila}>
                <Text style={styles.resumenEtiqueta}>Cuota base ({liquidacion.planilla.length} colaboradores)</Text>
                <Text style={[styles.resumenValor, liquidacion.cuotaBase === null && styles.resumenSinCalcular]}>
                  {liquidacion.cuotaBase === null ? motivoSinCalcular(liquidacion.advertencia) : `${soles(liquidacion.cuotaBase)} / persona`}
                </Text>
              </View>
            </View>

            {/*
              PEGADA AL MONTO, no al pie en letra chica: quien autoriza un
              descuento a la nómina de otra persona tiene que ver que el
              número está incompleto ANTES de firmar. Va dentro de la misma
              tarjeta que el faltante neto, debajo de la cifra que califica.

              Sin `numberOfLines`: el texto envuelve todas las líneas que
              necesite. Una advertencia cortada a la mitad no advierte nada.
            */}
            {liquidacion.advertencia.mensaje !== null ? (
              <View style={styles.aviso}>
                <AlertTriangle size={16} color={colors.proceso} />
                <Text style={styles.avisoTexto}>{liquidacion.advertencia.mensaje}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.tarjeta}>
            <View style={styles.tarjetaCabecera}>
              <Wallet size={18} color={colors.rojo} />
              <Text style={styles.tarjetaTitulo}>Fondo de multas por inasistencia</Text>
              {datosCompletos ? <Badge label={`${liquidacion.totalFaltas!} faltas`} /> : null}
            </View>
            {/* Toda la tarjeta depende de totalFaltas/bonoAsistencia -- si
                cualquiera falta, no hay números parciales que mostrar: se
                explica por qué en vez de armar una cuenta con huecos. */}
            {!datosCompletos ? (
              <Text style={styles.tarjetaTexto}>{motivoSinCalcular(liquidacion.advertencia)}</Text>
            ) : (
              <>
                <Text style={styles.tarjetaTexto}>
                  {liquidacion.totalFaltas} faltas × {soles(liquidacion.multaInasistencia)} ={' '}
                  {soles(liquidacion.totalFaltas! * liquidacion.multaInasistencia)}, redistribuido entre los {asistieron}{' '}
                  colaboradores que sí asistieron.
                </Text>
                <Text style={styles.resultado}>-{soles(liquidacion.bonoAsistencia!)} de descuento adicional para cada asistente</Text>
              </>
            )}

            {/*
              EL CENTAVO DEL REPARTO, explicado donde se ve.

              Cuando el fondo no divide exacto entre los asistentes, a algunos
              les toca un centavo más para que la suma dé el fondo exacto
              (S/80 entre 7 = seis de 11.43 y uno de 11.42). Sin esta línea,
              quien compare el encabezado contra la planilla ve dos números
              distintos y piensa que el sistema calcula mal — que es
              exactamente lo que este reparto vino a evitar.

              Solo aparece cuando efectivamente pasa: si el reparto da parejo,
              una aclaración sobre un centavo que no existe solo confunde.
            */}
            {hayCentavoDeReparto ? (
              <Text style={styles.notaReparto}>
                A {conCentavoExtra} de ellos les toca S/ 0.01 más, para que la suma dé exactamente{' '}
                {soles(liquidacion.totalFaltas! * liquidacion.multaInasistencia)}.
              </Text>
            ) : null}
          </View>

          {/* Por qué el total de la planilla no da EXACTO contra el
              faltante neto -- el residuo de redondeo de la cuota, y si lo
              recaudado por inasistencia se repartió entero. Para que el
              Coordinador lo vea ANTES de lacrar, no después de que alguien
              de Contabilidad pregunte por qué no cierra. */}
          {conciliacion ? (
            <View style={styles.tarjeta}>
              <View style={styles.tarjetaCabecera}>
                <Scale size={18} color={colors.rojo} />
                <Text style={styles.tarjetaTitulo}>Conciliación</Text>
              </View>
              {!conciliacion.calculable ? (
                <Text style={styles.tarjetaTexto}>{motivoSinCalcular(conciliacion.advertencia)}</Text>
              ) : (
                <>
                  <View style={styles.resumen}>
                    <View style={styles.resumenFila}>
                      <Text style={styles.resumenEtiqueta}>Suma real de la planilla</Text>
                      <Text style={styles.resumenValor}>{soles(conciliacion.sumaPlanilla)}</Text>
                    </View>
                    <View style={styles.resumenFila}>
                      <Text style={styles.resumenEtiqueta}>Diferencia por redondeo</Text>
                      <Text style={styles.resumenValor}>{soles(conciliacion.diferenciaPorRedondeo)}</Text>
                    </View>
                  </View>
                  <Text style={styles.notaReparto}>
                    Son los centavos que deja el redondeo de la cuota por persona ({conciliacion.colaboradores} colaboradores) —
                    hoy quedan a favor del personal.
                  </Text>

                  <View style={styles.conciliacionFondo}>
                    <View style={styles.resumenFila}>
                      <Text style={styles.resumenEtiqueta}>Fondo de multas recaudado</Text>
                      <Text style={styles.resumenValor}>{soles(conciliacion.fondoDeMultas.recaudado)}</Text>
                    </View>
                    <View style={styles.resumenFila}>
                      <Text style={styles.resumenEtiqueta}>Repartido entre asistentes</Text>
                      <Text style={styles.resumenValor}>{soles(conciliacion.fondoDeMultas.repartido)}</Text>
                    </View>
                  </View>

                  {conciliacion.fondoDeMultas.cierra ? (
                    <Badge label="El fondo de multas cierra" variant="ok" />
                  ) : (
                    // Color de AVISO (proceso/procesoSuave), no de error: es
                    // un descuadre a mirar, no una falla que rompió algo.
                    <View style={styles.aviso}>
                      <AlertTriangle size={16} color={colors.proceso} />
                      <Text style={styles.avisoTexto}>
                        El fondo de multas no cierra: se repartió {soles(conciliacion.fondoDeMultas.repartido)} de{' '}
                        {soles(conciliacion.fondoDeMultas.recaudado)} recaudados (diferencia de{' '}
                        {soles(conciliacion.fondoDeMultas.diferencia)}).
                      </Text>
                    </View>
                  )}
                </>
              )}
            </View>
          ) : null}

          <View style={styles.seccion}>
            <Text style={styles.seccionTitulo}>Planilla de descuentos</Text>
            <Text style={styles.seccionTotal}>{liquidacion.planilla.length} colaboradores</Text>
          </View>

          <View style={styles.chips}>
            {(
              [
                { id: 'todos', etiqueta: 'Todos', cuenta: liquidacion.planilla.length },
                // '—' y no el número: "asistieron"/"faltaron" no se pueden
                // afirmar sin asistencia registrada (ver motivoSinCalcular).
                { id: 'asistio', etiqueta: 'Asistieron', cuenta: asistieron ?? '—' },
                { id: 'falto', etiqueta: 'Faltaron', cuenta: liquidacion.totalFaltas ?? '—' },
              ] as const
            ).map((f) => {
              const activo = filtro === f.id;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => setFiltro(f.id)}
                  style={[styles.chip, activo && styles.chipActivo]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: activo }}
                >
                  <Text style={[styles.chipTexto, activo && styles.chipTextoActivo]}>
                    {f.etiqueta} ({f.cuenta})
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.planilla}>
            {visibles.map((p) => (
              <View key={p.colaboradorId} style={[styles.personaFila, !p.asistio && styles.personaFilaFalto]}>
                <View style={styles.personaDatos}>
                  <Text style={styles.personaNombre}>{p.nombre}</Text>
                  <Text style={styles.personaSub}>
                    {NOMBRE_ROL[p.rol] ?? p.rol} ·{' '}
                    {p.asistio
                      ? liquidacion.bonoAsistencia !== null
                        ? `Asistió (–${soles(liquidacion.bonoAsistencia)} bono)`
                        : 'Asistió'
                      : `Faltó (+${soles(liquidacion.multaInasistencia)} multa)`}
                  </Text>
                </View>
                <View style={styles.personaMonto}>
                  <Text style={[styles.personaMontoValor, !p.asistio && styles.resumenFalta]}>{soles(p.monto)}</Text>
                  <Text style={styles.personaMontoSub}>a descontar</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.pieLista}>
            <Layers size={16} color={colors.grisClaro} />
            <Text style={styles.pieListaTexto}>
              Mostrando {visibles.length} de <Text style={styles.pieListaFuerte}>{liquidacion.planilla.length} colaboradores</Text>
            </Text>
          </View>
        </>
      )}
    </PantallaConTabs>
  );
}

/**
 * LOS AJUSTES DEL MES: el paso que faltaba para poder cerrar el mes.
 *
 * Mientras no estén cargados, `montoNegativos` es `null` en la base y el
 * backend rechaza liquidar con 409 — así que toda la pantalla de abajo
 * muestra "no se puede calcular". Esta tarjeta es lo único accionable en ese
 * estado, y por eso va primero.
 *
 * El formulario aparece solo cuando hace falta (sin registrar, o al tocar
 * "Corregir"): una vez cargados, lo normal es mirarlos, no editarlos.
 */
function TarjetaAjustes({
  inventarioId,
  estado,
  guardando,
  onGuardar,
}: {
  inventarioId: number;
  estado: AjustesDelMes | null;
  guardando: boolean;
  onGuardar: (datos: DatosAjustes) => Promise<void>;
}): JSX.Element | null {
  const [editando, setEditando] = useState(false);
  const [montoNegativos, setMontoNegativos] = useState('');
  const [montoEmpresa, setMontoEmpresa] = useState('');
  const [nota, setNota] = useState('');
  const [errorCampos, setErrorCampos] = useState<string | null>(null);

  // `null` = todavía cargando el estado. No se dibuja nada en vez de
  // mostrar "sin registrar", que sería afirmar algo que no se sabe.
  if (estado === null) return null;

  const texto = textoDeAjustes(estado, soles, formatoFechaHora);
  const mostrandoFormulario = editando || texto.bloqueaLiquidacion;

  async function guardar(): Promise<void> {
    const validado = validarAjustes({ montoNegativos, montoEmpresa, nota });
    if (!validado.ok) {
      setErrorCampos(validado.error);
      return;
    }
    setErrorCampos(null);
    await onGuardar(validado.datos);
    setEditando(false);
  }

  return (
    <View style={[styles.tarjeta, texto.bloqueaLiquidacion && styles.tarjetaBloqueante]}>
      <View style={styles.tarjetaCabecera}>
        <ClipboardEdit size={18} color={texto.bloqueaLiquidacion ? colors.rojo : colors.tinta} />
        <Text style={styles.tarjetaTitulo}>Ajustes del mes</Text>
        {texto.bloqueaLiquidacion ? <Badge label="Sin registrar" variant="falta" /> : null}
      </View>

      <Text style={styles.ajustesEstado}>{texto.titulo}</Text>
      <Text style={styles.tarjetaTexto}>{texto.detalle}</Text>
      {estado.nota !== null ? <Text style={styles.ajustesNota}>“{estado.nota}”</Text> : null}

      {mostrandoFormulario ? (
        <View style={styles.ajustesForm}>
          <Text style={styles.ajustesEtiqueta}>Ajustes a favor del personal (S/)</Text>
          <TextInput
            style={styles.ajustesInput}
            value={montoNegativos}
            onChangeText={setMontoNegativos}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.gris}
          />

          <Text style={styles.ajustesEtiqueta}>Faltante que absorbe la empresa (S/) — opcional</Text>
          <TextInput
            style={styles.ajustesInput}
            value={montoEmpresa}
            onChangeText={setMontoEmpresa}
            keyboardType="decimal-pad"
            // Vacío NO es 0: dejarlo así conserva el monto que calculó el
            // cierre del conteo desde las categorías de empresa.
            placeholder="Dejalo vacío para conservar el calculado"
            placeholderTextColor={colors.gris}
          />

          <Text style={styles.ajustesEtiqueta}>¿De dónde salen? (obligatorio)</Text>
          <TextInput
            style={[styles.ajustesInput, styles.ajustesInputNota]}
            value={nota}
            onChangeText={setNota}
            multiline
            placeholder="Ej: mermas documentadas y devoluciones de agosto"
            placeholderTextColor={colors.gris}
          />

          {errorCampos !== null ? <Text style={styles.ajustesError}>{errorCampos}</Text> : null}

          <Button
            label={guardando ? 'Guardando…' : 'Guardar ajustes'}
            onPress={guardar}
            disabled={guardando}
          />
          {editando ? (
            <Button label="Cancelar" variant="outline" size="sm" onPress={() => setEditando(false)} />
          ) : null}
        </View>
      ) : (
        <Button
          label="Corregir"
          variant="outline"
          size="sm"
          onPress={() => {
            // Se precargan los valores actuales: corregir es ajustar un
            // número, no volver a escribirlo todo de memoria.
            setMontoNegativos(estado.montoNegativos === null ? '' : String(estado.montoNegativos));
            setMontoEmpresa(estado.montoFaltanteEmpresa === null ? '' : String(estado.montoFaltanteEmpresa));
            setNota(estado.nota ?? '');
            setEditando(true);
          }}
        />
      )}

      <Text style={styles.ajustesPie}>Inventario #{inventarioId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md + 3 },
  cargando: { marginTop: spacing.xxxl },

  // Ajustes del mes. El borde rojo solo cuando BLOQUEAN: una tarjeta que
  // grita siempre deja de significar nada.
  tarjetaBloqueante: { borderColor: colors.rojo },
  ajustesEstado: { fontSize: fontSize.lg, fontFamily: fonts.bold, color: colors.tinta },
  ajustesNota: { fontSize: fontSize.sm, color: colors.gris, fontStyle: 'italic' },
  ajustesForm: { gap: spacing.sm },
  ajustesEtiqueta: { fontSize: fontSize.sm, fontFamily: fonts.bold, color: colors.tinta },
  ajustesInput: {
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.base,
    color: colors.tinta,
  },
  ajustesInputNota: { minHeight: 72, textAlignVertical: 'top' },
  ajustesError: { fontSize: fontSize.sm, color: colors.rojo, fontFamily: fonts.bold },
  ajustesPie: { fontSize: fontSize.xs, color: colors.gris },

  tarjeta: {
    gap: spacing.md,
    padding: 15,
    backgroundColor: colors.campo,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: 13,
  },
  tarjetaCabecera: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tarjetaTitulo: { flex: 1, fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
  tarjetaTexto: { fontSize: 12.5, lineHeight: 18, color: colors.gris, fontFamily: fonts.regular },
  resultado: { fontSize: 12.5, fontWeight: '600', color: colors.gris, fontFamily: fonts.semibold },

  /**
   * El aviso de monto incompleto. `flex: 1` en el texto y `flexShrink` en la
   * fila: el mensaje envuelve en las líneas que necesite en vez de empujar el
   * ícono fuera de la tarjeta o cortarse con puntos suspensivos. Una
   * advertencia truncada no advierte.
   *
   * `alignItems: 'flex-start'` para que el ícono quede a la altura de la
   * PRIMERA línea y no centrado sobre un párrafo de tres.
   */
  aviso: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.sm + 2,
    borderRadius: radius.sm,
    // `proceso`/`procesoSuave`, el estado de ATENCIÓN del design system --
    // no `rojo` (que en esta app es siempre acción, nunca estado) ni `falta`
    // (que es un dato del inventario, no un aviso sobre el dato).
    backgroundColor: colors.procesoSuave,
    borderWidth: 1,
    borderColor: colors.proceso,
  },
  avisoTexto: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.tinta, fontFamily: fonts.regular },

  /** La nota del centavo del reparto: aclaración, no alarma. Sin recuadro. */
  notaReparto: { marginTop: 6, fontSize: 11.5, lineHeight: 16, color: colors.grisClaro, fontFamily: fonts.regular },

  resumen: { gap: spacing.sm + 1 },
  resumenFila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  resumenFilaSeparada: { paddingTop: 9, borderTopWidth: 1, borderTopColor: colors.borde },
  conciliacionFondo: { gap: spacing.sm + 1, marginTop: spacing.sm, paddingTop: 9, borderTopWidth: 1, borderTopColor: colors.borde },
  resumenEtiqueta: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
  resumenValor: { fontSize: 16, color: colors.tinta, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  resumenFalta: { color: colors.proceso },
  /** El motivo de "no se puede calcular" -- texto, no cifra: tamaño menor y sin negrita para no leerse como un monto. */
  resumenSinCalcular: { fontSize: 11.5, fontFamily: fonts.regular, color: colors.gris, textAlign: 'right', flexShrink: 1 },

  seccion: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  seccionTitulo: { fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.gris, fontFamily: fonts.semibold },
  seccionTotal: { fontSize: 11.5, color: colors.grisClaro, fontFamily: fonts.regular },

  chips: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borde,
    backgroundColor: colors.campo,
  },
  chipActivo: { backgroundColor: colors.rojo, borderColor: colors.rojo },
  chipTexto: { fontSize: 12.5, color: colors.tinta, fontFamily: fonts.medium, fontVariant: ['tabular-nums'] },
  chipTextoActivo: { color: colors.blanco, fontFamily: fonts.bold },

  planilla: { gap: 9 },
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
  personaFilaFalto: { borderColor: 'rgba(138,90,5,0.32)' },
  personaDatos: { flex: 1, minWidth: 0, gap: 2 },
  personaNombre: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.bold },
  personaSub: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },
  personaMonto: { alignItems: 'flex-end', gap: 2 },
  personaMontoValor: { fontSize: 15, color: colors.tinta, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  personaMontoSub: { fontSize: 10.5, color: colors.grisClaro, fontFamily: fonts.regular },

  pieLista: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 12,
    borderRadius: 11,
    backgroundColor: colors.esperaSuave,
  },
  pieListaTexto: { fontSize: fontSize.sm - 0.5, color: colors.gris, fontFamily: fonts.regular },
  pieListaFuerte: { color: colors.tinta, fontFamily: fonts.bold },
});
