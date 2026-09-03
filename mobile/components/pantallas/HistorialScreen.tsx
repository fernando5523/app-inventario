import { useFocusEffect } from 'expo-router';
import { ChevronLeft, History, Lock } from 'lucide-react-native';
import { useCallback, useState, type JSX } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { repositorioHistorial } from '../../lib/contenedor';
import type { Rol } from '../../lib/dominio/tipos';
import type {
  DetalleInventarioHistorico,
  EstadoInventario,
  InventarioHistorico,
} from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, radius, spacing } from '../../lib/theme';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';
import {
  Badge,
  type BadgeVariant,
  BarraApp,
  ChipsFiltro,
  EmptyState,
  formatoFecha,
  formatoFechaHora,
  formatoMiles,
  formatoMoneda,
  formatoPct,
  MESES_CORTOS,
  type OpcionChip,
} from '../ui';

/**
 * Cada estado del ciclo de vida, con lo único que importa a nivel visual:
 * si está SELLADO o todavía se puede tocar.
 *
 * `sellado` no es cosmética. Es la diferencia entre "esto ya es historia" y
 * "esto todavía se puede modificar", y es lo que decide el borde de la
 * tarjeta, el candado y la franja del folio — tres señales que dicen lo
 * mismo, porque en una lista que se escanea de un vistazo el ojo lee la
 * forma antes que la palabra.
 */
const ESTADOS: Record<EstadoInventario, { etiqueta: string; badge: BadgeVariant; sellado: boolean }> = {
  en_curso: { etiqueta: 'En curso', badge: 'proceso', sellado: false },
  conteo_cerrado: { etiqueta: 'Conteo cerrado', badge: 'default', sellado: false },
  liquidado: { etiqueta: 'Liquidado', badge: 'default', sellado: false },
  lacrado: { etiqueta: 'Lacrado', badge: 'ok', sellado: true },
  anulado: { etiqueta: 'Anulado', badge: 'espera', sellado: false },
};

const FILTROS: { clave: EstadoInventario | 'todos'; etiqueta: string }[] = [
  { clave: 'todos', etiqueta: 'Todos' },
  { clave: 'en_curso', etiqueta: 'En curso' },
  { clave: 'conteo_cerrado', etiqueta: 'Conteo cerrado' },
  { clave: 'liquidado', etiqueta: 'Liquidado' },
  { clave: 'lacrado', etiqueta: 'Lacrado' },
];

export interface HistorialScreenProps {
  rol: Extract<Rol, 'administrador' | 'auditor'>;
}

/**
 * Historial de inventarios (mobile/design/historial.html) — el registro de
 * todos los inventarios: en qué estado está cada uno, cómo cerró y quién lo
 * firmó. Responde la pregunta del cliente: *"falta el registro de todos los
 * inventarios, dónde llevaremos el control y el histórico"*.
 *
 * Un solo componente para Administrador y Auditor (mismo criterio que
 * UsuariosScreen): la diferencia es el ALCANCE — el Administrador ve las 4
 * sucursales, el Auditor solo la suya. El recorte real lo aplica el backend
 * (historial.permisos.ts); acá se manda el filtro para no pedir de más y
 * para que la barra de contexto diga la verdad sobre qué se está viendo.
 *
 * SOLO lectura. Firmar y lacrar viven en app/auditor/lacrado.tsx, donde el
 * control de dos personas ya está resuelto: un histórico que además escribe
 * es un histórico que se puede reescribir.
 */
export function HistorialScreen({ rol }: HistorialScreenProps): JSX.Element {
  const { sesion } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inventarios, setInventarios] = useState<InventarioHistorico[]>([]);
  const [filtro, setFiltro] = useState<EstadoInventario | 'todos'>('todos');

  const [detalle, setDetalle] = useState<DetalleInventarioHistorico | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  const cargar = useCallback(async () => {
    if (!sesion) return;
    setError(null);
    try {
      // El Auditor pide SU sucursal. El backend igual lo recorta si mandara
      // otra, pero pedir de más y descartar en la pantalla sería traer datos
      // que esta sesión no tiene por qué recibir.
      const sucursalId = rol === 'auditor' ? sesion.sucursal!.id : undefined;
      const pagina = await repositorioHistorial.listar({ sucursalId });
      setInventarios(pagina.inventarios);
    } catch (e) {
      // No hay adaptador en memoria a propósito (ver contenedor.ts): sin
      // backend se dice que no se pudo cargar. Un histórico inventado es
      // peor que una pantalla vacía.
      setError(e instanceof Error ? e.message : 'No se pudo cargar el historial.');
    } finally {
      setCargando(false);
    }
  }, [sesion, rol]);

  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar]),
  );

  async function abrirDetalle(id: number): Promise<void> {
    setCargandoDetalle(true);
    try {
      setDetalle(await repositorioHistorial.detalle(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el inventario.');
    } finally {
      setCargandoDetalle(false);
    }
  }

  if (!sesion) return <View />;

  const visibles = inventarios.filter((i) => filtro === 'todos' || i.estado === filtro);
  const lacrados = inventarios.filter((i) => i.estado === 'lacrado').length;

  const opcionesChip: OpcionChip[] = FILTROS.map((f) => ({
    id: f.clave,
    etiqueta: `${f.etiqueta} (${f.clave === 'todos' ? inventarios.length : inventarios.filter((i) => i.estado === f.clave).length})`,
  }));

  // ---------------------------------------------------------------- detalle
  if (detalle) {
    const est = ESTADOS[detalle.estado];
    const r = detalle.resultado;
    return (
      <PantallaConTabs scrollable contentStyle={styles.contenido}>
        <BarraApp rotulo="Historial" sede={detalle.sucursalNombre} cifras={detalle.periodo} />

        <Pressable style={styles.volver} onPress={() => setDetalle(null)} accessibilityRole="button">
          <ChevronLeft size={15} color={colors.rojo} />
          <Text style={styles.volverTexto}>Volver al historial</Text>
        </Pressable>

        <View style={styles.tarjeta}>
          <View style={styles.tarjetaCabecera}>
            <Text style={styles.tarjetaTitulo}>
              {MESES_CORTOS[detalle.periodoMes - 1]} {detalle.periodoAnio}
            </Text>
            <Badge label={est.etiqueta} variant={est.badge} />
          </View>
          <Text style={styles.ayuda}>
            {formatoMiles(detalle.snapshotItems)} ítems
            {detalle.tamanoHoja ? ` · hojas de ${detalle.tamanoHoja}` : ''}
            {detalle.cerradoEn ? ` · conteo cerrado el ${formatoFecha(detalle.cerradoEn)}` : ' · conteo todavía abierto'}
            {detalle.cerradoPor ? ` por ${detalle.cerradoPor.nombre}` : ''}
          </Text>
        </View>

        <Text style={styles.seccion}>Resultado del ciclo</Text>
        <View style={styles.tarjeta}>
          {r ? (
            <>
              <Dato etiqueta="Ítems totales" valor={formatoMiles(r.itemsTotales)} />
              <Dato etiqueta="Ítems cuadrados" valor={`${formatoMiles(r.itemsCuadrados)} (${formatoPct(r.porcentajeCuadrado)}%)`} tono="ok" />
              <Dato etiqueta="Ítems con diferencia" valor={formatoMiles(r.itemsConDiferencia)} tono="falta" />
              {r.itemsSegundoConteo !== undefined ? (
                <Dato etiqueta="Fueron a 2º conteo" valor={formatoMiles(r.itemsSegundoConteo)} />
              ) : null}
              {r.itemsTercerConteo !== undefined ? (
                <Dato etiqueta="Fueron a 3º conteo" valor={formatoMiles(r.itemsTercerConteo)} />
              ) : null}
              {r.unidadesFaltantes !== undefined ? (
                <Dato etiqueta="Unidades faltantes" valor={formatoMiles(r.unidadesFaltantes)} tono="falta" />
              ) : null}
              {r.unidadesSobrantes !== undefined ? (
                <Dato etiqueta="Unidades sobrantes" valor={formatoMiles(r.unidadesSobrantes)} />
              ) : null}
              <Dato etiqueta="Faltante bruto" valor={`S/ ${formatoMoneda(r.montoFaltanteBruto)}`} />
              {/* null NO es 0: "todavía no se liquidó" y "no falta nada" son
                  cosas distintas, y confundirlas en un inventario es grave. */}
              <Dato
                etiqueta="Faltante neto"
                valor={r.montoFaltanteNeto === null ? 'Sin liquidar todavía' : `S/ ${formatoMoneda(r.montoFaltanteNeto)}`}
                tono={r.montoFaltanteNeto === null ? undefined : 'falta'}
              />
              <Dato
                etiqueta="Cuota por colaborador"
                valor={r.cuotaBase === null ? 'Sin liquidar todavía' : `S/ ${formatoMoneda(r.cuotaBase)}`}
              />
            </>
          ) : (
              <Text style={styles.sinDatos}>{sinResultado(detalle.estado)}</Text>
          )}
        </View>

        <Text style={styles.seccion}>Hojas de conteo</Text>
        <View style={styles.tarjeta}>
          {detalle.hojas.length === 0 ? (
            <Text style={styles.sinDatos}>Este inventario no tiene el detalle de hojas guardado.</Text>
          ) : (
            detalle.hojas.map((h) => (
              <View key={h.id} style={styles.hojaMini}>
                <Text style={styles.hojaMiniTitulo}>
                  Hoja #{h.numero}
                  {h.zona ? ` · Zona ${h.zona}` : ''}
                  {h.gondola ? ` · Góndola ${h.gondola}` : ''}
                </Text>
                <Text style={styles.hojaMiniMeta}>
                  {h.contados}/{h.productos} · {h.asignados.map((a) => a.nombre).join(', ') || 'Sin asignar'}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* Que este bloque exista o no es, en sí mismo, la señal más fuerte:
            un inventario que todavía se puede tocar no tiene sello, ni folio,
            ni firmas que mostrar. */}
        {detalle.lacrado ? (
          <>
            <Text style={styles.seccion}>Lacrado</Text>
            <View style={styles.tarjeta}>
              <View style={styles.tarjetaCabecera}>
                <Lock size={17} color={colors.rojo} />
                <Text style={styles.tarjetaTitulo}>Sello inmutable</Text>
              </View>
              <Dato etiqueta="Folio" valor={detalle.lacrado.folio} />
              <Dato etiqueta="Lacrado el" valor={formatoFechaHora(detalle.lacrado.lacradoEn)} />
              <Dato etiqueta="Ejecutado por" valor={detalle.lacrado.lacradoPor.nombre} />
              <Text style={styles.ayuda}>
                Huella SHA-256 del contenido del cierre. Sirve para cotejar contra el acta: si el dato cambiara, el
                hash recalculado no coincidiría.
              </Text>
              <Text style={styles.hash}>{detalle.lacrado.hash}</Text>
            </View>

            <Text style={styles.seccion}>Doble validación</Text>
            <View style={styles.tarjeta}>
              <Text style={styles.ayuda}>
                Las dos firmas que habilitaron el lacrado. El rol es el que la persona tenía{' '}
                <Text style={styles.negrita}>al firmar</Text>: si después cambia de rol, la firma sigue diciendo con
                qué autoridad se dio.
              </Text>
              {detalle.aprobaciones.map((a) => (
                <View key={a.aprobadorId} style={styles.firma}>
                  <Text style={styles.firmaNombre}>{a.aprobadorNombre}</Text>
                  <Text style={styles.firmaMeta}>
                    {ESTADOS_ROL(a.rolAlAprobar)} al firmar · {formatoFechaHora(a.aprobadoEn)}
                  </Text>
                  {a.nota ? <Text style={styles.firmaNota}>“{a.nota}”</Text> : null}
                </View>
              ))}
            </View>

            <Text style={styles.seccion}>Registro en Dynamics</Text>
            <View style={styles.tarjeta}>
              <Text style={styles.ayuda}>
                {detalle.lacrado.registroErp
                  ? `Registrado a mano en Dynamics por ${detalle.lacrado.registroErp.registradoPor.nombre} el ${formatoFecha(detalle.lacrado.registroErp.registradoEn)} · referencia ${detalle.lacrado.registroErp.referencia}.`
                  : 'Todavía no se registró en Dynamics. El ajuste automático es fase 2: por ahora lo carga TI a mano.'}
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.tarjeta}>
            <View style={styles.tarjetaCabecera}>
              <Text style={styles.tarjetaTitulo}>Todavía no está lacrado</Text>
              <Badge label={`${detalle.aprobaciones.length} / 2 firmado`} variant={detalle.aprobaciones.length >= 2 ? 'ok' : 'default'} />
            </View>
            <Text style={styles.ayuda}>
              {detalle.estado === 'en_curso'
                ? 'El conteo sigue abierto: este inventario todavía se puede modificar. El lacrado llega al final del ciclo, con las dos firmas de auditoría.'
                : `Este inventario ya no se recuenta, pero todavía no está sellado: faltan ${2 - detalle.aprobaciones.length} de las 2 firmas de auditoría. Hasta que se lacre, sigue siendo modificable.`}
            </Text>
          </View>
        )}
      </PantallaConTabs>
    );
  }

  // ------------------------------------------------------------------ lista
  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <BarraApp
        rotulo="Historial"
        sede={rol === 'auditor' ? sesion.sucursal!.nombre : undefined}
        cifras={`${inventarios.length} inventario${inventarios.length === 1 ? '' : 's'} · ${lacrados} lacrado${lacrados === 1 ? '' : 's'}`}
      />

      {cargando || cargandoDetalle ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : error ? (
        <View style={styles.tarjeta}>
          <Text style={styles.tarjetaTitulo}>No se pudo cargar el historial</Text>
          <Text style={styles.ayuda}>{error}</Text>
          <Text style={styles.ayuda}>
            El histórico se lee del servidor y no tiene copia local: es el registro de lo que ya pasó, y un histórico
            armado en el teléfono no sería un registro.
          </Text>
        </View>
      ) : (
        <>
          <ChipsFiltro opciones={opcionesChip} activo={filtro} onCambiar={(id) => setFiltro(id as EstadoInventario | 'todos')} />

          {visibles.length === 0 ? (
            <EmptyState icon={History} title="Ningún inventario en este estado" subtitle="Probá con otro filtro." />
          ) : (
            <ScrollView horizontal={false} scrollEnabled={false} contentContainerStyle={styles.lista}>
              {visibles.map((inv) => (
                <TarjetaInventario key={inv.id} inventario={inv} onAbrir={() => abrirDetalle(inv.id)} />
              ))}
            </ScrollView>
          )}
        </>
      )}
    </PantallaConTabs>
  );
}

/**
 * Por qué este inventario no tiene cifras todavía.
 *
 * El backend devuelve `resultado: null` hasta que se liquida, así que un
 * `conteo_cerrado` llega sin números igual que uno `en_curso` — pero por
 * motivos distintos, y decir "conteo en marcha" sobre un conteo que YA
 * cerró es informar mal sobre en qué punto del ciclo está el mes.
 */
function sinResultado(estado: EstadoInventario): string {
  if (estado === 'en_curso') return 'Conteo en marcha: los resultados se calculan al cerrar el ciclo.';
  if (estado === 'conteo_cerrado') return 'Conteo cerrado. Las cifras se calculan al liquidar.';
  if (estado === 'anulado') return 'Inventario anulado: no produjo resultados.';
  return 'Sin resultados calculados.';
}

/** El rol congelado al firmar, capitalizado para mostrar. */
function ESTADOS_ROL(rol: Rol): string {
  return rol.charAt(0).toUpperCase() + rol.slice(1);
}

function Dato({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: 'ok' | 'falta' }): JSX.Element {
  return (
    <View style={styles.dato}>
      <Text style={styles.datoEtiqueta}>{etiqueta}</Text>
      <Text style={[styles.datoValor, tono === 'ok' && styles.datoOk, tono === 'falta' && styles.datoFalta]}>{valor}</Text>
    </View>
  );
}

function TarjetaInventario({ inventario, onAbrir }: { inventario: InventarioHistorico; onAbrir: () => void }): JSX.Element {
  const est = ESTADOS[inventario.estado];
  const r = inventario.resultado;

  return (
    // Borde PUNTEADO = todavía se puede tocar. SÓLIDO y verde = sellado.
    // La forma se lee antes que la palabra.
    <View style={[styles.inv, est.sellado ? styles.invSellado : styles.invAbierto]}>
      <View style={styles.invCuerpo}>
        <View style={styles.invCabecera}>
          <View style={[styles.invPeriodo, est.sellado && styles.invPeriodoSellado]}>
            <Text style={[styles.invMes, est.sellado && styles.invPeriodoTextoSellado]}>
              {MESES_CORTOS[inventario.periodoMes - 1]}
            </Text>
            <Text style={[styles.invAnio, est.sellado && styles.invPeriodoTextoSellado]}>{inventario.periodoAnio}</Text>
          </View>

          <View style={styles.invDatos}>
            <View style={styles.invTitulo}>
              <Text style={styles.invSede}>{inventario.sucursalNombre}</Text>
              {est.sellado ? <Lock size={13} color={colors.ok} /> : null}
              <Badge label={est.etiqueta} variant={est.badge} />
            </View>
            <Text style={styles.invMeta}>
              {formatoMiles(inventario.snapshotItems)} ítems
              {inventario.tamanoHoja ? ` · hojas de ${inventario.tamanoHoja}` : ''}
              {inventario.cerradoEn ? ` · cerrado el ${formatoFecha(inventario.cerradoEn)}` : ' · sin cerrar'}
            </Text>
          </View>
        </View>

        {r ? (
          <View style={styles.invCifras}>
            <Cifra etiqueta="Ítems cuadrados" valor={`${formatoMiles(r.itemsCuadrados)} (${formatoPct(r.porcentajeCuadrado)}%)`} tono="ok" />
            <Cifra etiqueta="Con diferencia" valor={formatoMiles(r.itemsConDiferencia)} tono="falta" />
            <Cifra etiqueta="Faltante bruto" valor={`S/ ${formatoMoneda(r.montoFaltanteBruto)}`} />
            <Cifra
              etiqueta="Faltante neto"
              valor={r.montoFaltanteNeto === null ? 'Sin liquidar' : `S/ ${formatoMoneda(r.montoFaltanteNeto)}`}
              tono={r.montoFaltanteNeto === null ? undefined : 'falta'}
            />
          </View>
        ) : (
          <Text style={styles.sinDatos}>{sinResultado(inventario.estado)}</Text>
        )}
      </View>

      {/* La franja del folio SOLO existe en un lacrado: no hay folio hasta
          que hay sello. Es la señal más honesta de todas. */}
      {inventario.folio ? (
        <View style={styles.invSello}>
          <Lock size={14} color={colors.ok} />
          <Text style={styles.invFolio}>{inventario.folio}</Text>
        </View>
      ) : null}

      <View style={styles.invPie}>
        <Text style={styles.invPieTexto}>
          {inventario.folio ? 'Firmado por 2 auditores' : `${inventario.aprobaciones} / 2 firmas`}
        </Text>
        <Pressable onPress={onAbrir} accessibilityRole="button">
          <Text style={styles.invAbrir}>Ver detalle</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Cifra({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: 'ok' | 'falta' }): JSX.Element {
  return (
    <View style={styles.cifra}>
      <Text style={styles.cifraEtiqueta}>{etiqueta}</Text>
      <Text style={[styles.cifraValor, tono === 'ok' && styles.datoOk, tono === 'falta' && styles.datoFalta]}>{valor}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: 14, paddingTop: 8, gap: 14 },
  cargando: { marginTop: 24 },

  tarjeta: { gap: 10, padding: 15, backgroundColor: colors.campo, borderWidth: 1, borderColor: colors.borde, borderRadius: 13 },
  tarjetaCabecera: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tarjetaTitulo: { flex: 1, fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
  ayuda: { fontSize: 12.5, lineHeight: 17.5, color: colors.gris, fontFamily: fonts.regular },
  negrita: { fontFamily: fonts.bold, color: colors.tinta },
  sinDatos: { fontSize: 12, color: colors.grisClaro, fontFamily: fonts.regular, fontStyle: 'italic' },
  seccion: { fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gris, fontFamily: fonts.semibold },

  lista: { gap: 11 },
  inv: { backgroundColor: colors.campo, borderWidth: 1, borderColor: colors.borde, borderRadius: 13, overflow: 'hidden' },
  invAbierto: { borderStyle: 'dashed', borderColor: '#C9C1BB' },
  invSellado: { borderStyle: 'solid', borderWidth: 1.5, borderColor: 'rgba(10,107,87,0.45)' },
  invCuerpo: { gap: 10, padding: 13 },
  invCabecera: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  invPeriodo: {
    minWidth: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 9,
    backgroundColor: colors.esperaSuave,
  },
  invPeriodoSellado: { backgroundColor: colors.okSuave },
  invMes: { fontSize: 13, letterSpacing: 0.5, color: colors.espera, fontFamily: fonts.bold },
  invAnio: { fontSize: 10.5, color: colors.espera, fontFamily: fonts.semibold },
  invPeriodoTextoSellado: { color: colors.ok },
  invDatos: { flex: 1, minWidth: 0, gap: 4 },
  invTitulo: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  invSede: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.bold },
  invMeta: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },

  invCifras: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 7, columnGap: 12 },
  cifra: { width: '46%', gap: 1 },
  cifraEtiqueta: { fontSize: 10.5, color: colors.gris, fontFamily: fonts.regular },
  cifraValor: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.bold },

  invSello: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 14,
    backgroundColor: colors.okSuave,
    borderTopWidth: 1,
    borderTopColor: 'rgba(10,107,87,0.2)',
  },
  invFolio: { flex: 1, fontSize: 11.5, color: colors.ok, fontFamily: fonts.bold },
  invPie: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borde,
  },
  invPieTexto: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },
  invAbrir: { fontSize: 12.5, color: colors.rojo, fontFamily: fonts.bold },

  volver: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  volverTexto: { fontSize: 13, color: colors.rojo, fontFamily: fonts.semibold },

  dato: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: colors.borde,
  },
  datoEtiqueta: { flex: 1, fontSize: 12, color: colors.gris, fontFamily: fonts.regular },
  datoValor: { fontSize: 13, color: colors.tinta, fontFamily: fonts.bold },
  datoOk: { color: colors.ok },
  datoFalta: { color: colors.falta },

  hash: {
    padding: 9,
    borderRadius: radius.sm,
    backgroundColor: colors.esperaSuave,
    fontSize: 10.5,
    lineHeight: 16,
    color: colors.gris,
    fontFamily: 'monospace',
  },

  firma: { gap: 2, padding: 10, borderRadius: radius.md, backgroundColor: colors.okSuave },
  firmaNombre: { fontSize: 13, color: colors.tinta, fontFamily: fonts.bold },
  firmaMeta: { fontSize: 11, color: colors.gris, fontFamily: fonts.regular },
  firmaNota: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular, fontStyle: 'italic' },

  hojaMini: { gap: 2, paddingVertical: 9, paddingHorizontal: 11, borderWidth: 1, borderColor: colors.borde, borderRadius: radius.md },
  hojaMiniTitulo: { fontSize: 12.5, color: colors.tinta, fontFamily: fonts.semibold },
  hojaMiniMeta: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },
});
