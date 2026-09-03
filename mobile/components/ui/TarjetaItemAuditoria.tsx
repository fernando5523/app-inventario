import type { JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { diferenciaUnidades, diferenciaValor, veredicto } from '../../lib/dominio/auditoria';
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
};

function badgeDe(item: ItemAuditoria, v: string): { texto: string; variante: BadgeVariant } {
  if (v === 'cuadrado') {
    const pasada = item.conteo1 === item.stockErp ? '1er' : item.conteo2 === item.stockErp ? '2do' : '3er';
    return { texto: `Cuadró en ${pasada}`, variante: 'ok' };
  }
  if (v === 'empresa') return { texto: 'Regla Gerencia · Empresa', variante: 'default' };
  return { texto: 'Faltante definitivo', variante: 'espera' };
}

function notaDe(item: ItemAuditoria, v: string): { texto: string; clase: 'ok' | 'falta' | 'neutral' } {
  if (v === 'cuadrado') {
    return { texto: `Cuadró en el conteo — no llegó a necesitar una pasada más.`, clase: 'ok' };
  }
  const dif = diferenciaUnidades(item);
  const val = diferenciaValor(item);
  const tipo = dif < 0 ? 'faltante' : 'sobrante';
  const base = `${dif < 0 ? '' : '+'}${dif} unid. × S/${formatoMoneda(item.precioVenta)} = ${val < 0 ? '-' : '+'}S/${formatoMoneda(Math.abs(val))} (${tipo}).`;
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

/** Item de la matriz comparativa (`.item-comparado` en auditoria.html) — ERP vs los 3 conteos, con la diferencia resaltada por color, no solo por texto. */
export function TarjetaItemAuditoria({ item }: TarjetaItemAuditoriaProps): JSX.Element {
  const v = veredicto(item);
  const badge = badgeDe(item, v);
  const nota = notaDe(item, v);

  return (
    <View style={[styles.raiz, { borderColor: BORDE_VEREDICTO[v] }]}>
      <View style={styles.cabecera}>
        <View style={styles.textos}>
          <Text style={styles.nombre}>{item.descripcion}</Text>
          <Text style={styles.meta}>
            Código {item.codigo} · {item.zona} · P. Venta S/{formatoMoneda(item.precioVenta)}
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
