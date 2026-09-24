import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { AlertTriangle, Building2, Check, FileSpreadsheet, Layers, RefreshCw, Scale, Store, Wallet } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { formatoFechaHora, formatoMiles } from '../../components/ui';
import {
  BotonWeb,
  CeldaTexto,
  ChipIcono,
  EncabezadoPagina,
  FilaDato,
  TablaWeb,
  TarjetaWeb,
  type ColumnaTabla,
} from '../../components/web';
import { repositorioLiquidacion, repositorioSesion } from '../../lib/contenedor';
import { estadoAjustesNegativos, notaFaltanteEmpresa } from '../../lib/dominio/ajustes-formulario';
import { multaPorInasistencia, textoDiasAsistidos } from '../../lib/dominio/asistencia';
import { pluralizar } from '../../lib/dominio/plural';
import { asistentesConCentavoExtra, resumirAsistencia } from '../../lib/dominio/reparto-visible';
import {
  nombreArchivoReporteGerencia,
  textoMontoReporte,
  textoSinPrecioReporte,
  textoUnidadesReporte,
  vistaReporteGerencia,
  type VistaReporteGerencia,
} from '../../lib/dominio/reporte-gerencia';
import { sucursalEnFoco } from '../../lib/dominio/sucursal-en-foco';
import type { Sucursal } from '../../lib/dominio/tipos';
import type {
  AjustesDelMes,
  CierreLiquidacion,
  Conciliacion,
  DetalleLiquidacion,
  FilaReporteGerencia,
  Liquidacion,
  ReporteGerencia,
} from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { useSucursalAuditada } from '../../lib/sucursal-auditada-contexto';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';

/**
 * ---------------------------------------------------------------------------
 * LA LIQUIDACIÓN EN EL NAVEGADOR: LA NÓMINA ES UNA TABLA
 * ---------------------------------------------------------------------------
 * Metro elige este archivo en vez de `liquidacion.tsx` cuando el bundle es de
 * web. El del teléfono NO se toca: es un CLON, no una variante con
 * `Platform.OS` adentro — mismo criterio que `auditoria.web.tsx`,
 * `matriz.web.tsx` y `RolTabsLayout.web.tsx`.
 *
 * POR QUÉ CAMBIA LA FORMA: en el teléfono cada colaborador es una tarjeta con
 * su monto a la derecha y una línea en prosa que explica de dónde sale ("Faltó
 * 2 días · +S/ 40.00 de multa"). Con once personas eso son once pantallazos, y
 * la pregunta que se hace quien firma —"¿por qué a este le descuentan más que
 * al de al lado?"— no se puede contestar sin recordar la tarjeta anterior. En
 * una PC se contesta mirando una columna de arriba abajo. Eso es una tabla, y
 * la tabla solo existe acá.
 *
 * LO QUE **NO** CAMBIA es el negocio: la multa de cada fila sale de
 * `multaPorInasistencia` (`lib/dominio/asistencia.ts`, el mismo nombre y la
 * misma firma que usa el servidor), el reparto de `lib/dominio/reparto-visible`
 * y los textos de `lib/dominio/ajustes-formulario` y `reporte-gerencia`. Son
 * los MISMOS módulos que importa el teléfono, no copias.
 *
 * ---------------------------------------------------------------------------
 * EL CENTAVO DEL REPARTO SE VE MÁS ACÁ QUE EN EL TELÉFONO, Y ESTÁ DICHO
 * ---------------------------------------------------------------------------
 * `Cuota base − Bono` no siempre da exactamente `A descontar`: cuando el fondo
 * de multas no divide parejo entre los asistentes, a algunos les toca un
 * centavo más (S/80 entre 7 = seis de 11.43 y uno de 11.42). En prosa eso pasa
 * desapercibido; en una tabla con las cuatro cifras en fila, no. La nota que
 * lo explica es la que ya existe, en la tarjeta del fondo de multas, y sale
 * SOLO cuando de verdad pasa (`hayCentavoDeReparto`).
 *
 * La columna Bono muestra `bonoAsistencia` —el piso del reparto, que es lo que
 * el servidor manda— y no una resta hecha acá: la cifra que se muestra tiene
 * que ser la que se guarda, y el bono exacto por persona no viene en el DTO.
 *
 * ---------------------------------------------------------------------------
 * `Alert.alert` NO EXISTE EN EL NAVEGADOR
 * ---------------------------------------------------------------------------
 * `react-native-web` lo exporta como `static alert() {}` — un cuerpo vacío. En
 * el teléfono, la CONFIRMACIÓN de liquidar es un `Alert.alert` con dos
 * botones: acá eso sería un botón rojo que no hace absolutamente nada. La
 * confirmación es un `Modal` con los mismos tres renglones y los mismos dos
 * botones; los errores de acción salen en una banda dentro de la página.
 */
const nf = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const soles = (n: number) => `S/ ${nf.format(n)}`;

const ANCHO_ANGOSTO = 1180;

/**
 * Por qué un monto vino en `null`: nunca "cero", nunca un guión sin
 * explicación.
 */
function motivoSinCalcular(advertencia: Liquidacion['advertencia']): string {
  const razones: string[] = [];
  if (advertencia.asistenciaSinRegistrar) razones.push('falta registrar la asistencia');
  if (advertencia.ajustesSinRegistrar) razones.push('faltan los ajustes del mes');
  return razones.length > 0 ? `No se puede calcular: ${razones.join(' y ')}.` : 'No se puede calcular todavía.';
}

/** Igual criterio, para el monto que depende ÚNICAMENTE de los ajustes del mes. */
const MOTIVO_SIN_AJUSTES = 'No se puede calcular: faltan los ajustes del mes.';

/**
 * La sucursal todavía no cerró ningún ciclo. NO es un error: es el estado
 * normal de una tienda mientras se está contando.
 */
const SIN_CICLO_CERRADO =
  'Todavía no hay un inventario con el conteo cerrado en esta tienda. Cuando el auditor cierre el ajuste final en Ciclo de conteos, vuelve aquí.';

/**
 * Auditor sin tienda en la ficha que todavía no eligió ninguna: no hay
 * sucursal que pedir, y la pantalla lo dice en vez de inventar una.
 */
const SIN_SUCURSAL =
  'Elige la tienda en el Panel de auditoría (Sucursal a auditar): la liquidación sigue a la sucursal elegida.';

/**
 * Los ids siguen siendo `asistio`/`falto` porque es el campo que filtran, pero
 * LAS ETIQUETAS dicen "sin faltas" / "con faltas": con la asistencia por día,
 * un `false` es "faltó al menos un día", no "no vino".
 */
type Filtro = 'todos' | 'asistio' | 'falto';

const NOMBRE_ROL: Record<string, string> = { coordinador: 'Coordinador', conteo: 'Conteo', auditor: 'Auditor' };

function filtrar(planilla: DetalleLiquidacion[], filtro: Filtro): DetalleLiquidacion[] {
  if (filtro === 'asistio') return planilla.filter((p) => p.asistio);
  if (filtro === 'falto') return planilla.filter((p) => !p.asistio);
  return planilla;
}

/**
 * EN QUÉ RÉGIMEN se cobró la multa de este cierre. Decide cómo se REDACTA el
 * fondo y cada fila — nunca cuánto es.
 *
 *   null → la asistencia de este inventario todavía no se registró.
 *   0    → cierre con la REGLA VIEJA: monto fijo por persona ausente, ya
 *          congelado en la planilla. No es "duró cero días".
 *   > 0  → multa por día faltado.
 */
type Regimen = 'sin-asistencia' | 'multa-fija' | 'multa-por-dia';

function regimenDeLaMulta(liquidacion: Liquidacion): Regimen {
  if (liquidacion.diasDelInventario === null) return 'sin-asistencia';
  return liquidacion.diasDelInventario > 0 ? 'multa-por-dia' : 'multa-fija';
}

/**
 * LA MULTA DE ESA FILA, ya formateada, o '—' cuando no se puede afirmar nada.
 *
 * Son exactamente las ramas de `efectoDeLaFila` del teléfono, que ahí se dicen
 * en prosa ("Faltó 2 días · +S/ 40.00 de multa") y acá son una columna. El
 * monto sale de `multaPorInasistencia`, la MISMA función (y el mismo nombre)
 * que usa el servidor — no hay una segunda copia de la fórmula.
 *
 * El '—' no es decorativo: sin asistencia registrada no se afirma nada sobre
 * esta persona, y con `diasAsistidos` en null no se sabe cuántos días faltó
 * aunque el inventario sí tenga días. Un 0 ahí diría "no se le cobró nada", y
 * eso es una afirmación, no un hueco.
 */
function multaDeLaFila(fila: DetalleLiquidacion, liquidacion: Liquidacion): string {
  const regimen = regimenDeLaMulta(liquidacion);
  if (regimen === 'sin-asistencia') return '—';
  if (fila.asistio) return soles(0);
  // REGLA VIEJA: la multa fue un monto fijo por persona y ese cierre ya se
  // firmó así. No hay días que multiplicar.
  if (regimen === 'multa-fija') return `+${soles(liquidacion.multaInasistencia)}`;
  if (fila.diasAsistidos === null) return '—';
  const multa = multaPorInasistencia(liquidacion.diasDelInventario!, fila.diasAsistidos, liquidacion.multaInasistencia);
  return multa > 0 ? `+${soles(multa)}` : soles(0);
}

/**
 * EL BONO DE ESA FILA: el piso del reparto del fondo de multas, con el signo
 * de lo que hace (baja el descuento). Ver la nota del centavo en el encabezado
 * del archivo — a algunos asistentes les toca S/ 0.01 más que este piso.
 */
function bonoDeLaFila(fila: DetalleLiquidacion, liquidacion: Liquidacion): string {
  if (liquidacion.bonoAsistencia === null) return '—';
  if (!fila.asistio) return soles(0);
  return liquidacion.bonoAsistencia > 0 ? `–${soles(liquidacion.bonoAsistencia)}` : soles(0);
}

/** El título y el detalle de un error de acción. Lo que en el teléfono es un `Alert.alert`. */
interface AvisoDeAccion {
  titulo: string;
  detalle: string;
}

/**
 * ESTA PERSONA TIENE FALTAS Y SE SABE. Es lo que decide el tinte de la fila y
 * el ámbar de la multa.
 *
 * `asistio` solo afirma algo si hay asistencia registrada: con el régimen
 * `sin-asistencia` un `false` no quiere decir que faltó, quiere decir que
 * nadie marcó nada. Teñir esa fila sería acusar a alguien con un dato que no
 * existe.
 */
function tieneFaltas(fila: DetalleLiquidacion, liquidacion: Liquidacion): boolean {
  return !fila.asistio && regimenDeLaMulta(liquidacion) !== 'sin-asistencia';
}

/**
 * CUOTA BASE · MULTA · BONO · A DESCONTAR, en ese orden: es el camino del
 * número. Se parte de lo que le toca a todos, se le suma lo que le costó
 * faltar, se le resta lo que le devolvió venir, y lo último es lo que de
 * verdad se le descuenta — la única cifra que el servidor manda ya calculada.
 *
 * Las cuatro de plata van a la derecha y con `tabular-nums` (`CeldaTexto
 * numero`): así las unidades quedan bajo las unidades y la columna se barre
 * con la vista en vez de leerse cifra por cifra.
 */
function columnasDeLaPlanilla(liquidacion: Liquidacion, multaPorDia: boolean): ColumnaTabla<DetalleLiquidacion>[] {
  return [
    // Sin `ancho`: el nombre se lleva lo que sobra. El resto queda fijo para
    // que las cifras no se muevan de fila en fila.
    { clave: 'nombre', titulo: 'Colaborador', celda: (p) => <CeldaTexto fuerte>{p.nombre}</CeldaTexto> },
    { clave: 'rol', titulo: 'Rol', ancho: 100, celda: (p) => <CeldaTexto>{NOMBRE_ROL[p.rol] ?? p.rol}</CeldaTexto> },
    {
      clave: 'dias',
      titulo: 'Días',
      ancho: 110,
      // DÍAS ASISTIDOS SOBRE DÍAS DEL INVENTARIO, los dos juntos. Nunca el
      // numerador solo: 2 de 2 y 2 de 5 son la diferencia entre cobrar bono y
      // pagar tres días de multa. En un cierre de la regla vieja no hay
      // denominador, y "0 de 0 días" no dice nada de esa persona.
      celda: (p) => (
        <CeldaTexto>{multaPorDia ? textoDiasAsistidos(p.diasAsistidos, liquidacion.diasDelInventario) : '—'}</CeldaTexto>
      ),
    },
    {
      clave: 'cuota',
      titulo: 'Cuota base',
      ancho: 110,
      alinear: 'derecha',
      celda: () => <CeldaTexto numero>{liquidacion.cuotaBase === null ? '—' : soles(liquidacion.cuotaBase)}</CeldaTexto>,
    },
    {
      clave: 'multa',
      titulo: 'Multa',
      ancho: 105,
      alinear: 'derecha',
      // La multa usa `proceso` (el estado de ATENCIÓN del design system), no el
      // rojo de marca: en esta app el rojo es siempre la acción.
      celda: (p) => (
        <CeldaTexto numero color={tieneFaltas(p, liquidacion) ? colors.proceso : undefined}>
          {multaDeLaFila(p, liquidacion)}
        </CeldaTexto>
      ),
    },
    {
      clave: 'bono',
      titulo: 'Bono',
      ancho: 105,
      alinear: 'derecha',
      celda: (p) => (
        <CeldaTexto numero color={p.asistio ? colors.ok : undefined}>{bonoDeLaFila(p, liquidacion)}</CeldaTexto>
      ),
    },
    {
      clave: 'monto',
      titulo: 'A descontar',
      ancho: 130,
      alinear: 'derecha',
      celda: (p) => (
        <CeldaTexto numero fuerte>
          {soles(p.monto)}
        </CeldaTexto>
      ),
    },
  ];
}

export default function LiquidacionWeb(): JSX.Element {
  const { sesion } = useSesion();
  const { width } = useWindowDimensions();
  const angosto = width < ANCHO_ANGOSTO;

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liquidacion, setLiquidacion] = useState<Liquidacion | null>(null);
  const [conciliacion, setConciliacion] = useState<Conciliacion | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [ajustes, setAjustes] = useState<AjustesDelMes | null>(null);
  const [liquidando, setLiquidando] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [aviso, setAviso] = useState<AvisoDeAccion | null>(null);
  /** Lo que devolvió `liquidar` en ESTA sesión: alimenta el cartel de "ya está cerrada". */
  const [cerrado, setCerrado] = useState<CierreLiquidacion | null>(null);
  /** El reporte a gerencia: solo se pide con la planilla ya cerrada (ver `cargar`). */
  const [reporte, setReporte] = useState<ReporteGerencia | null>(null);
  const [errorReporte, setErrorReporte] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  // La sucursal COMPARTIDA (contexto), no la de la ficha: mismo criterio que
  // lacrado.web.tsx. El padrón resuelve el nombre para la banda.
  const { elegida } = useSucursalAuditada();
  const [padronSucursales, setPadronSucursales] = useState<Sucursal[]>([]);
  useEffect(() => {
    repositorioSesion.sucursales().then(setPadronSucursales);
  }, []);
  const sucursalId = sucursalEnFoco({
    rol: sesion?.colaborador.rol ?? 'auditor',
    sucursalDeSesion: sesion?.sucursal?.id ?? null,
    elegida,
  });
  const nombreSucursal = padronSucursales.find((s) => s.id === sucursalId)?.nombre ?? sesion?.sucursal?.nombre;

  const cargar = useCallback(async () => {
    if (!sesion) return;
    if (sucursalId === null) {
      setCargando(false);
      return;
    }
    setError(null);
    try {
      // Piden lo mismo (el último ciclo cerrado de la sucursal): si uno es null
      // el otro también lo es, pero se piden en paralelo porque no dependen
      // entre sí.
      const [resultadoLiq, resultadoConc] = await Promise.all([
        repositorioLiquidacion.deSucursal(sucursalId),
        repositorioLiquidacion.conciliacion(sucursalId),
      ]);
      setLiquidacion(resultadoLiq);
      setConciliacion(resultadoConc);

      // Los ajustes SÍ van encadenados: cuelgan del inventario, y el id sale de
      // la liquidación que se acaba de traer.
      setAjustes(resultadoLiq === null ? null : await repositorioLiquidacion.ajustes(resultadoLiq.inventarioId));

      // EL REPORTE A GERENCIA, con su propio try: si falla, su tarjeta dice por
      // qué y el resto de la liquidación se sigue viendo. Y solo con la
      // planilla cerrada — antes ni se pide.
      if (resultadoLiq === null || resultadoLiq.proyectada) {
        setReporte(null);
        setErrorReporte(null);
      } else {
        try {
          setReporte(await repositorioLiquidacion.reporteGerencia(resultadoLiq.inventarioId));
          setErrorReporte(null);
        } catch (e) {
          setReporte(null);
          setErrorReporte(e instanceof Error ? e.message : 'No se pudo cargar el reporte a gerencia.');
        }
      }
    } catch (e) {
      // Sin esto, un fallo sin red dejaba el spinner girando para siempre.
      setError(e instanceof Error ? e.message : 'No se pudo cargar la liquidación.');
    } finally {
      setCargando(false);
    }
  }, [sesion, sucursalId]);

  // PAUSADO solo mientras se liquida o con el modal abierto: esta pantalla no
  // tiene nada que tipear, así que no hay trabajo a medias que pisar — pero un
  // refresco que redibuje la página debajo de un modal de confirmación es la
  // peor forma de que alguien apriete lo que no era.
  const { refrescar } = useRefrescoAlEnfocar(cargar, { pausado: liquidando || modalVisible });

  // Cambió la tienda elegida: `cargar` cambia con ella, pero
  // useRefrescoAlEnfocar solo recarga al enfocar. Se recarga YA, y se limpia lo
  // anterior ANTES: la banda ya dice la tienda nueva, y dejar la planilla de la
  // anterior sería un número con el apellido equivocado. El primer render lo
  // saltea: esa carga la hace el hook.
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    setLiquidacion(null);
    setConciliacion(null);
    setAjustes(null);
    setCerrado(null);
    setReporte(null);
    setErrorReporte(null);
    setError(null);
    setAviso(null);
    setCargando(true);
    void cargar();
  }, [cargar]);

  const visibles = useMemo(() => (liquidacion ? filtrar(liquidacion.planilla, filtro) : []), [liquidacion, filtro]);

  if (!sesion) return <View style={styles.centro} />;

  /**
   * PUNTO DE NO RETORNO de la nómina: al confirmar, los descuentos quedan
   * firmes y el inventario pasa a `liquidado`.
   *
   * El 409 del backend se muestra TAL CUAL. Sus mensajes dicen qué falta —los
   * ajustes, que nadie registró conteos, que ya se liquidó— y reemplazarlos por
   * un genérico borraría justo lo accionable.
   */
  async function confirmarLiquidacion(): Promise<void> {
    if (!liquidacion) return;
    setModalVisible(false);
    setLiquidando(true);
    setAviso(null);
    try {
      const cierre = await repositorioLiquidacion.liquidar(liquidacion.inventarioId);
      setCerrado(cierre);
      // Recarga: la pantalla pasa a mostrar la planilla FIRME, sin edición.
      await cargar();
    } catch (e) {
      setAviso({
        titulo: 'No se pudo cerrar la planilla',
        detalle: e instanceof Error ? e.message : 'Prueba de nuevo en un momento.',
      });
    } finally {
      setLiquidando(false);
    }
  }

  /**
   * El .xlsx del reporte a gerencia: se baja a un archivo TEMPORAL y se abre el
   * selector nativo para compartir — mismo flujo que el export de diferencias
   * del Historial: el destino es WhatsApp o el correo, no el equipo.
   *
   * OJO EN EL NAVEGADOR: `Sharing.isAvailableAsync()` mira `navigator.share`,
   * que en un Chrome de escritorio no existe. Acá eso termina en el mensaje de
   * "no se puede compartir" — visible, no en silencio como con el `Alert` que
   * el navegador ignora. Una descarga del navegador sería otra funcionalidad,
   * no esta.
   */
  async function exportarReporte(): Promise<void> {
    if (!liquidacion) return;
    setExportando(true);
    setAviso(null);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setAviso({
          titulo: 'No se puede compartir',
          detalle: 'Este dispositivo no tiene disponible el selector nativo para compartir archivos.',
        });
        return;
      }
      const bytes = await repositorioLiquidacion.exportarReporteGerencia(liquidacion.inventarioId);
      const nombre = nombreArchivoReporteGerencia(
        nombreSucursal ?? '',
        liquidacion.periodoAnio,
        liquidacion.periodoMes,
        liquidacion.inventarioId,
      );
      const archivo = new File(Paths.cache, nombre);
      if (archivo.exists) archivo.delete();
      archivo.write(new Uint8Array(bytes));
      await Sharing.shareAsync(archivo.uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: 'Compartir reporte a gerencia',
        UTI: 'org.openxmlformats.spreadsheetml.sheet',
      });
    } catch (e) {
      setAviso({ titulo: 'No se pudo exportar', detalle: e instanceof Error ? e.message : 'Intenta de nuevo.' });
    } finally {
      setExportando(false);
    }
  }

  /**
   * Los seis nacen o faltan JUNTOS: todos dependen de los mismos dos datos
   * (asistencia/ajustes del mes) — nunca uno sin los otros.
   */
  const datosCompletos =
    liquidacion !== null &&
    liquidacion.totalFaltas !== null &&
    liquidacion.cuotaBase !== null &&
    liquidacion.bonoAsistencia !== null &&
    liquidacion.diasDelInventario !== null &&
    liquidacion.diasFaltadosEnTotal !== null &&
    liquidacion.fondoMultas !== null;

  /**
   * Quién asistió es un hecho por fila, no una diferencia: sale de
   * `resumirAsistencia`, que garantiza que ninguno de los dos números sea
   * negativo y que sumen el universo (el arreglo del "-2" del 2026-09-05).
   */
  const asistencia =
    liquidacion === null
      ? null
      : resumirAsistencia(liquidacion.planilla.length, liquidacion.planilla.filter((p) => p.asistio).length);
  const asistieron = datosCompletos ? asistencia!.asistieron : null;
  /** PERSONAS con al menos una falta — la misma unidad que `liquidacion.totalFaltas`. */
  const conFaltas = datosCompletos ? asistencia!.faltaron : null;

  /**
   * En los cierres viejos `diasFaltadosEnTotal` viene en 0 y el fondo NO es 0
   * (sale de las multas congeladas en la planilla), así que una frase en días
   * diría "0 días faltados × S/20 = S/40" — una cuenta que no cierra sola a la
   * vista de quien la lee.
   */
  const multaPorDia = liquidacion !== null && regimenDeLaMulta(liquidacion) === 'multa-por-dia';

  // A cuántos asistentes les tocó el centavo extra del reparto. La regla vive
  // en lib/dominio/reparto-visible.ts, no acá.
  const conCentavoExtra = datosCompletos
    ? asistentesConCentavoExtra(liquidacion.planilla, liquidacion.cuotaBase!, liquidacion.bonoAsistencia!)
    : 0;
  const hayCentavoDeReparto = conCentavoExtra > 0;

  const cartel = cartelDe(liquidacion);

  return (
    <ScrollView style={styles.pagina} contentContainerStyle={styles.contenido} showsVerticalScrollIndicator={false}>
      <EncabezadoPagina
        migas={['Auditoría', 'Liquidación y nómina']}
        titulo="Liquidación y nómina"
        sub="Cierre de fin de mes: el faltante neto, la cuota que le toca a cada uno y las multas por inasistencia."
        onInicio={() => router.push('/auditor')}
        acciones={<View style={styles.accionEncabezado}><BotonWeb etiqueta="Actualizar" icono={RefreshCw} onPress={refrescar} /></View>}
      />

      {/* LA TIENDA Y EN QUÉ PUNTO ESTÁ: el contexto de todos los montos de
          abajo. Sin esto, una tabla de descuentos no dice de qué tienda ni de
          qué mes habla. */}
      <View style={[styles.banda, angosto && styles.bandaApilada]}>
        <View style={styles.bandaTienda}>
          <ChipIcono icono={Store} />
          <View style={styles.bandaTextos}>
            <Text style={styles.bandaEtiqueta}>Liquidación de</Text>
            <Text style={styles.bandaTitulo}>{nombreSucursal ?? 'Sin tienda'}</Text>
            {liquidacion ? (
              <Text style={styles.bandaSub}>
                {liquidacion.periodo} · {liquidacion.planilla.length}{' '}
                {pluralizar(liquidacion.planilla.length, 'colaborador', 'colaboradores')}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={[styles.cartel, estilosCartel[cartel.tono]]}>
          <Wallet size={22} color={tintaCartel[cartel.tono]} />
          <View style={styles.cartelTextos}>
            <Text style={[styles.cartelTitulo, { color: tintaCartel[cartel.tono] }]}>{cartel.titulo}</Text>
            <Text style={styles.cartelDetalle}>{cartel.detalle}</Text>
          </View>
        </View>
      </View>

      {/* Lo que en el teléfono sería un `Alert.alert`. Ver el encabezado. */}
      {aviso !== null ? (
        <View style={styles.avisoAccion}>
          <Text style={styles.avisoAccionTitulo}>{aviso.titulo}</Text>
          <Text style={styles.avisoAccionTexto}>{aviso.detalle}</Text>
        </View>
      ) : null}

      {/*
        CUATRO ESTADOS, no dos. Una tienda SIN CICLO CERRADO —el caso más
        normal del mes, mientras se está contando— no vio nunca un error: no
        hay nada roto, y decirle "reintenta" la manda a tocar un botón en loop
        en vez de a la pantalla donde sí puede avanzar.
      */}
      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : sucursalId === null ? (
        <TarjetaWeb titulo="Elige una tienda" icono={Store} tono="neutro">
          <Text style={styles.parrafo}>{SIN_SUCURSAL}</Text>
          <BotonWeb
            etiqueta="Ir al Panel de auditoría"
            variante="principal"
            onPress={() => router.push('/auditor/auditoria')}
          />
        </TarjetaWeb>
      ) : error !== null ? (
        <TarjetaWeb titulo="No se pudo cargar la liquidación" icono={Wallet} tono="neutro">
          <Text style={styles.parrafo}>{error}</Text>
          {/* Reintentar SOLO acá: es lo único que un problema de red puede arreglar. */}
          <BotonWeb etiqueta="Reintentar" variante="principal" onPress={() => void cargar()} />
        </TarjetaWeb>
      ) : liquidacion === null ? (
        <TarjetaWeb titulo="Todavía no hay nada que liquidar" icono={Layers} tono="neutro">
          <Text style={styles.parrafo}>{SIN_CICLO_CERRADO}</Text>
          <BotonWeb etiqueta="Ir al ciclo de conteos" variante="principal" onPress={() => router.push('/auditor/ciclo')} />
        </TarjetaWeb>
      ) : (
        <>
          {/*
            LOS AJUSTES VAN PRIMERO, y no es cosmético: mientras no se importe
            el Excel, el faltante neto y la cuota por persona son `null` y toda
            la pantalla de abajo dice "no se puede calcular". Arriba está lo
            único accionable.
          */}
          <TarjetaAjustesDelMes inventarioId={liquidacion.inventarioId} estado={ajustes} />

          <View style={[styles.fila, angosto && styles.filaApilada]}>
            <TarjetaWeb titulo="Faltante neto a descontar" icono={Wallet}>
              <FilaDato etiqueta="Faltante bruto" valor={soles(liquidacion.faltanteBruto)} color={colors.proceso} />
              <FilaDato
                etiqueta="(–) Negativos del mes"
                valor={liquidacion.negativosDelMes === null ? MOTIVO_SIN_AJUSTES : `-${soles(liquidacion.negativosDelMes)}`}
              />
              <FilaDato etiqueta="(–) Faltante empresa" valor={`-${soles(liquidacion.faltanteEmpresa)}`} />
              {/* Dato CALCULADO y de solo lectura: ya no se tipea. Se dice de
                  dónde sale para que nadie busque dónde corregirlo. */}
              <Text style={styles.nota}>{notaFaltanteEmpresa(liquidacion.proyectada)}</Text>
              <FilaDato
                etiqueta="Faltante neto a descontar"
                valor={liquidacion.faltanteNeto === null ? motivoSinCalcular(liquidacion.advertencia) : soles(liquidacion.faltanteNeto)}
                destacada
              />
              <FilaDato
                etiqueta={`Cuota base (${liquidacion.planilla.length} ${pluralizar(liquidacion.planilla.length, 'colaborador', 'colaboradores')})`}
                valor={
                  liquidacion.cuotaBase === null
                    ? motivoSinCalcular(liquidacion.advertencia)
                    : `${soles(liquidacion.cuotaBase)} / persona`
                }
              />

              {/*
                PEGADA AL MONTO, no al pie en letra chica: quien autoriza un
                descuento a la nómina de otra persona tiene que ver que el
                número está incompleto ANTES de firmar.
              */}
              {liquidacion.advertencia.mensaje !== null ? (
                <View style={styles.aviso}>
                  <AlertTriangle size={16} color={colors.proceso} />
                  <Text style={styles.avisoTexto}>{liquidacion.advertencia.mensaje}</Text>
                </View>
              ) : null}
            </TarjetaWeb>

            <TarjetaWeb
              titulo="Fondo de multas por inasistencia"
              sub={
                datosCompletos
                  ? multaPorDia
                    ? `${liquidacion.diasFaltadosEnTotal!} ${pluralizar(liquidacion.diasFaltadosEnTotal!, 'día faltado', 'días faltados')}`
                    : `${liquidacion.totalFaltas!} ${pluralizar(liquidacion.totalFaltas!, 'falta', 'faltas')}`
                  : 'Sin calcular'
              }
              icono={Wallet}
              tono="atencion"
            >
              {/* Toda la tarjeta depende de los mismos datos: si falta
                  cualquiera, no hay números parciales que mostrar. */}
              {!datosCompletos ? (
                <Text style={styles.parrafo}>{motivoSinCalcular(liquidacion.advertencia)}</Text>
              ) : (
                <>
                  {/*
                    EL MONTO SALE DE `fondoMultas`, NUNCA DE UNA MULTIPLICACIÓN
                    DE ESTA PANTALLA: `totalFaltas` son PERSONAS, no días. El
                    multiplicando de días es `diasFaltadosEnTotal`; el monto ya
                    viene hecho.
                  */}
                  <Text style={styles.parrafo}>
                    {multaPorDia ? (
                      <>
                        {liquidacion.diasFaltadosEnTotal}{' '}
                        {pluralizar(liquidacion.diasFaltadosEnTotal!, 'día faltado', 'días faltados')} ×{' '}
                        {soles(liquidacion.multaInasistencia)} por día = {soles(liquidacion.fondoMultas!)}, redistribuido
                        entre los {asistieron}{' '}
                        {pluralizar(asistieron ?? 0, 'colaborador que vino', 'colaboradores que vinieron')} todos los días
                        del inventario ({liquidacion.diasDelInventario}).
                      </>
                    ) : (
                      <>
                        {liquidacion.totalFaltas}{' '}
                        {pluralizar(liquidacion.totalFaltas!, 'persona que faltó', 'personas que faltaron')} ×{' '}
                        {soles(liquidacion.multaInasistencia)} = {soles(liquidacion.fondoMultas!)}, redistribuido entre los{' '}
                        {asistieron} {pluralizar(asistieron ?? 0, 'colaborador que asistió', 'colaboradores que asistieron')}.
                        Este cierre es anterior a la asistencia por día: la multa era un monto fijo por persona.
                      </>
                    )}
                  </Text>
                  <FilaDato
                    etiqueta="Descuento adicional para cada uno de ellos"
                    valor={`-${soles(liquidacion.bonoAsistencia!)}`}
                    color={colors.ok}
                  />
                </>
              )}

              {/*
                EL CENTAVO DEL REPARTO, explicado donde se ve. Sin esta línea,
                quien compare esta tarjeta contra la planilla ve dos números
                distintos y piensa que el sistema calcula mal — que es
                exactamente lo que este reparto vino a evitar. Solo aparece
                cuando efectivamente pasa.
              */}
              {hayCentavoDeReparto ? (
                <Text style={styles.nota}>
                  A {conCentavoExtra} de ellos les toca S/ 0.01 más, para que la suma dé exactamente{' '}
                  {soles(liquidacion.fondoMultas!)}.
                </Text>
              ) : null}
            </TarjetaWeb>

            {/* Por qué el total de la planilla no da EXACTO contra el faltante
                neto — el residuo de redondeo de la cuota, y si lo recaudado por
                inasistencia se repartió entero. Para que el Auditor lo vea
                ANTES de liquidar, no después de que alguien de Contabilidad
                pregunte por qué no cierra. */}
            {conciliacion ? (
              <TarjetaWeb
                titulo="Conciliación"
                icono={Scale}
                tono={conciliacion.calculable && conciliacion.fondoDeMultas.cierra ? 'ok' : 'neutro'}
              >
                {!conciliacion.calculable ? (
                  <Text style={styles.parrafo}>{motivoSinCalcular(conciliacion.advertencia)}</Text>
                ) : (
                  <>
                    <FilaDato etiqueta="Suma real de la planilla" valor={soles(conciliacion.sumaPlanilla)} />
                    <FilaDato etiqueta="Diferencia por redondeo" valor={soles(conciliacion.diferenciaPorRedondeo)} />
                    <Text style={styles.nota}>
                      Son los centavos que deja el redondeo de la cuota por persona ({conciliacion.colaboradores}{' '}
                      {pluralizar(conciliacion.colaboradores, 'colaborador', 'colaboradores')}) — hoy quedan a favor del
                      personal.
                    </Text>

                    <View style={styles.separador} />
                    <FilaDato etiqueta="Fondo de multas recaudado" valor={soles(conciliacion.fondoDeMultas.recaudado)} />
                    <FilaDato etiqueta="Repartido entre asistentes" valor={soles(conciliacion.fondoDeMultas.repartido)} />

                    {conciliacion.fondoDeMultas.cierra ? (
                      <View style={styles.cierra}>
                        <Check size={16} color={colors.ok} />
                        <Text style={styles.cierraTexto}>El fondo de multas cierra</Text>
                      </View>
                    ) : (
                      // Color de AVISO (proceso), no de error: es un descuadre a
                      // mirar, no una falla que rompió algo.
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
              </TarjetaWeb>
            ) : null}
          </View>

          {/*
            LA PLANILLA, en la tabla única de la web (`components/web/TablaWeb`).
            "Proyectada" vs "de descuentos" es la única señal de si el descuento
            ya está hecho: antes de liquidar son las filas que VAN A pasar.

            LOS CHIPS DEL FILTRO VIAJARON ADENTRO DEL ENCABEZADO. Antes eran una
            barra suelta arriba de la tabla; el filtro pertenece a la tabla que
            recorta, y suelto se lee como un filtro de la página entera (no lo
            es: los montos de arriba no se filtran).

            SIN `onAbrirFila`: una fila de la nómina no lleva a ningún lado.
            Pasarla dejaría el cursor de mano sobre algo que no responde.
          */}
          <TablaWeb<DetalleLiquidacion>
            titulo={liquidacion.proyectada ? 'Planilla proyectada' : 'Planilla de descuentos'}
            icono={Layers}
            columnas={columnasDeLaPlanilla(liquidacion, multaPorDia)}
            filas={visibles}
            claveDe={(p) => String(p.colaboradorId)}
            tinteDeFila={(p) => (tieneFaltas(p, liquidacion) ? 'atencion' : null)}
            herramientas={
              <View style={styles.chips}>
                {(
                  [
                    { id: 'todos', etiqueta: 'Todos', cuenta: liquidacion.planilla.length },
                    // '—' y no el número: sin asistencia registrada no se puede
                    // afirmar quién vino completo. Las dos cuentas son de PERSONAS.
                    { id: 'asistio', etiqueta: 'Sin faltas', cuenta: asistieron ?? '—' },
                    { id: 'falto', etiqueta: 'Con faltas', cuenta: conFaltas ?? '—' },
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
            }
            vacio={
              <Text style={styles.parrafo}>
                Ningún colaborador entra en este filtro. Cambia de filtro para ver el resto de la planilla.
              </Text>
            }
            /* EL TOTAL ES EL DE LA PLANILLA ENTERA, no el del filtro: si se
               muestra el del filtro, hay que decir que es del filtro. */
            pie={(mostradas) =>
              `Mostrando ${mostradas} de ${liquidacion.planilla.length} ${pluralizar(liquidacion.planilla.length, 'colaborador', 'colaboradores')}`
            }
          />

          <View style={[styles.fila, angosto && styles.filaApilada]}>
            {/*
              EL CIERRE DE LA PLANILLA va DESPUÉS de la planilla y la
              conciliación. No es orden estético: es lo último que se hace, y
              ponerlo arriba invitaría a firmar sin haber mirado los números que
              se firman.
            */}
            {cerrado !== null ? (
              <TarjetaWeb titulo="Planilla cerrada" sub="Liquidado" icono={Check} tono="ok">
                <Text style={styles.parrafo}>
                  Liquidado el {formatoFechaHora(new Date().toISOString())} por {sesion.colaborador.nombre}. Los
                  descuentos de {cerrado.colaboradores}{' '}
                  {pluralizar(cerrado.colaboradores, 'colaborador', 'colaboradores')} quedaron firmes por{' '}
                  {soles(cerrado.totalDescontado)} en total.
                </Text>
                <Text style={styles.parrafo}>
                  El paso que sigue es la aprobación y el lacrado: el sello incluye esta planilla.
                </Text>
                <BotonWeb etiqueta="Ir a aprobación y lacrado" onPress={() => router.push('/auditor/lacrado')} />
              </TarjetaWeb>
            ) : (
              <CierreDePlanilla
                liquidacion={liquidacion}
                ajustes={ajustes}
                liquidando={liquidando}
                onLiquidar={() => setModalVisible(true)}
              />
            )}

            {/*
              EL REPORTE A GERENCIA va después del cierre: sale de la planilla
              cerrada (qué es de la empresa recién queda fijo al liquidar).
              Antes de liquidar la tarjeta está igual y dice por qué todavía no
              hay reporte — nunca se muestra vacía.
            */}
            <TarjetaReporteGerencia
              vista={vistaReporteGerencia({ proyectada: liquidacion.proyectada, reporte, error: errorReporte })}
              exportando={exportando}
              onExportar={() => void exportarReporte()}
            />
          </View>
        </>
      )}

      {/*
        LA CONFIRMACIÓN. En el teléfono es un `Alert.alert`, que el navegador
        ignora en silencio. Dice los DOS números que se están firmando antes de
        la frase de advertencia: un "¿estás seguro?" sin cifras no le da a nadie
        con qué decidir.
      */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalFondo}>
          <View style={styles.modalCaja}>
            <Text style={styles.modalTitulo}>Cerrar la planilla</Text>
            {liquidacion !== null && liquidacion.faltanteNeto !== null ? (
              <>
                <Text style={styles.modalTexto}>Faltante neto: {soles(liquidacion.faltanteNeto)}</Text>
                <Text style={styles.modalTexto}>
                  Alcanza a {liquidacion.planilla.length}{' '}
                  {pluralizar(liquidacion.planilla.length, 'colaborador', 'colaboradores')}.
                </Text>
                <Text style={styles.modalTexto}>
                  Esto cierra la planilla: los descuentos quedan firmes y el paso siguiente es el lacrado. No se puede
                  deshacer.
                </Text>
              </>
            ) : null}
            <View style={styles.modalAcciones}>
              <View style={styles.modalBoton}>
                <BotonWeb etiqueta="Cancelar" onPress={() => setModalVisible(false)} />
              </View>
              <View style={styles.modalBoton}>
                <BotonWeb etiqueta="Liquidar" icono={Wallet} variante="principal" onPress={() => void confirmarLiquidacion()} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

interface EstadoDelCartel {
  titulo: string;
  detalle: string;
  tono: 'ok' | 'atencion' | 'neutro';
}

/**
 * EN QUÉ PUNTO ESTÁ LA NÓMINA. Verde = los descuentos ya quedaron firmes;
 * ámbar = espera la decisión del Auditor; gris = todavía no hay nada.
 *
 * El rojo no aparece: en esta pantalla el rojo es el botón de liquidar.
 */
function cartelDe(liquidacion: Liquidacion | null): EstadoDelCartel {
  if (liquidacion === null) {
    return { titulo: 'Sin planilla', detalle: 'Esta tienda no tiene un inventario con el conteo cerrado.', tono: 'neutro' };
  }
  return liquidacion.proyectada
    ? { titulo: 'Planilla proyectada', detalle: 'Son los descuentos que van a pasar. Todavía no se cerró.', tono: 'atencion' }
    : { titulo: 'Planilla firme', detalle: 'Los descuentos quedaron firmes. Sigue el lacrado.', tono: 'ok' };
}

/**
 * EL PASO QUE NO EXISTÍA EN LA APP: `liquidar` estaba en el backend y ninguna
 * pantalla lo llamaba, así que el inventario nunca llegaba a `liquidado` y el
 * lacrado —que exige ese estado— quedaba inalcanzable.
 *
 * Habilitado SOLO con los ajustes registrados, el resumen calculable y la
 * asistencia registrada: son las condiciones que el backend exige, y un botón
 * que se puede tocar para recibir un 409 es un botón que enseña a ignorar los
 * errores.
 */
function CierreDePlanilla({
  liquidacion,
  ajustes,
  liquidando,
  onLiquidar,
}: {
  liquidacion: Liquidacion;
  ajustes: AjustesDelMes | null;
  liquidando: boolean;
  onLiquidar: () => void;
}): JSX.Element {
  const ajustesListos = ajustes !== null && ajustes.registrado && ajustes.montoNegativos !== null;
  const calculable = liquidacion.faltanteNeto !== null && liquidacion.cuotaBase !== null;

  /**
   * QUE HAYA ASISTENCIA REGISTRADA, sobre la planilla PROYECTADA.
   *
   * No "hay al menos un asistente": con la asistencia por día, `asistio`
   * significa "vino todos los días", así que un inventario en el que todos
   * faltaron alguna jornada daría cero asistentes y bloquearía una liquidación
   * perfectamente válida — una en la que TODOS trabajaron. Lo que de verdad
   * hace falta es que alguien haya registrado la asistencia: sin días, no hay
   * denominador con el que calcular la multa de nadie.
   */
  const asistenciaRegistrada =
    liquidacion.diasDelInventario !== null && liquidacion.diasDelInventario > 0 && liquidacion.planilla.length > 0;
  const puedeLiquidar = ajustesListos && calculable && asistenciaRegistrada;

  // Dice QUÉ falta, no "no se puede": si el botón está apagado, la persona
  // tiene que saber qué ir a hacer.
  const motivo = !ajustesListos
    ? 'Primero importa el Excel de ajustes del mes, arriba. Sin eso no se puede calcular lo que se le descuenta a cada persona.'
    : !asistenciaRegistrada
      ? 'Este inventario no tiene ningún día de asistencia registrado: sin días no hay con qué medir las faltas ni a quién repartir el faltante. El Coordinador la marca en «Asistencia del inventario», día por día.'
      : 'Todavía no se puede calcular la planilla: revisa las advertencias de arriba.';

  return (
    <TarjetaWeb titulo="Cerrar la planilla" icono={Wallet} tono="marca">
      {puedeLiquidar ? (
        <Text style={styles.parrafo}>
          Vas a dejar firmes los descuentos de {liquidacion.planilla.length}{' '}
          {pluralizar(liquidacion.planilla.length, 'colaborador', 'colaboradores')} por{' '}
          {soles(liquidacion.faltanteNeto!)} de faltante neto. Después de esto sigue el lacrado.
        </Text>
      ) : (
        <Text style={styles.parrafo}>{motivo}</Text>
      )}

      {/* EL botón de la pantalla. Es el único rojo, y cuando no se puede queda
          APAGADO y a la vista, con el motivo debajo — no escondido. */}
      <BotonWeb
        etiqueta={liquidando ? 'Cerrando la planilla…' : 'Liquidar este inventario'}
        icono={Wallet}
        variante="principal"
        onPress={onLiquidar}
        deshabilitado={!puedeLiquidar}
        cargando={liquidando}
        {...(puedeLiquidar ? {} : { motivo })}
      />
    </TarjetaWeb>
  );
}

/**
 * LOS AJUSTES DEL MES: la ENTRADA a la pantalla del Excel de Dynamics, con el
 * estado real de la importación.
 *
 * `null` = nadie importó el Excel (bloquea liquidar); un número, 0 incluido, es
 * lo importado. Dos carteles distintos (`dominio/ajustes-formulario.ts`).
 */
function TarjetaAjustesDelMes({
  inventarioId,
  estado,
}: {
  inventarioId: number;
  estado: AjustesDelMes | null;
}): JSX.Element | null {
  // `null` = todavía cargando el estado. No se dibuja nada en vez de afirmar
  // "sin importar", que sería decir algo que no se sabe.
  if (estado === null) return null;

  const e = estadoAjustesNegativos(estado.montoNegativos, soles);

  return (
    <TarjetaWeb
      titulo="Ajustes del mes"
      sub={e.bloqueaLiquidacion ? 'Sin importar' : 'Importado'}
      icono={FileSpreadsheet}
      tono={e.bloqueaLiquidacion ? 'marca' : 'ok'}
      // El borde rojo SOLO cuando bloquean: una tarjeta que grita siempre deja
      // de significar nada.
      {...(e.bloqueaLiquidacion ? { style: styles.tarjetaBloqueante } : {})}
    >
      <Text style={styles.ajustesEstado}>{e.texto}</Text>
      <Text style={styles.parrafo}>
        Los ajustes a favor del personal salen del Excel de Dynamics: se importan, no se escriben a mano.
      </Text>
      <BotonWeb
        etiqueta={e.boton}
        icono={FileSpreadsheet}
        onPress={() => router.push({ pathname: '/auditor/ajustes-negativos', params: { inventarioId: String(inventarioId) } })}
      />
    </TarjetaWeb>
  );
}

/**
 * EL REPORTE A GERENCIA: los productos de la EMPRESA —no entran a la planilla
 * del personal— con sus faltantes y sobrantes, producto por producto. Qué
 * mostrar lo decide `vistaReporteGerencia`; acá solo se dibuja.
 */
function TarjetaReporteGerencia({
  vista,
  exportando,
  onExportar,
}: {
  vista: VistaReporteGerencia;
  exportando: boolean;
  onExportar: () => void;
}): JSX.Element {
  return (
    <TarjetaWeb
      titulo="Reporte a gerencia"
      sub={
        vista.tipo === 'con-datos'
          ? `${vista.faltantes.length + vista.sobrantes.length} ${pluralizar(vista.faltantes.length + vista.sobrantes.length, 'producto', 'productos')}`
          : 'Productos de la empresa'
      }
      icono={Building2}
      tono="atencion"
    >
      <Text style={styles.parrafo}>
        Productos de la empresa: no entran a la planilla del personal. Aquí están sus faltantes y sobrantes, producto por
        producto, para presentar a gerencia.
      </Text>

      {vista.tipo === 'cargando' ? (
        <ActivityIndicator color={colors.rojo} />
      ) : vista.tipo !== 'con-datos' ? (
        // El motivo REAL: "todavía no se liquidó", "no hubo productos de la
        // empresa" o el error del servidor. Nunca dos listas vacías.
        <Text style={[styles.parrafo, vista.tipo === 'error' && styles.reporteError]}>{vista.motivo}</Text>
      ) : (
        <>
          <FilaDato
            etiqueta={`Faltante de la empresa (${vista.faltantes.length})`}
            valor={soles(vista.totalFaltante)}
            color={colors.falta}
          />
          <FilaDato
            etiqueta={`Sobrante de la empresa (${vista.sobrantes.length})`}
            valor={soles(vista.totalSobrante)}
            color={colors.ok}
          />

          {/* Pegado a los totales: el que los lee tiene que saber que no incluyen todo. */}
          {vista.sinPrecio > 0 ? (
            <View style={styles.aviso}>
              <AlertTriangle size={16} color={colors.proceso} />
              <Text style={styles.avisoTexto}>{textoSinPrecioReporte(vista.sinPrecio)}</Text>
            </View>
          ) : null}

          <ListaReporteGerencia titulo="Faltantes" tipo="faltante" filas={vista.faltantes} />
          <ListaReporteGerencia titulo="Sobrantes" tipo="sobrante" filas={vista.sobrantes} />

          <BotonWeb
            etiqueta="Exportar a Excel y compartir"
            icono={FileSpreadsheet}
            onPress={onExportar}
            cargando={exportando}
            deshabilitado={exportando}
          />
        </>
      )}
    </TarjetaWeb>
  );
}

/**
 * Faltantes y sobrantes van en DOS listas, y cada fila lleva la señal por tres
 * vías: la lista en la que está, el color del borde y el signo de las unidades.
 */
function ListaReporteGerencia({
  titulo,
  tipo,
  filas,
}: {
  titulo: string;
  tipo: 'faltante' | 'sobrante';
  filas: FilaReporteGerencia[];
}): JSX.Element {
  return (
    <View style={styles.reporteLista}>
      <View style={styles.reporteEncabezado}>
        <Text style={styles.reporteTitulo}>{titulo}</Text>
        <Text style={styles.reporteTotal}>
          {filas.length} {pluralizar(filas.length, 'producto', 'productos')}
        </Text>
      </View>
      {filas.length === 0 ? (
        <Text style={styles.parrafo}>
          {tipo === 'faltante' ? 'Ningún producto de la empresa con faltante.' : 'Ningún producto de la empresa con sobrante.'}
        </Text>
      ) : (
        filas.map((f) => (
          <View key={f.codigo} style={[styles.reporteFila, tipo === 'faltante' ? styles.reporteFilaFalta : styles.reporteFilaSobra]}>
            <View style={styles.reporteDatos}>
              {/* Trunca al final: el producto se reconoce por cómo empieza el nombre. */}
              <Text style={styles.reporteNombre} numberOfLines={1} ellipsizeMode="tail">
                {f.descripcion}
              </Text>
              <Text style={styles.reporteSub}>
                Código {f.codigo} · {textoUnidadesReporte(tipo, f.unidades, formatoMiles)}
              </Text>
            </View>
            <Text
              style={[
                styles.reporteMonto,
                f.monto === null ? styles.reporteSinPrecio : tipo === 'faltante' ? styles.reporteMontoFalta : styles.reporteMontoSobra,
              ]}
            >
              {textoMontoReporte(f.monto, soles)}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

const tintaCartel = { ok: colors.ok, atencion: colors.proceso, neutro: colors.gris } as const;

const estilosCartel = StyleSheet.create({
  ok: { backgroundColor: colors.okSuave },
  atencion: { backgroundColor: colors.procesoSuave },
  neutro: { backgroundColor: colors.esperaSuave },
});

const styles = StyleSheet.create({
  pagina: { flex: 1 },
  contenido: { padding: spacing.xxl, gap: spacing.lg },
  centro: { flex: 1 },
  cargando: { marginTop: spacing.xxl },
  /** Acotado: el botón del encabezado es un recargar, no la acción de la página. */
  accionEncabezado: { width: 170 },

  banda: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.blanco,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borde,
    padding: spacing.lg,
    ...shadow.tarjeta,
  },
  bandaApilada: { flexDirection: 'column', alignItems: 'stretch' },
  bandaTienda: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bandaTextos: { flex: 1, gap: 2 },
  bandaEtiqueta: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },
  bandaTitulo: { fontSize: fontSize.lg, color: colors.tinta, fontFamily: fonts.bold },
  bandaSub: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },

  cartel: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.lg, padding: spacing.md, minWidth: 320 },
  cartelTextos: { flex: 1, gap: 1 },
  cartelTitulo: { fontSize: fontSize.lg, fontFamily: fonts.bold },
  cartelDetalle: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },

  /** El error de una acción: algo que la persona pidió no se hizo, y no puede pasar en silencio. */
  avisoAccion: {
    gap: 2,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.falta,
    backgroundColor: colors.faltaSuave,
  },
  avisoAccionTitulo: { fontSize: fontSize.base, color: colors.falta, fontFamily: fonts.bold },
  avisoAccionTexto: { fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.regular, lineHeight: 19 },

  fila: { flexDirection: 'row', gap: spacing.lg, alignItems: 'stretch' },
  filaApilada: { flexDirection: 'column' },

  parrafo: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular, lineHeight: 20 },
  /** Aclaración, no alarma. Sin recuadro. */
  nota: { fontSize: fontSize.xs, lineHeight: 17, color: colors.grisClaro, fontFamily: fonts.regular },
  separador: { height: 1, backgroundColor: colors.borde, marginVertical: spacing.xs },

  /** Los ajustes bloqueantes: borde rojo, el único de la página que no es el botón. */
  tarjetaBloqueante: { borderColor: colors.rojo },
  ajustesEstado: { fontSize: fontSize.lg, fontFamily: fonts.bold, color: colors.tinta },

  /**
   * `alignItems: 'flex-start'` para que el ícono quede a la altura de la
   * PRIMERA línea y no centrado sobre un párrafo de tres. Sin `numberOfLines`:
   * una advertencia truncada no advierte.
   */
  aviso: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xs,
    padding: spacing.sm + 2,
    borderRadius: radius.sm,
    // `proceso`/`procesoSuave`, el estado de ATENCIÓN del design system — no
    // `rojo` (que en esta app es siempre acción) ni `falta` (que es un dato del
    // inventario, no un aviso sobre el dato).
    backgroundColor: colors.procesoSuave,
    borderWidth: 1,
    borderColor: colors.proceso,
  },
  avisoTexto: { flex: 1, fontSize: fontSize.sm, lineHeight: 19, color: colors.tinta, fontFamily: fonts.regular },

  cierra: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  cierraTexto: { fontSize: fontSize.sm, color: colors.ok, fontFamily: fonts.semibold },

  // Los chips del filtro de la planilla: viven adentro del encabezado de
  // `TablaWeb`, a la derecha del título.
  chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borde,
    backgroundColor: colors.blanco,
  },
  chipActivo: { backgroundColor: colors.rojo, borderColor: colors.rojo },
  chipTexto: { fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.medium, fontVariant: ['tabular-nums'] },
  chipTextoActivo: { color: colors.blanco, fontFamily: fonts.bold },

  // Reporte a gerencia. Faltante con la paleta `falta` y sobrante con `ok`: son
  // datos del inventario, no avisos.
  reporteLista: { gap: spacing.sm, marginTop: spacing.xs },
  reporteEncabezado: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  reporteTitulo: { fontSize: fontSize.xs, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.gris, fontFamily: fonts.semibold },
  reporteTotal: { fontSize: fontSize.xs, color: colors.grisClaro, fontFamily: fonts.regular },
  reporteFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    backgroundColor: colors.blanco,
  },
  reporteFilaFalta: { borderColor: 'rgba(162,59,46,0.32)' },
  reporteFilaSobra: { borderColor: 'rgba(10,107,87,0.32)' },
  reporteDatos: { flex: 1, minWidth: 0, gap: 2 },
  reporteNombre: { fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.bold },
  reporteSub: { fontSize: fontSize.xs, color: colors.gris, fontFamily: fonts.regular },
  reporteMonto: { fontSize: fontSize.base, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  reporteMontoFalta: { color: colors.falta },
  reporteMontoSobra: { color: colors.ok },
  /** "Sin precio" es texto, no cifra: menor y sin negrita para no leerse como un monto. */
  reporteSinPrecio: { fontSize: fontSize.sm, fontFamily: fonts.regular, color: colors.gris },
  reporteError: { color: colors.falta },

  modalFondo: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  modalCaja: {
    width: '100%',
    maxWidth: 520,
    gap: spacing.sm,
    padding: spacing.xl,
    backgroundColor: colors.blanco,
    borderRadius: radius.xl,
    ...shadow.modal,
  },
  modalTitulo: { fontSize: fontSize.xl, color: colors.tinta, fontFamily: fonts.bold, marginBottom: spacing.xs },
  modalTexto: { fontSize: fontSize.base, lineHeight: 23, color: colors.gris, fontFamily: fonts.regular },
  modalAcciones: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  modalBoton: { flex: 1 },
});
