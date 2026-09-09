/**
 * Arma un inventario CHICO con productos REALES de Dynamics, para poder
 * probar la app entera (paso 1 a 3 del wizard, Contar, Auditoria,
 * Liquidacion, Historial) sin esperar a bajar y repartir 8.000 items.
 *
 * NADA INVENTADO EN EL CATALOGO: sale del almacen real de la sucursal
 * elegida, via `d365-catalogo.service.ts#crearSnapshot` (las credenciales de
 * Dynamics se leen de la base, cifradas -- nunca del .env directamente, ver
 * d365-auth.service.ts#credenciales). El inventario y las hojas se crean
 * con las funciones de servicio REALES (`crearSnapshot`,
 * `inventarios.service.ts#crearHojas`/`asignarHojas`), nunca con un INSERT
 * directo -- asi valen las mismas reglas que aplicarian si el Coordinador
 * hiciera los mismos pasos desde el telefono (orden por categoria, tamano
 * de hoja, reparto, auditoria de las acciones).
 *
 * IDEMPOTENTE, porque `crearSnapshot` lo es: si la sucursal ya tiene un
 * inventario EN CURSO, lo reusa en vez de crear uno nuevo -- el script lo
 * avisa. `crearHojas` sobre ese inventario es DESTRUCTIVO A PROPOSITO
 * (rehace las hojas) salvo que ya haya conteos cargados, en cuyo caso se
 * niega con 409 -- mismo comportamiento que tiene la app real.
 *
 * LOS CONTEOS QUE SIEMBRA ESTE SCRIPT SON SOLO PARA DESARROLLO.
 *
 * Se cargan con `hojas.service.ts#guardarConteo`, la MISMA funcion que usa
 * el telefono -- asi que valen las mismas reglas de negocio (hoja no
 * finalizada, producto de esa hoja, etc.) -- pero el numero en si NO lo
 * conto nadie parado en la gondola: lo eligio este script para armar un
 * escenario de prueba. El cliente esta evaluando una regla nueva ("el 0 lo
 * pone la persona, no el sistema") que en produccion se aplicaria a
 * `hojas.service.ts#finalizar`; ESTE script sigue sembrando conteos con
 * `--cuadrados`/`--sobrantes`/`--faltantes` porque es una herramienta de
 * DESARROLLO para preparar escenarios de prueba, no el flujo real de
 * conteo -- no representa, ni tiene que representar, como cuenta una
 * persona de verdad.
 *
 *   npx tsx scripts/sembrar-inventario-prueba.ts --dry-run   [--sucursal <id>] [--items <n>] [--asignar <colaboradorId>] [--cuadrados <n>] [--sobrantes <n>] [--faltantes <n>] [--finalizar]
 *   npx tsx scripts/sembrar-inventario-prueba.ts --confirmar [--sucursal <id>] [--items <n>] [--asignar <colaboradorId>] [--cuadrados <n>] [--sobrantes <n>] [--faltantes <n>] [--finalizar]
 *
 *   --sucursal   Id de la sucursal. Si se omite y hay UNA sola en la base, se
 *                usa esa; con cero o mas de una, el script se niega y lista
 *                las opciones.
 *   --items      Cuantos productos con existencia traer (default 10). Se
 *                arma UNA sola hoja de ese tamano.
 *   --asignar    Id de un colaborador de esa misma sucursal, activo, al que
 *                repartirle la hoja recien creada. OBLIGATORIO si se va a
 *                sembrar algun conteo (cuadrados+sobrantes+faltantes > 0) o
 *                si se pasa --finalizar: los conteos se cargan A NOMBRE de
 *                quien tiene la hoja asignada -- sin asignar, no hay a
 *                nombre de quien cargarlos.
 *   --cuadrados  Cuantos productos sembrar con conteo IGUAL al stock del ERP
 *                (default 8).
 *   --sobrantes  Cuantos con conteo MAYOR al stock del ERP (default 1).
 *   --faltantes  Cuantos con conteo MENOR al stock del ERP (default 1).
 *   --finalizar  Ademas deja la hoja FINALIZADA, para probar el cierre de
 *                ronda de una. Default: NO (la hoja queda en-proceso, como
 *                cualquier hoja a medio contar).
 *
 * cuadrados+sobrantes+faltantes no puede superar --items -- el script se
 * niega antes de tocar Dynamics si no cierra la cuenta.
 *
 * DEFINICIONES (sin ambiguedad, pedidas por el cliente):
 *   cuadrado  = conteo sembrado IGUAL al stock del ERP de ese producto.
 *   sobrante  = conteo sembrado MAYOR (stock + 1 unidad).
 *   faltante  = conteo sembrado MENOR (stock - 1 unidad; nunca negativo).
 *
 * DELTA = 1 unidad: la minima diferencia que sigue siendo una diferencia
 * real (no un empate) y nunca deja un conteo negativo. Para el papel de
 * FALTANTE, un producto con stock 0 o 1 queda DESCALIFICADO (stock 0 - 1 es
 * negativo; stock 1 - 1 da un conteo en cero, que es indistinguible de "no
 * se conto nada") -- el script elige otro producto con stock >= 2 para ese
 * papel, y lo dice en la tabla final (se ve el stock real de cada elegido).
 * `crearSnapshot` ya trae solo items CON existencia real (stockErp > 0 --
 * ver d365-catalogo.service.ts#tieneExistencia), asi que en la practica el
 * unico stock descalificante que puede aparecer es 1, no 0.
 *
 * DRY RUN: valida sucursal/almacen/Dynamics-configurado/colaborador/los
 * numeros de cuadrados-sobrantes-faltantes SIN llamar a Dynamics ni crear
 * nada -- traer el catalogo real ya es la parte lenta que este script existe
 * para evitar, asi que el dry-run no la hace. Por eso el dry-run describe el
 * PLAN (cuantos de cada papel, el delta, a nombre de quien) pero no puede
 * decir todavia CUALES productos van a tocarle a cada papel: eso depende del
 * catalogo real, que recien se conoce en --confirmar.
 */
import { prisma } from '../src/config/database';
import { d365AuthService } from '../src/modules/d365/d365-auth.service';
import { crearSnapshot } from '../src/modules/d365/d365-catalogo.service';
import { finalizar, guardarConteo } from '../src/modules/hojas/hojas.service';
import { asignarHojas, crearHojas } from '../src/modules/inventarios/inventarios.service';
import type { ColaboradorAutenticado, Rol } from '../src/shared/tipos';

/** La minima diferencia que sigue siendo una diferencia real -- ver el comentario de cabecera. */
const DELTA_AJUSTE = 1;

/** Stock por debajo de este valor descalifica a un producto para el papel de FALTANTE (ver cabecera). */
const STOCK_MINIMO_FALTANTE = DELTA_AJUSTE + 1;

type Papel = 'cuadrado' | 'sobrante' | 'faltante';

const ETIQUETA_PAPEL: Record<Papel, string> = {
  cuadrado: 'CUADRADO',
  sobrante: 'SOBRANTE',
  faltante: 'FALTANTE',
};

function leerArg(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** Entero >= 0 desde un argumento con default. Devuelve `null` si vino invalido. */
function leerEntero(nombre: string, porDefecto: number): number | null {
  const valor = leerArg(nombre);
  if (valor === undefined) return porDefecto;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

interface CandidatoConStock {
  id: number;
  codigo: string;
  descripcion: string;
  stockErp: number;
}

interface FilaSembrada {
  codigo: string;
  descripcion: string;
  stockErp: number;
  conteoSembrado: number;
  papel: Papel;
  productoId: number;
}

/**
 * Reparte los candidatos entre los tres papeles, EN ORDEN de restriccion:
 * primero faltante (el unico con un piso de stock), despues sobrante y
 * cuadrado (sin restriccion). Devuelve `null` si no alcanzan los candidatos
 * para completar algun papel -- nunca arma una siembra a medias.
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
      if (usados.has(c.id) || !filtro(c)) continue;
      usados.add(c.id);
      const conteoSembrado =
        papel === 'cuadrado' ? c.stockErp : papel === 'sobrante' ? c.stockErp + DELTA_AJUSTE : c.stockErp - DELTA_AJUSTE;
      elegidos.push({ codigo: c.codigo, descripcion: c.descripcion, stockErp: c.stockErp, conteoSembrado, papel, productoId: c.id });
    }
    return elegidos.length === cantidad ? elegidos : null;
  }

  // Faltante primero: es el unico papel con un piso de stock, asi que es el
  // que se queda sin candidatos primero si el catalogo es chico.
  const filasFaltante = tomar(faltantes, 'faltante', (c) => c.stockErp >= STOCK_MINIMO_FALTANTE);
  if (filasFaltante === null) {
    return {
      error:
        `No hay suficientes productos con stock >= ${STOCK_MINIMO_FALTANTE} para armar ${faltantes} faltante(s) ` +
        `(un producto con stock 0 o 1 no puede ser faltante sin quedar en cero o negativo). ` +
        `Proba con --items mas grande o --faltantes mas chico.`,
    };
  }
  const filasSobrante = tomar(sobrantes, 'sobrante', () => true);
  if (filasSobrante === null) {
    return { error: `No hay suficientes productos sin usar para armar ${sobrantes} sobrante(s) entre los ${candidatos.length} traidos.` };
  }
  const filasCuadrado = tomar(cuadrados, 'cuadrado', () => true);
  if (filasCuadrado === null) {
    return { error: `No hay suficientes productos sin usar para armar ${cuadrados} cuadrado(s) entre los ${candidatos.length} traidos.` };
  }

  return { filas: [...filasCuadrado, ...filasSobrante, ...filasFaltante] };
}

function imprimirTabla(filas: FilaSembrada[]): void {
  for (const papel of ['cuadrado', 'sobrante', 'faltante'] as Papel[]) {
    const delPapel = filas.filter((f) => f.papel === papel);
    if (delPapel.length === 0) continue;
    console.log(`\n  ${ETIQUETA_PAPEL[papel]} (${delPapel.length}):`);
    for (const f of delPapel) {
      console.log(`    ${f.codigo}  ${f.descripcion}  stockErp=${f.stockErp}  conteoSembrado=${f.conteoSembrado}`);
    }
  }
}

async function main(): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.error('SE NIEGA: NODE_ENV=production. Este script siembra datos de PRUEBA, nunca corre contra produccion.');
    return 1;
  }

  const modo = process.argv[2];
  if (modo !== '--dry-run' && modo !== '--confirmar') {
    console.error(
      'Uso: npx tsx scripts/sembrar-inventario-prueba.ts --dry-run|--confirmar [--sucursal <id>] [--items <n>] ' +
        '[--asignar <colaboradorId>] [--cuadrados <n>] [--sobrantes <n>] [--faltantes <n>] [--finalizar]',
    );
    return 1;
  }
  const dryRun = modo === '--dry-run';
  const finalizarHoja = process.argv.includes('--finalizar');

  const itemsArg = leerArg('--items');
  const items = itemsArg !== undefined ? Number(itemsArg) : 10;
  if (!Number.isInteger(items) || items <= 0) {
    console.error(`--items invalido: "${itemsArg}". Tiene que ser un entero mayor a 0.`);
    return 1;
  }

  const cuadrados = leerEntero('--cuadrados', 8);
  const sobrantes = leerEntero('--sobrantes', 1);
  const faltantes = leerEntero('--faltantes', 1);
  if (cuadrados === null) {
    console.error(`--cuadrados invalido: "${leerArg('--cuadrados')}". Tiene que ser un entero >= 0.`);
    return 1;
  }
  if (sobrantes === null) {
    console.error(`--sobrantes invalido: "${leerArg('--sobrantes')}". Tiene que ser un entero >= 0.`);
    return 1;
  }
  if (faltantes === null) {
    console.error(`--faltantes invalido: "${leerArg('--faltantes')}". Tiene que ser un entero >= 0.`);
    return 1;
  }
  const totalASembrar = cuadrados + sobrantes + faltantes;
  if (totalASembrar > items) {
    console.error(
      `--cuadrados + --sobrantes + --faltantes (${cuadrados} + ${sobrantes} + ${faltantes} = ${totalASembrar}) ` +
        `no puede superar --items (${items}).`,
    );
    return 1;
  }

  const sucursalArg = leerArg('--sucursal');
  let sucursalId: number;
  if (sucursalArg !== undefined) {
    sucursalId = Number(sucursalArg);
    if (!Number.isInteger(sucursalId) || sucursalId <= 0) {
      console.error(`--sucursal invalido: "${sucursalArg}".`);
      return 1;
    }
  } else {
    const sucursales = await prisma.sucursal.findMany({ select: { id: true, nombre: true } });
    if (sucursales.length === 0) {
      console.error('No hay ninguna sucursal en la base. Crea una primero o pasa --sucursal <id>.');
      return 1;
    }
    if (sucursales.length > 1) {
      console.error(
        `Hay ${sucursales.length} sucursales, hace falta --sucursal <id>: ` +
          sucursales.map((s) => `${s.id} (${s.nombre})`).join(', '),
      );
      return 1;
    }
    sucursalId = sucursales[0]!.id;
  }

  const sucursal = await prisma.sucursal.findUnique({
    where: { id: sucursalId },
    select: { id: true, nombre: true, almacenId: true, activa: true },
  });
  if (!sucursal) {
    console.error(`No existe la sucursal ${sucursalId}.`);
    return 1;
  }
  if (!sucursal.almacenId) {
    console.error(`La sucursal "${sucursal.nombre}" (id ${sucursal.id}) no tiene almacen de Dynamics asociado -- asignale uno primero (pantalla Tiendas).`);
    return 1;
  }

  const dynamicsConfigurado = await d365AuthService.isConfigured();
  if (!dynamicsConfigurado) {
    console.error('Dynamics no esta configurado (ni en la base ni en el .env). Cargalo desde Configuracion antes de correr esto.');
    return 1;
  }

  const asignarArg = leerArg('--asignar');
  let colaboradorAsignar: { id: number; nombre: string; rol: Rol } | null = null;
  if (asignarArg !== undefined) {
    const id = Number(asignarArg);
    if (!Number.isInteger(id) || id <= 0) {
      console.error(`--asignar invalido: "${asignarArg}".`);
      return 1;
    }
    const c = await prisma.colaborador.findUnique({
      where: { id },
      select: { id: true, nombre: true, sucursalId: true, activo: true, rol: true },
    });
    if (!c) {
      console.error(`No existe el colaborador ${id}.`);
      return 1;
    }
    if (!c.activo) {
      console.error(`El colaborador ${id} ("${c.nombre}") esta deshabilitado.`);
      return 1;
    }
    if (c.sucursalId !== sucursalId) {
      console.error(`El colaborador ${id} ("${c.nombre}") no es de la sucursal ${sucursalId}.`);
      return 1;
    }
    colaboradorAsignar = { id: c.id, nombre: c.nombre, rol: c.rol as Rol };
  }

  // Los conteos y el finalizado se cargan A NOMBRE de quien tiene la hoja
  // asignada -- sin --asignar no hay a nombre de quien cargarlos.
  if (colaboradorAsignar === null && (totalASembrar > 0 || finalizarHoja)) {
    console.error(
      'Hace falta --asignar <colaboradorId>: los conteos (y el --finalizar) se cargan a nombre de quien tiene la hoja ' +
        'asignada. Si solo queres armar la hoja sin conteos, pasa --cuadrados 0 --sobrantes 0 --faltantes 0.',
    );
    return 1;
  }

  console.log(`--- Resumen (${dryRun ? 'DRY RUN, no se toca Dynamics ni la base' : 'MODO REAL'}) ---`);
  console.log(`Sucursal: id=${sucursal.id} nombre="${sucursal.nombre}" almacen=${sucursal.almacenId}`);
  console.log(`Items a traer (con existencia real en ese almacen): ${items}`);
  console.log(`Dynamics configurado: si`);
  console.log(
    colaboradorAsignar
      ? `Se asignaria la hoja a: id=${colaboradorAsignar.id} nombre="${colaboradorAsignar.nombre}"`
      : 'No se asignara la hoja a nadie (falta --asignar <colaboradorId>).',
  );
  console.log(
    `Conteos a sembrar: ${cuadrados} cuadrado(s) + ${sobrantes} sobrante(s) + ${faltantes} faltante(s) = ${totalASembrar} de ${items} items ` +
      `(delta +-${DELTA_AJUSTE} unidad, ronda 1).`,
  );
  if (items - totalASembrar > 0) {
    console.log(`${items - totalASembrar} item(s) de la hoja quedarian SIN conteo sembrado.`);
  }
  console.log(`Finalizar la hoja despues de sembrar: ${finalizarHoja ? 'SI' : 'no'}`);
  if (finalizarHoja && items - totalASembrar > 0) {
    console.log(
      `AVISO: al finalizar, los ${items - totalASembrar} item(s) sin conteo sembrado van a registrarse en 0 -- ` +
        'comportamiento EXISTENTE de hojas.service.ts#finalizar (el sistema completa lo que quedo sin contar), no algo que agregue este script.',
    );
  }

  const existente = await prisma.inventario.findFirst({ where: { sucursalId, abierto: true } });
  if (existente) {
    console.log(
      `\nAVISO: la sucursal ya tiene un inventario EN CURSO (id=${existente.id}). crearSnapshot es idempotente: lo va a REUSAR (con su catalogo actual) en vez de bajar uno nuevo de Dynamics.`,
    );
  }

  if (dryRun) {
    console.log('\nDRY RUN: no se llamo a Dynamics ni se creo nada. Correr con --confirmar para ejecutar.');
    console.log('(Que producto en concreto le toca a cada papel se decide con el catalogo real, recien en --confirmar.)');
    return 0;
  }

  const admin = await prisma.colaborador.findFirst({ where: { rol: 'administrador' }, select: { id: true } });
  if (!admin) {
    console.error('No hay ningun administrador en la base -- hace falta uno para registrar la auditoria de estas acciones.');
    return 1;
  }
  const actorAdmin: ColaboradorAutenticado = { colaboradorId: admin.id, sucursalId: null, rol: 'administrador' };

  console.log('\nTrayendo catalogo real de Dynamics (la primera vez puede tardar)...');
  const snapshot = await crearSnapshot(sucursalId, 'real', 'mensual', undefined, admin.id, items);
  console.log(`Inventario ${snapshot.inventarioId}: ${snapshot.items} item(s) con existencia.`);
  if (snapshot.items === 0) {
    console.error('Dynamics no devolvio ningun item con existencia en ese almacen. No se pueden crear hojas.');
    return 1;
  }

  const hojas = await crearHojas(actorAdmin, snapshot.inventarioId, items);
  const hoja = hojas[0];
  if (!hoja) {
    console.error('crearHojas no devolvio ninguna hoja.');
    return 1;
  }

  let asignados: string[] = [];
  if (colaboradorAsignar) {
    const repartidas = await asignarHojas(actorAdmin, snapshot.inventarioId, [colaboradorAsignar.id]);
    const repartida = repartidas.find((h) => h.numero === hoja.numero) ?? repartidas[0];
    asignados = repartida?.asignados ?? [];
  }

  const catalogoItems = await prisma.catalogoItem.findMany({
    where: { inventarioId: snapshot.inventarioId },
    orderBy: { id: 'asc' },
    select: { codigo: true, descripcion: true, stockErp: true },
  });

  let filasSembradas: FilaSembrada[] = [];
  if (totalASembrar > 0) {
    if (!colaboradorAsignar) {
      // Ya se valido arriba, pero el tipo de TS no lo sabe en este punto --
      // asi queda explicito que este camino es inalcanzable, no un `!`.
      throw new Error('Estado inalcanzable: totalASembrar > 0 sin colaboradorAsignar.');
    }

    // Los productos de LA HOJA, no del inventario entero -- `--items` arma
    // una sola hoja con todo el catalogo, asi que hoy coinciden, pero la
    // consulta es por hoja porque es a esos `Producto` (no `CatalogoItem`)
    // a los que apunta `guardarConteo`.
    const productos = await prisma.producto.findMany({
      where: { hojaId: hoja.id },
      orderBy: { id: 'asc' },
      select: { id: true, codigo: true, descripcion: true },
    });
    const stockPorCodigo = new Map(catalogoItems.map((c) => [c.codigo, c.stockErp]));
    // Solo candidatos con stock CONOCIDO -- sin esto no hay con que comparar
    // ninguno de los tres papeles. `crearSnapshot` ya filtra a stock > 0
    // (ver el comentario de cabecera), asi que en la practica esto no
    // descarta nada, pero no se asume el invariante sin chequearlo.
    const candidatos: CandidatoConStock[] = productos
      .map((p) => ({ id: p.id, codigo: p.codigo, descripcion: p.descripcion, stockErp: stockPorCodigo.get(p.codigo) ?? null }))
      .filter((p): p is CandidatoConStock => p.stockErp !== null);

    const reparto = repartirPapeles(candidatos, cuadrados, sobrantes, faltantes);
    if ('error' in reparto) {
      console.error(`\n${reparto.error}`);
      return 1;
    }
    filasSembradas = reparto.filas;

    const actorColaborador: ColaboradorAutenticado = {
      colaboradorId: colaboradorAsignar.id,
      sucursalId,
      rol: colaboradorAsignar.rol,
    };
    for (const fila of filasSembradas) {
      await guardarConteo(actorColaborador, hoja.id, fila.productoId, {
        empaques: [],
        sueltas: fila.conteoSembrado,
        confirmadoPorEscaner: false,
        contadoEn: new Date(),
      });
    }

    if (finalizarHoja) {
      await finalizar(actorColaborador, hoja.id);
    }
  }

  console.log('\nListo.');
  console.log(`Inventario: ${snapshot.inventarioId}`);
  console.log(`Hoja: #${hoja.numero}${finalizarHoja && totalASembrar > 0 ? ' (FINALIZADA)' : ''}`);
  console.log(`Items (${catalogoItems.length}):`);
  for (const item of catalogoItems) {
    console.log(`  ${item.codigo}  ${item.descripcion}  stock=${item.stockErp ?? 's/d'}`);
  }
  console.log(`Asignada a: ${asignados.length > 0 ? asignados.join(' y ') : '(nadie -- falta --asignar)'}`);

  if (filasSembradas.length > 0) {
    console.log(`\nConteos sembrados en la ronda 1 (a nombre de ${colaboradorAsignar!.nombre}):`);
    imprimirTabla(filasSembradas);
    const sinSembrar = catalogoItems.length - filasSembradas.length;
    if (sinSembrar > 0) {
      console.log(`\n${sinSembrar} item(s) de la hoja SIN conteo sembrado.`);
    }
  }

  return 0;
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
