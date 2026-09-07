import { router } from 'expo-router';
import { AlertTriangle, ArrowRightCircle, Check, FileText, Lock } from 'lucide-react-native';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { repositorioHistorial, repositorioInventario } from '../../lib/contenedor';
import { comparativoDeRonda } from '../../lib/dominio/comparativo-ronda';
import { inventarioDelCiclo } from '../../lib/dominio/inventario-del-ciclo';
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
import { type Rol, type TamanoHoja } from '../../lib/dominio/tipos';
import type { ResumenRonda } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, radius, spacing } from '../../lib/theme';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';
import { BandaSync, Badge, BarraApp, Button, formatoMiles, formatoPct, type BadgeVariant } from '../ui';

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
  const esCoordinador = rol === 'coordinador';

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

  const cargarResumenDeRondas = useCallback(async (invId: number): Promise<void> => {
    const rondas = [1, 2, 3];
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

  useEffect(() => {
    if (!sesion) return;
    let vigente = true;

    async function cargar(): Promise<void> {
      // `activo()` filtra `estado: en_curso`: para un inventario YA cerrado
      // devuelve null. Ahí el ciclo es el ÚLTIMO cerrado de la sucursal, que
      // sale del historial. Sin este fallback la pantalla quedaba en blanco
      // sobre un ciclo que en realidad terminó con sus 3 pasadas contadas.
      const activo = await repositorioInventario.activo(sesion!.sucursal!.id);
      const historial = activo
        ? []
        : (await repositorioHistorial.listar({ sucursalId: sesion!.sucursal!.id })).inventarios;
      if (!vigente) return;

      const delCiclo = inventarioDelCiclo(activo, historial);
      setItems(delCiclo?.items ?? null);
      setTamanoHoja(delCiclo?.tamanoHoja ?? null);
      setInventarioId(delCiclo?.inventarioId ?? null);
      setRondaActiva(delCiclo?.rondaActiva ?? null);
      if (!delCiclo) {
        setResumenPorRonda({});
        setCargando(false);
        return;
      }

      // El embudo de las 3 rondas, del servidor. Lo ven los DOS roles: es el
      // ciclo del inventario, no una herramienta de cierre. El preview del
      // cierre sale de este mismo objeto (resumenPorRonda[rondaActiva]).
      await cargarResumenDeRondas(delCiclo.inventarioId);
      if (!vigente) return;
      setCargando(false);
    }

    cargar();
    return () => {
      vigente = false;
    };
  }, [sesion, cargarResumenDeRondas]);

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
      const activo = await repositorioInventario.activo(sesion!.sucursal!.id);
      setRondaActiva(activo?.rondaActiva ?? null);
      await cargarResumenDeRondas(inventarioId);
    } catch (error) {
      // El backend rechaza con mensaje claro (hojas sin finalizar, o ya
      // cerrada): se muestra tal cual, no un "no se pudo" genérico.
      Alert.alert('No se pudo cerrar la ronda', error instanceof Error ? error.message : 'Intenta de nuevo.');
    } finally {
      setCerrandoRonda(false);
    }
  }

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

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <BarraApp
        rotulo={rol === 'auditor' ? 'Auditoría · Ciclo de conteos' : 'Gestión masiva'}
        sede={sesion.sucursal!.nombre}
        cifras={items ? `${nf.format(items)} ítem${items === 1 ? '' : 's'} · 3 pasadas de cierre` : undefined}
        onSalir={salir}
      />

      <BandaSync estado="ok" mensaje="Sincronizado con Dynamics" />

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : (
        <>
          <PasoCiclo
            titulo="Paso 1 · 1er Conteo General"
            descripcion="100% del catálogo, comparado contra el stock de Dynamics a medida que se cuenta."
            // MISMA fuente que los pasos 2 y 3: el resumen del servidor de la
            // ronda 1 (sobre TODOS los conteos), no el SQLite local del que mira.
            estado={estadoDePaso(1, rondaActiva, comparativoT1 != null)}
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
            estado={estadoDePaso(2, rondaActiva, comparativoT2 != null)}
            calculo={comparativoT2?.detalle}
            avance={comparativoT2?.avance}
            notaSinDato={
              comparativoT2
                ? undefined
                : 'El 2do conteo todavía no empezó: se abre al cerrar el 1ero, y entra solo con los ítems que no cuadraron.'
            }
          />

          <PasoCiclo
            titulo="Paso 3 · 3er Reconteo Definitivo"
            descripcion={`Los ítems que persistieron tras la 2da pasada, auditados directamente${rol === 'auditor' ? ' por ti' : ''}. Las cantidades resultantes quedan fijas para la liquidación — no hay un 4to conteo.`}
            estado={estadoDePaso(3, rondaActiva, comparativoT3 != null)}
            calculo={comparativoT3?.detalle}
            avance={comparativoT3?.avance}
            notaSinDato={
              comparativoT3
                ? undefined
                : 'El 3er conteo todavía no empezó: se abre al cerrar el 2do, y solo si quedan ítems sin cuadrar.'
            }
          />

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
                    Quedan {formatoMiles(resumenActivo.hojasSinFinalizar.length)} hoja
                    {resumenActivo.hojasSinFinalizar.length === 1 ? '' : 's'} sin finalizar:{' '}
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
          */}
          <View style={styles.resumen}>
            {ultimoComparativo ? (
              <Text style={styles.tarjetaTexto}>
                Al cierre del {ORDINAL[ultimoComparativo.ronda]} conteo: {ultimoComparativo.datos.detalle}
                {ultimoComparativo.datos.avance.pct >= 100
                  ? ' El ciclo puede cerrarse: no queda nada por recontar.'
                  : ` Los que no cuadren tras el ${ORDINAL[RONDA_MAX]} quedan como diferencia definitiva para la liquidación.`}
              </Text>
            ) : (
              <Text style={styles.tarjetaTexto}>
                El resultado final de las 3 pasadas se arma a medida que se cuenta: todavía no hay ningún conteo
                cargado en este inventario.
              </Text>
            )}
          </View>

          {rol === 'auditor' ? (
            <Pressable
              style={styles.ctaAuditoria}
              onPress={() => router.push('/auditor/auditoria')}
              accessibilityRole="button"
            >
              <FileText size={17} color={colors.blanco} />
              <Text style={styles.ctaAuditoriaTexto}>Ver comparativo de los 3 conteos en auditoría</Text>
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
