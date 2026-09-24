import { router } from 'expo-router';
import { Check, CircleCheckBig, Info, Lock, PencilLine, RefreshCw, Store, TriangleAlert, X } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { useRefrescoAlEnfocar } from '../../components/hooks/useRefrescoAlEnfocar';
import { ChipsFiltro, ModalConteo, SelectorSucursal, formatoMiles } from '../../components/ui';
import { BotonWeb, ChipIcono, EncabezadoPagina, TarjetaWeb } from '../../components/web';
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
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';

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
 * ---------------------------------------------------------------------------
 * CORREGIR LO CONTADO, EN EL NAVEGADOR
 * ---------------------------------------------------------------------------
 * Clon de `corregir.tsx` con el diseño de la web. El del teléfono NO se toca.
 * Metro elige este archivo cuando el bundle es de web.
 *
 * LA FUNCIONALIDAD ES LA MISMA, y en esta pantalla eso incluye lo que NO se
 * clonó: el modal de edición sigue siendo `ModalConteo`, el mismo componente
 * que usa el Coordinador. Está dicho en la cabecera de `corregir.tsx` que eso
 * es lo que tiene que ser idéntico entre los dos roles -- empaques, sueltas,
 * motivo obligatorio y el stock como referencia inerte. Clonarlo habría
 * abierto la puerta a que las dos correcciones dejaran de escribir lo mismo.
 *
 * Y se puede reusar con seguridad: `ModalConteo` no toca `Alert` ni
 * `BackHandler`, que son las dos APIs que no funcionan en web.
 *
 * ---------------------------------------------------------------------------
 * LA LISTA ES UNA TABLA
 * ---------------------------------------------------------------------------
 * Mismo criterio que `ajuste.web.tsx` y `matriz.web.tsx`: en el teléfono cada
 * ítem es una tarjeta porque una columna de 400px no aguanta lo contado, el
 * stock y la diferencia; en una PC lo que se hace es barrer la columna de
 * diferencias buscando dónde se rompe.
 *
 * ---------------------------------------------------------------------------
 * EL ERROR DE GUARDADO NO PUEDE IR EN UN `Alert`
 * ---------------------------------------------------------------------------
 * En react-native-web `Alert.alert` es un método vacío. El teléfono avisa ahí
 * que no se pudo corregir -- y el mensaje del servidor es lo accionable (dice
 * qué regla se topó). Acá va a la misma banda donde ya viven los otros dos
 * avisos de la pantalla.
 */

/** Abajo de esto las columnas se apilan: es media pantalla en una PC, no un teléfono. */
const ANCHO_ANGOSTO = 1180;

/** Alto de fila FIJO: con eso `getItemLayout` no mide miles de filas y el scroll no salta. */
const ALTO_FILA = 44;

const ANCHO_DESCRIPCION = 320;

/** Sin dato es "—", nunca un 0: nadie lo contó es distinto de "contó cero". */
const SIN_DATO = '—';

interface Celda {
  texto: string;
  color?: string;
  fuerte?: boolean;
}

interface Columna {
  clave: string;
  titulo: string;
  ancho: number;
  numerica: boolean;
  celda: (fila: FilaCorregible) => Celda;
  nodo?: (fila: FilaCorregible) => ReactNode;
}

/**
 * LA DIFERENCIA, con las MISMAS tres palabras que el badge del teléfono
 * ("Sin comparar" / "Cuadra" / "+3") y la paleta de ESTADO: verde cuando
 * cuadra, ámbar cuando no, gris cuando no hay contra qué comparar. El rojo de
 * marca no entra: acá no hay ninguna acción destructiva.
 */
function PildoraDiferencia({ diferencia }: { diferencia: number | null }): JSX.Element {
  const tinta = diferencia === null ? colors.gris : diferencia === 0 ? colors.ok : colors.proceso;
  const fondo = diferencia === null ? colors.esperaSuave : diferencia === 0 ? colors.okSuave : colors.procesoSuave;
  const etiqueta =
    diferencia === null ? 'Sin comparar' : diferencia === 0 ? 'Cuadra' : `${diferencia > 0 ? '+' : ''}${formatoMiles(diferencia)}`;
  return (
    <View style={[styles.pildora, { backgroundColor: fondo }]}>
      <View style={[styles.pildoraPunto, { backgroundColor: tinta }]} />
      <Text style={[styles.pildoraTexto, { color: tinta }]} numberOfLines={1}>
        {etiqueta}
      </Text>
    </View>
  );
}

interface FilaProps {
  fila: FilaCorregible;
  columnas: readonly Columna[];
  onPress: () => void;
}

/** `memo` por lo mismo que la matriz: cientos de filas montadas y un padre que cambia al filtrar. */
const Fila = memo(function FilaComponent({ fila, columnas, onPress }: FilaProps): JSX.Element {
  const dif = fila.item ? diferenciaUnidades(fila.item) : null;
  // El tinte es SOLO para lo que tiene diferencia: si se pintan todas, el
  // color deja de señalar nada.
  const tinte = dif === null || dif === 0 ? null : styles.filaSinCuadrar;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Corregir lo contado de ${fila.producto.descripcion}`}
      style={({ pressed }) => [styles.fila, tinte, pressed && styles.filaPresionada]}
    >
      {columnas.map((columna) => {
        if (columna.nodo) {
          return (
            <View key={columna.clave} style={[styles.celdaNodo, { width: columna.ancho }]}>
              {columna.nodo(fila)}
            </View>
          );
        }
        const celda = columna.celda(fila);
        return (
          <Text
            key={columna.clave}
            style={[
              styles.celda,
              { width: columna.ancho },
              columna.numerica ? styles.celdaNumerica : null,
              celda.fuerte ? styles.celdaFuerte : null,
              celda.color === undefined ? null : { color: celda.color },
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {celda.texto}
          </Text>
        );
      })}
    </Pressable>
  );
});

/** Lo que pasó con la última acción. `error` existe porque en web no hay `Alert`. */
interface Aviso {
  texto: string;
  tono: 'ok' | 'atencion' | 'error';
}

export default function AuditorCorregirWebScreen(): JSX.Element {
  const { sesion } = useSesion();
  const { width, height } = useWindowDimensions();
  const angosto = width < ANCHO_ANGOSTO;

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fase, setFase] = useState<ReturnType<typeof faseDeCierre> | null>(null);
  /**
   * LA VIGENTE Y LA QUE SE ESTÁ MIRANDO SON DOS COSAS DISTINTAS. `rondaElegida`
   * en null = "la que esté vigente", que es el default y se resuelve al
   * cargar: así, al abrirse otra ronda, la pantalla sigue los pasos del
   * inventario sola.
   */
  const [rondaActiva, setRondaActiva] = useState<number | null>(null);
  const [rondaElegida, setRondaElegida] = useState<number | null>(null);
  /** Lo que pasó con la última corrección. Sobrevive a la recarga a propósito. */
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [filas, setFilas] = useState<FilaCorregible[]>([]);
  const [filtro, setFiltro] = useState<Filtro>('sin-cuadrar');
  const [enEdicion, setEnEdicion] = useState<FilaCorregible | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [anchoDisponible, setAnchoDisponible] = useState(0);

  const { elegida, elegir } = useSucursalAuditada();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  useEffect(() => {
    repositorioSesion.sucursales().then(setSucursales).catch(() => undefined);
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
      setFase(activo ? faseDeCierre(activo.estado, activo.rondaActiva, activo.totalHojas, activo.ultimaRondaCerrada) : null);
      setRondaActiva(activo?.rondaActiva ?? null);
      if (!activo || activo.rondaActiva === null) {
        setFilas([]);
        setRondaElegida(null);
        return;
      }

      /**
       * LA RONDA QUE SE ESTABA MIRANDO PUEDE HABER DESAPARECIDO: se corrige el
       * último ítem que quedaba en ella, la ronda se queda sin hojas y el
       * servidor la borra. Quedarse parado ahí sería mostrar una ronda que ya
       * no existe; irse en silencio sería mover la pantalla debajo de quien la
       * está usando. Se hacen las dos cosas: se vuelve a la vigente Y se dice
       * por qué.
       */
      const pedida = rondaElegida !== null && rondaElegida <= activo.rondaActiva ? rondaElegida : activo.rondaActiva;
      if (rondaElegida !== null && rondaElegida !== pedida) {
        setAviso({ texto: textoRondaQueYaNoExiste(rondaElegida, pedida), tono: 'atencion' });
      }
      setRondaElegida(pedida);

      // Las DOS lecturas, en paralelo: no dependen entre sí.
      //  - las hojas dan el `hojaId` de cada producto, que es lo que pide el
      //    endpoint de corrección, y el conteo que hay cargado hoy.
      //  - la matriz da el stock del ERP y con él el veredicto.
      // La matriz por sí sola NO alcanza: no trae `hojaId`.
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
   * Cambió la tienda O LA RONDA: recargar YA y limpiar lo anterior ANTES.
   * Limpiar no es cosmético al cambiar de ronda: los números de hoja se
   * REPITEN en cada pasada, así que dejar las filas viejas un instante
   * mostraría "Hoja #001" de la ronda anterior con los ítems de la nueva.
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

  const columnas = useMemo<Columna[]>(() => {
    const base: Columna[] = [
      { clave: 'codigo', titulo: 'Código', ancho: 92, numerica: false, celda: (f) => ({ texto: f.producto.codigo }) },
      {
        clave: 'descripcion',
        titulo: 'Descripción',
        ancho: ANCHO_DESCRIPCION,
        numerica: false,
        celda: (f) => ({ texto: f.producto.descripcion }),
      },
      { clave: 'hoja', titulo: 'Hoja', ancho: 80, numerica: false, celda: (f) => ({ texto: `#${f.numeroHoja}` }) },
      {
        clave: 'contado',
        titulo: 'Contado',
        ancho: 96,
        numerica: true,
        celda: (f) =>
          f.contado === null ? { texto: SIN_DATO, color: colors.grisClaro } : { texto: formatoMiles(f.contado), fuerte: true },
      },
      {
        clave: 'stock',
        titulo: 'Stock',
        ancho: 96,
        numerica: true,
        // El stock, más apagado que lo contado: es referencia, no lo que se va
        // a cambiar. Corregir lo contado NO es corregir el stock.
        celda: (f) =>
          f.item === null || f.item.stockErp === null
            ? { texto: SIN_DATO, color: colors.grisClaro }
            : { texto: formatoMiles(f.item.stockErp), color: colors.gris },
      },
      {
        clave: 'diferencia',
        titulo: 'Diferencia',
        ancho: 148,
        numerica: false,
        celda: () => ({ texto: '' }),
        nodo: (f) => <PildoraDiferencia diferencia={f.item ? diferenciaUnidades(f.item) : null} />,
      },
    ];
    // Lo que sobra del ancho se lo lleva la descripción: el resto son cifras
    // cortas y estirarlas solo aleja el número de su encabezado.
    const sobra = Math.max(0, anchoDisponible - base.reduce((suma, c) => suma + c.ancho, 0));
    if (sobra === 0) return base;
    return base.map((c) => (c.clave === 'descripcion' ? { ...c, ancho: c.ancho + sobra } : c));
  }, [anchoDisponible]);

  const anchoTabla = useMemo(() => columnas.reduce((suma, c) => suma + c.ancho, 0), [columnas]);

  /** La tabla scrollea DENTRO de su marco y no estira la página: ver ajuste.web.tsx. */
  const altoTabla = Math.max(280, Math.round(height - 470));

  if (!sesion) return <View style={styles.centro} />;

  const sePuedeCorregir = fase !== null && puedeCorregirLoContado(fase);
  const bloqueo = fase === null ? null : motivoSinCorregir(fase, 'auditor');

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
       * no sabe si lo consiguió.
       *
       * Una corrección que no saca nada de la ronda es el caso normal y no
       * merece un cartel: por eso el aviso viejo no se borra de golpe, se
       * reemplaza solo cuando hay algo nuevo que decir.
       */
      if (salioDeLaRonda !== null) {
        setAviso({ texto: textoItemSalioDeRonda(salioDeLaRonda), tono: 'ok' });
      }
      // Se vuelve a pedir todo: la corrección puede cambiar el veredicto del
      // ítem (de "falta" a "cuadrado") y con él el filtro y los contadores.
      await cargar();
    } catch (e) {
      // El mensaje del servidor tal cual: dice qué regla se topó (el ajuste ya
      // empezó, no es tu sucursal), y eso es lo accionable.
      setAviso({
        tono: 'error',
        texto: `No se pudo corregir el conteo. ${e instanceof Error ? e.message : 'Revisa la conexión con la tienda y vuelve a intentarlo.'}`,
      });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <ScrollView style={styles.pagina} contentContainerStyle={styles.contenido} showsVerticalScrollIndicator={false}>
        <EncabezadoPagina
          migas={['Auditoría', 'Corregir lo contado']}
          titulo="Corregir lo contado"
          sub="Arregla lo que se cargó mal en una ronda. Cada cambio pide un motivo y queda registrado con tu nombre."
          onInicio={() => router.push('/auditor')}
          acciones={
            // EN EL NAVEGADOR NO HAY "TIRAR PARA REFRESCAR": sin un control a
            // mano la única salida es F5, que recarga la app entera.
            <BotonWeb
              etiqueta={refrescando ? 'Actualizando…' : 'Actualizar'}
              icono={RefreshCw}
              onPress={refrescar}
              deshabilitado={refrescando}
            />
          }
        />

        <View style={[styles.banda, angosto && styles.bandaApilada]}>
          <View style={styles.bandaTienda}>
            <ChipIcono icono={Store} />
            <View style={styles.bandaTextos}>
              <Text style={styles.bandaEtiqueta}>Sucursal a auditar</Text>
              <SelectorSucursal label="" sucursales={sucursales} sucursalId={sucursalId} onElegir={elegir} />
              {sePuedeCorregir && !cargando ? (
                <Text style={styles.bandaSub}>
                  {formatoMiles(sinCuadrar.length)}{' '}
                  {pluralizar(sinCuadrar.length, 'ítem sin cuadrar', 'ítems sin cuadrar')} de {formatoMiles(filas.length)}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Gris mientras se puede corregir: es el estado NORMAL de la
              pantalla y no espera ninguna decisión. Ámbar solo cuando la vía
              está cerrada, que sí es algo que hay que resolver en otro lado. */}
          <View style={[styles.cartel, sePuedeCorregir ? styles.cartelNeutro : styles.cartelAtencion]}>
            <PencilLine size={22} color={sePuedeCorregir ? colors.gris : colors.proceso} />
            <View style={styles.cartelTextos}>
              <Text style={[styles.cartelTitulo, { color: sePuedeCorregir ? colors.gris : colors.proceso }]}>
                {rondaElegida === null || !sePuedeCorregir ? 'Corrección cerrada' : `${ORDINAL[rondaElegida]} conteo`}
              </Text>
              <Text style={styles.cartelDetalle}>
                {sePuedeCorregir
                  ? 'El coordinador todavía puede corregir en paralelo: mismo endpoint, mismo registro.'
                  : 'Desde acá ya no se corrige lo contado.'}
              </Text>
            </View>
          </View>
        </View>

        {cargando ? (
          <ActivityIndicator color={colors.rojo} style={styles.cargando} />
        ) : error !== null ? (
          <TarjetaWeb titulo="No se pudo cargar lo contado" icono={TriangleAlert} tono="neutro">
            <Text style={styles.parrafo}>{error}</Text>
            <BotonWeb etiqueta="Volver a intentar" variante="principal" onPress={refrescar} />
          </TarjetaWeb>
        ) : !sePuedeCorregir ? (
          // NO dice "vuelve a intentar": esto no cambia solo. Dice qué pasó y
          // por dónde sigue, que en el caso del ajuste es otra pantalla suya.
          <TarjetaWeb
            titulo={fase === 'ajuste' ? 'Ya empezó el ajuste final' : 'Aquí no hay nada que corregir'}
            icono={Lock}
            tono="neutro"
          >
            <Text style={styles.parrafo}>
              {bloqueo ??
                'Todavía no hay un inventario abierto en esta tienda, o no tiene una ronda con hojas para corregir.'}
            </Text>
            {fase === 'ajuste' ? (
              <BotonWeb etiqueta="Ir al ajuste final" variante="principal" onPress={() => router.push('/auditor/ajuste')} />
            ) : null}
          </TarjetaWeb>
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
                porque la lista se recarga y se reordena debajo: si estuviera al
                pie, el aviso quedaría fuera de pantalla justo después de
                guardar. */}
            {aviso !== null ? (
              <View
                style={[
                  styles.resultado,
                  aviso.tono === 'ok'
                    ? styles.resultadoOk
                    : aviso.tono === 'error'
                      ? styles.resultadoError
                      : styles.resultadoAtencion,
                ]}
              >
                {aviso.tono === 'ok' ? (
                  <CircleCheckBig size={16} color={colors.ok} />
                ) : aviso.tono === 'error' ? (
                  <TriangleAlert size={16} color={colors.falta} />
                ) : (
                  <Info size={16} color={colors.proceso} />
                )}
                <Text style={styles.resultadoTexto}>{aviso.texto}</Text>
                <Pressable onPress={() => setAviso(null)} accessibilityLabel="Cerrar el aviso" style={styles.resultadoCerrar}>
                  <X size={15} color={colors.gris} />
                </Pressable>
              </View>
            ) : null}

            <TarjetaWeb
              titulo="Ítems de la ronda"
              sub="Cada fila abre la corrección de lo que se contó."
              icono={PencilLine}
            >
              {/**
               * EL SELECTOR DE RONDA. Por defecto la vigente, pero deja ir a
               * las anteriores -- que es donde vive el caso que el cliente
               * describió para pedir la corrección: la hoja finalizada de una
               * ronda ya cerrada, con el siguiente conteo abierto.
               *
               * Con una sola ronda no se muestra nada: un selector de una
               * opción es un control que no decide nada.
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
                <View style={styles.vacio}>
                  <Check size={22} color={colors.ok} />
                  <Text style={styles.vacioTitulo}>
                    {filtro === 'sin-cuadrar' ? 'No queda ningún ítem sin cuadrar' : 'Esta ronda no tiene ítems'}
                  </Text>
                  <Text style={styles.parrafo}>
                    {filtro === 'sin-cuadrar'
                      ? 'Todo lo que tiene stock del ERP y conteo coincide. Puedes mirar la lista completa si buscas otra cosa.'
                      : 'Las hojas de esta ronda todavía no tienen catálogo cargado.'}
                  </Text>
                </View>
              ) : (
                <View
                  style={[styles.marco, { height: altoTabla }]}
                  onLayout={(e) => {
                    const ancho = Math.round(e.nativeEvent.layout.width);
                    setAnchoDisponible((previo) => (previo === ancho ? previo : ancho));
                  }}
                >
                  {/* El encabezado scrollea con las columnas pero no con las
                      filas: por eso vive dentro del scroll horizontal y fuera
                      de la lista vertical. */}
                  <ScrollView horizontal style={styles.scrollHorizontal} contentContainerStyle={styles.scrollHorizontalContenido}>
                    <View style={{ width: anchoTabla }}>
                      <View style={styles.encabezado}>
                        {columnas.map((columna) => (
                          <Text
                            key={columna.clave}
                            style={[
                              styles.encabezadoCelda,
                              { width: columna.ancho },
                              columna.numerica ? styles.celdaNumerica : null,
                            ]}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            {columna.titulo}
                          </Text>
                        ))}
                      </View>

                      {/* FlatList y no un `.map`: una ronda completa son miles
                          de filas y montarlas de una cuelga el navegador. */}
                      <FlatList
                        style={styles.lista}
                        data={visibles}
                        extraData={columnas}
                        keyExtractor={(fila) => `${fila.hojaId}-${fila.producto.id}`}
                        renderItem={({ item: fila }) => (
                          <Fila fila={fila} columnas={columnas} onPress={() => setEnEdicion(fila)} />
                        )}
                        getItemLayout={(_datos, indice) => ({ length: ALTO_FILA, offset: ALTO_FILA * indice, index: indice })}
                        initialNumToRender={30}
                        maxToRenderPerBatch={30}
                        windowSize={11}
                      />
                    </View>
                  </ScrollView>
                </View>
              )}

              <Text style={styles.pie}>
                Mostrando {formatoMiles(visibles.length)} de <Text style={styles.pieFuerte}>{formatoMiles(filas.length)} ítems</Text>
              </Text>
            </TarjetaWeb>
          </>
        )}
      </ScrollView>

      {/* Hermano del scroll, nunca adentro: ahí el overlay queda recortado y se
          desplaza con el contenido. Es el MISMO modal que usa el Coordinador. */}
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

const styles = StyleSheet.create({
  pagina: { flex: 1 },
  contenido: { padding: spacing.xxl, gap: spacing.lg },
  centro: { flex: 1 },
  cargando: { marginTop: spacing.xxl },

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
  bandaSub: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },

  cartel: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.lg, padding: spacing.md, minWidth: 340 },
  cartelAtencion: { backgroundColor: colors.procesoSuave },
  cartelNeutro: { backgroundColor: colors.esperaSuave },
  cartelTextos: { flex: 1, gap: 1 },
  cartelTitulo: { fontSize: fontSize.lg, fontFamily: fonts.bold },
  cartelDetalle: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },

  aviso: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.esperaSuave,
  },
  avisoTexto: { flex: 1, fontSize: fontSize.sm, lineHeight: 19, color: colors.gris, fontFamily: fonts.regular },

  resultado: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  resultadoOk: { backgroundColor: colors.okSuave, borderColor: colors.ok },
  resultadoAtencion: { backgroundColor: colors.procesoSuave, borderColor: colors.proceso },
  resultadoError: { backgroundColor: colors.faltaSuave, borderColor: colors.falta },
  resultadoTexto: { flex: 1, fontSize: fontSize.sm, lineHeight: 19, color: colors.tinta, fontFamily: fonts.regular },
  resultadoCerrar: { padding: 2 },

  parrafo: { fontSize: fontSize.sm, lineHeight: 20, color: colors.gris, fontFamily: fonts.regular },

  rondas: { gap: 6, marginBottom: spacing.xs },
  rondasEtiqueta: {
    fontSize: fontSize.xs,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.grisClaro,
    fontFamily: fonts.bold,
  },

  vacio: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  vacioTitulo: { fontSize: fontSize.lg, color: colors.tinta, fontFamily: fonts.bold, textAlign: 'center' },

  marco: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: radius.lg,
    backgroundColor: colors.blanco,
    overflow: 'hidden',
  },
  scrollHorizontal: { flex: 1 },
  scrollHorizontalContenido: { flexGrow: 1 },
  lista: { flex: 1 },

  encabezado: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ALTO_FILA,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.borde,
    backgroundColor: colors.esperaSuave,
  },
  encabezadoCelda: {
    paddingHorizontal: 10,
    fontSize: fontSize.xs,
    color: colors.gris,
    fontFamily: fonts.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ALTO_FILA,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.borde,
  },
  /** Ámbar, no rojo: un ítem sin cuadrar espera una decisión, no es un peligro. */
  filaSinCuadrar: { backgroundColor: colors.procesoSuave },
  filaPresionada: { backgroundColor: colors.rojoSuave },

  celda: { paddingHorizontal: 10, fontSize: fontSize.sm, color: colors.tinta, fontFamily: fonts.regular },
  celdaNodo: { paddingHorizontal: 10, justifyContent: 'center' },
  celdaNumerica: { textAlign: 'right', fontVariant: ['tabular-nums'], fontFamily: fonts.medium },
  celdaFuerte: { fontFamily: fonts.bold },

  pildora: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: radius.full,
  },
  pildoraPunto: { width: 6, height: 6, borderRadius: radius.full },
  pildoraTexto: { fontSize: fontSize.xs, fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] },

  pie: { marginTop: spacing.sm, fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },
  pieFuerte: { color: colors.tinta, fontFamily: fonts.bold },
});
