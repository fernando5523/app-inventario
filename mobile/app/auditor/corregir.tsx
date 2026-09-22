import { router } from 'expo-router';
import { Check, CircleCheckBig, Info, Lock, PencilLine, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import {
  Badge,
  BarraApp,
  Button,
  ChipsFiltro,
  EmptyState,
  ModalConteo,
  SelectorSucursal,
  formatoMiles,
} from '../../components/ui';
import { cargarSeguro } from '../../lib/adaptadores/_http';
import {
  repositorioAjuste,
  repositorioAuditoria,
  repositorioHojas,
  repositorioInventario,
  repositorioSesion,
} from '../../lib/contenedor';
import {
  faseDeCierre,
  motivoSinCorregir,
  puedeCorregirLoContado,
  STOCK_NO_SE_CORRIGE,
  textoItemSalioDeRonda,
  textoRondaQueYaNoExiste,
} from '../../lib/dominio/ajuste-final';
import { diferenciaUnidades, veredicto } from '../../lib/dominio/auditoria';
import { totalUnidades } from '../../lib/dominio/empaque';
import { pluralizar } from '../../lib/dominio/plural';
import { sucursalEnFoco } from '../../lib/dominio/sucursal-en-foco';
import { ORDINAL } from '../../lib/dominio/texto-cierre-ronda';
import type { Conteo, ItemAuditoria, Producto, Sucursal } from '../../lib/dominio/tipos';
import { useSesion } from '../../lib/sesion-contexto';
import { useSucursalAuditada } from '../../lib/sucursal-auditada-contexto';
import { colors, fonts, radius, spacing } from '../../lib/theme';

type Filtro = 'sin-cuadrar' | 'todos';

/** Un ítem de la ronda, con todo lo que hace falta para corregirlo y para decidir si vale la pena. */
interface FilaCorregible {
  /** A qué hoja pertenece: es lo que pide el endpoint de corrección. */
  hojaId: number;
  numeroHoja: string;
  producto: Producto;
  /** Lo que se cargó, o `null` si nadie lo contó en esta ronda. */
  conteo: Conteo | null;
  /** Unidades contadas, por `totalUnidades`. `null` si no hay conteo. */
  contado: number | null;
  /** El ítem en la matriz de auditoría, para el stock y el veredicto. `null` si la matriz no lo trajo. */
  item: ItemAuditoria | null;
}

/**
 * CORREGIR LO CONTADO — pantalla del AUDITOR.
 *
 * ---------------------------------------------------------------------------
 * LA MISMA CORRECCIÓN QUE HACE EL COORDINADOR, CON EL STOCK A LA VISTA
 * ---------------------------------------------------------------------------
 * Mismo endpoint, mismo motivo obligatorio, misma ventana (mientras el
 * inventario esté `en_curso`, con la ronda abierta o cerrada). Lo único
 * distinto es que acá SÍ se ve el stock del ERP.
 *
 * Y es deliberado que sea distinto: el conteo ciego protege el CONTEO, y por
 * eso al Coordinador se le sigue ocultando (ver app/coordinador/corregir.tsx).
 * El Auditor entra a comparar -- esconderle el número no protegería nada y le
 * haría imposible su trabajo.
 *
 * ---------------------------------------------------------------------------
 * CORREGIR LO CONTADO NO ES CORREGIR EL STOCK
 * ---------------------------------------------------------------------------
 * Regla textual del cliente. El stock viene del sistema y no lo cambia nadie
 * desde la app. Acá se muestra en una celda inerte, con su rótulo de
 * referencia y la frase del dominio (`STOCK_NO_SE_CORRIGE`) — nunca en un
 * campo, ni siquiera deshabilitado: un recuadro con borde al lado de los
 * otros dos ya insinuaría que se toca.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ NO ES LA MISMA PANTALLA QUE LA DEL COORDINADOR
 * ---------------------------------------------------------------------------
 * Porque el recorte de los datos es otro. El Coordinador entra POR UNA HOJA
 * (viene de Gestión de hojas y arregla la que le reportaron); el Auditor
 * entra por el INVENTARIO y lo que busca son los ítems que no cuadran, sin
 * importar en qué hoja cayeron. Un solo componente con un `rol` adentro sería
 * dos pantallas distintas peleando por el mismo cuerpo. Lo que SÍ se comparte
 * es lo que tiene que ser idéntico: el modal de edición, la regla de la
 * ventana (`puedeCorregirLoContado`) y el motivo obligatorio.
 *
 * ---------------------------------------------------------------------------
 * ARRANCADO EL AJUSTE, ESTA VÍA DESAPARECE
 * ---------------------------------------------------------------------------
 * Pedido explícito: desde ahí el Auditor corrige por la pantalla de ajuste.
 * Son dos actos sobre datos distintos —uno arregla lo que alguien contó, el
 * otro fija el valor definitivo— y dejarlos convivir haría que el mismo
 * número se pudiera cambiar por dos caminos con dos significados.
 */
export default function AuditorCorregirScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fase, setFase] = useState<ReturnType<typeof faseDeCierre> | null>(null);
  /**
   * LA VIGENTE Y LA QUE SE ESTÁ MIRANDO SON DOS COSAS DISTINTAS, y confundirlas
   * era el bug: la pantalla se clavaba en `rondaActiva` y no había forma de ir
   * a una ronda anterior. El caso que el cliente describió para pedir la
   * corrección vive JUSTO ahí -- la hoja finalizada de la ronda que ya cerró,
   * con el siguiente conteo ya abierto.
   *
   * `rondaElegida` en null = "la que esté vigente", que es el default y se
   * resuelve al cargar. No se fija en el estado para que al abrirse otra ronda
   * la pantalla siga los pasos del inventario sola.
   */
  const [rondaActiva, setRondaActiva] = useState<number | null>(null);
  const [rondaElegida, setRondaElegida] = useState<number | null>(null);
  /** Lo que pasó con la última corrección. Sobrevive a la recarga a propósito. */
  const [aviso, setAviso] = useState<{ texto: string; tono: 'ok' | 'atencion' } | null>(null);
  const [filas, setFilas] = useState<FilaCorregible[]>([]);
  const [filtro, setFiltro] = useState<Filtro>('sin-cuadrar');
  const [enEdicion, setEnEdicion] = useState<FilaCorregible | null>(null);
  const [guardando, setGuardando] = useState(false);

  const { elegida, elegir } = useSucursalAuditada();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  useEffect(() => {
    repositorioSesion.sucursales().then(setSucursales);
  }, []);
  const sucursalId = sucursalEnFoco({
    rol: sesion?.colaborador.rol ?? 'auditor',
    sucursalDeSesion: sesion?.sucursal?.id ?? null,
    elegida,
  });

  const cargar = useCallback(async () => {
    if (!sesion) return;
    if (sucursalId === null) {
      setFilas([]);
      setFase(null);
      setRondaActiva(null);
      setCargando(false);
      return;
    }
    setError(null);
    const falla = await cargarSeguro(async () => {
      const activo = await repositorioInventario.activo(sucursalId);
      setFase(activo ? faseDeCierre(activo.estado, activo.rondaActiva, activo.totalHojas) : null);
      setRondaActiva(activo?.rondaActiva ?? null);
      if (!activo || activo.rondaActiva === null) {
        setFilas([]);
        setRondaElegida(null);
        return;
      }

      /**
       * LA RONDA QUE SE ESTABA MIRANDO PUEDE HABER DESAPARECIDO. Pasa de
       * verdad: se corrige el último ítem que quedaba en ella, la ronda se
       * queda sin hojas y el servidor la borra. Quedarse parado ahí sería
       * mostrar una ronda que ya no existe; irse en silencio sería mover la
       * pantalla debajo de quien la está usando. Se hacen las dos cosas: se
       * vuelve a la vigente Y se dice por qué.
       */
      const pedida =
        rondaElegida !== null && rondaElegida <= activo.rondaActiva ? rondaElegida : activo.rondaActiva;
      if (rondaElegida !== null && rondaElegida !== pedida) {
        setAviso({ texto: textoRondaQueYaNoExiste(rondaElegida, pedida), tono: 'atencion' });
      }
      setRondaElegida(pedida);

      // Las DOS lecturas, en paralelo: no dependen entre sí.
      //  - las hojas dan el `hojaId` de cada producto, que es lo que pide el
      //    endpoint de corrección, y el conteo que hay cargado hoy.
      //  - la matriz da el stock del ERP y con él el veredicto.
      // La matriz por sí sola NO alcanza: no trae `hojaId` (ver el DTO de
      // auditoria), así que sin las hojas no habría contra qué corregir.
      const [hojas, matriz] = await Promise.all([
        // LA RONDA ELEGIDA, no la vigente: es todo el punto de esta pantalla.
        repositorioHojas.todas(activo.inventarioId, pedida),
        repositorioAuditoria.matriz(activo.inventarioId),
      ]);
      const porProducto = new Map(matriz.map((i) => [i.productoId, i] as const));

      setFilas(
        hojas.flatMap((hoja) =>
          hoja.productos.map((producto) => {
            const conteo = hoja.conteos.find((c) => c.productoId === producto.id) ?? null;
            return {
              hojaId: hoja.id,
              numeroHoja: hoja.numero,
              producto,
              conteo,
              // `totalUnidades` y nunca una suma a mano: es la MISMA función
              // que usa el Contador para su total, así que lo que el Auditor
              // ve acá es exactamente lo que se guardó.
              contado: conteo ? totalUnidades(conteo, producto.empaques) : null,
              item: porProducto.get(producto.id) ?? null,
            };
          }),
        ),
      );
    });
    setCargando(false);
    if (falla) setError(falla.message);
  }, [sesion, sucursalId, rondaElegida]);

  // Pausado con el modal abierto: un refresco a mitad de tipear el motivo
  // borraría el borrador (ver useRefrescoAlEnfocar.ts).
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar, { pausado: enEdicion !== null || guardando });

  /**
   * Cambió la tienda O LA RONDA: recargar YA y limpiar lo anterior ANTES — la
   * barra ya dice la tienda y el conteo nuevos (mismo criterio que
   * auditoria.tsx).
   *
   * Limpiar no es cosmético al cambiar de ronda: los números de hoja se
   * REPITEN en cada pasada, así que dejar las filas viejas un instante
   * mostraría "Hoja #001" de la ronda anterior con los ítems de la nueva. Es
   * el mismo bug que ya se arregló navegando por identidad y no por el número
   * visible.
   */
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    setFilas([]);
    setCargando(true);
    void cargar();
  }, [cargar]);

  const sinCuadrar = useMemo(
    () => filas.filter((f) => f.item !== null && (veredicto(f.item) === 'falta' || veredicto(f.item) === 'empresa')),
    [filas],
  );
  const visibles = filtro === 'sin-cuadrar' ? sinCuadrar : filas;

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  const sePuedeCorregir = fase !== null && puedeCorregirLoContado(fase);
  const bloqueo = fase === null ? null : motivoSinCorregir(fase, 'auditor');
  const nombreSucursal = sucursales.find((s) => s.id === sucursalId)?.nombre ?? sesion.sucursal?.nombre;

  async function guardarCorreccion(fila: FilaCorregible, conteo: Conteo, motivo: string): Promise<void> {
    setGuardando(true);
    try {
      const { salioDeLaRonda } = await repositorioAjuste.corregirConteo(fila.hojaId, fila.producto.id, {
        empaques: conteo.empaques,
        sueltas: conteo.sueltas,
        motivo,
      });
      setEnEdicion(null);
      /**
       * LO ÚNICO QUE EL CLIENTE PIDIÓ CON ESAS PALABRAS: *"corrígelo para que
       * ya no salga en mi segundo conteo"*. Si no se dice, el Auditor guarda y
       * no sabe si lo consiguió -- y que salga o no depende de si alguien ya
       * empezó esa ronda, cosa que desde acá no se ve.
       *
       * `null` NO borra el aviso anterior de golpe: se reemplaza solo cuando
       * hay algo nuevo que decir. Una corrección que no saca nada es el caso
       * normal y no merece un cartel.
       */
      if (salioDeLaRonda !== null) {
        setAviso({ texto: textoItemSalioDeRonda(salioDeLaRonda), tono: 'ok' });
      }
      // Se vuelve a pedir todo: la corrección puede cambiar el veredicto del
      // ítem (de "falta" a "cuadrado") y con él el filtro y los contadores.
      // Recalcularlo a mano acá sería una segunda copia de `veredicto()`.
      await cargar();
    } catch (e) {
      // El mensaje del servidor tal cual: dice qué regla se topó (el ajuste ya
      // empezó, no es tu sucursal), y eso es lo accionable.
      Alert.alert(
        'No se pudo corregir el conteo',
        e instanceof Error ? e.message : 'Revisa la conexión con la tienda y vuelve a intentarlo.',
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <PantallaConTabs
        scrollable
        contentStyle={styles.contenido}
        refreshControl={
          <RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={colors.rojo} colors={[colors.rojo]} />
        }
      >
        <BarraApp
          rotulo={
            rondaElegida === null ? 'Corregir lo contado' : `Corregir lo contado · ${ORDINAL[rondaElegida]} conteo`
          }
          sede={nombreSucursal}
          cifras={
            sePuedeCorregir
              ? `${formatoMiles(sinCuadrar.length)} ${pluralizar(sinCuadrar.length, 'ítem sin cuadrar', 'ítems sin cuadrar')} de ${formatoMiles(filas.length)}`
              : undefined
          }
          onSalir={salir}
        />

        <SelectorSucursal label="Sucursal a auditar" sucursales={sucursales} sucursalId={sucursalId} onElegir={elegir} />

        {cargando ? (
          <ActivityIndicator color={colors.rojo} style={styles.spinner} />
        ) : error !== null ? (
          <EmptyState icon={TriangleAlert} title="No se pudo cargar lo contado" subtitle={error}>
            <Button label="Volver a intentar" onPress={refrescar} />
          </EmptyState>
        ) : !sePuedeCorregir ? (
          // NO dice "vuelve a intentar": esto no cambia solo. Dice qué pasó y
          // por dónde sigue, que en el caso del ajuste es otra pantalla suya.
          <EmptyState
            icon={Lock}
            title={fase === 'ajuste' ? 'Ya empezó el ajuste final' : 'Aquí no hay nada que corregir'}
            subtitle={
              bloqueo ??
              'Todavía no hay un inventario abierto en esta tienda, o no tiene una ronda con hojas para corregir.'
            }
          >
            {fase === 'ajuste' ? (
              <Button label="Ir al ajuste final" onPress={() => router.push('/auditor/ajuste')} />
            ) : null}
          </EmptyState>
        ) : (
          <>
            <View style={styles.aviso}>
              <PencilLine size={16} color={colors.gris} />
              <Text style={styles.avisoTexto}>
                Toca un ítem para corregir lo que se contó. Cada cambio pide un motivo y queda registrado con tu
                nombre. {STOCK_NO_SE_CORRIGE}
              </Text>
            </View>

            {/* El resultado de la última corrección. Va ARRIBA de la lista
                porque la lista se recarga y se reordena debajo: si estuviera
                al pie, el aviso quedaría fuera de pantalla justo después de
                guardar. */}
            {aviso !== null ? (
              <View style={[styles.resultado, aviso.tono === 'ok' ? styles.resultadoOk : styles.resultadoAtencion]}>
                {aviso.tono === 'ok' ? (
                  <CircleCheckBig size={16} color={colors.ok} />
                ) : (
                  <Info size={16} color={colors.proceso} />
                )}
                <Text style={styles.resultadoTexto}>{aviso.texto}</Text>
              </View>
            ) : null}

            {/**
             * EL SELECTOR DE RONDA. Por defecto la vigente, pero deja ir a las
             * anteriores -- que es donde vive el caso que el cliente describió
             * para pedir la corrección: la hoja finalizada de una ronda ya
             * cerrada, con el siguiente conteo abierto.
             *
             * Se ofrecen 1..vigente y no una lista traída aparte: las rondas de
             * un inventario son correlativas, así que la más alta las define
             * todas. Con una sola ronda no se muestra nada -- un selector de
             * una opción es un control que no decide nada.
             */}
            {rondaActiva !== null && rondaActiva > 1 ? (
              <View style={styles.rondas}>
                <Text style={styles.rondasEtiqueta}>Conteo a corregir</Text>
                <ChipsFiltro
                  opciones={Array.from({ length: rondaActiva }, (_, i) => ({
                    id: String(i + 1),
                    etiqueta: `${ORDINAL[i + 1]} conteo`,
                  }))}
                  activo={String(rondaElegida ?? rondaActiva)}
                  onCambiar={(id) => {
                    // El aviso viejo habla de la ronda que se está dejando:
                    // llevarlo a la nueva sería decir algo que no pasó acá.
                    setAviso(null);
                    setRondaElegida(Number(id));
                  }}
                />
              </View>
            ) : null}

            <ChipsFiltro
              opciones={[
                { id: 'sin-cuadrar', etiqueta: 'Sin cuadrar', contador: sinCuadrar.length },
                { id: 'todos', etiqueta: 'Todos', contador: filas.length },
              ]}
              activo={filtro}
              onCambiar={(id) => setFiltro(id as Filtro)}
            />

            {visibles.length === 0 ? (
              <EmptyState
                icon={Check}
                title={filtro === 'sin-cuadrar' ? 'No queda ningún ítem sin cuadrar' : 'Esta ronda no tiene ítems'}
                subtitle={
                  filtro === 'sin-cuadrar'
                    ? 'Todo lo que tiene stock del ERP y conteo coincide. Puedes mirar la lista completa si buscas otra cosa.'
                    : 'Las hojas de esta ronda todavía no tienen catálogo cargado.'
                }
              />
            ) : (
              <View style={styles.lista}>
                {visibles.map((fila) => (
                  <FilaItem key={`${fila.hojaId}-${fila.producto.id}`} fila={fila} onPress={() => setEnEdicion(fila)} />
                ))}
              </View>
            )}
          </>
        )}
      </PantallaConTabs>

      {/* Hermano del scroll, nunca adentro: ahí el overlay queda recortado y se
          desplaza con el contenido (ver ModalConteo.tsx). */}
      <ModalConteo
        visible={enEdicion !== null && sePuedeCorregir}
        producto={enEdicion?.producto ?? null}
        conteoInicial={enEdicion?.conteo ?? null}
        confirmadoPorEscaner={false}
        pedirMotivo
        tituloMotivo="Reemplaza el valor que cargó quien contó. Queda registrado con tu nombre y la hora."
        // La ÚNICA pantalla que pasa esta prop. Ver ModalConteo#stockErpDeReferencia.
        stockErpDeReferencia={enEdicion?.item?.stockErp ?? null}
        onGuardar={(conteo, motivo) => void guardarCorreccion(enEdicion!, conteo, motivo)}
        onCerrar={() => setEnEdicion(null)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * Una fila de la lista: lo CONTADO y el stock, lado a lado, con la diferencia.
 *
 * No reusa `TarjetaProducto` a propósito: esa tarjeta tiene como regla número
 * uno que en ningún lado suyo aparece el stock del ERP (ver su cabecera), y es
 * la que ven el Contador y el Coordinador. Meterle el stock con una prop la
 * volvería insegura para los dos usos que la justifican.
 */
function FilaItem({ fila, onPress }: { fila: FilaCorregible; onPress: () => void }): JSX.Element {
  const diferencia = fila.item ? diferenciaUnidades(fila.item) : null;
  const cuadra = diferencia === 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Corregir lo contado de ${fila.producto.descripcion}`}
      style={({ pressed }) => [styles.fila, cuadra && styles.filaCuadra, pressed && styles.filaPresionada]}
    >
      <View style={styles.filaDatos}>
        <Text style={styles.filaNombre} numberOfLines={2}>
          {fila.producto.descripcion}
        </Text>
        <Text style={styles.filaMeta}>
          Código {fila.producto.codigo} · Hoja #{fila.numeroHoja}
        </Text>
      </View>

      <View style={styles.filaCifras}>
        <View style={styles.celda}>
          <Text style={styles.celdaEtiqueta}>Contado</Text>
          {/* "—" y no 0: nadie lo contó todavía es distinto de "contó cero". */}
          <Text style={styles.celdaValor}>{fila.contado === null ? '—' : formatoMiles(fila.contado)}</Text>
        </View>
        <View style={styles.celda}>
          <Text style={styles.celdaEtiqueta}>Stock</Text>
          <Text style={[styles.celdaValor, styles.celdaValorInerte]}>
            {fila.item?.stockErp === null || fila.item === null ? '—' : formatoMiles(fila.item.stockErp)}
          </Text>
        </View>
        {/* La diferencia con la paleta de ESTADO: `ok` cuando cuadra, `proceso`
            cuando no. El rojo de marca queda para la acción, que acá es la
            tarjeta entera. */}
        <Badge
          label={
            diferencia === null
              ? 'Sin comparar'
              : diferencia === 0
                ? 'Cuadra'
                : `${diferencia > 0 ? '+' : ''}${formatoMiles(diferencia)}`
          }
          variant={diferencia === null ? 'outline' : diferencia === 0 ? 'ok' : 'proceso'}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: 14, paddingTop: 8, gap: spacing.lg },
  spinner: { marginTop: spacing.xxxl },

  aviso: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.esperaSuave,
  },
  avisoTexto: { flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.gris, fontFamily: fonts.regular },

  rondas: { gap: 6 },
  rondasEtiqueta: {
    fontSize: 10.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.grisClaro,
    fontFamily: fonts.bold,
  },

  resultado: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  resultadoOk: { backgroundColor: colors.okSuave, borderColor: colors.ok },
  resultadoAtencion: { backgroundColor: colors.procesoSuave, borderColor: colors.proceso },
  resultadoTexto: { flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.tinta, fontFamily: fonts.regular },

  lista: { gap: 9 },
  fila: {
    gap: 9,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(138,90,5,0.32)',
    borderRadius: 12,
    backgroundColor: colors.campo,
  },
  filaCuadra: { borderColor: colors.borde },
  filaPresionada: { backgroundColor: colors.rojoSuave, borderColor: colors.rojo },
  filaDatos: { gap: 2 },
  filaNombre: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.bold, lineHeight: 18 },
  filaMeta: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.regular },
  filaCifras: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  celda: { alignItems: 'center', gap: 2, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: colors.esperaSuave },
  celdaEtiqueta: {
    fontSize: 9.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.grisClaro,
    fontFamily: fonts.bold,
  },
  celdaValor: { fontSize: 15, color: colors.tinta, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  /** El stock, más apagado que lo contado: es referencia, no lo que se va a cambiar. */
  celdaValorInerte: { color: colors.gris },
});
