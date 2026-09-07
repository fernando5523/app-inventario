/**
 * Arma un inventario CHICO con productos REALES de Dynamics, para poder
 * probar la app entera (paso 1 a 3 del wizard, Contar, Auditoria,
 * Liquidacion, Historial) sin esperar a bajar y repartir 8.000 items.
 *
 * NADA INVENTADO: el catalogo sale del almacen real de la sucursal elegida,
 * via `d365-catalogo.service.ts#crearSnapshot` (las credenciales de
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
 *   npx tsx scripts/sembrar-inventario-prueba.ts --dry-run   [--sucursal <id>] [--items <n>] [--asignar <colaboradorId>]
 *   npx tsx scripts/sembrar-inventario-prueba.ts --confirmar [--sucursal <id>] [--items <n>] [--asignar <colaboradorId>]
 *
 *   --sucursal  Id de la sucursal. Si se omite y hay UNA sola en la base, se
 *               usa esa; con cero o mas de una, el script se niega y lista
 *               las opciones.
 *   --items     Cuantos productos con existencia traer (default 10). Se
 *               arma UNA sola hoja de ese tamano.
 *   --asignar   Id de un colaborador de esa misma sucursal, activo, al que
 *               repartirle la hoja recien creada. Sin esto, la hoja queda
 *               sin asignar (igual que un Coordinador que todavia no llego
 *               al paso 3 del wizard).
 *
 * DRY RUN: valida sucursal/almacen/Dynamics-configurado/colaborador SIN
 * llamar a Dynamics ni crear nada -- traer el catalogo real ya es la parte
 * lenta que este script existe para evitar, asi que el dry-run no la hace.
 */
import { prisma } from '../src/config/database';
import { d365AuthService } from '../src/modules/d365/d365-auth.service';
import { crearSnapshot } from '../src/modules/d365/d365-catalogo.service';
import { asignarHojas, crearHojas } from '../src/modules/inventarios/inventarios.service';
import type { ColaboradorAutenticado } from '../src/shared/tipos';

function leerArg(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.error('SE NIEGA: NODE_ENV=production. Este script siembra datos de PRUEBA, nunca corre contra produccion.');
    return 1;
  }

  const modo = process.argv[2];
  if (modo !== '--dry-run' && modo !== '--confirmar') {
    console.error(
      'Uso: npx tsx scripts/sembrar-inventario-prueba.ts --dry-run|--confirmar [--sucursal <id>] [--items <n>] [--asignar <colaboradorId>]',
    );
    return 1;
  }
  const dryRun = modo === '--dry-run';

  const itemsArg = leerArg('--items');
  const items = itemsArg !== undefined ? Number(itemsArg) : 10;
  if (!Number.isInteger(items) || items <= 0) {
    console.error(`--items invalido: "${itemsArg}". Tiene que ser un entero mayor a 0.`);
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
  let colaboradorAsignar: { id: number; nombre: string } | null = null;
  if (asignarArg !== undefined) {
    const id = Number(asignarArg);
    if (!Number.isInteger(id) || id <= 0) {
      console.error(`--asignar invalido: "${asignarArg}".`);
      return 1;
    }
    const c = await prisma.colaborador.findUnique({
      where: { id },
      select: { id: true, nombre: true, sucursalId: true, activo: true },
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
    colaboradorAsignar = c;
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

  const existente = await prisma.inventario.findFirst({ where: { sucursalId, abierto: true } });
  if (existente) {
    console.log(
      `\nAVISO: la sucursal ya tiene un inventario EN CURSO (id=${existente.id}). crearSnapshot es idempotente: lo va a REUSAR (con su catalogo actual) en vez de bajar uno nuevo de Dynamics.`,
    );
  }

  if (dryRun) {
    console.log('\nDRY RUN: no se llamo a Dynamics ni se creo nada. Correr con --confirmar para ejecutar.');
    return 0;
  }

  const admin = await prisma.colaborador.findFirst({ where: { rol: 'administrador' }, select: { id: true } });
  if (!admin) {
    console.error('No hay ningun administrador en la base -- hace falta uno para registrar la auditoria de estas acciones.');
    return 1;
  }
  const actor: ColaboradorAutenticado = { colaboradorId: admin.id, sucursalId: null, rol: 'administrador' };

  console.log('\nTrayendo catalogo real de Dynamics (la primera vez puede tardar)...');
  const snapshot = await crearSnapshot(sucursalId, 'real', 'mensual', undefined, admin.id, items);
  console.log(`Inventario ${snapshot.inventarioId}: ${snapshot.items} item(s) con existencia.`);
  if (snapshot.items === 0) {
    console.error('Dynamics no devolvio ningun item con existencia en ese almacen. No se pueden crear hojas.');
    return 1;
  }

  const hojas = await crearHojas(actor, snapshot.inventarioId, items);
  const hoja = hojas[0];
  if (!hoja) {
    console.error('crearHojas no devolvio ninguna hoja.');
    return 1;
  }

  let asignados: string[] = [];
  if (colaboradorAsignar) {
    const repartidas = await asignarHojas(actor, snapshot.inventarioId, [colaboradorAsignar.id]);
    const repartida = repartidas.find((h) => h.numero === hoja.numero) ?? repartidas[0];
    asignados = repartida?.asignados ?? [];
  }

  const catalogoItems = await prisma.catalogoItem.findMany({
    where: { inventarioId: snapshot.inventarioId },
    orderBy: { id: 'asc' },
    select: { codigo: true, descripcion: true, stockErp: true },
  });

  console.log('\nListo.');
  console.log(`Inventario: ${snapshot.inventarioId}`);
  console.log(`Hoja: #${hoja.numero}`);
  console.log(`Items (${catalogoItems.length}):`);
  for (const item of catalogoItems) {
    console.log(`  ${item.codigo}  ${item.descripcion}  stock=${item.stockErp ?? 's/d'}`);
  }
  console.log(`Asignada a: ${asignados.length > 0 ? asignados.join(' y ') : '(nadie -- falta --asignar)'}`);

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
