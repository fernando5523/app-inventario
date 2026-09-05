import { router, useFocusEffect } from 'expo-router';
import { ChevronLeft, History, Lock, ShieldAlert, ShieldCheck, TrendingUp } from 'lucide-react-native';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { repositorioHistorial, repositorioSesion } from '../../lib/contenedor';
import type { Rol, Sucursal } from '../../lib/dominio/tipos';
import type {
  DetalleInventarioHistorico,
  DiferenciaHistorica,
  EstadoInventario,
  HistoricoItem,
  InventarioHistorico,
  LiquidacionInventario,
  ResultadoInventario,
  SeccionSellada,
  VerificacionSello,
} from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, radius, spacing } from '../../lib/theme';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';
import {
  Badge,
  type BadgeVariant,
  BarraApp,
  Button,
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

/** Cuántos inventarios se piden por página — ver `cargar`/`cargarMas`. */
const TAMANO_PAGINA = 20;

/** Sentinel de chip para "sin filtro de esta dimensión" — nunca un id real. */
const TODAS = 'todas';
const TODOS = 'todos';

/**
 * Años que se ofrecen para filtrar por período. No hay un endpoint que
 * diga "qué años tienen inventarios" — se ofrece el actual y los 3
 * anteriores, rango razonable para un sistema que recién empezó a operar.
 */
function aniosDisponibles(): number[] {
  const actual = new Date().getFullYear();
  return [actual, actual - 1, actual - 2, actual - 3];
}

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

/**
 * Orden en que se listan las secciones alteradas: primero las tres que
 * cubre el sello sustantivamente (resultado, diferencias, planilla — la
 * regla del cliente de liquidar antes de lacrar), después el control de
 * dos personas, y al final la metadata agrupada.
 */
const ORDEN_SECCIONES: SeccionSellada[] = ['resultado', 'diferencias', 'planilla', 'aprobaciones', 'datosDelInventario'];

const NOMBRE_SECCION: Record<SeccionSellada, string> = {
  resultado: 'Resultado del ciclo',
  diferencias: 'Diferencias detectadas',
  planilla: 'Planilla (liquidación)',
  aprobaciones: 'Firmas de aprobación',
  datosDelInventario: 'Datos del inventario (sucursal, período, hojas)',
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
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inventarios, setInventarios] = useState<InventarioHistorico[]>([]);
  const [total, setTotal] = useState(0);
  const [desplazamiento, setDesplazamiento] = useState(0);
  const [filtro, setFiltro] = useState<EstadoInventario | 'todos'>('todos');

  // Solo el Administrador elige sucursal: el Auditor queda recortado a la
  // suya por el backend (historial.permisos.ts#resolverSucursalConsultable),
  // así que ofrecerle el control sería una elección sin efecto.
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [filtroSucursalId, setFiltroSucursalId] = useState<number | typeof TODAS>(TODAS);

  // Período: año primero, mes solo tiene sentido una vez elegido un año —
  // filtrar por mes sin año mezclaría "marzo de cualquier año".
  const [filtroAnio, setFiltroAnio] = useState<number | null>(null);
  const [filtroMes, setFiltroMes] = useState<number | null>(null);

  const [detalle, setDetalle] = useState<DetalleInventarioHistorico | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  const [verificacion, setVerificacion] = useState<VerificacionSello | null>(null);
  const [verificandoSello, setVerificandoSello] = useState(false);
  const [errorVerificacion, setErrorVerificacion] = useState<string | null>(null);

  const [diferencias, setDiferencias] = useState<DiferenciaHistorica[]>([]);
  const [liquidacion, setLiquidacion] = useState<LiquidacionInventario | null>(null);
  const [errorCierre, setErrorCierre] = useState<string | null>(null);

  // Historia de un ítem — tercer nivel dentro del mismo componente (mismo
  // criterio que `detalle`): se abre desde una fila de Diferencias y vuelve
  // al detalle, no a la lista.
  const [historicoItem, setHistoricoItem] = useState<HistoricoItem | null>(null);
  const [cargandoHistoricoItem, setCargandoHistoricoItem] = useState(false);

  // Se pide una sola vez, no en cada refresco del historial: el padrón de
  // sucursales no cambia entre pantallazos (mismo criterio que el modoAdmin
  // del login, que trae administradores() recién al entrar a ese modo).
  useEffect(() => {
    if (rol !== 'administrador') return;
    repositorioSesion.sucursales().then(setSucursales);
  }, [rol]);

  // El filtro completo de la pantalla, en la forma que pide el puerto. Un
  // solo lugar arma esto: `cargar()` (primera página) y `cargarMas()` (la
  // siguiente) tienen que mandar EXACTAMENTE los mismos filtros — si no,
  // "cargar más" podría traer una página de un filtro distinto al que se ve.
  const filtroActual = useCallback(
    (desplazamientoPedido: number) => ({
      sucursalId: rol === 'auditor' ? sesion!.sucursal!.id : filtroSucursalId === TODAS ? undefined : filtroSucursalId,
      estado: filtro === TODOS ? undefined : filtro,
      periodoAnio: filtroAnio ?? undefined,
      periodoMes: filtroAnio !== null ? (filtroMes ?? undefined) : undefined,
      limite: TAMANO_PAGINA,
      desplazamiento: desplazamientoPedido,
    }),
    [rol, sesion, filtroSucursalId, filtro, filtroAnio, filtroMes],
  );

  // Trae la PRIMERA página, con los filtros actuales — reemplaza la lista.
  // El estado (chip) y el período (año/mes) se filtran del lado del
  // SERVIDOR, no sobre lo ya cargado: con paginación real, filtrar client-
  // side sobre una página parcial escondería resultados que existen pero
  // todavía no se pidieron (ver historial-como-registro.md, punto 3).
  const cargar = useCallback(async () => {
    if (!sesion) return;
    setError(null);
    setCargando(true);
    try {
      const pagina = await repositorioHistorial.listar(filtroActual(0));
      setInventarios(pagina.inventarios);
      setTotal(pagina.total);
      setDesplazamiento(0);
    } catch (e) {
      // No hay adaptador en memoria a propósito (ver contenedor.ts): sin
      // backend se dice que no se pudo cargar. Un histórico inventado es
      // peor que una pantalla vacía.
      setError(e instanceof Error ? e.message : 'No se pudo cargar el historial.');
    } finally {
      setCargando(false);
    }
  }, [sesion, filtroActual]);

  // Trae la página SIGUIENTE y la agrega al final — nunca reemplaza lo que
  // ya está en pantalla ni reinicia el desplazamiento.
  async function cargarMas(): Promise<void> {
    if (cargandoMas) return;
    setCargandoMas(true);
    try {
      const siguiente = desplazamiento + TAMANO_PAGINA;
      const pagina = await repositorioHistorial.listar(filtroActual(siguiente));
      setInventarios((actuales) => [...actuales, ...pagina.inventarios]);
      setTotal(pagina.total);
      setDesplazamiento(siguiente);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo traer más inventarios.');
    } finally {
      setCargandoMas(false);
    }
  }

  // `cargar` cambia de identidad cada vez que cambia un filtro (está en sus
  // deps vía `filtroActual`) — React Navigation vuelve a correr este efecto
  // cuando eso pasa, aunque la pantalla siga enfocada. Es lo que hace que
  // tocar un chip dispare una consulta nueva sin tener que salir y volver.
  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar]),
  );

  async function abrirDetalle(id: number): Promise<void> {
    setCargandoDetalle(true);
    // Un inventario nuevo no hereda nada del anterior.
    setVerificacion(null);
    setErrorVerificacion(null);
    setDiferencias([]);
    setLiquidacion(null);
    setErrorCierre(null);
    setHistoricoItem(null);
    try {
      const det = await repositorioHistorial.detalle(id);
      setDetalle(det);
      // "En curso" todavía no cerró el conteo: no hay diferencias fijadas
      // (recién se calculan al cerrar la última ronda) ni planilla (se
      // liquida después de cerrar). Pedirlas ahí solo traería listas vacías.
      if (det.estado !== 'en_curso') {
        try {
          const [difs, liq] = await Promise.all([repositorioHistorial.diferencias(id), repositorioHistorial.liquidacion(id)]);
          setDiferencias(difs);
          setLiquidacion(liq);
        } catch (e) {
          // El detalle YA cargó bien: un fallo acá no debe tirar abajo toda
          // la pantalla, solo estas dos secciones.
          setErrorCierre(e instanceof Error ? e.message : 'No se pudieron cargar las diferencias y la planilla.');
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el inventario.');
    } finally {
      setCargandoDetalle(false);
    }
  }

  async function verificarSello(): Promise<void> {
    if (!detalle) return;
    setVerificandoSello(true);
    setErrorVerificacion(null);
    try {
      setVerificacion(await repositorioHistorial.verificarSello(detalle.id));
    } catch (e) {
      setErrorVerificacion(e instanceof Error ? e.message : 'No se pudo verificar el sello.');
    } finally {
      setVerificandoSello(false);
    }
  }

  // `sucursalId` del inventario que se está mirando: recorta la historia a
  // ESA sucursal para el Administrador (igual que en el resto de la
  // pantalla, no trae de más), y para el Auditor no cambia nada -- el
  // backend ya lo recorta a la suya sin importar qué se mande.
  async function abrirHistoricoItem(codigo: string): Promise<void> {
    if (!detalle) return;
    setCargandoHistoricoItem(true);
    try {
      setHistoricoItem(await repositorioHistorial.historicoDeItem(codigo, { sucursalId: detalle.sucursalId }));
    } catch (e) {
      // No hay un tercer nivel de pantalla que mostrar si esto falla (a
      // diferencia de `error`/`errorCierre`, que sí tienen su bloque en el
      // detalle) — es una acción puntual de tocar una fila, mismo criterio
      // que el resto de la app para una acción que puede fallar (login,
      // reseteo de PIN): un Alert, no un estado de pantalla nuevo.
      Alert.alert('No se pudo abrir la historia', e instanceof Error ? e.message : 'Intentá de nuevo.');
    } finally {
      setCargandoHistoricoItem(false);
    }
  }

  if (!sesion) return <View />;

  // Sin contador por chip a propósito: con el filtro resuelto en el
  // SERVIDOR (no sobre lo ya cargado), contar "cuántos lacrados hay" exigiría
  // una consulta aparte por cada chip solo para mostrar un número — más
  // ruido que ayuda. El total real de la vista actual ya se ve en "X de Y".
  const opcionesChip: OpcionChip[] = FILTROS.map((f) => ({ id: f.clave, etiqueta: f.etiqueta }));

  const opcionesSucursal: OpcionChip[] = [
    { id: TODAS, etiqueta: 'Todas' },
    ...sucursales.map((s) => ({ id: String(s.id), etiqueta: s.nombre })),
  ];

  const opcionesAnio: OpcionChip[] = [
    { id: TODOS, etiqueta: 'Todos' },
    ...aniosDisponibles().map((a) => ({ id: String(a), etiqueta: String(a) })),
  ];
  const opcionesMes: OpcionChip[] = [
    { id: TODOS, etiqueta: 'Todo el año' },
    ...MESES_CORTOS.map((m, i) => ({ id: String(i + 1), etiqueta: m })),
  ];

  // ------------------------------------------------------- historia de un ítem
  if (historicoItem) {
    const h = historicoItem;
    return (
      <PantallaConTabs scrollable contentStyle={styles.contenido}>
        <BarraApp rotulo="Historia del ítem" sede={h.codigo} cifras={h.descripcion ?? undefined} />

        <Pressable style={styles.volver} onPress={() => setHistoricoItem(null)} accessibilityRole="button">
          <ChevronLeft size={15} color={colors.rojo} />
          <Text style={styles.volverTexto}>Volver al inventario</Text>
        </Pressable>

        <View style={styles.tarjeta}>
          <Dato etiqueta="Apareció con diferencia" valor={`${h.resumen.veces} ${h.resumen.veces === 1 ? 'vez' : 'veces'}`} />
          <Dato etiqueta="Como faltante" valor={`${h.resumen.vecesFaltante} · ${formatoMiles(h.resumen.unidadesFaltantes)} und`} tono={h.resumen.vecesFaltante > 0 ? 'falta' : undefined} />
          <Dato etiqueta="Como sobrante" valor={`${h.resumen.vecesSobrante} · ${formatoMiles(h.resumen.unidadesSobrantes)} und`} />
          <Dato
            etiqueta="Monto acumulado"
            valor={`S/ ${formatoMoneda(Math.abs(h.resumen.montoAcumulado))} ${h.resumen.montoAcumulado < 0 ? 'en contra' : h.resumen.montoAcumulado > 0 ? 'a favor' : ''}`}
            tono={h.resumen.montoAcumulado < 0 ? 'falta' : undefined}
          />
          {h.resumen.peorPeriodo ? (
            <Dato
              etiqueta="Peor diferencia"
              valor={`${formatoMiles(Math.abs(h.resumen.peorPeriodo.diferencia))} und en ${MESES_CORTOS[h.resumen.peorPeriodo.mes - 1]} ${h.resumen.peorPeriodo.anio}`}
              tono="falta"
            />
          ) : null}
        </View>

        <Text style={styles.seccion}>Apariciones por período</Text>
        <View style={styles.tarjeta}>
          {h.apariciones.length === 0 ? (
            <Text style={styles.sinDatos}>Este código no tuvo diferencias en ningún inventario cerrado anterior.</Text>
          ) : (
            // Cronológico ascendente (mismo orden que manda el backend) —
            // se invierte para leer del más reciente hacia atrás.
            [...h.apariciones].reverse().map((a) => (
              <View key={a.inventarioId} style={styles.difFila}>
                <View style={styles.difCabecera}>
                  <Text style={styles.difCodigo}>
                    {MESES_CORTOS[a.periodoMes - 1]} {a.periodoAnio} · {a.sucursalNombre}
                  </Text>
                  <Badge label={a.diferencia < 0 ? 'Faltante' : 'Sobrante'} variant={a.diferencia < 0 ? 'falta' : 'ok'} />
                </View>
                <Text style={styles.difMeta}>
                  ERP {formatoMiles(a.stockSistema)} · contado {formatoMiles(a.conteoFinal)} · resuelto en el {a.resueltoEnConteo}º conteo
                </Text>
                <View style={styles.difValores}>
                  <Text style={[styles.difCifra, a.diferencia < 0 ? styles.datoFalta : styles.datoOk]}>
                    {formatoMiles(Math.abs(a.diferencia))} und
                  </Text>
                  <Text style={styles.difMonto}>
                    {a.montoDiferencia === null ? 'Sin precio para valorizar' : `S/ ${formatoMoneda(Math.abs(a.montoDiferencia))}`}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </PantallaConTabs>
    );
  }

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
            Creado el {formatoFecha(detalle.abiertoEn)} · {formatoMiles(detalle.snapshotItems)} ítems
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
                  cosas distintas, y confundirlas en un inventario es grave.
                  Y "sin liquidar todavía" tampoco es lo mismo que "el conteo
                  ya cerró pero falta un dato que hoy no se puede cargar" --
                  motivoSinNeto distingue las dos razones, no las une en un
                  mismo cartel. */}
              <Dato
                etiqueta="Faltante neto"
                valor={r.montoFaltanteNeto === null ? motivoSinNeto(r) : `S/ ${formatoMoneda(r.montoFaltanteNeto)}`}
                tono={r.montoFaltanteNeto === null ? undefined : 'falta'}
              />
              <Dato
                etiqueta="Cuota por colaborador"
                valor={r.cuotaBase === null ? motivoSinNeto(r) : `S/ ${formatoMoneda(r.cuotaBase)}`}
              />
            </>
          ) : (
              <Text style={styles.sinDatos}>{sinResultado(detalle.estado)}</Text>
          )}
        </View>

        {/* Igual que las diferencias: no existen hasta que se cierra el
            conteo (recién ahí se fija el resultado de los 3 conteos contra
            el ERP). "En curso" no las pide -- ver abrirDetalle. */}
        {detalle.estado !== 'en_curso' ? (
          <>
            <Text style={styles.seccion}>Diferencias</Text>
            <View style={styles.tarjeta}>
              {errorCierre ? (
                <Text style={styles.ayuda}>{errorCierre}</Text>
              ) : diferencias.length === 0 ? (
                <Text style={styles.sinDatos}>Sin diferencias: el conteo cuadró contra el ERP.</Text>
              ) : (
                // Ya vienen ordenadas por valor absoluto descendente (ver
                // historial-api.ts#aDiferencias): lo que más plata mueve arriba.
                diferencias.map((d) => (
                  <Pressable
                    key={d.codigo}
                    style={styles.difFila}
                    onPress={() => abrirHistoricoItem(d.codigo)}
                    disabled={cargandoHistoricoItem}
                    accessibilityRole="button"
                    accessibilityLabel={`Ver la historia de ${d.descripcion}`}
                  >
                    <View style={styles.difCabecera}>
                      <Text style={styles.difCodigo}>
                        {d.codigo} · {d.descripcion}
                      </Text>
                      <Badge label={d.tipo === 'faltante' ? 'Faltante' : 'Sobrante'} variant={d.tipo === 'faltante' ? 'falta' : 'ok'} />
                    </View>
                    <Text style={styles.difMeta}>
                      ERP {formatoMiles(d.stockSistema)} · contado {formatoMiles(d.conteoFinal)} · resuelto en el {d.resueltoEnConteo}º conteo
                    </Text>
                    <View style={styles.difValores}>
                      <Text style={[styles.difCifra, d.tipo === 'faltante' ? styles.datoFalta : styles.datoOk]}>
                        {formatoMiles(Math.abs(d.diferencia))} und
                      </Text>
                      <Text style={styles.difMonto}>
                        {d.montoDiferencia === null ? 'Sin precio para valorizar' : `S/ ${formatoMoneda(Math.abs(d.montoDiferencia))}`}
                      </Text>
                    </View>
                    <Text style={styles.difVerHistoria}>Ver historia de este ítem →</Text>
                  </Pressable>
                ))
              )}
            </View>
          </>
        ) : null}

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

        {/* Se liquida ANTES de lacrar (regla del cliente): un `conteo_cerrado`
            recién cerrado puede no tener planilla todavía -- la sección lo
            dice, no lo esconde. */}
        {detalle.estado !== 'en_curso' ? (
          <>
            <Text style={styles.seccion}>Planilla de liquidación</Text>
            <View style={styles.tarjeta}>
              {errorCierre ? (
                <Text style={styles.ayuda}>{errorCierre}</Text>
              ) : liquidacion === null ? (
                <Text style={styles.sinDatos}>Todavía no se liquidó este inventario.</Text>
              ) : liquidacion.planilla.length === 0 ? (
                <Text style={styles.sinDatos}>Todavía no se liquidó este inventario.</Text>
              ) : (
                <>
                  {liquidacion.resumen ? (
                    <>
                      <Dato etiqueta="Faltante neto a repartir" valor={`S/ ${formatoMoneda(liquidacion.resumen.montoFaltanteNeto)}`} tono="falta" />
                      <Dato etiqueta="Cuota base por colaborador" valor={`S/ ${formatoMoneda(liquidacion.resumen.cuotaBase)}`} />
                      {liquidacion.resumen.faltantes > 0 ? (
                        <Dato
                          etiqueta={`Multa por inasistencia (${liquidacion.resumen.faltantes})`}
                          valor={`S/ ${formatoMoneda(liquidacion.resumen.fondoMultas)}`}
                        />
                      ) : null}
                    </>
                  ) : (
                    // null NO es un resumen con ceros: falta un dato de captura,
                    // no falta plata. Mismo criterio que motivoSinNeto.
                    <Text style={styles.sinDatos}>
                      {liquidacion.asistenciaSinRegistrar && liquidacion.ajustesSinRegistrar
                        ? 'Falta registrar la asistencia y los ajustes del mes: el resumen no se puede calcular todavía.'
                        : liquidacion.asistenciaSinRegistrar
                          ? 'Falta registrar la asistencia: el resumen no se puede calcular todavía.'
                          : 'Faltan los ajustes del mes: el resumen no se puede calcular todavía.'}
                    </Text>
                  )}

                  {liquidacion.planilla.map((p) => (
                    <View key={p.colaboradorId} style={[styles.planillaFila, !p.asistio && styles.planillaFilaFalto]}>
                      <View style={styles.planillaDatos}>
                        <Text style={styles.planillaNombre}>{p.nombre}</Text>
                        <Text style={styles.planillaSub}>
                          {ESTADOS_ROL(p.rol)} · {p.asistio ? 'Asistió' : 'Faltó'}
                          {p.nombreActual !== p.nombre ? ` · ahora: ${p.nombreActual}` : ''}
                        </Text>
                      </View>
                      <Text style={[styles.planillaMonto, !p.asistio && styles.datoFalta]}>S/ {formatoMoneda(p.totalDescuento)}</Text>
                    </View>
                  ))}
                </>
              )}
            </View>
          </>
        ) : null}

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

              {/* Recalcula el hash contra el contenido ACTUAL y compara. No
                  muta nada -- es una lectura que compara, nunca una
                  escritura, por eso no hace falta ningún control de dos
                  personas para tocarla. */}
              <Pressable
                style={[styles.verificarBtn, verificandoSello && styles.verificarBtnDeshabilitado]}
                onPress={verificarSello}
                disabled={verificandoSello}
                accessibilityRole="button"
              >
                {verificandoSello ? (
                  <ActivityIndicator color={colors.blanco} size="small" />
                ) : (
                  <Text style={styles.verificarBtnTexto}>Verificar sello</Text>
                )}
              </Pressable>

              {errorVerificacion ? (
                <View style={styles.verifTarjeta}>
                  <Text style={styles.ayuda}>{errorVerificacion}</Text>
                </View>
              ) : null}

              {/* El resultado tiene que ser inequívoco: un "hash: a3f9..."
                  no le dice nada a nadie. Verde = nada cambió. Rojo = QUÉ
                  cambió, sección por sección, no solo que algo cambió. */}
              {verificacion ? (
                verificacion.intacto ? (
                  <View style={[styles.verifTarjeta, styles.verifOk]}>
                    <View style={styles.verifCabecera}>
                      <ShieldCheck size={18} color={colors.ok} />
                      <Text style={[styles.verifTitulo, styles.verifTituloOk]}>
                        El sello coincide: nada cambió desde el lacrado
                      </Text>
                    </View>
                    <Text style={styles.ayuda}>Verificado el {formatoFechaHora(verificacion.verificadoEn)}.</Text>
                  </View>
                ) : (
                  <View style={[styles.verifTarjeta, styles.verifAlerta]}>
                    <View style={styles.verifCabecera}>
                      <ShieldAlert size={18} color={colors.falta} />
                      <Text style={[styles.verifTitulo, styles.verifTituloAlerta]}>
                        El sello NO coincide: esto cambió desde el lacrado
                      </Text>
                    </View>
                    {ORDEN_SECCIONES.filter((s) => verificacion.seccionesAlteradas.includes(s)).map((s) => (
                      <Text key={s} style={styles.verifSeccion}>
                        • {NOMBRE_SECCION[s]}
                      </Text>
                    ))}
                    <Text style={styles.ayuda}>Verificado el {formatoFechaHora(verificacion.verificadoEn)}.</Text>
                  </View>
                )
              ) : null}

              {/* Aparte de intacto/alterado a propósito: si cambió el
                  FORMATO del contenido sellado (una migración del backend
                  entre el lacrado y hoy), la comparación campo por campo ya
                  no es 100% confiable aunque diga "intacto". Mezclarlo con
                  "alterado" confundiría un cambio de formato con una
                  manipulación real. */}
              {verificacion?.versionDistinta ? (
                <View style={[styles.verifTarjeta, styles.verifAdvertencia]}>
                  <Text style={styles.ayuda}>
                    El formato con el que se guarda el sello cambió desde que se lacró este inventario. La
                    comparación de arriba no es 100% concluyente: si hay dudas, contrastá el hash a mano contra el
                    acta.
                  </Text>
                </View>
              ) : null}
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
        cifras={cargando ? undefined : `Mostrando ${inventarios.length} de ${total} inventario${total === 1 ? '' : 's'}`}
      />

      {/* Botón en la cabecera, no una tarjeta más de "Tus accesos": el
          comparativo mira TODOS los períodos a la vez, es una vista distinta
          del mismo registro, no un inventario individual más para abrir. */}
      <Pressable
        style={styles.comparativoBtn}
        onPress={() => router.push(`/${rol}/comparativo` as never)}
        accessibilityRole="button"
        accessibilityLabel="Ver comparativo mensual"
      >
        <TrendingUp size={16} color={colors.rojo} />
        <Text style={styles.comparativoBtnTexto}>Comparativo mensual</Text>
      </Pressable>

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
          {/* El Auditor no ve esto: su alcance ya está fijo en su sucursal
              (el backend lo recorta igual si mandara otra), así que
              ofrecerle el control sería una elección sin ningún efecto. */}
          {rol === 'administrador' ? (
            <View style={styles.filtroBloque}>
              <Text style={styles.filtroLabel}>Sucursal</Text>
              <ChipsFiltro
                opciones={opcionesSucursal}
                activo={String(filtroSucursalId)}
                onCambiar={(id) => setFiltroSucursalId(id === TODAS ? TODAS : Number(id))}
              />
            </View>
          ) : null}

          <View style={styles.filtroBloque}>
            <Text style={styles.filtroLabel}>Estado</Text>
            <ChipsFiltro opciones={opcionesChip} activo={filtro} onCambiar={(id) => setFiltro(id as EstadoInventario | 'todos')} />
          </View>

          <View style={styles.filtroBloque}>
            <Text style={styles.filtroLabel}>Período</Text>
            <ChipsFiltro
              opciones={opcionesAnio}
              activo={filtroAnio === null ? TODOS : String(filtroAnio)}
              onCambiar={(id) => {
                setFiltroAnio(id === TODOS ? null : Number(id));
                // Cambiar de año invalida el mes elegido: "marzo de 2025"
                // no dice nada cuando se vuelve a "todos los años".
                setFiltroMes(null);
              }}
            />
            {/* El mes solo aparece con un año ya elegido — filtrar por mes
                sin año mezclaría todos los marzos de la historia en uno. */}
            {filtroAnio !== null ? (
              <ChipsFiltro
                opciones={opcionesMes}
                activo={filtroMes === null ? TODOS : String(filtroMes)}
                onCambiar={(id) => setFiltroMes(id === TODOS ? null : Number(id))}
              />
            ) : null}
          </View>

          {inventarios.length === 0 ? (
            <EmptyState icon={History} title="Ningún inventario con estos filtros" subtitle="Probá con otra combinación." />
          ) : (
            <ScrollView horizontal={false} scrollEnabled={false} contentContainerStyle={styles.lista}>
              {inventarios.map((inv) => (
                <TarjetaInventario key={inv.id} inventario={inv} onAbrir={() => abrirDetalle(inv.id)} />
              ))}
              {/* Nunca más un techo silencioso: mientras queden inventarios
                  sin traer para este filtro, el botón sigue ahí. */}
              {inventarios.length < total ? (
                <Button label={`Cargar más (${total - inventarios.length} restantes)`} variant="outline" loading={cargandoMas} onPress={cargarMas} />
              ) : null}
            </ScrollView>
          )}
        </>
      )}
    </PantallaConTabs>
  );
}

/**
 * Por qué este inventario no tiene NI SIQUIERA el bloque de resultado
 * (`r === null`) todavía.
 *
 * El backend calcula `ResultadoInventario` en el momento de cerrar el
 * conteo, no al liquidar -- así que un `conteo_cerrado` normalmente YA
 * trae el bloque entero (itemsTotales, montoFaltanteBruto, el embudo),
 * aunque `montoFaltanteNeto`/`cuotaBase` adentro puedan seguir en null
 * (ver `motivoSinNeto`, más abajo, para ESA distinción). La rama
 * `conteo_cerrado` de acá solo debería verse en inventarios cerrados
 * ANTES de que este cálculo existiera.
 */
function sinResultado(estado: EstadoInventario): string {
  if (estado === 'en_curso') return 'Conteo en marcha: los resultados se calculan al cerrar el ciclo.';
  if (estado === 'conteo_cerrado') return 'Conteo cerrado, pero este inventario es de antes de que se calculara el resultado al cierre.';
  if (estado === 'anulado') return 'Inventario anulado: no produjo resultados.';
  return 'Sin resultados calculados.';
}

/**
 * Por qué `montoFaltanteNeto`/`cuotaBase` son null CON el resto del
 * bloque ya real (itemsTotales, montoFaltanteBruto). Dos razones
 * DISTINTAS que no se pueden confundir bajo el mismo "sin liquidar
 * todavía": el inventario en curso -- eso ya lo cubre `sinResultado` --
 * y el conteo ya cerrado pero sin asistencia/ajustes capturados, que es
 * lo que este texto explica.
 */
function motivoSinNeto(r: ResultadoInventario): string {
  const razones: string[] = [];
  if (r.asistenciaSinRegistrar) razones.push('falta registrar la asistencia');
  if (r.ajustesSinRegistrar) razones.push('faltan los ajustes del mes');
  return razones.length > 0 ? `No se puede calcular: ${razones.join(' y ')}.` : 'No se puede calcular todavía.';
}

/**
 * Misma razón que `motivoSinNeto`, en el espacio angosto de la tarjeta del
 * listado (`Cifra`, `width: '46%'`) -- corto pero sigue diciendo POR QUÉ,
 * nunca un guión ni "Sin liquidar" genérico que confundiría esto con un
 * inventario que todavía ni cerró.
 */
function motivoSinNetoCorto(r: ResultadoInventario): string {
  if (r.asistenciaSinRegistrar && r.ajustesSinRegistrar) return 'Falta asistencia y ajustes';
  if (r.asistenciaSinRegistrar) return 'Falta asistencia';
  if (r.ajustesSinRegistrar) return 'Faltan ajustes';
  return 'No calculado';
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
              Creado el {formatoFecha(inventario.abiertoEn)} · {formatoMiles(inventario.snapshotItems)} ítems
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
              valor={r.montoFaltanteNeto === null ? motivoSinNetoCorto(r) : `S/ ${formatoMoneda(r.montoFaltanteNeto)}`}
              tono={r.montoFaltanteNeto === null ? undefined : 'falta'}
            />
          </View>
        ) : (
          <Text style={styles.sinDatos}>{sinResultado(inventario.estado)}</Text>
        )}
      </View>

      {/* La franja del folio SOLO existe en un lacrado: no hay folio hasta
          que hay sello. Es la señal más honesta de todas.
          Fecha y quién lacró van ACÁ, en la fila — no solo en el detalle:
          un registro de control se lee de un vistazo, no abriendo cada
          inventario uno por uno para saber cuándo se selló y quién firmó. */}
      {inventario.folio ? (
        <View style={styles.invSello}>
          <Lock size={14} color={colors.ok} />
          <View style={styles.invSelloDatos}>
            <Text style={styles.invFolio}>{inventario.folio}</Text>
            {inventario.lacradoEn ? (
              <Text style={styles.invSelloMeta}>
                Lacrado el {formatoFecha(inventario.lacradoEn)}
                {inventario.lacradoPor ? ` por ${inventario.lacradoPor.nombre}` : ''}
              </Text>
            ) : null}
          </View>
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

  filtroBloque: { gap: 6 },
  filtroLabel: { fontSize: 11, letterSpacing: 0.5, color: colors.gris, fontFamily: fonts.semibold },

  comparativoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: colors.rojo,
    borderRadius: radius.md,
  },
  comparativoBtnTexto: { fontSize: 12.5, color: colors.rojo, fontFamily: fonts.bold },

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
  invSelloDatos: { flex: 1, gap: 1 },
  invFolio: { fontSize: 11.5, color: colors.ok, fontFamily: fonts.bold },
  invSelloMeta: { fontSize: 10.5, color: colors.ok, fontFamily: fonts.regular },
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

  verificarBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: colors.rojo,
  },
  verificarBtnDeshabilitado: { opacity: 0.6 },
  verificarBtnTexto: { fontSize: 12.5, color: colors.blanco, fontFamily: fonts.bold },

  verifTarjeta: { gap: 6, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borde },
  verifOk: { backgroundColor: colors.okSuave, borderColor: 'rgba(10,107,87,0.3)' },
  verifAlerta: { backgroundColor: colors.faltaSuave, borderColor: 'rgba(162,59,46,0.3)' },
  verifAdvertencia: { backgroundColor: colors.procesoSuave, borderColor: 'rgba(138,90,5,0.3)' },
  verifCabecera: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verifTitulo: { flex: 1, fontSize: 13, fontFamily: fonts.bold },
  verifTituloOk: { color: colors.ok },
  verifTituloAlerta: { color: colors.falta },
  verifSeccion: { fontSize: 12.5, color: colors.tinta, fontFamily: fonts.semibold, paddingLeft: 4 },

  difFila: { gap: 5, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borde },
  difCabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  difCodigo: { flex: 1, fontSize: 12.5, color: colors.tinta, fontFamily: fonts.semibold },
  difMeta: { fontSize: 11, color: colors.gris, fontFamily: fonts.regular },
  difValores: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  difCifra: { fontSize: 13, fontFamily: fonts.bold },
  difMonto: { fontSize: 12.5, color: colors.tinta, fontFamily: fonts.bold },
  difVerHistoria: { marginTop: 2, fontSize: 11, color: colors.rojo, fontFamily: fonts.semibold },

  planillaFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.borde,
  },
  planillaFilaFalto: { backgroundColor: colors.faltaSuave, marginHorizontal: -15, paddingHorizontal: 15, borderBottomColor: 'transparent' },
  planillaDatos: { flex: 1, gap: 2 },
  planillaNombre: { fontSize: 13, color: colors.tinta, fontFamily: fonts.semibold },
  planillaSub: { fontSize: 11, color: colors.gris, fontFamily: fonts.regular },
  planillaMonto: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.bold },
});
