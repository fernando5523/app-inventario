import { router } from 'expo-router';
import { Building2, ChevronLeft, Search, ShieldAlert, Tag, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { repositorioClasificacion } from '../../lib/contenedor';
import {
  aplicarClasificacion,
  estadoClasificacion,
  hayMasPorCargar,
  soloConClasificacion,
  textoResponsableDynamics,
} from '../../lib/dominio/clasificacion';
import { pluralizar } from '../../lib/dominio/plural';
import type { ProductoClasificable } from '../../lib/puertos/repositorios';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';
import { useRefrescoAlEnfocar } from '../hooks/useRefrescoAlEnfocar';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';
import { Badge, type BadgeVariant, BarraApp, Button, CampoTexto, ChipsFiltro, EmptyState, formatoMiles, type OpcionChip } from '../ui';

/** Cuántos productos por página del catálogo (~11.800). Ver `cargar`/`cargarMas`. */
const TAMANO_PAGINA = 40;

/**
 * CUÁNDO aplica, en una línea y sin tecnicismos (pedido explícito): la
 * clasificación se evalúa al liquidar, así que solo mueve la cuenta de los
 * inventarios que todavía no se liquidaron.
 */
const AVISO_CUANDO_APLICA =
  'Lo que marques aquí cuenta para los inventarios que todavía no se liquidaron. Los ya liquidados no cambian.';

const OPCIONES_FILTRO: OpcionChip[] = [
  { id: 'todos', etiqueta: 'Todos' },
  { id: 'clasificados', etiqueta: 'Solo clasificados' },
];

/** El badge de la fila: la decisión del AUDITOR (aparte de lo que dice Dynamics). */
function badgeDelAuditor(p: ProductoClasificable): { label: string; variant: BadgeVariant } | null {
  const estado = estadoClasificacion(p);
  if (estado.tipo === 'sin-clasificar') return null;
  const decision = estado.esEmpresa ? 'Empresa' : 'Empleado';
  // `proceso` (ámbar) resalta la excepción que MUEVE la cuenta; `ok` (verde) la
  // que coincide con Dynamics — dos señales además del texto, como en el resto.
  return { label: decision, variant: estado.tipo === 'excepcion' ? 'proceso' : 'ok' };
}

/**
 * Clasificación de productos (Auditor). Marca por CÓDIGO qué productos asume la
 * empresa aunque Dynamics los ponga del empleado (las cervezas: se descuentan
 * para la empresa por seguimiento de robo). Busca en el catálogo (~11.800),
 * muestra por separado lo que dice Dynamics y lo que decidió el Auditor, y deja
 * clasificar/desclasificar con nota opcional.
 *
 * Sin variante en memoria (ver contenedor.ts): sin backend, avisa que no pudo
 * cargar — nunca inventa excepciones.
 */
export function ClasificacionScreen(): JSX.Element {
  const [q, setQ] = useState('');
  const [soloClasificados, setSoloClasificados] = useState(false);

  const [productos, setProductos] = useState<ProductoClasificable[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [seleccionado, setSeleccionado] = useState<ProductoClasificable | null>(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Un solo lugar arma el filtro: `cargar` (primera página) y `cargarMas` (la
  // siguiente) tienen que pedir EXACTAMENTE lo mismo, o "cargar más" traería
  // una página de otro filtro. Mismo criterio que HistorialScreen.
  const filtroActual = useCallback(
    (desplazamiento: number) => ({
      q: q.trim() ? q.trim() : undefined,
      soloClasificados,
      limite: TAMANO_PAGINA,
      desplazamiento,
    }),
    [q, soloClasificados],
  );

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const pagina = await repositorioClasificacion.buscar(filtroActual(0));
      setProductos(pagina.productos);
      setTotal(pagina.total);
    } catch (e) {
      // Sin esto, un fallo sin red deja el spinner girando para siempre.
      setError(e instanceof Error ? e.message : 'No se pudo cargar el catálogo.');
    } finally {
      setCargando(false);
    }
  }, [filtroActual]);

  async function cargarMas(): Promise<void> {
    if (cargandoMas) return;
    setCargandoMas(true);
    try {
      const pagina = await repositorioClasificacion.buscar(filtroActual(productos.length));
      setProductos((actuales) => [...actuales, ...pagina.productos]);
      setTotal(pagina.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron traer más productos.');
    } finally {
      setCargandoMas(false);
    }
  }

  // Al cambiar la búsqueda o el filtro: recarga desde la primera página, con un
  // pequeño respiro para no pegarle al backend en cada tecla. En el primer
  // render no corre — la carga inicial ya la dispara useRefrescoAlEnfocar.
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    const id = setTimeout(() => {
      setCargando(true);
      void cargar();
    }, 350);
    return () => clearTimeout(id);
  }, [cargar]);

  function abrir(p: ProductoClasificable): void {
    setSeleccionado(p);
    setNota(p.clasificacion?.nota ?? '');
  }

  function cerrar(): void {
    setSeleccionado(null);
    setNota('');
  }

  async function marcarEmpresa(): Promise<void> {
    if (!seleccionado) return;
    setGuardando(true);
    try {
      const clasificacion = await repositorioClasificacion.clasificar(seleccionado.codigo, {
        esEmpresa: true,
        ...(nota.trim() ? { nota: nota.trim() } : {}),
      });
      // Actualiza SOLO esa fila, sin volver a pedir las ~11.800.
      setProductos((actuales) => aplicarClasificacion(actuales, seleccionado.codigo, clasificacion));
      cerrar();
    } catch (e) {
      Alert.alert('No se pudo clasificar', e instanceof Error ? e.message : 'Intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  async function quitarExcepcion(): Promise<void> {
    if (!seleccionado) return;
    setGuardando(true);
    try {
      await repositorioClasificacion.desclasificar(seleccionado.codigo);
      setProductos((actuales) => {
        const actualizada = aplicarClasificacion(actuales, seleccionado.codigo, null);
        // Bajo "solo clasificados", el que perdió la excepción sale de la lista.
        return soloClasificados ? soloConClasificacion(actualizada) : actualizada;
      });
      cerrar();
    } catch (e) {
      Alert.alert('No se pudo quitar la excepción', e instanceof Error ? e.message : 'Intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  const cifras = `${formatoMiles(total)} ${soloClasificados ? pluralizar(total, 'excepción', 'excepciones') : pluralizar(total, 'producto', 'productos')}`;
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar, { pausado: seleccionado !== null });

  return (
    <>
      <PantallaConTabs
        scrollable
        contentStyle={styles.contenido}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={colors.rojo} colors={[colors.rojo]} />}
      >
        <BarraApp rotulo="Clasificación de productos" cifras={cifras} />

        <Pressable style={styles.volver} onPress={() => router.back()} accessibilityRole="button">
          <ChevronLeft size={15} color={colors.rojo} />
          <Text style={styles.volverTexto}>Volver</Text>
        </Pressable>

        <Text style={styles.aviso}>{AVISO_CUANDO_APLICA}</Text>

        <CampoTexto
          label="Buscar producto"
          valor={q}
          onCambiar={setQ}
          icon={Search}
          placeholder="Código, descripción o categoría"
          autoCapitalize="none"
        />

        <ChipsFiltro
          opciones={OPCIONES_FILTRO}
          activo={soloClasificados ? 'clasificados' : 'todos'}
          onCambiar={(id) => setSoloClasificados(id === 'clasificados')}
        />

        {cargando ? (
          <ActivityIndicator color={colors.rojo} style={styles.spinner} />
        ) : error ? (
          <EmptyState icon={ShieldAlert} title="No se pudo cargar" subtitle={error}>
            <Button label="Reintentar" variant="outline" onPress={() => { setCargando(true); void cargar(); }} />
          </EmptyState>
        ) : productos.length === 0 ? (
          <EmptyState
            icon={Search}
            title={soloClasificados ? 'Todavía no hay excepciones' : 'Sin resultados'}
            subtitle={
              soloClasificados
                ? 'Cuando marques un producto como empresa, va a aparecer aquí.'
                : 'Prueba con otro código, descripción o categoría.'
            }
          />
        ) : (
          <>
            {productos.map((p) => {
              const badge = badgeDelAuditor(p);
              return (
                <Pressable key={p.codigo} style={styles.fila} onPress={() => abrir(p)} accessibilityRole="button">
                  <View style={styles.filaTexto}>
                    <Text style={styles.codigo}>{p.codigo}</Text>
                    {/* Truncado al FINAL: se reconoce el producto por cómo empieza. */}
                    <Text style={styles.descripcion} numberOfLines={1} ellipsizeMode="tail">
                      {p.descripcion}
                    </Text>
                    <Text style={styles.categoria} numberOfLines={1} ellipsizeMode="tail">
                      {p.categoria ?? 'Sin categoría'}
                    </Text>
                  </View>
                  <View style={styles.filaEstado}>
                    {/* DOS datos separados: lo que dice Dynamics... */}
                    <Text style={styles.dynamics}>Dynamics: {textoResponsableDynamics(p.responsableDynamics)}</Text>
                    {/* ...y lo que decidió el Auditor (o nada). */}
                    {badge ? <Badge label={badge.label} variant={badge.variant} /> : <Text style={styles.sinExcepcion}>Sin excepción</Text>}
                  </View>
                </Pressable>
              );
            })}

            {hayMasPorCargar(productos.length, total) ? (
              <Button label="Cargar más" variant="outline" onPress={cargarMas} loading={cargandoMas} />
            ) : null}
          </>
        )}
      </PantallaConTabs>

      <Modal visible={seleccionado !== null} transparent animationType="fade" onRequestClose={cerrar}>
        <Pressable style={styles.overlay} onPress={cerrar}>
          {/* onPress vacío: captura el toque para que tocar DENTRO no cierre. */}
          <Pressable style={styles.modalCaja} onPress={() => {}}>
            <View style={styles.modalCabecera}>
              <Text style={styles.modalTitulo} numberOfLines={2}>
                {seleccionado?.descripcion}
              </Text>
              <Pressable onPress={cerrar} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={8}>
                <X size={20} color={colors.gris} />
              </Pressable>
            </View>
            <Text style={styles.modalCodigo}>{seleccionado?.codigo}</Text>

            <View style={styles.modalDatos}>
              <View style={styles.modalDato}>
                <Text style={styles.modalDatoRotulo}>Dynamics dice</Text>
                <Text style={styles.modalDatoValor}>
                  {seleccionado ? textoResponsableDynamics(seleccionado.responsableDynamics) : ''}
                </Text>
              </View>
              <View style={styles.modalDato}>
                <Text style={styles.modalDatoRotulo}>Decisión del Auditor</Text>
                <Text style={styles.modalDatoValor}>
                  {seleccionado?.clasificacion ? (seleccionado.clasificacion.esEmpresa ? 'Empresa' : 'Empleado') : 'Sin excepción'}
                </Text>
              </View>
            </View>

            <CampoTexto
              label="Nota (opcional)"
              valor={nota}
              onCambiar={setNota}
              icon={Tag}
              placeholder="Por qué la asume la empresa"
            />

            <Button label="Marcar como empresa" icon={Building2} onPress={marcarEmpresa} loading={guardando} />
            {seleccionado?.clasificacion ? (
              <Button label="Quitar excepción" variant="outline" onPress={quitarExcepcion} disabled={guardando} />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  contenido: { gap: spacing.md },
  volver: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  volverTexto: { color: colors.rojo, fontFamily: fonts.semibold, fontSize: fontSize.sm },
  aviso: {
    color: colors.gris,
    fontFamily: fonts.regular,
    fontSize: fontSize.sm,
    backgroundColor: colors.esperaSuave,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  spinner: { marginTop: spacing.xl },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.campo,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.md,
  },
  filaTexto: { flex: 1, gap: 2 },
  codigo: { color: colors.gris, fontFamily: fonts.semibold, fontSize: fontSize.xs },
  descripcion: { color: colors.tinta, fontFamily: fonts.semibold, fontSize: fontSize.base },
  categoria: { color: colors.grisClaro, fontFamily: fonts.regular, fontSize: fontSize.xs },
  filaEstado: { alignItems: 'flex-end', gap: 6, maxWidth: '42%' },
  dynamics: { color: colors.gris, fontFamily: fonts.regular, fontSize: fontSize.xs, textAlign: 'right' },
  sinExcepcion: { color: colors.grisClaro, fontFamily: fonts.regular, fontSize: fontSize.xs },

  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.xl },
  modalCaja: { backgroundColor: colors.blanco, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md },
  modalCabecera: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  modalTitulo: { flex: 1, color: colors.tinta, fontFamily: fonts.bold, fontSize: fontSize.lg },
  modalCodigo: { color: colors.gris, fontFamily: fonts.semibold, fontSize: fontSize.sm, marginTop: -spacing.sm },
  modalDatos: { flexDirection: 'row', gap: spacing.md },
  modalDato: {
    flex: 1,
    gap: 2,
    backgroundColor: colors.esperaSuave,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  modalDatoRotulo: { color: colors.gris, fontFamily: fonts.regular, fontSize: fontSize.xs },
  modalDatoValor: { color: colors.tinta, fontFamily: fonts.semibold, fontSize: fontSize.base },
});
