/**
 * ---------------------------------------------------------------------------
 * LA FLOTA Y LA CONFIGURACION, Y NADA MAS: el seed para un entorno REAL
 * ---------------------------------------------------------------------------
 * Siembra las diez tiendas con su almacen de Dynamics y las cuatro
 * configuraciones del negocio. **No crea ni una persona.**
 *
 * Decision del usuario (2026-10-02), textual: *"el contador y todos los
 * perfiles lo va crear el admin, solo considerar las configuraciones y las
 * tiendas en el seed del proyecto"*.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO SE USA `seed.ts`
 * ---------------------------------------------------------------------------
 * Aquel sirve para DESARROLLO y trae 54 colaboradores inventados -- nombres de
 * ejemplo y DNI de cuatro digitos. Contra una base real eso no es ruido
 * inofensivo: son 54 cuentas que pueden entrar, con una clave conocida, en un
 * padron donde cada persona es alguien a quien se le descuenta plata. Este
 * archivo siembra el mismo universo de tiendas y configuraciones, de las
 * MISMAS fuentes (`flota.ts#SUCURSALES` y `configuraciones.ts#CONFIGURACIONES`,
 * importadas, no copiadas), y se detiene ahi.
 *
 * ---------------------------------------------------------------------------
 * HACE FALTA UN ADMINISTRADOR, Y ESTE ARCHIVO NO LO CREA
 * ---------------------------------------------------------------------------
 * Sin una sola persona en la base, nadie puede entrar a crear a nadie: las
 * tiendas quedan sembradas y la app, inusable. Es el huevo y la gallina que ya
 * habia aparecido antes en produccion.
 *
 * Este seed NO lo resuelve a proposito -- crear una cuenta con permisos de
 * administrador y una clave conocida es justo lo que no queremos que pase sin
 * que alguien lo decida. Por eso AVISA al terminar si no encontro ninguna, y
 * dice que hacer. El entorno publicado ya tiene la suya.
 *
 * ---------------------------------------------------------------------------
 * ES IDEMPOTENTE Y NO PISA LO DECIDIDO
 * ---------------------------------------------------------------------------
 * Las tiendas van por `upsert`, asi que correrlo dos veces no duplica nada.
 * Y en las configuraciones el `update` NO toca `valor`: si el Administrador
 * cambio el umbral o el tamaño de hoja desde la app, volver a correr esto no
 * se lo pisa -- solo refresca la descripcion. Es la misma regla que ya sostenia
 * `seed.ts`, y se mantiene por el mismo motivo.
 *
 * ---------------------------------------------------------------------------
 * COMO SE CORRE
 * ---------------------------------------------------------------------------
 *     DATABASE_URL=<la base destino> npx tsx prisma/sembrar-flota.ts
 *
 * CON `tsx`, no con `node --experimental-strip-types`: lo probe y no sirve.
 * No por este archivo sino por la cadena -- `configuraciones.ts` importa de
 * `src/modules/d365/` sin extension, y el resolvedor de Node la exige. Habria
 * que ponerle extension a medio repositorio para ganar nada.
 *
 * CONSECUENCIA PRACTICA: esto NO se puede correr dentro del contenedor, donde
 * `tsx` no esta (es devDependency y el runtime instala con `--omit=dev`). Se
 * corre desde una maquina de desarrollo apuntando `DATABASE_URL` al destino.
 */
import { PrismaClient } from '@prisma/client';

import { CONFIGURACIONES } from './configuraciones';
import { SUCURSALES } from './flota';
import { sincronizarSecuenciasYAvisar } from './sincronizar-secuencias';

const prisma = new PrismaClient();

async function main(): Promise<number> {
  for (const sucursal of SUCURSALES) {
    await prisma.sucursal.upsert({
      where: { id: sucursal.id },
      // El almacen SI se refresca: es el dato que decide de donde sale el
      // stock, y si cambio en Dynamics hay que poder corregirlo corriendo
      // esto de nuevo.
      update: {
        nombre: sucursal.nombre,
        almacenId: sucursal.almacenId,
        almacenNombre: sucursal.almacenNombre,
      },
      create: {
        id: sucursal.id,
        nombre: sucursal.nombre,
        almacenId: sucursal.almacenId,
        almacenNombre: sucursal.almacenNombre,
      },
    });
  }

  for (const config of CONFIGURACIONES) {
    await prisma.configuracion.upsert({
      where: { clave: config.clave },
      update: { descripcion: config.descripcion },
      create: config,
    });
  }

  // Las secuencias de Postgres NO avanzan con un INSERT que trae el id, y
  // estas tiendas vienen con ids explicitos (1..10). Sin esto, la primera
  // tienda creada DESDE LA APP pide el id 1, lo encuentra ocupado y choca
  // contra la clave primaria -- bug real, ver `sincronizar-secuencias.ts`.
  await sincronizarSecuenciasYAvisar(prisma);

  const administradores = await prisma.colaborador.count({ where: { rol: 'administrador', activo: true } });

  console.log('');
  console.log(`Tiendas:         ${SUCURSALES.length} con su almacen de Dynamics`);
  console.log(`Configuraciones: ${CONFIGURACIONES.length}`);
  console.log(`Personas:        ninguna -- las crea el Administrador desde la app`);
  console.log('');

  if (administradores === 0) {
    console.log('OJO: no hay NINGUN administrador activo en esta base.');
    console.log('     Las tiendas quedaron sembradas pero nadie puede entrar a crear al resto.');
    console.log('     Hace falta crear esa cuenta antes de que la app sirva para algo.');
    return 1;
  }

  console.log(`Hay ${administradores} administrador(es) activo(s): ya se puede entrar y crear al personal.`);
  return 0;
}

main()
  .then(async (codigo) => {
    await prisma.$disconnect();
    process.exit(codigo);
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
