/**
 * Seed con los MISMOS datos que mobile/lib/adaptadores/sesion-memoria.ts
 * (4 sucursales, 29 colaboradores, mismos roles) -- no se inventan personas.
 * Suma ademas 1 administrador (rol nuevo, no existe en el adaptador en
 * memoria de mobile/ porque ese rol no tiene pantallas todavia) y las 3
 * configuraciones default del sistema.
 *
 * ==========================================================================
 * !! PIN DE DESARROLLO -- NO SALE A LA TIENDA ASI !!
 * ==========================================================================
 *
 * Para una base NUEVA (`prisma migrate reset` + este seed desde cero), el
 * PIN de cada colaborador sale de `PIN_DEV_POR_ROL` (mas abajo): FIJO POR
 * ROL, no derivable del id. Los cuatro son coordinador 724193, conteo
 * 518274, auditor 306581, administrador 947260 -- el porque de este diseno
 * (y del que reemplazo) esta en el comentario de esa constante.
 *
 * UNA BASE YA SEMBRADA CONSERVA LOS PINS CON LOS QUE SE SEMBRO -- no los
 * de la version de este archivo que tengas delante. Verificado en la base
 * de desarrollo actual (2026-09): quedo sembrada con el generador VIEJO
 * (`id.padStart(6,'0')`) antes de que existiera `PIN_DEV_POR_ROL`, asi que
 * hoy Admin Sistema entra con "001000", no con "947260".
 *
 * DOS FORMAS DE VOLVER A CORRER ESTE ARCHIVO, con resultados distintos:
 *
 *   - `npm run prisma:seed` (standalone, NO borra nada): actualiza el PIN
 *     de los 29 colaboradores normales al vigente por rol -- el `upsert`
 *     de cada uno reescribe `pinHash` en el `update` (mas abajo). El
 *     ADMINISTRADOR es la excepcion tal como esta escrito hoy: su `update`
 *     NO incluye `pinHash`, asi que sigue entrando con el PIN con el que se
 *     creo la fila.
 *   - `npx prisma migrate reset` (BORRA TODAS LAS TABLAS y recien despues
 *     corre este seed, ver `"seed"` en package.json): al recrear cada fila
 *     desde cero con `create`, ahi si el administrador tambien queda con
 *     "947260". No es un camino para "actualizar los PINs" de una base con
 *     inventarios o conteos que importen -- se lleva puesto todo lo demas.
 *
 * Para llevar el PIN del ADMINISTRADOR (el unico que `prisma:seed` no
 * toca) al vigente sin perder ningun dato, se rota a mano:
 *
 *   POST /api/usuarios/:id/resetear-pin   { "pin": "<6 digitos>" }
 *
 * (rol administrador o auditor; el auditor solo sobre su propia sucursal).
 * Probado contra la base real: cambia el hash argon2, el PIN viejo deja de
 * servir y el nuevo entra. Ver backend/README.md, seccion "PIN de
 * desarrollo".
 *
 * El PIN se hashea igual que en produccion (argon2) y nunca se guarda en
 * claro: el problema no es como se almacena, es que se pueda ADIVINAR --
 * ver el comentario de `PIN_DEV_POR_ROL` para el porque del diseno actual.
 */

import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { CONFIGURACIONES } from './configuraciones';

const prisma = new PrismaClient();

/**
 * Las 4 sucursales con su ALMACEN de Dynamics.
 *
 * Los codigos son REALES: salen de la entidad `Warehouses` del tenant de
 * Market Trujillo (`GET /api/d365/almacenes`, 70 almacenes) y el nombre de
 * cada uno coincide exactamente con el de la sucursal. No son placeholders.
 *
 * LO QUE SI ES UNA INFERENCIA -- y hay que confirmarlo con el cliente: cada
 * tienda tiene TRES almacenes en el ERP, y se eligio el DISPONIBLE:
 *
 *   MD01_LUZ  ALMACEN DISPONIBLE MARKET LUZURIAGA   <- el que se usa
 *   MC01_LUZ  ALMACEN CUARENTENA MARKET LUZURIAGA
 *   MT01_LUZ  ALMACEN TRANSITO MARKET LUZURIAGA
 *
 * "Disponible" es el stock vendible en gondola, que es lo que once personas
 * salen a contar; cuarentena es mercaderia retenida y transito lo que va en
 * camino. Es la lectura razonable, pero es una lectura: si el cliente cuenta
 * tambien la cuarentena, estos codigos cambian.
 *
 * El almacen NO esta clavado en el codigo: vive en `Sucursal.almacenId` y el
 * Administrador lo cambia desde la gestion de tiendas eligiendo de la lista
 * real del ERP. Esto es solo el valor inicial para poder probar.
 */
const SUCURSALES = [
  { id: 1, nombre: 'Market Central Luzuriaga', almacenId: 'MD01_LUZ', almacenNombre: 'ALMACÉN DISPONIBLE MARKET LUZURIAGA' },
  { id: 2, nombre: 'Market Carhuaz', almacenId: 'MD03_CRH', almacenNombre: 'ALMACÉN DISPONIBLE MARKET CARHUAZ' },
  { id: 3, nombre: 'Market Bolívar', almacenId: 'MD06_BOL', almacenNombre: 'ALMACÉN DISPONIBLE MARKET BOLIVAR' },
  { id: 4, nombre: 'Market Sucre', almacenId: 'MD04_SUC', almacenNombre: 'ALMACÉN DISPONIBLE MARKET  SUCRE' },
] as const;

const COLABORADORES = {
  1: [
    { id: 101, nombre: 'José Tarazona', dni: '1256', rol: 'coordinador' },
    { id: 102, nombre: 'María Rojas', dni: '8890', rol: 'conteo' },
    { id: 103, nombre: 'Gilmer Quispe', dni: '3421', rol: 'auditor' },
    { id: 104, nombre: 'Elena Príncipe', dni: '7714', rol: 'conteo' },
    { id: 105, nombre: 'Walter Norabuena', dni: '2038', rol: 'conteo' },
    { id: 106, nombre: 'Rosa Melgarejo', dni: '5567', rol: 'auditor' },
    { id: 107, nombre: 'Luis Shuan', dni: '9102', rol: 'conteo' },
    { id: 108, nombre: 'Carla Depaz', dni: '4483', rol: 'conteo' },
    { id: 109, nombre: 'Manuel Chávez', dni: '6017', rol: 'conteo' },
    { id: 110, nombre: 'Yeni Sotelo', dni: '3390', rol: 'conteo' },
    { id: 111, nombre: 'Hugo Vergaray', dni: '8845', rol: 'conteo' },
  ],
  2: [
    { id: 201, nombre: 'Ana Villanueva', dni: '4410', rol: 'coordinador' },
    { id: 202, nombre: 'Pedro Cochachin', dni: '6689', rol: 'conteo' },
    { id: 203, nombre: 'Nilda Ramírez', dni: '1174', rol: 'auditor' },
    { id: 204, nombre: 'Julio Espinoza', dni: '5528', rol: 'conteo' },
    { id: 205, nombre: 'Betty Salazar', dni: '9063', rol: 'conteo' },
    { id: 206, nombre: 'Raúl Colonia', dni: '2295', rol: 'conteo' },
  ],
  3: [
    { id: 301, nombre: 'Óscar Maguiña', dni: '3391', rol: 'coordinador' },
    { id: 302, nombre: 'Silvia Huerta', dni: '8021', rol: 'conteo' },
    { id: 303, nombre: 'Jorge Alvarado', dni: '5543', rol: 'auditor' },
    { id: 304, nombre: 'Delia Ocaña', dni: '7716', rol: 'conteo' },
    { id: 305, nombre: 'Marco Zarzosa', dni: '1108', rol: 'conteo' },
    { id: 306, nombre: 'Pilar Antúnez', dni: '6634', rol: 'conteo' },
    { id: 307, nombre: 'Iván Loli', dni: '2280', rol: 'conteo' },
  ],
  4: [
    { id: 401, nombre: 'Carmen Solís', dni: '2287', rol: 'coordinador' },
    { id: 402, nombre: 'Iván Castromonte', dni: '6650', rol: 'conteo' },
    { id: 403, nombre: 'Teresa Bailón', dni: '4419', rol: 'auditor' },
    { id: 404, nombre: 'Fredy Minaya', dni: '9971', rol: 'conteo' },
    { id: 405, nombre: 'Nancy Chinchay', dni: '3302', rol: 'conteo' },
  ],
} as const satisfies Record<number, ReadonlyArray<{ id: number; nombre: string; dni: string; rol: string }>>;

/**
 * Unico administrador de la demo. sucursalId es NULL de verdad: es del
 * sistema, no de una tienda (Colaborador.sucursalId es nullable
 * unicamente para este rol -- ver prisma/schema.prisma).
 */
const ADMINISTRADOR = { id: 1000, nombre: 'Admin Sistema', dni: '00000001', rol: 'administrador' } as const;


/**
 * PIN de desarrollo, FIJO POR ROL -- nunca derivable del id.
 *
 * El generador anterior (`id.padStart(6,'0')`, "000102") era un agujero de
 * seguridad real: la pantalla de login lista a todas las personas con su
 * nombre y la lista de colaboradores es publica (GET
 * /api/sesion/sucursales/:id/colaboradores, sin token), asi que cualquiera
 * que abriera la app deducia el PIN de todos SIN leer una linea de codigo
 * -- incluido el del administrador. Medido el 2026-09-04: el Admin Sistema
 * entraba con "001000". Ver "PIN de produccion -- pendiente" en el README.
 *
 * Estos PINs cortan ESE ataque: no salen del id, hay que leer el repo para
 * conocerlos. Es lo aceptable para una base de DESARROLLO -- la defensa de
 * produccion (obligar a cambiarlo en el primer ingreso) es otra tarea (plan
 * B del README), a proposito no incluida aca para no tocar el login mientras
 * se prueba el flujo.
 *
 * Fijos y no aleatorios a proposito: se re-corre el seed seguido y dos PINs
 * distintos en cada corrida dejarian sin entrar a quien este probando. No
 * son triviales ni secuencias (no los rechaza sesion.pin.ts#esPinTrivial),
 * asi que sirven de PIN "de verdad" para el flujo de dev.
 */
const PIN_DEV_POR_ROL: Record<string, string> = {
  coordinador: '724193',
  conteo: '518274',
  auditor: '306581',
  administrador: '947260',
};

function pinDevPorRol(rol: string): string {
  const pin = PIN_DEV_POR_ROL[rol];
  if (!pin) throw new Error(`No hay PIN de desarrollo definido para el rol "${rol}".`);
  return pin;
}

async function main() {
  for (const sucursal of SUCURSALES) {
    await prisma.sucursal.upsert({
      where: { id: sucursal.id },
      // El `update` SI pisa el almacen, a diferencia de lo que hace con las
      // configuraciones: aca el valor del seed es el correcto segun el ERP,
      // y si alguien lo cambio a mano desde la pantalla, volver a correr el
      // seed es justamente pedir que se restauren los datos base.
      update: { nombre: sucursal.nombre, almacenId: sucursal.almacenId, almacenNombre: sucursal.almacenNombre },
      create: {
        id: sucursal.id,
        nombre: sucursal.nombre,
        almacenId: sucursal.almacenId,
        almacenNombre: sucursal.almacenNombre,
      },
    });
  }

  for (const [sucursalId, colaboradores] of Object.entries(COLABORADORES)) {
    for (const c of colaboradores) {
      const pinHash = await argon2.hash(pinDevPorRol(c.rol));
      await prisma.colaborador.upsert({
        where: { id: c.id },
        update: { nombre: c.nombre, dni: c.dni, rol: c.rol, pinHash, sucursalId: Number(sucursalId) },
        create: {
          id: c.id,
          nombre: c.nombre,
          dni: c.dni,
          rol: c.rol,
          pinHash,
          sucursalId: Number(sucursalId),
        },
      });
    }
  }

  const pinAdmin = await argon2.hash(pinDevPorRol(ADMINISTRADOR.rol));
  await prisma.colaborador.upsert({
    where: { id: ADMINISTRADOR.id },
    update: { nombre: ADMINISTRADOR.nombre, dni: ADMINISTRADOR.dni, rol: ADMINISTRADOR.rol, sucursalId: null },
    create: {
      id: ADMINISTRADOR.id,
      nombre: ADMINISTRADOR.nombre,
      dni: ADMINISTRADOR.dni,
      rol: ADMINISTRADOR.rol,
      pinHash: pinAdmin,
      sucursalId: null,
    },
  });

  // El `update` NO toca `valor` a proposito: si el administrador ya
  // cambio un default desde /api/config, correr el seed de nuevo no
  // deberia pisarselo -- solo refresca la descripcion si cambio el texto.
  for (const config of CONFIGURACIONES) {
    await prisma.configuracion.upsert({
      where: { clave: config.clave },
      update: { descripcion: config.descripcion },
      create: config,
    });
  }

  console.log('Seed OK: 4 sucursales (con almacen de Dynamics), 29 colaboradores + 1 administrador, 3 configuraciones.');
  // PINs de desarrollo, para que quien siembre sepa entrar. Ya NO se derivan
  // del id (ver PIN_DEV_POR_ROL): esta es la unica forma de conocerlos.
  console.log('PINs de desarrollo (fijos por rol, NO derivables del id):');
  for (const [rol, pin] of Object.entries(PIN_DEV_POR_ROL)) {
    console.log(`  ${rol.padEnd(13)} ${pin}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
