/**
 * Siembra inventarios CERRADOS en VARIAS tiendas, para poder probar la
 * exportacion CONSOLIDADA (multi-tienda) con datos reales.
 *
 * Hoy la base tiene UNA sola sucursal con UN inventario cerrado (el 34), asi
 * que un export consolidado no se distingue de un export de una tienda: no
 * hay nada que consolidar. Este script arma el escenario que falta.
 *
 * ---------------------------------------------------------------------------
 * QUE HACE, Y POR QUE ES MAS QUE `sembrar-inventario-prueba.ts`
 * ---------------------------------------------------------------------------
 * `sembrar-inventario-prueba.ts` deja el inventario EN CURSO con una hoja
 * contada (opcionalmente finalizada). Eso NO alcanza acá: el consolidado se
 * arma sobre inventarios en `conteo_cerrado` con sus `DiferenciaItem`
 * persistidas, y a ese estado NO se llega finalizando una hoja.
 *
 * Se llega cerrando el CICLO ENTERO, y hay un motivo de dominio: cerrar la
 * ronda 1 con diferencias NO cierra el conteo -- abre la ronda 2 solo con lo
 * que no cuadro (`ciclo-conteos.ts:235#puedeAbrirRondaSiguiente`). El estado
 * `conteo_cerrado` y las `DiferenciaItem` se escriben recien cuando el ciclo
 * termina: o porque todo cuadro, o porque se llego a la 3ra ronda
 * (`rondas.service.ts:452`). Por eso este script recorre las 3 rondas.
 *
 * Por ronda: asignar -> sembrar conteos -> finalizar hojas -> cerrar.
 * Todo con las funciones de servicio REALES (`crearSnapshot`, `crearHojas`,
 * `asignarHojas`, `guardarConteo`, `finalizar`, `cerrar`), nunca con INSERT
 * directo -- asi valen las mismas reglas que si lo hiciera una persona desde
 * el telefono, y los datos sembrados son indistinguibles de los reales para
 * quien despues los exporte.
 *
 * LOS CONTEOS QUE SIEMBRA ESTE SCRIPT SON SOLO PARA DESARROLLO: el numero no
 * lo conto nadie parado en la gondola, lo eligio este script para armar un
 * escenario. Mismo criterio que `sembrar-inventario-prueba.ts`.
 *
 * ---------------------------------------------------------------------------
 * QUE NO HACE (guardas)
 * ---------------------------------------------------------------------------
 * 1. Se niega con NODE_ENV=production.
 * 2. Dry-run por defecto. Sin `--confirmar` no escribe NADA.
 * 3. ADITIVO: no borra ni modifica ninguna sucursal, colaborador o inventario
 *    que ya exista. No hay un solo `delete` ni `deleteMany` en este archivo.
 * 4. PROTEGIDOS por id (`SUCURSALES_PROTEGIDAS` / `INVENTARIOS_PROTEGIDOS`):
 *    el script aborta si una tienda objetivo cae ahi. El inventario 34 y su
 *    sucursal 31 no se tocan ni por accidente.
 * 5. Si una tienda objetivo ya tiene un inventario ABIERTO, la saltea con un
 *    aviso en vez de reusarlo: `crearSnapshot` es idempotente y lo reusaria,
 *    y sembrar conteos sobre un inventario que alguien esta usando es
 *    exactamente lo que este script no puede hacer.
 *
 * ---------------------------------------------------------------------------
 * OJO -- LAS TIENDAS NO EXISTEN TODAVIA
 * ---------------------------------------------------------------------------
 * Al 2026-09-09 la base tiene UNA sucursal: id 31 "Market Bolivar"
 * (almacen MD06_BOL). Las tiendas de `PLAN` NO existen.
 *
 * Por eso crearlas es OPT-IN EXPLICITO con `--crear-tiendas`: sin ese flag el
 * script lista lo que falta y se detiene, sin escribir nada. Crear tiendas es
 * una decision del duenio de la base, no de un script de siembra.
 *
 * Los almacenes de `PLAN` salen de `d365.almacenes-inventario.ts:41-50` (los
 * 10 habilitados para inventario del tenant real) y NINGUNO es MD06_BOL, el
 * de Market Bolivar. Que cada tienda tenga un almacen DISTINTO no es un
 * detalle: es lo que hace que traiga productos y stocks distintos, y que el
 * consolidado se vea de verdad en vez de parecer el mismo inventario tres
 * veces.
 *
 *   npx tsx scripts/sembrar-tiendas-consolidado.ts --dry-run
 *   npx tsx scripts/sembrar-tiendas-consolidado.ts --confirmar --crear-tiendas
 *
 *   --dry-run        Valida todo y describe el plan SIN tocar Dynamics ni la base.
 *   --confirmar      Ejecuta de verdad.
 *   --crear-tiendas  Permite crear las sucursales (y su colaborador de conteo)
 *                    que falten. Sin esto, las que no existan se saltean.
 *   --items <n>      Items por tienda (default 10, igual que el inventario 34).
 *   --solo <cod>     Sembrar SOLO la tienda con ese codigo de almacen. Repetible.
 */
import { prisma } from '../src/config/database';
import { d365AuthService } from '../src/modules/d365/d365-auth.service';
import { crearSnapshot } from '../src/modules/d365/d365-catalogo.service';
import { finalizar, guardarConteo } from '../src/modules/hojas/hojas.service';
import { asignarHojas, crearHojas } from '../src/modules/inventarios/inventarios.service';
import { cerrar } from '../src/modules/inventarios/rondas.service';
import { hashearPin } from '../src/shared/pin';
import type { ColaboradorAutenticado, Rol } from '../src/shared/tipos';

// ---------------------------------------------------------------------------
// Guardas de datos existentes -- ver el bloque 4 de la cabecera.
// ---------------------------------------------------------------------------

/** Sucursal 31 = Market Bolivar, la del inventario 34. NO se toca. */
const SUCURSALES_PROTEGIDAS = new Set<number>([31]);

/** Inventario 34 = el cerrado que ya se usa para probar. NO se toca. */
const INVENTARIOS_PROTEGIDOS = new Set<number>([34]);

/** La minima diferencia que sigue siendo una diferencia real (mismo criterio que sembrar-inventario-prueba.ts). */
const DELTA_AJUSTE = 1;

/** Stock por debajo de esto descalifica a un producto para el papel de FALTANTE. */
const STOCK_MINIMO_FALTANTE = DELTA_AJUSTE + 1;

/** Rondas del ciclo -- espeja `ciclo-conteos.ts:226#RONDAS_DEL_CICLO`. */
const RONDAS_MAXIMAS = 3;

/** PIN de desarrollo de los colaboradores que crea este script. Ver backend/README.md#PIN-de-desarrollo. */
const PIN_DEV = '445566';

type Papel = 'cuadrado' | 'sobrante' | 'faltante';

/**
 * Una tienda del plan.
 *
 * Los perfiles son DISTINTOS a proposito (pedido explicito): si las tres
 * tiendas tuvieran 8/1/1 como el inventario 34, el consolidado mostraria tres
 * filas iguales y no probaria nada. Aca una cuadra casi entera, otra tiene
 * faltante fuerte y otra sobrante fuerte -- que es como se ven tres tiendas
 * de verdad.
 */
interface TiendaDelPlan {
  nombre: string;
  /** Codigo de almacen de Dynamics. De `d365.almacenes-inventario.ts:41-50`. */
  almacenId: string;
  almacenNombre: string;
  /** Nombre del colaborador de conteo que se crea si la tienda es nueva. */
  contador: string;
  dniContador: string;
  cuadrados: number;
  sobrantes: number;
  faltantes: number;
}

const PLAN: TiendaDelPlan[] = [
  {
    nombre: 'Market Luzuriaga',
    almacenId: 'MD01_LUZ',
    almacenNombre: 'ALMACEN DISPONIBLE MARKET LUZURIAGA',
    contador: 'Contador Luzuriaga',
    dniContador: '70010001',
    // Casi todo cuadra: la tienda "sana" del consolidado.
    cuadrados: 9,
    sobrantes: 1,
    faltantes: 0,
  },
  {
    nombre: 'Market Sucre',
    almacenId: 'MD04_SUC',
    almacenNombre: 'ALMACEN DISPONIBLE MARKET SUCRE',
    contador: 'Contador Sucre',
    dniContador: '70010002',
    // Faltante fuerte: la que dispara la conversacion de liquidacion.
    cuadrados: 6,
    sobrantes: 1,
    faltantes: 3,
  },
  {
    nombre: 'Market Carhuaz',
    almacenId: 'MD03_CRH',
    almacenNombre: 'ALMACEN DISPONIBLE MARKET CARHUAZ',
    contador: 'Contador Carhuaz',
    dniContador: '70010003',
    // Sobrante fuerte: el caso opuesto, que suele estar mal cargado en el ERP.
    cuadrados: 6,
    sobrantes: 3,
    faltantes: 1,
  },
];

function leerArg(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** Todos los valores de un argumento repetible (`--solo A --solo B`). */
function leerArgs(nombre: string): string[] {
  const valores: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === nombre && process.argv[i + 1] !== undefined) valores.push(process.argv[i + 1]!);
  });
  return valores;
}

interface CandidatoConStock {
  productoId: number;
  codigo: string;
  descripcion: string;
  stockErp: number;
}

interface FilaSembrada {
  productoId: number;
  codigo: string;
  descripcion: string;
  stockErp: number;
  conteoSembrado: number;
  papel: Papel;
}

/**
 * Reparte candidatos entre los tres papeles. Faltante primero: es el unico
 * con piso de stock, asi que es el que se queda sin candidatos si el catalogo
 * es chico. Devuelve `error` en vez de armar una siembra a medias.
 *
 * Mismo criterio que `sembrar-inventario-prueba.ts:141#repartirPapeles`; se
 * duplica en vez de importarse porque aquel archivo no lo exporta y este
 * script no lo modifica (otros agentes estan trabajando en el repo).
 */
function repartirPapeles(
  candidatos: CandidatoConStock[],
  cuadrados: number,
  sobrantes: number,
  faltantes: number,
): { filas: FilaSembrada[] } | { error: string } {
  const usados = new Set<number>();

  function tomar(cantidad: number, papel: Papel, filtro: (c: CandidatoConStock) => boolean): FilaSembrada[] | null {
    const elegidos: FilaSembrada[] = [];
    for (const c of candidatos) {
      if (elegidos.length >= cantidad) break;
      if (usados.has(c.productoId) || !filtro(c)) continue;
      usados.add(c.productoId);
      const conteoSembrado =
        papel === 'cuadrado'
          ? c.stockErp
          : papel === 'sobrante'
            ? c.stockErp + DELTA_AJUSTE
            : c.stockErp - DELTA_AJUSTE;
      elegidos.push({ ...c, conteoSembrado, papel });
    }
    return elegidos.length === cantidad ? elegidos : null;
  }

  const filasFaltante = tomar(faltantes, 'faltante', (c) => c.stockErp >= STOCK_MINIMO_FALTANTE);
  if (filasFaltante === null) {
    return {
      error: `No hay suficientes productos con stock >= ${STOCK_MINIMO_FALTANTE} para armar ${faltantes} faltante(s).`,
    };
  }
  const filasSobrante = tomar(sobrantes, 'sobrante', () => true);
  if (filasSobrante === null) {
    return { error: `No hay suficientes productos sin usar para armar ${sobrantes} sobrante(s) entre ${candidatos.length}.` };
  }
  const filasCuadrado = tomar(cuadrados, 'cuadrado', () => true);
  if (filasCuadrado === null) {
    return { error: `No hay suficientes productos sin usar para armar ${cuadrados} cuadrado(s) entre ${candidatos.length}.` };
  }
  return { filas: [...filasCuadrado, ...filasSobrante, ...filasFaltante] };
}

/**
 * Siembra los conteos de UNA ronda y finaliza sus hojas.
 *
 * En la ronda 1 el papel de cada producto sale de `repartirPapeles`. En las
 * rondas 2 y 3 vuelven SOLO los que no cuadraron, y se les siembra el MISMO
 * numero que en la ronda anterior a proposito: si en el reconteo cuadraran,
 * el ciclo cerraria sin `DiferenciaItem` y este script no habria armado el
 * escenario que existe para armar. Repetir el conteo es ademas lo que pasa de
 * verdad cuando la diferencia es real y no un error de conteo.
 */
async function sembrarRonda(
  actorContador: ColaboradorAutenticado,
  inventarioId: number,
  ronda: number,
  conteoPorCodigo: Map<string, number>,
): Promise<{ hojas: number; conteos: number }> {
  const hojas = await prisma.hojaConteo.findMany({
    where: { inventarioId, numeroConteo: ronda },
    select: { id: true, productos: { select: { id: true, codigo: true } } },
    orderBy: { id: 'asc' },
  });

  let conteos = 0;
  for (const hoja of hojas) {
    for (const producto of hoja.productos) {
      const sueltas = conteoPorCodigo.get(producto.codigo);
      // Un producto sin conteo planificado se deja sin sembrar: `finalizar`
      // le registra un 0 explicito (hojas.service.ts:551 y su comentario),
      // que es el comportamiento real y no algo que agregue este script.
      if (sueltas === undefined) continue;
      await guardarConteo(actorContador, hoja.id, producto.id, {
        empaques: [],
        sueltas,
        confirmadoPorEscaner: false,
        contadoEn: new Date(),
      });
      conteos++;
    }
    await finalizar(actorContador, hoja.id);
  }
  return { hojas: hojas.length, conteos };
}

interface ResultadoTienda {
  tienda: string;
  almacenId: string;
  sucursalId: number;
  inventarioId: number;
  rondasCerradas: number;
  estadoFinal: string;
  diferencias: number;
  filas: FilaSembrada[];
}

async function sembrarTienda(
  plan: TiendaDelPlan,
  items: number,
  adminId: number,
  crearTiendas: boolean,
): Promise<ResultadoTienda | { salteada: string }> {
  const actorAdmin: ColaboradorAutenticado = { colaboradorId: adminId, sucursalId: null, rol: 'administrador' };

  // --- 1. Sucursal (aditiva: se busca por almacen, se crea solo con el flag)
  let sucursal = await prisma.sucursal.findFirst({
    where: { almacenId: plan.almacenId },
    select: { id: true, nombre: true, almacenId: true },
  });

  if (sucursal && SUCURSALES_PROTEGIDAS.has(sucursal.id)) {
    return { salteada: `la sucursal ${sucursal.id} ("${sucursal.nombre}") esta PROTEGIDA -- no se toca.` };
  }

  if (!sucursal) {
    if (!crearTiendas) {
      return { salteada: `no existe ninguna sucursal con almacen ${plan.almacenId}. Corre con --crear-tiendas para crearla.` };
    }
    sucursal = await prisma.sucursal.create({
      data: { nombre: plan.nombre, almacenId: plan.almacenId, almacenNombre: plan.almacenNombre, activa: true },
      select: { id: true, nombre: true, almacenId: true },
    });
    console.log(`  + sucursal creada: id=${sucursal.id} "${sucursal.nombre}" almacen=${plan.almacenId}`);
  } else {
    console.log(`  = sucursal existente: id=${sucursal.id} "${sucursal.nombre}"`);
  }

  // --- 2. Colaborador de conteo (los conteos se cargan A NOMBRE de alguien)
  let contador = await prisma.colaborador.findFirst({
    where: { sucursalId: sucursal.id, rol: 'conteo', activo: true },
    select: { id: true, nombre: true, rol: true },
    orderBy: { id: 'asc' },
  });

  if (!contador) {
    if (!crearTiendas) {
      return { salteada: `la sucursal ${sucursal.id} no tiene ningun colaborador de conteo activo. Corre con --crear-tiendas.` };
    }
    contador = await prisma.colaborador.create({
      data: {
        nombre: plan.contador,
        dni: plan.dniContador,
        rol: 'conteo',
        sucursalId: sucursal.id,
        pinHash: await hashearPin(PIN_DEV),
        activo: true,
        creadoPorId: adminId,
      },
      select: { id: true, nombre: true, rol: true },
    });
    console.log(`  + contador creado: id=${contador.id} "${contador.nombre}" (PIN de desarrollo: ${PIN_DEV})`);
  } else {
    console.log(`  = contador existente: id=${contador.id} "${contador.nombre}"`);
  }

  const actorContador: ColaboradorAutenticado = {
    colaboradorId: contador.id,
    sucursalId: sucursal.id,
    rol: contador.rol as Rol,
  };

  // --- 3. Inventario. Nunca se reusa uno abierto: ver guarda 5 de la cabecera.
  const abierto = await prisma.inventario.findFirst({
    where: { sucursalId: sucursal.id, abierto: true },
    select: { id: true, estado: true },
  });
  if (abierto) {
    return {
      salteada:
        `la sucursal ${sucursal.id} ya tiene el inventario ${abierto.id} ABIERTO (estado ${abierto.estado}). ` +
        'No se reusa ni se borra: cerralo o elegi otra tienda.',
    };
  }

  console.log(`  ... trayendo catalogo de Dynamics (almacen ${plan.almacenId}, puede tardar)`);
  const snapshot = await crearSnapshot(sucursal.id, 'real', 'mensual', undefined, adminId, items);
  if (INVENTARIOS_PROTEGIDOS.has(snapshot.inventarioId)) {
    // Defensa en profundidad: no deberia pasar (el 34 no esta abierto), pero
    // si `crearSnapshot` devolviera un inventario protegido, se corta ACA,
    // antes de sembrarle un solo conteo encima.
    return { salteada: `crearSnapshot devolvio el inventario PROTEGIDO ${snapshot.inventarioId}. Abortado sin escribir conteos.` };
  }
  if (snapshot.items === 0) {
    return { salteada: `Dynamics no devolvio ningun item con existencia en ${plan.almacenId}.` };
  }
  console.log(`  + inventario ${snapshot.inventarioId}: ${snapshot.items} item(s)`);

  // --- 4. Hojas de la ronda 1
  await crearHojas(actorAdmin, snapshot.inventarioId, items);

  // --- 5. Elegir el papel de cada producto (una vez, con el catalogo real)
  const catalogo = await prisma.catalogoItem.findMany({
    where: { inventarioId: snapshot.inventarioId },
    select: { codigo: true, descripcion: true, stockErp: true },
  });
  const productos = await prisma.producto.findMany({
    where: { hoja: { inventarioId: snapshot.inventarioId, numeroConteo: 1 } },
    select: { id: true, codigo: true, descripcion: true },
    orderBy: { id: 'asc' },
  });
  const stockPorCodigo = new Map(catalogo.map((c) => [c.codigo, c.stockErp]));
  const candidatos: CandidatoConStock[] = productos
    .map((p) => ({ productoId: p.id, codigo: p.codigo, descripcion: p.descripcion, stockErp: stockPorCodigo.get(p.codigo) ?? null }))
    .filter((p): p is CandidatoConStock => p.stockErp !== null);

  const reparto = repartirPapeles(candidatos, plan.cuadrados, plan.sobrantes, plan.faltantes);
  if ('error' in reparto) return { salteada: reparto.error };

  // El conteo se indexa por CODIGO y no por productoId: en las rondas 2 y 3
  // los `Producto` son filas NUEVAS (rondas.service.ts:562 los crea desde el
  // catalogo), asi que el id cambia y el codigo es lo unico estable.
  const conteoPorCodigo = new Map(reparto.filas.map((f) => [f.codigo, f.conteoSembrado]));

  // --- 6. Las 3 rondas: asignar -> sembrar -> finalizar -> cerrar
  let rondasCerradas = 0;
  for (let ronda = 1; ronda <= RONDAS_MAXIMAS; ronda++) {
    const hayHojas = await prisma.hojaConteo.count({ where: { inventarioId: snapshot.inventarioId, numeroConteo: ronda } });
    if (hayHojas === 0) break;

    // Las hojas de la ronda 2 y 3 nacen SIN asignar (rondas.service.ts:558).
    await asignarHojas(actorAdmin, snapshot.inventarioId, [contador.id]);
    const sembrado = await sembrarRonda(actorContador, snapshot.inventarioId, ronda, conteoPorCodigo);
    const cierre = await cerrar(actorAdmin, snapshot.inventarioId, ronda);
    rondasCerradas++;
    console.log(
      `  ronda ${ronda}: ${sembrado.hojas} hoja(s), ${sembrado.conteos} conteo(s) -> ` +
        (cierre.rondaAbierta ? `abre ronda ${cierre.rondaAbierta}` : `CIERRA el conteo (${cierre.motivoSinSiguiente})`),
    );
    if (!cierre.rondaAbierta) break;
  }

  const final = await prisma.inventario.findUniqueOrThrow({
    where: { id: snapshot.inventarioId },
    select: { estado: true, _count: { select: { diferencias: true } } },
  });

  return {
    tienda: sucursal.nombre,
    almacenId: plan.almacenId,
    sucursalId: sucursal.id,
    inventarioId: snapshot.inventarioId,
    rondasCerradas,
    estadoFinal: final.estado,
    diferencias: final._count.diferencias,
    filas: reparto.filas,
  };
}

async function main(): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.error('SE NIEGA: NODE_ENV=production. Este script siembra datos de PRUEBA, nunca corre contra produccion.');
    return 1;
  }

  const modo = process.argv[2];
  if (modo !== '--dry-run' && modo !== '--confirmar') {
    console.error(
      'Uso: npx tsx scripts/sembrar-tiendas-consolidado.ts --dry-run|--confirmar [--crear-tiendas] [--items <n>] [--solo <codigoAlmacen>]',
    );
    return 1;
  }
  const dryRun = modo === '--dry-run';
  const crearTiendas = process.argv.includes('--crear-tiendas');

  const itemsArg = leerArg('--items');
  const items = itemsArg !== undefined ? Number(itemsArg) : 10;
  if (!Number.isInteger(items) || items <= 0) {
    console.error(`--items invalido: "${itemsArg}". Entero mayor a 0.`);
    return 1;
  }

  const solo = leerArgs('--solo');
  const plan = solo.length > 0 ? PLAN.filter((t) => solo.includes(t.almacenId)) : PLAN;
  if (plan.length === 0) {
    console.error(`--solo no coincidio con ninguna tienda del plan. Codigos validos: ${PLAN.map((t) => t.almacenId).join(', ')}.`);
    return 1;
  }

  for (const t of plan) {
    const total = t.cuadrados + t.sobrantes + t.faltantes;
    if (total > items) {
      console.error(`"${t.nombre}": cuadrados+sobrantes+faltantes (${total}) supera --items (${items}).`);
      return 1;
    }
  }

  console.log(`--- Siembra multi-tienda (${dryRun ? 'DRY RUN, no se escribe nada' : 'MODO REAL'}) ---`);
  console.log(`Items por tienda: ${items}`);
  console.log(`Crear tiendas faltantes: ${crearTiendas ? 'SI' : 'no (se saltean)'}`);
  console.log(`Protegidos: sucursal(es) ${[...SUCURSALES_PROTEGIDAS].join(', ')} / inventario(s) ${[...INVENTARIOS_PROTEGIDOS].join(', ')}`);

  console.log('\nPlan:');
  for (const t of plan) {
    const existente = await prisma.sucursal.findFirst({ where: { almacenId: t.almacenId }, select: { id: true, nombre: true } });
    console.log(
      `  ${t.almacenId}  "${t.nombre}"  ${t.cuadrados} cuadrado(s) / ${t.sobrantes} sobrante(s) / ${t.faltantes} faltante(s)  ` +
        (existente ? `[sucursal ${existente.id} YA EXISTE]` : '[NO EXISTE -- necesita --crear-tiendas]'),
    );
  }

  if (dryRun) {
    console.log('\nDRY RUN: no se llamo a Dynamics ni se escribio nada. Corre con --confirmar para ejecutar.');
    return 0;
  }

  if (!(await d365AuthService.isConfigured())) {
    console.error('\nDynamics no esta configurado (ni en la base ni en el .env). Cargalo desde Configuracion antes de correr esto.');
    return 1;
  }

  const admin = await prisma.colaborador.findFirst({ where: { rol: 'administrador', activo: true }, select: { id: true } });
  if (!admin) {
    console.error('No hay ningun administrador activo -- hace falta uno para registrar la auditoria de estas acciones.');
    return 1;
  }

  const resultados: ResultadoTienda[] = [];
  const salteadas: Array<{ tienda: string; motivo: string }> = [];

  for (const t of plan) {
    console.log(`\n--- ${t.nombre} (${t.almacenId}) ---`);
    try {
      const r = await sembrarTienda(t, items, admin.id, crearTiendas);
      if ('salteada' in r) {
        console.log(`  SALTEADA: ${r.salteada}`);
        salteadas.push({ tienda: t.nombre, motivo: r.salteada });
      } else {
        resultados.push(r);
      }
    } catch (e) {
      // Una tienda que falla no aborta las demas: cada una es independiente y
      // media siembra sirve mas que ninguna para probar el consolidado.
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ERROR: ${msg}`);
      salteadas.push({ tienda: t.nombre, motivo: msg });
    }
  }

  console.log('\n=== RESUMEN ===');
  for (const r of resultados) {
    console.log(
      `${r.tienda} (suc ${r.sucursalId}, ${r.almacenId}): inventario ${r.inventarioId} ` +
        `estado=${r.estadoFinal} rondas=${r.rondasCerradas} diferencias=${r.diferencias}`,
    );
    for (const papel of ['sobrante', 'faltante'] as Papel[]) {
      for (const f of r.filas.filter((x) => x.papel === papel)) {
        console.log(`    ${papel.toUpperCase()}  ${f.codigo}  ${f.descripcion}  stock=${f.stockErp} contado=${f.conteoSembrado}`);
      }
    }
  }
  for (const s of salteadas) console.log(`SALTEADA  ${s.tienda}: ${s.motivo}`);

  const cerrados = resultados.filter((r) => r.estadoFinal === 'conteo_cerrado').length;
  console.log(`\n${cerrados} de ${plan.length} tienda(s) quedaron en conteo_cerrado.`);
  console.log('El inventario 34 y la sucursal 31 no fueron tocados.');
  return resultados.length > 0 ? 0 : 1;
}

main()
  .then(async (codigo) => {
    await prisma.$disconnect();
    process.exit(codigo);
  })
  .catch(async (e: unknown) => {
    console.error('[ERROR]', e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });
