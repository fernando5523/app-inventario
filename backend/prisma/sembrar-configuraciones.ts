/**
 * Siembra las claves de `Configuracion` que FALTAN, sin tocar nada mas.
 *
 * POR QUE EXISTE, si `prisma/seed.ts` ya las siembra: el seed completo
 * tambien crea colaboradores y sucursales de demo. Una vez que la base tiene
 * datos reales, correrlo para agregar una clave nueva es inaceptable --
 * pisaria el trabajo del cliente. Este script hace SOLO las configuraciones,
 * y solo las que no estan.
 *
 * IDEMPOTENTE Y NO DESTRUCTIVO: una clave que ya existe NO se toca, ni
 * siquiera para "corregir" su valor. Si alguien cambio `TAMANO_HOJA_DEFECTO`
 * a 30 desde la app, correr esto no lo devuelve a 50. La unica forma de que
 * este script pise una decision del usuario es que no haga upsert -- por eso
 * no lo hace.
 *
 *   npm run config:sembrar
 */

import { prisma } from '../src/config/database';
import { CONFIGURACIONES } from './configuraciones';

async function main(): Promise<number> {
  console.log('\n=== Sembrar configuraciones faltantes ===\n');

  let creadas = 0;
  for (const c of CONFIGURACIONES) {
    const existe = await prisma.configuracion.findUnique({ where: { clave: c.clave } });
    if (existe !== null) {
      console.log(`  [YA ESTA] ${c.clave.padEnd(28)} = ${existe.valor}`);
      continue;
    }
    await prisma.configuracion.create({ data: c });
    console.log(`  [CREADA]  ${c.clave.padEnd(28)} = ${c.valor}`);
    creadas += 1;
  }

  console.log(`\n${creadas} creada(s), ${CONFIGURACIONES.length - creadas} ya estaba(n).\n`);
  return 0;
}

main()
  .then(async (codigo) => {
    await prisma.$disconnect();
    process.exit(codigo);
  })
  .catch(async (e: unknown) => {
    console.error('\n[ERROR]', e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });
