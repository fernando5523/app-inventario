import { memo, type JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  cuadroDelItem,
  diferenciaUnidades,
  diferenciaValor,
  rondasNecesarias,
  textoCuadro,
  textoPorQueCuadro,
  veredicto,
} from '../../lib/dominio/auditoria';
import { formatoPct } from './formato';
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

const ORDINAL: Record<number, string> = { 1: '1er', 2: '2do', 3: '3er', 4: '4to', 5: '5to', 6: '6to' };

/**
 * "4°" para la celda de la ronda N. Se arma con el número y no con una tabla:
 * el Auditor puede abrir tantas rondas como haga falta, y una tabla se queda
 * corta justo en el caso nuevo.
 */
const etiquetaRonda = (indice: number): string => `${indice + 1}°`;

function badgeDe(item: ItemAuditoria, v: string): { texto: string; variante: BadgeVariant } {
  // Sin datos: neutro y honesto — NUNCA verde, NUNCA nombra una ronda que no ocurrió.
  if (v === 'sin_contar') return { texto: 'Sin contar', variante: 'outline' };
  if (v === 'sin_erp') return { texto: 'Sin dato del ERP', variante: 'outline' };
  if (v === 'cuadrado') {
    // La ronda REAL en la que quedó fijado, no un default a la 3ra.
    // `?? 'el conteo'`: con más rondas que ordinales en la tabla se cae al
    // genérico en vez de mostrar "Cuadró en undefined".
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
  const cuadro = cuadroDelItem(item.atribucion);
  // `formatoPct` y no `toFixed`: un decimal con coma, como el resto de la app
  // (los datos ICU de es-PE no están garantizados en Hermes, ver formato.ts).
  const porQue = textoPorQueCuadro(item.atribucion, diferenciaUnidades(item) ?? 0, (n) => formatoPct(n));

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

      {/*
        UNA CELDA POR RONDA REAL, no tres clavadas: desde que el Auditor puede
        abrir un 4to o un 5to conteo, tres celdas esconderían justo las rondas
        que él mandó a hacer. `flexWrap` en la grilla porque con 5 o 6 celdas
        ya no entran en una fila del teléfono.
      */}
      <View style={styles.grilla}>
        <Celda etiqueta="ERP" valor={item.stockErp} coincideConErp />
        {item.conteos.map((valor, indice) => (
          <Celda
            key={indice}
            etiqueta={etiquetaRonda(indice)}
            valor={valor ?? null}
            coincideConErp={valor === item.stockErp}
          />
        ))}
      </View>

      <Text style={[styles.nota, { color: COLOR_NOTA[nota.clase] }]}>{nota.texto}</Text>

      {/*
        A QUÉ CUADRO FUE, Y POR QUÉ — el "hay que indicar" del cliente.
        Sin esta línea las tres filas del inventario 8059 decían exactamente lo
        mismo ("Faltante definitivo") aunque S/440 de S/460 no se le
        descontaran a nadie: el Auditor no tenía forma de saberlo mirando la
        pantalla, y menos de discutirlo.

        El cuadro sale del REPARTO que resolvió el servidor, no de la clase
        (ver `cuadroDelItem`): en ese mismo inventario los tres ítems son de
        clase `paquete` y uno igual se le descuenta al personal.
      */}
      {cuadro !== null ? (
        <View style={[styles.cuadro, cuadro === 'personal' && styles.cuadroPersonal]}>
          <Text style={[styles.cuadroTexto, cuadro === 'personal' && styles.cuadroTextoPersonal]}>
            {textoCuadro(cuadro)}
            {porQue !== null ? <Text style={styles.cuadroPorQue}> · {porQue}</Text> : null}
          </Text>
        </View>
      ) : null}
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
  // `flexWrap`: con un 4to/5to conteo las celdas pasan de 4 a 6 o 7 y en un
  // teléfono angosto no entran en una fila. `minWidth` evita que se aplasten
  // hasta volverse ilegibles antes de saltar de línea.
  grilla: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  celda: {
    flexGrow: 1,
    flexBasis: 54,
    minWidth: 54,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.esperaSuave,
  },
  celdaOk: { backgroundColor: colors.okSuave },
  celdaInerte: { opacity: 0.42 },
  celdaEtiqueta: { fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.grisClaro, fontFamily: fonts.bold },
  celdaValor: { fontSize: fontSize.sm + 1, color: colors.tinta, fontFamily: fonts.semibold },
  nota: { fontSize: 12.5, fontFamily: fonts.semibold, lineHeight: 17 },
  /**
   * El cuadro. Fondo NEUTRO por default y de ATENCIÓN (`proceso`) solo cuando
   * va al personal: de los tres destinos, ese es el único que le saca plata a
   * alguien, y es el que el Auditor tiene que ver de un vistazo en una lista
   * de cientos. El rojo de marca no entra acá — es la acción, no un estado.
   */
  cuadro: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: radius.sm, backgroundColor: colors.esperaSuave },
  cuadroPersonal: { backgroundColor: colors.procesoSuave },
  cuadroTexto: { fontSize: 12, lineHeight: 17, color: colors.gris, fontFamily: fonts.bold },
  cuadroTextoPersonal: { color: colors.proceso },
  cuadroPorQue: { fontFamily: fonts.regular, color: colors.gris },
});
