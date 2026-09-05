/**
 * Prepara el estado de prueba de la RONDA: finaliza las hojas pendientes de un
 * inventario+ronda llamando a la MISMA función de servicio que usa la ruta
 * (hojas.service#finalizar), con el colaborador ASIGNADO a cada hoja como
 * actor — así aplican las reglas reales (validarEscrituraDeHoja exige estar
 * asignado). Hace exactamente lo que haría el Contador tocando "Finalizar" en
 * cada hoja, una por una.
 *
 *   npx tsx backend/scripts/finalizar-hojas-dev.ts <inventarioId> <ronda>
 *
 * NO crea conteos: la app permite finalizar con productos sin contar, así que
 * cero conteos inventados. Imprime cada hoja antes/después. Solo dev.
 */
import { prisma } from '../src/config/database';
import * as hojasService from '../src/modules/hojas/hojas.service';
import type { ColaboradorAutenticado } from '../src/shared/tipos';

async function main(): Promise<void> {
  const inventarioId = Number(process.argv[2]);
  const ronda = Number(process.argv[3]);
  if (!Number.isInteger(inventarioId) || inventarioId <= 0 || !Number.isInteger(ronda) || ronda <= 0) {
    throw new Error('Uso: npx tsx backend/scripts/finalizar-hojas-dev.ts <inventarioId> <ronda>');
  }

  const pendientes = await prisma.hojaConteo.findMany({
    where: { inventarioId, numeroConteo: ronda, estado: { not: 'finalizada' } },
    select: {
      id: true,
      numero: true,
      estado: true,
      asignadoAId: true,
      asignadoA2Id: true,
      inventario: { select: { sucursalId: true, sucursal: { select: { nombre: true } } } },
    },
    orderBy: { numero: 'asc' },
  });

  if (pendientes.length === 0) {
    console.log(`Inventario ${inventarioId}, ronda ${ronda}: no hay hojas pendientes (o el inventario/ronda no existe).`);
    return;
  }

  const suc = pendientes[0].inventario;
  console.log(`Inventario ${inventarioId}, ronda ${ronda} — sucursal "${suc.sucursal?.nombre ?? '?'}" (id ${suc.sucursalId}). ${pendientes.length} hojas pendientes:`);

  let ok = 0;
  let salteadas = 0;
  for (const h of pendientes) {
    const asignadoId = h.asignadoAId ?? h.asignadoA2Id;
    if (asignadoId == null) {
      console.log(`  #${h.numero} (id ${h.id}, ${h.estado}): SIN asignar — no se puede finalizar con un actor. SALTEADA.`);
      salteadas++;
      continue;
    }
    const actor: ColaboradorAutenticado = {
      colaboradorId: asignadoId,
      sucursalId: h.inventario.sucursalId,
      rol: 'conteo',
    };
    await hojasService.finalizar(actor, h.id);
    console.log(`  #${h.numero} (id ${h.id}): ${h.estado} -> finalizada (actor = colaborador ${asignadoId}).`);
    ok++;
  }

  console.log(`Listo: ${ok} finalizadas, ${salteadas} salteadas.`);
}

main()
  .catch((e) => {
    console.error('ERROR:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
