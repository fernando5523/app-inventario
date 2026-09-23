import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { BarChart3, ChevronRight, FileSpreadsheet, PencilLine } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import {
  BandaSync,
  BarraApp,
  EmptyState,
  SelectorSucursal,
  formatoMoneda as formatoNumeroMoneda,
} from '../../components/ui';
import { repositorioAuditoria, repositorioHistorial, repositorioInventario, repositorioSesion } from '../../lib/contenedor';
import {
  estadoExportacionCuadros,
  nombreCuadrosDeRespaldo,
  notaExportacionCuadros,
} from '../../lib/dominio/exportar-cuadros';
import { pagaLaEmpresa } from '../../lib/dominio/auditoria';
import { pluralizar } from '../../lib/dominio/plural';
import { sucursalEnFoco } from '../../lib/dominio/sucursal-en-foco';
import type { Sucursal } from '../../lib/dominio/tipos';
import type { EstadoInventario, ResumenAuditoriaServidor } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { useSucursalAuditada } from '../../lib/sucursal-auditada-contexto';
import { colors, fonts, radius } from '../../lib/theme';

/**
 * Panel de auditoría (mobile/design/auditoria.html) — matriz comparativa
 * ERP vs los 3 conteos. Esta pantalla SÍ muestra cifras del ERP a
 * propósito: el conteo ciego aplica a quien CUENTA (app/conteo/contar.tsx),
 * no a quien audita — el Auditor existe justamente para comparar contra
 * Dynamics.
 */
/**
 * Un monto del servidor. `undefined` = todavía no llegó, y ahí va "—", NUNCA
 * "S/ 0,00": un cero inventado sobre un faltante dice "no falta nada", que es
 * una afirmación distinta de "todavía no lo sé".
 */
function montoOSinDato(valor: number | undefined, esFaltante: boolean): string {
  if (valor === undefined) return '—';
  // `formatoNumeroMoneda` (el crudo) y no el `formatoMoneda` de este archivo:
  // ese ya antepone el signo, y acá lo decide `esFaltante` -- el servidor manda
  // los montos SIEMPRE en positivo (ver `CuadroDeDiferencias` en el puerto).
  return `${esFaltante && valor !== 0 ? '-' : ''}S/ ${formatoNumeroMoneda(valor)}`;
}

export default function AuditoriaScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * EL RESUMEN DEL SERVIDOR: los montos y los cuadros.
   *
   * Los CONTEOS se siguen resumiendo acá (`resumirAuditoria` sobre la matriz),
   * pero el reparto entre cuadros no se puede hacer desde el teléfono: depende
   * del umbral congelado en el inventario, que no viaja en ninguna respuesta.
   * `null` mientras no llegó, y ahí los montos se muestran como "—": un 0
   * inventado diría "no falta nada".
   */
  const [resumenServidor, setResumenServidor] = useState<ResumenAuditoriaServidor | null>(null);
  /**
   * EL INVENTARIO EN FOCO, con su estado. Antes solo se usaba el `inventarioId`
   * de `activo()` para pedir la matriz y se descartaba el resto; la descarga de
   * la planilla necesita las dos cosas: el id para pedirla y el ESTADO para
   * decidir si tiene sentido bajarla (ver dominio/exportar-cuadros.ts).
   * `null` = no hay inventario abierto en esta sucursal.
   */
  const [enFoco, setEnFoco] = useState<{
    id: number;
    estado: EstadoInventario;
  } | null>(null);
  const [bajandoPlanilla, setBajandoPlanilla] = useState(false);

  // El Auditor NO tiene tienda: audita toda la cadena y ELIGE cuál mirar. El
  // padrón de sucursales es el mismo endpoint del login (`GET /api/sesion/
  // sucursales`), sin gate de permiso. `sucursalElegida` null = todavía no
  // eligió (arranca en la de su ficha, ver sucursalEnFoco), cambiable.
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  // COMPARTIDA entre las pantallas del auditor: elegir acá también cambia el
  // Ciclo, el Historial y el Inicio (ver lib/sucursal-auditada-contexto.tsx).
  const { elegida: sucursalElegida, elegir: setSucursalElegida } = useSucursalAuditada();
  useEffect(() => {
    repositorioSesion.sucursales().then(setSucursales);
  }, []);

  const cargar = useCallback(async () => {
    if (!sesion) return;
    const sucursalId = sucursalEnFoco({
      rol: sesion.colaborador.rol,
      sucursalDeSesion: sesion.sucursal?.id ?? null,
      elegida: sucursalElegida,
    });
    // Sin sucursal elegida no hay inventario que pedir. Y al cambiar de
    // sucursal se limpia lo anterior: la matriz de Market Bolívar no puede
    // quedar en pantalla cuando ya se pidió la de Carhuaz.
    if (sucursalId === null) {
      setResumenServidor(null);
      setEnFoco(null);
      setCargando(false);
      return;
    }
    setError(null);
    try {
      const activo = await repositorioInventario.activo(sucursalId);
      if (!activo) {
        setResumenServidor(null);
        setEnFoco(null);
        setCargando(false);
        return;
      }
      setEnFoco({ id: activo.inventarioId, estado: activo.estado });
      /**
       * SOLO EL RESUMEN. El panel PEDÍA TAMBIÉN LA MATRIZ y la recorría en el
       * teléfono para sacar los contadores del encabezado. Desde que la matriz
       * se mudó a `/auditor/matriz` (2026-09-22) eso serían hasta 16 páginas
       * de API -- 8.000 ítems con sus conteos y su atribución -- para pintar
       * una línea de texto que el servidor ya sabe calcular. Todos los números
       * de esta pantalla vienen ahora de `resumen()`.
       */
      setResumenServidor(await repositorioAuditoria.resumen(activo.inventarioId));
    } catch (e) {
      // Sin esto, un fallo sin red dejaba el spinner girando para siempre:
      // la excepción cortaba la función antes de llegar al
      // `setCargando(false)` de abajo (mismo bug que f558689 arregló).
      setError(e instanceof Error ? e.message : 'No se pudo cargar el resumen de auditoría.');
    } finally {
      setCargando(false);
    }
  }, [sesion, sucursalElegida]);

  // Los tabs quedan montados una vez visitados — sin esto, la matriz sigue
  // mostrando datos viejos si el ciclo de conteos avanzó mientras el Auditor
  // estaba en otra pestaña. Ahora también refresca al volver la app del
  // segundo plano, que es el caso que faltaba: el Auditor deja el teléfono
  // sobre el mostrador con la matriz abierta mientras se cierra la ronda.
  // Ver components/hooks/useRefrescoAlEnfocar.ts.
  //
  // Sin `pausado`: esta pantalla no edita nada, solo filtra (y el filtro es
  // estado local que `cargar` no toca).
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar);

  // Cambió la sucursal elegida (`cargar` cambia con ella): recargar YA --
  // useRefrescoAlEnfocar solo recarga al enfocar. Y limpiar la matriz ANTES de
  // que llegue la nueva: la barra ya dice la tienda nueva, mostrar los ítems de
  // la anterior sería un número con el apellido equivocado (skill, Honestidad
  // de los datos). El primer render lo saltea (esa carga la hace el hook).
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    setResumenServidor(null);
    // Y el inventario en foco: si no, el botón de la planilla quedaría
    // apuntando al inventario de la tienda ANTERIOR mientras llega la nueva --
    // bajaría el archivo de otra sucursal con la barra diciendo esta.
    setEnFoco(null);
    setCargando(true);
    void cargar();
  }, [cargar]);

  if (!sesion) return <View />;

  // La sucursal EFECTIVA (la elegida, o la de la ficha como default): manda en
  // la barra, en el chip activo y en lo que se pide. Ver sucursalEnFoco.
  const sucursalId = sucursalEnFoco({
    rol: sesion.colaborador.rol,
    sucursalDeSesion: sesion.sucursal?.id ?? null,
    elegida: sucursalElegida,
  });
  const nombreSucursal = sucursales.find((s) => s.id === sucursalId)?.nombre ?? sesion.sucursal?.nombre;
  // Opciones del conjunto REAL (el padrón), en el orden del backend (id asc).

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  /**
   * LA PLANILLA DE CUADROS: se baja a un archivo TEMPORAL (caché del teléfono,
   * no Descargas) y de ahí se abre el selector nativo para compartir -- mismo
   * flujo que el export de diferencias del Historial
   * (HistorialScreen#exportarDiferencias), porque el destino es el mismo:
   * WhatsApp o correo, no el teléfono.
   *
   * LA DIFERENCIA está en el nombre: acá viene del servidor
   * (`Content-Disposition`) en vez de rearmarse en el teléfono, porque el panel
   * no tiene el período ni el nombre de la sucursal. Si no viniera, se guarda
   * con un nombre mínimo y HONESTO en vez de un `download.xlsx` -- ver
   * dominio/exportar-cuadros.ts.
   */
  async function bajarPlanillaDeCuadros(): Promise<void> {
    if (!enFoco) return;
    setBajandoPlanilla(true);
    try {
      const puedeCompartir = await Sharing.isAvailableAsync();
      if (!puedeCompartir) {
        Alert.alert(
          'No se puede compartir',
          'Este dispositivo no tiene disponible el selector nativo para compartir archivos.',
        );
        return;
      }
      const { bytes, nombreArchivo } = await repositorioHistorial.exportarCuadros(enFoco.id);
      const archivo = new File(Paths.cache, nombreArchivo ?? nombreCuadrosDeRespaldo(enFoco.id));
      if (archivo.exists) archivo.delete();
      archivo.write(new Uint8Array(bytes));
      await Sharing.shareAsync(archivo.uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        // Nombra LA PLANILLA y no "el Excel": el Auditor tiene dos .xlsx de
        // este inventario, y el selector nativo es lo último que ve antes de
        // mandarlo.
        dialogTitle: 'Compartir la planilla de cuadros',
        UTI: 'org.openxmlformats.spreadsheetml.sheet',
      });
    } catch (e) {
      Alert.alert('No se pudo bajar la planilla', e instanceof Error ? e.message : 'Intenta de nuevo.');
    } finally {
      setBajandoPlanilla(false);
    }
  }

  function irALacrado(): void {
    // Va a aprobación y lacrado (app/auditor/lacrado.tsx). La maqueta
    // (auditoria.html) decía "Generar liquidación": la liquidación también es
    // del Auditor desde el 2026-09-11, y se abre desde Inicio ("Liquidación y
    // nómina"), antes del lacrado.
    router.push('/auditor/lacrado');
  }

  /**
   * TODAS LAS CIFRAS SALEN DEL SERVIDOR, no de recorrer la matriz acá.
   *
   * Antes esta pantalla llamaba a `resumirAuditoria(items)` sobre la matriz
   * completa. Al mudarse la matriz a `/auditor/matriz` el panel dejó de
   * pedirla, así que los contadores tenían que venir con el resumen o dejar de
   * existir -- `contados` se agregó al DTO para esto (ver `ResumenAuditoria`
   * en el backend). Mientras no llegó, `undefined`: se muestra "—" y nunca un
   * 0, que diría "no falta nada" sobre un dato que todavía no se sabe.
   */
  const contados = resumenServidor?.contados;
  const totalItems = resumenServidor?.items;
  const cuadrados = resumenServidor?.cuadrados ?? 0;
  const auditables = resumenServidor?.auditables ?? 0;
  const sinContar = resumenServidor?.sinContar ?? 0;
  const sinDatoErp = resumenServidor?.sinDatoErp ?? 0;
  // `conFalta + deEmpresa` y no un campo nuevo: es LA MISMA definición que ya
  // tiene el dominio (`resumirAuditoria#conDiferencia`, "ítems con una
  // diferencia REAL != 0"), así que derivarla acá no inventa una segunda
  // cuenta que pueda discrepar.
  const conDiferencia = resumenServidor === null ? 0 : resumenServidor.conFalta + resumenServidor.deEmpresa;

  const cuadros = resumenServidor?.porClase ?? null;

  /**
   * SI LA PLANILLA DE CUADROS TIENE SENTIDO HOY, y si no, por qué no. El botón
   * NO desaparece: el Auditor que viene a bajar el archivo que arma a mano
   * tiene que encontrar el camino y leer qué falta, no un hueco (misma lección
   * que el export del Historial, ver dominio/exportar-cuadros.ts).
   *
   * `auditables` y no `items.length`: lo que hace inútil al archivo es no tener
   * con qué comparar, no tener pocos ítems.
   */
  const planilla = enFoco === null ? null : estadoExportacionCuadros(enFoco.estado, auditables);
  const notaPlanilla = enFoco === null ? null : notaExportacionCuadros(enFoco.estado);
  const planillaBloqueada = planilla !== null && !planilla.puedeExportar;

  return (
    <PantallaConTabs
      scrollable
      contentStyle={styles.contenido}
      /* `scrollable` VUELVE con la mudanza de la matriz: lo había perdido
         porque una FlatList virtualizada adentro de un ScrollView no
         virtualiza nada, así que la lista tenía que ser la única que
         scrolleara. Sin lista, el contenido necesita su propio scroll -- si
         no, las tarjetas de abajo quedan fuera de la pantalla en un teléfono
         chico y el botón de lacrado no se alcanza. Y el "tirar para
         refrescar" se muda con él: vivía en la FlatList. */
      refreshControl={
        <RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={colors.rojo} colors={[colors.rojo]} />
      }
    >
      <BarraApp
        rotulo="Auditoría · Panel de auditoría"
        sede={nombreSucursal}
        cifras={
          cargando || contados === undefined || totalItems === undefined
            ? undefined
            : `${contados} de ${totalItems} ${pluralizar(totalItems, 'ítem contado', 'ítems contados')} · ${conDiferencia} con diferencia`
        }
        onSalir={salir}
      />

      <BandaSync estado="ok" mensaje="Sincronizado" />

      {/* El Auditor no tiene tienda: elige la que audita. Siempre visible
          (también con la matriz vacía), para poder cambiar de sucursal cuando
          la actual no tiene inventario en curso. */}
      <SelectorSucursal
        label="Sucursal a auditar"
        sucursales={sucursales}
        sucursalId={sucursalId}
        onElegir={setSucursalElegida}
      />

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : error ? (
        <View style={styles.tarjetaResumen}>
          <Text style={styles.resumenTitulo}>No se pudo cargar la auditoría</Text>
          <Text style={styles.tarjetaTexto}>{error}</Text>
          <Pressable style={styles.accion} onPress={cargar}>
            <Text style={styles.accionTexto}>Reintentar</Text>
          </Pressable>
        </View>
      ) : resumenServidor === null || resumenServidor.items === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="Todavía no hay nada para auditar"
          subtitle="No hay un inventario en curso para esta sucursal, o el ciclo de conteos no cerró ningún ítem todavía."
        />
      ) : (
        // CONTENIDO NORMAL, ya no una FlatList. La lista se mudó a
        // `/auditor/matriz` (2026-09-22) y con ella se fue la única razón para
        // que esta pantalla no usara el scroll de `PantallaConTabs`: una lista
        // virtualizada adentro de otra que también scrollea no virtualiza nada.
        // Sin lista, `scrollable` vuelve y el contenido scrollea solo -- son
        // cinco tarjetas y tres botones, no 8.000 renglones.
        <>
          <View style={styles.tarjetaResumen}>
            <Text style={styles.resumenTitulo}>Resultado del conteo</Text>
            <View style={styles.resumenFila}>
              <Text style={styles.resumenEtiqueta}>Cuadrado</Text>
              {/* Denominador = AUDITABLES (con ERP y con conteo), nunca el
                      total: un ítem que nadie contó no entra al "cuadrado X de Y". */}
              <Text style={[styles.resumenValor, cuadrados > 0 && { color: colors.ok }]}>
                {cuadrados} <Text style={styles.resumenPct}>de {auditables} auditables</Text>
              </Text>
            </View>
            {sinContar > 0 ? (
              <View style={styles.resumenFila}>
                <Text style={styles.resumenEtiqueta}>Sin contar</Text>
                {/* Neutro a propósito: un vacío no es ni éxito ni faltante. */}
                <Text style={[styles.resumenValor, styles.resumenNeutro]}>{sinContar}</Text>
              </View>
            ) : null}
            {sinDatoErp > 0 ? (
              <View style={styles.resumenFila}>
                <Text style={styles.resumenEtiqueta}>Sin dato del ERP</Text>
                <Text style={[styles.resumenValor, styles.resumenNeutro]}>{sinDatoErp}</Text>
              </View>
            ) : null}
            {/*
              FALTANTE Y SOBRANTE, Y DEBAJO A QUIEN LE TOCA CADA PARTE.

              Los tres renglones de abajo son el reparto que vivía en una
              tarjeta aparte ("A qué cuadro fue cada diferencia"), que el
              usuario sacó el 2026-09-23 porque no le hacía sentido: son tres
              cifras, no tres tablas. Salen del MISMO `porClase` del servidor
              que alimentaba esa tarjeta -- acá no se recalcula nada.

              EL BRUTO Y EL REPARTO SEPARADOS es lo único que no se puede
              simplificar: con 44 de 46 unidades yéndose al cuadro de paquetes,
              un solo "Faltante -S/460" hacía pensar que se le descontaban
              S/460 al personal cuando se le descuentan S/20.
            */}
            <View style={styles.resumenFila}>
              {/* "del conteo", NO "neto": es la comparación contra el ERP, ANTES
                  de los ajustes del mes. El neto sale de Liquidación. */}
              <Text style={styles.resumenEtiqueta}>Faltante del conteo</Text>
              <Text style={styles.resumenValor}>{montoOSinDato(resumenServidor?.valorFaltante, true)}</Text>
            </View>
            <View style={styles.resumenFila}>
              <Text style={styles.resumenEtiqueta}>Sobrante del conteo</Text>
              <Text style={[styles.resumenValor, { color: colors.ok }]}>
                {montoOSinDato(resumenServidor?.valorSobrante, false)}
              </Text>
            </View>

            {/* La línea que separa las dos lecturas —arriba cuánto se movió en
                total, abajo a quién le toca— la dibuja `resumenFilaDestacada`
                con su borde superior, que ya existía. Un `View` separador
                aparte pintaba una SEGUNDA línea a dos píxeles de la primera. */}
            <View style={[styles.resumenFila, styles.resumenFilaDestacada]}>
              <Text style={styles.resumenEtiquetaFuerte}>Se le descuenta al personal</Text>
              <Text style={[styles.resumenValor, styles.resumenValorFuerte]}>
                {montoOSinDato(cuadros?.unidad.valorFaltante, true)}
              </Text>
            </View>
            <View style={styles.resumenFila}>
              <Text style={styles.resumenEtiqueta}>Se audita aparte (paquete)</Text>
              <Text style={styles.resumenValor}>{montoOSinDato(cuadros?.paquete.valorFaltante, true)}</Text>
            </View>
            <View style={styles.resumenFila}>
              <Text style={styles.resumenEtiqueta}>Lo asume la empresa</Text>
              <Text style={styles.resumenValor}>{montoOSinDato(cuadros?.empresa.valorFaltante, true)}</Text>
            </View>
          </View>

          {/*
            PRODUCTOS DE EMPRESA, SIEMPRE VISIBLE -- también con 0.

            Que el Auditor lea "Productos contados 0" es información: nadie
            clasificó nada como empresa todavía. Una tarjeta que aparece y
            desaparece según haya datos hace dudar de si el dato existe o si la
            pantalla se lo comió. (El cuadro de empresa de la tarjeta vieja sí
            se escondía en cero, y esa regla murió con esa tarjeta: ahí competía
            con otros dos cuadros, acá es la tarjeta entera.)
          */}
          <View style={styles.tarjetaResumen}>
            <Text style={styles.resumenTitulo}>Productos de empresa</Text>
            <View style={styles.resumenFila}>
              {/* CONTADOS, no "con diferencia": uno que cuadró igual se contó.
                  Lo cuenta el servidor con la clase EFECTIVA, así que la
                  excepción manual del Auditor (de donde salen casi todos) se ve
                  reflejada. Ver `contadosDeEmpresa` en el puerto. */}
              <Text style={styles.resumenEtiqueta}>Productos contados</Text>
              <Text style={[styles.resumenValor, styles.resumenNeutro]}>
                {resumenServidor?.contadosDeEmpresa ?? '—'}
              </Text>
            </View>
            <View style={styles.resumenFila}>
              <Text style={styles.resumenEtiqueta}>Faltante</Text>
              <Text style={styles.resumenValor}>{montoOSinDato(cuadros?.empresa.valorFaltante, true)}</Text>
            </View>
            <View style={styles.resumenFila}>
              <Text style={styles.resumenEtiqueta}>Sobrante</Text>
              <Text style={[styles.resumenValor, { color: colors.ok }]}>
                {montoOSinDato(cuadros?.empresa.valorSobrante, false)}
              </Text>
            </View>
            <View style={[styles.resumenFila, styles.resumenFilaDestacada]}>
              <Text style={styles.resumenEtiquetaFuerte}>Paga la empresa</Text>
              <Text style={[styles.resumenValor, styles.resumenValorFuerte]}>
                {/* La resta vive en el dominio y NUNCA da negativo: ver
                    `pagaLaEmpresa`. Un "-S/ 36,00" con el signo al revés no
                    significa nada para quien lo lee. */}
                {montoOSinDato(cuadros === null ? undefined : pagaLaEmpresa(cuadros.empresa), true)}
              </Text>
            </View>
          </View>

          {/*
                EL CAMINO A CORREGIR, DONDE SE ENCUENTRA EL PROBLEMA.
                Esta matriz es el lugar donde el Auditor ve que un ítem no
                cuadra; mandarlo a buscar la pantalla de corrección por el menú
                de Inicio es pedirle que se acuerde de que existe. La pantalla
                de destino explica la regla (se corrige lo CONTADO, el stock no
                se toca) y dice si la ventana ya se cerró.
              */}
          <Pressable
            style={styles.irACorregir}
            onPress={() => router.push('/auditor/corregir')}
            accessibilityRole="button"
            accessibilityLabel="Corregir lo contado"
          >
            <PencilLine size={16} color={colors.tinta} />
            <Text style={styles.irACorregirTexto}>¿Un conteo quedó mal cargado? Corrígelo — el stock no se toca</Text>
            <ChevronRight size={16} color={colors.gris} />
          </Pressable>

          {/*
                LA PLANILLA Y EL LACRADO, ARRIBA -- NO AL PIE DE LA LISTA.

                BUG REAL (2026-09-22, emulador, Luzuriaga con 980 ítems): los
                dos vivían en el pie de la FlatList, o sea DESPUÉS de las 980
                tarjetas de la matriz. El Auditor preguntó si tenía que
                recorrerse todos los productos para llegar al botón, y la
                respuesta era que sí. Con el catálogo real (hasta 8.000 ítems)
                un botón al final de una lista virtualizada no está escondido:
                no existe.

                Van pegados a los cuadros porque el archivo baja EXACTAMENTE
                esos números, y así el cierre se lee de corrido: revisar los
                cuadros → bajar la planilla → lacrar.

                `outline` neutro la planilla y rojo el lacrado: la acción
                principal de la pantalla sigue siendo el lacrado. Y cuando la
                planilla no se puede bajar, el botón SE QUEDA apagado con el
                motivo debajo -- que desaparezca deja al Auditor buscando un
                botón que existe.
              */}
          {planilla !== null ? (
            <View style={styles.planilla}>
              <Pressable
                style={[styles.planillaBtn, (planillaBloqueada || bajandoPlanilla) && styles.planillaBtnApagado]}
                onPress={bajarPlanillaDeCuadros}
                disabled={planillaBloqueada || bajandoPlanilla}
                accessibilityRole="button"
                /* El motivo va DENTRO del label: quien usa lector de
                       pantalla tiene que oír por qué no se puede, no solo que
                       el botón está ahí. Sin `accessibilityState.disabled`, que
                       lo saca del árbol de accesibilidad (el bug del modal de
                       ajuste, donde el botón existía y no se lo podía tocar). */
                accessibilityLabel={
                  planilla.puedeExportar
                    ? 'Descargar la planilla de cuadros en Excel y compartir'
                    : `Descargar la planilla de cuadros: no disponible todavía. ${planilla.motivo}`
                }
              >
                {bajandoPlanilla ? (
                  <ActivityIndicator color={colors.tinta} size="small" />
                ) : (
                  <FileSpreadsheet size={17} color={planillaBloqueada ? colors.grisClaro : colors.tinta} />
                )}
                <Text style={[styles.planillaBtnTexto, planillaBloqueada && styles.planillaBtnTextoApagado]}>
                  Descargar la planilla de cuadros (Excel)
                </Text>
              </Pressable>
              {/* QUÉ SE BAJA, nombrando las hojas y diciendo que NO es la
                      otra exportación: el Auditor tiene dos .xlsx del mismo
                      inventario, y si baja el equivocado lo descubre recién al
                      abrirlo. */}
              <Text style={styles.planillaAyuda}>
                Las cuatro hojas del formato mensual: FALTANTES, SOBRANTES, EMPRESA y DESCUENTO. No es la exportación de
                diferencias del Historial, que baja una sola tabla para analizar.
              </Text>
              {planillaBloqueada ? (
                <Text style={styles.planillaMotivo}>{planilla.motivo}</Text>
              ) : notaPlanilla !== null ? (
                <Text style={styles.planillaMotivo}>{notaPlanilla}</Text>
              ) : null}
            </View>
          ) : null}

          <Pressable style={styles.accion} onPress={irALacrado}>
            <Text style={styles.accionTexto}>Ir a aprobación y lacrado</Text>
          </Pressable>

          {/*
                EL ACCESO A LA MATRIZ, donde antes empezaba la lista.
                Mismo estilo que "Corregir lo contado" -- neutro con borde, no
                el rojo, que sigue siendo del lacrado -- y con las dos cifras
                que dicen si vale la pena entrar: cuántos ítems hay y cuántos
                tienen diferencia. Un acceso que solo dijera "Matriz
                comparativa" obligaría a entrar para saber si hay algo.
              */}
          <Pressable
            style={styles.irACorregir}
            onPress={() => router.push('/auditor/matriz')}
            accessibilityRole="button"
            accessibilityLabel={
              totalItems === undefined
                ? 'Ver la matriz comparativa ítem por ítem'
                : `Ver la matriz comparativa: ${totalItems} ítems, ${conDiferencia} con diferencia`
            }
          >
            <BarChart3 size={16} color={colors.tinta} />
            <Text style={styles.irACorregirTexto}>
              Revisar ítem por ítem
              {totalItems === undefined ? null : (
                <Text style={styles.irAMatrizCifras}>
                  {'\n'}
                  {totalItems} {pluralizar(totalItems, 'ítem', 'ítems')} · {conDiferencia}{' '}
                  {pluralizar(conDiferencia, 'con diferencia', 'con diferencia')}
                </Text>
              )}
            </Text>
            <ChevronRight size={16} color={colors.gris} />
          </Pressable>
        </>
      )}
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: 14, paddingTop: 8, gap: 16 },
  cargando: { marginTop: 24 },
  tarjetaResumen: {
    padding: 15,
    gap: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.borde,
    backgroundColor: colors.campo,
  },
  resumenTitulo: {
    fontSize: 14.5,
    color: colors.tinta,
    fontFamily: fonts.bold,
  },
  tarjetaTexto: {
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.gris,
    fontFamily: fonts.regular,
  },
  resumenFila: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  resumenEtiqueta: {
    fontSize: 12.5,
    color: colors.gris,
    fontFamily: fonts.regular,
  },
  resumenValor: { fontSize: 16, color: colors.tinta, fontFamily: fonts.bold },
  resumenNeutro: { color: colors.gris },
  resumenPct: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.medium },
  resumenNota: {
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.gris,
    fontFamily: fonts.regular,
    marginTop: 2,
  },
  /** Acceso a la corrección: `outline` neutro, no el rojo de acción — la acción principal de esta pantalla sigue siendo el lacrado. */
  irACorregir: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
    backgroundColor: colors.campo,
  },
  irACorregirTexto: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.tinta,
    fontFamily: fonts.semibold,
  },
  /** La segunda línea del acceso a la matriz: dato, no acción — gris y sin peso. */
  irAMatrizCifras: {
    fontSize: 11.5,
    color: colors.gris,
    fontFamily: fonts.regular,
  },
  resumenFilaDestacada: {
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: colors.borde,
  },
  resumenEtiquetaFuerte: {
    fontSize: 12.5,
    color: colors.tinta,
    fontFamily: fonts.bold,
  },
  resumenValorFuerte: { fontSize: 17, color: colors.proceso },

  /** La planilla: mismo `outline` neutro que `irACorregir` -- el rojo del lacrado es la acción principal. */
  planilla: { gap: 7 },
  planillaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minHeight: 46,
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
    backgroundColor: colors.campo,
  },
  /** Apagado, NO invisible: el motivo de abajo explica por qué. */
  planillaBtnApagado: {
    backgroundColor: colors.esperaSuave,
    borderColor: colors.esperaSuave,
  },
  planillaBtnTexto: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: colors.tinta,
    fontFamily: fonts.semibold,
  },
  planillaBtnTextoApagado: { color: colors.grisClaro },
  planillaAyuda: {
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.gris,
    fontFamily: fonts.regular,
  },
  /** El motivo (o la salvedad): paleta `proceso` de atención, nunca el rojo de marca. */
  planillaMotivo: {
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.proceso,
    fontFamily: fonts.medium,
  },
  accion: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.rojo,
  },
  accionTexto: { fontSize: 15, color: colors.blanco, fontFamily: fonts.bold },
});
