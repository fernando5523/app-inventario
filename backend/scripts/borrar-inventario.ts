/**
 * Borra UN inventario entero con todo lo que cuelga de el. Es limpieza de
 * pruebas, no una operacion del sistema: un inventario de verdad se CIERRA,
 * nunca se borra -- por eso no hay endpoint que haga esto y por eso vive en
 * scripts/ y no en un modulo.
 *
 * Se niega a borrar uno que tenga CONTEOS cargados: eso ya no es un
 * inventario de prueba, es trabajo de alguien.
 *
 *   npx tsx scripts/borrar-inventario.ts <id>
 */

import { prisma } from '../src/config/database';

async function main(): Promise<number> {
  const id = Number(process.argv[2]);
  if (!Number.isInteger(id) || id <= 0) {
    console.error('Uso: npx tsx scripts/borrar-inventario.ts <id>');
    return 1;
  }

  const inventario = await prisma.inventario.findUnique({
    where: { id },
    include: { sucursal: { select: { nombre: true } }, _count: { select: { hojas: true, catalogo: true, asistencias: true } } },
  });
  if (inventario === null) {
    console.log(`No existe el inventario ${id}.`);
    return 0;
  }

  const conteos = await prisma.conteo.count({ where: { hoja: { inventarioId: id } } });
  if (conteos > 0) {
    console.error(`SE NIEGA: el inventario ${id} tiene ${conteos} conteo(s) cargado(s). Eso es trabajo real, no una prueba.`);
    return 1;
  }

  console.log(
    `Borrando inventario ${id} (${inventario.sucursal.nombre}): ` +
      `${inventario._count.hojas} hojas, ${inventario._count.catalogo} items de catalogo, ` +
      `${inventario._count.asistencias} marca(s) de asistencia.`,
  );

  // El orden importa: los hijos primero, Postgres no borra en cascada acá.
  //
  // La asistencia va en esta lista aunque el script ya se haya negado si hay
  // conteos, y es la unica de las nueve FK hacia `inventarios` para la que
  // eso no alcanza: las marcas las carga el Coordinador cuando la gente
  // LLEGA, asi que un inventario de prueba con 0 conteos puede tener marcas
  // igual, y el DELETE moria con
  //   violates RESTRICT setting of foreign key constraint
  //   "asistencia_inventario_inventario_id_fkey"
  // (ver 20260918160000_asistencia_claves_foraneas). De las otras ocho, hojas
  // y catalogo ya estaban en esta lista; resultado, diferencias,
  // liquidaciones, aprobaciones, lacrado e importaciones de ajustes recien
  // aparecen DESPUES del cierre del conteo, y un inventario cerrado no es lo
  // que este script borra -- si alguna vez llega uno asi, el DELETE va a
  // frenar con el nombre de la constraint puesto, que es justamente lo que
  // RESTRICT existe para hacer.
  await prisma.$transaction([
    prisma.empaque.deleteMany({ where: { producto: { hoja: { inventarioId: id } } } }),
    prisma.producto.deleteMany({ where: { hoja: { inventarioId: id } } }),
    prisma.hojaConteo.deleteMany({ where: { inventarioId: id } }),
    prisma.empaqueCatalogo.deleteMany({ where: { catalogoItem: { inventarioId: id } } }),
    prisma.catalogoItem.deleteMany({ where: { inventarioId: id } }),
    prisma.asistenciaInventario.deleteMany({ where: { inventarioId: id } }),
    prisma.inventario.delete({ where: { id } }),
  ]);

  console.log('Listo.');
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
