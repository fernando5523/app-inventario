import { router, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, ClipboardList, Filter, ScanLine, Search } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import {
  AvanceFila,
  BandaSync,
  BarraApp,
  EmptyState,
  ModalConteo,
  ModalEscaner,
  ModalFiltrosProductos,
  TarjetaProducto,
  sincronizacionDeHojas,
  type RechazoEscaneo,
} from '../../components/ui';
import { inventarioIdSinRed, razonRechazoDeHoja, rondaActivaSinRed } from '../../lib/adaptadores/hojas-sqlite';
import { repositorioHojas, repositorioInventario, sincronizador } from '../../lib/contenedor';
import { resolverCodigoEnHoja, type CoincidenciaEscaneo } from '../../lib/dominio/escaneo';
import { aplicarFiltro, contarFiltrosActivos, FILTRO_VACIO, textoFiltroActivo, type FiltroProductos } from '../../lib/dominio/filtro-productos';
import { avance, puedeEditar, puedeFinalizar } from '../../lib/dominio/hoja';
import { ORDINAL } from '../../lib/dominio/texto-cierre-ronda';
import type { Conteo, HojaConteo, Producto } from '../../lib/dominio/tipos';
import { cargarHojaActiva, textoHojaVieja, type MotivoSinHoja } from '../../lib/orquestar-carga-de-hoja';
import type { EstadoCola } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, fontSize, radius } from '../../lib/theme';

/**
 * Conteo ciego — la pantalla más importante del producto. Regla número
 * uno: en ningún lugar de acá aparece el stock del ERP, solo lo que el
 * operario cuenta. Las siete reglas de docs/pantallas.md siguen vigentes,
 * marcadas en el código donde aplican.
 */
export default function ContarScreen(): JSX.Element {
  const { sesion } = useSesion();
  const params = useLocalSearchParams<{ hojaId?: string }>();

  const [cargando, setCargando] = useState(true);
  // La ronda ACTIVA del inventario. El Contador cuenta la ronda en curso, no
  // siempre la 1ra: se resuelve junto con el inventario (del servidor, o de
  // SQLite sin red) en `cargarHojaActiva`, que también decide si cambió
  // desde la última carga.
  const [ronda, setRonda] = useState<number | null>(null);
  // Se navega por hojaId (identidad ESTABLE entre rondas), NUNCA por número de
  // hoja: el número se repite en cada ronda y resolverlo contra la ronda
  // activa dejaba a la persona parada en otra hoja #001, de otra persona/ronda
  // (bug del cliente 2026-09-08). Ver orquestar-carga-de-hoja.ts.
  const [hojaIdActivo, setHojaIdActivo] = useState<number | null>(params.hojaId ? Number(params.hojaId) : null);
  const [hoja, setHoja] = useState<HojaConteo | null>(null);
  // Por qué NO hay hoja (distingue "hoja vieja" del vacío común) y de qué
  // ronda era la que quedó vieja, para el texto del aviso.
  const [motivo, setMotivo] = useState<MotivoSinHoja | null>(null);
  const [rondaVieja, setRondaVieja] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<FiltroProductos>(FILTRO_VACIO);
  const [modalFiltrosVisible, setModalFiltrosVisible] = useState(false);

  // Confirmado por escáner ANTES de guardar el conteo — el escaneo puede
  // pasar antes de que exista un Conteo para ese producto (regla c).
  const [confirmadosPendientes, setConfirmadosPendientes] = useState<Set<number>>(new Set());

  const [modalProducto, setModalProducto] = useState<Producto | null>(null);
  /**
   * El último producto confirmado con la cámara, y —si algún día un código
   * llegara a identificar un empaque— cuál.
   *
   * DATO REAL DE DYNAMICS (min-1, catálogo real, 2026-09): los 15 productos
   * de la muestra traen código de barras, pero TODOS con ProductQuantity 0
   * y unidad "U". Ninguno identifica una caja ni un pack. O sea que
   * `empaque` hoy es SIEMPRE null y el escáner nunca sabe qué presentación
   * hay en la mano: solo qué producto es.
   *
   * El campo se mantiene porque el día que Dynamics traiga códigos de
   * empaque el flujo ya está resuelto (ModalConteo pre-carga "1" en ESE
   * empaque vía `empaquePreseleccionado`). Lo que NO puede pasar es que la
   * pantalla hable como si hoy lo supiera — ver la banda de abajo.
   */
  const [ultimoEscaneo, setUltimoEscaneo] = useState<CoincidenciaEscaneo | null>(null);
  const [modalScanVisible, setModalScanVisible] = useState(false);
  // Rechazo con contador: dos códigos ajenos seguidos dan el MISMO mensaje,
  // y sin el contador el modal no se rehabilitaría la segunda vez (ver
  // RechazoEscaneo en ModalEscaner.tsx). En góndola eso es lo normal.
  const [scanError, setScanError] = useState<RechazoEscaneo | null>(null);
  const intentoFallido = useRef(0);

  function rechazarEscaneo(mensaje: string): void {
    intentoFallido.current++;
    setScanError({ mensaje, intento: intentoFallido.current });
  }
  const [modalFinalizarVisible, setModalFinalizarVisible] = useState(false);
  const [finalizando, setFinalizando] = useState(false);

  // El estado REAL de la cola de sincronización (pendientes/última
  // sync/error) — se suscribe una vez y se desuscribe al desmontar, así
  // la banda de esta pantalla se actualiza sola cuando el sincronizador
  // termina una pasada, sin que esta pantalla tenga que pedirlo.
  const [estadoCola, setEstadoCola] = useState<EstadoCola>(sincronizador.estado());
  useEffect(() => sincronizador.suscribir(setEstadoCola), []);

  // Elegir una hoja desde Mis hojas llega como un hojaId nuevo en la ruta: se
  // apunta a ESA por id y se limpia cualquier "hoja vieja" anterior. `cargar`
  // (al enfocar) la resuelve enseguida contra `mias` de la ronda activa.
  useEffect(() => {
    if (params.hojaId) {
      setHojaIdActivo(Number(params.hojaId));
      setMotivo(null);
    }
  }, [params.hojaId]);

  /**
   * La razón del rechazo, ACOTADA a esta hoja — `estadoCola.error` es
   * GLOBAL (cuenta toda la cola, ver hojas-sqlite.ts#estadoDeLaCola) y no
   * sirve para esta pantalla: un item podrido de OTRA hoja (ej. una que
   * ya no existe, borrada del servidor) pintaría de rojo la banda de
   * ESTA hoja aunque esté sana y sincronizada. Se vuelve a pedir cuando
   * cambia `estadoCola` (una pasada de sincronización recién terminó) o
   * cuando cambia la hoja misma.
   */
  const [razonRechazoHoja, setRazonRechazoHoja] = useState<string | null>(null);
  useEffect(() => {
    if (!hoja || hoja.sync !== 'error') {
      setRazonRechazoHoja(null);
      return;
    }
    let vigente = true;
    razonRechazoDeHoja(hoja.id).then((razon) => {
      if (vigente) setRazonRechazoHoja(razon);
    });
    return () => {
      vigente = false;
    };
  }, [hoja, estadoCola]);

  // Toda la resolución de "qué hoja toca ver ahora" vive en
  // `cargarHojaActiva` (fuera del componente, testeable sin montar RN) — ver
  // ese archivo para el hallazgo que la motiva: se resuelve la hoja abierta
  // POR ID contra `mias` de la ronda ACTIVA (identidad estable, no el número
  // que se repite en cada ronda), y si ya no está —la ronda se cerró o se
  // reasignó— se saca de la vista con un aviso, en vez de dejar contar en el
  // vacío.
  const cargar = useCallback(async () => {
    if (!sesion) return;
    const resultado = await cargarHojaActiva(
      { ronda, hojaId: hojaIdActivo },
      {
        activo: () => repositorioInventario.activo(sesion.sucursal!.id),
        inventarioIdSinRed,
        rondaActivaSinRed,
        mias: repositorioHojas.mias,
      },
    );
    setRonda(resultado.ronda);
    setHoja(resultado.hoja);
    setMotivo(resultado.motivo);
    setRondaVieja(resultado.rondaVieja);
    // Solo se fija el id cuando se resolvió una hoja REAL (primera carga por
    // el tab). Con 'hoja-vieja' se conserva el id abierto para que el aviso
    // persista hasta que la persona elija otra desde Mis hojas — la pantalla
    // nunca se salta sola a otra hoja.
    if (resultado.hoja) setHojaIdActivo(resultado.hojaId);
    setCargando(false);
  }, [sesion, ronda, hojaIdActivo]);

  // `useRefrescoAlEnfocar` cubre los dos disparadores (enfocar la pantalla
  // Y volver la app a primer plano) con un solo candado -- ver ese hook
  // para el porqué. PAUSADO con cualquier modal de conteo abierto: si la
  // app vuelve a primer plano justo cuando alguien tiene `ModalConteo`
  // abierto a medio tipear una cantidad, un refresco de fondo cambia la
  // referencia de `hoja` y el `useEffect` del modal (que resiembra su
  // estado cuando cambia `conteoInicial`) le pisaría el número que la
  // persona todavía no guardó. `cargar()` nunca borra el conteo YA
  // guardado -- esto es solo para no interrumpir uno que se está por
  // guardar.
  useRefrescoAlEnfocar(cargar, {
    pausado: modalProducto !== null || modalScanVisible || modalFinalizarVisible,
  });

  if (!sesion) return <View />;

  if (cargando) {
    return (
      <PantallaConTabs contentStyle={styles.centrado}>
        <ActivityIndicator color={colors.rojo} />
      </PantallaConTabs>
    );
  }

  if (!hoja) {
    // 'hoja-vieja': la que estaba abierta ya no es de la ronda activa o se
    // reasignó — se saca de la vista con un aviso que dice qué pasó y a dónde
    // ir, en vez de dejar contar en el vacío (cada conteo daría 403).
    const hojaVieja = motivo === 'hoja-vieja' && ronda !== null;
    return (
      <PantallaConTabs contentStyle={styles.centrado}>
        <EmptyState
          icon={hojaVieja ? AlertTriangle : ClipboardList}
          title={hojaVieja ? 'Esta hoja ya no está disponible' : 'No tienes ninguna hoja para contar'}
          subtitle={hojaVieja ? textoHojaVieja(rondaVieja, ronda) : 'Elige una hoja con catálogo cargado desde Mis hojas.'}
        >
          <Pressable style={styles.irAMisHojas} onPress={() => router.push('/conteo/mis-hojas')}>
            <Text style={styles.irAMisHojasTexto}>{hojaVieja ? 'Volver a Mis hojas' : 'Ir a Mis hojas'}</Text>
          </Pressable>
        </EmptyState>
      </PantallaConTabs>
    );
  }

  const bloqueado = !puedeEditar(hoja);
  const { contados, total, porcentaje } = avance(hoja);
  const visibles = aplicarFiltro(hoja.productos, filtro);
  const filtroTexto = textoFiltroActivo(filtro);
  const filtrosActivos = contarFiltrosActivos(filtro);

  function conteoDe(producto: Producto): Conteo | null {
    return hoja!.conteos.find((c) => c.productoId === producto.id) ?? null;
  }

  function confirmadoDe(producto: Producto): boolean {
    const c = conteoDe(producto);
    if (c) return c.confirmadoPorEscaner;
    return confirmadosPendientes.has(producto.id);
  }

  function abrirModalProducto(producto: Producto): void {
    if (bloqueado) return;
    setModalProducto(producto);
  }

  async function guardarConteo(conteo: Conteo): Promise<void> {
    try {
      await repositorioHojas.guardarConteo(hoja!.id, conteo);
      setConfirmadosPendientes((prev) => {
        const nuevo = new Set(prev);
        nuevo.delete(conteo.productoId);
        return nuevo;
      });
      setModalProducto(null);
      await cargar();
    } catch (error) {
      Alert.alert('No se pudo guardar', error instanceof Error ? error.message : 'Intenta de nuevo.');
    }
  }

  function abrirEscaner(): void {
    setScanError(null);
    setModalScanVisible(true);
  }

  // Regla c: el escáner es SECUNDARIO. Si el código pertenece a la hoja,
  // confirma y abre el registro del producto — no cuenta por sí solo. Si
  // no pertenece, lo avisa claro y no registra nada.
  //
  // TODO en LOCAL, contra `hoja.productos` — nunca contra la red. El
  // escáner se usa parado frente a la góndola, en el fondo del almacén sin
  // señal: mandar el código a HTTP ahí fallaría igual que cualquier otro
  // pedido de red (ver el hallazgo del cableado de repositorioCatalogo,
  // 2026-09-05). La hoja YA tiene sus productos completos en SQLite,
  // codigoBarras de la unidad y de cada empaque incluidos (ver
  // hojas-sqlite.ts#filaAProducto) — resolver acá no es una degradación,
  // es la misma información que ya viajó con la hoja.
  function confirmarCoincidencia(coincidencia: CoincidenciaEscaneo): void {
    setScanError(null);
    setModalScanVisible(false);
    setConfirmadosPendientes((prev) => new Set(prev).add(coincidencia.producto.id));
    setUltimoEscaneo(coincidencia);
    setModalProducto(coincidencia.producto);
  }

  function manejarEscaneo(codigo: string): void {
    const resultado = resolverCodigoEnHoja(hoja!.productos, codigo);

    if (resultado.estado === 'no-encontrado') {
      // Con el código a la vista: el operario puede comparar contra la
      // etiqueta y darse cuenta de que apuntó al vecino de góndola, que es
      // justo el error que este aviso existe para atajar. Conteo ciego:
      // no importa si el código existe en OTRA hoja o en el catálogo
      // general — acá solo cuenta lo asignado a ESTA hoja.
      rechazarEscaneo(`El código ${codigo} no pertenece a la hoja #${hoja!.numero}. No se registró nada.`);
      return;
    }

    if (resultado.estado === 'ambiguo') {
      // Caso raro (el mismo código en dos productos de la MISMA hoja), pero
      // el modelo no lo impide — confirmar el primero a ciegas registraría
      // el producto equivocado. Se pregunta, no se adivina.
      Alert.alert(
        `El código ${codigo} coincide con más de un producto`,
        'Elige cuál es el que tienes en la mano.',
        [
          ...resultado.opciones.map((opcion) => ({
            text: opcion.empaque ? `${opcion.producto.descripcion} (${opcion.empaque.nombre})` : opcion.producto.descripcion,
            onPress: () => confirmarCoincidencia(opcion),
          })),
          { text: 'Cancelar', style: 'cancel' as const },
        ],
      );
      return;
    }

    confirmarCoincidencia(resultado.coincidencia);
  }

  function abrirModalFinalizar(): void {
    setModalFinalizarVisible(true);
  }

  async function confirmarFinalizar(): Promise<void> {
    setFinalizando(true);
    try {
      const finalizada = await repositorioHojas.finalizar(hoja!.id);
      setHoja(finalizada);
      setModalFinalizarVisible(false);
      // Fire-and-forget a propósito: el operario ya vio la hoja
      // finalizada, no tiene que esperar a que salga del teléfono. Es el
      // momento en que el dato importa MÁS (la hoja se congela), por eso
      // se dispara acá y no se espera al próximo trigger automático.
      void sincronizador.sincronizar();
    } catch (error) {
      Alert.alert('No se pudo finalizar', error instanceof Error ? error.message : 'Intenta de nuevo.');
    } finally {
      setFinalizando(false);
    }
  }

  const { faltantes } = puedeFinalizar(hoja);
  // total, NUNCA hoja.tamano: tamano es el tamaño nominal del lote pedido
  // al crear las hojas, no cuántos productos tiene ESTA — la última hoja
  // de un inventario real queda parcial, y decirle a quien cuenta que
  // "quedan 14 sin contar" cuando esos 14 no existen la hace dudar de su
  // propio trabajo y recontar una hoja que ya estaba completa.
  //
  // DECISIÓN DEL CLIENTE (2026-09-05): finalizar con renglones vacíos ya NO
  // los deja en "faltan N / quedan vacíos" — cada uno se registra en 0 ("si
  // no hay el producto, es 0"). Por eso el aviso pasó a ser una CONFIRMACIÓN
  // de que esos N se van a registrar en 0. El relleno lo hace
  // `repositorioHojas.finalizar` (encola un 0 por cada uno y después
  // finaliza, ver hojas-sqlite.ts#finalizar), así funciona igual sin red.
  const textoFinalizar =
    faltantes > 0
      ? `${faltantes} ${faltantes === 1 ? 'producto se va' : 'productos se van'} a registrar en 0. ¿Finalizar?`
      : `Los ${total} ítems de esta hoja están contados.`;

  // `error` se arma con la razón ACOTADA a esta hoja (`razonRechazoHoja`),
  // nunca con `estadoCola.error` (global) directo — el resto de `estadoCola`
  // (pendientes/sinRed/últimaSync) sí es correcto compartirlo: "sin señal"
  // es un hecho del equipo entero, no de una hoja en particular.
  const colaDeEstaHoja: EstadoCola = {
    ...estadoCola,
    error: hoja.sync === 'error' ? (razonRechazoHoja ?? 'No se pudo sincronizar — revisa la conexión o pide ayuda.') : null,
  };
  const sync = sincronizacionDeHojas([hoja], colaDeEstaHoja);

  return (
    // Los tres overlays (ModalConteo, ModalEscaner, confirmación de
    // Finalizar) se renderizan como hermanos de PantallaConTabs, NUNCA
    // adentro: si quedan dentro del ScrollView, su absoluteFillObject
    // queda recortado por el contenido scrolleable y se desplaza con él
    // en vez de cubrir la pantalla entera.
    <>
      <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <View style={styles.cabeceraHoja}>
        <BarraApp rotulo={`Conteo ciego · ${ORDINAL[ronda ?? 1]} conteo`} sinBorde />
        <AvanceFila texto={`${contados} / ${total} Productos`} porcentaje={porcentaje} />
      </View>

      <BandaSync estado={sync.estado} mensaje={sync.mensaje} onSincronizar={() => sincronizador.sincronizar()} />

      <View style={styles.buscadorFila}>
        {/* El buscador + los chips de categoría se reemplazaron por este
            botón que abre el modal de filtros (categoría, nombre, código):
            los chips no escalaban a una hoja mezclada con muchas categorías
            (decisión del cliente, 2026-09-07). El badge dice cuántos filtros
            hay puestos. */}
        <Pressable
          style={styles.btnFiltros}
          onPress={() => setModalFiltrosVisible(true)}
          accessibilityLabel={filtrosActivos > 0 ? `Filtros, ${filtrosActivos} activo${filtrosActivos === 1 ? '' : 's'}` : 'Filtros'}
        >
          <Filter size={17} color={colors.tinta} />
          <Text style={styles.btnFiltrosTexto}>Filtros</Text>
          {filtrosActivos > 0 ? (
            <View style={styles.filtrosBadge}>
              <Text style={styles.filtrosBadgeTexto}>{filtrosActivos}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          style={[styles.btnScan, bloqueado && styles.btnScanDeshabilitado]}
          onPress={bloqueado ? undefined : abrirEscaner}
          disabled={bloqueado}
          accessibilityLabel="Escanear código de barras para confirmar el producto"
        >
          <ScanLine size={19} color={colors.blanco} />
        </Pressable>
      </View>

      {/* El cartel verde persistente del último escaneo se quitó a pedido del
          cliente ("no es necesario el mensaje"). El escaneo sigue igual: abre
          el modal del producto y lo marca como confirmado; `ultimoEscaneo`
          se conserva SOLO para `empaquePreseleccionado` de ModalConteo. El
          aviso de "código no pertenece a la hoja" NO se toca: ese vive en
          ModalEscaner y es el que evita contar de más. */}

      {visibles.length > 0 ? (
        <View style={styles.lista}>
          {visibles.map((producto) => (
            <TarjetaProducto
              key={producto.id}
              producto={producto}
              conteo={conteoDe(producto)}
              confirmado={confirmadoDe(producto)}
              bloqueado={bloqueado}
              onPress={() => abrirModalProducto(producto)}
            />
          ))}
        </View>
      ) : (
        <EmptyState
          icon={Search}
          title="Ningún producto coincide"
          subtitle="Prueba con otro nombre, código o categoría distinta."
        />
      )}

      <View style={styles.pieLista}>
        <Text style={styles.pieTexto}>
          {filtroTexto
            ? `Mostrando ${visibles.length} de ${hoja.productos.length} ítems · filtro: ${filtroTexto}`
            : `Mostrando los ${hoja.productos.length} ítems de esta hoja · desplázate para ver más`}
        </Text>
      </View>

      {bloqueado ? (
        <Pressable style={styles.accion} onPress={() => router.push('/conteo/mis-hojas')}>
          <Text style={styles.accionTexto}>Volver a mis hojas</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.accion} onPress={abrirModalFinalizar}>
          <Text style={styles.accionTexto}>Finalizar hoja #{hoja.numero}</Text>
        </Pressable>
      )}
      </PantallaConTabs>

      <ModalConteo
        visible={modalProducto !== null}
        producto={modalProducto}
        conteoInicial={modalProducto ? conteoDe(modalProducto) : null}
        confirmadoPorEscaner={modalProducto ? confirmadoDe(modalProducto) : false}
        empaquePreseleccionado={
          ultimoEscaneo && modalProducto && ultimoEscaneo.producto.id === modalProducto.id ? ultimoEscaneo.empaque?.nombre : undefined
        }
        onGuardar={guardarConteo}
        onCerrar={() => setModalProducto(null)}
      />

      <ModalEscaner
        visible={modalScanVisible}
        error={scanError}
        onEscanear={manejarEscaneo}
        onCerrar={() => setModalScanVisible(false)}
      />

      <ModalFiltrosProductos
        visible={modalFiltrosVisible}
        productos={hoja.productos}
        filtro={filtro}
        onAplicar={(nuevo) => {
          setFiltro(nuevo);
          setModalFiltrosVisible(false);
        }}
        onCerrar={() => setModalFiltrosVisible(false)}
      />

      {modalFinalizarVisible ? (
        <View style={styles.modalFinalizarFondo}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setModalFinalizarVisible(false)} />
          <View style={styles.modalFinalizarCaja}>
            <Text style={styles.modalFinalizarTitulo}>Finalizar hoja #{hoja.numero}</Text>
            <Text style={styles.modalFinalizarAlerta}>{textoFinalizar}</Text>
            <Text style={styles.modalFinalizarNota}>
              Después de finalizar, la hoja queda congelada: ningún ítem se puede volver a editar.
            </Text>
            <View style={styles.modalFinalizarAcciones}>
              <Pressable
                style={[styles.accion, styles.accionSecundaria]}
                onPress={() => setModalFinalizarVisible(false)}
                disabled={finalizando}
              >
                <Text style={styles.accionSecundariaTexto}>Seguir contando</Text>
              </Pressable>
              <Pressable style={styles.accion} onPress={confirmarFinalizar} disabled={finalizando}>
                {finalizando ? <ActivityIndicator color={colors.blanco} /> : <Text style={styles.accionTexto}>Sí, finalizar</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: 14, paddingTop: 8, gap: 16 },
  centrado: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  irAMisHojas: { marginTop: 8, paddingVertical: 12, paddingHorizontal: 20, borderRadius: radius.sm, backgroundColor: colors.rojo },
  irAMisHojasTexto: { fontSize: 14, color: colors.blanco, fontFamily: fonts.bold },
  cabeceraHoja: { gap: 13, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.borde },
  buscadorFila: { flexDirection: 'row', gap: 10 },
  btnFiltros: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borde,
    backgroundColor: colors.campo,
  },
  btnFiltrosTexto: { flex: 1, fontSize: 14, color: colors.tinta, fontFamily: fonts.semibold },
  filtrosBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.rojo,
  },
  filtrosBadgeTexto: { fontSize: 12, color: colors.blanco, fontFamily: fonts.bold },
  btnScan: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.rojo },
  btnScanDeshabilitado: { backgroundColor: '#DCD6D2' },
  lista: { gap: 10 },
  pieLista: { padding: 12, borderRadius: 11, backgroundColor: colors.esperaSuave },
  pieTexto: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
  accion: {
    minHeight: 52,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.rojo,
  },
  accionTexto: { fontSize: 15, color: colors.blanco, fontFamily: fonts.bold },
  accionSecundaria: { backgroundColor: colors.campo, borderWidth: 1, borderColor: colors.borde },
  accionSecundariaTexto: { fontSize: 15, color: colors.tinta, fontFamily: fonts.bold },
  modalFinalizarFondo: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
  },
  modalFinalizarCaja: { width: '100%', maxWidth: 310, gap: 12, padding: 17, borderRadius: radius.xl, backgroundColor: colors.campo },
  modalFinalizarTitulo: { fontSize: 15, color: colors.tinta, fontFamily: fonts.bold },
  modalFinalizarAlerta: { fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.semibold, lineHeight: 19 },
  modalFinalizarNota: { fontSize: fontSize.xs + 1, color: colors.gris, fontFamily: fonts.regular, lineHeight: 16 },
  modalFinalizarAcciones: { flexDirection: 'row', gap: 10 },
});
