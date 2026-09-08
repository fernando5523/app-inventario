import { memo, type JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { diferenciaUnidades, diferenciaValor, rondasNecesarias, veredicto } from '../../lib/dominio/auditoria';
import type { ItemAuditoria } from '../../lib/dominio/tipos';
import { colors, fonts, fontSize, radius } from '../../lib/theme';
import { Badge, type BadgeVariant } from './Badge';
import { formatoMoneda } from './formato';

export interface TarjetaItemAuditoriaProps {
  item: ItemAuditoria;
}

const BORDE_VEREDICTO: Record<string, string> = {
  cuadrado: 'rgba(10,107,87,0.34)',
  falta: 'rgba(162,59,46,0.38)',
  empresa: colors.borde,
  // Neutro: un ítem sin datos no se pinta ni verde (éxito) ni rojo (falta).
  sin_contar: colors.borde,
  sin_erp: colors.borde,
};

const ORDINAL: Record<number, string> = { 1: '1er', 2: '2do', 3: '3er' };

function badgeDe(item: ItemAuditoria, v: string): { texto: string; variante: BadgeVariant } {
  // Sin datos: neutro y honesto — NUNCA verde, NUNCA nombra una ronda que no ocurrió.
  if (v === 'sin_contar') return { texto: 'Sin contar', variante: 'outline' };
  if (v === 'sin_erp') return { texto: 'Sin dato del ERP', variante: 'outline' };
  if (v === 'cuadrado') {
    // La ronda REAL en la que quedó fijado, no un default a la 3ra.
    return { texto: `Cuadró en ${ORDINAL[rondasNecesarias(item)] ?? 'el conteo'}`, variante: 'ok' };
  }
  if (v === 'empresa') return { texto: 'Regla Gerencia · Empresa', variante: 'default' };
  const dif = diferenciaUnidades(item);
  return { texto: dif !== null && dif > 0 ? 'Sobrante definitivo' : 'Faltante definitivo', variante: 'espera' };
}

function notaDe(item: ItemAuditoria, v: string): { texto: string; clase: 'ok' | 'falta' | 'neutral' } {
  if (v === 'sin_contar') {
    return { texto: 'Todavía sin contar — ninguna hoja finalizada incluye este ítem.', clase: 'neutral' };
  }
  if (v === 'sin_erp') {
    return {
      texto: 'Sin dato del ERP — el snapshot de Dynamics no trajo stock para este ítem, no hay contra qué compararlo.',
      clase: 'neutral',
    };
  }
  if (v === 'cuadrado') {
    return { texto: `Cuadró en el conteo — no llegó a necesitar una pasada más.`, clase: 'ok' };
  }
  // falta o empresa: el veredicto garantiza ERP y conteo, así que la
  // diferencia es un número; el `?? 0` es solo para que TS no reclame el null.
  const dif = diferenciaUnidades(item) ?? 0;
  const val = diferenciaValor(item);
  const tipo = dif < 0 ? 'faltante' : 'sobrante';
  const precioTxt = item.precioVenta === null ? 's/ precio' : `S/${formatoMoneda(item.precioVenta)}`;
  const valorTxt = val === null ? 'sin valorizar' : `${val < 0 ? '-' : '+'}S/${formatoMoneda(Math.abs(val))}`;
  const base = `${dif < 0 ? '' : '+'}${dif} unid. × ${precioTxt} = ${valorTxt} (${tipo}).`;
  if (v === 'empresa') {
    return { texto: `${base} Regla Gerencia: asumido por la empresa (S/0 a nómina).`, clase: 'neutral' };
  }
  return { texto: `Diferencia definitiva: ${base}`, clase: 'falta' };
}

const COLOR_NOTA: Record<'ok' | 'falta' | 'neutral', string> = {
  ok: colors.ok,
  falta: colors.proceso, // TODO: mismo hueco de --falta en lib/theme.ts ya marcado en BandaSync.tsx/CicloScreen.tsx.
  neutral: colors.gris,
};

interface CeldaProps {
  etiqueta: string;
  valor: number | null;
  coincideConErp: boolean;
}

function Celda({ etiqueta, valor, coincideConErp }: CeldaProps): JSX.Element {
  const inerte = valor === null;
  return (
    <View style={[styles.celda, inerte && styles.celdaInerte, !inerte && coincideConErp && styles.celdaOk]}>
      <Text style={styles.celdaEtiqueta}>{etiqueta}</Text>
      <Text style={[styles.celdaValor, !inerte && coincideConErp && { color: colors.ok }, !inerte && !coincideConErp && { color: colors.proceso }]}>
        {valor === null ? '—' : valor}
      </Text>
    </View>
  );
}

/**
 * Item de la matriz comparativa (`.item-comparado` en auditoria.html) — ERP
 * vs los 3 conteos, con la diferencia resaltada por color, no solo por texto.
 *
 * `React.memo`: con el catálogo real (hasta 8.000 ítems) esto son miles de
 * instancias montadas por `FlatList` — sin memo, cada render del padre
 * (auditoria.tsx, por ejemplo al cambiar el filtro) volvería a renderizar
 * TODAS las tarjetas de la ventana visible, no solo las que cambiaron.
 * `item` es un objeto estable mientras `items` no cambie en el padre, así
 * que la comparación por referencia de memo alcanza sin pasarle un
 * comparador custom.
 */
function TarjetaItemAuditoriaComponent({ item }: TarjetaItemAuditoriaProps): JSX.Element {
  const v = veredicto(item);
  const badge = badgeDe(item, v);
  const nota = notaDe(item, v);

  return (
    <View style={[styles.raiz, { borderColor: BORDE_VEREDICTO[v] }]}>
      <View style={styles.cabecera}>
        <View style={styles.textos}>
          <Text style={styles.nombre}>{item.descripcion}</Text>
          <Text style={styles.meta}>
            Código {item.codigo}
            {item.zona ? ` · ${item.zona}` : ''} · P. Venta {item.precioVenta === null ? '—' : `S/${formatoMoneda(item.precioVenta)}`}
          </Text>
        </View>
        <Badge label={badge.texto} variant={badge.variante} />
      </View>

      <View style={styles.grilla}>
        <Celda etiqueta="ERP" valor={item.stockErp} coincideConErp />
        <Celda etiqueta="1°" valor={item.conteo1} coincideConErp={item.conteo1 === item.stockErp} />
        <Celda etiqueta="2°" valor={item.conteo2} coincideConErp={item.conteo2 === item.stockErp} />
        <Celda etiqueta="3°" valor={item.conteo3} coincideConErp={item.conteo3 === item.stockErp} />
      </View>

      <Text style={[styles.nota, { color: COLOR_NOTA[nota.clase] }]}>{nota.texto}</Text>
    </View>
  );
}

export const TarjetaItemAuditoria = memo(TarjetaItemAuditoriaComponent);

const styles = StyleSheet.create({
  raiz: { gap: 11, padding: 14, borderWidth: 1, borderRadius: 12, backgroundColor: colors.campo },
  cabecera: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 9 },
  textos: { flex: 1, minWidth: 0 },
  nombre: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.bold, lineHeight: 18 },
  meta: { marginTop: 2, fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },
  grilla: { flexDirection: 'row', gap: 6 },
  celda: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 8, paddingHorizontal: 4, borderRadius: radius.sm, backgroundColor: colors.esperaSuave },
  celdaOk: { backgroundColor: colors.okSuave },
  celdaInerte: { opacity: 0.42 },
  celdaEtiqueta: { fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.grisClaro, fontFamily: fonts.bold },
  celdaValor: { fontSize: fontSize.sm + 1, color: colors.tinta, fontFamily: fonts.semibold },
  nota: { fontSize: 12.5, fontFamily: fonts.semibold, lineHeight: 17 },
});
