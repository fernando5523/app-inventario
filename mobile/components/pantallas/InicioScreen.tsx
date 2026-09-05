import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { repositorioHojas, repositorioInventario, repositorioTiendas, repositorioUsuarios, sincronizador } from '../../lib/contenedor';
import { avanceConjunto, estadoConjunto } from '../../lib/dominio/hoja';
import type { HojaConteo, Rol } from '../../lib/dominio/tipos';
import type { EstadoCola } from '../../lib/puertos/repositorios';
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

const ETIQUETA_ESTADO_1ER_CONTEO: Record<ReturnType<typeof estadoConjunto>, string> = {
  finalizada: '1er conteo finalizado',
  'en-proceso': '1er conteo en curso',
  pendiente: '1er conteo pendiente',
  'sin-hojas': 'sin hojas todavía',
};

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
  // `todas()` del inventario -- Coordinador y Auditor ven el MISMO dato
  // (los dos pueden pedir alcance=todas, ver backend/README.md), nunca
  // dos cálculos distintos: es lo que garantiza que Inicio y Ciclo
  // cuenten la misma historia (ver el comentario largo en
  // CicloScreen.tsx sobre el hallazgo I-4 de la auditoría).
  const [hojasRonda1, setHojasRonda1] = useState<HojaConteo[] | null>(null);
  const [misHojas, setMisHojas] = useState<HojaConteo[] | null>(null);
  const [estadoSistema, setEstadoSistema] = useState<EstadoSistema | null>(null);
  const [estadoCola, setEstadoCola] = useState<EstadoCola>(sincronizador.estado());
  useEffect(() => sincronizador.suscribir(setEstadoCola), []);

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

        if (sesion!.colaborador.rol === 'coordinador' || sesion!.colaborador.rol === 'auditor') {
          const todas = await repositorioHojas.todas(activo.inventarioId);
          if (vigente) setHojasRonda1(todas);
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
    if (inventario && hojasRonda1) {
      const asignadas = hojasRonda1.filter((h) => h.asignados.length > 0).length;
      const finalizadas = hojasRonda1.filter((h) => h.estado === 'finalizada').length;
      const contando = new Set(
        hojasRonda1.filter((h) => h.estado !== 'pendiente').flatMap((h) => h.asignados),
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
      sync = sincronizacionDeHojas(hojasRonda1, estadoCola);
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
      sync = sincronizacionDeHojas(misHojas, estadoCola);
    }
  } else if (rol === 'auditor') {
    tituloEstado = 'Estado de la auditoría';
    if (inventario && hojasRonda1) {
      // El Auditor todavía solo tiene datos reales del 1er conteo (mismo
      // límite que components/pantallas/CicloScreen.tsx: no existe un
      // puerto que traiga las rondas 2/3 ni el comparativo contra
      // Dynamics — ver el comentario largo ahí). Antes acá se mostraba
      // "3er conteo cerrado" y "130 por auditar" como datos fijos: LA
      // MISMA sesión decía en Ciclo que faltaba terminar el 1er conteo y
      // acá que el ciclo entero ya había cerrado. Ahora las dos pantallas
      // usan la misma función sobre las mismas hojas.
      const estado1 = estadoConjunto(hojasRonda1);
      const avance1 = avanceConjunto(hojasRonda1);
      const pct1 = avance1.totalItems > 0 ? (avance1.itemsContados / avance1.totalItems) * 100 : 0;
      const etiquetaEstado1 = ETIQUETA_ESTADO_1ER_CONTEO[estado1];
      cifras = `${inventario.totalHojas} hojas · ${formatoMiles(inventario.items)} ítems · ${etiquetaEstado1}`;
      filasEstado = [
        { etiqueta: 'Ciclo de conteos', valor: etiquetaEstado1, color: estado1 === 'finalizada' ? colors.ok : colors.proceso },
        {
          etiqueta: 'Ítems contados (1er conteo)',
          valor: formatoMiles(avance1.itemsContados),
          pct: `/ ${formatoMiles(avance1.totalItems)} (${formatoPct(pct1)}%)`,
          color: colors.ok,
        },
        { etiqueta: '2do y 3er conteo', valor: 'Sin datos todavía' },
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

      <BandaSync
        estado={sync.estado}
        mensaje={sync.mensaje}
        onSincronizar={rol === 'coordinador' || rol === 'conteo' ? () => sincronizador.sincronizar() : undefined}
      />

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
