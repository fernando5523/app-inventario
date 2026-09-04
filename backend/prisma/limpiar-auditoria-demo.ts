/** Borra solo los inventarios de demo de auditoria (8004-8005), para re-sembrar. */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const IDS = [8004, 8005, 8006];

async function main(): Promise<void> {
  const hojas = await prisma.hojaConteo.findMany({ where: { inventarioId: { in: IDS } }, select: { id: true } });
  const idsHoja = hojas.map((h) => h.id);

  // El orden importa: los hijos antes que los padres (las FK no son en cascada
  // salvo donde el schema lo dice).
  await prisma.aprobacionCierre.deleteMany({ where: { inventarioId: { in: IDS } } });
  await prisma.conteo.deleteMany({ where: { hojaId: { in: idsHoja } } });
  await prisma.producto.deleteMany({ where: { hojaId: { in: idsHoja } } });
  await prisma.hojaConteo.deleteMany({ where: { inventarioId: { in: IDS } } });
  await prisma.catalogoItem.deleteMany({ where: { inventarioId: { in: IDS } } });
  const { count } = await prisma.inventario.deleteMany({ where: { id: { in: IDS } } });

  console.log(`Borrados ${count} inventarios de demo de auditoria.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
