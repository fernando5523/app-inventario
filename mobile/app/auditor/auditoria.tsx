import { router, useFocusEffect } from 'expo-router';
import { BarChart3 } from 'lucide-react-native';
import { useCallback, useState, type JSX } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PantallaConTabs } from '../../components/navegacion/PantallaConTabs';
import {
  BandaSync,
  BarraApp,
  ChipsFiltro,
  EmptyState,
  TarjetaItemAuditoria,
  formatoMoneda as formatoNumeroMoneda,
  type OpcionChip,
} from '../../components/ui';
import { repositorioAuditoria, repositorioInventario } from '../../lib/contenedor';
import { diferenciaValor, veredicto } from '../../lib/dominio/auditoria';
import type { ItemAuditoria, VeredictoAuditoria } from '../../lib/dominio/tipos';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, radius } from '../../lib/theme';

type FiltroId = 'todos' | VeredictoAuditoria;

const FILTROS: { id: FiltroId; etiqueta: string }[] = [
  { id: 'todos', etiqueta: 'Todos' },
  { id: 'cuadrado', etiqueta: 'Cuadrados' },
  { id: 'falta', etiqueta: 'Faltante' },
  { id: 'empresa', etiqueta: 'Empresa' },
];

function formatoMoneda(valor: number): string {
  const signo = valor < 0 ? '-' : '+';
  return `${signo}S/ ${formatoNumeroMoneda(Math.abs(valor))}`;
}

/**
 * Panel de auditoría (mobile/design/auditoria.html) — matriz comparativa
 * ERP vs los 3 conteos. Esta pantalla SÍ muestra cifras del ERP a
 * propósito: el conteo ciego aplica a quien CUENTA (app/conteo/contar.tsx),
 * no a quien audita — el Auditor existe justamente para comparar contra
 * Dynamics.
 */
export default function AuditoriaScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [items, setItems] = useState<ItemAuditoria[]>([]);
  const [filtro, setFiltro] = useState<FiltroId>('todos');

  // useFocusEffect, no useEffect: los tabs quedan montados una vez
  // visitados — sin esto, la matriz sigue mostrando datos viejos si el
  // ciclo de conteos avanzó mientras el Auditor estaba en otra pestaña.
  useFocusEffect(
    useCallback(() => {
      if (!sesion) return;
      let vigente = true;

      async function cargar(): Promise<void> {
        const activo = await repositorioInventario.activo(sesion!.sucursal.id);
        if (!vigente) return;
        if (!activo) {
          setCargando(false);
          return;
        }
        const matriz = await repositorioAuditoria.matriz(activo.inventarioId);
        if (vigente) {
          setItems(matriz);
          setCargando(false);
        }
      }

      cargar();
      return () => {
        vigente = false;
      };
    }, [sesion]),
  );

  if (!sesion) return <View />;

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  function irALacrado(): void {
    // El destino correcto para el Auditor es lacrado, no liquidación: en
    // auditoria.html (maqueta) el botón decía "Generar liquidación", pero
    // esa pantalla es del Coordinador — el Auditor cierra el ciclo con
    // aprobación y lacrado (app/auditor/lacrado.tsx).
    router.push('/auditor/lacrado');
  }

  const veredictos = items.map((it) => ({ item: it, v: veredicto(it) }));
  const cuadrados = veredictos.filter((x) => x.v === 'cuadrado').length;
  const conDiferencia = items.length - cuadrados;

  const opciones: OpcionChip[] = FILTROS.map((f) => ({
    id: f.id,
    etiqueta: f.etiqueta,
    contador: f.id === 'todos' ? items.length : veredictos.filter((x) => x.v === f.id).length,
  }));

  const visibles = filtro === 'todos' ? items : items.filter((it) => veredicto(it) === filtro);

  // Neto SOLO de lo que se auditó de verdad (ver auditoria-memoria.ts):
  // no hay stock de Dynamics real para los 8.000 ítems, así que no se
  // muestra el "-S/2,200 / +S/310" de la maqueta como si fuera el
  // resultado completo del mes — sería inventar un dato.
  const faltanteNeto = items.filter((it) => veredicto(it) === 'falta' && diferenciaValor(it) < 0).reduce((a, it) => a + diferenciaValor(it), 0);
  const sobranteNeto = items.filter((it) => veredicto(it) === 'falta' && diferenciaValor(it) > 0).reduce((a, it) => a + diferenciaValor(it), 0);
  const asumidoEmpresa = items.filter((it) => veredicto(it) === 'empresa').reduce((a, it) => a + diferenciaValor(it), 0);

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      <BarraApp
        rotulo="Auditoría · Panel de auditoría"
        sede={sesion.sucursal.nombre}
        cifras={cargando ? undefined : `${items.length} ítems auditados · ${conDiferencia} con diferencia`}
        onSalir={salir}
      />

      <BandaSync estado="ok" mensaje="Sincronizado" />

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="Todavía no hay nada para auditar"
          subtitle="No hay un inventario en curso para esta sucursal, o el ciclo de conteos no cerró ningún ítem todavía."
        />
      ) : (
        <>
          <View style={styles.tarjetaResumen}>
            <Text style={styles.resumenTitulo}>Resultado (ítems auditados)</Text>
            <View style={styles.resumenFila}>
              <Text style={styles.resumenEtiqueta}>Cuadrado</Text>
              <Text style={[styles.resumenValor, { color: colors.ok }]}>
                {cuadrados} <Text style={styles.resumenPct}>de {items.length}</Text>
              </Text>
            </View>
            <View style={styles.resumenFila}>
              <Text style={styles.resumenEtiqueta}>Faltante neto</Text>
              <Text style={[styles.resumenValor, faltanteNeto !== 0 && { color: colors.proceso }]}>{formatoMoneda(faltanteNeto)}</Text>
            </View>
            <View style={styles.resumenFila}>
              <Text style={styles.resumenEtiqueta}>Sobrante neto</Text>
              <Text style={[styles.resumenValor, sobranteNeto !== 0 && { color: colors.ok }]}>{formatoMoneda(sobranteNeto)}</Text>
            </View>
            {asumidoEmpresa !== 0 ? (
              <View style={styles.resumenFila}>
                <Text style={styles.resumenEtiqueta}>Asumido por la empresa</Text>
                <Text style={styles.resumenValor}>{formatoMoneda(asumidoEmpresa)}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.seccion}>
            <Text style={styles.seccionTitulo}>Matriz comparativa</Text>
            <Text style={styles.seccionTotal}>{conDiferencia} ítems con diferencia</Text>
          </View>

          <ChipsFiltro opciones={opciones} activo={filtro} onCambiar={(id) => setFiltro(id as FiltroId)} />

          <View style={styles.lista}>
            {visibles.map((item) => (
              <TarjetaItemAuditoria key={item.productoId} item={item} />
            ))}
          </View>

          <View style={styles.pieLista}>
            <Text style={styles.pieTexto}>
              Mostrando {visibles.length} de <Text style={styles.pieFuerte}>{items.length} ítems auditados</Text> · {conDiferencia} con
              diferencia en total
            </Text>
          </View>

          <Pressable style={styles.accion} onPress={irALacrado}>
            <Text style={styles.accionTexto}>Ir a aprobación y lacrado</Text>
          </Pressable>
        </>
      )}
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: 14, paddingTop: 8, gap: 16 },
  cargando: { marginTop: 24 },
  tarjetaResumen: { padding: 15, gap: 10, borderRadius: 13, borderWidth: 1, borderColor: colors.borde, backgroundColor: colors.campo },
  resumenTitulo: { fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
  resumenFila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  resumenEtiqueta: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
  resumenValor: { fontSize: 16, color: colors.tinta, fontFamily: fonts.bold },
  resumenPct: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.medium },
  seccion: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  seccionTitulo: { fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gris, fontFamily: fonts.semibold },
  seccionTotal: { fontSize: 11.5, color: colors.grisClaro, fontFamily: fonts.regular },
  lista: { gap: 10 },
  pieLista: { padding: 12, borderRadius: 11, backgroundColor: colors.esperaSuave },
  pieTexto: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
  pieFuerte: { color: colors.tinta, fontFamily: fonts.bold },
  accion: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.rojo },
  accionTexto: { fontSize: 15, color: colors.blanco, fontFamily: fonts.bold },
});
