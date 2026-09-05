/**
 * Resetea el PIN de UN colaborador (por id) a un PIN nuevo, hasheado con
 * argon2 EXACTAMENTE como prisma/seed.ts. Uso puntual de desarrollo cuando el
 * PIN esperado dejó de servir (ej. un usuario recreado por el wizard con un
 * PIN propio, no derivable del id).
 *
 *   npx tsx backend/scripts/resetear-pin.ts <id> <pin de 6 digitos>
 *
 * El PIN entra por ARGUMENTO, nunca hardcodeado: así este archivo se puede
 * commitear sin filtrar ninguna credencial, y su salida tampoco imprime el PIN.
 *
 * Antes de tocar nada imprime nombre/rol/sucursal del colaborador, y se NIEGA
 * a modificar la cuenta de Fernando Colque pase lo que pase.
 */
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Cuenta que este script nunca toca, sea cual sea su id. */
const CUENTA_INTOCABLE = 'Fernando Colque';

async function main(): Promise<void> {
  const [, , idArg, pinArg] = process.argv;

  const id = Number(idArg);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`id inválido: "${idArg}". Uso: npx tsx backend/scripts/resetear-pin.ts <id> <pin de 6 digitos>`);
  }
  if (!/^\d{6}$/.test(pinArg ?? '')) {
    throw new Error('PIN inválido: tienen que ser exactamente 6 dígitos. Uso: npx tsx backend/scripts/resetear-pin.ts <id> <pin de 6 digitos>');
  }

  const colab = await prisma.colaborador.findUnique({
    where: { id },
    select: { id: true, nombre: true, rol: true, sucursalId: true, sucursal: { select: { nombre: true } } },
  });
  if (!colab) throw new Error(`No existe colaborador con id ${id}.`);

  console.log(
    `Colaborador a resetear: id=${colab.id} nombre="${colab.nombre}" rol=${colab.rol} sucursal="${colab.sucursal?.nombre ?? '(sin sucursal)'}"`,
  );

  if (colab.nombre.trim().toLowerCase() === CUENTA_INTOCABLE.toLowerCase()) {
    throw new Error(`NEGADO: la cuenta de ${CUENTA_INTOCABLE} no se toca con este script.`);
  }

  const pinHash = await argon2.hash(pinArg);
  await prisma.colaborador.update({ where: { id }, data: { pinHash } });

  console.log(`OK: PIN de id=${colab.id} ("${colab.nombre}") reseteado. El PIN nuevo NO se imprime a propósito.`);
}

main()
  .catch((e) => {
    console.error('ERROR:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
