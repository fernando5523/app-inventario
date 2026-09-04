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
 * El PIN de cada colaborador es SU PROPIO ID CON CEROS ADELANTE:
 *   Maria Rojas (102)   -> 000102
 *   Jose Tarazona (101) -> 000101
 *   Admin Sistema (1000)-> 001000
 *
 * Por que eso es una puerta abierta y no solo "un placeholder feo": la
 * pantalla de login LISTA a todas las personas de la sucursal con nombre y
 * rol (GET /api/sesion/sucursales/:id/colaboradores). Cualquiera que abra
 * la app ve la lista, y de la lista se deduce el PIN de todos -- incluido
 * el del administrador, que gestiona cuentas de las 4 sucursales.
 *
 * Es DELIBERADO que sean predecibles: sin esto no se puede probar /ingresar
 * en local. NO cambiar el algoritmo -- lo que hay que hacer es ROTARLOS
 * antes de cualquier uso real, uno por uno, con:
 *
 *   POST /api/usuarios/:id/resetear-pin   { "pin": "<6 digitos>" }
 *
 * (rol administrador o auditor; el auditor solo sobre su propia sucursal).
 * Probado contra la base real: cambia el hash argon2, el PIN viejo deja de
 * servir y el nuevo entra. Ver backend/README.md, seccion "PIN de
 * desarrollo".
 *
 * El PIN se hashea igual que en produccion (argon2) y nunca se guarda en
 * claro: el problema no es como se almacena, es que se puede ADIVINAR.
 */

import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const SUCURSALES = [
  { id: 1, nombre: 'Market Central Luzuriaga' },
  { id: 2, nombre: 'Market Carhuaz' },
  { id: 3, nombre: 'Market Bolívar' },
  { id: 4, nombre: 'Market Sucre' },
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
 * Defaults sugeridos, no reglas duras -- el auditor los puede cambiar
 * desde /api/config (ver backend/README.md). UMBRAL_MEDIA_UNIDAD_PAQUETE
 * = 0.5 es la "mitad" que menciona Oscar en la reunion (docs/pantallas.md,
 * pregunta 1): 0.5 = mitad exacta del paquete.
 */
const CONFIGURACIONES = [
  {
    clave: 'TAMANO_HOJA_DEFECTO',
    valor: '50',
    tipo: 'entero' as const,
    descripcion: 'Cantidad de items por hoja que se preselecciona al crear hojas de conteo (20, 30 o 50).',
  },
  {
    clave: 'CANTIDAD_CONTEOS_CICLO',
    valor: '3',
    tipo: 'entero' as const,
    descripcion: 'Cantidad de pasadas de conteo del ciclo antes de pasar a auditoria (hoy: 3).',
  },
  {
    clave: 'UMBRAL_MEDIA_UNIDAD_PAQUETE',
    valor: '0.5',
    tipo: 'decimal' as const,
    descripcion:
      'Fraccion del paquete (0-1) a partir de la cual un faltante/sobrante se descuenta por paquete completo en vez de por unidad suelta. Default sugerido, el auditor lo ajusta caso por caso (docs/pantallas.md, pregunta 1).',
  },
];

function pinDevPlaceholder(colaboradorId: number): string {
  return String(colaboradorId).padStart(6, '0');
}

async function main() {
  for (const sucursal of SUCURSALES) {
    await prisma.sucursal.upsert({
      where: { id: sucursal.id },
      update: { nombre: sucursal.nombre },
      create: { id: sucursal.id, nombre: sucursal.nombre },
    });
  }

  for (const [sucursalId, colaboradores] of Object.entries(COLABORADORES)) {
    for (const c of colaboradores) {
      const pinHash = await argon2.hash(pinDevPlaceholder(c.id));
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

  const pinAdmin = await argon2.hash(pinDevPlaceholder(ADMINISTRADOR.id));
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

  console.log('Seed OK: 4 sucursales, 29 colaboradores + 1 administrador, 3 configuraciones.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
