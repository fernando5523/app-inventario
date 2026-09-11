import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { AlertTriangle, Building2, Check, FileSpreadsheet, Layers, Scale, Wallet } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';

import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { BarraApp, Badge, Button, formatoFechaHora, formatoMiles } from '../../components/ui';
import { repositorioLiquidacion, repositorioSesion } from '../../lib/contenedor';
import { estadoAjustesNegativos, notaFaltanteEmpresa } from '../../lib/dominio/ajustes-formulario';
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

/**
 * La sucursal todavía no cerró ningún ciclo. NO es un error: es el estado
 * normal de una tienda mientras se está contando, o sea la mayor parte del
 * mes.
 *
 * Dice QUÉ falta y DÓNDE se hace, en ese orden. Antes esta pantalla mostraba
 * "No se pudo cargar la liquidación / Intentá de nuevo" con un botón
 * Reintentar — que no arreglaba nada, porque no había nada roto, y dejaba a
 * la persona tocando un botón en loop.
 */
const SIN_CICLO_CERRADO =
  'Todavía no hay un inventario con el conteo cerrado en esta tienda. Cuando se cierren las 3 rondas en Ciclo de conteos, vuelve aquí.';

/**
 * Auditor sin tienda en la ficha que todavía no eligió ninguna: no hay
 * sucursal que pedir, y la pantalla lo dice en vez de inventar una (ver
 * `sucursalEnFoco`).
 */
const SIN_SUCURSAL =
  'Elige la tienda en el Panel de auditoría (Sucursal a auditar): la liquidación sigue a la sucursal elegida.';

type Filtro = 'todos' | 'asistio' | 'falto';

const NOMBRE_ROL: Record<string, string> = { coordinador: 'Coordinador', conteo: 'Conteo', auditor: 'Auditor' };

function filtrar(planilla: DetalleLiquidacion[], filtro: Filtro): DetalleLiquidacion[] {
  if (filtro === 'asistio') return planilla.filter((p) => p.asistio);
  if (filtro === 'falto') return planilla.filter((p) => !p.asistio);
  return planilla;
}

/**
 * Liquidación y nómina (mobile/design/liquidacion.html) — acceso del
 * AUDITOR, cierre de fin de mes: faltante neto -> cuota base -> multas por
 * inasistencia, y la planilla de los 11 colaboradores filtrable.
 *
 * Fue del Coordinador hasta el 2026-09-11. Decisión del cliente: "el
 * Coordinador deja de ver la liquidacion y ejecutarlo, ahora lo realiza el
 * auditor" -- el backend ya le responde 403 (liquidacion.permisos.ts).
 *
 * Sigue la sucursal COMPARTIDA que el auditor eligió en Auditoría, Ciclo,
 * Historial o Inicio: audita toda la cadena, no una tienda (ver
 * lib/sucursal-auditada-contexto.tsx).
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
  const [liquidando, setLiquidando] = useState(false);
  /** Lo que devolvió `liquidar` en ESTA sesión: alimenta el cartel de "ya está cerrada". */
  const [cerrado, setCerrado] = useState<CierreLiquidacion | null>(null);
  /** El reporte a gerencia: solo se pide con la planilla ya cerrada (ver `cargar`). */
  const [reporte, setReporte] = useState<ReporteGerencia | null>(null);
  const [errorReporte, setErrorReporte] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  // La sucursal COMPARTIDA (contexto), no la de la ficha: mismo criterio que
  // lacrado.tsx. El padrón resuelve el nombre para la barra.
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
      // Piden lo mismo (el último ciclo cerrado de la sucursal): si uno es
      // null el otro también lo es, pero se piden en paralelo en vez de
      // encadenados porque no dependen entre sí.
      const [resultadoLiq, resultadoConc] = await Promise.all([
        repositorioLiquidacion.deSucursal(sucursalId),
        repositorioLiquidacion.conciliacion(sucursalId),
      ]);
      setLiquidacion(resultadoLiq);
      setConciliacion(resultadoConc);

      // Los ajustes SÍ van encadenados: cuelgan del inventario, y el id sale
      // de la liquidación que se acaba de traer. Sin ciclo cerrado no hay
      // inventario del que cargar ajustes.
      setAjustes(resultadoLiq === null ? null : await repositorioLiquidacion.ajustes(resultadoLiq.inventarioId));

      // EL REPORTE A GERENCIA, con su propio try: si falla, su tarjeta dice por
      // qué y el resto de la liquidación se sigue viendo. Y solo con la planilla
      // cerrada -- antes ni se pide: la tarjeta ya sabe explicar por qué no hay
      // (dominio/reporte-gerencia.ts#vistaReporteGerencia).
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
      // Sin esto, un fallo sin red dejaba el spinner girando para siempre
      // (mismo bug que f558689 arregló), y `useEffect` con deps `[sesion]`
      // tampoco reintentaba solo al volver a esta pantalla.
      setError(e instanceof Error ? e.message : 'No se pudo cargar la liquidación.');
    } finally {
      setCargando(false);
    }
  }, [sesion, sucursalId]);

  // Al enfocar Y al volver la app a primer plano -- pedido del cliente. Ver
  // components/hooks/useRefrescoAlEnfocar.ts. Es también lo que actualiza la
  // tarjeta de ajustes al volver de la pantalla del Excel.
  //
  // PAUSADO solo mientras se liquida: esta pantalla ya no tiene nada que
  // tipear (los ajustes entran por el Excel), así que no hay trabajo a medias
  // que un refresco pueda pisar.
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar, { pausado: liquidando });

  // Cambió la tienda elegida: `cargar` cambia con ella, pero
  // useRefrescoAlEnfocar solo recarga al enfocar. Se recarga YA, y se limpia
  // lo anterior ANTES: la barra ya dice la tienda nueva, y dejar la planilla
  // de la anterior sería un número con el apellido equivocado (mismo criterio
  // que auditoria.tsx). El primer render lo saltea: esa carga la hace el hook.
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
    setCargando(true);
    void cargar();
  }, [cargar]);

  const visibles = useMemo(() => (liquidacion ? filtrar(liquidacion.planilla, filtro) : []), [liquidacion, filtro]);

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  /**
   * PUNTO DE NO RETORNO de la nómina: al confirmar, los descuentos quedan
   * firmes y el inventario pasa a `liquidado`.
   *
   * La confirmación dice los DOS números que se están firmando (el faltante
   * neto y a cuánta gente alcanza) antes de la frase de advertencia: un
   * "¿estás seguro?" sin cifras no le da a nadie con qué decidir.
   *
   * El 409 del backend se muestra TAL CUAL. Sus mensajes dicen qué falta
   * —los ajustes, que nadie registró conteos, que ya se liquidó— y
   * reemplazarlos por un genérico borraría justo lo accionable.
   */
  function liquidarAhora(): void {
    if (!liquidacion || liquidacion.faltanteNeto === null) return;

    Alert.alert(
      'Cerrar la planilla',
      `Faltante neto: ${soles(liquidacion.faltanteNeto)}\n` +
        `Alcanza a ${liquidacion.planilla.length} colaboradores.\n\n` +
        'Esto cierra la planilla: los descuentos quedan firmes y el paso siguiente es el lacrado. No se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Liquidar', style: 'destructive', onPress: () => void confirmarLiquidacion() },
      ],
    );
  }

  async function confirmarLiquidacion(): Promise<void> {
    if (!liquidacion) return;
    setLiquidando(true);
    try {
      const cierre = await repositorioLiquidacion.liquidar(liquidacion.inventarioId);
      setCerrado(cierre);
      // Recarga: la pantalla pasa a mostrar la planilla FIRME, sin edición.
      await cargar();
    } catch (e) {
      Alert.alert('No se pudo cerrar la planilla', e instanceof Error ? e.message : 'Prueba de nuevo en un momento.');
    } finally {
      setLiquidando(false);
    }
  }

  /**
   * El .xlsx del reporte a gerencia: se baja a un archivo TEMPORAL (caché del
   * teléfono) y se abre el selector nativo para compartir -- mismo flujo que el
   * export de diferencias del Historial (HistorialScreen#exportarDiferencias):
   * el destino es WhatsApp o el correo, no el teléfono.
   */
  async function exportarReporte(): Promise<void> {
    if (!liquidacion) return;
    setExportando(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('No se puede compartir', 'Este dispositivo no tiene disponible el selector nativo para compartir archivos.');
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
      Alert.alert('No se pudo exportar', e instanceof Error ? e.message : 'Intenta de nuevo.');
    } finally {
      setExportando(false);
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

  /**
   * LA RESTA QUE DABA -2. Era `planilla.length - totalFaltas` con la planilla
   * vacía: 0 - 2. Ahora sale de `resumirAsistencia`, que garantiza que
   * ninguno de los dos números sea negativo y que sumen el universo.
   *
   * Y se cuenta sobre la planilla —proyectada o firme, según corresponda— en
   * vez de restar: quién asistió es un hecho por fila, no una diferencia.
   */
  const asistencia = liquidacion === null ? null : resumirAsistencia(liquidacion.planilla.length, liquidacion.planilla.filter((p) => p.asistio).length);
  const asistieron = datosCompletos ? asistencia!.asistieron : null;

  // A cuántos asistentes les tocó el centavo extra del reparto. La regla vive
  // en lib/dominio/reparto-visible.ts, no acá: así se prueba sin montar la
  // pantalla (ver reparto-visible.test.ts).
  const conCentavoExtra = datosCompletos
    ? asistentesConCentavoExtra(liquidacion.planilla, liquidacion.cuotaBase!, liquidacion.bonoAsistencia!)
    : 0;
  const hayCentavoDeReparto = conCentavoExtra > 0;

  return (
    <PantallaConTabs
      scrollable
      contentStyle={styles.contenido}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={colors.rojo} colors={[colors.rojo]} />}
    >
      <BarraApp
        rotulo="Gestión masiva"
        sede={nombreSucursal ? `Liquidación · ${nombreSucursal}` : 'Liquidación'}
        cifras={liquidacion ? `${liquidacion.periodo} · ${liquidacion.planilla.length} colaboradores` : undefined}
        onSalir={salir}
      />

      {/*
        TRES ESTADOS, no dos. Antes eran `error || !liquidacion` juntos, y
        eso hacía que una tienda SIN CICLO CERRADO —el caso más normal del
        mes, mientras se está contando— viera "No se pudo cargar la
        liquidación / Intentá de nuevo" con un botón Reintentar que no iba a
        arreglar nada, porque no había nada roto.

        Decirle "reintentá" a alguien cuyo problema es que todavía no cerró
        las rondas lo manda a tocar un botón en loop en vez de a la pantalla
        donde sí puede avanzar.
      */}
      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : sucursalId === null ? (
        <View style={styles.tarjeta}>
          <Text style={styles.tarjetaTitulo}>Elige una tienda</Text>
          <Text style={styles.tarjetaTexto}>{SIN_SUCURSAL}</Text>
          <Button label="Ir al Panel de auditoría" variant="outline" onPress={() => router.push('/auditor/auditoria')} />
        </View>
      ) : error !== null ? (
        <View style={styles.tarjeta}>
          <Text style={styles.tarjetaTitulo}>No se pudo cargar la liquidación</Text>
          <Text style={styles.tarjetaTexto}>{error}</Text>
          {/* Reintentar SOLO acá: es lo único que un problema de red puede arreglar. */}
          <Button label="Reintentar" onPress={cargar} />
        </View>
      ) : liquidacion === null ? (
        <View style={styles.tarjeta}>
          <View style={styles.tarjetaCabecera}>
            <Layers size={18} color={colors.gris} />
            <Text style={styles.tarjetaTitulo}>Todavía no hay nada que liquidar</Text>
          </View>
          <Text style={styles.tarjetaTexto}>{SIN_CICLO_CERRADO}</Text>
          <Button label="Ir al ciclo de conteos" variant="outline" onPress={() => router.push('/auditor/ciclo')} />
        </View>
      ) : (
        <>
          {/*
            LOS AJUSTES VAN PRIMERO, antes del resumen, y no es cosmético:
            mientras no se importe el Excel, el faltante neto y la cuota por
            persona son `null` y toda la pantalla de abajo muestra "no se
            puede calcular". Poner la tarjeta arriba es poner primero lo único
            accionable.
          */}
          <TarjetaAjustesDelMes inventarioId={liquidacion.inventarioId} estado={ajustes} />

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
              {/* Dato CALCULADO y de solo lectura: ya no se tipea (backend
                  48899bc). Se dice de dónde sale para que nadie busque dónde
                  corregirlo. */}
              <Text style={styles.notaReparto}>{notaFaltanteEmpresa(liquidacion.proyectada)}</Text>
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
              Auditor lo vea ANTES de liquidar, no después de que alguien
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
            {/*
              PROYECTADA vs FIRME, y el título es la única señal. Antes de
              liquidar son las filas que VAN A pasar: llamarlas "Planilla de
              descuentos" a secas haría creer que el descuento ya está hecho.
            */}
            <Text style={styles.seccionTitulo}>
              {liquidacion.proyectada ? 'Planilla proyectada' : 'Planilla de descuentos'}
            </Text>
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

          {/*
            EL CIERRE DE LA PLANILLA va al FINAL, después de la planilla y la
            conciliación. No es orden estético: es lo último que se hace, y
            ponerlo arriba invitaría a firmar sin haber mirado los números que
            se firman.
          */}
          {cerrado !== null ? (
            <View style={styles.tarjeta}>
              <View style={styles.tarjetaCabecera}>
                <Check size={18} color={colors.ok} />
                <Text style={styles.tarjetaTitulo}>Planilla cerrada</Text>
                <Badge label="Liquidado" variant="ok" />
              </View>
              <Text style={styles.tarjetaTexto}>
                Liquidado el {formatoFechaHora(new Date().toISOString())} por {sesion.colaborador.nombre}. Los descuentos de{' '}
                {cerrado.colaboradores} colaboradores quedaron firmes por {soles(cerrado.totalDescontado)} en total.
              </Text>
              <Text style={styles.tarjetaTexto}>
                El paso que sigue es la aprobación y el lacrado: el sello incluye esta planilla.
              </Text>
              <Button label="Ir a aprobación y lacrado" variant="outline" onPress={() => router.push('/auditor/lacrado')} />
            </View>
          ) : (
            <CierreDePlanilla
              liquidacion={liquidacion}
              ajustes={ajustes}
              liquidando={liquidando}
              onLiquidar={liquidarAhora}
            />
          )}

          {/*
            EL REPORTE A GERENCIA va después del cierre: sale de la planilla
            cerrada (qué es de la empresa recién queda fijo al liquidar), así que
            es lo último que se mira. Antes de liquidar la tarjeta está igual y
            dice por qué todavía no hay reporte -- nunca se muestra vacía.
          */}
          <TarjetaReporteGerencia
            vista={vistaReporteGerencia({ proyectada: liquidacion.proyectada, reporte, error: errorReporte })}
            exportando={exportando}
            onExportar={exportarReporte}
          />
        </>
      )}
    </PantallaConTabs>
  );
}

/**
 * EL PASO QUE NO EXISTÍA EN LA APP.
 *
 * `POST /liquidacion/inventarios/:id/liquidar` estaba en el backend desde
 * 381e6b6 y ninguna pantalla lo llamaba: el inventario nunca llegaba a
 * `liquidado` desde el teléfono, y como el lacrado exige ese estado, todo el
 * cierre del mes quedaba inalcanzable. La decisión del cliente "liquidar
 * primero, lacrar después" no se podía ejecutar.
 *
 * Habilitado SOLO con los ajustes registrados y el resumen calculable: son
 * las dos condiciones que el backend exige, y un botón que se puede tocar
 * para recibir un 409 es un botón que enseña a ignorar los errores.
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
   * ASISTENTES REALES, de la planilla PROYECTADA.
   *
   * Antes esto era `liquidacion.planilla.length > 0`, y era un candado que
   * pedía su propia llave: la planilla sale de `LiquidacionColaborador`, que
   * el backend solo llena AL liquidar. El botón nunca se habilitaba.
   *
   * Ahora el backend proyecta las filas antes de firmar, así que se puede
   * preguntar lo que de verdad importa: si hay alguien que haya contado. Con
   * 0 asistentes el backend rechaza igual (409), y un botón que se puede
   * tocar para recibir un error enseña a ignorar los errores.
   */
  const asistentes = liquidacion.planilla.filter((p) => p.asistio).length;
  const puedeLiquidar = ajustesListos && calculable && asistentes > 0;

  return (
    <View style={styles.tarjeta}>
      <View style={styles.tarjetaCabecera}>
        <Wallet size={18} color={colors.rojo} />
        <Text style={styles.tarjetaTitulo}>Cerrar la planilla</Text>
      </View>

      {puedeLiquidar ? (
        <Text style={styles.tarjetaTexto}>
          Vas a dejar firmes los descuentos de {liquidacion.planilla.length} colaboradores por{' '}
          {soles(liquidacion.faltanteNeto!)} de faltante neto. Después de esto sigue el lacrado.
        </Text>
      ) : (
        // Dice QUÉ falta, no "no se puede": si el botón está apagado, la
        // persona tiene que saber qué ir a hacer.
        <Text style={styles.tarjetaTexto}>
          {!ajustesListos
            ? 'Primero importa el Excel de ajustes del mes, arriba. Sin eso no se puede calcular lo que se le descuenta a cada persona.'
            : asistentes === 0
              ? 'Ningún colaborador registró conteos en este inventario: no hay asistencia deducible ni a quién repartir el faltante. Revisa que las hojas tengan conteos cargados.'
              : 'Todavía no se puede calcular la planilla: revisa las advertencias de arriba.'}
        </Text>
      )}

      <Button
        label={liquidando ? 'Cerrando la planilla…' : 'Liquidar este inventario'}
        onPress={onLiquidar}
        disabled={!puedeLiquidar || liquidando}
      />
    </View>
  );
}

/**
 * LOS AJUSTES DEL MES: la ENTRADA a la pantalla del Excel de Dynamics
 * (app/auditor/ajustes-negativos.tsx), con el estado real de la importación.
 *
 * Acá había un formulario (monto a favor, monto de empresa y nota) y ya no
 * queda nada que tipear:
 *  - el monto a favor del personal entra por el Excel (backend e39b370): un
 *    número escrito acá el servidor lo ignoraba;
 *  - el faltante de empresa lo calcula la clasificación de productos (backend
 *    48899bc) y se muestra en el resumen;
 *  - la nota documentaba esos montos escritos a mano. Sin ellos no documenta
 *    nada: no la lee el Historial ni el sello, no destraba liquidar, y su
 *    "registrado por" se confundiría con quien importó el Excel. Un formulario
 *    con solo eso sería un campo por llenar sin ninguna consecuencia.
 *
 * `null` = nadie importó el Excel (bloquea liquidar); un número, 0 incluido,
 * es lo importado. Dos carteles distintos (dominio/ajustes-formulario.ts).
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
    <View style={[styles.tarjeta, e.bloqueaLiquidacion && styles.tarjetaBloqueante]}>
      <View style={styles.tarjetaCabecera}>
        <FileSpreadsheet size={18} color={e.bloqueaLiquidacion ? colors.rojo : colors.tinta} />
        <Text style={styles.tarjetaTitulo}>Ajustes del mes</Text>
        <Badge label={e.bloqueaLiquidacion ? 'Sin importar' : 'Importado'} variant={e.bloqueaLiquidacion ? 'falta' : 'ok'} />
      </View>

      <Text style={styles.ajustesEstado}>{e.texto}</Text>
      <Text style={styles.tarjetaTexto}>
        Los ajustes a favor del personal salen del Excel de Dynamics: se importan, no se escriben a mano.
      </Text>

      <Button
        label={e.boton}
        variant={e.bloqueaLiquidacion ? 'primary' : 'outline'}
        onPress={() => router.push({ pathname: '/auditor/ajustes-negativos', params: { inventarioId: String(inventarioId) } })}
      />
    </View>
  );
}

/**
 * EL REPORTE A GERENCIA: los productos de la EMPRESA -- no entran a la
 * planilla del personal -- con sus faltantes y sobrantes, producto por
 * producto (pedido del cliente: "listar detallado, tanto sobrante como
 * faltante"). Qué mostrar lo decide `vistaReporteGerencia`; acá solo se dibuja.
 *
 * Faltantes y sobrantes van en DOS listas, y cada fila lleva la señal por tres
 * vías: la lista en la que está, el color del borde y el signo de las unidades.
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
    <View style={styles.tarjeta}>
      <View style={styles.tarjetaCabecera}>
        <Building2 size={18} color={colors.rojo} />
        <Text style={styles.tarjetaTitulo}>Reporte a gerencia</Text>
        {vista.tipo === 'con-datos' ? <Badge label={`${vista.faltantes.length + vista.sobrantes.length} productos`} /> : null}
      </View>
      <Text style={styles.tarjetaTexto}>
        Productos de la empresa: no entran a la planilla del personal. Aquí están sus faltantes y sobrantes, producto por
        producto, para presentar a gerencia.
      </Text>

      {vista.tipo === 'cargando' ? (
        <ActivityIndicator color={colors.rojo} />
      ) : vista.tipo !== 'con-datos' ? (
        // El motivo REAL: "todavía no se liquidó", "no hubo productos de la
        // empresa" o el error del servidor. Nunca dos listas vacías.
        <Text style={[styles.tarjetaTexto, vista.tipo === 'error' && styles.reporteError]}>{vista.motivo}</Text>
      ) : (
        <>
          <View style={styles.resumen}>
            <View style={styles.resumenFila}>
              <Text style={styles.resumenEtiqueta}>Faltante de la empresa ({vista.faltantes.length})</Text>
              <Text style={[styles.resumenValor, styles.reporteMontoFalta]}>{soles(vista.totalFaltante)}</Text>
            </View>
            <View style={styles.resumenFila}>
              <Text style={styles.resumenEtiqueta}>Sobrante de la empresa ({vista.sobrantes.length})</Text>
              <Text style={[styles.resumenValor, styles.reporteMontoSobra]}>{soles(vista.totalSobrante)}</Text>
            </View>
          </View>

          {/* Pegado a los totales: el que los lee tiene que saber que no incluyen todo. */}
          {vista.sinPrecio > 0 ? (
            <View style={styles.aviso}>
              <AlertTriangle size={16} color={colors.proceso} />
              <Text style={styles.avisoTexto}>{textoSinPrecioReporte(vista.sinPrecio)}</Text>
            </View>
          ) : null}

          <ListaReporteGerencia titulo="Faltantes" tipo="faltante" filas={vista.faltantes} />
          <ListaReporteGerencia titulo="Sobrantes" tipo="sobrante" filas={vista.sobrantes} />

          <Button
            label="Exportar a Excel y compartir"
            icon={FileSpreadsheet}
            onPress={onExportar}
            loading={exportando}
            disabled={exportando}
          />
        </>
      )}
    </View>
  );
}

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
      <View style={styles.seccion}>
        <Text style={styles.seccionTitulo}>{titulo}</Text>
        <Text style={styles.seccionTotal}>
          {filas.length} {filas.length === 1 ? 'producto' : 'productos'}
        </Text>
      </View>
      {filas.length === 0 ? (
        <Text style={styles.tarjetaTexto}>
          {tipo === 'faltante' ? 'Ningún producto de la empresa con faltante.' : 'Ningún producto de la empresa con sobrante.'}
        </Text>
      ) : (
        filas.map((f) => (
          <View key={f.codigo} style={[styles.reporteFila, tipo === 'faltante' ? styles.reporteFilaFalta : styles.reporteFilaSobra]}>
            <View style={styles.personaDatos}>
              {/* Trunca al final: el producto se reconoce por cómo empieza el nombre. */}
              <Text style={styles.personaNombre} numberOfLines={1} ellipsizeMode="tail">
                {f.descripcion}
              </Text>
              <Text style={styles.personaSub}>
                Código {f.codigo} · {textoUnidadesReporte(tipo, f.unidades, formatoMiles)}
              </Text>
            </View>
            <Text
              style={[
                styles.personaMontoValor,
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

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md + 3 },
  cargando: { marginTop: spacing.xxxl },

  // Ajustes del mes. El borde rojo solo cuando BLOQUEAN: una tarjeta que
  // grita siempre deja de significar nada.
  tarjetaBloqueante: { borderColor: colors.rojo },
  ajustesEstado: { fontSize: fontSize.lg, fontFamily: fonts.bold, color: colors.tinta },

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

  // Reporte a gerencia. Faltante con la paleta `falta` y sobrante con `ok`: son
  // datos del inventario, no avisos (el aviso de "sin precio" sí usa `proceso`).
  reporteLista: { gap: 9 },
  reporteFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: colors.campo,
  },
  reporteFilaFalta: { borderColor: 'rgba(162,59,46,0.32)' },
  reporteFilaSobra: { borderColor: 'rgba(10,107,87,0.32)' },
  reporteMontoFalta: { color: colors.falta },
  reporteMontoSobra: { color: colors.ok },
  /** "Sin precio" es texto, no cifra: menor y sin negrita para no leerse como un monto. */
  reporteSinPrecio: { fontSize: 12, fontFamily: fonts.regular, color: colors.gris },
  reporteError: { color: colors.falta },
});
