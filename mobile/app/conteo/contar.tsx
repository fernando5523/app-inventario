import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ClipboardList, ScanLine, Search } from 'lucide-react-native';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  AvanceFila,
  BandaSync,
  BarraApp,
  EmptyState,
  ModalConteo,
  ModalEscaner,
  TarjetaProducto,
  opcionesDeEscaneo,
  sincronizacionDeHojas,
} from '../../components/ui';
import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { repositorioCatalogo, repositorioHojas, repositorioInventario } from '../../lib/contenedor';
import { avance, puedeEditar, puedeFinalizar } from '../../lib/dominio/hoja';
import type { Conteo, HojaConteo, Producto } from '../../lib/dominio/tipos';
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
  const [numeroActivo, setNumeroActivo] = useState<string | null>(params.numero ?? null);
  const [hoja, setHoja] = useState<HojaConteo | null>(null);
  const [busqueda, setBusqueda] = useState('');

  // Confirmado por escáner ANTES de guardar el conteo — el escaneo puede
  // pasar antes de que exista un Conteo para ese producto (regla c).
  const [confirmadosPendientes, setConfirmadosPendientes] = useState<Set<number>>(new Set());

  const [modalProducto, setModalProducto] = useState<Producto | null>(null);
  const [modalScanVisible, setModalScanVisible] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [modalFinalizarVisible, setModalFinalizarVisible] = useState(false);
  const [finalizando, setFinalizando] = useState(false);

  // Carga inicial: si no vino un número de hoja por parámetro (se entró
  // por el tab "Contar", no desde Mis hojas), se busca la hoja en proceso
  // del colaborador — nunca todas(), siempre mias().
  useEffect(() => {
    if (!sesion) return;
    let vigente = true;

    async function iniciar(): Promise<void> {
      const activo = await repositorioInventario.activo(sesion!.sucursal.id);
      if (!vigente) return;
      if (!activo) {
        setCargando(false);
        return;
      }
      setInventarioId(activo.inventarioId);

      let numero = numeroActivo;
      if (!numero) {
        const mias = await repositorioHojas.mias(activo.inventarioId);
        const actual = mias.find((h) => h.estado === 'en-proceso' && h.productos.length > 0) ?? mias.find((h) => h.productos.length > 0);
        numero = actual?.numero ?? null;
        if (vigente && numero) setNumeroActivo(numero);
      }

      if (!numero) {
        if (vigente) setCargando(false);
        return;
      }

      const encontrada = await repositorioHojas.porNumero(activo.inventarioId, numero);
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
    if (!inventarioId || !numeroActivo) return;
    const actualizada = await repositorioHojas.porNumero(inventarioId, numeroActivo);
    setHoja(actualizada);
  }, [inventarioId, numeroActivo]);

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
  const { contados, porcentaje } = avance(hoja);
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
  async function manejarEscaneo(codigo: string): Promise<void> {
    const producto = await repositorioCatalogo.porCodigoBarras(hoja!.id, codigo);
    if (!producto) {
      setScanError(`Este código no pertenece a la hoja #${hoja!.numero}.`);
      return;
    }
    setScanError(null);
    setModalScanVisible(false);
    setConfirmadosPendientes((prev) => new Set(prev).add(producto.id));
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
    } catch (error) {
      Alert.alert('No se pudo finalizar', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setFinalizando(false);
    }
  }

  const { faltantes } = puedeFinalizar(hoja);
  const textoFinalizar =
    faltantes > 0
      ? `Quedan ${faltantes} de ${hoja.tamano} ítems sin contar. Si finalizás ahora, esos ítems quedan vacíos.`
      : `Los ${hoja.tamano} ítems de esta hoja están contados.`;

  const sync = sincronizacionDeHojas([hoja]);

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
        <AvanceFila texto={`${contados} / ${hoja.tamano} Productos`} porcentaje={porcentaje} />
      </View>

      <BandaSync estado={sync.estado} mensaje={sync.mensaje} />

      <View style={styles.buscadorFila}>
        <View style={styles.buscador}>
          <Search size={17} color={colors.grisClaro} />
          <TextInput
            style={styles.buscadorInput}
            value={busqueda}
            onChangeText={setBusqueda}
            placeholder={`Filtrar entre los ${hoja.tamano} de esta hoja o buscar código...`}
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
        onGuardar={guardarConteo}
        onCerrar={() => setModalProducto(null)}
      />

      <ModalEscaner
        visible={modalScanVisible}
        opciones={opcionesDeEscaneo(hoja.productos)}
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
