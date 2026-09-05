import { router } from 'expo-router';
import { AlertTriangle, ArrowRightCircle, Check, FileText, Lock } from 'lucide-react-native';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { repositorioHojas, repositorioInventario } from '../../lib/contenedor';
import { avanceConjunto, estadoConjunto, type EstadoConjunto } from '../../lib/dominio/hoja';
import { partirEnHojas } from '../../lib/dominio/lote';
import { TAMANOS_HOJA, type HojaConteo, type Rol, type TamanoHoja } from '../../lib/dominio/tipos';
import type { ResumenRonda } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';
import { BandaSync, Badge, BarraApp, Button, formatoMiles, formatoPct, type BadgeVariant } from '../ui';

/**
 * La ronda que esta pantalla sabe cerrar HOY: la 1ra. Es el hueco que
 * trababa el ciclo — el 1er conteo se terminaba y no había forma de cerrarlo.
 * Las rondas 2 y 3 dependen de que el puerto de hojas soporte `ronda` (hoy
 * `repositorioHojas.todas()` siempre trae la 1ra, ver el comentario de arriba
 * del componente); cuando exista, esta misma pantalla las maneja con el mismo
 * bloque, cambiando este número por la ronda activa. El puerto ya está listo
 * para las tres: `resumenRonda`/`cerrarRonda` reciben la ronda por parámetro.
 */
const RONDA_A_CERRAR = 1;

// formatoMiles/formatoPct, no Intl.NumberFormat('es-PE'): no está
// garantizado que Hermes traiga los datos ICU de es-PE en el emulador —
// ver components/ui/formato.ts.
const nf = { format: formatoMiles };

interface CalculoHojas {
  total: number;
  completas: number;
  parcial: number;
}

function calcularHojas(totalItems: number, tamano: TamanoHoja): CalculoHojas {
  if (totalItems <= 0) return { total: 0, completas: 0, parcial: 0 };
  const tamanos = partirEnHojas(totalItems, tamano);
  const ultima = tamanos[tamanos.length - 1] ?? 0;
  const esParcial = ultima !== tamano;
  return { total: tamanos.length, completas: esParcial ? tamanos.length - 1 : tamanos.length, parcial: esParcial ? ultima : 0 };
}

function textoCalculo(c: CalculoHojas, tamano: number): string {
  if (c.total === 0) return 'Sin ítems para calcular.';
  if (c.parcial === 0) return `${nf.format(c.total)} hojas de ${tamano} ítems (exacto).`;
  return `${nf.format(c.total)} hojas de ${tamano} ítems: ${nf.format(c.completas)} completas + 1 parcial de ${c.parcial} — la cantidad de hojas se calcula siempre, nunca es fija.`;
}

/**
 * Traduce el estado de una ronda (`hoja.ts#EstadoConjunto`) al badge que
 * se muestra -- NUNCA "Finalizada" fija: antes de este cambio el badge
 * era texto hardcodeado, sin relacion con las hojas reales (hallazgo I-4
 * de la auditoria).
 */
function badgeDeEstado(estado: EstadoConjunto): { label: string; variant: BadgeVariant } {
  switch (estado) {
    case 'finalizada':
      return { label: 'Finalizada', variant: 'ok' };
    case 'en-proceso':
      return { label: 'En curso', variant: 'proceso' };
    case 'pendiente':
      return { label: 'Pendiente', variant: 'espera' };
    case 'sin-hojas':
      return { label: 'Sin datos todavía', variant: 'outline' };
  }
}

interface PasoCicloProps {
  titulo: string;
  descripcion: string;
  estado: EstadoConjunto;
  calculo?: string;
  /** Barra + cifra de avance REAL (items contados / total). Sin esto, no se dibuja embudo. */
  avance?: { pct: number; texto: string };
  /** Nota honesta cuando falta un dato -- nunca un numero inventado en su lugar. */
  notaSinDato?: string;
}

/** Tarjeta de un paso del embudo (`.tarjeta` + `.embudo-*` en la maqueta). */
function PasoCiclo({ titulo, descripcion, estado, calculo, avance, notaSinDato }: PasoCicloProps): JSX.Element {
  const badge = badgeDeEstado(estado);
  return (
    <View style={styles.tarjeta}>
      <View style={styles.tarjetaCabecera}>
        <Text style={styles.tarjetaTitulo}>{titulo}</Text>
        <Badge label={badge.label} variant={badge.variant} />
      </View>
      <Text style={styles.tarjetaTexto}>{descripcion}</Text>
      {calculo ? <Text style={styles.tarjetaTexto}>{calculo}</Text> : null}
      {avance ? (
        <>
          <View style={styles.embudoBarra}>
            <View style={[styles.embudoOk, { width: `${Math.min(100, Math.max(0, avance.pct))}%` }]} />
          </View>
          <View style={styles.embudoFila}>
            <Check size={14} color={colors.ok} />
            <Text style={[styles.embudoTexto, { color: colors.ok }]}>{avance.texto}</Text>
          </View>
        </>
      ) : null}
      {notaSinDato ? <Text style={styles.notaSinDato}>{notaSinDato}</Text> : null}
    </View>
  );
}

/** Una fila del embudo del cierre: etiqueta a la izquierda, cifra a la derecha. */
function FilaResumen({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: 'ok' | 'falta' }): JSX.Element {
  return (
    <View style={styles.filaResumen}>
      <Text style={styles.filaResumenEtiqueta}>{etiqueta}</Text>
      <Text style={[styles.filaResumenValor, tono === 'ok' && styles.valorOk, tono === 'falta' && styles.valorFalta]}>{valor}</Text>
    </View>
  );
}

export interface CicloScreenProps {
  rol: Extract<Rol, 'coordinador' | 'auditor'>;
}

/**
 * Ciclo de los 3 conteos (mobile/design/ciclo-conteos.html) — un solo
 * componente para Coordinador y Auditor, la usan app/coordinador/ciclo.tsx
 * y app/auditor/ciclo.tsx. La diferencia entre roles se resuelve con la
 * prop `rol`, nunca con una segunda copia del archivo: el Coordinador
 * elige el tamaño de hoja de los reconteos (es su decisión); el Auditor
 * lo ve de solo lectura y tiene además el acceso a la matriz de auditoría,
 * que no le corresponde al Coordinador.
 *
 * HALLAZGO I-4 DE LA AUDITORIA (ya corregido acá): el embudo y los 3
 * badges de estado eran datos locales fijos (650/130 hardcodeados,
 * "Finalizada" a fuego) — la MISMA sesión contaba dos historias
 * distintas: Inicio decía "34 de 160 hojas finalizadas" y Ciclo decía
 * que los 3 conteos habían terminado. Ahora el Paso 1 sale de
 * `repositorioHojas.todas()` vía `hoja.ts#estadoConjunto`/`avanceConjunto`
 * — LAS MISMAS funciones que se pueden aplicar sobre las mismas hojas que
 * usa InicioScreen.tsx, así que no pueden divergir: no hay dos cálculos,
 * hay uno solo aplicado dos veces.
 *
 * DATO QUE SIGUE FALTANDO EN LOS PUERTOS (Pasos 2 y 3): no hay ningún
 * Repositorio que modele una "ronda de conteo" 2da/3ra ni la comparación
 * contra el stock del ERP que decide qué ítems pasan de una ronda a la
 * siguiente — `RepositorioHojas` no tiene parámetro de ronda (el backend
 * sí lo soporta, `GET /api/hojas?...&ronda=`, pero el puerto del front
 * nunca lo pasa, siempre trae la 1ra) y `RepositorioAuditoria.matriz()`
 * (que sí tiene conteo1/2/3 por ítem) hoy solo trae 3 ítems de ejemplo,
 * no el inventario completo (ver auditoria-memoria.ts). Con eso, los
 * Pasos 2 y 3 muestran "Sin datos todavía" en vez de inventar un número
 * — se habilitan cuando exista ese dato (el módulo de auditoría que
 * min-5 está construyendo en el backend puede ser quien lo exponga).
 */
export function CicloScreen({ rol }: CicloScreenProps): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [items, setItems] = useState<number | null>(null);
  const [inventarioId, setInventarioId] = useState<number | null>(null);
  const [hojasT1, setHojasT1] = useState<HojaConteo[] | null>(null);
  const [tamanoReconteo, setTamanoReconteo] = useState<TamanoHoja>(50);

  // Cierre de ronda (solo Coordinador). El resumen es un PREVIEW que no muta:
  // se ve ANTES de decidir. Ver RepositorioInventario.resumenRonda.
  const [resumen, setResumen] = useState<ResumenRonda | null>(null);
  const [cerrandoRonda, setCerrandoRonda] = useState(false);
  const esCoordinador = rol === 'coordinador';

  const cargarResumen = useCallback(async (invId: number): Promise<void> => {
    try {
      setResumen(await repositorioInventario.resumenRonda(invId, RONDA_A_CERRAR));
    } catch {
      // Sin resumen la pantalla no se rompe: el bloque de cierre no aparece y
      // el resto del ciclo (Paso 1, embudo) se ve igual. Un error acá es "no
      // pude traer el preview", no "el inventario está mal".
      setResumen(null);
    }
  }, []);

  useEffect(() => {
    if (!sesion) return;
    let vigente = true;

    async function cargar(): Promise<void> {
      const activo = await repositorioInventario.activo(sesion!.sucursal!.id);
      if (!vigente) return;
      setItems(activo?.items ?? null);
      setInventarioId(activo?.inventarioId ?? null);
      if (!activo) {
        setCargando(false);
        return;
      }
      // `todas()`, no `mias()`: el embudo es del inventario entero, no de
      // lo que le toca a quien mira la pantalla (mismo puerto que ya usa
      // InicioScreen.tsx para el Coordinador — ver el comentario de arriba).
      const todas = await repositorioHojas.todas(activo.inventarioId);
      if (!vigente) return;
      setHojasT1(todas);
      // El preview del cierre solo lo necesita quien puede cerrar.
      if (esCoordinador) await cargarResumen(activo.inventarioId);
      if (!vigente) return;
      setCargando(false);
    }

    cargar();
    return () => {
      vigente = false;
    };
  }, [sesion, esCoordinador, cargarResumen]);

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  async function cerrarRondaAhora(): Promise<void> {
    if (inventarioId === null || resumen === null || !resumen.sePuedeCerrar) return;
    setCerrandoRonda(true);
    try {
      const cierre = await repositorioInventario.cerrarRonda(inventarioId, RONDA_A_CERRAR);
      if (cierre.rondaAbierta !== null) {
        Alert.alert(
          `2do conteo abierto`,
          `Se abrió la ronda ${cierre.rondaAbierta} con ${formatoMiles(cierre.hojas.length)} hoja${cierre.hojas.length === 1 ? '' : 's'} nueva${cierre.hojas.length === 1 ? '' : 's'}, sin asignar. Repartilas desde Gestión de hojas.`,
        );
      } else {
        // No se abrió ronda nueva: el ciclo terminó (todo cuadró, o se llegó
        // al último conteo). No es un error — el backend lo dice en el motivo.
        Alert.alert('1er conteo cerrado', cierre.motivoSinSiguiente ?? 'El ciclo de conteos terminó.');
      }
      // Recargar hojas y preview: el estado de la pantalla cambió.
      const todas = await repositorioHojas.todas(inventarioId);
      setHojasT1(todas);
      await cargarResumen(inventarioId);
    } catch (error) {
      // El backend rechaza con mensaje claro (hojas sin finalizar, o ya
      // cerrada): se muestra tal cual, no un "no se pudo" genérico.
      Alert.alert('No se pudo cerrar la ronda', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setCerrandoRonda(false);
    }
  }

  const totalT1 = items ?? 0;
  const estadoT1 = hojasT1 ? estadoConjunto(hojasT1) : 'sin-hojas';
  const avanceT1 = hojasT1 ? avanceConjunto(hojasT1) : null;
  const pctAvanceT1 = avanceT1 && avanceT1.totalItems > 0 ? (avanceT1.itemsContados / avanceT1.totalItems) * 100 : 0;

  const hojasCalculoT1 = calcularHojas(totalT1, 50);

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <BarraApp
        rotulo={rol === 'auditor' ? 'Auditoría · Ciclo de conteos' : 'Gestión masiva'}
        sede={sesion.sucursal!.nombre}
        cifras={items ? `${nf.format(items)} ítems · 3 pasadas de cierre` : undefined}
        onSalir={salir}
      />

      <BandaSync estado="ok" mensaje="Sincronizado con Dynamics" />

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : (
        <>
          <PasoCiclo
            titulo="Paso 1 · 1er Conteo General"
            descripcion="100% del catálogo. El comparativo contra el stock de Dynamics (cuántos cuadran y cuántos pasan al 2do conteo) se calcula al cerrar este paso."
            estado={estadoT1}
            calculo={textoCalculo(hojasCalculoT1, 50)}
            avance={
              avanceT1 && hojasT1 && hojasT1.length > 0
                ? {
                    pct: pctAvanceT1,
                    texto: `${nf.format(avanceT1.itemsContados)} de ${nf.format(avanceT1.totalItems)} ítems contados (${formatoPct(pctAvanceT1)}%)`,
                  }
                : undefined
            }
            notaSinDato={!hojasT1 || hojasT1.length === 0 ? 'Todavía no hay hojas del 1er conteo creadas para esta sucursal.' : undefined}
          />

          <View style={styles.tarjeta}>
            <Text style={styles.tarjetaTitulo}>Tamaño de hoja para los reconteos</Text>
            <Text style={styles.tarjetaTexto}>
              {rol === 'coordinador'
                ? 'Elegí cuántos ítems entran por hoja en el 2do y 3er conteo. La cantidad de hojas se recalcula siempre — nunca es un número fijo, y la última hoja puede quedar parcial.'
                : 'El Coordinador elige cuántos ítems entran por hoja en el 2do y 3er conteo. La cantidad de hojas se recalcula siempre — nunca es un número fijo.'}
            </Text>
            {rol === 'coordinador' ? (
              <View style={styles.segmentado}>
                {TAMANOS_HOJA.map((tamano, i) => {
                  const activo = tamano === tamanoReconteo;
                  return (
                    <Pressable
                      key={tamano}
                      onPress={() => setTamanoReconteo(tamano)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: activo }}
                      style={[
                        styles.segmento,
                        i < TAMANOS_HOJA.length - 1 && styles.segmentoConBorde,
                        activo && styles.segmentoActivo,
                      ]}
                    >
                      <Text style={[styles.segmentoTexto, activo && styles.segmentoTextoActivo]}>{tamano} ítems</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Badge label={`${tamanoReconteo} ítems por hoja, a elección del Coordinador`} variant="outline" />
            )}
          </View>

          <PasoCiclo
            titulo="Paso 2 · 2do Reconteo"
            descripcion="Solo los ítems que no coincidieron con el stock de Dynamics en el 1er conteo."
            estado="sin-hojas"
            notaSinDato="Sin datos todavía: falta el comparativo contra Dynamics del 1er conteo y un puerto que traiga las hojas de esta ronda (hoy el front solo pide siempre la 1ra)."
          />

          <PasoCiclo
            titulo="Paso 3 · 3er Reconteo Definitivo"
            descripcion={`Los ítems que persistieron tras la 2da pasada, auditados directamente${rol === 'auditor' ? ' por vos' : ''}. Las cantidades resultantes quedan fijas para la liquidación — no hay un 4to conteo.`}
            estado="sin-hojas"
            notaSinDato="Sin datos todavía: depende de que exista el Paso 2 primero."
          />

          {esCoordinador && resumen ? (
            <View style={styles.tarjeta}>
              <View style={styles.tarjetaCabecera}>
                <Text style={styles.tarjetaTitulo}>Cerrar el 1er conteo</Text>
                <Badge
                  label={resumen.sePuedeCerrar ? 'Listo para cerrar' : 'Faltan hojas'}
                  variant={resumen.sePuedeCerrar ? 'ok' : 'espera'}
                />
              </View>

              {/* El embudo REAL del 1er conteo, del backend. Es lo que hace de
                  cerrar una decisión y no un trámite: se ve el número ANTES de
                  apretar. */}
              <View style={styles.embudoResumen}>
                <FilaResumen etiqueta="Cuadraron contra Dynamics" valor={`${formatoMiles(resumen.cuadrados)} (${formatoPct(resumen.porcentajeCuadrado)}%)`} tono="ok" />
                <FilaResumen etiqueta="A recontar en el 2do conteo" valor={formatoMiles(resumen.aRecontar)} tono="falta" />
                {resumen.sinContar > 0 ? <FilaResumen etiqueta="Sin contar todavía" valor={formatoMiles(resumen.sinContar)} /> : null}
                {resumen.sinDatoErp > 0 ? <FilaResumen etiqueta="Sin stock del ERP (no se auditan)" valor={formatoMiles(resumen.sinDatoErp)} /> : null}
              </View>

              <Text style={styles.tarjetaTexto}>
                Cerrar abre el 2do conteo solo con lo que no cuadró — el 1er conteo queda intacto. Si quedan pocos
                ítems para recontar, es media hora; si quedan muchos, conviene mirar qué se contó mal antes de mandar a
                todos a recontar.
              </Text>

              {/* El motivo del bloqueo, a la vista: qué hojas faltan finalizar.
                  Un botón gris sin decir por qué obliga a adivinar. */}
              {!resumen.sePuedeCerrar ? (
                <View style={styles.bloqueoAviso}>
                  <AlertTriangle size={16} color={colors.proceso} />
                  <Text style={styles.bloqueoTexto}>
                    Quedan {formatoMiles(resumen.hojasSinFinalizar.length)} hoja
                    {resumen.hojasSinFinalizar.length === 1 ? '' : 's'} sin finalizar:{' '}
                    {resumen.hojasSinFinalizar.slice(0, 4).map((h) => `#${h.numero}`).join(', ')}
                    {resumen.hojasSinFinalizar.length > 4 ? ` y ${resumen.hojasSinFinalizar.length - 4} más` : ''}. Una
                    hoja sin finalizar es una hoja que alguien todavía está contando.
                  </Text>
                </View>
              ) : null}

              <Button
                label={
                  resumen.sePuedeCerrar
                    ? `Cerrar y abrir el 2do conteo · ${formatoMiles(resumen.aRecontar)} ítems`
                    : 'Terminá las hojas para poder cerrar'
                }
                icon={Lock}
                onPress={cerrarRondaAhora}
                disabled={!resumen.sePuedeCerrar}
                loading={cerrandoRonda}
              />
            </View>
          ) : null}

          <View style={styles.resumen}>
            <Text style={styles.tarjetaTexto}>
              El resultado final de las 3 pasadas (cuántos ítems cuadraron y cuántos quedan como diferencia definitiva)
              todavía no tiene datos reales — depende del mismo comparativo que falta en los Pasos 2 y 3.
            </Text>
          </View>

          {rol === 'auditor' ? (
            <Pressable
              style={styles.ctaAuditoria}
              onPress={() => router.push('/auditor/auditoria')}
              accessibilityRole="button"
            >
              <FileText size={17} color={colors.blanco} />
              <Text style={styles.ctaAuditoriaTexto}>Ver comparativo de los 3 conteos en auditoría</Text>
              <ArrowRightCircle size={17} color={colors.dorado} />
            </Pressable>
          ) : null}
        </>
      )}
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md + 3 },
  cargando: { marginTop: spacing.xxxl },

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

  embudoBarra: { height: 8, borderRadius: radius.full, backgroundColor: colors.procesoSuave, overflow: 'hidden' },
  embudoOk: { height: '100%', borderRadius: radius.full, backgroundColor: colors.ok },
  embudoFila: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  embudoTexto: { fontSize: 12.5, fontFamily: fonts.semibold },
  notaSinDato: { fontSize: 12, lineHeight: 17, color: colors.grisClaro, fontFamily: fonts.regular, fontStyle: 'italic' },

  segmentado: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderColor: colors.rojo,
    borderRadius: radius.md,
    backgroundColor: colors.campo,
    overflow: 'hidden',
  },
  segmento: { flex: 1, paddingVertical: 11, alignItems: 'center' },
  segmentoConBorde: { borderRightWidth: 1.5, borderRightColor: colors.rojo },
  segmentoActivo: { backgroundColor: colors.rojo },
  segmentoTexto: { fontSize: fontSize.sm - 0.5, color: colors.tinta, fontFamily: fonts.bold },
  segmentoTextoActivo: { color: colors.blanco },

  resumen: {
    gap: spacing.sm,
    padding: 15,
    backgroundColor: colors.campo,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: 13,
  },

  embudoResumen: { gap: 6 },
  filaResumen: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  filaResumenEtiqueta: { flex: 1, fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
  filaResumenValor: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  valorOk: { color: colors.ok },
  valorFalta: { color: colors.falta },

  bloqueoAviso: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 11,
    borderRadius: radius.md,
    backgroundColor: colors.procesoSuave,
  },
  bloqueoTexto: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.proceso, fontFamily: fonts.medium },
  ctaAuditoria: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 46,
    borderRadius: radius.sm,
    backgroundColor: colors.rojo,
  },
  ctaAuditoriaTexto: { flex: 1, textAlign: 'center', fontSize: 14.5, color: colors.blanco, fontFamily: fonts.bold },
});
