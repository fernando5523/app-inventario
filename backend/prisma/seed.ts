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
import { sincronizarSecuenciasYAvisar } from './sincronizar-secuencias';

const prisma = new PrismaClient();

/**
 * LA FLOTA COMPLETA: las 10 sucursales con su ALMACEN de Dynamics.
 *
 * NO SON PLACEHOLDERS NI UNA MUESTRA. Los diez codigos y los diez nombres
 * salen tal cual de `GET /api/d365/almacenes` contra el tenant de Market
 * Trujillo, medido el 2026-09-21. Ese endpoint no devuelve todos los
 * almacenes del ERP: devuelve los HABILITADOS, la lista que alguien ya dejo
 * configurada en `Configuracion` (ver `almacenesHabilitados`). Son
 * exactamente estos diez, y son las tiendas que existen.
 *
 * Que la flota entera este sembrada importa para probar: el personal de una
 * tienda no puede ver el de otra, y con una sola sucursal esa regla no se
 * puede romper ni verificar. Ademas es lo que el cliente va a ver el primer
 * dia -- arrancar con cuatro tiendas inventadas obligaba a dar de alta las
 * otras seis a mano antes de poder mirar nada.
 *
 * `MD10` no tiene sufijo de tienda, a diferencia de sus nueve hermanos, y no
 * es un error de transcripcion: asi esta cargado en el ERP. Si algun dia lo
 * corrigen alla, hay que corregirlo aca.
 *
 * DOS NOMBRES CON RAREZAS QUE SE COPIAN A PROPOSITO, porque el que compare
 * contra Dynamics tiene que encontrar lo mismo: "MARKET  SUCRE" lleva dos
 * espacios, y "MARKET JR. CARAZ" convive con "MARKET CARAZ", que son tiendas
 * distintas.
 *
 * LO QUE SIGUE SIENDO UNA INFERENCIA -- y hay que confirmarlo con el
 * cliente: cada tienda tiene TRES almacenes en el ERP y se eligio el
 * DISPONIBLE.
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
  { id: 1, nombre: 'Market Luzuriaga', almacenId: 'MD01_LUZ', almacenNombre: 'ALMACÉN DISPONIBLE MARKET LUZURIAGA' },
  { id: 2, nombre: 'Market Carhuaz', almacenId: 'MD03_CRH', almacenNombre: 'ALMACÉN DISPONIBLE MARKET CARHUAZ' },
  { id: 3, nombre: 'Market Bolívar', almacenId: 'MD06_BOL', almacenNombre: 'ALMACÉN DISPONIBLE MARKET BOLIVAR' },
  { id: 4, nombre: 'Market Sucre', almacenId: 'MD04_SUC', almacenNombre: 'ALMACÉN DISPONIBLE MARKET  SUCRE' },
  { id: 5, nombre: 'Market Jr. Caraz', almacenId: 'MD02_JRC', almacenNombre: 'ALMACÉN DISPONIBLE MARKET JR. CARAZ' },
  { id: 6, nombre: 'Market Caraz', almacenId: 'MD05_CRZ', almacenNombre: 'ALMACÉN DISPONIBLE MARKET CARAZ' },
  { id: 7, nombre: 'Market Raymondi', almacenId: 'MD08_RAY', almacenNombre: 'ALMACÉN DISPONIBLE MARKET RAYMONDI' },
  { id: 8, nombre: 'Market Raymondi 351', almacenId: 'MD09_R351', almacenNombre: 'ALMACÉN DISPONIBLE MARKET RAYMONDI 351' },
  { id: 9, nombre: 'Market Santa Rosa', almacenId: 'MD10', almacenNombre: 'ALMACÉN DISPONIBLE MARKET SANTA ROSA' },
  { id: 10, nombre: 'Market Centenario', almacenId: 'MD11_CENT', almacenNombre: 'ALMACÉN DISPONIBLE MARKET CENTENARIO' },
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
  // Las seis tiendas que se sumaron al sembrar la flota completa. Llevan la
  // DOTACION MINIMA con la que un inventario se puede correr de punta a
  // punta -- coordinador, dos contadores y auditor -- y no once personas
  // como las de arriba: alcanza para probar el flujo y para comprobar que el
  // personal de una tienda no ve el de otra, que es para lo que existen.
  5: [
    { id: 501, nombre: 'Rocío Palacios', dni: '4471', rol: 'coordinador' },
    { id: 502, nombre: 'Elmer Cadillo', dni: '8823', rol: 'conteo' },
    { id: 503, nombre: 'Gloria Mejía', dni: '1195', rol: 'conteo' },
    { id: 504, nombre: 'Néstor Obregón', dni: '6640', rol: 'auditor' },
  ],
  6: [
    { id: 601, nombre: 'Javier Milla', dni: '3318', rol: 'coordinador' },
    { id: 602, nombre: 'Ruth Caururo', dni: '7752', rol: 'conteo' },
    { id: 603, nombre: 'Aldo Jamanca', dni: '2206', rol: 'conteo' },
    { id: 604, nombre: 'Doris Leiva', dni: '9984', rol: 'auditor' },
  ],
  7: [
    { id: 701, nombre: 'Marisol Trejo', dni: '5539', rol: 'coordinador' },
    { id: 702, nombre: 'Fidel Caqui', dni: '1163', rol: 'conteo' },
    { id: 703, nombre: 'Katia Robles', dni: '8807', rol: 'conteo' },
    { id: 704, nombre: 'Uriel Tinoco', dni: '4425', rol: 'auditor' },
  ],
  8: [
    { id: 801, nombre: 'Gustavo Yauri', dni: '6672', rol: 'coordinador' },
    { id: 802, nombre: 'Lidia Broncano', dni: '2238', rol: 'conteo' },
    { id: 803, nombre: 'Percy Huamán', dni: '9916', rol: 'conteo' },
    { id: 804, nombre: 'Sonia Valverde', dni: '3384', rol: 'auditor' },
  ],
  9: [
    { id: 901, nombre: 'Álvaro Menacho', dni: '7729', rol: 'coordinador' },
    { id: 902, nombre: 'Irma Sifuentes', dni: '1151', rol: 'conteo' },
    { id: 903, nombre: 'Denis Rurush', dni: '5595', rol: 'conteo' },
    { id: 904, nombre: 'Miriam Quiñones', dni: '8863', rol: 'auditor' },
  ],
  // La tienda 10 rompe el patron `<sucursal><correlativo>` a proposito: con
  // el seguiria seria 1001..1004, pegado al ADMINISTRADOR que es el 1000, y
  // el que lea la tabla no distinguiria de un vistazo a la gente de
  // Centenario del usuario del sistema. Se corre a la centena siguiente.
  10: [
    { id: 1101, nombre: 'Efraín Salinas', dni: '2217', rol: 'coordinador' },
    { id: 1102, nombre: 'Vilma Alvarado', dni: '6698', rol: 'conteo' },
    { id: 1103, nombre: 'Tito Barreto', dni: '4453', rol: 'conteo' },
    { id: 1104, nombre: 'Noemí Castillo', dni: '9940', rol: 'auditor' },
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
 * distintos en cada corrida dejarian sin entrar a quien este probando.
 *
 * HOY LOS CUATRO SON EL MISMO, Y ES UNA DECISION DEL USUARIO (2026-09-21):
 * validar la app a mano significa entrar y salir decenas de veces cambiando
 * de rol, y recordar cuatro numeros distintos se come el tiempo de la prueba.
 * Se eligio uno solo, "000020", que ademas es el que arrastraba la base
 * anterior, asi que las notas y los scripts viejos siguen sirviendo.
 *
 * LO QUE ESTO CUESTA, para que nadie lo descubra despues: con un unico PIN
 * para todos, quien lo averigua entra como CUALQUIERA -- incluido el
 * administrador y el auditor, que son los dos que ven el stock. Es aceptable
 * porque esto siembra una base de DESARROLLO y nada mas. Si alguna vez se
 * siembra algo parecido a produccion, esto vuelve a ser cuatro PINs
 * distintos, o mejor, ninguno: que cada uno lo elija en su primer ingreso.
 *
 * La estructura por rol se conserva a proposito aunque los cuatro valores
 * coincidan: volver a diferenciarlos es cambiar cuatro strings, no rehacer
 * el diseno. Y `scripts/_pin-dev.mjs` es su espejo -- si se cambian aca, se
 * cambian alla, y `_pin-dev.test.mjs` falla si alguien se olvida.
 */
const PIN_DEV_POR_ROL: Record<string, string> = {
  coordinador: '000020',
  conteo: '000020',
  auditor: '000020',
  administrador: '000020',
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

  // Los numeros se CUENTAN, no se escriben a mano. Estuvieron clavados en
  // "4 sucursales, 29 colaboradores" y siguieron diciendo eso despues de
  // sembrar diez tiendas y cincuenta y cuatro personas. Un resumen que no se
  // mueve con los datos es peor que no tener resumen: el que lo lee cree que
  // sembro otra cosa.
  const totalColaboradores = Object.values(COLABORADORES).reduce((n, lista) => n + lista.length, 0);
  console.log(
    `Seed OK: ${SUCURSALES.length} sucursales (con almacen de Dynamics), ` +
      `${totalColaboradores} colaboradores + 1 administrador, ${CONFIGURACIONES.length} configuraciones.`,
  );
  // PINs de desarrollo, para que quien siembre sepa entrar. Ya NO se derivan
  // del id (ver PIN_DEV_POR_ROL): esta es la unica forma de conocerlos.
  console.log('PINs de desarrollo (fijos por rol, NO derivables del id):');
  for (const [rol, pin] of Object.entries(PIN_DEV_POR_ROL)) {
    console.log(`  ${rol.padEnd(13)} ${pin}`);
  }

  // Todo lo de arriba se inserta con id EXPLICITO (sucursales 1..4,
  // colaboradores 101..405, administrador 1000) y eso NO avanza la secuencia
  // del autoincremento. Sin esta linea, la primera tienda o el primer usuario
  // que el cliente cree DESDE LA APP choca con un P2002 y la API responde 500.
  await sincronizarSecuenciasYAvisar(prisma);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
