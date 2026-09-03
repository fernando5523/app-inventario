import { router } from 'expo-router';
import { Check, CloudDownload, LayoutGrid, Users } from 'lucide-react-native';
import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import { BarraApp, Badge, Button, type BadgeVariant } from '../../components/ui';
import { repositorioHojas, repositorioInventario, repositorioSesion } from '../../lib/contenedor';
import { partirEnHojas } from '../../lib/dominio/lote';
import { TAMANOS_HOJA, type Colaborador, type HojaConteo, type TamanoHoja } from '../../lib/dominio/tipos';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';

const nf = new Intl.NumberFormat('es-PE');

type EstadoPaso = 'bloqueado' | 'pendiente' | 'hecho';

const BADGE_VARIANTE: Record<EstadoPaso, BadgeVariant> = {
  bloqueado: 'default',
  pendiente: 'default',
  hecho: 'ok',
};
const BADGE_TEXTO: Record<EstadoPaso, string> = {
  bloqueado: 'Bloqueado',
  pendiente: 'Pendiente',
  hecho: 'Hecho',
};

interface PasoTarjetaProps {
  numero: number;
  icon: typeof CloudDownload;
  titulo: string;
  estado: EstadoPaso;
  texto: string;
  children?: ReactNode;
}

function PasoTarjeta({ numero, icon: Icon, titulo, estado, texto, children }: PasoTarjetaProps): JSX.Element {
  return (
    <View style={[styles.tarjeta, estado === 'bloqueado' && styles.tarjetaBloqueada]}>
      <View style={styles.tarjetaCabecera}>
        <View style={[styles.pasoMarca, estado === 'hecho' && styles.pasoMarcaHecho]}>
          {estado === 'hecho' ? <Check size={13} color={colors.blanco} /> : <Text style={styles.pasoMarcaTexto}>{numero}</Text>}
        </View>
        <Icon size={18} color={colors.rojo} />
        <Text style={styles.tarjetaTitulo}>{titulo}</Text>
        <Badge label={BADGE_TEXTO[estado]} variant={BADGE_VARIANTE[estado]} />
      </View>
      <Text style={styles.tarjetaTexto}>{texto}</Text>
      {children}
    </View>
  );
}

interface SelectorTamanoProps {
  valor: TamanoHoja | null;
  onElegir: (tamano: TamanoHoja) => void;
  disabled: boolean;
}

/** `.segmentado`/`.segmento` del design system: a diferencia del rol
 * (dato derivado, se muestra), acá el Coordinador SÍ elige — por eso son
 * Pressable reales, no View. */
function SelectorTamano({ valor, onElegir, disabled }: SelectorTamanoProps): JSX.Element {
  return (
    <View style={[styles.segmentado, disabled && styles.segmentadoDeshabilitado]}>
      {TAMANOS_HOJA.map((tamano, i) => {
        const activo = valor === tamano;
        return (
          <Pressable
            key={tamano}
            onPress={() => onElegir(tamano)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: activo, disabled }}
            style={[styles.segmento, i < TAMANOS_HOJA.length - 1 && styles.segmentoConBorde, activo && styles.segmentoActivo]}
          >
            <Text style={[styles.segmentoTexto, activo && styles.segmentoTextoActivo]}>{tamano}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Panel del Coordinador — 3 pasos en orden, cada uno bloqueado hasta que
 * el anterior termina (mobile/design/hojas.html, ya validada). Un solo
 * CTA al pie cuya acción cambia según el paso activo, igual que en la
 * maqueta: nunca dos botones habilitados a la vez.
 *
 * NO se portó la 4ta opción "Otro" (tamaño personalizado) de la maqueta:
 * `RepositorioInventario.crearHojas` está tipado a `TamanoHoja` (20|30|50),
 * no a un entero arbitrario. Ampliar el puerto para aceptarlo queda para
 * cuando se pida esa tarea — acá solo se ofrecen los 3 tamaños que el
 * puerto ya soporta.
 */
export default function HojasScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();

  const [cargandoInicial, setCargandoInicial] = useState(true);
  const [inventarioId, setInventarioId] = useState<number | null>(null);
  const [items, setItems] = useState<number | null>(null);
  const [tomadoEn, setTomadoEn] = useState<string | null>(null);
  const [hojas, setHojas] = useState<HojaConteo[]>([]);
  const [tamanoCreado, setTamanoCreado] = useState<TamanoHoja | null>(null);
  const [contadores, setContadores] = useState<Colaborador[]>([]);

  const [tamanoElegido, setTamanoElegido] = useState<TamanoHoja | null>(null);
  const [trayendoSnapshot, setTrayendoSnapshot] = useState(false);
  const [creandoHojas, setCreandoHojas] = useState(false);
  const [asignando, setAsignando] = useState(false);

  useEffect(() => {
    if (!sesion) return;
    let vigente = true;

    async function cargar(): Promise<void> {
      const [activo, colaboradores] = await Promise.all([
        repositorioInventario.activo(sesion!.sucursal.id),
        repositorioSesion.colaboradores(sesion!.sucursal.id),
      ]);
      if (!vigente) return;

      setContadores(colaboradores.filter((c) => c.rol === 'conteo'));

      if (activo) {
        setInventarioId(activo.inventarioId);
        setItems(activo.items);
        setTomadoEn(activo.tomadoEn);
        setTamanoCreado(activo.tamanoHoja);
        const todas = await repositorioHojas.todas(activo.inventarioId);
        if (vigente) setHojas(todas);
      }
      if (vigente) setCargandoInicial(false);
    }

    cargar();
    return () => {
      vigente = false;
    };
  }, [sesion]);

  const paso1Hecho = inventarioId !== null;
  const paso2Hecho = hojas.length > 0;
  const paso3Hecho = paso2Hecho && hojas.every((h) => h.asignados.length > 0);

  // Resultado ANTES de crear: el Coordinador tiene que ver cuántas hojas
  // va a generar antes de generarlas. partirEnHojas() es el mismo cálculo
  // que usa el puerto — nunca se duplica ni se hardcodea acá.
  const previa = useMemo(() => {
    if (!items || !tamanoElegido) return null;
    const tamanos = partirEnHojas(items, tamanoElegido);
    const ultima = tamanos[tamanos.length - 1] ?? 0;
    return { total: tamanos.length, parcial: ultima !== tamanoElegido ? ultima : 0 };
  }, [items, tamanoElegido]);

  const resultadoReparto = useMemo(() => {
    if (!paso3Hecho || contadores.length === 0) return null;
    const conteos = new Map<string, number>();
    for (const hoja of hojas) {
      const nombre = hoja.asignados[0];
      conteos.set(nombre, (conteos.get(nombre) ?? 0) + 1);
    }
    const valores = [...conteos.values()];
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    return min === max ? `${min} hojas por persona` : `${min}–${max} hojas por persona`;
  }, [paso3Hecho, contadores, hojas]);

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  async function traerSnapshot(): Promise<void> {
    setTrayendoSnapshot(true);
    try {
      const resultado = await repositorioInventario.traerSnapshot(sesion!.sucursal.id);
      setInventarioId(resultado.inventarioId);
      setItems(resultado.items);
      setTomadoEn(resultado.tomadoEn);
    } catch (error) {
      Alert.alert('No se pudo traer el catálogo', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setTrayendoSnapshot(false);
    }
  }

  async function crearHojasAhora(): Promise<void> {
    if (!inventarioId || !tamanoElegido) return;
    setCreandoHojas(true);
    try {
      const nuevas = await repositorioInventario.crearHojas(inventarioId, tamanoElegido);
      setHojas(nuevas);
      setTamanoCreado(tamanoElegido);
    } catch (error) {
      Alert.alert('No se pudieron crear las hojas', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setCreandoHojas(false);
    }
  }

  async function asignarAhora(): Promise<void> {
    if (!inventarioId) return;
    setAsignando(true);
    try {
      const actualizadas = await repositorioInventario.asignarHojas(
        inventarioId,
        contadores.map((c) => c.id),
      );
      setHojas(actualizadas);
    } catch (error) {
      Alert.alert('No se pudieron repartir las hojas', error instanceof Error ? error.message : 'Intentá de nuevo.');
    } finally {
      setAsignando(false);
    }
  }

  const cifras = items
    ? `${nf.format(hojas.length || (previa?.total ?? 0))} hojas · ${nf.format(items)} ítems`
    : undefined;

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <BarraApp rotulo="Gestión masiva" sede={sesion.sucursal.nombre} cifras={cifras} onSalir={salir} />

      {cargandoInicial ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargandoInicial} />
      ) : (
        <>
          <PasoTarjeta
            numero={1}
            icon={CloudDownload}
            titulo="Catálogo de Dynamics"
            estado={paso1Hecho ? 'hecho' : 'pendiente'}
            texto={
              paso1Hecho && items && tomadoEn
                ? `${nf.format(items)} ítems traídos de Dynamics · ${new Date(tomadoEn).toLocaleString('es-PE')}. Es una lectura del catálogo — no escribe ni ajusta nada en Dynamics.`
                : 'Trae el catálogo completo de la sucursal desde Dynamics: es la foto contra la que se compara todo el inventario. Es una lectura del catálogo — no escribe ni ajusta nada en Dynamics.'
            }
          />

          <PasoTarjeta
            numero={2}
            icon={LayoutGrid}
            titulo="Crear hojas de conteo"
            estado={!paso1Hecho ? 'bloqueado' : paso2Hecho ? 'hecho' : 'pendiente'}
            texto={
              !paso1Hecho
                ? 'Traé primero el catálogo de Dynamics para poder crear las hojas.'
                : paso2Hecho
                  ? `${nf.format(hojas.length)} hojas creadas de ${tamanoCreado} ítems (${nf.format(items ?? 0)} ítems en total)${
                      hojas[hojas.length - 1] && hojas[hojas.length - 1].tamano !== tamanoCreado
                        ? ` · la última con ${hojas[hojas.length - 1].tamano} ítems`
                        : ''
                    }.`
                  : 'Elegí cuántos ítems por hoja querés y mirá cuántas hojas salen antes de crearlas.'
            }
          >
            {paso1Hecho && !paso2Hecho ? (
              <>
                <SelectorTamano valor={tamanoElegido} onElegir={setTamanoElegido} disabled={creandoHojas} />
                {previa ? (
                  <Text style={styles.previaTexto}>
                    → {nf.format(previa.total)} hojas de {tamanoElegido} ítems
                    {previa.parcial > 0 ? ` · la última con ${previa.parcial} ítems` : ''}
                  </Text>
                ) : null}
              </>
            ) : null}
          </PasoTarjeta>

          <PasoTarjeta
            numero={3}
            icon={Users}
            titulo="Asignar hojas de conteo"
            estado={!paso2Hecho ? 'bloqueado' : paso3Hecho ? 'hecho' : 'pendiente'}
            texto={
              !paso2Hecho
                ? 'Creá primero las hojas de conteo para poder asignarlas.'
                : paso3Hecho && resultadoReparto
                  ? `Las ${nf.format(hojas.length)} hojas ya están repartidas entre los ${contadores.length} contadores presentes, en bloques contiguos (${resultadoReparto}).`
                  : `Repartí las ${nf.format(hojas.length)} hojas entre los ${contadores.length} contadores presentes, en bloques contiguos. Contar es caminar la góndola, no saltar de punta a punta.`
            }
          />

          <Button
            label={
              !paso1Hecho
                ? 'Traer catálogo de Dynamics'
                : !paso2Hecho
                  ? tamanoElegido
                    ? `Crear ${previa ? nf.format(previa.total) : ''} hojas de ${tamanoElegido} ítems`
                    : 'Elegí el tamaño de hoja'
                  : !paso3Hecho
                    ? 'Repartir automáticamente'
                    : 'Hojas repartidas'
            }
            icon={!paso1Hecho ? CloudDownload : !paso2Hecho ? LayoutGrid : !paso3Hecho ? Users : Check}
            size="lg"
            loading={trayendoSnapshot || creandoHojas || asignando}
            disabled={(paso1Hecho && !paso2Hecho && !tamanoElegido) || paso3Hecho}
            onPress={!paso1Hecho ? traerSnapshot : !paso2Hecho ? crearHojasAhora : !paso3Hecho ? asignarAhora : undefined}
          />
        </>
      )}
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md + 3 },
  cargandoInicial: { marginTop: spacing.xxxl },

  tarjeta: {
    gap: spacing.md,
    padding: 15,
    backgroundColor: colors.campo,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: 13,
  },
  tarjetaBloqueada: { opacity: 0.55 },
  tarjetaCabecera: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tarjetaTitulo: { flex: 1, fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
  tarjetaTexto: { fontSize: 12.5, lineHeight: 18, color: colors.gris, fontFamily: fonts.regular },

  pasoMarca: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.esperaSuave,
  },
  pasoMarcaHecho: { backgroundColor: colors.ok },
  pasoMarcaTexto: { fontSize: 12, color: colors.espera, fontFamily: fonts.bold },

  segmentado: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderColor: colors.rojo,
    borderRadius: radius.md,
    backgroundColor: colors.campo,
    overflow: 'hidden',
  },
  segmentadoDeshabilitado: { opacity: 0.55 },
  segmento: { flex: 1, paddingVertical: 11, alignItems: 'center' },
  segmentoConBorde: { borderRightWidth: 1.5, borderRightColor: colors.rojo },
  segmentoActivo: { backgroundColor: colors.rojo },
  segmentoTexto: { fontSize: fontSize.sm - 0.5, color: colors.tinta, fontFamily: fonts.bold },
  segmentoTextoActivo: { color: colors.blanco },
  previaTexto: { fontSize: 12.5, fontWeight: '600', color: colors.proceso, fontFamily: fonts.semibold },
});
