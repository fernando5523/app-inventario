import { router } from 'expo-router';
import { AlertTriangle, ArrowRightCircle, Check, FileText, Lock, PlusCircle, Scale } from 'lucide-react-native';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useRefrescoAlEnfocar } from '../hooks/useRefrescoAlEnfocar';
import { cargarSeguro } from '../../lib/adaptadores/_http';
import { repositorioAjuste, repositorioHistorial, repositorioInventario, repositorioSesion } from '../../lib/contenedor';
import { elAuditorPuedeDecidir, faseDeCierre, type FaseDeCierre } from '../../lib/dominio/ajuste-final';
import { comparativoDeRonda } from '../../lib/dominio/comparativo-ronda';
import { inventarioDelCiclo } from '../../lib/dominio/inventario-del-ciclo';
import { sucursalEnFoco } from '../../lib/dominio/sucursal-en-foco';
import {
  estadoDePaso,
  etiquetaARecontar,
  ORDINAL,
  RONDA_MAX,
  textoBotonCierre,
  textoCierreExplicacion,
  type EstadoPaso,
} from '../../lib/dominio/texto-cierre-ronda';
import { partirEnHojas } from '../../lib/dominio/lote';
import { pluralizar } from '../../lib/dominio/plural';
import { type Rol, type Sucursal, type TamanoHoja } from '../../lib/dominio/tipos';
import type { ResumenRonda } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { useSucursalAuditada } from '../../lib/sucursal-auditada-contexto';
import { colors, fonts, radius, spacing } from '../../lib/theme';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';
import { BandaSync, Badge, BarraApp, Button, SelectorSucursal, formatoMiles, formatoPct, type BadgeVariant } from '../ui';

// formatoMiles/formatoPct, no Intl.NumberFormat('es-PE'): no está
// garantizado que Hermes traiga los datos ICU de es-PE en el emulador —
// ver components/ui/formato.ts.
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
 * Traduce el estado de un PASO (`texto-cierre-ronda.ts#EstadoPaso`, derivado
 * de la ronda ACTIVA) al badge que se muestra -- NUNCA un literal. Antes el
 * Paso 2 mostraba "En curso" fijo aunque esa ronda ya estuviera cerrada (bug
 * del cliente; de la misma familia que el hallazgo I-4 de la auditoría, badges
 * hardcodeados sin relación con la ronda real).
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
 * El comparativo contra Dynamics de una ronda, listo para mostrar.
 *
 * `null` cuando esa ronda todavía no existe (el endpoint responde 404). La
 * distinción importa y por eso son dos textos distintos:
 *
 *   "todavía no empezó"      la ronda no se abrió — es la verdad, no un hueco
 *   "no se puede calcular"   nos falta un dato — eso sí sería una limitación
 *
 * Decir lo segundo cuando pasa lo primero hace que el Coordinador crea que el
 * sistema está roto justo cuando está funcionando como debe.
 */
const comparativoVisible = (r: ResumenRonda | null) =>
  comparativoDeRonda(r, (n: number) => nf.format(n), formatoPct);

interface PasoCicloProps {
  titulo: string;
  descripcion: string;
  estado: EstadoPaso;
  calculo?: string;
  /** Barra + cifra de avance REAL (items contados / total). Sin esto, no se dibuja embudo. */
  avance?: { pct: number; texto: string };
  /** Nota honesta cuando falta un dato -- nunca un numero inventado en su lugar. */
  notaSinDato?: string;
}

/**
 * Por qué el servidor dijo que no. Paleta `proceso` (el estado de ATENCIÓN del
 * design system), nunca el rojo de marca -- el rojo acá es el botón que se
 * acaba de tocar, y si el aviso también fuera rojo competirían.
 *
 * El texto llega del backend sin traducir: nombra la regla real ("todavía
 * queda una ronda abierta", "no queda nada por recontar"), y una de esas ni
 * siquiera es un error -- es el caso feliz. Un genérico borraría las dos cosas.
 */
function AvisoMotivo({ mensaje }: { mensaje: string }): JSX.Element {
  return (
    <View style={styles.avisoMotivo}>
      <AlertTriangle size={15} color={colors.proceso} />
      <Text style={styles.avisoMotivoTexto}>{mensaje}</Text>
    </View>
  );
}

/** Tarjeta de un paso del embudo (`.tarjeta` + `.embudo-*` en la maqueta). */
function PasoCiclo({ titulo, descripcion, estado, calculo, avance, notaSinDato }: PasoCicloProps): JSX.Element {
  const badge = badgeDePaso(estado);
  return (
    <View style={styles.tarjeta}>
      <View style={styles.tarjetaCabecera}>
        <Text style={styles.tarjetaTitulo}>{titulo}</Text>
        <Badge label={badge.label} variant={badge.variant} />
      </View>
      <Text style={styles.tarjetaTexto}>{descripcion}</Text>
      {calculo ? <Text style={styles.tarjetaTexto}>{calculo}</Text> : null}
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
    </View>
  );
}

/** Una fila del embudo del cierre: etiqueta a la izquierda, cifra a la derecha. */
function FilaResumen({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: 'ok' | 'falta' }): JSX.Element {
  return (
    <View style={styles.filaResumen}>
      <Text style={styles.filaResumenEtiqueta}>{etiqueta}</Text>
      <Text style={[styles.filaResumenValor, tono === 'ok' && styles.valorOk, tono === 'falta' && styles.valorFalta]}>{valor}</Text>
    </View>
  );
}

export interface CicloScreenProps {
  rol: Extract<Rol, 'coordinador' | 'auditor'>;
}

/**
 * Ciclo de los 3 conteos (mobile/design/ciclo-conteos.html) — un solo
 * componente para Coordinador y Auditor, la usan app/coordinador/ciclo.tsx
 * y app/auditor/ciclo.tsx. La diferencia entre roles se resuelve con la
 * prop `rol`, nunca con una segunda copia del archivo: el Coordinador
 * elige el tamaño de hoja de los reconteos (es su decisión); el Auditor
 * lo ve de solo lectura y tiene además el acceso a la matriz de auditoría,
 * que no le corresponde al Coordinador.
 *
 * LOS 3 PASOS LEEN UNA SOLA FUENTE: el resumen del SERVIDOR de cada ronda
 * (`resumenRonda(inventarioId, 1/2/3)`), sobre TODOS los conteos del
 * inventario. Devuelve AGREGADOS (cuántos cuadraron, cuántos pasan a
 * recontar), nunca el stock de un ítem: por eso el Coordinador puede verlo
 * mientras todavía coordina el conteo sin romper el conteo ciego. La matriz
 * de auditoría, que sí trae `stockErp` por ítem, NO se usa acá.
 *
 * ARREGLO DE LA LECTURA (bug del cliente, inventario cerrado): antes el Paso 1
 * salía de `repositorioHojas.todas()`, que en el adaptador offline trae los
 * conteos del SQLite LOCAL — la superposición de quien mira la pantalla. El
 * Coordinador veía "1 de 10" porque su teléfono tenía UN conteo local, aunque
 * el servidor tuviera los 10. Y como `activo()` filtra `estado: en_curso`,
 * para un inventario ya cerrado devolvía null y la carga cortaba en seco: los
 * 3 pasos "sin datos", el bloque final "no hay ningún conteo cargado", todo
 * falso. Ahora Paso 1 usa el server como los otros dos, y cuando `activo()`
 * es null el ciclo se resuelve contra el historial (`inventario-del-ciclo.ts`)
 * — el último inventario cerrado de la sucursal, con su embudo real. Es el
 * mismo criterio de "leer siempre del servidor" que `todas()` en d8b2859.
 *
 * Una ronda que todavía no se abrió responde 404 y el paso dice "todavía no
 * empezó" — que es la verdad, distinto de "no lo podemos calcular".
 *
 * El preview de cierre (solo Coordinador) NO es una segunda llamada: es el
 * mismo `resumenRonda` de la ronda activa que ya se trajo para el embudo
 * (`resumenPorRonda[rondaActiva]`), así el número del bloque de cierre y el
 * del Paso correspondiente no pueden discrepar.
 */
export function CicloScreen({ rol }: CicloScreenProps): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  // Bug real (2026-09-10): `cargar()` de más abajo no tenía try/catch --
  // si `activo()`/`resumenRonda()` revientan (backend caído), la excepción
  // escapaba sin control y `setCargando(false)` no se ejecutaba nunca: el
  // spinner de esta pantalla quedaba girando para siempre.
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [intentoNumero, setIntentoNumero] = useState(0);
  const [items, setItems] = useState<number | null>(null);
  // El tamaño de hoja REAL del 1er conteo -- null hasta que se crean las
  // hojas (mismo momento que `totalHojas: null` en el puerto). Antes el
  // Paso 1 calculaba siempre contra un 50 fijo en el código, así que un
  // inventario armado con hojas de 20 o 30 mostraba una cantidad de hojas
  // que no era la real (ver lib/dominio/lote.ts#partirEnHojas).
  const [tamanoHoja, setTamanoHoja] = useState<TamanoHoja | null>(null);
  const [inventarioId, setInventarioId] = useState<number | null>(null);

  const [cerrandoRonda, setCerrandoRonda] = useState(false);
  // La ronda que HOY admite cierre: la activa que devuelve el backend
  // (max(numeroConteo), null si no hay ninguna). NO es siempre la 1ra — cuando
  // el 1er conteo ya se cerró y corre el 2do, esto vale 2 y el bloque cierra el
  // 2do. Si es null no hay ronda que cerrar: el bloque no se muestra y NUNCA
  // cae a 1 por defecto ("no hay ronda" ≠ "ronda 1"). Con el inventario ya
  // cerrado también es null, y el embudo de las 3 pasadas se muestra igual.
  const [rondaActiva, setRondaActiva] = useState<number | null>(null);
  /**
   * EN QUÉ FASE está el cierre. `null` = todavía no se sabe (sin inventario,
   * o el ciclo salió del historial). No se deduce de `rondaActiva`: durante el
   * ajuste del auditor tampoco hay ronda activa, y los dos casos habilitan
   * cosas distintas (ver dominio/ajuste-final.ts).
   */
  const [fase, setFase] = useState<FaseDeCierre | null>(null);
  const [accionAuditor, setAccionAuditor] = useState<'ronda' | 'ajuste' | null>(null);
  /**
   * POR QUÉ NO SE PUDO, con el texto del servidor y donde se tocó el botón.
   *
   * El backend ya explica cada negativa con una frase de negocio: que todavía
   * queda una ronda abierta, que el ajuste ya arrancó, o que no queda nada por
   * recontar -- y esa última no es un error, es el caso feliz. Un botón que
   * falla y solo deja un cartel que se descarta manda a adivinar; acá el
   * motivo queda A LA VISTA, pegado al botón que lo produjo, hasta el próximo
   * intento o la próxima recarga.
   */
  const [motivoRechazo, setMotivoRechazo] = useState<{ cual: 'ronda' | 'ajuste'; mensaje: string } | null>(null);
  const esCoordinador = rol === 'coordinador';

  // El Auditor NO tiene tienda: elige la sucursal cuyo ciclo mira (el
  // Coordinador sigue atado a la suya, no ve el selector). El padrón sale del
  // mismo endpoint del login; se pide solo para el Auditor. `sucursalElegida`
  // null = arranca en la de su ficha (default, cambiable). Ver sucursalEnFoco.
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  // COMPARTIDA entre las pantallas del auditor (Auditoría, Ciclo, Historial,
  // Inicio): elegir acá cambia todas. Para el Coordinador el hook devuelve el
  // default inerte y `sucursalEnFoco` usa la de su sesión.
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

  /**
   * El comparativo contra Dynamics de CADA ronda -- LA ÚNICA fuente de las
   * cifras de los 3 pasos Y del preview de cierre. Es el mismo endpoint del
   * SERVIDOR (`resumenRonda`) llamado con 1, 2 y 3, sobre TODOS los conteos del
   * inventario, no solo los de este teléfono.
   *
   * Antes el Paso 1 leía `repositorioHojas.todas()`, que en el adaptador
   * offline trae los conteos del SQLite LOCAL -- la superposición de quien mira
   * la pantalla. Por eso el Coordinador veía "1 de 10": su teléfono tenía UN
   * conteo local, aunque el servidor tuviera los 10. El ciclo es del inventario
   * entero; su lectura tiene que ir SIEMPRE al servidor (mismo criterio que
   * `todas()` en d8b2859).
   *
   * Devuelve AGREGADOS -- cuántos cuadraron, cuántos van a recontar -- y nunca
   * el stock de un ítem: el Coordinador lo ve sin romper el conteo ciego. Una
   * ronda que todavía no existe responde 404 y queda en `null`: la pantalla lo
   * muestra como "todavía no empezó", que es la verdad, no un cálculo que falló.
   */
  const [resumenPorRonda, setResumenPorRonda] = useState<Record<number, ResumenRonda | null>>({});

  /**
   * `hastaRonda` ya no es 3 fijo: el Auditor puede abrir un 4to o un 5to
   * conteo, y con el techo clavado esas rondas se contaban en el servidor pero
   * no se veían acá -- el embudo se quedaba mostrando tres pasos sobre un
   * inventario que ya iba por el quinto.
   */
  const cargarResumenDeRondas = useCallback(async (invId: number, hastaRonda: number): Promise<void> => {
    const rondas = Array.from({ length: Math.max(RONDA_MAX, hastaRonda) }, (_, i) => i + 1);
    const resultados = await Promise.all(
      rondas.map(async (r) => {
        try {
          return [r, await repositorioInventario.resumenRonda(invId, r)] as const;
        } catch {
          // 404 = esa ronda todavía no se abrió (rondas 2/3 mientras se cuenta
          // la 1ra), o el inventario no llegó a tener esa ronda. No es un fallo.
          return [r, null] as const;
        }
      }),
    );
    setResumenPorRonda(Object.fromEntries(resultados));
  }, []);

  /**
   * LA CARGA DEL CICLO, y por qué ahora vuelve a correr al enfocar.
   *
   * ---------------------------------------------------------------------
   * EL PROBLEMA QUE ESTO CIERRA
   * ---------------------------------------------------------------------
   * Esto era un `useEffect` con `[sesion, cargarResumenDeRondas,
   * intentoNumero, sucursalId]`: se pedía UNA vez y no se volvía a pedir
   * nunca, salvo por el botón "Reintentar" -- que solo aparece si hubo un
   * error de carga. Volver a la pestaña no remonta la pantalla (por eso el
   * resto de las pantallas usa `useFocusEffect`), así que el resumen se
   * quedaba clavado en el momento en que se abrió.
   *
   * Lo que eso cuesta: el resumen de la ronda activa ES el preview del
   * cierre. El Coordinador lo abría, leía "faltan 12 por contar", se iba a
   * Gestión de hojas, volvía y seguía diciendo 12 aunque los contadores ya
   * hubieran cargado todo. Decidía no cerrar la ronda con un dato viejo --
   * el mismo problema que el "Faltan 50 productos por contar" que reportó
   * el usuario en otra pantalla.
   *
   * Se usa `useRefrescoAlEnfocar`, el MISMO hook que Gestión de hojas y
   * Asistencia: un solo comportamiento para toda la app, no un refresco
   * distinto por pantalla. Cubre enfocar Y volver a primer plano.
   *
   * Esta pantalla NO tiene copia local que reconciliar: `activo()`,
   * `resumenRonda()` e `historial.listar()` van al servidor en cada carga y
   * el estado se REEMPLAZA entero. Sin red, `cargarSeguro` devuelve el error
   * y la pantalla lo muestra sin vaciar lo que ya tenía en pantalla.
   */
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
      // sale del historial. Sin este fallback la pantalla quedaba en blanco
      // sobre un ciclo que en realidad terminó con sus 3 pasadas contadas.
      const activo = await repositorioInventario.activo(sucursalId);
      const historial = activo ? [] : (await repositorioHistorial.listar({ sucursalId })).inventarios;

      const delCiclo = inventarioDelCiclo(activo, historial);
      setItems(delCiclo?.items ?? null);
      setTamanoHoja(delCiclo?.tamanoHoja ?? null);
      setInventarioId(delCiclo?.inventarioId ?? null);
      setRondaActiva(delCiclo?.rondaActiva ?? null);
      // La fase sale del inventario ABIERTO. Si el ciclo vino del historial
      // (no hay `activo`), ese inventario ya cerró y no hay nada que abrir
      // ni que ajustar.
      setFase(activo ? faseDeCierre(activo.estado, activo.rondaActiva, activo.totalHojas) : delCiclo ? 'cerrado' : null);
      if (!delCiclo) {
        setResumenPorRonda({});
        return;
      }

      // El embudo de las rondas, del servidor. Lo ven los DOS roles: es el
      // ciclo del inventario, no una herramienta de cierre. El preview del
      // cierre sale de este mismo objeto (resumenPorRonda[rondaActiva]).
      await cargarResumenDeRondas(delCiclo.inventarioId, delCiclo.rondaActiva ?? RONDA_MAX);
    });

    // INCONDICIONAL: con cargarSeguro, `error` nunca deja escapar una
    // excepción -- este `setCargando(false)` SIEMPRE se ejecuta.
    if (error) setErrorCarga(error.message);
    setCargando(false);
  }, [sesion, sucursalId, cargarResumenDeRondas, intentoNumero]);

  /**
   * PAUSADO MIENTRAS HAY UNA ACCIÓN EN CURSO. Un refresco que aterriza en
   * medio de cerrar la ronda o de abrir el ajuste pisaría `rondaActiva` y
   * `fase` con el estado de ANTES de la acción -- que es justo lo que esas
   * funciones acaban de re-pedir a mano. Es para lo que existe la bandera
   * (ver el hook).
   */
  const { refrescando, refrescar } = useRefrescoAlEnfocar(cargar, {
    pausado: cerrandoRonda || accionAuditor !== null,
  });

  /**
   * CAMBIAR DE SUCURSAL TIENE QUE RECARGAR, y sin esto no recargaba.
   *
   * `useRefrescoAlEnfocar` dispara al ENFOCAR y al volver a primer plano, y
   * nada más: guarda `cargar` en un ref a propósito (ver su comentario) para
   * no re-suscribirse en cada render, así que su `useFocusEffect` NO se
   * vuelve a ejecutar cuando `cargar` cambia de identidad. Al sacar la carga
   * del `useEffect` que la disparaba, el selector de sucursal del Auditor
   * quedó sin efecto: elegía otra tienda y seguía viendo el ciclo de la
   * anterior, que es la misma clase de dato viejo que este cambio vino a
   * eliminar.
   *
   * Se llama a `refrescar()` y no a `cargar()` directo para pasar por el
   * candado del hook: al montar, este efecto y el de enfocar disparan juntos,
   * y `enVuelo` descarta el segundo en vez de pedir dos veces lo mismo.
   *
   * `intentoNumero` también entra: es el botón "volver a intentar" del error
   * de carga, y compartía el mismo disparador perdido.
   */
  useEffect(() => {
    setCargando(true);
    refrescar();
  }, [sucursalId, intentoNumero, refrescar]);

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  // El preview del cierre es el resumen de la ronda ACTIVA -- el MISMO objeto
  // que ya trajo `cargarResumenDeRondas` para el embudo, no una segunda llamada
  // que podría discrepar. `null` si no hay ronda activa (inventario cerrado).
  const resumenActivo = rondaActiva !== null ? resumenPorRonda[rondaActiva] ?? null : null;

  async function cerrarRondaAhora(): Promise<void> {
    if (inventarioId === null || rondaActiva === null || resumenActivo === null || !resumenActivo.sePuedeCerrar) return;
    setCerrandoRonda(true);
    try {
      const cierre = await repositorioInventario.cerrarRonda(inventarioId, rondaActiva);
      if (cierre.rondaAbierta !== null) {
        Alert.alert(
          `${ORDINAL[cierre.rondaAbierta]} conteo abierto`,
          `Se abrió la ronda ${cierre.rondaAbierta} con ${formatoMiles(cierre.hojas.length)} hoja${cierre.hojas.length === 1 ? '' : 's'} nueva${cierre.hojas.length === 1 ? '' : 's'}, sin asignar. Repártelas desde Gestión de hojas.`,
        );
      } else {
        // No se abrió ronda nueva: el ciclo terminó (todo cuadró, o se llegó
        // al último conteo). No es un error — el backend lo dice en el motivo.
        Alert.alert(`${ORDINAL[rondaActiva]} conteo cerrado`, cierre.motivoSinSiguiente ?? 'El ciclo de conteos terminó.');
      }
      // El cierre cambió la RONDA ACTIVA en el backend: hay que RE-PEDIR
      // activo() para no quedar mostrando el bloque de cierre de la ronda que
      // se acaba de cerrar. Si el ciclo terminó, activo() devuelve null y
      // `rondaActiva` pasa a null: el bloque de cierre desaparece solo, pero el
      // embudo de las 3 pasadas (resumenPorRonda) se recarga y se sigue viendo.
      const activo = await repositorioInventario.activo(sucursalId!);
      setRondaActiva(activo?.rondaActiva ?? null);
      setFase(activo ? faseDeCierre(activo.estado, activo.rondaActiva, activo.totalHojas) : 'cerrado');
      await cargarResumenDeRondas(inventarioId, activo?.rondaActiva ?? RONDA_MAX);
    } catch (error) {
      // El backend rechaza con mensaje claro (hojas sin finalizar, o ya
      // cerrada): se muestra tal cual, no un "no se pudo" genérico.
      Alert.alert('No se pudo cerrar la ronda', error instanceof Error ? error.message : 'Intenta de nuevo.');
    } finally {
      setCerrandoRonda(false);
    }
  }

  /**
   * LAS DOS DECISIONES DEL AUDITOR, cuando la última ronda ya cerró.
   *
   * Se recarga entero después de cada una: abrir una ronda cambia la ronda
   * activa y el embudo; iniciar el ajuste cambia el ESTADO del inventario, y
   * con él lo que puede hacer el Coordinador en otra pantalla. Tocar solo el
   * estado local dejaría la pantalla diciendo algo que el servidor ya no dice.
   */
  async function ejecutarAccionAuditor(cual: 'ronda' | 'ajuste'): Promise<void> {
    if (inventarioId === null) return;
    setAccionAuditor(cual);
    // Se limpia el motivo anterior ANTES de intentar: dejar el de la vez pasada
    // mientras corre el nuevo intento haría leer un rechazo viejo como si
    // fuera el de ahora.
    setMotivoRechazo(null);
    try {
      if (cual === 'ronda') {
        await repositorioAjuste.abrirRondaExtra(inventarioId);
      } else {
        await repositorioAjuste.iniciarAjuste(inventarioId);
      }
      const activo = await repositorioInventario.activo(sucursalId!);
      setRondaActiva(activo?.rondaActiva ?? null);
      setFase(activo ? faseDeCierre(activo.estado, activo.rondaActiva, activo.totalHojas) : 'cerrado');
      await cargarResumenDeRondas(inventarioId, activo?.rondaActiva ?? RONDA_MAX);
      if (cual === 'ronda') {
        Alert.alert(
          `${ORDINAL[activo?.rondaActiva ?? 0]} conteo abierto`,
          'Las hojas nuevas nacen sin asignar: el coordinador las reparte desde Gestión de hojas.',
        );
      } else {
        Alert.alert(
          'Ajuste final iniciado',
          'Desde ahora los valores los cambias tú, comparando contra el stock. El coordinador ya no puede corregir.',
        );
      }
    } catch (error) {
      // EL MENSAJE DEL SERVIDOR, TAL CUAL Y EN LA TARJETA. Dice qué regla se
      // topó -- "todavía queda una ronda abierta", "el ajuste ya empezó", "no
      // queda nada por recontar" -- y eso es justamente lo que la persona
      // necesita leer dos veces. Va inline y no en un Alert: el aviso tiene
      // que quedar donde está el botón que lo produjo, no detrás de un
      // "Aceptar" que lo borra.
      setMotivoRechazo({
        cual,
        mensaje: error instanceof Error ? error.message : 'No se pudo completar. Revisa la conexión con la tienda.',
      });
    } finally {
      setAccionAuditor(null);
    }
  }

  function confirmarAjuste(): void {
    Alert.alert(
      'Empezar el ajuste final',
      'A partir de ahora el coordinador ya no puede corregir los conteos de este inventario: los valores los cambias tú, viendo el stock. Se puede empezar una sola vez.',
      [
        { text: 'Todavía no', style: 'cancel' },
        { text: 'Empezar el ajuste', onPress: () => void ejecutarAccionAuditor('ajuste') },
      ],
    );
  }

  /**
   * Las rondas MÁS ALLÁ de la 3ra que EXISTEN de verdad: las que el Auditor
   * abrió y ya tienen resumen del servidor.
   *
   * Sale de lo que respondió el backend y no de `rondaActiva`, a propósito: si
   * se dibujaran todas las posiciones hasta la ronda activa, una ronda que se
   * abrió pero todavía no tiene un solo conteo cargado aparecería igual que
   * las demás -- y un paso vacío en el embudo se lee como "acá no cuadró
   * nada", que es una afirmación, no un hueco.
   */
  const rondasExtra = Object.keys(resumenPorRonda)
    .map(Number)
    .filter((ronda) => ronda > RONDA_MAX && resumenPorRonda[ronda] != null)
    .sort((a, b) => a - b);

  /**
   * CUÁNTAS PASADAS CORRIERON de verdad: las que tienen resumen del servidor.
   * No es `RONDA_MAX` ni `rondaActiva`, y la diferencia importa en los dos
   * sentidos -- un inventario que cuadró en la 1ra tuvo UNA pasada, y uno al
   * que el Auditor le abrió un 4to tuvo cuatro.
   */
  const pasadasCorridas = Object.values(resumenPorRonda).filter((r) => r != null).length;

  /**
   * LA RONDA QUE ADMITE CONTEO -- la única que puede estar "en curso".
   *
   * BUG REAL (emulador, inventario 8040 en `ajuste_auditor`): el Paso 3 decía
   * "En curso" con la ronda 3 ya cerrada. `activo().rondaActiva` es
   * `max(numeroConteo)` de las hojas, así que sigue devolviendo 3 mientras el
   * Auditor ajusta -- y `estadoDePaso(3, 3, …)` lo leía como la ronda activa.
   * El comentario del puerto decía "si viene un numero, esa ronda todavia
   * admite conteo": `ajuste_auditor` rompió esa garantía.
   *
   * Se corrige acá y no en el puerto porque es una lectura, no un dato nuevo:
   * solo en la fase `contando` hay una ronda abierta. En las otras tres no se
   * cuenta más, y `null` es exactamente lo que `estadoDePaso` espera para
   * marcar los pasos como cerrados.
   */
  const rondaQueAdmiteConteo = fase === null ? rondaActiva : fase === 'contando' ? rondaActiva : null;

  const totalT1 = items ?? 0;

  // Los 3 pasos leen la MISMA fuente: el resumen del servidor de su ronda.
  // `null` = esa ronda todavía no se abrió, y el paso lo dice con esas palabras.
  const comparativoT1 = comparativoVisible(resumenPorRonda[1] ?? null);
  const comparativoT2 = comparativoVisible(resumenPorRonda[2] ?? null);
  const comparativoT3 = comparativoVisible(resumenPorRonda[3] ?? null);

  // La ronda MÁS AVANZADA que ya tiene datos: es la que dice dónde quedó el
  // ciclo. No se suman las tres -- un ítem que pasó de la 1 a la 2 está en
  // las dos, y sumarlas lo contaría dos veces.
  const ultimoComparativo = comparativoT3
    ? { ronda: 3 as const, datos: comparativoT3 }
    : comparativoT2
      ? { ronda: 2 as const, datos: comparativoT2 }
      : comparativoT1
        ? { ronda: 1 as const, datos: comparativoT1 }
        : null;

  // null cuando todavía no se sabe el tamaño real de hoja del 1er conteo:
  // sin eso no hay con qué calcular cuántas hojas hay ni si la última
  // queda parcial, y no se inventa un tamaño para poder mostrar algo.
  const textoCalculoHojasT1 = tamanoHoja !== null ? textoCalculo(calcularHojas(totalT1, tamanoHoja), tamanoHoja) : null;

  // La sucursal EFECTIVA: para el Auditor, la elegida (o su ficha por default);
  // para el Coordinador, la suya de siempre. Ver sucursalEnFoco.
  const nombreSucursal = esCoordinador
    ? sesion.sucursal?.nombre
    : (sucursales.find((s) => s.id === sucursalId)?.nombre ?? sesion.sucursal?.nombre);

  return (
    <PantallaConTabs
      scrollable
      contentStyle={styles.contenido}
      // Tirar para refrescar, además del foco: la misma salida manual que ya
      // tienen Gestión de hojas y Asistencia.
      refreshControl={
        <RefreshControl refreshing={refrescando} onRefresh={refrescar} colors={[colors.rojo]} tintColor={colors.rojo} />
      }
    >
      <BarraApp
        rotulo={rol === 'auditor' ? 'Auditoría · Ciclo de conteos' : 'Gestión masiva'}
        sede={nombreSucursal}
        // La cantidad de pasadas REAL, no un 3 fijo: el Auditor puede abrir
        // un 4to o un 5to conteo, y el encabezado sería el primer lugar donde
        // se notaría que la app cuenta una historia distinta de la del
        // inventario.
        cifras={
          items
            ? `${nf.format(items)} ítem${items === 1 ? '' : 's'} · ${pasadasCorridas} pasada${pasadasCorridas === 1 ? '' : 's'}`
            : undefined
        }
        onSalir={salir}
      />

      <BandaSync estado="ok" mensaje="Sincronizado con Dynamics" />

      {/* El Auditor elige la sucursal cuyo ciclo mira (el Coordinador está
          atado a la suya y no ve esto). Siempre visible, para cambiarla aunque
          la actual no tenga ciclo. */}
      {rol === 'auditor' ? (
        <SelectorSucursal
          label="Sucursal a auditar"
          sucursales={sucursales}
          sucursalId={sucursalId}
          onElegir={setSucursalElegida}
        />
      ) : null}

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : errorCarga ? (
        <View style={styles.errorCarga}>
          <Text style={styles.errorCargaTexto}>{errorCarga}</Text>
          <Button label="Reintentar" size="sm" onPress={() => setIntentoNumero((n) => n + 1)} />
        </View>
      ) : (
        <>
          <PasoCiclo
            titulo="Paso 1 · 1er Conteo General"
            descripcion="100% del catálogo, comparado contra el stock de Dynamics a medida que se cuenta."
            // MISMA fuente que los pasos 2 y 3: el resumen del servidor de la
            // ronda 1 (sobre TODOS los conteos), no el SQLite local del que mira.
            estado={estadoDePaso(1, rondaQueAdmiteConteo, comparativoT1 != null)}
            // El cálculo de hojas Y, cuando ya hay conteos, el comparativo
            // contra el ERP: cuántos cuadraron y cuántos pasarían al 2do.
            calculo={[textoCalculoHojasT1, comparativoT1?.detalle].filter(Boolean).join(' ')}
            avance={comparativoT1?.avance}
            notaSinDato={
              comparativoT1
                ? undefined
                : 'El 1er conteo todavía no tiene hojas con datos para esta sucursal.'
            }
          />

          <PasoCiclo
            titulo="Paso 2 · 2do Reconteo"
            descripcion="Solo los ítems que no coincidieron con el stock de Dynamics en el 1er conteo."
            estado={estadoDePaso(2, rondaQueAdmiteConteo, comparativoT2 != null)}
            calculo={comparativoT2?.detalle}
            avance={comparativoT2?.avance}
            notaSinDato={
              comparativoT2
                ? undefined
                : 'El 2do conteo todavía no empezó: se abre al cerrar el 1ero, y entra solo con los ítems que no cuadraron.'
            }
          />

          <PasoCiclo
            titulo="Paso 3 · 3er Reconteo"
            // DECÍA "no hay un 4to conteo", y dejó de ser cierto: el Auditor
            // abre los que hagan falta. La frase vieja hacía que el
            // Coordinador cerrara la 3ra creyendo que ese número ya era el
            // definitivo.
            descripcion={`Los ítems que persistieron tras la 2da pasada, auditados directamente${rol === 'auditor' ? ' por ti' : ''}. Al cerrarlo, el auditor decide: otro conteo, o el ajuste final.`}
            estado={estadoDePaso(3, rondaQueAdmiteConteo, comparativoT3 != null)}
            calculo={comparativoT3?.detalle}
            avance={comparativoT3?.avance}
            notaSinDato={
              comparativoT3
                ? undefined
                : 'El 3er conteo todavía no empezó: se abre al cerrar el 2do, y solo si quedan ítems sin cuadrar.'
            }
          />

          {/*
            LAS RONDAS EXTRA. El ciclo automático llega hasta la 3ra; de ahí en
            más las abre el Auditor una por una, así que no se pueden dibujar
            tres pasos fijos y listo. Solo aparecen las que EXISTEN (tienen
            resumen): una ronda vacía dibujada por las dudas sería un paso que
            nadie abrió.
          */}
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

          {/*
            LAS DOS DECISIONES DEL AUDITOR. Aparecen solo con la última ronda
            cerrada y el ajuste sin empezar -- que es exactamente la ventana en
            la que el Coordinador todavía corrige. Antes de eso no hay nada que
            decidir; después, ya se decidió.
          */}
          {rol === 'auditor' && fase !== null && elAuditorPuedeDecidir(fase) ? (
            <View style={styles.tarjeta}>
              <View style={styles.tarjetaCabecera}>
                <Text style={styles.tarjetaTitulo}>¿Qué sigue con este conteo?</Text>
                <Badge label="Te toca decidir" variant="proceso" />
              </View>
              <Text style={styles.tarjetaTexto}>
                Cuando cierre la última ronda, el inventario te espera: puedes mandar otra pasada de conteo, o fijar tú
                mismo los valores comparando contra el stock. Mientras no empieces el ajuste, el coordinador todavía
                puede corregir lo que cargaron los contadores.
              </Text>
              {/* LA PRECONDICIÓN, dicha en vez de adivinada. Desde el teléfono
                  no se puede saber si la última ronda ya cerró (ver
                  dominio/ajuste-final.ts#faseDeCierre), así que se avisa acá y
                  el servidor es el que corta -- con su mensaje, que se muestra
                  tal cual. Antes esto era un candado, y como nunca se abría, el
                  Auditor no tenía ningún botón para decidir. */}
              <Text style={styles.notaPrecondicion}>
                Las dos necesitan que la última ronda esté cerrada. Si todavía está abierta, te lo va a decir.
              </Text>
              <Button
                label={accionAuditor === 'ronda' ? 'Abriendo el conteo…' : `Abrir el ${ORDINAL[(rondaActiva ?? RONDA_MAX) + 1]} conteo`}
                icon={PlusCircle}
                variant="outline"
                onPress={() => void ejecutarAccionAuditor('ronda')}
                disabled={accionAuditor !== null}
                loading={accionAuditor === 'ronda'}
              />
              {/* El motivo va PEGADO al botón que falló, no arriba de la
                  tarjeta: con dos botones, un aviso suelto no dice de cuál de
                  los dos habla. */}
              {motivoRechazo?.cual === 'ronda' ? <AvisoMotivo mensaje={motivoRechazo.mensaje} /> : null}
              <Button
                label={accionAuditor === 'ajuste' ? 'Iniciando el ajuste…' : 'Empezar el ajuste final'}
                icon={Scale}
                onPress={confirmarAjuste}
                disabled={accionAuditor !== null}
                loading={accionAuditor === 'ajuste'}
              />
              {motivoRechazo?.cual === 'ajuste' ? <AvisoMotivo mensaje={motivoRechazo.mensaje} /> : null}
            </View>
          ) : null}

          {/*
            EL ACCESO AL AJUSTE, siempre que el Auditor esté mirando un
            inventario -- no solo cuando esta pantalla logró detectar que el
            ajuste ya empezó.
            BUG REAL (emulador, inventario 8040): el inventario estaba en
            `ajuste_auditor` y acá no aparecía NINGÚN botón, ni para abrir otra
            ronda ni para ajustar. Al ajuste solo se llegaba por el acceso de
            Inicio -- desde la pantalla que dice "el auditor decide" no había
            forma de decidir nada.

            Ahora el acceso no se condiciona a la fase: la fase solo cambia lo
            que el texto AFIRMA. Si la pantalla se equivoca sobre la fase, el
            peor caso es un texto de más; con el acceso condicionado, el peor
            caso era quedarse sin salida.
          */}
          {rol === 'auditor' && inventarioId !== null && fase !== 'cerrado' ? (
            <View style={styles.tarjeta}>
              <View style={styles.tarjetaCabecera}>
                <Text style={styles.tarjetaTitulo}>
                  {fase === 'ajuste' ? 'Ajuste final en curso' : 'Ajuste final del conteo'}
                </Text>
                {fase === 'ajuste' ? <Badge label="Solo tú" variant="proceso" /> : null}
              </View>
              <Text style={styles.tarjetaTexto}>
                {fase === 'ajuste'
                  ? 'El coordinador ya no puede corregir este inventario. Fija los valores definitivos y cierra el ajuste para que pase a la liquidación.'
                  : 'Ahí fijas los valores definitivos comparando contra el stock del ERP. La pantalla te dice si el ajuste ya empezó o todavía no.'}
              </Text>
              <Button
                label={fase === 'ajuste' ? 'Ir al ajuste final' : 'Ver el ajuste final'}
                icon={Scale}
                variant={fase === 'ajuste' ? 'primary' : 'outline'}
                onPress={() => router.push('/auditor/ajuste')}
              />
            </View>
          ) : null}

          {esCoordinador && resumenActivo && rondaActiva !== null ? (
            <View style={styles.tarjeta}>
              <View style={styles.tarjetaCabecera}>
                <Text style={styles.tarjetaTitulo}>Cerrar el {ORDINAL[rondaActiva]} conteo</Text>
                <Badge
                  label={resumenActivo.sePuedeCerrar ? 'Listo para cerrar' : 'Faltan hojas'}
                  variant={resumenActivo.sePuedeCerrar ? 'ok' : 'espera'}
                />
              </View>

              {/* El embudo REAL de la ronda activa, del backend. Es lo que hace
                  de cerrar una decisión y no un trámite: se ve el número ANTES
                  de apretar. */}
              <View style={styles.embudoResumen}>
                <FilaResumen etiqueta="Cuadraron contra Dynamics" valor={`${formatoMiles(resumenActivo.cuadrados)} (${formatoPct(resumenActivo.porcentajeCuadrado)}%)`} tono="ok" />
                <FilaResumen etiqueta={etiquetaARecontar(rondaActiva, resumenActivo.aRecontar)} valor={formatoMiles(resumenActivo.aRecontar)} tono="falta" />
                {resumenActivo.sinContar > 0 ? <FilaResumen etiqueta="Sin contar todavía" valor={formatoMiles(resumenActivo.sinContar)} /> : null}
                {resumenActivo.sinDatoErp > 0 ? <FilaResumen etiqueta="Sin stock del ERP (no se auditan)" valor={formatoMiles(resumenActivo.sinDatoErp)} /> : null}
              </View>

              <Text style={styles.tarjetaTexto}>{textoCierreExplicacion(rondaActiva, resumenActivo.aRecontar)}</Text>

              {/* El motivo del bloqueo, a la vista: qué hojas faltan finalizar.
                  Un botón gris sin decir por qué obliga a adivinar. */}
              {!resumenActivo.sePuedeCerrar ? (
                <View style={styles.bloqueoAviso}>
                  <AlertTriangle size={16} color={colors.proceso} />
                  <Text style={styles.bloqueoTexto}>
                    {pluralizar(resumenActivo.hojasSinFinalizar.length, 'Queda', 'Quedan')}{' '}
                    {formatoMiles(resumenActivo.hojasSinFinalizar.length)}{' '}
                    {pluralizar(resumenActivo.hojasSinFinalizar.length, 'hoja', 'hojas')} sin finalizar:{' '}
                    {resumenActivo.hojasSinFinalizar.slice(0, 4).map((h) => `#${h.numero}`).join(', ')}
                    {resumenActivo.hojasSinFinalizar.length > 4 ? ` y ${resumenActivo.hojasSinFinalizar.length - 4} más` : ''}. Una
                    hoja sin finalizar es una hoja que alguien todavía está contando.
                  </Text>
                </View>
              ) : null}

              <Button
                label={
                  resumenActivo.sePuedeCerrar
                    ? textoBotonCierre(rondaActiva, resumenActivo.aRecontar, formatoMiles)
                    : 'Termina las hojas para poder cerrar'
                }
                icon={Lock}
                onPress={cerrarRondaAhora}
                disabled={!resumenActivo.sePuedeCerrar}
                loading={cerrandoRonda}
              />
            </View>
          ) : null}

          {/*
            El cierre del embudo: dónde quedó parado el ciclo. Sale de la
            ÚLTIMA ronda que tiene datos -- no de una suma de las tres, que
            contaría dos veces a los ítems que pasaron de una a otra.

            SOLO Coordinador (pedido del cliente): al Auditor no le aporta y le
            come espacio -- su detalle repite el del Paso más avanzado, y abajo
            tiene el acceso directo a la matriz de auditoría. Al renderizar
            `null` no queda hueco: el `gap` del contenedor no reserva espacio
            para un hijo ausente.
          */}
          {esCoordinador ? (
            <View style={styles.resumen}>
              {ultimoComparativo ? (
                <Text style={styles.tarjetaTexto}>
                  Al cierre del {ORDINAL[ultimoComparativo.ronda]} conteo: {ultimoComparativo.datos.detalle}
                  {ultimoComparativo.datos.avance.pct >= 100
                    ? ' El ciclo puede cerrarse: no queda nada por recontar.'
                    : ` Los que no cuadren tras el ${ORDINAL[RONDA_MAX]} pasan al auditor, que decide si manda otra pasada o los ajusta él.`}
                </Text>
              ) : (
                <Text style={styles.tarjetaTexto}>
                  El resultado se arma a medida que se cuenta: todavía no hay ningún conteo cargado en este
                  inventario.
                </Text>
              )}
            </View>
          ) : null}

          {rol === 'auditor' ? (
            <Pressable
              style={styles.ctaAuditoria}
              onPress={() => router.push('/auditor/auditoria')}
              accessibilityRole="button"
            >
              <FileText size={17} color={colors.blanco} />
              <Text style={styles.ctaAuditoriaTexto}>Ver el comparativo de los conteos en auditoría</Text>
              <ArrowRightCircle size={17} color={colors.dorado} />
            </Pressable>
          ) : null}
        </>
      )}
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md + 3 },
  cargando: { marginTop: spacing.xxxl },
  errorCarga: { marginTop: spacing.xxxl, gap: spacing.md, alignItems: 'flex-start' },
  errorCargaTexto: { fontSize: 13, color: colors.gris, fontFamily: fonts.regular },

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
  /** La precondición de las acciones del Auditor: aclaración, no alarma. */
  notaPrecondicion: { fontSize: 11.5, lineHeight: 16, color: colors.grisClaro, fontFamily: fonts.regular },
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
  avisoMotivoTexto: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.tinta, fontFamily: fonts.regular },
  tarjetaTexto: { fontSize: 12.5, lineHeight: 18, color: colors.gris, fontFamily: fonts.regular },

  embudoBarra: { height: 8, borderRadius: radius.full, backgroundColor: colors.procesoSuave, overflow: 'hidden' },
  embudoOk: { height: '100%', borderRadius: radius.full, backgroundColor: colors.ok },
  embudoFila: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  embudoTexto: { fontSize: 12.5, fontFamily: fonts.semibold },
  notaSinDato: { fontSize: 12, lineHeight: 17, color: colors.grisClaro, fontFamily: fonts.regular, fontStyle: 'italic' },

  resumen: {
    gap: spacing.sm,
    padding: 15,
    backgroundColor: colors.campo,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: 13,
  },

  embudoResumen: { gap: 6 },
  filaResumen: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  filaResumenEtiqueta: { flex: 1, fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
  filaResumenValor: { fontSize: 13.5, color: colors.tinta, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  valorOk: { color: colors.ok },
  valorFalta: { color: colors.falta },

  bloqueoAviso: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 11,
    borderRadius: radius.md,
    backgroundColor: colors.procesoSuave,
  },
  bloqueoTexto: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.proceso, fontFamily: fonts.medium },
  ctaAuditoria: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 46,
    borderRadius: radius.sm,
    backgroundColor: colors.rojo,
  },
  ctaAuditoriaTexto: { flex: 1, textAlign: 'center', fontSize: 14.5, color: colors.blanco, fontFamily: fonts.bold },
});
