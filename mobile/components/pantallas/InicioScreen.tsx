import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { cargarSeguro, esFallaDeRed } from '../../lib/adaptadores/_http';
import { inventarioIdSinRed, rondaActivaSinRed, ultimaDescarga, type ResultadoDescarga } from '../../lib/adaptadores/hojas-sqlite';
import { repositorioHojas, repositorioInventario, repositorioSesion, repositorioTiendas, repositorioUsuarios, sincronizador } from '../../lib/contenedor';
import { cifraMisHojas, cifraOSinRed, filaPct, motivoCorto } from '../../lib/dominio/cifra-sin-red';
import { avance, avanceConjunto, estadoConjunto } from '../../lib/dominio/hoja';
import { faseDeCierre, type FaseDeCierre } from '../../lib/dominio/ajuste-final';
import { ORDINAL } from '../../lib/dominio/texto-cierre-ronda';
import { pluralizar } from '../../lib/dominio/plural';
import { sucursalEnFoco } from '../../lib/dominio/sucursal-en-foco';
import type { HojaConteo, Rol, Sucursal } from '../../lib/dominio/tipos';
import { useSesion } from '../../lib/sesion-contexto';
import { useSucursalAuditada } from '../../lib/sucursal-auditada-contexto';
import { colors, fonts, fontSize, spacing } from '../../lib/theme';
import { debeReintentarAutomaticamente, INTERVALO_REINTENTO_MS, REINTENTO_INICIAL, trasIntentoFallido } from '../hooks/refresco';
import { useRefrescoAlEnfocar } from '../hooks/useRefrescoAlEnfocar';
import { useNavegacion, useRefrescarNavegacion } from '../../lib/navegacion-contexto';
import { PantallaConTabs } from '../navegacion/PantallaConTabs';
import { AccesoTarjeta, BandaSync, BarraApp, Button, formatoMiles, formatoPct, resumenParaTablero, type EstadoSincronizacion } from '../ui';

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

/**
 * El estado del conjunto de hojas, nombrando LA RONDA QUE SE ESTÁ MIRANDO.
 *
 * BUG REAL (visto en el emulador, inventario 8040): esto era una tabla que
 * decía "1er conteo" fijo, pero las hojas que alimenta salen de la RONDA
 * ACTIVA -- `todas(inventarioId, rondaActiva)`. Con las tres rondas corridas,
 * Inicio mostraba "1er conteo finalizado" y "Ítems contados (1er conteo) 3/3"
 * con los ítems de la RONDA 3: tres ítems de un reconteo presentados como si
 * fueran los diez del primer conteo.
 *
 * Es la misma familia de error que ya se arregló en CicloScreen (badges que
 * nombraban una ronda fija sin relación con la real): el ordinal sale del
 * número, nunca de un literal.
 */
function etiquetaEstadoDeRonda(estado: ReturnType<typeof estadoConjunto>, ronda: number | null): string {
  // Sin ronda abierta no hay conjunto de hojas que describir: el conteo
  // terminó. Decir "sin hojas todavía" ahí invita a esperar unas hojas que no
  // se van a crear.
  if (ronda === null) return 'conteo terminado';
  const cual = `${ORDINAL[ronda]} conteo`;
  switch (estado) {
    case 'finalizada':
      return `${cual} finalizado`;
    case 'en-proceso':
      return `${cual} en curso`;
    case 'pendiente':
      return `${cual} pendiente`;
    case 'sin-hojas':
      return `${cual} sin hojas todavía`;
  }
}

/**
 * QUÉ SIGUE en el cierre, para el Auditor. Reemplaza el literal "2do y 3er
 * conteo: Sin datos todavía", que prometía que las rondas son tres y ya era
 * falso con la segunda corrida.
 *
 * Esta pantalla solo tiene las hojas de UNA ronda; el embudo de todas las
 * pasadas vive en Ciclo. Decir eso es honesto; decir "sin datos" era afirmar
 * que no existen, cuando lo que pasa es que esta pantalla no los pide.
 */
function textoQueSigue(fase: FaseDeCierre | null): string {
  switch (fase) {
    case 'contando':
      return 'El embudo por pasada está en Ciclo';
    case 'rondas-cerradas':
      return 'Decidir: otro conteo o el ajuste final';
    case 'ajuste':
      return 'Ajuste final en curso';
    case 'cerrado':
      return 'Conteo cerrado: sigue la liquidación';
    default:
      // `null` = todavía no se pudo saber en qué fase está (sin red, o sin
      // inventario). No se inventa una: "—" es más honesto que un paso
      // afirmado sin dato.
      return '—';
  }
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
  // El Auditor sigue la sucursal COMPARTIDA que eligió en sus otras pantallas
  // (ver lib/sucursal-auditada-contexto.tsx); el padrón resuelve su nombre para
  // la barra. Para los otros roles el hook es inerte y esto no aplica.
  const { elegida: sucursalElegida } = useSucursalAuditada();
  const [padronSucursales, setPadronSucursales] = useState<Sucursal[]>([]);
  /**
   * EL PADRÓN ES DECORATIVO ACÁ: solo resuelve el NOMBRE de la sucursal que
   * se muestra en la barra. Sin él, `nombreSede` cae al de la sesión y la
   * pantalla funciona igual.
   *
   * Por eso el fallo se atrapa y NO se propaga. Sin este `catch`, abrir la
   * app sin backend dejaba escapar la promesa y el manejador global mostraba
   * "Uncaught (in promise): ErrorApi: Sin señal" — encontrado en el emulador
   * (2026-09-19) bajando el backend a propósito.
   *
   * Y el problema no es el recuadro rojo, que en release no se ve: una
   * promesa sin atrapar NO es lo mismo que un error manejado. Quedarse sin
   * señal en una tienda con WiFi mala es el camino ESPERADO de esta app, y el
   * camino esperado no puede viajar como excepción. El día que se conecte un
   * reporte de errores, cada apertura sin señal generaría un reporte, y ese
   * ruido tapa los errores de verdad.
   *
   * SE REGISTRA SOLO LO QUE NO ES FALTA DE SEÑAL. Un `console.warn` en cada
   * apertura sin red sería el mismo ruido en otro lado; pero un 500 o una
   * respuesta inválida SÍ son un problema nuestro y no se pueden tragar en
   * silencio, porque entonces la barra mostraría el nombre equivocado y nadie
   * sabría por qué.
   */
  useEffect(() => {
    if (sesion?.colaborador.rol !== 'auditor') return;

    let vigente = true;
    repositorioSesion
      .sucursales()
      .then((padron) => {
        // Guarda de desmontaje, que tampoco estaba: sin ella, salir de la
        // pantalla antes de que conteste el servidor escribe estado sobre un
        // componente que ya no existe.
        if (vigente) setPadronSucursales(padron);
      })
      .catch((error: unknown) => {
        if (!esFallaDeRed(error)) {
          console.warn('[inicio] no se pudo traer el padrón de sucursales:', error);
        }
      });

    return () => {
      vigente = false;
    };
  }, [sesion]);
  const [cargando, setCargando] = useState(true);
  // Administrador: sin red no hay nada a lo que caer (no tiene un SQLite
  // equivalente al avance de conteo), así que esto es lo único que se
  // muestra. Los otros 3 roles caen a datos locales para `activo()` (ver
  // inventarioIdSinRed más abajo), pero la SEGUNDA llamada
  // (repositorioHojas.todas()/mias()) no tiene fallback -- si esa revienta,
  // también se muestra acá (bug real 2026-09-10: antes escapaba sin
  // control y dejaba el spinner de esta tarjeta girando para siempre).
  const [errorSistema, setErrorSistema] = useState<string | null>(null);
  const [inventario, setInventario] = useState<InventarioActivo | null>(null);
  // `todas()` del inventario -- Coordinador y Auditor ven el MISMO dato
  // (los dos pueden pedir alcance=todas, ver backend/README.md), nunca
  // dos cálculos distintos: es lo que garantiza que Inicio y Ciclo
  // cuenten la misma historia (ver el comentario largo en
  // CicloScreen.tsx sobre el hallazgo I-4 de la auditoría).
  /**
   * Las hojas de la RONDA ACTIVA -- no de la 1ra. Se llamaba `hojasDeLaRonda` y
   * ese nombre era la raíz del bug: el dato siempre fue de la ronda activa, y
   * el nombre hizo que todas las etiquetas de abajo dijeran "1er conteo".
   */
  const [hojasDeLaRonda, setHojasDeLaRonda] = useState<HojaConteo[] | null>(null);
  /** Qué ronda son esas hojas. `null` = no hay ninguna abierta (el conteo terminó). */
  const [rondaActual, setRondaActual] = useState<number | null>(null);
  /** En qué fase está el cierre, para no llamar "sin hojas" a un conteo terminado. */
  const [fase, setFase] = useState<FaseDeCierre | null>(null);
  // true SOLO cuando `ronda === null` salió de la rama sin red (nunca se
  // pudo bajar ninguna hoja de este inventario, ni siquiera localmente —
  // ver rondaActivaSinRed). Con red, `ronda === null` es un hecho real
  // (todavía no hay ronda activa) y esto queda en false: son dos
  // situaciones distintas y confundirlas es el mismo "0 que miente" que
  // ya se corrigió para totalHojas/items (ver cifra-sin-red.ts) — acá el
  // 0 no viene de un campo vacío sino de `hojasDeLaRonda` cayendo en `[]`
  // por el `ronda !== null ? ... : []` de más abajo.
  const [sinDatosDeRonda, setSinDatosDeRonda] = useState(false);
  const [misHojas, setMisHojas] = useState<HojaConteo[] | null>(null);
  // Qué pasó la última vez que se intentó bajar `misHojas` de esta ronda --
  // sin esto, un `[]` por descarga fallida/en curso es indistinguible de un
  // 0 real (bug real 2026-09-10, ver lib/dominio/cifra-sin-red.ts#cifraMisHojas).
  const [resultadoMias, setResultadoMias] = useState<ResultadoDescarga | null>(null);
  const [estadoSistema, setEstadoSistema] = useState<EstadoSistema | null>(null);

  // Toda la carga de las 4 ramas (administrador/coordinador/conteo/
  // auditor) en un solo callback -- `useRefrescoAlEnfocar` decide CUÁNDO
  // llamarlo (al enfocar la pantalla Y al volver la app a primer plano,
  // con un candado contra solapamiento), acá solo importa QUÉ hace.
  const cargar = useCallback(async () => {
    if (!sesion) return;

    // El Administrador no pertenece a una sola sucursal — no tiene
    // sentido pedir repositorioInventario.activo(sesion.sucursal.id) para
    // él, su vista es del sistema entero.
    if (sesion.colaborador.rol === 'administrador') {
      setErrorSistema(null);
      try {
        const [tiendas, usuarios] = await Promise.all([repositorioTiendas.listar(), repositorioUsuarios.listar()]);
        const inventariosPorTienda = await Promise.all(tiendas.map((t) => repositorioInventario.activo(t.id)));
        setEstadoSistema({
          tiendasActivas: tiendas.filter((t) => t.activa !== false).length,
          totalTiendas: tiendas.length,
          usuariosActivos: usuarios.filter((u) => u.activo).length,
          totalUsuarios: usuarios.length,
          inventariosEnCurso: inventariosPorTienda.filter((i) => i !== null).length,
        });
      } catch (e) {
        // A diferencia de las otras 3 ramas (ver más abajo), acá no hay
        // ningún dato local al que caer -- "tiendas activas" y "usuarios
        // habilitados" son cifras del sistema entero, no del avance de
        // conteo de esta persona. Sin este catch, el spinner quedaba
        // girando para siempre (mismo bug que f558689 arregló en las
        // otras ramas, sin llegar a tocar esta).
        setErrorSistema(e instanceof Error ? e.message : 'No se pudo cargar el estado del sistema.');
      } finally {
        setCargando(false);
      }
      return;
    }

    // Ya se descartó 'administrador' arriba (return temprano): acá el rol
    // siempre tiene sucursal real.
    setErrorSistema(null);
    let inventarioId: number | null;
    let ronda: number | null = null;
    let items: number | null = null;
    let totalHojas: number | null = null;
    let sinDatos = false;
    try {
      // El Auditor mira la sucursal COMPARTIDA que eligió; el Coordinador/Conteo,
      // la de su sesión (sucursalEnFoco lo resuelve por rol). El `?? sesion...`
      // es solo el piso para TS: en este punto el rol siempre tiene sucursal.
      const sucursalId = sucursalEnFoco({
        rol: sesion.colaborador.rol,
        sucursalDeSesion: sesion.sucursal?.id ?? null,
        elegida: sucursalElegida,
      });
      const activo = await repositorioInventario.activo(sucursalId ?? sesion.sucursal!.id);
      inventarioId = activo?.inventarioId ?? null;
      ronda = activo?.rondaActiva ?? null;
      items = activo?.items ?? null;
      totalHojas = activo?.totalHojas ?? null;
      setFase(activo ? faseDeCierre(activo.estado, activo.rondaActiva, activo.totalHojas, activo.ultimaRondaCerrada) : null);
    } catch {
      // Sin red (u otra falla): el avance de HOY puede estar completo en
      // SQLite — se sigue con eso en vez de dejar "Tu avance" colgado
      // esperando una respuesta que no va a llegar (ver inventarioIdSinRed
      // en hojas-sqlite.ts). `items`/`totalHojas` quedan en null (nunca
      // 0): esos números solo los tiene el snapshot del servidor, y null
      // es "no se sabe" — mostrarlos en 0 diría "no hay ninguno", que es
      // una afirmación distinta y falsa (ver lib/dominio/cifra-sin-red.ts).
      // Lo que importa acá es el avance de la persona, que sale de
      // `repositorioHojas` abajo y no depende de este try.
      inventarioId = await inventarioIdSinRed();
      // La ronda activa, sin red: sale de MAX(numero_conteo) en la
      // estructura local (ver rondaActivaSinRed). Sin esto, el Contador
      // offline en la ronda 2 leería la 1 y confirmaría en vez de contar.
      ronda = inventarioId ? await rondaActivaSinRed(inventarioId) : null;
      // `ronda === null` acá significa "nunca se descargó ninguna hoja de
      // este inventario" (ver el comentario de rondaActivaSinRed) — no
      // "no hay ronda activa todavía", que es lo que significaría con
      // red. Sin esta marca, Coordinador/Auditor verían "0 asignadas · 0
      // finalizadas · 0 contando" indistinguible de un cero real.
      sinDatos = ronda === null;
    }
    setSinDatosDeRonda(sinDatos);
    // La ronda que se está mirando, para que las etiquetas la nombren de
    // verdad en vez de decir "1er conteo" pase lo que pase.
    setRondaActual(ronda);

    if (!inventarioId) {
      setInventario(null);
      setCargando(false);
      return;
    }
    setInventario({ inventarioId, items, totalHojas });

    // SIN fallback local para esto (a diferencia de `activo()` arriba): si
    // revienta, antes escapaba sin control y `setCargando(false)` de más
    // abajo nunca se ejecutaba -- el spinner de esta tarjeta quedaba
    // girando para siempre (bug real, 2026-09-10). `cargarSeguro` atrapa
    // CUALQUIER falla acá y la devuelve en vez de dejarla escapar.
    const idInventario = inventarioId;
    const rondaActiva = ronda;
    const error = await cargarSeguro(async () => {
      if (sesion.colaborador.rol === 'coordinador' || sesion.colaborador.rol === 'auditor') {
        // Sin ronda activa (null = ninguna abierta) no hay hojas que traer.
        const todas = rondaActiva !== null ? await repositorioHojas.todas(idInventario, rondaActiva) : [];
        setHojasDeLaRonda(todas);
      } else if (sesion.colaborador.rol === 'conteo') {
        // mias(), NUNCA todas(): un Contador no puede ver el lote entero.
        const mias = rondaActiva !== null ? await repositorioHojas.mias(idInventario, rondaActiva) : [];
        setMisHojas(mias);
        // Se consulta DESPUÉS de `mias()` (que ya esperó su propio intento
        // de descarga adentro): dice si ese resultado es de fiar o si la
        // descarga de esta ronda todavía no se pudo completar.
        setResultadoMias(rondaActiva !== null ? ultimaDescarga(idInventario, 'mias', rondaActiva) : null);
      }
    });
    if (error) setErrorSistema(error.message);
    setCargando(false);
  }, [sesion, sucursalElegida]);

  // Al enfocar la pantalla Y al volver la app a primer plano (el caso que
  // reportó el cliente: el Coordinador cierra una ronda y abre la
  // siguiente con esta pantalla todavía abierta, sin cambiar de tab) --
  // los dos disparadores con un solo candado contra solapamiento.
  /**
   * LA NAVEGACION TAMBIEN SE REFRESCA ACA, junto con el resto del inicio.
   *
   * El provider la pide una sola vez por login (depende de `[rol]`, y el rol
   * no cambia durante una sesión). Si el Administrador prende, apaga o
   * reordena un acceso, sin esto nadie lo ve hasta cerrar y reabrir la app.
   *
   * Va en Inicio y no en el provider porque el refresco al enfocar necesita
   * una PANTALLA: el provider envuelve al Stack entero y no tiene foco
   * propio. Y es la pantalla correcta -- es la que dibuja las tarjetas, así
   * que si algo cambió, acá es donde se nota.
   *
   * Ante un error de red no hace nada (ver `refrescar` en el contexto): lo
   * que ya está en la app es lo bueno y no se pisa con el mapa de fábrica.
   */
  const refrescarNavegacion = useRefrescarNavegacion();
  const cargarTodo = useCallback(async () => {
    refrescarNavegacion();
    await cargar();
  }, [cargar, refrescarNavegacion]);

  const { refrescar } = useRefrescoAlEnfocar(cargarTodo);

  // REINTENTO AUTOMÁTICO cuando la descarga de `misHojas` falló (bug real,
  // 2026-09-11): antes, un "0 hojas asignadas" (en realidad "no se pudo
  // bajar todavía") se quedaba así hasta que la persona entraba a Mis hojas
  // y volvía -- no porque esa pantalla haga algo distinto (usa el MISMO
  // useRefrescoAlEnfocar), sino porque cada visita dispara UN INTENTO MÁS y
  // el fallo original era transitorio. El cliente fue explícito: ningún
  // dato depende de navegar a otra pantalla, así que el reintento lo
  // dispara esta misma pantalla, sola, sin que nadie la vuelva a enfocar.
  // Ver components/hooks/refresco.ts para el porqué del tope y el intervalo.
  const intentosAutoRef = useRef(REINTENTO_INICIAL);
  useEffect(() => {
    if (sesion?.colaborador.rol !== 'conteo') return;
    if (resultadoMias?.ok !== false) {
      // Éxito (o sin intento todavía): se resetea el cupo para la próxima
      // vez que haga falta, en vez de arrastrar intentos de una falla ya
      // resuelta.
      intentosAutoRef.current = REINTENTO_INICIAL;
      return;
    }
    if (!debeReintentarAutomaticamente(intentosAutoRef.current)) return;
    const id = setTimeout(() => {
      intentosAutoRef.current = trasIntentoFallido(intentosAutoRef.current);
      void cargar();
    }, INTERVALO_REINTENTO_MS);
    return () => clearTimeout(id);
  }, [sesion, resultadoMias, cargar]);

  // El Auditor cambia la sucursal en OTRA pantalla; acá la sede (rótulo) sigue
  // el contexto al instante, pero las cifras venían del fetch anterior hasta el
  // próximo foco -- un dato con el apellido equivocado (skill, Honestidad de
  // los datos). Al cambiar `cargar` (cambió la sucursal) se limpia y recarga.
  // El primer render lo saltea: esa carga la hace useRefrescoAlEnfocar.
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    setInventario(null);
    setHojasDeLaRonda(null);
    setMisHojas(null);
    setResultadoMias(null);
    setEstadoSistema(null);
    setCargando(true);
    void cargar();
  }, [cargar]);

  // El layout del grupo (RolTabsLayout) ya garantiza que no se llega acá
  // sin sesión — este guard es solo para que TypeScript no se queje.
  if (!sesion) return <View />;

  const rol = sesion.colaborador.rol;
  const primerNombre = sesion.colaborador.nombre.split(' ')[0];
  // Los que configuró el Administrador. Si esa configuración no llegó, esto
  // devuelve el mapa compilado sin avisar -- ver lib/navegacion-contexto.tsx:
  // la persona en la góndola no tiene por qué enterarse.
  const { accesos } = useNavegacion(rol);

  // El nombre de la sucursal que se muestra en la barra: para el Auditor, la
  // EFECTIVA (la elegida en el contexto); para el Coordinador/Conteo, la suya;
  // el Administrador no tiene sede.
  const sucursalIdEfectiva = sucursalEnFoco({ rol, sucursalDeSesion: sesion.sucursal?.id ?? null, elegida: sucursalElegida });
  const nombreSede =
    rol === 'administrador'
      ? undefined
      : (padronSucursales.find((s) => s.id === sucursalIdEfectiva)?.nombre ?? sesion.sucursal?.nombre);

  async function salir(): Promise<void> {
    await cerrar();
    router.replace('/');
  }

  function abrirAcceso(ruta?: string): void {
    // Todo acceso trae `ruta` hoy — el campo queda opcional en
    // DefinicionAcceso solo como cinturón de seguridad para el día que se
    // agregue uno nuevo antes de portar su pantalla.
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
    if (inventario && hojasDeLaRonda) {
      // Sin datos de ronda (sin red y nunca se descargó nada local): las 3
      // cifras son "no lo sé", nunca "0" — mostrar 0 acá diría "ninguna
      // hoja asignada", que es una afirmación distinta y falsa.
      // `rondaActual === null` = no hay ronda abierta (el conteo terminó): las
      // hojas vienen en `[]` y las tres cifras darían 0. Un 0 ahí dice
      // "ninguna hoja asignada, ninguna finalizada", que sobre un inventario
      // ya contado es falso — mismo criterio que el caso sin red.
      const sinRonda = sinDatosDeRonda || rondaActual === null;
      const asignadas = sinRonda ? null : hojasDeLaRonda.filter((h) => h.asignados.length > 0).length;
      const finalizadas = sinRonda ? null : hojasDeLaRonda.filter((h) => h.estado === 'finalizada').length;
      const contando = sinRonda
        ? null
        : new Set(hojasDeLaRonda.filter((h) => h.estado !== 'pendiente').flatMap((h) => h.asignados)).size;
      // Sin red, totalHojas/items son null: se muestran como "—", nunca
      // como "0 hojas" (que diría "no hay ninguna" en vez de "no lo sé").
      const sinRed = inventario.totalHojas === null || inventario.items === null || sinDatosDeRonda;
      // Concordancia con 1 en las tres cifras: un reconteo (rondas 2 y 3) deja
      // UNA hoja de UN ítem, y las asignadas empiezan en una. Con `null` (sin
      // red) va el plural: es como se lee el "—" (mismo criterio que 536b6ca
      // en "— hojas asignadas").
      cifras = `${cifraOSinRed(inventario.totalHojas)} ${pluralizar(inventario.totalHojas ?? 0, 'hoja', 'hojas')} · ${cifraOSinRed(inventario.items, formatoMiles)} ${pluralizar(inventario.items ?? 0, 'ítem', 'ítems')} · ${cifraOSinRed(asignadas)} ${pluralizar(asignadas ?? 0, 'asignada', 'asignadas')}${sinRed ? ' · sin red' : ''}`;
      filasEstado = [
        { etiqueta: 'Hojas asignadas', valor: cifraOSinRed(asignadas), pct: asignadas === null ? 'sin red' : filaPct(asignadas, inventario.totalHojas) },
        {
          etiqueta: 'Hojas finalizadas',
          valor: cifraOSinRed(finalizadas),
          pct: finalizadas === null ? 'sin red' : filaPct(finalizadas, inventario.totalHojas),
          color: colors.ok,
        },
        // El `pct` se pinta PEGADO al `valor` (ver el render de FilaEstado), así
        // que forma frase con él: con una sola persona contando -- lo normal al
        // arrancar la jornada -- decía "1 colaboradores".
        {
          etiqueta: 'Contando ahora',
          valor: cifraOSinRed(contando),
          pct: contando === null ? 'sin red' : pluralizar(contando, 'colaborador', 'colaboradores'),
        },
      ];
      sync = resumenParaTablero(hojasDeLaRonda);
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
      // `null` cuando el `[]` de `misHojas` viene de una descarga que
      // todavía no terminó o falló -- ver cifra-sin-red.ts#cifraMisHojas.
      // Con `hojaActual` presente ya hay al menos una hoja de verdad, así
      // que esa rama nunca necesita esta distinción.
      const asignadas = cifraMisHojas(misHojas, resultadoMias);
      // Conteo ciego: SOLO sus hojas y sus ítems. Nunca el total del
      // inventario ni una cifra que venga del ERP.
      cifras = hojaActual
        ? `Hoja #${hojaActual.numero} · Lote de ${totalHojaActual} ${pluralizar(totalHojaActual, 'ítem', 'ítems')}`
        : `${cifraOSinRed(asignadas)} ${pluralizar(asignadas ?? 0, 'hoja asignada', 'hojas asignadas')}${asignadas === null ? ` (${motivoCorto(resultadoMias?.ok === false ? resultadoMias.motivo : undefined)})` : ''}`;
      filasEstado = hojaActual
        ? [
            {
              etiqueta: `Hoja #${hojaActual.numero}`,
              valor: String(hojaActual.conteos.length),
              // "X / N ítems": el sustantivo concuerda con N, el total de la
              // hoja (mismo criterio que textoFirmas, "0 / 1 firma").
              pct: `/ ${totalHojaActual} ${pluralizar(totalHojaActual, 'ítem', 'ítems')}`,
              color: colors.ok,
            },
            { etiqueta: 'Tus hojas sin empezar', valor: String(pendientes), pct: `de ${misHojas.length}` },
          ]
        : [
            {
              etiqueta: 'Hojas asignadas',
              valor: cifraOSinRed(asignadas),
              // Con UNA hoja asignada se leía "1 todas pendientes": el `pct` va
              // pegado al `valor`, así que con una sola es "1 pendiente".
              pct:
                asignadas === null
                  ? motivoCorto(resultadoMias?.ok === false ? resultadoMias.motivo : undefined)
                  : pendientes === misHojas.length
                    ? pluralizar(misHojas.length, 'pendiente', 'todas pendientes')
                    : '',
            },
          ];
      sync = resumenParaTablero(misHojas);
    }
  } else if (rol === 'auditor') {
    tituloEstado = 'Estado de la auditoría';
    if (inventario && hojasDeLaRonda) {
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
      // `hojasDeLaRonda` es `[]` — `estadoConjunto`/`avanceConjunto` sobre
      // eso dirían "sin hojas todavía" y "0 / 0 (0%)", que es la MISMA
      // afirmación falsa que ya se corrigió arriba: acá "sin red" y "no
      // hay hojas creadas" son hechos distintos, no se puede confundirlos.
      const estado1 = sinDatosDeRonda ? null : estadoConjunto(hojasDeLaRonda);
      // Sin ronda abierta las hojas vienen en `[]`, y `avanceConjunto([])`
      // daría "0 / 0 (0%)" — un cero que se lee como "no se contó nada" sobre
      // un inventario que terminó de contarse. Es la misma regla de
      // honestidad que ya cubre el caso sin red.
      const avance1 = sinDatosDeRonda || rondaActual === null ? null : avanceConjunto(hojasDeLaRonda);
      const pct1 = avance1 && avance1.totalItems > 0 ? (avance1.itemsContados / avance1.totalItems) * 100 : 0;
      const etiquetaEstado1 = sinDatosDeRonda ? 'sin red' : etiquetaEstadoDeRonda(estado1 ?? 'sin-hojas', rondaActual);
      // Mismo criterio que el bloque de Coordinador: sin red no se muestra
      // "0 hojas", se muestra "—" y se aclara por qué.
      const sinRed = inventario.totalHojas === null || inventario.items === null || sinDatosDeRonda;
      // Mismo criterio que el bloque del Coordinador, más arriba.
      cifras = `${cifraOSinRed(inventario.totalHojas)} ${pluralizar(inventario.totalHojas ?? 0, 'hoja', 'hojas')} · ${cifraOSinRed(inventario.items, formatoMiles)} ${pluralizar(inventario.items ?? 0, 'ítem', 'ítems')} · ${etiquetaEstado1}${sinRed ? ' · sin red' : ''}`;
      filasEstado = [
        { etiqueta: 'Ciclo de conteos', valor: etiquetaEstado1, color: estado1 === 'finalizada' ? colors.ok : colors.proceso },
        {
          // LA RONDA REAL en el rótulo. Decía "(1er conteo)" fijo sobre los
          // ítems de la ronda activa: con las tres corridas mostraba los 3
          // ítems del reconteo como si fueran los 10 del primer conteo.
          etiqueta: rondaActual === null ? 'Ítems contados' : `Ítems contados (${ORDINAL[rondaActual]} conteo)`,
          valor: avance1 ? formatoMiles(avance1.itemsContados) : '—',
          pct: avance1
            ? `/ ${formatoMiles(avance1.totalItems)} (${formatoPct(pct1)}%)`
            : sinDatosDeRonda
              ? 'sin red'
              : 'el conteo ya cerró',
          color: colors.ok,
        },
        {
          // ERA "2do y 3er conteo: Sin datos todavía", un literal que ya era
          // falso con la ronda 2 corrida y que además prometía que solo hay
          // tres. Esta pantalla solo tiene las hojas de UNA ronda: el embudo
          // de todas las pasadas vive en Ciclo, y se dice eso en vez de
          // afirmar que no hay datos.
          etiqueta: 'Qué sigue',
          valor: textoQueSigue(fase),
        },
      ];
    }
  } else {
    // Administrador: no cuenta ni audita — ve el estado del SISTEMA, no
    // el avance de un conteo. Nunca stock, nunca avance de ninguna hoja.
    tituloEstado = 'Estado del sistema';
    if (estadoSistema) {
      // "X de N tiendas activas": concuerda con N (el padrón), igual que el
      // resto de las frases "X de N" de la app.
      cifras = `${estadoSistema.tiendasActivas} de ${estadoSistema.totalTiendas} ${pluralizar(estadoSistema.totalTiendas, 'tienda activa', 'tiendas activas')}`;
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
          // Con un inventario en curso decía "1 sucursales contando" (visto en
          // el Inicio del Administrador): el `pct` forma frase con el `valor`.
          pct:
            estadoSistema.inventariosEnCurso === 0
              ? 'ninguno ahora'
              : pluralizar(estadoSistema.inventariosEnCurso, 'sucursal contando', 'sucursales contando'),
          color: estadoSistema.inventariosEnCurso > 0 ? colors.proceso : undefined,
        },
      ];
    }
  }

  return (
    <PantallaConTabs scrollable contentStyle={styles.contenido}>
      {/* Sin `sede`: el Administrador no pertenece a una sola sucursal. */}
      <BarraApp rotulo="Inicio" sede={nombreSede} cifras={cifras} onSalir={salir} />

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

      <View style={styles.tarjetaEstado}>
        <Text style={styles.estadoTitulo}>{tituloEstado}</Text>
        {cargando ? (
          <ActivityIndicator color={colors.rojo} style={styles.cargandoEstado} />
        ) : errorSistema ? (
          <View style={styles.errorSistema}>
            <Text style={styles.estadoPendiente}>{errorSistema}</Text>
            <Button label="Reintentar" size="sm" onPress={refrescar} />
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
