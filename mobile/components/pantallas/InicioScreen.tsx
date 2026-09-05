import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { inventarioIdSinRed, rondaActivaSinRed } from '../../lib/adaptadores/hojas-sqlite';
import { repositorioHojas, repositorioInventario, repositorioTiendas, repositorioUsuarios, sincronizador } from '../../lib/contenedor';
import { cifraOSinRed, filaPct } from '../../lib/dominio/cifra-sin-red';
import { avance, avanceConjunto, estadoConjunto } from '../../lib/dominio/hoja';
import type { HojaConteo, Rol } from '../../lib/dominio/tipos';
import type { EstadoCola } from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { colors, fonts, fontSize, spacing } from '../../lib/theme';
import { ACCESOS_POR_ROL } from '../navegacion/accesos';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';
import { AccesoTarjeta, BandaSync, BarraApp, Button, GrupoRol, formatoMiles, formatoPct, sincronizacionDeHojas, type EstadoSincronizacion } from '../ui';

const NOMBRE_ROL: Record<Rol, string> = {
  administrador: 'Administrador',
  coordinador: 'Coordinador',
  conteo: 'Conteo',
  auditor: 'Auditor',
};

interface InventarioActivo {
  inventarioId: number;
  /** null = no se pudo traer (sin red); nunca 0 con ese significado. */
  items: number | null;
  totalHojas: number | null;
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
  // Solo la usa la rama Administrador: las otras 3 ramas ya caen a datos
  // locales sin red (ver inventarioIdSinRed más abajo) y no necesitan
  // mostrar un mensaje de error — el Administrador no tiene un SQLite
  // equivalente al avance de conteo, así que sin red no hay nada que
  // mostrar salvo decirlo.
  const [errorSistema, setErrorSistema] = useState<string | null>(null);
  // Incrementarlo desde el botón "Reintentar" fuerza al useFocusEffect de
  // abajo a correr de nuevo sin reestructurar la función (que ya maneja su
  // propio `vigente` para las 3 ramas) — recarga sin salir de la pantalla.
  const [intentoManual, setIntentoManual] = useState(0);
  const [inventario, setInventario] = useState<InventarioActivo | null>(null);
  // `todas()` del inventario -- Coordinador y Auditor ven el MISMO dato
  // (los dos pueden pedir alcance=todas, ver backend/README.md), nunca
  // dos cálculos distintos: es lo que garantiza que Inicio y Ciclo
  // cuenten la misma historia (ver el comentario largo en
  // CicloScreen.tsx sobre el hallazgo I-4 de la auditoría).
  const [hojasRonda1, setHojasRonda1] = useState<HojaConteo[] | null>(null);
  // true SOLO cuando `ronda === null` salió de la rama sin red (nunca se
  // pudo bajar ninguna hoja de este inventario, ni siquiera localmente —
  // ver rondaActivaSinRed). Con red, `ronda === null` es un hecho real
  // (todavía no hay ronda activa) y esto queda en false: son dos
  // situaciones distintas y confundirlas es el mismo "0 que miente" que
  // ya se corrigió para totalHojas/items (ver cifra-sin-red.ts) — acá el
  // 0 no viene de un campo vacío sino de `hojasRonda1` cayendo en `[]`
  // por el `ronda !== null ? ... : []` de más abajo.
  const [sinDatosDeRonda, setSinDatosDeRonda] = useState(false);
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
          setErrorSistema(null);
          try {
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
          } catch (e) {
            // A diferencia de las otras 3 ramas (ver más abajo), acá no hay
            // ningún dato local al que caer -- "tiendas activas" y
            // "usuarios habilitados" son cifras del sistema entero, no del
            // avance de conteo de esta persona. Sin este catch, el spinner
            // quedaba girando para siempre (mismo bug que f558689 arregló
            // en las otras ramas, sin llegar a tocar esta).
            if (vigente) setErrorSistema(e instanceof Error ? e.message : 'No se pudo cargar el estado del sistema.');
          } finally {
            if (vigente) setCargando(false);
          }
          return;
        }

        // Ya se descartó 'administrador' arriba (return temprano): acá el
        // rol siempre tiene sucursal real.
        let inventarioId: number | null;
        let ronda: number | null = null;
        let items: number | null = null;
        let totalHojas: number | null = null;
        let sinDatos = false;
        try {
          const activo = await repositorioInventario.activo(sesion!.sucursal!.id);
          inventarioId = activo?.inventarioId ?? null;
          ronda = activo?.rondaActiva ?? null;
          items = activo?.items ?? null;
          totalHojas = activo?.totalHojas ?? null;
        } catch {
          // Sin red (u otra falla): el avance de HOY puede estar completo
          // en SQLite — se sigue con eso en vez de dejar "Tu avance"
          // colgado esperando una respuesta que no va a llegar (ver
          // inventarioIdSinRed en hojas-sqlite.ts). `items`/`totalHojas`
          // quedan en null (nunca 0): esos números solo los tiene el
          // snapshot del servidor, y null es "no se sabe" — mostrarlos en
          // 0 diría "no hay ninguno", que es una afirmación distinta y
          // falsa (ver lib/dominio/cifra-sin-red.ts). Lo que importa acá
          // es el avance de la persona, que sale de `repositorioHojas`
          // abajo y no depende de este try.
          inventarioId = await inventarioIdSinRed();
          // La ronda activa, sin red: sale de MAX(numero_conteo) en la
          // estructura local (ver rondaActivaSinRed). Sin esto, el Contador
          // offline en la ronda 2 leería la 1 y confirmaría en vez de contar.
          ronda = inventarioId ? await rondaActivaSinRed(inventarioId) : null;
          // `ronda === null` acá significa "nunca se descargó ninguna hoja
          // de este inventario" (ver el comentario de rondaActivaSinRed) —
          // no "no hay ronda activa todavía", que es lo que significaría
          // con red. Sin esta marca, Coordinador/Auditor verían "0
          // asignadas · 0 finalizadas · 0 contando" indistinguible de un
          // cero real.
          sinDatos = ronda === null;
        }
        if (!vigente) return;
        setSinDatosDeRonda(sinDatos);

        if (!inventarioId) {
          setInventario(null);
          setCargando(false);
          return;
        }
        setInventario({ inventarioId, items, totalHojas });

        if (sesion!.colaborador.rol === 'coordinador' || sesion!.colaborador.rol === 'auditor') {
          // Sin ronda activa (null = ninguna abierta) no hay hojas que traer.
          const todas = ronda !== null ? await repositorioHojas.todas(inventarioId, ronda) : [];
          if (vigente) setHojasRonda1(todas);
        } else if (sesion!.colaborador.rol === 'conteo') {
          // mias(), NUNCA todas(): un Contador no puede ver el lote entero.
          const mias = ronda !== null ? await repositorioHojas.mias(inventarioId, ronda) : [];
          if (vigente) setMisHojas(mias);
        }
        if (vigente) setCargando(false);
      }

      cargar();
      return () => {
        vigente = false;
      };
    }, [sesion, intentoManual]),
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
      // Sin datos de ronda (sin red y nunca se descargó nada local): las 3
      // cifras son "no lo sé", nunca "0" — mostrar 0 acá diría "ninguna
      // hoja asignada", que es una afirmación distinta y falsa.
      const asignadas = sinDatosDeRonda ? null : hojasRonda1.filter((h) => h.asignados.length > 0).length;
      const finalizadas = sinDatosDeRonda ? null : hojasRonda1.filter((h) => h.estado === 'finalizada').length;
      const contando = sinDatosDeRonda
        ? null
        : new Set(hojasRonda1.filter((h) => h.estado !== 'pendiente').flatMap((h) => h.asignados)).size;
      // Sin red, totalHojas/items son null: se muestran como "—", nunca
      // como "0 hojas" (que diría "no hay ninguna" en vez de "no lo sé").
      const sinRed = inventario.totalHojas === null || inventario.items === null || sinDatosDeRonda;
      cifras = `${cifraOSinRed(inventario.totalHojas)} hojas · ${cifraOSinRed(inventario.items, formatoMiles)} ítems · ${cifraOSinRed(asignadas)} asignadas${sinRed ? ' · sin red' : ''}`;
      filasEstado = [
        { etiqueta: 'Hojas asignadas', valor: cifraOSinRed(asignadas), pct: asignadas === null ? 'sin red' : filaPct(asignadas, inventario.totalHojas) },
        {
          etiqueta: 'Hojas finalizadas',
          valor: cifraOSinRed(finalizadas),
          pct: finalizadas === null ? 'sin red' : filaPct(finalizadas, inventario.totalHojas),
          color: colors.ok,
        },
        { etiqueta: 'Contando ahora', valor: cifraOSinRed(contando), pct: contando === null ? 'sin red' : 'colaboradores' },
      ];
      sync = sincronizacionDeHojas(hojasRonda1, estadoCola);
    }
  } else if (rol === 'conteo') {
    tituloEstado = 'Tu avance';
    if (misHojas) {
      const hojaActual = misHojas.find((h) => h.estado === 'en-proceso') ?? null;
      const pendientes = misHojas.filter((h) => h.estado === 'pendiente').length;
      // `avance(hojaActual).total`, NUNCA hojaActual.tamano: tamano es el
      // tamaño nominal del lote pedido al crear las hojas, no cuántos
      // productos tiene ESTA — la última hoja de un inventario real queda
      // parcial, y mostrar el nominal ahí infla el total que ve quien cuenta.
      const totalHojaActual = hojaActual ? avance(hojaActual).total : 0;
      // Conteo ciego: SOLO sus hojas y sus ítems. Nunca el total del
      // inventario ni una cifra que venga del ERP.
      cifras = hojaActual ? `Hoja #${hojaActual.numero} · Lote de ${totalHojaActual} ítems` : `${misHojas.length} hojas asignadas`;
      filasEstado = hojaActual
        ? [
            {
              etiqueta: `Hoja #${hojaActual.numero}`,
              valor: String(hojaActual.conteos.length),
              pct: `/ ${totalHojaActual} ítems`,
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
      //
      // Sin datos de ronda (sin red, nunca se descargó nada local),
      // `hojasRonda1` es `[]` — `estadoConjunto`/`avanceConjunto` sobre
      // eso dirían "sin hojas todavía" y "0 / 0 (0%)", que es la MISMA
      // afirmación falsa que ya se corrigió arriba: acá "sin red" y "no
      // hay hojas creadas" son hechos distintos, no se puede confundirlos.
      const estado1 = sinDatosDeRonda ? null : estadoConjunto(hojasRonda1);
      const avance1 = sinDatosDeRonda ? null : avanceConjunto(hojasRonda1);
      const pct1 = avance1 && avance1.totalItems > 0 ? (avance1.itemsContados / avance1.totalItems) * 100 : 0;
      const etiquetaEstado1 = estado1 ? ETIQUETA_ESTADO_1ER_CONTEO[estado1] : 'sin red';
      // Mismo criterio que el bloque de Coordinador: sin red no se muestra
      // "0 hojas", se muestra "—" y se aclara por qué.
      const sinRed = inventario.totalHojas === null || inventario.items === null || sinDatosDeRonda;
      cifras = `${cifraOSinRed(inventario.totalHojas)} hojas · ${cifraOSinRed(inventario.items, formatoMiles)} ítems · ${etiquetaEstado1}${sinRed ? ' · sin red' : ''}`;
      filasEstado = [
        { etiqueta: 'Ciclo de conteos', valor: etiquetaEstado1, color: estado1 === 'finalizada' ? colors.ok : colors.proceso },
        {
          etiqueta: 'Ítems contados (1er conteo)',
          valor: avance1 ? formatoMiles(avance1.itemsContados) : '—',
          pct: avance1 ? `/ ${formatoMiles(avance1.totalItems)} (${formatoPct(pct1)}%)` : 'sin red',
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
          pct: filaPct(estadoSistema.tiendasActivas, estadoSistema.totalTiendas),
          color: colors.ok,
        },
        {
          etiqueta: 'Usuarios habilitados',
          valor: String(estadoSistema.usuariosActivos),
          pct: filaPct(estadoSistema.usuariosActivos, estadoSistema.totalUsuarios),
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
        ) : errorSistema ? (
          <View style={styles.errorSistema}>
            <Text style={styles.estadoPendiente}>{errorSistema}</Text>
            <Button label="Reintentar" size="sm" onPress={() => setIntentoManual((n) => n + 1)} />
          </View>
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
  errorSistema: { gap: 10, alignItems: 'flex-start' },
  cargandoEstado: { alignSelf: 'flex-start' },
  filaEstado: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  filaEtiqueta: { fontSize: 12.5, color: colors.gris, fontFamily: fonts.regular },
  filaValor: { fontSize: 16, color: colors.tinta, fontFamily: fonts.bold },
  filaPct: { fontSize: 11.5, color: colors.gris, fontFamily: fonts.medium },
  seccionTitulo: { fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gris, fontFamily: fonts.semibold },
  accesos: { gap: 10 },
});
