import { router } from 'expo-router';
import { Layers, Wallet } from 'lucide-react-native';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { BarraApp, Badge } from '../../components/ui';
import { repositorioLiquidacion } from '../../lib/contenedor';
import type { DetalleLiquidacion, Liquidacion } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';

const nf = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const soles = (n: number) => `S/ ${nf.format(n)}`;

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
  const [liquidacion, setLiquidacion] = useState<Liquidacion | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todos');

  useEffect(() => {
    if (!sesion) return;
    let vigente = true;
    repositorioLiquidacion.deSucursal(sesion.sucursal.id).then((resultado) => {
      if (!vigente) return;
      setLiquidacion(resultado);
      setCargando(false);
    });
    return () => {
      vigente = false;
    };
  }, [sesion]);

  const visibles = useMemo(() => (liquidacion ? filtrar(liquidacion.planilla, filtro) : []), [liquidacion, filtro]);

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  const asistieron = liquidacion ? liquidacion.planilla.length - liquidacion.totalFaltas : 0;

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <BarraApp
        rotulo="Gestión masiva"
        sede={`Liquidación · ${sesion.sucursal.nombre}`}
        cifras={liquidacion ? `${liquidacion.periodo} · ${liquidacion.planilla.length} colaboradores` : undefined}
        onSalir={salir}
      />

      {cargando || !liquidacion ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : (
        <>
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
                <Text style={styles.resumenValor}>-{soles(liquidacion.negativosDelMes)}</Text>
              </View>
              <View style={styles.resumenFila}>
                <Text style={styles.resumenEtiqueta}>(–) Faltante empresa</Text>
                <Text style={styles.resumenValor}>-{soles(liquidacion.faltanteEmpresa)}</Text>
              </View>
              <View style={[styles.resumenFila, styles.resumenFilaSeparada]}>
                <Text style={styles.resumenEtiqueta}>Faltante neto a descontar</Text>
                <Text style={[styles.resumenValor, styles.resumenFalta]}>{soles(liquidacion.faltanteNeto)}</Text>
              </View>
              <View style={styles.resumenFila}>
                <Text style={styles.resumenEtiqueta}>Cuota base ({liquidacion.planilla.length} colaboradores)</Text>
                <Text style={styles.resumenValor}>{soles(liquidacion.cuotaBase)} / persona</Text>
              </View>
            </View>
          </View>

          <View style={styles.tarjeta}>
            <View style={styles.tarjetaCabecera}>
              <Wallet size={18} color={colors.rojo} />
              <Text style={styles.tarjetaTitulo}>Fondo de multas por inasistencia</Text>
              <Badge label={`${liquidacion.totalFaltas} faltas`} />
            </View>
            <Text style={styles.tarjetaTexto}>
              {liquidacion.totalFaltas} faltas × {soles(liquidacion.multaInasistencia)} ={' '}
              {soles(liquidacion.totalFaltas * liquidacion.multaInasistencia)}, redistribuido entre los {asistieron}{' '}
              colaboradores que sí asistieron.
            </Text>
            <Text style={styles.resultado}>-{soles(liquidacion.bonoAsistencia)} de descuento adicional para cada asistente</Text>
          </View>

          <View style={styles.seccion}>
            <Text style={styles.seccionTitulo}>Planilla de descuentos</Text>
            <Text style={styles.seccionTotal}>{liquidacion.planilla.length} colaboradores</Text>
          </View>

          <View style={styles.chips}>
            {(
              [
                { id: 'todos', etiqueta: 'Todos', cuenta: liquidacion.planilla.length },
                { id: 'asistio', etiqueta: 'Asistieron', cuenta: asistieron },
                { id: 'falto', etiqueta: 'Faltaron', cuenta: liquidacion.totalFaltas },
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
                      ? `Asistió (–${soles(liquidacion.bonoAsistencia)} bono)`
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
  resultado: { fontSize: 12.5, fontWeight: '600', color: colors.gris, fontFamily: fonts.semibold },

  resumen: { gap: spacing.sm + 1 },
  resumenFila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  resumenFilaSeparada: { paddingTop: 9, borderTopWidth: 1, borderTopColor: colors.borde },
  resumenEtiqueta: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
  resumenValor: { fontSize: 16, color: colors.tinta, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  resumenFalta: { color: colors.proceso },

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
