/**
 * Deja UNA HOJA ABIERTA, asignada y SIN NINGUN CONTEO, para poder probar la
 * pantalla de Contar en la app: el modal de filtros, el campo de conteo
 * vacio y el gate de finalizar.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO SE PUEDE HACER EN MARKET BOLIVAR (lo pedido originalmente)
 * ---------------------------------------------------------------------------
 * Se pidio la hoja en Market Bolivar (sucursal 31) para el Contador
 * (colaborador 65). NO SE PUEDE sin tocar el inventario 34, y el 34 es
 * justamente lo que hay que preservar:
 *
 *   `schema.prisma:416` declara `@@unique([sucursalId, abierto])`. El
 *   inventario 34 esta `conteo_cerrado` PERO con `abierto: true` -- un
 *   inventario sigue ocupando su sucursal hasta que se lacra. Mientras eso
 *   siga asi, la sucursal 31 no admite otro inventario: `crearSnapshot` es
 *   idempotente y devolveria el 34 mismo.
 *
 * Las dos salidas que respetarian "Bolivar" rompen algo:
 *   a) Liberar la sucursal (`abierto: null`) = simular un lacrado que no
 *      ocurrio. El 34 se usa para probar la exportacion; falsear su ciclo de
 *      vida es exactamente lo que no se puede hacer en un sistema que se
 *      audita.
 *   b) Agregar una ronda 4 al 34. La matriz de auditoria lee rondas 1/2/3
 *      fijas (`auditoria.service.ts:171-173`), asi que la ronda 4 seria
 *      invisible ahi -- pero quedaria una hoja SIN CONTAR colgando de un
 *      inventario ya CERRADO. Es un estado que el dominio no contempla, y el
 *      proximo que mire el 34 no va a saber si esta cerrado o a medio contar.
 *
 * Por eso este script arma una tienda DEDICADA a la prueba de conteo, con su
 * propio contador. La pantalla de Contar se prueba igual: lo que se valida es
 * la pantalla, no de que tienda es la hoja.
 *
 * ---------------------------------------------------------------------------
 * QUE DEJA
 * ---------------------------------------------------------------------------
 * Inventario `en_curso`, ronda 1, UNA hoja `pendiente` asignada al contador,
 * con sus N productos y CERO conteos. Nada finalizado: el gate de finalizar
 * se prueba desde el unico estado donde tiene sentido probarlo.
 *
 * NO se siembra ningun conteo A PROPOSITO. `sembrar-inventario-prueba.ts`
 * existe para el caso contrario (hoja ya contada); este script existe para
 * dejarla vacia.
 *
 * GUARDAS: NODE_ENV != production; dry-run por defecto; ADITIVO (ni un solo
 * delete en el archivo); sucursal 31 e inventario 34 PROTEGIDOS -- si la
 * tienda objetivo o el inventario resultante cae ahi, aborta sin escribir.
 *
 *   npx tsx scripts/sembrar-hoja-abierta.ts --dry-run
 *   npx tsx scripts/sembrar-hoja-abierta.ts --confirmar
 *
 *   --items <n>  Productos de la hoja (default 10).
 */
import { prisma } from '../src/config/database';
import { d365AuthService } from '../src/modules/d365/d365-auth.service';
import { crearSnapshot } from '../src/modules/d365/d365-catalogo.service';
import { asignarHojas, crearHojas } from '../src/modules/inventarios/inventarios.service';
import { hashearPin } from '../src/shared/pin';
import type { ColaboradorAutenticado } from '../src/shared/tipos';

const SUCURSALES_PROTEGIDAS = new Set<number>([31]);
const INVENTARIOS_PROTEGIDOS = new Set<number>([34]);

/** Almacen habilitado y libre -- ver `d365.almacenes-inventario.ts:41-50`. */
const ALMACEN = 'MD02_JRC';
const ALMACEN_NOMBRE = 'ALMACEN DISPONIBLE MARKET JIRON COMERCIO';
const TIENDA = 'Market Prueba Conteo';
const CONTADOR = 'Contador Prueba';
const DNI_CONTADOR = '70020001';

/**
 * PIN de desarrollo. Mismo patron que el resto de la base (el id con ceros a
 * 6 digitos) NO se puede usar acá: el id lo asigna Postgres al insertar, y el
 * PIN se hashea en el mismo `create`. Se usa uno fijo y se imprime.
 */
const PIN_DEV = '000111';

function leerArg(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.error('SE NIEGA: NODE_ENV=production. Este script siembra datos de PRUEBA.');
    return 1;
  }

  const modo = process.argv[2];
  if (modo !== '--dry-run' && modo !== '--confirmar') {
    console.error('Uso: npx tsx scripts/sembrar-hoja-abierta.ts --dry-run|--confirmar [--items <n>]');
    return 1;
  }
  const dryRun = modo === '--dry-run';

  const itemsArg = leerArg('--items');
  const items = itemsArg !== undefined ? Number(itemsArg) : 10;
  if (!Number.isInteger(items) || items <= 0) {
    console.error(`--items invalido: "${itemsArg}". Entero mayor a 0.`);
    return 1;
  }

  console.log(`--- Hoja abierta para probar Contar (${dryRun ? 'DRY RUN' : 'MODO REAL'}) ---`);
  console.log(`Tienda: "${TIENDA}" (almacen ${ALMACEN})`);
  console.log(`Items: ${items} · conteos a sembrar: 0 (la hoja queda VACIA a proposito)`);
  console.log(`Protegidos: sucursal(es) ${[...SUCURSALES_PROTEGIDAS].join(', ')} / inventario(s) ${[...INVENTARIOS_PROTEGIDOS].join(', ')}`);

  const yaExiste = await prisma.sucursal.findFirst({
    where: { almacenId: ALMACEN },
    select: { id: true, nombre: true },
  });
  console.log(yaExiste ? `Sucursal existente: id=${yaExiste.id} "${yaExiste.nombre}"` : 'Sucursal: se va a CREAR.');

  if (dryRun) {
    console.log('\nDRY RUN: no se llamo a Dynamics ni se escribio nada. Corre con --confirmar.');
    return 0;
  }

  if (!(await d365AuthService.isConfigured())) {
    console.error('Dynamics no esta configurado. Cargalo desde Configuracion antes de correr esto.');
    return 1;
  }

  const admin = await prisma.colaborador.findFirst({ where: { rol: 'administrador', activo: true }, select: { id: true } });
  if (!admin) {
    console.error('No hay ningun administrador activo -- hace falta uno para la auditoria de estas acciones.');
    return 1;
  }
  const actorAdmin: ColaboradorAutenticado = { colaboradorId: admin.id, sucursalId: null, rol: 'administrador' };

  let sucursal = yaExiste;
  if (sucursal && SUCURSALES_PROTEGIDAS.has(sucursal.id)) {
    console.error(`La sucursal ${sucursal.id} esta PROTEGIDA. Abortado.`);
    return 1;
  }
  if (!sucursal) {
    sucursal = await prisma.sucursal.create({
      data: { nombre: TIENDA, almacenId: ALMACEN, almacenNombre: ALMACEN_NOMBRE, activa: true },
      select: { id: true, nombre: true },
    });
    console.log(`+ sucursal creada: id=${sucursal.id} "${sucursal.nombre}"`);
  }

  let contador = await prisma.colaborador.findFirst({
    where: { sucursalId: sucursal.id, rol: 'conteo', activo: true },
    select: { id: true, nombre: true },
    orderBy: { id: 'asc' },
  });
  let pinDelContador = '(el que ya tenia -- no se cambia)';
  if (!contador) {
    contador = await prisma.colaborador.create({
      data: {
        nombre: CONTADOR,
        dni: DNI_CONTADOR,
        rol: 'conteo',
        sucursalId: sucursal.id,
        pinHash: await hashearPin(PIN_DEV),
        activo: true,
        creadoPorId: admin.id,
      },
      select: { id: true, nombre: true },
    });
    pinDelContador = PIN_DEV;
    console.log(`+ contador creado: id=${contador.id} "${contador.nombre}"`);
  }

  const abierto = await prisma.inventario.findFirst({
    where: { sucursalId: sucursal.id, abierto: true },
    select: { id: true, estado: true },
  });
  if (abierto) {
    // Ver el bloque de cabecera: un inventario abierto ocupa la sucursal.
    console.error(
      `La sucursal ${sucursal.id} ya tiene el inventario ${abierto.id} ABIERTO (${abierto.estado}). ` +
        'No se reusa ni se borra. Si querés rehacer la prueba, cerralo o usá otro almacén.',
    );
    return 1;
  }

  console.log(`\nTrayendo catalogo de Dynamics (almacen ${ALMACEN}, puede tardar)...`);
  const snapshot = await crearSnapshot(sucursal.id, 'real', 'mensual', undefined, admin.id, items);
  if (INVENTARIOS_PROTEGIDOS.has(snapshot.inventarioId)) {
    console.error(`crearSnapshot devolvio el inventario PROTEGIDO ${snapshot.inventarioId}. Abortado sin escribir nada mas.`);
    return 1;
  }
  if (snapshot.items === 0) {
    console.error(`Dynamics no devolvio ningun item con existencia en ${ALMACEN}.`);
    return 1;
  }
  console.log(`+ inventario ${snapshot.inventarioId}: ${snapshot.items} item(s)`);

  const hojas = await crearHojas(actorAdmin, snapshot.inventarioId, items);
  const hoja = hojas[0];
  if (!hoja) {
    console.error('crearHojas no devolvio ninguna hoja.');
    return 1;
  }

  await asignarHojas(actorAdmin, snapshot.inventarioId, [contador.id]);

  const final = await prisma.hojaConteo.findUniqueOrThrow({
    where: { id: hoja.id },
    select: {
      id: true,
      numero: true,
      numeroConteo: true,
      estado: true,
      asignadoA: { select: { id: true, nombre: true } },
      _count: { select: { productos: true, conteos: true } },
    },
  });

  console.log('\n=== LISTO ===');
  console.log(`Tienda:      "${sucursal.nombre}" (sucursal ${sucursal.id})`);
  console.log(`Inventario:  ${snapshot.inventarioId} (en_curso)`);
  console.log(`Hoja:        #${final.numero} ronda ${final.numeroConteo} estado=${final.estado}`);
  console.log(`Asignada a:  ${final.asignadoA?.nombre ?? '(nadie)'} (colaborador ${final.asignadoA?.id})`);
  console.log(`Productos:   ${final._count.productos} · Conteos cargados: ${final._count.conteos} (tiene que ser 0)`);
  console.log(`PIN:         ${pinDelContador}`);
  console.log('\nEl inventario 34 y la sucursal 31 no fueron tocados.');
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
