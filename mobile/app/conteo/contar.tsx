import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ClipboardList, ScanLine, Search } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  AvanceFila,
  BandaSync,
  BarraApp,
  EmptyState,
  ModalConteo,
  ModalEscaner,
  TarjetaProducto,
  sincronizacionDeHojas,
  type RechazoEscaneo,
} from '../../components/ui';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { inventarioIdSinRed, rondaActivaSinRed } from '../../lib/adaptadores/hojas-sqlite';
import { repositorioCatalogo, repositorioHojas, repositorioInventario, sincronizador } from '../../lib/contenedor';
import { avance, puedeEditar, puedeFinalizar } from '../../lib/dominio/hoja';
import type { Conteo, Empaque, HojaConteo, Producto } from '../../lib/dominio/tipos';
import type { EstadoCola } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, fontSize, radius } from '../../lib/theme';

function coincide(p: Producto, q: string): boolean {
  if (!q) return true;
  const query = q.toLowerCase();
  return (
    p.descripcion.toLowerCase().includes(query) ||
    p.codigoBarras.toLowerCase().includes(query) ||
    p.codigo.toLowerCase().includes(query)
  );
}

/**
 * Conteo ciego — la pantalla más importante del producto. Regla número
 * uno: en ningún lugar de acá aparece el stock del ERP, solo lo que el
 * operario cuenta. Las siete reglas de docs/pantallas.md siguen vigentes,
 * marcadas en el código donde aplican.
 */
export default function ContarScreen(): JSX.Element {
  const { sesion } = useSesion();
  const params = useLocalSearchParams<{ numero?: string }>();

  const [cargando, setCargando] = useState(true);
  const [inventarioId, setInventarioId] = useState<number | null>(null);
  // La ronda ACTIVA del inventario. El Contador cuenta la ronda en curso, no
  // siempre la 1ra: se resuelve junto con el inventarioId (del servidor, o de
  // SQLite sin red) y se pasa a cada lectura de hojas.
  const [ronda, setRonda] = useState<number | null>(null);
  const [numeroActivo, setNumeroActivo] = useState<string | null>(params.numero ?? null);
  const [hoja, setHoja] = useState<HojaConteo | null>(null);
  const [busqueda, setBusqueda] = useState('');

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
  const [ultimoEscaneo, setUltimoEscaneo] = useState<{ producto: Producto; presentacion: 'unidad' | 'empaque'; empaque: Empaque | null } | null>(
    null,
  );
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

  // Carga inicial: si no vino un número de hoja por parámetro (se entró
  // por el tab "Contar", no desde Mis hojas), se busca la hoja en proceso
  // del colaborador — nunca todas(), siempre mias().
  useEffect(() => {
    if (!sesion) return;
    let vigente = true;

    async function iniciar(): Promise<void> {
      let inventarioIdResuelto: number | null;
      let rondaResuelta: number | null;
      try {
        const activo = await repositorioInventario.activo(sesion!.sucursal!.id);
        inventarioIdResuelto = activo?.inventarioId ?? null;
        rondaResuelta = activo?.rondaActiva ?? null;
      } catch {
        // Sin red (u otra falla): no hay forma de preguntarle al servidor
        // cuál es el inventario activo, pero el avance de HOY puede estar
        // completo en SQLite — se sigue con eso en vez de dejar la
        // pantalla colgada esperando una respuesta que no va a llegar. Ver
        // inventarioIdSinRed: es EL bug que reportó el cliente ("conté sin
        // señal, cerré la app, la reabrí y vi un spinner infinito" con el
        // trabajo sano en el teléfono, pero invisible).
        inventarioIdResuelto = await inventarioIdSinRed();
        rondaResuelta = inventarioIdResuelto ? await rondaActivaSinRed(inventarioIdResuelto) : null;
      }
      if (!vigente) return;
      // Sin inventario o sin ronda (no hay hojas todavía) no hay nada que
      // contar: la ronda es tan requisito como el inventario.
      if (!inventarioIdResuelto || rondaResuelta === null) {
        setCargando(false);
        return;
      }
      setInventarioId(inventarioIdResuelto);
      setRonda(rondaResuelta);

      let numero = numeroActivo;
      if (!numero) {
        const mias = await repositorioHojas.mias(inventarioIdResuelto, rondaResuelta);
        const actual = mias.find((h) => h.estado === 'en-proceso' && h.productos.length > 0) ?? mias.find((h) => h.productos.length > 0);
        numero = actual?.numero ?? null;
        if (vigente && numero) setNumeroActivo(numero);
      }

      if (!numero) {
        if (vigente) setCargando(false);
        return;
      }

      const encontrada = await repositorioHojas.porNumero(inventarioIdResuelto, numero, rondaResuelta);
      if (vigente) {
        setHoja(encontrada);
        setCargando(false);
      }
    }

    iniciar();
    return () => {
      vigente = false;
    };
  }, [sesion, numeroActivo]);

  const refrescarHoja = useCallback(async () => {
    if (!inventarioId || !numeroActivo || ronda === null) return;
    const actualizada = await repositorioHojas.porNumero(inventarioId, numeroActivo, ronda);
    setHoja(actualizada);
  }, [inventarioId, numeroActivo, ronda]);

  // useFocusEffect: si se vuelve a esta pantalla por el tab (no por "Abrir
  // hoja" en Mis hojas), la hoja ya cargada puede haber cambiado mientras
  // tanto — no-op en el montaje inicial (inventarioId/numeroActivo todavía
  // null), la carga real la hace el efecto de arriba.
  useFocusEffect(
    useCallback(() => {
      refrescarHoja();
    }, [refrescarHoja]),
  );

  if (!sesion) return <View />;

  if (cargando) {
    return (
      <PantallaConTabs contentStyle={styles.centrado}>
        <ActivityIndicator color={colors.rojo} />
      </PantallaConTabs>
    );
  }

  if (!hoja) {
    return (
      <PantallaConTabs contentStyle={styles.centrado}>
        <EmptyState
          icon={ClipboardList}
          title="No tenés ninguna hoja para contar"
          subtitle="Elegí una hoja con catálogo cargado desde Mis hojas."
        >
          <Pressable style={styles.irAMisHojas} onPress={() => router.push('/conteo/mis-hojas')}>
            <Text style={styles.irAMisHojasTexto}>Ir a Mis hojas</Text>
          </Pressable>
        </EmptyState>
      </PantallaConTabs>
    );
  }

  const bloqueado = !puedeEditar(hoja);
  const { contados, total, porcentaje } = avance(hoja);
  const visibles = hoja.productos.filter((p) => coincide(p, busqueda));

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
      await refrescarHoja();
    } catch (error) {
      Alert.alert('No se pudo guardar', error instanceof Error ? error.message : 'Intentá de nuevo.');
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
  // Un código puede ser el de la UNIDAD suelta (`Producto.codigoBarras`) o
  // el de alguno de los EMPAQUES (`Empaque.codigoBarras`, opcional — y,
  // con el catálogo real de Dynamics, casi siempre ausente: ver el
  // comentario de `ultimoEscaneo`). Se busca en TODOS los empaques del
  // producto, no en uno fijo: puede tener más de uno (Caja Y Pack).
  //
  // El puerto `porCodigoBarras` resuelve la unidad; el empaque se busca acá
  // sobre `hoja.productos`, que ya está cargada en memoria. No es lógica de
  // catálogo duplicada: es desambiguar QUÉ presentación se escaneó, y la
  // pantalla ya tiene el dato sin pedir nada.
  async function manejarEscaneo(codigo: string): Promise<void> {
    let porUnidad: Producto | null;
    try {
      porUnidad = await repositorioCatalogo.porCodigoBarras(hoja!.id, codigo);
    } catch (error) {
      // La consulta sale a la red (catalogo-api.ts) y el WiFi de tienda se
      // cae: sin este catch la promesa quedaba colgada, el modal nunca se
      // rehabilitaba y el escáner moría en silencio, sin decir por qué.
      rechazarEscaneo(
        error instanceof Error && error.message ? `No se pudo verificar el código: ${error.message}` : 'No se pudo verificar el código. Revisá la conexión y probá de nuevo.',
      );
      return;
    }

    let productoPorEmpaque: Producto | null = null;
    let empaqueEscaneado: Empaque | null = null;
    if (!porUnidad) {
      for (const p of hoja!.productos) {
        const empaque = p.empaques.find((e) => e.codigoBarras === codigo);
        if (empaque) {
          productoPorEmpaque = p;
          empaqueEscaneado = empaque;
          break;
        }
      }
    }
    const producto = porUnidad ?? productoPorEmpaque;

    if (!producto) {
      // Con el código a la vista: el operario puede comparar contra la
      // etiqueta y darse cuenta de que apuntó al vecino de góndola, que es
      // justo el error que este aviso existe para atajar.
      rechazarEscaneo(`El código ${codigo} no pertenece a la hoja #${hoja!.numero}. No se registró nada.`);
      return;
    }

    setScanError(null);
    setModalScanVisible(false);
    setConfirmadosPendientes((prev) => new Set(prev).add(producto.id));
    setUltimoEscaneo({ producto, presentacion: empaqueEscaneado ? 'empaque' : 'unidad', empaque: empaqueEscaneado });
    setModalProducto(producto);
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
      Alert.alert('No se pudo finalizar', error instanceof Error ? error.message : 'Intentá de nuevo.');
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
  const textoFinalizar =
    faltantes > 0
      ? `Quedan ${faltantes} de ${total} ítems sin contar. Si finalizás ahora, esos ítems quedan vacíos.`
      : `Los ${total} ítems de esta hoja están contados.`;

  const sync = sincronizacionDeHojas([hoja], estadoCola);

  return (
    // Los tres overlays (ModalConteo, ModalEscaner, confirmación de
    // Finalizar) se renderizan como hermanos de PantallaConTabs, NUNCA
    // adentro: si quedan dentro del ScrollView, su absoluteFillObject
    // queda recortado por el contenido scrolleable y se desplaza con él
    // en vez de cubrir la pantalla entera.
    <>
      <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <View style={styles.cabeceraHoja}>
        <BarraApp rotulo="Conteo ciego · 1er conteo" sinBorde />
        <AvanceFila texto={`${contados} / ${total} Productos`} porcentaje={porcentaje} />
      </View>

      <BandaSync estado={sync.estado} mensaje={sync.mensaje} onSincronizar={() => sincronizador.sincronizar()} />

      <View style={styles.buscadorFila}>
        <View style={styles.buscador}>
          <Search size={17} color={colors.grisClaro} />
          <TextInput
            style={styles.buscadorInput}
            value={busqueda}
            onChangeText={setBusqueda}
            placeholder={`Filtrar entre los ${total} de esta hoja o buscar código...`}
            placeholderTextColor={colors.grisClaro}
          />
        </View>
        <Pressable
          style={[styles.btnScan, bloqueado && styles.btnScanDeshabilitado]}
          onPress={bloqueado ? undefined : abrirEscaner}
          disabled={bloqueado}
          accessibilityLabel="Escanear código de barras para confirmar el producto"
        >
          <ScanLine size={19} color={colors.blanco} />
        </Pressable>
      </View>

      {ultimoEscaneo ? (
        <View style={styles.notaEscaneo}>
          <Text style={styles.notaEscaneoTexto}>
            {/* Se dice lo que el código probó (qué producto es) y nada más.
                "Leíste el código de la UNIDAD suelta" sonaba a que el
                sistema sabía que había una unidad en la mano, y no lo sabe:
                el mismo código está impreso en la unidad y en la caja. */}
            {ultimoEscaneo.empaque
              ? `Confirmado con la cámara: ${ultimoEscaneo.producto.descripcion} · ${ultimoEscaneo.empaque.nombre} ×${ultimoEscaneo.empaque.factor}.`
              : `Confirmado con la cámara: ${ultimoEscaneo.producto.descripcion}. El código no dice cuántas hay — la cantidad y el empaque los cargás vos.`}
          </Text>
        </View>
      ) : null}

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

      <View style={styles.pieLista}>
        <Text style={styles.pieTexto}>
          {busqueda
            ? `Mostrando ${visibles.length} de ${hoja.productos.length} ítems · filtro: "${busqueda}"`
            : `Mostrando los ${hoja.productos.length} ítems de esta hoja · desplazate para ver más`}
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
  buscador: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 13,
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borde,
    backgroundColor: colors.campo,
  },
  buscadorInput: { flex: 1, fontSize: 14, color: colors.tinta, fontFamily: fonts.regular, padding: 0 },
  btnScan: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.rojo },
  btnScanDeshabilitado: { backgroundColor: '#DCD6D2' },
  notaEscaneo: { padding: 11, borderRadius: radius.sm, backgroundColor: colors.okSuave },
  notaEscaneoTexto: { fontSize: 12.5, color: colors.ok, fontFamily: fonts.semibold, lineHeight: 17 },
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
