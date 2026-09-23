/**
 * SIEMBRA DEL PILOTO: lo mínimo para que una persona entre al teléfono y
 * cuente.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO SE USA `seed.ts`
 * ---------------------------------------------------------------------------
 * Aquel siembra la flota de demostración -- 10 tiendas, 54 personas -- y todas
 * con el MISMO PIN de desarrollo escrito en el repositorio. Sirve para probar
 * acá; en un servidor al que llega gente de la tienda serían 54 cuentas falsas
 * con una clave pública.
 *
 * Esto es lo contrario: UNA tienda, UN contador, UN administrador, y un
 * inventario con sus hojas ya repartidas al contador. Nada más.
 *
 * ---------------------------------------------------------------------------
 * PARA QUE SIRVE Y PARA QUE NO
 * ---------------------------------------------------------------------------
 * La prueba que habilita es: entro con mi PIN, abro mi hoja, cuento un
 * producto en el formulario y escaneo otro con la cámara. Eso es todo, y es
 * todo lo que hace falta para saber si la app anda en los teléfonos de la
 * gente.
 *
 * NO sirve para probar el cierre del mes: no hay coordinador, ni auditor, ni
 * asistencia, ni segunda ronda. Ese recorrido necesita el equipo completo y se
 * arma aparte.
 *
 * ---------------------------------------------------------------------------
 * LOS PRODUCTOS SON REALES, Y ESO NO ES UN DETALLE
 * ---------------------------------------------------------------------------
 * Los 40 salieron del catálogo que Dynamics devolvió para Market Luzuriaga,
 * con su código de barras de verdad. Es lo que permite probar el escáner
 * apuntando a una botella de la góndola: con códigos inventados la cámara lee
 * bien y la app dice "ese producto no está en tu hoja", y quien prueba no sabe
 * si falló el escáner o la siembra.
 *
 * Van con su stock y su precio para que el inventario tenga contra qué
 * comparar, pero NADIE los va a auditar acá -- son para contar, no para
 * cerrar.
 *
 * ---------------------------------------------------------------------------
 * EL PIN
 * ---------------------------------------------------------------------------
 * Entra por variable de entorno, NUNCA hardcodeado:
 *
 *   PIN_PILOTO=123456 npx tsx prisma/seed-piloto.ts
 *
 * Sin la variable usa 000020, que es el de desarrollo y está en el repositorio
 * -- sirve para probar la app entre nosotros, no para dejarlo puesto cuando
 * entre gente de la tienda. El script lo avisa en pantalla y no imprime nunca
 * el PIN, ni el elegido ni el de default.
 *
 * ---------------------------------------------------------------------------
 * NO BORRA NADA
 * ---------------------------------------------------------------------------
 * Todo es `upsert` por una clave estable, y si ya hay un inventario en curso
 * en la tienda NO crea otro: lo reusa. Correrlo dos veces deja la base igual
 * que correrlo una. Un seed de producción que borra es un seed que un día se
 * corre de más y se lleva puesto el trabajo de una jornada.
 */
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Ids altos y reservados: no chocan con los del seed de demostración. */
const SUCURSAL_ID = 9001;
const ADMIN_ID = 9002;
const CONTADOR_ID = 9003;

const TIENDA = 'Market Trujillo - Piloto';
const ADMIN = { nombre: 'Administrador', dni: '00000001' };
const CONTADOR = { nombre: 'Contador de prueba', dni: '00000002' };

/** Productos por hoja. Dos hojas de 20 con los 40 de abajo. */
const TAMANO_HOJA = 20;

const PRODUCTOS = [
  // codigo | codigoBarras | descripcion | categoria | stockErp | precioVenta | empaqueCompra | simbolo
  { codigo: '100150', codigoBarras: '7750243029995', descripcion: 'CILACEITEVEGBID5L', categoria: 'ACEITES ENVASADOS', stockErp: 7, precioVenta: 46, empaqueCompra: 4, empaqueCompraSimbolo: 'Emp.4' },
  { codigo: '100151', codigoBarras: '7750243070072', descripcion: 'CILACEITEVEGBOT900ML', categoria: 'ACEITES ENVASADOS', stockErp: 17, precioVenta: 8.7, empaqueCompra: 12, empaqueCompraSimbolo: 'Emp.12' },
  { codigo: '100155', codigoBarras: '7750243034234', descripcion: 'COCINEROACEITEBOT1L', categoria: 'ACEITES ENVASADOS', stockErp: 20, precioVenta: 9.1, empaqueCompra: 12, empaqueCompraSimbolo: 'Emp.12' },
  { codigo: '100197', codigoBarras: '7750243035224', descripcion: 'FRIOLACEITEBID5L', categoria: 'ACEITES ENVASADOS', stockErp: 9, precioVenta: 40.5, empaqueCompra: 4, empaqueCompraSimbolo: 'Emp.4' },
  { codigo: '100299', codigoBarras: '7750243055680', descripcion: 'PRIMORACEITEVEGCLASI', categoria: 'ACEITES ENVASADOS', stockErp: 6, precioVenta: 56.7, empaqueCompra: 4, empaqueCompraSimbolo: 'Emp.4' },
  { codigo: '100300', codigoBarras: '7750243068000', descripcion: 'PRIMORACEITEVEGCLASI', categoria: 'ACEITES ENVASADOS', stockErp: 35, precioVenta: 9.3, empaqueCompra: 12, empaqueCompraSimbolo: 'Emp.12' },
  { codigo: '100304', codigoBarras: '7750243067997', descripcion: 'PRIMORACEITEVEGPREMI', categoria: 'ACEITES ENVASADOS', stockErp: 10, precioVenta: 10.2, empaqueCompra: 12, empaqueCompraSimbolo: 'Emp.12' },
  { codigo: '100492', codigoBarras: '7751729000477', descripcion: 'MILOLIVOSACEITEOLIVA', categoria: 'ACEITES ENVASADOS', stockErp: 22, precioVenta: 58.7, empaqueCompra: 1, empaqueCompraSimbolo: 'U' },
  { codigo: '102592', codigoBarras: '7751084000037', descripcion: 'ALPA ACEITE VEG PREMIUM BOT 1L', categoria: 'ACEITES ENVASADOS', stockErp: 73, precioVenta: 7.8, empaqueCompra: 12, empaqueCompraSimbolo: 'Emp.12' },
  { codigo: '102594', codigoBarras: '7751084000112', descripcion: 'ALPA ACEITE VEG PREMIUM BOT 3L', categoria: 'ACEITES ENVASADOS', stockErp: 13, precioVenta: 22.9, empaqueCompra: 6, empaqueCompraSimbolo: 'Emp.6' },
  { codigo: '102596', codigoBarras: '7751084000044', descripcion: 'ALPA ACEITE VEG PREMIUM BOT 5L', categoria: 'ACEITES ENVASADOS', stockErp: 11, precioVenta: 38.8, empaqueCompra: 4, empaqueCompraSimbolo: 'Emp.4' },
  { codigo: '102597', codigoBarras: '7755913000267', descripcion: 'TRUJILLO ACEITE VEG BOT 1L', categoria: 'ACEITES ENVASADOS', stockErp: 100, precioVenta: 7.6, empaqueCompra: 12, empaqueCompraSimbolo: 'Emp.12' },
  { codigo: '102598', codigoBarras: '7755913000281', descripcion: 'TRUJILLO ACEITE VEG BOT 5L', categoria: 'ACEITES ENVASADOS', stockErp: 13, precioVenta: 37.9, empaqueCompra: 4, empaqueCompraSimbolo: 'Emp.4' },
  { codigo: '104380', codigoBarras: '7750262288502', descripcion: 'OLIVOS DEL SUR ACEITE OLIVA EXT VIRGEN 1L', categoria: 'ACEITES ENVASADOS', stockErp: 12, precioVenta: 55, empaqueCompra: 1, empaqueCompraSimbolo: 'U' },
  { codigo: '104383', codigoBarras: '7750262906376', descripcion: 'OLIVOS DEL SUR ACEITE OLIVA PURO 1L', categoria: 'ACEITES ENVASADOS', stockErp: 13, precioVenta: 55, empaqueCompra: 1, empaqueCompraSimbolo: 'U' },
  { codigo: '111189', codigoBarras: '7751084000129', descripcion: 'ALPA ACEITE VEG PREMIUM BOT 900ML', categoria: 'ACEITES ENVASADOS', stockErp: 93, precioVenta: 7.2, empaqueCompra: 12, empaqueCompraSimbolo: 'Emp.12' },
  { codigo: '100797', codigoBarras: '7755913000045', descripcion: 'TRUJILLOARROZEXTRARO', categoria: 'ARROZ ENVASADO', stockErp: 8, precioVenta: 17.9, empaqueCompra: 4, empaqueCompraSimbolo: 'Emp.4' },
  { codigo: '100926', codigoBarras: '7755139161759', descripcion: 'COSTEÑOARROZEXTRA750', categoria: 'ARROZ ENVASADO', stockErp: 29, precioVenta: 3.8, empaqueCompra: 20, empaqueCompraSimbolo: 'Emp.20' },
  { codigo: '100935', codigoBarras: '7755139323140', descripcion: 'MOLINOROJOARROZINTEG', categoria: 'ARROZ ENVASADO', stockErp: 7, precioVenta: 5.7, empaqueCompra: 15, empaqueCompraSimbolo: 'Emp.15' },
  { codigo: '100936', codigoBarras: '7755139002793', descripcion: 'PAISANAARROZEXTRA1KG', categoria: 'ARROZ ENVASADO', stockErp: 19, precioVenta: 4.5, empaqueCompra: 12, empaqueCompraSimbolo: 'Emp.12' },
  { codigo: '100937', codigoBarras: '7755139002052', descripcion: 'PAISANAARROZEXTRA5KG', categoria: 'ARROZ ENVASADO', stockErp: 1, precioVenta: 21.4, empaqueCompra: 4, empaqueCompraSimbolo: 'Emp.4' },
  { codigo: '100939', codigoBarras: '7755139002816', descripcion: 'PAISANAARROZSUPERIOR', categoria: 'ARROZ ENVASADO', stockErp: 25, precioVenta: 4.3, empaqueCompra: 12, empaqueCompraSimbolo: 'Emp.12' },
  { codigo: '110591', codigoBarras: '756058848636', descripcion: 'PACASMAYO ARROZ EXTRA AÑEJO PREMIUM AZUL/CELESTE 750G', categoria: 'ARROZ ENVASADO', stockErp: 59, precioVenta: 4, empaqueCompra: 20, empaqueCompraSimbolo: 'Emp.20' },
  { codigo: '110592', codigoBarras: '756058848643', descripcion: 'PACASMAYO ARROZ EXTRA AÑEJO PREMIUM AZUL/CELESTE 5 KG', categoria: 'ARROZ ENVASADO', stockErp: 6, precioVenta: 25.5, empaqueCompra: 4, empaqueCompraSimbolo: 'Emp.4' },
  { codigo: '110764', codigoBarras: '0756058848650', descripcion: 'PACASMAYO ARROZ EXTRA NARANJA/CREMA 5 KG', categoria: 'ARROZ ENVASADO', stockErp: 11, precioVenta: 23.5, empaqueCompra: 4, empaqueCompraSimbolo: 'Emp.4' },
  { codigo: '110765', codigoBarras: '756058848667', descripcion: 'PACASMAYO ARROZ EXTRA NARANJA/CREMA 750GM', categoria: 'ARROZ ENVASADO', stockErp: 45, precioVenta: 3.7, empaqueCompra: 20, empaqueCompraSimbolo: 'Emp.20' },
  { codigo: '112270', codigoBarras: '7755139003363', descripcion: 'COSTEÑO ARROZ EXTRA AÑEJO 5KG', categoria: 'ARROZ ENVASADO', stockErp: 4, precioVenta: 23.9, empaqueCompra: 4, empaqueCompraSimbolo: 'Emp.4' },
  { codigo: '112271', codigoBarras: '7754725001219', descripcion: 'VALLE NORTE ARROZ GRAN RESERVA EXTRA 750G', categoria: 'ARROZ ENVASADO', stockErp: 31, precioVenta: 4, empaqueCompra: 20, empaqueCompraSimbolo: 'Emp.20' },
  { codigo: '112495', codigoBarras: '7755139003356', descripcion: 'COSTEÑO ARROZ AÑEJO EXTRA 750G', categoria: 'ARROZ ENVASADO', stockErp: 12, precioVenta: 3.6, empaqueCompra: 20, empaqueCompraSimbolo: 'Emp.20' },
  { codigo: '112972', codigoBarras: '7754725001226', descripcion: 'VALLE NORTE ARROZ GRAN RESERVA EXTRA 5KG', categoria: 'ARROZ ENVASADO', stockErp: 8, precioVenta: 25.2, empaqueCompra: 4, empaqueCompraSimbolo: 'Emp.4' },
  { codigo: '102216', codigoBarras: '7751271032995', descripcion: 'GLORIAYOFRESHBEBLACT', categoria: 'BEBIBLES Y YOGURT', stockErp: 18, precioVenta: 6.4, empaqueCompra: 6, empaqueCompraSimbolo: 'Emp.6' },
  { codigo: '102218', codigoBarras: '7751271029568', descripcion: 'GLORIAYOFRESHBEBLACT', categoria: 'BEBIBLES Y YOGURT', stockErp: 26, precioVenta: 6.4, empaqueCompra: 6, empaqueCompraSimbolo: 'Emp.6' },
  { codigo: '102221', codigoBarras: '7751271029575', descripcion: 'GLORIAYOFRESHBEBLACT', categoria: 'BEBIBLES Y YOGURT', stockErp: 11, precioVenta: 6.4, empaqueCompra: 6, empaqueCompraSimbolo: 'Emp.6' },
  { codigo: '102245', codigoBarras: '7751271030410', descripcion: 'GLORIAYOGURTDURAZNO1', categoria: 'BEBIBLES Y YOGURT', stockErp: 17, precioVenta: 6.5, empaqueCompra: 6, empaqueCompraSimbolo: 'Emp.6' },
  { codigo: '102246', codigoBarras: '7751271032414', descripcion: 'GLORIAYOGURTDURAZNO1', categoria: 'BEBIBLES Y YOGURT', stockErp: 12, precioVenta: 11, empaqueCompra: 4, empaqueCompraSimbolo: 'Emp.4' },
  { codigo: '102249', codigoBarras: '7751271020299', descripcion: 'GLORIAYOGURTFRESA946', categoria: 'BEBIBLES Y YOGURT', stockErp: 17, precioVenta: 5.5, empaqueCompra: 6, empaqueCompraSimbolo: 'Emp.6' },
  { codigo: '102250', codigoBarras: '7751271032445', descripcion: 'GLORIAYOGURTFRESA17K', categoria: 'BEBIBLES Y YOGURT', stockErp: 10, precioVenta: 11, empaqueCompra: 4, empaqueCompraSimbolo: 'Emp.4' },
  { codigo: '102262', codigoBarras: '7751271030434', descripcion: 'GLORIAYOGURTLUCUMA1K', categoria: 'BEBIBLES Y YOGURT', stockErp: 30, precioVenta: 6.5, empaqueCompra: 6, empaqueCompraSimbolo: 'Emp.6' },
  { codigo: '103623', codigoBarras: '7750151170956', descripcion: 'LAIVE YOGURT SBELT FRESA 946ML', categoria: 'BEBIBLES Y YOGURT', stockErp: 9, precioVenta: 7.1, empaqueCompra: 6, empaqueCompraSimbolo: 'Emp.6' },
  { codigo: '103629', codigoBarras: '7750151000260', descripcion: 'LAIVE YOGURT DESLACTOSADA FRESA 946ML', categoria: 'BEBIBLES Y YOGURT', stockErp: 3, precioVenta: 7.5, empaqueCompra: 6, empaqueCompraSimbolo: 'Emp.6' },
] as const;

function hojaDe(indice: number): string {
  return String(indice + 1).padStart(3, '0');
}

async function main(): Promise<number> {
  const pin = process.env.PIN_PILOTO ?? '000020';
  if (!/^\d{6}$/.test(pin)) {
    console.error('PIN_PILOTO tiene que ser de 6 digitos.');
    return 1;
  }
  const pinHash = await argon2.hash(pin);

  const sucursal = await prisma.sucursal.upsert({
    where: { id: SUCURSAL_ID },
    update: { nombre: TIENDA, activa: true },
    create: { id: SUCURSAL_ID, nombre: TIENDA, activa: true },
  });

  // El DNI es la identidad de una persona en el padron: se usa como clave del
  // upsert para que correr esto dos veces no deje dos cuentas iguales.
  const admin = await prisma.colaborador.upsert({
    where: { id: ADMIN_ID },
    update: { nombre: ADMIN.nombre, dni: ADMIN.dni, rol: 'administrador', pinHash, activo: true },
    // El administrador NO tiene sucursal: es del sistema (ver
    // sesion.service.ts#ROLES_SIN_TIENDA) y se elige en el grupo de arriba del
    // login, no dentro de una tienda.
    create: { id: ADMIN_ID, nombre: ADMIN.nombre, dni: ADMIN.dni, rol: 'administrador', pinHash, activo: true },
  });

  const contador = await prisma.colaborador.upsert({
    where: { id: CONTADOR_ID },
    update: { nombre: CONTADOR.nombre, dni: CONTADOR.dni, rol: 'conteo', sucursalId: sucursal.id, pinHash, activo: true },
    create: { id: CONTADOR_ID, nombre: CONTADOR.nombre, dni: CONTADOR.dni, rol: 'conteo', sucursalId: sucursal.id, pinHash, activo: true },
  });

  // UNO SOLO EN CURSO POR TIENDA: si ya hay, se reusa. Crear un segundo
  // dejaria al contador con dos inventarios abiertos y la app eligiendo uno
  // por su cuenta.
  const enCurso = await prisma.inventario.findFirst({
    where: { sucursalId: sucursal.id, estado: 'en_curso' },
    select: { id: true },
  });
  const inventario =
    enCurso ??
    (await prisma.inventario.create({
      data: {
        sucursalId: sucursal.id,
        estado: 'en_curso',
        tamanoHoja: TAMANO_HOJA,
        snapshotItems: PRODUCTOS.length,
        snapshotTomadoEn: new Date(),
      },
      select: { id: true },
    }));

  // El catalogo: es contra esto que se compara lo contado. Se escribe aunque
  // no haya auditor en el piloto -- sin catalogo, la pantalla del coordinador
  // diria que el inventario no tiene productos.
  for (const p of PRODUCTOS) {
    await prisma.catalogoItem.upsert({
      where: { inventarioId_codigo: { inventarioId: inventario.id, codigo: p.codigo } },
      update: {},
      create: {
        inventarioId: inventario.id,
        codigo: p.codigo,
        codigoBarras: p.codigoBarras,
        descripcion: p.descripcion,
        categoria: p.categoria,
        stockErp: p.stockErp,
        precioVenta: p.precioVenta,
        empaqueCompra: p.empaqueCompra,
        empaqueCompraSimbolo: p.empaqueCompraSimbolo,
      },
    });
  }

  // Las hojas, YA REPARTIDAS al contador. En el flujo real las crea y las
  // reparte el Coordinador; acá no hay, y el punto del piloto es que la
  // persona entre y encuentre su hoja sin que nadie le prepare nada.
  const existentes = await prisma.hojaConteo.count({ where: { inventarioId: inventario.id } });
  if (existentes === 0) {
    for (let i = 0; i < PRODUCTOS.length; i += TAMANO_HOJA) {
      const bloque = PRODUCTOS.slice(i, i + TAMANO_HOJA);
      const numero = hojaDe(i / TAMANO_HOJA);
      await prisma.hojaConteo.create({
        data: {
          inventarioId: inventario.id,
          numeroConteo: 1,
          numero,
          // La categoria que mas aporta, igual que `zonaDeHoja` del dominio.
          zona: bloque[0]!.categoria,
          gondola: numero,
          tamano: TAMANO_HOJA,
          asignadoAId: contador.id,
          productos: {
            create: bloque.map((p) => ({
              codigo: p.codigo,
              codigoBarras: p.codigoBarras,
              descripcion: p.descripcion,
              categoria: p.categoria,
              // El empaque de COMPRA, que es el unico que ofrece el modal
              // desde 2026-09-22. `1` = se compra suelto y no se ofrece
              // ninguno: el modal carga solo unidades.
              empaques:
                p.empaqueCompra > 1
                  ? { create: [{ nombre: p.empaqueCompraSimbolo, factor: p.empaqueCompra, orden: 0 }] }
                  : undefined,
            })),
          },
        },
      });
    }
  }

  const hojas = await prisma.hojaConteo.count({ where: { inventarioId: inventario.id } });
  console.log('');
  console.log(`Tienda:        ${sucursal.nombre} (id ${sucursal.id})`);
  console.log(`Administrador: ${admin.nombre} - DNI ${admin.dni}`);
  console.log(`Contador:      ${contador.nombre} - DNI ${contador.dni}`);
  console.log(`Inventario:    ${inventario.id} - ${PRODUCTOS.length} productos en ${hojas} hoja(s) del 1er conteo`);
  console.log('');
  if (process.env.PIN_PILOTO === undefined) {
    console.log('OJO: se uso el PIN de desarrollo, que esta escrito en el repositorio.');
    console.log('     Para uno propio: PIN_PILOTO=<6 digitos> npx tsx prisma/seed-piloto.ts');
  } else {
    console.log('Las dos cuentas quedaron con el PIN que pasaste en PIN_PILOTO.');
  }
  return 0;
}

main()
  .then(async (codigo) => {
    await prisma.$disconnect();
    process.exit(codigo);
  })
  .catch(async (e) => {
    console.error(e?.message ?? e);
    await prisma.$disconnect();
    process.exit(1);
  });
