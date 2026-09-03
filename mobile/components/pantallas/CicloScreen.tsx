import { router } from 'expo-router';
import { ArrowRightCircle, Check, FileText, X } from 'lucide-react-native';
import { useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { repositorioInventario } from '../../lib/contenedor';
import { partirEnHojas } from '../../lib/dominio/lote';
import { TAMANOS_HOJA, type Rol, type TamanoHoja } from '../../lib/dominio/tipos';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';
import { BandaSync, Badge, BarraApp, formatoMiles, formatoPct } from '../ui';

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

interface PasoCicloProps {
  titulo: string;
  descripcion: string;
  calculo: string;
  pct: number;
  textoOk: string;
  textoFalta: string;
}

/** Tarjeta de un paso del embudo (`.tarjeta` + `.embudo-*` en la maqueta). */
function PasoCiclo({ titulo, descripcion, calculo, pct, textoOk, textoFalta }: PasoCicloProps): JSX.Element {
  return (
    <View style={styles.tarjeta}>
      <View style={styles.tarjetaCabecera}>
        <Text style={styles.tarjetaTitulo}>{titulo}</Text>
        <Badge label="Finalizada" variant="ok" />
      </View>
      <Text style={styles.tarjetaTexto}>{descripcion}</Text>
      <Text style={styles.tarjetaTexto}>{calculo}</Text>
      <View style={styles.embudoBarra}>
        <View style={[styles.embudoOk, { width: `${Math.min(100, Math.max(0, pct))}%` }]} />
      </View>
      <View style={styles.embudoCifras}>
        <View style={styles.embudoFila}>
          <Check size={14} color={colors.ok} />
          <Text style={[styles.embudoTexto, { color: colors.ok }]}>{textoOk}</Text>
        </View>
        <View style={styles.embudoFila}>
          {/* No existe todavia un token semantico "falta" en lib/theme.ts
              (mismo TODO que ya dejó BandaSync.tsx) -- se reusa el ambar de
              "proceso" en vez del rojo de marca, que es la accion, nunca
              un estado. */}
          <X size={14} color={colors.proceso} />
          <Text style={[styles.embudoTexto, { color: colors.proceso }]}>{textoFalta}</Text>
        </View>
      </View>
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
 * DATO QUE FALTABA EN LOS PUERTOS: no hay ningún Repositorio que modele
 * una "ronda de conteo" (1er/2do/3er) ni la comparación contra el stock
 * del ERP — RepositorioInventario/RepositorioHojas conocen un único
 * inventario con un único tamaño de hoja, no una secuencia de pasadas
 * con universos que se van achicando. El total de ítems (8.000) SÍ sale
 * de un puerto real (`repositorioInventario.activo()`), y el cálculo de
 * hojas para cada pasada usa `partirEnHojas()` del dominio de verdad —
 * pero los conteos de observados/persistentes (650 / 130) y el estado
 * "Finalizada" de cada paso quedan como dataset local fijo, igual al ya
 * validado en la maqueta, hasta que exista un RepositorioCiclo real.
 */
export function CicloScreen({ rol }: CicloScreenProps): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [items, setItems] = useState<number | null>(null);
  const [tamanoReconteo, setTamanoReconteo] = useState<TamanoHoja>(50);

  useEffect(() => {
    if (!sesion) return;
    let vigente = true;
    repositorioInventario.activo(sesion.sucursal.id).then((activo) => {
      if (!vigente) return;
      setItems(activo?.items ?? null);
      setCargando(false);
    });
    return () => {
      vigente = false;
    };
  }, [sesion]);

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  const totalT1 = items ?? 0;
  const observadosT2 = 650;
  const persistentesT3 = 130;
  const cuadradosT1 = totalT1 - observadosT2;
  const cuadradosT2 = observadosT2 - persistentesT3;
  const cuadradosFinal = totalT1 - persistentesT3;

  const hojasT1 = calcularHojas(totalT1, 50);
  const hojasT2 = calcularHojas(observadosT2, tamanoReconteo);
  const hojasT3 = calcularHojas(persistentesT3, tamanoReconteo);

  const pctT1 = totalT1 > 0 ? (cuadradosT1 / totalT1) * 100 : 0;
  const pctT2 = observadosT2 > 0 ? (cuadradosT2 / observadosT2) * 100 : 0;
  const pctFinal = totalT1 > 0 ? (cuadradosFinal / totalT1) * 100 : 0;

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <BarraApp
        rotulo={rol === 'auditor' ? 'Auditoría · Ciclo de conteos' : 'Gestión masiva'}
        sede={sesion.sucursal.nombre}
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
            descripcion="100% del catálogo, comparado contra el stock de Dynamics."
            calculo={textoCalculo(hojasT1, 50)}
            pct={pctT1}
            textoOk={`${nf.format(cuadradosT1)} cuadrados (${formatoPct(pctT1)}%)`}
            textoFalta={`${nf.format(observadosT2)} observados, pasan al 2do conteo (${formatoPct(100 - pctT1)}%)`}
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
            descripcion={`Solo los ${nf.format(observadosT2)} ítems observados en el 1er conteo.`}
            calculo={textoCalculo(hojasT2, tamanoReconteo)}
            pct={pctT2}
            textoOk={`${nf.format(cuadradosT2)} cuadrados en 2da pasada (${formatoPct(pctT2, 0)}%)`}
            textoFalta={`${nf.format(persistentesT3)} persisten, pasan al 3er conteo (${formatoPct(100 - pctT2, 0)}%)`}
          />

          <View style={styles.tarjeta}>
            <View style={styles.tarjetaCabecera}>
              <Text style={styles.tarjetaTitulo}>Paso 3 · 3er Reconteo Definitivo</Text>
              <Badge label="Finalizada" variant="ok" />
            </View>
            <Text style={styles.tarjetaTexto}>
              Los ítems que persistieron tras la 2da pasada, auditados directamente
              {rol === 'auditor' ? ' por vos.' : '.'} Las cantidades resultantes quedan fijas para la
              liquidación — no hay un 4to conteo.
            </Text>
            <Text style={styles.tarjetaTexto}>{textoCalculo(hojasT3, tamanoReconteo)}</Text>
            <Badge label="Sincronizada" variant="ok" />
          </View>

          <View style={styles.resumen}>
            <View style={styles.resumenFila}>
              <Check size={14} color={colors.ok} />
              <Text style={styles.resumenTexto}>
                {nf.format(cuadradosFinal)} de {nf.format(totalT1)} ítems cuadraron en 3 pasadas ({formatoPct(pctFinal)}%)
              </Text>
            </View>
            <Text style={styles.tarjetaTexto}>
              Los {nf.format(persistentesT3)} ítems restantes son la diferencia definitiva
              {rol === 'auditor' ? ': pasan a la matriz de auditoría para valorizarse en soles.' : '.'}
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
  embudoCifras: { gap: 4 },
  embudoFila: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  embudoTexto: { fontSize: 12.5, fontFamily: fonts.semibold },

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
  resumenFila: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resumenTexto: { fontSize: 12.5, fontWeight: '600', color: colors.gris, fontFamily: fonts.semibold },

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
