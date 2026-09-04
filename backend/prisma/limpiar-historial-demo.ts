/**
 * Borra SOLO los inventarios de demo del historico (ids 8001-8003) para
 * poder re-sembrarlos. Nunca toca un inventario que no sea de demo.
 *
 * Necesita deshabilitar el trigger de inmutabilidad del lacrado durante el
 * borrado, y eso vale la pena mirarlo de frente: el trigger frena a
 * cualquiera que escriba en la tabla, pero NO al dueno de la tabla, que
 * puede desactivarlo. Eso no lo hace inutil -- ninguna proteccion resiste a
 * quien tiene la llave del servidor. Lo que hace es que alterar un sello
 * pase de ser un UPDATE silencioso a requerir un ALTER TABLE deliberado,
 * que ademas queda en el log de Postgres. Y aunque alguien lo haga, la
 * verificacion del hash lo delata igual (ver historial.lacrado.ts).
 *
 * Por eso este archivo existe y se llama "demo": borrar historico lacrado
 * es una operacion de laboratorio, no algo que la API deba poder hacer.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const IDS_DEMO = [8001, 8002, 8003];

async function main(): Promise<void> {
  const existentes = await prisma.inventario.findMany({
    where: { id: { in: IDS_DEMO } },
    select: { id: true, periodoAnio: true, periodoMes: true },
  });
  if (existentes.length === 0) {
    console.log('No hay inventarios de demo que borrar.');
    return;
  }

  await prisma.$executeRawUnsafe('ALTER TABLE "lacrados_inventario" DISABLE TRIGGER lacrado_inmutable');
  try {
    const lacrados = await prisma.lacradoInventario.findMany({ where: { inventarioId: { in: IDS_DEMO } } });
    await prisma.registroErpInventario.deleteMany({ where: { lacradoId: { in: lacrados.map((l) => l.id) } } });
    await prisma.lacradoInventario.deleteMany({ where: { inventarioId: { in: IDS_DEMO } } });
  } finally {
    // En un `finally`: si el borrado falla a mitad de camino, la tabla NO
    // puede quedar sin su proteccion.
    await prisma.$executeRawUnsafe('ALTER TABLE "lacrados_inventario" ENABLE TRIGGER lacrado_inmutable');
  }

  await prisma.aprobacionCierre.deleteMany({ where: { inventarioId: { in: IDS_DEMO } } });
  await prisma.liquidacionColaborador.deleteMany({ where: { inventarioId: { in: IDS_DEMO } } });
  await prisma.diferenciaItem.deleteMany({ where: { inventarioId: { in: IDS_DEMO } } });
  await prisma.resultadoInventario.deleteMany({ where: { inventarioId: { in: IDS_DEMO } } });
  await prisma.inventario.deleteMany({ where: { id: { in: IDS_DEMO } } });

  console.log(`Borrados ${existentes.length} inventarios de demo: ${existentes.map((e) => `${e.periodoAnio}-${String(e.periodoMes).padStart(2, '0')}`).join(', ')}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
