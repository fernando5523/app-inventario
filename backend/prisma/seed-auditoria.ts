/**
 * Datos de demo para la pantalla del AUDITOR: la matriz que compara el ERP
 * contra los 3 conteos. Sin esto la matriz se ve vacia y no se puede validar
 * con el cliente.
 *
 * LOS DATOS TIENEN LA FORMA DEL NEGOCIO REAL, no una version simplificada.
 * Cada cosa que el sistema tiene que saber distinguir esta representada:
 *
 *   EMPAQUES     Varios por producto, con los simbolos tal como los carga el
 *                ERP ("Emp.12", "Unidad", "Saco"). El factor NO se hardcodea:
 *                sale de factorDesdeSimbolo(), la misma funcion que usa el
 *                catalogo real. Si esa regla se rompe, el seed se rompe con
 *                ella -- que es exactamente lo que uno quiere de unos datos
 *                de prueba.
 *
 *   STOCK        Los TRES estados posibles, y los tres hacen falta:
 *                  numero > 0  el ERP dice cuanto deberia haber
 *                  0           el ERP dice que NO deberia haber ninguno
 *                  null        el ERP no trajo el dato: no se puede auditar
 *                Confundir los dos ultimos fue el bug que hizo que 11.835
 *                productos se reportaran como "100% cuadrados".
 *
 *   RESPONSABLE  Productos de empleado y productos de empresa, que es lo que
 *                separa el universo mensual del anual.
 *
 * Siembra CUATRO inventarios:
 *
 *   8004 · Luzuriaga · 2026-05 · MENSUAL · conteo_cerrado
 *      Solo productos de responsabilidad del empleado. La matriz completa,
 *      con el embudo de las 3 rondas y todos los veredictos representados.
 *
 *   8005 · Carhuaz · mes en curso · MENSUAL · en_curso
 *      Un inventario abierto, ronda 1 a medias. Existe para ver la otra
 *      mitad de la regla: el coordinador NO puede abrir su matriz.
 *
 *   8006 · Luzuriaga · 2026-05 · ANUAL · lacrado
 *      El MISMO periodo que el 8004, pero contando TODO -- empresa incluida.
 *      Los dos conviven porque `tipo` entra en la restriccion de periodo, y
 *      es la unica forma de ver la diferencia de universos con datos.
 *
 * IDEMPOTENTE: correrlo dos veces no duplica ni rompe nada. Cada inventario
 * se salta si ya existe, y las sucursales se actualizan con upsert.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { factorDesdeSimbolo } from '../src/dominio/empaque';

const prisma = new PrismaClient();

const ID_MENSUAL = 8004; // Luzuriaga, mayo 2026
const ID_EN_CURSO = 8005; // Carhuaz, mes en curso
const ID_ANUAL = 8006; // Luzuriaga, mayo 2026, anual

const dec = (n: number): Prisma.Decimal => new Prisma.Decimal(n.toFixed(4));
const fecha = (anio: number, mes: number, dia: number, hora: number): Date =>
  new Date(Date.UTC(anio, mes - 1, dia, hora, 0, 0));

/**
 * Simbolos de unidad TAL COMO vienen del ERP. El factor no se escribe: se
 * deriva con la misma funcion del catalogo real (ver src/dominio/empaque.ts).
 *
 * "emp.12 es 12 unidades, cualquier otra que no tenga valor numerico cae en
 * factor 1, ejemplo: unidad, ltr, saco, bolsa o cosas asi" -- textual del
 * cliente. Por eso conviven simbolos con numero y sin numero.
 */
const CAJA = 'Emp.12';
const PACK = 'Emp.6';
const PLANCHA = 'Emp.24';
const FARDO = 'Emp.20';
const UNIDAD = 'Unidad';
const SACO = 'Saco';
const LITRO = 'Ltr';

interface ItemCatalogo {
  codigo: string;
  desc: string;
  /** number = el ERP dice cuanto; 0 = dice que no hay; null = no trajo dato. */
  stock: number | null;
  precio: number | null;
  /** true = lo asume la EMPRESA: no entra al inventario mensual. */
  empresa: boolean;
  zona: string;
  /** Simbolos de empaque, del mas grande al mas chico. Siempre al menos uno. */
  empaques: string[];
  /** Lo que dio cada ronda. null = no necesito esa pasada. */
  r1: number | null;
  r2: number | null;
  r3: number | null;
}

const CATALOGO: ItemCatalogo[] = [
  // -------------------------------------------------------------------------
  // Productos de EMPLEADO -- los unicos que entran al inventario MENSUAL
  // -------------------------------------------------------------------------

  // --- Cuadran en la 1ra pasada (el grueso del inventario real) ---
  { codigo: 'IT-1001', desc: 'Aceite Vegetal Primor 900ml', stock: 120, precio: 8.9, empresa: false, zona: 'A', empaques: [CAJA, UNIDAD], r1: 120, r2: null, r3: null },
  { codigo: 'IT-1003', desc: 'Leche Evaporada Gloria 400g', stock: 480, precio: 4.2, empresa: false, zona: 'A', empaques: [PLANCHA, PACK, UNIDAD], r1: 480, r2: null, r3: null },
  { codigo: 'IT-1004', desc: 'Fideos Canuto Don Vittorio 500g', stock: 96, precio: 3.8, empresa: false, zona: 'B', empaques: [CAJA, UNIDAD], r1: 96, r2: null, r3: null },
  // Factor 1 en TODOS sus empaques: el arroz se cuenta por saco, no por caja.
  { codigo: 'IT-1005', desc: 'Arroz Costeño Extra 5kg', stock: 60, precio: 24.5, empresa: false, zona: 'B', empaques: [SACO], r1: 60, r2: null, r3: null },
  { codigo: 'IT-1006', desc: 'Azúcar Rubia Cartavio 1kg', stock: 300, precio: 4.9, empresa: false, zona: 'B', empaques: [FARDO, UNIDAD], r1: 300, r2: null, r3: null },
  { codigo: 'IT-1009', desc: 'Papel Higiénico Elite x4', stock: 144, precio: 7.4, empresa: false, zona: 'C', empaques: [FARDO, PACK, UNIDAD], r1: 144, r2: null, r3: null },

  // --- Diferencia en la 1ra, CUADRAN en la 2da (un error de conteo) ---
  { codigo: 'IT-1007', desc: 'Atún Florida en aceite 170g', stock: 200, precio: 5.6, empresa: false, zona: 'C', empaques: [PLANCHA, UNIDAD], r1: 188, r2: 200, r3: null },
  { codigo: 'IT-1010', desc: 'Galleta Soda Field 6pack', stock: 250, precio: 3.2, empresa: false, zona: 'C', empaques: [CAJA, PACK, UNIDAD], r1: 262, r2: 250, r3: null },

  // --- Llegan a la 3ra ronda: faltante real que se confirma ---
  { codigo: 'IT-1008', desc: 'Detergente Bolívar 780g', stock: 180, precio: 9.3, empresa: false, zona: 'D', empaques: [CAJA, UNIDAD], r1: 150, r2: 158, r3: 156 },
  { codigo: 'IT-1011', desc: 'Shampoo Head&Shoulders 375ml', stock: 75, precio: 18.9, empresa: false, zona: 'D', empaques: [PACK, UNIDAD], r1: 60, r2: 66, r3: 68 },

  // --- SOBRANTE confirmado: cae en el filtro "faltante" igual ---
  { codigo: 'IT-1012', desc: 'Jabón Bolívar 190g x3', stock: 90, precio: 6.1, empresa: false, zona: 'D', empaques: [CAJA, PACK, UNIDAD], r1: 104, r2: 102, r3: 102 },

  // --- STOCK CERO EXPLICITO: el ERP dice "no deberia haber ninguno" ---
  //     Se conto 0 y CUADRA. Es un dato real, no una ausencia de dato.
  { codigo: 'IT-1016', desc: 'Panetón Todinno 900g (fuera de temporada)', stock: 0, precio: 22.5, empresa: false, zona: 'A', empaques: [CAJA, UNIDAD], r1: 0, r2: null, r3: null },
  //     El ERP dice 0 pero aparecieron 8: sobrante puro, mercaderia que
  //     entro sin registrarse. Es el caso que un `0` tratado como "sin dato"
  //     haria desaparecer de la matriz.
  { codigo: 'IT-1017', desc: 'Chocolate Sublime 30g', stock: 0, precio: 1.5, empresa: false, zona: 'C', empaques: [PLANCHA, UNIDAD], r1: 8, r2: 8, r3: 8 },

  // --- STOCK NULL: el ERP no trajo el dato. NO se puede auditar ---
  //     Aunque SI se haya contado: falta el otro lado de la comparacion.
  { codigo: 'IT-1018', desc: 'Yogurt Gloria Fresa 1L', stock: null, precio: 6.8, empresa: false, zona: 'A', empaques: [LITRO], r1: 36, r2: null, r3: null },
  //     Sin stock y sin contar: el estado mas comun del catalogo real hoy.
  { codigo: 'IT-1015', desc: 'Mayonesa AlaCena 400g', stock: null, precio: null, empresa: false, zona: 'C', empaques: [CAJA, UNIDAD], r1: null, r2: null, r3: null },

  // --- CON stock pero SIN contar: nadie llego a este item ---
  { codigo: 'IT-1019', desc: 'Café Altomayo 190g', stock: 48, precio: 15.9, empresa: false, zona: 'B', empaques: [CAJA, UNIDAD], r1: null, r2: null, r3: null },

  // --- Con diferencia pero SIN PRECIO: no se puede valorizar ---
  //     La diferencia en unidades sigue valiendo; el monto no.
  { codigo: 'IT-1020', desc: 'Escoba plástica reforzada', stock: 24, precio: null, empresa: false, zona: 'D', empaques: [UNIDAD], r1: 18, r2: 20, r3: 20 },

  // -------------------------------------------------------------------------
  // Productos de EMPRESA -- NO entran al mensual, SI al anual
  // -------------------------------------------------------------------------

  { codigo: 'IT-1002', desc: 'Cerveza Cusqueña Dorada 620ml', stock: 240, precio: 6.5, empresa: true, zona: 'E', empaques: [CAJA, PACK, UNIDAD], r1: 198, r2: 205, r3: 205 },
  { codigo: 'IT-1013', desc: 'Cerveza Pilsen Callao 630ml', stock: 288, precio: 6.2, empresa: true, zona: 'E', empaques: [CAJA, PACK, UNIDAD], r1: 250, r2: 256, r3: 256 },
  // De empresa y CUADRA: esEmpresa no inventa una diferencia.
  { codigo: 'IT-1014', desc: 'Cerveza Cristal 650ml', stock: 192, precio: 6.3, empresa: true, zona: 'E', empaques: [CAJA, UNIDAD], r1: 192, r2: null, r3: null },
  { codigo: 'IT-1021', desc: 'Ron Cartavio Black 750ml', stock: 36, precio: 32.9, empresa: true, zona: 'E', empaques: [PACK, UNIDAD], r1: 33, r2: 34, r3: 34 },
];

/** Los que cuenta el inventario MENSUAL: solo responsabilidad del empleado. */
const DE_EMPLEADO = CATALOGO.filter((i) => !i.empresa);

/** Los que cuenta el ANUAL: todo el catalogo activo. */
const TODOS = CATALOGO;

// ---------------------------------------------------------------------------

interface ItemDeRonda {
  codigo: string;
  desc: string;
  zona: string;
  empaques: string[];
  contado: number;
}

interface Ronda {
  numero: number;
  items: ItemDeRonda[];
}

/**
 * La ronda 1 se parte en UNA HOJA POR ZONA, no en una sola hoja gigante. Asi
 * se cuenta de verdad -- cada hoja cubre una gondola de una zona -- y es lo
 * que hace que la zona de un item signifique algo: la matriz la toma de la
 * hoja donde se conto, no del producto, porque la zona es una propiedad de
 * DONDE se conto.
 *
 * Las rondas de reconteo NO se parten por zona: se arman juntando los items
 * que no cuadraron, esten donde esten (docs/pantallas.md, Pantalla 4).
 */
function agruparPorZona(items: ItemDeRonda[]): Map<string, ItemDeRonda[]> {
  const porZona = new Map<string, ItemDeRonda[]>();
  for (const item of items) {
    const actual = porZona.get(item.zona) ?? [];
    actual.push(item);
    porZona.set(item.zona, actual);
  }
  return porZona;
}

/**
 * Reparte una cantidad de unidades entre los empaques del producto, del mas
 * grande al mas chico, como la carga el operario ("2 cajas + 1 pack + 3
 * sueltas") y no como un total plano.
 *
 * Que el seed haga esta cuenta importa: ejercita el mismo camino que el
 * conteo real (LineaConteo por empaque + sueltas, total derivado con
 * totalUnidades) en vez de esquivarlo guardando un numero ya sumado. Si el
 * factor de un simbolo se rompiera, los totales del seed dejarian de cerrar.
 */
function repartirEnEmpaques(unidades: number, simbolos: string[]): { lineas: Array<{ nombre: string; cantidad: number }>; sueltas: number } {
  const lineas: Array<{ nombre: string; cantidad: number }> = [];
  let resto = unidades;

  // Solo los empaques que agrupan (factor > 1); los de factor 1 son la
  // unidad suelta y no tiene sentido cargarlos como linea.
  const agrupadores = simbolos
    .map((nombre) => ({ nombre, factor: factorDesdeSimbolo(nombre) }))
    .filter((e) => e.factor > 1)
    .sort((a, b) => b.factor - a.factor);

  for (const empaque of agrupadores) {
    const cuantos = Math.floor(resto / empaque.factor);
    if (cuantos > 0) {
      lineas.push({ nombre: empaque.nombre, cantidad: cuantos });
      resto -= cuantos * empaque.factor;
    }
  }

  return { lineas, sueltas: resto };
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

    const grupos =
      ronda.numero === 1
        ? [...agruparPorZona(ronda.items).entries()]
        : ([[`Reconteo ${ronda.numero}`, ronda.items]] as Array<[string, ItemDeRonda[]]>);

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
            empaques: {
              create: item.empaques.map((nombre, orden) => ({
                nombre,
                factor: factorDesdeSimbolo(nombre),
                orden,
              })),
            },
          },
        });

        const { lineas, sueltas } = repartirEnEmpaques(item.contado, item.empaques);
        await prisma.conteo.create({
          data: {
            hojaId: hoja.id,
            productoId: producto.id,
            sueltas,
            confirmadoPorEscaner: true,
            contadoEn: cuando,
            ...(lineas.length > 0
              ? { empaques: { create: lineas.map((l) => ({ empaqueNombre: l.nombre, cantidad: l.cantidad })) } }
              : {}),
          },
        });
      }
    }
  }
}

async function sembrarCatalogo(inventarioId: number, items: ItemCatalogo[], cuando: Date): Promise<void> {
  for (const item of items) {
    await prisma.catalogoItem.create({
      data: {
        inventarioId,
        codigo: item.codigo,
        codigoBarras: `775${item.codigo.replace('IT-', '')}`,
        descripcion: item.desc,
        // Los tres estados del stock viajan tal cual: null se guarda null.
        stockErp: item.stock,
        precioVenta: item.precio === null ? null : dec(item.precio),
        esEmpresa: item.empresa,
        empaques: {
          create: item.empaques.map((nombre, orden) => ({
            nombre,
            factor: factorDesdeSimbolo(nombre),
            orden,
          })),
        },
        createdAt: cuando,
      },
    });
  }
}

function rondasDe(items: ItemCatalogo[]): Ronda[] {
  return [1, 2, 3].map((n) => ({
    numero: n,
    items: items
      .filter((i) => (n === 1 ? i.r1 : n === 2 ? i.r2 : i.r3) !== null)
      .map((i) => ({
        codigo: i.codigo,
        desc: i.desc,
        zona: i.zona,
        empaques: i.empaques,
        contado: (n === 1 ? i.r1 : n === 2 ? i.r2 : i.r3) as number,
      })),
  }));
}

// ---------------------------------------------------------------------------

async function sembrarMensual(): Promise<void> {
  if ((await prisma.inventario.findUnique({ where: { id: ID_MENSUAL } })) !== null) {
    console.log('  8004 (Luzuriaga, 2026-05, mensual): ya existe, no se toca.');
    return;
  }

  const abiertoEn = fecha(2026, 5, 1, 9);
  const cerradoEn = fecha(2026, 5, 28, 18);

  await prisma.inventario.create({
    data: {
      id: ID_MENSUAL,
      sucursalId: 1,
      tipo: 'mensual',
      estado: 'conteo_cerrado',
      periodoAnio: 2026,
      periodoMes: 5,
      tamanoHoja: 50,
      snapshotItems: DE_EMPLEADO.length,
      snapshotTomadoEn: abiertoEn,
      abiertoEn,
      cerradoEn,
      cerradoPorId: 103, // Gilmer Quispe, auditor
      // CERRADO: no ocupa el unico lugar de inventario abierto de Luzuriaga.
      abierto: null,
    },
  });

  // El MENSUAL solo trae los de responsabilidad del empleado: las cervezas
  // ni siquiera aparecen en su catalogo.
  await sembrarCatalogo(ID_MENSUAL, DE_EMPLEADO, abiertoEn);
  const rondas = rondasDe(DE_EMPLEADO);
  await sembrarHojasYConteos(ID_MENSUAL, rondas, 102, cerradoEn, 50);

  console.log(
    `  8004 (Luzuriaga, 2026-05, MENSUAL): ${DE_EMPLEADO.length} items de empleado · ` +
      `rondas ${rondas[0]!.items.length}/${rondas[1]!.items.length}/${rondas[2]!.items.length}`,
  );
}

async function sembrarAnual(): Promise<void> {
  if ((await prisma.inventario.findUnique({ where: { id: ID_ANUAL } })) !== null) {
    console.log('  8006 (Luzuriaga, 2026-05, anual): ya existe, no se toca.');
    return;
  }

  const abiertoEn = fecha(2026, 5, 29, 8);
  const cerradoEn = fecha(2026, 5, 31, 20);

  await prisma.inventario.create({
    data: {
      id: ID_ANUAL,
      sucursalId: 1,
      tipo: 'anual',
      estado: 'lacrado',
      // MISMO periodo que el mensual: conviven porque `tipo` entra en la
      // restriccion de periodo. Es la unica forma de ver la diferencia de
      // universos sobre los mismos datos.
      periodoAnio: 2026,
      periodoMes: 5,
      tamanoHoja: 50,
      snapshotItems: TODOS.length,
      snapshotTomadoEn: abiertoEn,
      abiertoEn,
      cerradoEn,
      cerradoPorId: 103,
      abierto: null,
    },
  });

  // El ANUAL cuenta TODO, empresa incluida.
  await sembrarCatalogo(ID_ANUAL, TODOS, abiertoEn);
  const rondas = rondasDe(TODOS);
  await sembrarHojasYConteos(ID_ANUAL, rondas, 102, cerradoEn, 50);

  // Las dos firmas y el sello: un anual lacrado se ve completo en el historico.
  await prisma.aprobacionCierre.create({
    data: { inventarioId: ID_ANUAL, aprobadorId: 103, rolAlAprobar: 'auditor', aprobadoEn: fecha(2026, 6, 1, 10) },
  });
  await prisma.aprobacionCierre.create({
    data: {
      inventarioId: ID_ANUAL,
      aprobadorId: 106,
      rolAlAprobar: 'auditor',
      aprobadoEn: fecha(2026, 6, 1, 15),
      nota: 'Inventario anual: se conto tambien lo de la empresa.',
    },
  });

  console.log(
    `  8006 (Luzuriaga, 2026-05, ANUAL): ${TODOS.length} items (${TODOS.length - DE_EMPLEADO.length} de empresa) · ` +
      `mismo periodo que el mensual, universo distinto`,
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
  const parcial = DE_EMPLEADO.slice(0, 10);

  await prisma.inventario.create({
    data: {
      id: ID_EN_CURSO,
      sucursalId: 2,
      tipo: 'mensual',
      estado: 'en_curso',
      tamanoHoja: 30,
      snapshotItems: parcial.length,
      snapshotTomadoEn: ahora,
      // `abierto` queda en su default true: es el inventario en curso de
      // Carhuaz, y es justo lo que el coordinador NO puede auditar.
    },
  });

  await sembrarCatalogo(ID_EN_CURSO, parcial, ahora);
  await sembrarHojasYConteos(
    ID_EN_CURSO,
    [
      {
        numero: 1,
        items: parcial.slice(0, 6).map((i) => ({
          codigo: i.codigo,
          desc: i.desc,
          zona: i.zona,
          empaques: i.empaques,
          contado: i.r1 ?? i.stock ?? 0,
        })),
      },
    ],
    202, // Pedro Cochachin, conteo (Carhuaz)
    ahora,
    30,
  );

  console.log(`  8005 (Carhuaz, en_curso, MENSUAL): ${parcial.length} items, ronda 1 con 6 contados`);
}

async function main(): Promise<void> {
  const luzuriaga = await prisma.sucursal.findUnique({ where: { id: 1 } });
  if (luzuriaga === null) {
    console.error('Corré primero `npm run prisma:seed`: falta el padron de sucursales.');
    process.exitCode = 1;
    return;
  }

  const conStock = CATALOGO.filter((i) => i.stock !== null && i.stock > 0).length;
  const enCero = CATALOGO.filter((i) => i.stock === 0).length;
  const sinDato = CATALOGO.filter((i) => i.stock === null).length;

  console.log('Sembrando datos de auditoria:');
  console.log(
    `  catalogo: ${CATALOGO.length} items · ${conStock} con stock, ${enCero} en CERO explicito, ${sinDato} SIN dato del ERP`,
  );
  console.log(`  empaques: factores ${[...new Set(CATALOGO.flatMap((i) => i.empaques))].map((s) => `${s}=${factorDesdeSimbolo(s)}`).join(', ')}`);

  await sembrarMensual();
  await sembrarAnual();
  await sembrarEnCurso();
  console.log('Listo.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
