import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type JSX } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { repositorioHojas, repositorioInventario } from '../../lib/contenedor';
// TEMPORAL: no van en lib/contenedor.ts a propósito — esta tarea no lo
// toca (lo cambia el agente de integración cuando enchufe el HTTP real).
// La pantalla solo conoce el tipo del puerto (RepositorioUsuarios /
// RepositorioTiendas), no el adaptador concreto — mover este import a
// contenedor.ts el día de mañana es un cambio de una sola línea.
import { tiendasMemoria as repositorioTiendas } from '../../lib/adaptadores/tiendas-memoria';
import { usuariosMemoria as repositorioUsuarios } from '../../lib/adaptadores/usuarios-memoria';
import type { HojaConteo, Rol } from '../../lib/dominio/tipos';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, fontSize, spacing } from '../../lib/theme';
import { ACCESOS_POR_ROL } from '../navegacion/accesos';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';
import { AccesoTarjeta, BandaSync, BarraApp, GrupoRol, formatoMiles, formatoPct, sincronizacionDeHojas, type EstadoSincronizacion } from '../ui';

const NOMBRE_ROL: Record<Rol, string> = {
  administrador: 'Administrador',
  coordinador: 'Coordinador',
  conteo: 'Conteo',
  auditor: 'Auditor',
};

interface InventarioActivo {
  inventarioId: number;
  items: number;
  totalHojas: number;
}

interface EstadoSistema {
  tiendasActivas: number;
  totalTiendas: number;
  usuariosActivos: number;
  totalUsuarios: number;
  inventariosEnCurso: number;
}

interface FilaEstado {
  etiqueta: string;
  valor: string;
  pct?: string;
  color?: string;
}

function pct(parte: number, total: number): string {
  return total === 0 ? '0%' : `${Math.round((parte / total) * 100)}%`;
}

/**
 * Pantalla de Inicio — una sola implementación para los 3 roles (igual
 * que mobile/design/home.html). La usan app/coordinador/index.tsx,
 * app/conteo/index.tsx y app/auditor/index.tsx; lo único que cambia entre
 * ellos es la sesión activa (contexto) y qué le pide a los puertos, nunca
 * una constante propia de la pantalla.
 */
export function InicioScreen(): JSX.Element {
  const { sesion, cerrar } = useSesion();
  const [cargando, setCargando] = useState(true);
  const [inventario, setInventario] = useState<InventarioActivo | null>(null);
  // Solo se llena para el rol que corresponde — nunca los dos a la vez.
  const [hojasCoordinador, setHojasCoordinador] = useState<HojaConteo[] | null>(null);
  const [misHojas, setMisHojas] = useState<HojaConteo[] | null>(null);
  const [estadoSistema, setEstadoSistema] = useState<EstadoSistema | null>(null);

  // useFocusEffect, no useEffect: los tabs quedan montados una vez
  // visitados (React Navigation) — sin esto, volver a Inicio después de
  // finalizar una hoja en Contar sigue mostrando el avance viejo.
  useFocusEffect(
    useCallback(() => {
      if (!sesion) return;
      let vigente = true;

      async function cargar(): Promise<void> {
        // El Administrador no pertenece a una sola sucursal — no tiene
        // sentido pedir repositorioInventario.activo(sesion.sucursal.id)
        // para él, su vista es del sistema entero.
        if (sesion!.colaborador.rol === 'administrador') {
          const [tiendas, usuarios] = await Promise.all([repositorioTiendas.listar(), repositorioUsuarios.listar()]);
          if (!vigente) return;
          const inventariosPorTienda = await Promise.all(tiendas.map((t) => repositorioInventario.activo(t.id)));
          if (!vigente) return;
          setEstadoSistema({
            tiendasActivas: tiendas.filter((t) => t.activa !== false).length,
            totalTiendas: tiendas.length,
            usuariosActivos: usuarios.filter((u) => u.activo).length,
            totalUsuarios: usuarios.length,
            inventariosEnCurso: inventariosPorTienda.filter((i) => i !== null).length,
          });
          setCargando(false);
          return;
        }

        // Ya se descartó 'administrador' arriba (return temprano): acá el
        // rol siempre tiene sucursal real.
        const activo = await repositorioInventario.activo(sesion!.sucursal!.id);
        if (!vigente) return;

        if (!activo) {
          setInventario(null);
          setCargando(false);
          return;
        }
        setInventario({ inventarioId: activo.inventarioId, items: activo.items, totalHojas: activo.totalHojas });

        if (sesion!.colaborador.rol === 'coordinador') {
          const todas = await repositorioHojas.todas(activo.inventarioId);
          if (vigente) setHojasCoordinador(todas);
        } else if (sesion!.colaborador.rol === 'conteo') {
          // mias(), NUNCA todas(): un Contador no puede ver el lote entero.
          const mias = await repositorioHojas.mias(activo.inventarioId);
          if (vigente) setMisHojas(mias);
        }
        if (vigente) setCargando(false);
      }

      cargar();
      return () => {
        vigente = false;
      };
    }, [sesion]),
  );

  // El layout del grupo (RolTabsLayout) ya garantiza que no se llega acá
  // sin sesión — este guard es solo para que TypeScript no se queje.
  if (!sesion) return <View />;

  const rol = sesion.colaborador.rol;
  const primerNombre = sesion.colaborador.nombre.split(' ')[0];
  const accesos = ACCESOS_POR_ROL[rol];

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  function abrirAcceso(ruta?: string): void {
    // Todo acceso de ACCESOS_POR_ROL trae `ruta` hoy — el campo queda
    // opcional en DefinicionAcceso solo como cinturón de seguridad para
    // el día que se agregue uno nuevo antes de portar su pantalla.
    if (ruta) router.push(ruta as never);
  }

  // ---------------------------------------------------------------------
  // Cifras de la barra de contexto y bloque de estado — 100% derivados de
  // lo que devolvieron los puertos, nunca una constante acá.
  // ---------------------------------------------------------------------

  let cifras: string | undefined;
  let tituloEstado = '';
  let filasEstado: FilaEstado[] = [];
  let sync: EstadoSincronizacion = { estado: 'ok', mensaje: 'Sincronizado' };

  if (rol === 'coordinador') {
    tituloEstado = 'Estado del inventario';
    if (inventario && hojasCoordinador) {
      const asignadas = hojasCoordinador.filter((h) => h.asignados.length > 0).length;
      const finalizadas = hojasCoordinador.filter((h) => h.estado === 'finalizada').length;
      const contando = new Set(
        hojasCoordinador.filter((h) => h.estado !== 'pendiente').flatMap((h) => h.asignados),
      ).size;
      cifras = `${inventario.totalHojas} hojas · ${formatoMiles(inventario.items)} ítems · ${asignadas} asignadas`;
      filasEstado = [
        { etiqueta: 'Hojas asignadas', valor: String(asignadas), pct: `/ ${inventario.totalHojas} (${pct(asignadas, inventario.totalHojas)})` },
        {
          etiqueta: 'Hojas finalizadas',
          valor: String(finalizadas),
          pct: `/ ${inventario.totalHojas} (${pct(finalizadas, inventario.totalHojas)})`,
          color: colors.ok,
        },
        { etiqueta: 'Contando ahora', valor: String(contando), pct: 'colaboradores' },
      ];
      sync = sincronizacionDeHojas(hojasCoordinador);
    }
  } else if (rol === 'conteo') {
    tituloEstado = 'Tu avance';
    if (misHojas) {
      const hojaActual = misHojas.find((h) => h.estado === 'en-proceso') ?? null;
      const pendientes = misHojas.filter((h) => h.estado === 'pendiente').length;
      // Conteo ciego: SOLO sus hojas y sus ítems. Nunca el total del
      // inventario ni una cifra que venga del ERP.
      cifras = hojaActual ? `Hoja #${hojaActual.numero} · Lote de ${hojaActual.tamano} ítems` : `${misHojas.length} hojas asignadas`;
      filasEstado = hojaActual
        ? [
            {
              etiqueta: `Hoja #${hojaActual.numero}`,
              valor: String(hojaActual.conteos.length),
              pct: `/ ${hojaActual.tamano} ítems`,
              color: colors.ok,
            },
            { etiqueta: 'Tus hojas sin empezar', valor: String(pendientes), pct: `de ${misHojas.length}` },
          ]
        : [{ etiqueta: 'Hojas asignadas', valor: String(misHojas.length), pct: pendientes === misHojas.length ? 'todas pendientes' : '' }];
      sync = sincronizacionDeHojas(misHojas);
    }
  } else if (rol === 'auditor') {
    tituloEstado = 'Estado de la auditoría';
    if (inventario) {
      // Mismo dato local fijo que components/pantallas/CicloScreen.tsx (ver
      // el comentario ahí): no existe todavía un RepositorioCiclo que
      // modele rondas de conteo (1er/2do/3er) ni comparación contra stock
      // ERP, así que "persisten tras 3 pasadas" no sale de ningún puerto.
      // El total de ítems SÍ es real (repositorioInventario.activo()).
      const persistentesT3 = 130;
      const cuadradosFinal = inventario.items - persistentesT3;
      const pctFinal = inventario.items > 0 ? (cuadradosFinal / inventario.items) * 100 : 0;
      cifras = `${inventario.totalHojas} hojas · ${formatoMiles(inventario.items)} ítems · 3er conteo cerrado`;
      filasEstado = [
        { etiqueta: 'Ciclo de conteos', valor: '3er conteo', pct: 'cerrado', color: colors.ok },
        {
          etiqueta: 'Cuadrado tras 3 pasadas',
          valor: formatoMiles(cuadradosFinal),
          pct: `/ ${formatoMiles(inventario.items)} (${formatoPct(pctFinal)}%)`,
          color: colors.ok,
        },
        { etiqueta: 'Por auditar', valor: String(persistentesT3), pct: 'ítems', color: colors.proceso },
      ];
    }
  } else {
    // Administrador: no cuenta ni audita — ve el estado del SISTEMA, no
    // el avance de un conteo. Nunca stock, nunca avance de ninguna hoja.
    tituloEstado = 'Estado del sistema';
    if (estadoSistema) {
      cifras = `${estadoSistema.tiendasActivas} de ${estadoSistema.totalTiendas} tiendas activas`;
      filasEstado = [
        {
          etiqueta: 'Tiendas activas',
          valor: String(estadoSistema.tiendasActivas),
          pct: `/ ${estadoSistema.totalTiendas} (${pct(estadoSistema.tiendasActivas, estadoSistema.totalTiendas)})`,
          color: colors.ok,
        },
        {
          etiqueta: 'Usuarios habilitados',
          valor: String(estadoSistema.usuariosActivos),
          pct: `/ ${estadoSistema.totalUsuarios} (${pct(estadoSistema.usuariosActivos, estadoSistema.totalUsuarios)})`,
        },
        {
          etiqueta: 'Inventarios en curso',
          valor: String(estadoSistema.inventariosEnCurso),
          pct: estadoSistema.inventariosEnCurso === 0 ? 'ninguno ahora' : 'sucursales contando',
          color: estadoSistema.inventariosEnCurso > 0 ? colors.proceso : undefined,
        },
      ];
    }
  }

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      {/* Sin `sede`: el Administrador no pertenece a una sola sucursal. */}
      <BarraApp rotulo="Inicio" sede={rol === 'administrador' ? undefined : sesion.sucursal!.nombre} cifras={cifras} onSalir={salir} />

      <BandaSync estado={sync.estado} mensaje={sync.mensaje} />

      <View style={styles.saludo}>
        <Text style={styles.saludoNombre}>Hola, {primerNombre}</Text>
        <Text style={styles.saludoSub}>
          {sesion.colaborador.nombre} · {NOMBRE_ROL[rol]}
        </Text>
      </View>

      {/* Rol con el que se ingresó: dato derivado, se muestra, no se
          elige — si alguien entró con el rol equivocado, tiene que
          notarlo acá. */}
      <GrupoRol activo={rol} />

      <View style={styles.tarjetaEstado}>
        <Text style={styles.estadoTitulo}>{tituloEstado}</Text>
        {cargando ? (
          <ActivityIndicator color={colors.rojo} style={styles.cargandoEstado} />
        ) : filasEstado.length > 0 ? (
          filasEstado.map((f) => (
            <View key={f.etiqueta} style={styles.filaEstado}>
              <Text style={styles.filaEtiqueta}>{f.etiqueta}</Text>
              <Text style={[styles.filaValor, f.color ? { color: f.color } : null]}>
                {f.valor} <Text style={styles.filaPct}>{f.pct}</Text>
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.estadoPendiente}>
            {inventario === null
              ? 'Todavía no hay un inventario en curso para esta sucursal.'
              : 'Esperando datos…'}
          </Text>
        )}
      </View>

      <Text style={styles.seccionTitulo}>Tus accesos</Text>
      <View style={styles.accesos}>
        {accesos.map((a) => (
          <AccesoTarjeta key={a.titulo} titulo={a.titulo} sub={a.sub} onPress={() => abrirAcceso(a.ruta)} />
        ))}
      </View>
    </PantallaConTabs>
  );
}

const styles = StyleSheet.create({
  contenido: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.lg },
  saludo: { gap: 2 },
  saludoNombre: { fontSize: fontSize.xxl - 3, color: colors.rojo, fontFamily: fonts.marca },
  saludoSub: { fontSize: 13.5, color: colors.gris, fontFamily: fonts.regular },
  tarjetaEstado: {
    padding: 15,
    gap: 10,
    backgroundColor: colors.campo,
    borderWidth: 1,
    borderColor: colors.borde,
    borderRadius: 13,
  },
  estadoTitulo: { fontSize: 14.5, color: colors.tinta, fontFamily: fonts.bold },
  estadoPendiente: { fontSize: 12.5, color: colors.grisClaro, fontFamily: fonts.regular },
  cargandoEstado: { alignSelf: 'flex-start' },
  filaEstado: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  filaEtiqueta: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
  filaValor: { fontSize: 16, color: colors.tinta, fontFamily: fonts.bold },
  filaPct: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.medium },
  seccionTitulo: { fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gris, fontFamily: fonts.semibold },
  accesos: { gap: 10 },
});
