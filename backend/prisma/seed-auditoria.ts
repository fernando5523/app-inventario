/**
 * Datos de demo para la pantalla del AUDITOR: la matriz que compara el ERP
 * contra los 3 conteos. Sin esto la matriz se ve vacia y no se puede
 * validar con el cliente.
 *
 * Siembra DOS inventarios, y los dos hacen falta:
 *
 *   8004 · Luzuriaga · mayo 2026 · conteo_cerrado
 *      La matriz completa, con el embudo de las 3 rondas y los cuatro
 *      veredictos representados: items que cuadran en la 1ra pasada, otros
 *      que se resuelven en la 2da, dos que llegan a la 3ra, cervezas que
 *      asume la empresa, y uno que nadie llego a contar.
 *
 *   8005 · Carhuaz · mes en curso · en_curso
 *      Un inventario abierto, con la ronda 1 a medias. Existe para poder
 *      ver la OTRA mitad de la regla: el coordinador NO puede abrir la
 *      matriz de este (ver auditoria.permisos.ts), y el auditor si.
 *
 * IDEMPOTENTE: si ya existen, no hace nada.
 */

import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ID_CERRADO = 8004; // Luzuriaga, mayo 2026
const ID_EN_CURSO = 8005; // Carhuaz, mes en curso

const dec = (n: number): Prisma.Decimal => new Prisma.Decimal(n.toFixed(4));
const fecha = (anio: number, mes: number, dia: number, hora: number): Date =>
  new Date(Date.UTC(anio, mes - 1, dia, hora, 0, 0));

/**
 * El catalogo de demo. `r1`/`r2`/`r3` es lo que dio cada ronda -- null
 * cuando ese item no necesito esa pasada, que es lo normal: la mayoria
 * cuadra en la primera y nunca vuelve a contarse.
 *
 * Los casos estan elegidos para que la pantalla muestre TODO lo que puede
 * pasar, no solo el camino feliz.
 */
const CATALOGO = [
  // --- Cuadran en la 1ra pasada (el grueso del inventario real) ---
  { codigo: 'IT-1001', desc: 'Aceite Vegetal Primor 900ml', stock: 120, precio: 8.9, empresa: false, zona: 'A', r1: 120, r2: null, r3: null },
  { codigo: 'IT-1003', desc: 'Leche Evaporada Gloria 400g', stock: 480, precio: 4.2, empresa: false, zona: 'A', r1: 480, r2: null, r3: null },
  { codigo: 'IT-1004', desc: 'Fideos Canuto Don Vittorio 500g', stock: 96, precio: 3.8, empresa: false, zona: 'B', r1: 96, r2: null, r3: null },
  { codigo: 'IT-1005', desc: 'Arroz Costeño Extra 5kg', stock: 60, precio: 24.5, empresa: false, zona: 'B', r1: 60, r2: null, r3: null },
  { codigo: 'IT-1006', desc: 'Azúcar Rubia Cartavio 1kg', stock: 300, precio: 4.9, empresa: false, zona: 'B', r1: 300, r2: null, r3: null },
  { codigo: 'IT-1009', desc: 'Papel Higiénico Elite x4', stock: 144, precio: 7.4, empresa: false, zona: 'C', r1: 144, r2: null, r3: null },

  // --- Diferencia en la 1ra, CUADRAN en la 2da (un error de conteo) ---
  { codigo: 'IT-1007', desc: 'Atún Florida en aceite 170g', stock: 200, precio: 5.6, empresa: false, zona: 'C', r1: 188, r2: 200, r3: null },
  { codigo: 'IT-1010', desc: 'Galleta Soda Field 6pack', stock: 250, precio: 3.2, empresa: false, zona: 'C', r1: 262, r2: 250, r3: null },

  // --- Llegan a la 3ra ronda: faltante real que se confirma ---
  { codigo: 'IT-1008', desc: 'Detergente Bolívar 780g', stock: 180, precio: 9.3, empresa: false, zona: 'D', r1: 150, r2: 158, r3: 156 },
  { codigo: 'IT-1011', desc: 'Shampoo Head&Shoulders 375ml', stock: 75, precio: 18.9, empresa: false, zona: 'D', r1: 60, r2: 66, r3: 68 },

  // --- SOBRANTE que se confirma: cae en el filtro "faltante" igual, la
  //     maqueta no tiene un cuarto bucket para sobrantes ---
  { codigo: 'IT-1012', desc: 'Jabón Bolívar 190g x3', stock: 90, precio: 6.1, empresa: false, zona: 'D', r1: 104, r2: 102, r3: 102 },

  // --- EMPRESA: las cervezas del ejemplo del cliente. Faltante real, pero
  //     lo asume gerencia por seguimiento de robo: NO se descuenta a nomina ---
  { codigo: 'IT-1002', desc: 'Cerveza Cusqueña Dorada 620ml', stock: 240, precio: 6.5, empresa: true, zona: 'E', r1: 198, r2: 205, r3: 205 },
  { codigo: 'IT-1013', desc: 'Cerveza Pilsen Callao 630ml', stock: 288, precio: 6.2, empresa: true, zona: 'E', r1: 250, r2: 256, r3: 256 },

  // --- Item de empresa que CUADRA: esEmpresa no inventa una diferencia ---
  { codigo: 'IT-1014', desc: 'Cerveza Cristal 650ml', stock: 192, precio: 6.3, empresa: true, zona: 'E', r1: 192, r2: null, r3: null },

  // --- Nadie lo conto todavia: la matriz lo muestra igual, con los tres
  //     conteos en null. Un item sin contar es informacion, no algo que
  //     esconder -- y NO se reporta como faltante de todo el stock ---
  { codigo: 'IT-1015', desc: 'Mayonesa AlaCena 400g', stock: 110, precio: 9.8, empresa: false, zona: 'C', r1: null, r2: null, r3: null },
] as const;

/** Un empaque por item, con factores realistas. */
const EMPAQUE = { nombre: 'Caja', factor: 12 };

interface Ronda {
  numero: number;
  /** Items que entran a esta ronda, con lo que dieron. */
  items: Array<{ codigo: string; desc: string; zona: string; contado: number }>;
}

/**
 * La ronda 1 se parte en UNA HOJA POR ZONA, no en una sola hoja gigante.
 * Asi es como se cuenta de verdad -- cada hoja cubre una gondola de una
 * zona -- y es lo que hace que la zona de un item signifique algo: la
 * matriz la toma de la hoja donde se conto (auditoria.service.ts), no del
 * producto, porque la zona es una propiedad de DONDE se conto.
 *
 * Las rondas de reconteo NO se parten por zona: se arman juntando los items
 * que no cuadraron, esten donde esten (docs/pantallas.md, Pantalla 4).
 */
function agruparPorZona(items: Ronda['items']): Map<string, Ronda['items']> {
  const porZona = new Map<string, Ronda['items']>();
  for (const item of items) {
    const actual = porZona.get(item.zona) ?? [];
    actual.push(item);
    porZona.set(item.zona, actual);
  }
  return porZona;
}

/**
 * Convierte una cantidad de unidades a lineas de conteo: cuantas cajas
 * enteras entran y cuantas sueltas sobran. Es como carga el operario en la
 * app ("2 cajas + 3 sueltas"), no un total plano -- y ademas ejercita el
 * calculo real de totalUnidades en vez de esquivarlo.
 */
function aLineas(unidades: number): { cajas: number; sueltas: number } {
  return { cajas: Math.floor(unidades / EMPAQUE.factor), sueltas: unidades % EMPAQUE.factor };
}

async function sembrarHojasYConteos(
  inventarioId: number,
  rondas: Ronda[],
  asignadoAId: number,
  cuando: Date,
  tamanoHoja: number,
): Promise<void> {
  let numeroHoja = 0;
  for (const ronda of rondas) {
    if (ronda.items.length === 0) continue;

    // Ronda 1: una hoja por zona. Reconteos: una sola, armada por
    // diferencia (ver agruparPorZona).
    const grupos =
      ronda.numero === 1
        ? [...agruparPorZona(ronda.items).entries()]
        : ([[`Reconteo ${ronda.numero}`, ronda.items]] as Array<[string, Ronda['items']]>);

    for (const [zona, itemsDeLaHoja] of grupos) {
    numeroHoja += 1;
    const hoja = await prisma.hojaConteo.create({
      data: {
        inventarioId,
        numeroConteo: ronda.numero,
        numero: String(numeroHoja).padStart(3, '0'),
        zona,
        gondola: ronda.numero === 1 ? String(numeroHoja) : '-',
        tamano: tamanoHoja,
        // FINALIZADA: solo las hojas finalizadas entran a la matriz. Una
        // hoja a medio contar leida como definitiva reporta faltantes que
        // no existen (ver auditoria.service.ts#armarMatriz).
        estado: 'finalizada',
        sync: 'sincronizado',
        asignadoAId,
        createdAt: cuando,
      },
    });

    for (const item of itemsDeLaHoja) {
      const producto = await prisma.producto.create({
        data: {
          hojaId: hoja.id,
          codigo: item.codigo,
          codigoBarras: `775${item.codigo.replace('IT-', '')}`,
          descripcion: item.desc,
          ubicacion: item.zona,
          empaques: { create: [{ nombre: EMPAQUE.nombre, factor: EMPAQUE.factor, orden: 0 }] },
        },
      });

      const { cajas, sueltas } = aLineas(item.contado);
      await prisma.conteo.create({
        data: {
          hojaId: hoja.id,
          productoId: producto.id,
          sueltas,
          confirmadoPorEscaner: true,
          contadoEn: cuando,
          ...(cajas > 0 ? { empaques: { create: [{ empaqueNombre: EMPAQUE.nombre, cantidad: cajas }] } } : {}),
        },
      });
    }
    }
  }
}

async function sembrarCerrado(): Promise<void> {
  if ((await prisma.inventario.findUnique({ where: { id: ID_CERRADO } })) !== null) {
    console.log('  8004 (Luzuriaga, 2026-05): ya existe, no se toca.');
    return;
  }

  const abiertoEn = fecha(2026, 5, 1, 9);
  const cerradoEn = fecha(2026, 5, 28, 18);

  await prisma.inventario.create({
    data: {
      id: ID_CERRADO,
      sucursalId: 1,
      // CERRADO: `abierto: null` para no ocupar el unico lugar de
      // inventario abierto de Luzuriaga.
      estado: 'conteo_cerrado',
      periodoAnio: 2026,
      periodoMes: 5,
      tamanoHoja: 50,
      snapshotItems: CATALOGO.length,
      snapshotTomadoEn: abiertoEn,
      abiertoEn,
      cerradoEn,
      cerradoPorId: 103, // Gilmer Quispe, auditor
      abierto: null,
    },
  });

  for (const item of CATALOGO) {
    await prisma.catalogoItem.create({
      data: {
        inventarioId: ID_CERRADO,
        codigo: item.codigo,
        codigoBarras: `775${item.codigo.replace('IT-', '')}`,
        descripcion: item.desc,
        // Los tres datos del ERP que hacen posible la auditoria.
        stockErp: item.stock,
        precioVenta: dec(item.precio),
        esEmpresa: item.empresa,
        empaques: { create: [{ nombre: EMPAQUE.nombre, factor: EMPAQUE.factor, orden: 0 }] },
        createdAt: abiertoEn,
      },
    });
  }

  const rondas: Ronda[] = [1, 2, 3].map((n) => ({
    numero: n,
    items: CATALOGO.filter((i) => (n === 1 ? i.r1 : n === 2 ? i.r2 : i.r3) !== null).map((i) => ({
      codigo: i.codigo,
      desc: i.desc,
      zona: i.zona,
      contado: (n === 1 ? i.r1 : n === 2 ? i.r2 : i.r3) as number,
    })),
  }));

  await sembrarHojasYConteos(ID_CERRADO, rondas, 102, cerradoEn, 50);

  console.log(
    `  8004 (Luzuriaga, 2026-05, conteo_cerrado): ${CATALOGO.length} items · ` +
      `ronda 1: ${rondas[0]!.items.length}, ronda 2: ${rondas[1]!.items.length}, ronda 3: ${rondas[2]!.items.length}`,
  );
}

async function sembrarEnCurso(): Promise<void> {
  if ((await prisma.inventario.findUnique({ where: { id: ID_EN_CURSO } })) !== null) {
    console.log('  8005 (Carhuaz, en curso): ya existe, no se toca.');
    return;
  }

  const abierto = await prisma.inventario.findFirst({ where: { sucursalId: 2, abierto: true } });
  if (abierto !== null) {
    console.log(`  8005: Carhuaz ya tiene un inventario abierto (id ${abierto.id}); se omite.`);
    return;
  }

  const ahora = new Date();
  const parcial = CATALOGO.slice(0, 8);

  await prisma.inventario.create({
    data: {
      id: ID_EN_CURSO,
      sucursalId: 2,
      estado: 'en_curso',
      tamanoHoja: 30,
      snapshotItems: parcial.length,
      snapshotTomadoEn: ahora,
      // `abierto` queda en su default true: es el inventario en curso de
      // Carhuaz, y es justo lo que el coordinador NO puede auditar.
    },
  });

  for (const item of parcial) {
    await prisma.catalogoItem.create({
      data: {
        inventarioId: ID_EN_CURSO,
        codigo: item.codigo,
        codigoBarras: `775${item.codigo.replace('IT-', '')}`,
        descripcion: item.desc,
        stockErp: item.stock,
        precioVenta: dec(item.precio),
        esEmpresa: item.empresa,
        empaques: { create: [{ nombre: EMPAQUE.nombre, factor: EMPAQUE.factor, orden: 0 }] },
      },
    });
  }

  await sembrarHojasYConteos(
    ID_EN_CURSO,
    [
      {
        numero: 1,
        items: parcial.slice(0, 5).map((i) => ({
          codigo: i.codigo,
          desc: i.desc,
          zona: i.zona,
          contado: (i.r1 ?? i.stock) as number,
        })),
      },
    ],
    202, // Pedro Cochachin, conteo (Carhuaz)
    ahora,
    30,
  );

  console.log(`  8005 (Carhuaz, en_curso): ${parcial.length} items, ronda 1 con 5 contados`);
}

async function main(): Promise<void> {
  const luzuriaga = await prisma.sucursal.findUnique({ where: { id: 1 } });
  if (luzuriaga === null) {
    console.error('Corré primero `npm run prisma:seed`: falta el padron de sucursales.');
    process.exitCode = 1;
    return;
  }

  console.log('Sembrando datos de auditoria:');
  await sembrarCerrado();
  await sembrarEnCurso();
  console.log('Listo: matriz completa en el cerrado, y un inventario en curso para probar el recorte del coordinador.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
