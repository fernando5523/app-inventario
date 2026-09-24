import { router } from 'expo-router';
import {
  AlertTriangle,
  ArrowRightCircle,
  Check,
  CheckCircle2,
  FileText,
  Layers,
  Lock,
  PlusCircle,
  Scale,
  Store,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { useRefrescoAlEnfocar } from '../hooks/useRefrescoAlEnfocar';
import { cargarSeguro } from '../../lib/adaptadores/_http';
import { repositorioAjuste, repositorioHistorial, repositorioInventario, repositorioSesion } from '../../lib/contenedor';
import { elAuditorPuedeDecidir, faseDeCierre, type FaseDeCierre } from '../../lib/dominio/ajuste-final';
import { comparativoDeRonda } from '../../lib/dominio/comparativo-ronda';
import { inventarioDelCiclo, puedeConsultarHistorial } from '../../lib/dominio/inventario-del-ciclo';
import { sucursalEnFoco } from '../../lib/dominio/sucursal-en-foco';
import {
  estadoDePaso,
  etiquetaARecontar,
  ORDINAL,
  RONDA_MAX,
  textoBotonCierre,
  textoCierreExplicacion,
  textoRondaYaCerrada,
  type EstadoPaso,
} from '../../lib/dominio/texto-cierre-ronda';
import { partirEnHojas } from '../../lib/dominio/lote';
import { pluralizar } from '../../lib/dominio/plural';
import { type Sucursal, type TamanoHoja } from '../../lib/dominio/tipos';
import type { ResumenRonda } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { useSucursalAuditada } from '../../lib/sucursal-auditada-contexto';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';
import { Badge, BandaSync, SelectorSucursal, formatoMiles, formatoPct, type BadgeVariant } from '../ui';
import { BotonWeb, ChipIcono, EncabezadoPagina, FilaDato, TarjetaWeb, type TonoChip } from '../web';
import type { CicloScreenProps } from './CicloScreen';

/**
 * ---------------------------------------------------------------------------
 * EL CICLO DE CONTEOS EN WEB
 * ---------------------------------------------------------------------------
 * Clon de `CicloScreen.tsx` con el diseño de la web. El del teléfono no se
 * toca: *"no utilices la misma pantalla del móvil, clónalo y cámbialo, en todo
 * caso son plataformas diferentes"*.
 *
 * LA USAN LOS DOS ROLES, igual que la del teléfono: `app/coordinador/ciclo.tsx`
 * y `app/auditor/ciclo.tsx`. La diferencia sigue resolviéndose con la prop
 * `rol` -- el Coordinador cierra rondas y elige el tamaño de hoja; el Auditor
 * decide qué sigue y tiene el acceso a la auditoría. Nada de eso cambió.
 *
 * LOS PASOS VAN EN FILA. En el teléfono son cuatro tarjetas apiladas y hay que
 * scrollear el embudo entero para ver dónde quedó el ciclo; en una PC entran
 * los cuatro a la vista, que es justo lo que hace falta para compararlos.
 *
 * ---------------------------------------------------------------------------
 * `Alert.alert` NO EXISTE EN EL NAVEGADOR -- Y ACÁ SE NOTABA
 * ---------------------------------------------------------------------------
 * En `react-native-web` (0.21.2) `Alert.alert` es literalmente `static alert()
 * {}`: un método vacío. El archivo del teléfono lo usa en cinco lugares, y uno
 * de ellos NO es un aviso sino una CONFIRMACIÓN -- "Empezar el ajuste final",
 * con sus dos botones. En web eso quedaba así:
 *
 *   - "Empezar el ajuste final" abría un diálogo que no existe: el botón no
 *     hacía absolutamente nada, y el ajuste no se podía iniciar desde la web.
 *   - Cerrar una ronda SÍ funcionaba, pero en silencio: ni el "2do conteo
 *     abierto" ni el "No se pudo cerrar la ronda" con el motivo del servidor
 *     llegaban a la pantalla.
 *
 * Por eso acá la confirmación es un `Modal` y los avisos son una banda en la
 * página. Los TEXTOS son los mismos, palabra por palabra, incluidos los dos
 * botones de la confirmación ("Todavía no" / "Empezar el ajuste"): no es
 * funcionalidad nueva, es la misma funcionalidad en una plataforma que no
 * tiene diálogos del sistema.
 */
const ANCHO_ANGOSTO = 1180;

// formatoMiles/formatoPct, no Intl.NumberFormat('es-PE'): no está garantizado
// que Hermes traiga los datos ICU de es-PE — ver components/ui/formato.ts.
const nf = { format: formatoMiles };

interface CalculoHojas {
  total: number;
  completas: number;
  parcial: number;
}

function calcularHojas(totalItems: number, tamano: TamanoHoja): CalculoHojas {
  if (totalItems <= 0) return { total: 0, completas: 0, parcial: 0 };
  const tamanos = partirEnHojas(totalItems, tamano);
  const ultima = tamanos[tamanos.length - 1] ?? 0;
  const esParcial = ultima !== tamano;
  return { total: tamanos.length, completas: esParcial ? tamanos.length - 1 : tamanos.length, parcial: esParcial ? ultima : 0 };
}

function textoCalculo(c: CalculoHojas, tamano: number): string {
  if (c.total === 0) return 'Sin ítems para calcular.';
  const sufHojas = c.total === 1 ? '' : 's';
  if (c.parcial === 0) return `${nf.format(c.total)} hoja${sufHojas} de ${tamano} ítems (exacto).`;
  const sufCompletas = c.completas === 1 ? '' : 's';
  return `${nf.format(c.total)} hoja${sufHojas} de ${tamano} ítems: ${nf.format(c.completas)} completa${sufCompletas} + 1 parcial de ${c.parcial} — la cantidad de hojas se calcula siempre, nunca es fija.`;
}

/**
 * Traduce el estado de un PASO al badge que se muestra -- NUNCA un literal.
 * Mismas etiquetas y mismas variantes que el teléfono.
 */
function badgeDePaso(estado: EstadoPaso): { label: string; variant: BadgeVariant } {
  switch (estado) {
    case 'cerrado':
      return { label: 'Cerrado', variant: 'ok' };
    case 'en-curso':
      return { label: 'En curso', variant: 'proceso' };
    case 'pendiente':
      return { label: 'Pendiente', variant: 'espera' };
    case 'sin-datos':
      return { label: 'Sin datos todavía', variant: 'outline' };
  }
}

/**
 * EL COLOR DEL CHIP DICE EN QUÉ ESTÁ EL PASO: verde lo cerrado, ámbar lo que
 * corre ahora, gris lo que todavía no dice nada. Nunca rojo -- el rojo de esta
 * pantalla es el botón de cerrar la ronda.
 */
const TONO_PASO: Record<EstadoPaso, TonoChip> = {
  cerrado: 'ok',
  'en-curso': 'atencion',
  pendiente: 'neutro',
  'sin-datos': 'neutro',
};

/**
 * El comparativo contra Dynamics de una ronda, listo para mostrar. `null`
 * cuando esa ronda todavía no existe (el endpoint responde 404): "todavía no
 * empezó" es la verdad, distinto de "no se puede calcular".
 */
const comparativoVisible = (r: ResumenRonda | null) =>
  comparativoDeRonda(r, (n: number) => nf.format(n), formatoPct);

/**
 * Por qué el servidor dijo que no. Paleta `proceso` (el estado de ATENCIÓN),
 * nunca el rojo de marca -- el rojo acá es el botón que se acaba de tocar.
 */
function AvisoMotivo({ mensaje }: { mensaje: string }): JSX.Element {
  return (
    <View style={styles.avisoMotivo}>
      <AlertTriangle size={15} color={colors.proceso} />
      <Text style={styles.avisoMotivoTexto}>{mensaje}</Text>
    </View>
  );
}

interface PasoCicloProps {
  titulo: string;
  descripcion: string;
  estado: EstadoPaso;
  calculo?: string;
  /** Barra + cifra de avance REAL (ítems contados / total). Sin esto, no se dibuja embudo. */
  avance?: { pct: number; texto: string };
  /** Nota honesta cuando falta un dato -- nunca un número inventado en su lugar. */
  notaSinDato?: string;
}

/** Un paso del embudo, como tarjeta del diseño. */
function PasoCiclo({ titulo, descripcion, estado, calculo, avance, notaSinDato }: PasoCicloProps): JSX.Element {
  const badge = badgeDePaso(estado);
  return (
    <TarjetaWeb titulo={titulo} sub={descripcion} icono={Layers} tono={TONO_PASO[estado]} style={styles.paso}>
      <Badge label={badge.label} variant={badge.variant} />
      {calculo ? <Text style={styles.textoTarjeta}>{calculo}</Text> : null}
      {avance ? (
        <>
          <View style={styles.embudoBarra}>
            <View style={[styles.embudoOk, { width: `${Math.min(100, Math.max(0, avance.pct))}%` }]} />
          </View>
          <View style={styles.embudoFila}>
            <Check size={14} color={colors.ok} />
            <Text style={[styles.embudoTexto, { color: colors.ok }]}>{avance.texto}</Text>
          </View>
        </>
      ) : null}
      {notaSinDato ? <Text style={styles.notaSinDato}>{notaSinDato}</Text> : null}
    </TarjetaWeb>
  );
}

/**
 * LO QUE EN EL TELÉFONO ES UN `Alert`. Título, mensaje y una X para
 * descartarlo; el color sale de si salió bien o no.
 */
interface Aviso {
  tono: 'ok' | 'atencion';
  titulo: string;
  mensaje: string;
}

function BandaAviso({ aviso, onCerrar }: { aviso: Aviso; onCerrar: () => void }): JSX.Element {
  const tinta = aviso.tono === 'ok' ? colors.ok : colors.proceso;
  const fondo = aviso.tono === 'ok' ? colors.okSuave : colors.procesoSuave;
  return (
    <View style={[styles.bandaAviso, { backgroundColor: fondo }]}>
      {aviso.tono === 'ok' ? <CheckCircle2 size={20} color={tinta} /> : <AlertTriangle size={20} color={tinta} />}
      <View style={styles.bandaAvisoTextos}>
        <Text style={[styles.bandaAvisoTitulo, { color: tinta }]}>{aviso.titulo}</Text>
        <Text style={styles.bandaAvisoMensaje}>{aviso.mensaje}</Text>
      </View>
      <Pressable onPress={onCerrar} accessibilityRole="button" accessibilityLabel="Cerrar el aviso" style={styles.bandaAvisoCerrar}>
        <X size={18} color={colors.gris} />
      </Pressable>
    </View>
  );
}

export function CicloScreen({ rol }: CicloScreenProps): JSX.Element {
  const { sesion } = useSesion();
  const { width } = useWindowDimensions();
  const angosto = width < ANCHO_ANGOSTO;

  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [intentoNumero, setIntentoNumero] = useState(0);
  const [items, setItems] = useState<number | null>(null);
  const [tamanoHoja, setTamanoHoja] = useState<TamanoHoja | null>(null);
  const [inventarioId, setInventarioId] = useState<number | null>(null);

  const [cerrandoRonda, setCerrandoRonda] = useState(false);
  const [rondaActiva, setRondaActiva] = useState<number | null>(null);
  const [fase, setFase] = useState<FaseDeCierre | null>(null);
  const [accionAuditor, setAccionAuditor] = useState<'ronda' | 'ajuste' | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState<{ cual: 'ronda' | 'ajuste'; mensaje: string } | null>(null);

  /** El reemplazo de `Alert.alert` en web. Ver la cabecera del archivo. */
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [confirmacionVisible, setConfirmacionVisible] = useState(false);
  /**
   * El aviso nace arriba de todo, y el botón que lo produjo puede estar al pie
   * de la página: sin esto, cerrar una ronda deja un aviso que nadie ve.
   */
  const scrollRef = useRef<ScrollView>(null);
  const mostrarAviso = useCallback((nuevo: Aviso): void => {
    setAviso(nuevo);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const esCoordinador = rol === 'coordinador';

  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const { elegida: sucursalElegida, elegir: setSucursalElegida } = useSucursalAuditada();
  useEffect(() => {
    if (esCoordinador) return;
    repositorioSesion.sucursales().then(setSucursales);
  }, [esCoordinador]);

  const sucursalId = sucursalEnFoco({
    rol,
    sucursalDeSesion: sesion?.sucursal?.id ?? null,
    elegida: sucursalElegida,
  });

  const [resumenPorRonda, setResumenPorRonda] = useState<Record<number, ResumenRonda | null>>({});

  /**
   * `hastaRonda` no es 3 fijo: el Auditor puede abrir un 4to o un 5to conteo, y
   * con el techo clavado esas rondas se contaban en el servidor pero no se
   * veían acá.
   */
  const cargarResumenDeRondas = useCallback(async (invId: number, hastaRonda: number): Promise<void> => {
    const rondas = Array.from({ length: Math.max(RONDA_MAX, hastaRonda) }, (_, i) => i + 1);
    const resultados = await Promise.all(
      rondas.map(async (r) => {
        try {
          return [r, await repositorioInventario.resumenRonda(invId, r)] as const;
        } catch {
          // 404 = esa ronda todavía no se abrió. No es un fallo.
          return [r, null] as const;
        }
      }),
    );
    setResumenPorRonda(Object.fromEntries(resultados));
  }, []);

  const cargar = useCallback(async (): Promise<void> => {
    if (!sesion) return;
    // Auditor que todavía no eligió sucursal (y sin ficha): no hay ciclo que
    // pedir -- la pantalla invita a elegir en vez de mostrar la de nadie.
    if (sucursalId === null) {
      setItems(null);
      setInventarioId(null);
      setRondaActiva(null);
      setResumenPorRonda({});
      setCargando(false);
      setErrorCarga(null);
      return;
    }

    setErrorCarga(null);
    setMotivoRechazo(null);

    const error = await cargarSeguro(async () => {
      // `activo()` filtra `estado: en_curso`: para un inventario YA cerrado
      // devuelve null. Ahí el ciclo es el ÚLTIMO cerrado de la sucursal, que
      // sale del historial.
      const activo = await repositorioInventario.activo(sucursalId);
      // EL HISTÓRICO SOLO SI EL ROL LO TIENE: al Coordinador el servidor le
      // responde 403, y la pantalla mostraba "Tu rol no tiene acceso a esta
      // acción" sobre una pantalla que SÍ es suya.
      const historial =
        activo || !puedeConsultarHistorial(rol)
          ? []
          : (await repositorioHistorial.listar({ sucursalId })).inventarios;

      const delCiclo = inventarioDelCiclo(activo, historial);
      setItems(delCiclo?.items ?? null);
      setTamanoHoja(delCiclo?.tamanoHoja ?? null);
      setInventarioId(delCiclo?.inventarioId ?? null);
      setRondaActiva(delCiclo?.rondaActiva ?? null);
      setFase(activo ? faseDeCierre(activo.estado, activo.rondaActiva, activo.totalHojas, activo.ultimaRondaCerrada) : delCiclo ? 'cerrado' : null);
      if (!delCiclo) {
        setResumenPorRonda({});
        return;
      }

      await cargarResumenDeRondas(delCiclo.inventarioId, delCiclo.rondaActiva ?? RONDA_MAX);
    });

    if (error) setErrorCarga(error.message);
    setCargando(false);
  }, [sesion, sucursalId, rol, cargarResumenDeRondas, intentoNumero]);

  /**
   * PAUSADO MIENTRAS HAY UNA ACCIÓN EN CURSO: un refresco que aterriza en medio
   * de cerrar la ronda pisaría `rondaActiva` y `fase` con el estado de ANTES.
   * La confirmación abierta también pausa -- es un modal, y refrescar debajo de
   * uno es la misma clase de pisada.
   */
  const { refrescar } = useRefrescoAlEnfocar(cargar, {
    pausado: cerrandoRonda || accionAuditor !== null || confirmacionVisible,
  });

  // CAMBIAR DE SUCURSAL TIENE QUE RECARGAR: el hook solo dispara al enfocar y
  // al volver al frente, y guarda `cargar` en un ref, así que no se re-suscribe
  // cuando `cargar` cambia de identidad. `refrescar()` y no `cargar()` para
  // pasar por el candado del hook.
  useEffect(() => {
    setCargando(true);
    refrescar();
  }, [sucursalId, intentoNumero, refrescar]);

  if (!sesion) return <View style={styles.centro} />;

  // El preview del cierre es el resumen de la ronda ACTIVA -- el MISMO objeto
  // que ya trajo `cargarResumenDeRondas`, no una segunda llamada que podría
  // discrepar.
  const resumenActivo = rondaActiva !== null ? resumenPorRonda[rondaActiva] ?? null : null;

  async function cerrarRondaAhora(): Promise<void> {
    if (inventarioId === null || rondaActiva === null || resumenActivo === null || !resumenActivo.sePuedeCerrar) return;
    setCerrandoRonda(true);
    try {
      const cierre = await repositorioInventario.cerrarRonda(inventarioId, rondaActiva);
      if (cierre.rondaAbierta !== null) {
        mostrarAviso({
          tono: 'ok',
          titulo: `${ORDINAL[cierre.rondaAbierta]} conteo abierto`,
          mensaje: `Se abrió la ronda ${cierre.rondaAbierta} con ${formatoMiles(cierre.hojas.length)} hoja${cierre.hojas.length === 1 ? '' : 's'} nueva${cierre.hojas.length === 1 ? '' : 's'}, sin asignar. Repártelas desde Gestión de hojas.`,
        });
      } else {
        // No se abrió ronda nueva: el ciclo terminó (todo cuadró, o se llegó al
        // último conteo). No es un error — el backend lo dice en el motivo.
        mostrarAviso({
          tono: 'ok',
          titulo: `${ORDINAL[rondaActiva]} conteo cerrado`,
          mensaje: cierre.motivoSinSiguiente ?? 'El ciclo de conteos terminó.',
        });
      }
      // El cierre cambió la RONDA ACTIVA en el backend: hay que RE-PEDIR
      // activo() para no quedar mostrando el bloque de cierre de la ronda que
      // se acaba de cerrar.
      const activo = await repositorioInventario.activo(sucursalId!);
      setRondaActiva(activo?.rondaActiva ?? null);
      setFase(activo ? faseDeCierre(activo.estado, activo.rondaActiva, activo.totalHojas, activo.ultimaRondaCerrada) : 'cerrado');
      await cargarResumenDeRondas(inventarioId, activo?.rondaActiva ?? RONDA_MAX);
    } catch (error) {
      // El backend rechaza con mensaje claro (hojas sin finalizar, o ya
      // cerrada): se muestra tal cual, no un "no se pudo" genérico.
      mostrarAviso({
        tono: 'atencion',
        titulo: 'No se pudo cerrar la ronda',
        mensaje: error instanceof Error ? error.message : 'Intenta de nuevo.',
      });
    } finally {
      setCerrandoRonda(false);
    }
  }

  /**
   * LAS DOS DECISIONES DEL AUDITOR, cuando la última ronda ya cerró. Se recarga
   * entero después de cada una: abrir una ronda cambia la ronda activa y el
   * embudo; iniciar el ajuste cambia el ESTADO del inventario, y con él lo que
   * puede hacer el Coordinador en otra pantalla.
   */
  async function ejecutarAccionAuditor(cual: 'ronda' | 'ajuste'): Promise<void> {
    if (inventarioId === null) return;
    setAccionAuditor(cual);
    // Se limpia el motivo anterior ANTES de intentar: dejar el de la vez pasada
    // mientras corre el nuevo intento haría leer un rechazo viejo como el de
    // ahora.
    setMotivoRechazo(null);
    try {
      if (cual === 'ronda') {
        await repositorioAjuste.abrirRondaExtra(inventarioId);
      } else {
        await repositorioAjuste.iniciarAjuste(inventarioId);
      }
      const activo = await repositorioInventario.activo(sucursalId!);
      setRondaActiva(activo?.rondaActiva ?? null);
      setFase(activo ? faseDeCierre(activo.estado, activo.rondaActiva, activo.totalHojas, activo.ultimaRondaCerrada) : 'cerrado');
      await cargarResumenDeRondas(inventarioId, activo?.rondaActiva ?? RONDA_MAX);
      if (cual === 'ronda') {
        mostrarAviso({
          tono: 'ok',
          titulo: `${ORDINAL[activo?.rondaActiva ?? 0]} conteo abierto`,
          mensaje: 'Las hojas nuevas nacen sin asignar: el coordinador las reparte desde Gestión de hojas.',
        });
      } else {
        mostrarAviso({
          tono: 'ok',
          titulo: 'Ajuste final iniciado',
          mensaje: 'Desde ahora los valores los cambias tú, comparando contra el stock. El coordinador ya no puede corregir.',
        });
      }
    } catch (error) {
      // EL MENSAJE DEL SERVIDOR, TAL CUAL Y PEGADO AL BOTÓN que lo produjo: dice
      // qué regla se topó, y eso es justamente lo que hay que leer dos veces.
      setMotivoRechazo({
        cual,
        mensaje: error instanceof Error ? error.message : 'No se pudo completar. Revisa la conexión con la tienda.',
      });
    } finally {
      setAccionAuditor(null);
    }
  }

  /**
   * Las rondas MÁS ALLÁ de la 3ra que EXISTEN de verdad: las que el Auditor
   * abrió y ya tienen resumen del servidor. Un paso vacío dibujado por las
   * dudas se lee como "acá no cuadró nada", que es una afirmación.
   */
  const rondasExtra = Object.keys(resumenPorRonda)
    .map(Number)
    .filter((ronda) => ronda > RONDA_MAX && resumenPorRonda[ronda] != null)
    .sort((a, b) => a - b);

  /** CUÁNTAS PASADAS CORRIERON de verdad: las que tienen resumen del servidor. */
  const pasadasCorridas = Object.values(resumenPorRonda).filter((r) => r != null).length;

  /**
   * LA RONDA QUE ADMITE CONTEO -- la única que puede estar "en curso". Solo en
   * la fase `contando` hay una ronda abierta; `activo().rondaActiva` sigue
   * devolviendo un número durante el ajuste del auditor.
   */
  const rondaQueAdmiteConteo = fase === null ? rondaActiva : fase === 'contando' ? rondaActiva : null;

  const totalT1 = items ?? 0;

  const comparativoT1 = comparativoVisible(resumenPorRonda[1] ?? null);
  const comparativoT2 = comparativoVisible(resumenPorRonda[2] ?? null);
  const comparativoT3 = comparativoVisible(resumenPorRonda[3] ?? null);

  // La ronda MÁS AVANZADA que ya tiene datos: es la que dice dónde quedó el
  // ciclo. No se suman las tres -- un ítem que pasó de la 1 a la 2 está en las
  // dos, y sumarlas lo contaría dos veces.
  const ultimoComparativo = comparativoT3
    ? { ronda: 3 as const, datos: comparativoT3 }
    : comparativoT2
      ? { ronda: 2 as const, datos: comparativoT2 }
      : comparativoT1
        ? { ronda: 1 as const, datos: comparativoT1 }
        : null;

  const textoCalculoHojasT1 = tamanoHoja !== null ? textoCalculo(calcularHojas(totalT1, tamanoHoja), tamanoHoja) : null;

  const nombreSucursal = esCoordinador
    ? sesion.sucursal?.nombre
    : (sucursales.find((s) => s.id === sucursalId)?.nombre ?? sesion.sucursal?.nombre);

  /**
   * UN SOLO BOTÓN ROJO POR PANTALLA. Con la decisión del Auditor a la vista, la
   * acción es "Empezar el ajuste final"; sin ella, el acceso al ajuste pasa a
   * ser la acción. El Coordinador tiene la suya en el bloque de cierre, que
   * nunca convive con estas dos.
   */
  const hayDecisionAuditor = rol === 'auditor' && fase !== null && elAuditorPuedeDecidir(fase);

  const cifras = items
    ? `${nf.format(items)} ítem${items === 1 ? '' : 's'} · ${pasadasCorridas} pasada${pasadasCorridas === 1 ? '' : 's'}`
    : undefined;

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.pagina}
      contentContainerStyle={styles.contenido}
      showsVerticalScrollIndicator={false}
    >
      <EncabezadoPagina
        migas={[rol === 'auditor' ? 'Auditoría' : 'Gestión masiva', 'Ciclo de conteos']}
        titulo="Ciclo de conteos"
        sub="Cada pasada deja solo los ítems que no coincidieron con el stock de Dynamics."
        onInicio={() => router.push(rol === 'auditor' ? '/auditor' : '/coordinador')}
      />

      {/* EL AVISO ARRIBA DE TODO y no adentro de la tarjeta que lo produjo: la
          acción cambia la fase, y la tarjeta que la disparó puede dejar de
          existir en el mismo render -- con el aviso adentro, desaparecería
          junto con ella. Ver `mostrarAviso`. */}
      {aviso ? <BandaAviso aviso={aviso} onCerrar={() => setAviso(null)} /> : null}

      {/* LA TIENDA Y SUS CIFRAS: el contexto de todo lo de abajo. El Auditor
          elige cuál mira; el Coordinador está atado a la suya y solo la lee. */}
      <View style={[styles.banda, angosto && styles.bandaApilada]}>
        <View style={styles.bandaTienda}>
          <ChipIcono icono={Store} />
          <View style={styles.bandaTextos}>
            <Text style={styles.bandaEtiqueta}>{rol === 'auditor' ? 'Sucursal a auditar' : 'Sucursal'}</Text>
            {rol === 'auditor' ? (
              <SelectorSucursal
                label=""
                sucursales={sucursales}
                sucursalId={sucursalId}
                onElegir={setSucursalElegida}
              />
            ) : (
              <Text style={styles.bandaSede}>{nombreSucursal}</Text>
            )}
            {cifras ? <Text style={styles.bandaSub}>{cifras}</Text> : null}
          </View>
        </View>
      </View>

      <BandaSync estado="ok" mensaje="Sincronizado con Dynamics" />

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : errorCarga ? (
        <TarjetaWeb titulo="No se pudo cargar el ciclo" icono={AlertTriangle} tono="atencion">
          <Text style={styles.textoTarjeta}>{errorCarga}</Text>
          <BotonWeb etiqueta="Reintentar" variante="principal" onPress={() => setIntentoNumero((n) => n + 1)} />
        </TarjetaWeb>
      ) : inventarioId === null ? (
        /*
          TODAVÍA NO HAY INVENTARIO, y eso no es un error ni una falta de
          permisos: es el estado normal de cada tienda al empezar el mes.
        */
        <TarjetaWeb titulo="Esta tienda todavía no tiene inventario" icono={Layers} tono="neutro">
          <Text style={styles.textoTarjeta}>
            {esCoordinador
              ? 'El ciclo de conteos arranca cuando se trae el catálogo y se crean las hojas. Eso se hace en "Armar hojas".'
              : 'No hay un inventario en curso ni uno cerrado para esta sucursal. Cuando el coordinador arme las hojas, el ciclo aparece acá.'}
          </Text>
          {esCoordinador ? (
            <BotonWeb
              etiqueta="Ir a Armar hojas"
              icono={ArrowRightCircle}
              variante="principal"
              onPress={() => router.push('/coordinador/armar')}
            />
          ) : null}
        </TarjetaWeb>
      ) : (
        <>
          {/* LOS CUATRO PASOS A LA VISTA. En el teléfono son tarjetas apiladas
              y hay que scrollear el embudo entero; acá entran en fila y se
              comparan de un vistazo. Abajo de ANCHO_ANGOSTO se apilan. */}
          <View style={[styles.filaPasos, angosto && styles.filaApilada]}>
            <PasoCiclo
              titulo="Paso 1 · 1er Conteo General"
              descripcion="100% del catálogo, comparado contra el stock de Dynamics a medida que se cuenta."
              estado={estadoDePaso(1, rondaQueAdmiteConteo, comparativoT1 != null)}
              calculo={[textoCalculoHojasT1, comparativoT1?.detalle].filter(Boolean).join(' ')}
              {...(comparativoT1?.avance !== undefined ? { avance: comparativoT1.avance } : {})}
              {...(comparativoT1
                ? {}
                : { notaSinDato: 'El 1er conteo todavía no tiene hojas con datos para esta sucursal.' })}
            />

            <PasoCiclo
              titulo="Paso 2 · 2do Reconteo"
              descripcion="Solo los ítems que no coincidieron con el stock de Dynamics en el 1er conteo."
              estado={estadoDePaso(2, rondaQueAdmiteConteo, comparativoT2 != null)}
              {...(comparativoT2?.detalle !== undefined ? { calculo: comparativoT2.detalle } : {})}
              {...(comparativoT2?.avance !== undefined ? { avance: comparativoT2.avance } : {})}
              {...(comparativoT2
                ? {}
                : {
                    notaSinDato:
                      'El 2do conteo todavía no empezó: se abre al cerrar el 1ero, y entra solo con los ítems que no cuadraron.',
                  })}
            />

            <PasoCiclo
              titulo="Paso 3 · 3er Reconteo"
              descripcion={`Los ítems que persistieron tras la 2da pasada, auditados directamente${rol === 'auditor' ? ' por ti' : ''}. Al cerrarlo, el auditor decide: otro conteo, o el ajuste final.`}
              estado={estadoDePaso(3, rondaQueAdmiteConteo, comparativoT3 != null)}
              {...(comparativoT3?.detalle !== undefined ? { calculo: comparativoT3.detalle } : {})}
              {...(comparativoT3?.avance !== undefined ? { avance: comparativoT3.avance } : {})}
              {...(comparativoT3
                ? {}
                : {
                    notaSinDato:
                      'El 3er conteo todavía no empezó: se abre al cerrar el 2do, y solo si quedan ítems sin cuadrar.',
                  })}
            />

            {/* LAS RONDAS EXTRA: solo las que EXISTEN (tienen resumen). El
                ciclo automático llega hasta la 3ra; de ahí en más las abre el
                Auditor una por una. */}
            {rondasExtra.map((ronda) => {
              const comparativo = comparativoVisible(resumenPorRonda[ronda] ?? null);
              return (
                <PasoCiclo
                  key={ronda}
                  titulo={`Paso ${ronda} · ${ORDINAL[ronda]} Conteo`}
                  descripcion={`Conteo extra abierto por el auditor, solo con los ítems que seguían sin cuadrar tras el ${ORDINAL[ronda - 1]}.`}
                  estado={estadoDePaso(ronda, rondaQueAdmiteConteo, comparativo != null)}
                  {...(comparativo?.detalle !== undefined ? { calculo: comparativo.detalle } : {})}
                  {...(comparativo?.avance !== undefined ? { avance: comparativo.avance } : {})}
                />
              );
            })}
          </View>

          <View style={[styles.filaDecisiones, angosto && styles.filaApilada]}>
            {/* LAS DOS DECISIONES DEL AUDITOR: solo con la última ronda cerrada
                y el ajuste sin empezar -- la ventana en la que el Coordinador
                todavía corrige. */}
            {hayDecisionAuditor ? (
              <TarjetaWeb titulo="¿Qué sigue con este conteo?" icono={Scale} tono="atencion" style={styles.decision}>
                <Badge label="Te toca decidir" variant="proceso" />
                <Text style={styles.textoTarjeta}>
                  Cuando cierre la última ronda, el inventario te espera: puedes mandar otra pasada de conteo, o fijar
                  tú mismo los valores comparando contra el stock. Mientras no empieces el ajuste, el coordinador
                  todavía puede corregir lo que cargaron los contadores.
                </Text>
                {/* LA PRECONDICIÓN, dicha en vez de adivinada: desde la app no
                    se puede saber si la última ronda ya cerró, así que se avisa
                    y el servidor es el que corta -- con su mensaje. */}
                <Text style={styles.notaPrecondicion}>
                  Las dos necesitan que la última ronda esté cerrada. Si todavía está abierta, te lo va a decir.
                </Text>
                <BotonWeb
                  etiqueta={accionAuditor === 'ronda' ? 'Abriendo el conteo…' : `Abrir el ${ORDINAL[(rondaActiva ?? RONDA_MAX) + 1]} conteo`}
                  icono={PlusCircle}
                  onPress={() => void ejecutarAccionAuditor('ronda')}
                  deshabilitado={accionAuditor !== null}
                  cargando={accionAuditor === 'ronda'}
                />
                {/* El motivo va PEGADO al botón que falló: con dos botones, un
                    aviso suelto no dice de cuál de los dos habla. */}
                {motivoRechazo?.cual === 'ronda' ? <AvisoMotivo mensaje={motivoRechazo.mensaje} /> : null}
                <BotonWeb
                  etiqueta={accionAuditor === 'ajuste' ? 'Iniciando el ajuste…' : 'Empezar el ajuste final'}
                  icono={Scale}
                  variante="principal"
                  onPress={() => setConfirmacionVisible(true)}
                  deshabilitado={accionAuditor !== null}
                  cargando={accionAuditor === 'ajuste'}
                />
                {motivoRechazo?.cual === 'ajuste' ? <AvisoMotivo mensaje={motivoRechazo.mensaje} /> : null}
              </TarjetaWeb>
            ) : null}

            {/* EL ACCESO AL AJUSTE, siempre que el Auditor esté mirando un
                inventario -- no solo cuando esta pantalla logró detectar que el
                ajuste ya empezó. La fase solo cambia lo que el texto AFIRMA: si
                la pantalla se equivoca, el peor caso es un texto de más; con el
                acceso condicionado, el peor caso era quedarse sin salida. */}
            {rol === 'auditor' && inventarioId !== null && fase !== 'cerrado' ? (
              <TarjetaWeb
                titulo={fase === 'ajuste' ? 'Ajuste final en curso' : 'Ajuste final del conteo'}
                icono={Scale}
                tono={fase === 'ajuste' ? 'atencion' : 'neutro'}
                style={styles.decision}
              >
                {fase === 'ajuste' ? <Badge label="Solo tú" variant="proceso" /> : null}
                <Text style={styles.textoTarjeta}>
                  {fase === 'ajuste'
                    ? 'El coordinador ya no puede corregir este inventario. Fija los valores definitivos y cierra el ajuste para que pase a la liquidación.'
                    : 'Ahí fijas los valores definitivos comparando contra el stock del ERP. La pantalla te dice si el ajuste ya empezó o todavía no.'}
                </Text>
                <BotonWeb
                  etiqueta={fase === 'ajuste' ? 'Ir al ajuste final' : 'Ver el ajuste final'}
                  icono={Scale}
                  variante={fase === 'ajuste' && !hayDecisionAuditor ? 'principal' : 'secundario'}
                  onPress={() => router.push('/auditor/ajuste')}
                />
              </TarjetaWeb>
            ) : null}

            {/* EL BLOQUE DE CIERRE SOLO CUANDO HAY UNA RONDA QUE CERRAR.
                `rondaActiva` es `max(numeroConteo)` y sigue siendo un número
                después de cerrar: con la ronda 1 ya cerrada, ofrecer "Cerrar el
                1er conteo" es invitar a un 409 garantizado. */}
            {esCoordinador && resumenActivo && rondaQueAdmiteConteo !== null ? (
              <TarjetaWeb
                titulo={`Cerrar el ${ORDINAL[rondaQueAdmiteConteo]} conteo`}
                icono={Lock}
                tono={resumenActivo.sePuedeCerrar ? 'ok' : 'atencion'}
                style={styles.decision}
              >
                <Badge
                  label={resumenActivo.sePuedeCerrar ? 'Listo para cerrar' : 'Faltan hojas'}
                  variant={resumenActivo.sePuedeCerrar ? 'ok' : 'espera'}
                />

                {/* El embudo REAL de la ronda activa, del backend. Es lo que
                    hace de cerrar una decisión y no un trámite: se ve el número
                    ANTES de apretar. */}
                <FilaDato
                  etiqueta="Cuadraron contra Dynamics"
                  valor={`${formatoMiles(resumenActivo.cuadrados)} (${formatoPct(resumenActivo.porcentajeCuadrado)}%)`}
                  color={colors.ok}
                />
                <FilaDato
                  etiqueta={etiquetaARecontar(rondaQueAdmiteConteo, resumenActivo.aRecontar)}
                  valor={formatoMiles(resumenActivo.aRecontar)}
                  color={colors.falta}
                />
                {resumenActivo.sinContar > 0 ? (
                  <FilaDato etiqueta="Sin contar todavía" valor={formatoMiles(resumenActivo.sinContar)} />
                ) : null}
                {resumenActivo.sinDatoErp > 0 ? (
                  <FilaDato etiqueta="Sin stock del ERP (no se auditan)" valor={formatoMiles(resumenActivo.sinDatoErp)} />
                ) : null}

                <Text style={styles.textoTarjeta}>
                  {textoCierreExplicacion(rondaQueAdmiteConteo, resumenActivo.aRecontar)}
                </Text>

                {/* El motivo del bloqueo, a la vista: qué hojas faltan
                    finalizar. Un botón gris sin decir por qué obliga a adivinar. */}
                {!resumenActivo.sePuedeCerrar ? (
                  <View style={styles.bloqueoAviso}>
                    <AlertTriangle size={16} color={colors.proceso} />
                    <Text style={styles.bloqueoTexto}>
                      {pluralizar(resumenActivo.hojasSinFinalizar.length, 'Queda', 'Quedan')}{' '}
                      {formatoMiles(resumenActivo.hojasSinFinalizar.length)}{' '}
                      {pluralizar(resumenActivo.hojasSinFinalizar.length, 'hoja', 'hojas')} sin finalizar:{' '}
                      {resumenActivo.hojasSinFinalizar.slice(0, 4).map((h) => `#${h.numero}`).join(', ')}
                      {resumenActivo.hojasSinFinalizar.length > 4
                        ? ` y ${resumenActivo.hojasSinFinalizar.length - 4} más`
                        : ''}
                      . Una hoja sin finalizar es una hoja que alguien todavía está contando.
                    </Text>
                  </View>
                ) : null}

                <BotonWeb
                  etiqueta={
                    resumenActivo.sePuedeCerrar
                      ? textoBotonCierre(rondaQueAdmiteConteo, resumenActivo.aRecontar, formatoMiles)
                      : 'Termina las hojas para poder cerrar'
                  }
                  icono={Lock}
                  variante="principal"
                  onPress={() => void cerrarRondaAhora()}
                  deshabilitado={!resumenActivo.sePuedeCerrar}
                  cargando={cerrandoRonda}
                />
              </TarjetaWeb>
            ) : null}

            {/* EN LUGAR DEL BLOQUE DE CIERRE, cuando la ronda ya cerró. No se
                deja el hueco: quien cerró necesita saber que ya hizo lo suyo y
                que sigue el Auditor, y que todavía puede corregir. */}
            {esCoordinador && fase === 'rondas-cerradas' && rondaActiva !== null ? (
              <TarjetaWeb titulo={`${ORDINAL[rondaActiva]} conteo cerrado`} icono={CheckCircle2} tono="ok" style={styles.decision}>
                <Badge label="Le toca al auditor" variant="ok" />
                <Text style={styles.textoTarjeta}>{textoRondaYaCerrada(rondaActiva)}</Text>
              </TarjetaWeb>
            ) : null}

            {/* EL CIERRE DEL EMBUDO: dónde quedó parado el ciclo. Sale de la
                ÚLTIMA ronda con datos -- no de una suma de las tres, que
                contaría dos veces a los ítems que pasaron de una a otra.
                SOLO Coordinador (pedido del cliente): al Auditor le repite el
                Paso más avanzado y le come espacio. */}
            {esCoordinador ? (
              // SIN TÍTULO, como en el teléfono: este bloque nunca tuvo uno, y
              // ponerle uno sería inventar un texto que nadie escribió. Por eso
              // es un bloque con los tokens de la tarjeta y no una `TarjetaWeb`
              // -- ese componente pide título, y acá no hay ninguno que sea
              // verdad.
              <View style={styles.bloqueSinTitulo}>
                {ultimoComparativo ? (
                  <Text style={styles.textoTarjeta}>
                    Al cierre del {ORDINAL[ultimoComparativo.ronda]} conteo: {ultimoComparativo.datos.detalle}
                    {ultimoComparativo.datos.avance.pct >= 100
                      ? ' El ciclo puede cerrarse: no queda nada por recontar.'
                      : ` Los que no cuadren tras el ${ORDINAL[RONDA_MAX]} pasan al auditor, que decide si manda otra pasada o los ajusta él.`}
                  </Text>
                ) : (
                  <Text style={styles.textoTarjeta}>
                    El resultado se arma a medida que se cuenta: todavía no hay ningún conteo cargado en este
                    inventario.
                  </Text>
                )}
              </View>
            ) : null}
          </View>

          {rol === 'auditor' ? (
            <BotonWeb
              etiqueta="Ver el comparativo de los conteos en auditoría"
              icono={FileText}
              onPress={() => router.push('/auditor/auditoria')}
            />
          ) : null}
        </>
      )}

      {/*
        LA CONFIRMACIÓN DEL AJUSTE. En el teléfono es un `Alert.alert` con dos
        botones; en el navegador eso no existe (ver la cabecera). Mismo título,
        mismo texto y mismas dos etiquetas. Se cierra por el fondo, por la X,
        por "Todavía no" y con Escape (`onRequestClose`).
      */}
      <Modal
        visible={confirmacionVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmacionVisible(false)}
      >
        <Pressable
          style={styles.modalFondo}
          onPress={() => setConfirmacionVisible(false)}
          accessibilityLabel="Cerrar la confirmación"
        />
        <View pointerEvents="box-none" style={styles.modalCentrado}>
          <View style={[styles.modalCaja, shadow.modal]}>
            <View style={styles.modalCabecera}>
              <Text style={styles.modalTitulo}>Empezar el ajuste final</Text>
              <Pressable
                onPress={() => setConfirmacionVisible(false)}
                style={styles.modalCerrar}
                accessibilityRole="button"
                accessibilityLabel="Cerrar la confirmación"
              >
                <X size={19} color={colors.gris} />
              </Pressable>
            </View>
            {/* La confirmación NOMBRA LA CONSECUENCIA, no pregunta "¿estás
                seguro?": es el mismo texto del teléfono. */}
            <Text style={styles.modalTexto}>
              A partir de ahora el coordinador ya no puede corregir los conteos de este inventario: los valores los
              cambias tú, viendo el stock. Se puede empezar una sola vez.
            </Text>
            <View style={styles.modalBotones}>
              <BotonWeb etiqueta="Todavía no" onPress={() => setConfirmacionVisible(false)} />
              <BotonWeb
                etiqueta="Empezar el ajuste"
                icono={Scale}
                variante="principal"
                onPress={() => {
                  setConfirmacionVisible(false);
                  void ejecutarAccionAuditor('ajuste');
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
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
  bandaSede: { fontSize: fontSize.lg, color: colors.tinta, fontFamily: fonts.bold },
  bandaSub: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },

  bandaAviso: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  bandaAvisoTextos: { flex: 1, gap: 2 },
  bandaAvisoTitulo: { fontSize: fontSize.lg, fontFamily: fonts.bold },
  bandaAvisoMensaje: { fontSize: fontSize.sm, lineHeight: 20, color: colors.tinta, fontFamily: fonts.regular },
  bandaAvisoCerrar: { padding: 2 },

  /** Los pasos en fila; `flexBasis` para que nunca queden más angostos que su barra. */
  filaPasos: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, alignItems: 'stretch' },
  filaDecisiones: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, alignItems: 'stretch' },
  filaApilada: { flexDirection: 'column' },
  paso: { flexGrow: 1, flexShrink: 1, flexBasis: 300, minWidth: 280 },
  /** El bloque de cierre lleva el embudo entero: necesita más ancho que un paso. */
  decision: { flexGrow: 1, flexShrink: 1, flexBasis: 420, minWidth: 340 },
  bloqueSinTitulo: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 420,
    minWidth: 340,
    backgroundColor: colors.blanco,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borde,
    padding: spacing.lg,
    justifyContent: 'center',
    ...shadow.tarjeta,
  },

  textoTarjeta: { fontSize: fontSize.sm, lineHeight: 20, color: colors.gris, fontFamily: fonts.regular },
  /** La precondición de las acciones del Auditor: aclaración, no alarma. */
  notaPrecondicion: { fontSize: fontSize.xs, lineHeight: 16, color: colors.grisClaro, fontFamily: fonts.regular },
  notaSinDato: { fontSize: fontSize.xs, lineHeight: 17, color: colors.grisClaro, fontFamily: fonts.regular, fontStyle: 'italic' },

  avisoMotivo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: 11,
    borderRadius: radius.sm,
    backgroundColor: colors.procesoSuave,
    borderWidth: 1,
    borderColor: colors.proceso,
  },
  // `flex: 1` sin `numberOfLines`: el mensaje del servidor envuelve todas las
  // líneas que necesite. Un aviso cortado a la mitad no advierte nada.
  avisoMotivoTexto: { flex: 1, fontSize: fontSize.sm, lineHeight: 18, color: colors.tinta, fontFamily: fonts.regular },

  embudoBarra: { height: 8, borderRadius: radius.full, backgroundColor: colors.procesoSuave, overflow: 'hidden' },
  embudoOk: { height: '100%', borderRadius: radius.full, backgroundColor: colors.ok },
  embudoFila: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  embudoTexto: { fontSize: fontSize.sm, fontFamily: fonts.semibold },

  bloqueoAviso: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: 11,
    borderRadius: radius.md,
    backgroundColor: colors.procesoSuave,
  },
  bloqueoTexto: { flex: 1, fontSize: fontSize.sm, lineHeight: 18, color: colors.proceso, fontFamily: fonts.medium },

  modalFondo: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  modalCentrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  modalCaja: {
    width: '100%',
    maxWidth: 520,
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.blanco,
  },
  modalCabecera: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  modalTitulo: { flex: 1, fontSize: fontSize.xl, color: colors.tinta, fontFamily: fonts.bold },
  modalCerrar: { padding: 4 },
  modalTexto: { fontSize: fontSize.base, lineHeight: 23, color: colors.gris, fontFamily: fonts.regular },
  modalBotones: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
});
