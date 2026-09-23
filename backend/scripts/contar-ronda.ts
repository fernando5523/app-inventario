/**
 * Carga el PRIMER CONTEO completo de un inventario que ya tiene sus hojas
 * creadas y repartidas. Es una herramienta de DESARROLLO para llegar rápido
 * a los tramos de cierre sin teclear mil productos en el emulador.
 *
 * LOS NÚMEROS NO LOS CONTÓ NADIE. Igual que `sembrar-inventario-prueba.ts`,
 * esto NO representa cómo cuenta una persona parada en la góndola: el valor
 * lo elige este script. Lo que sí es real es el CAMINO -- cada conteo entra
 * por `hojas.service.ts#guardarConteo`, la misma función que usa el teléfono,
 * así que valen las mismas reglas (hoja no finalizada, producto de esa hoja,
 * quien carga tiene que estar asignado).
 *
 * A NOMBRE DE QUIEN: de la persona que tiene asignada CADA hoja, no de una
 * sola. Si la hoja 003 es de Delia, sus conteos quedan a nombre de Delia --
 * si se cargaran todos a nombre de uno, la liquidación después repartiría mal
 * y el registro de quién contó qué sería falso.
 *
 * LAS DIFERENCIAS SON EL PUNTO. Un inventario donde todo cuadra cierra en la
 * primera ronda y no deja nada que auditar, liquidar ni lacrar: los tramos que
 * siguen se quedan sin insumo. Por eso se siembran unas pocas a propósito, y
 * al menos una que CRUZA el umbral de media caja -- que es la que prueba la
 * regla del faltante por paquete.
 *
 *   npx tsx scripts/contar-primera-ronda.ts --dry-run   --inventario <id> [--faltantes <n>] [--sobrantes <n>] [--finalizar]
 *   npx tsx scripts/contar-primera-ronda.ts --confirmar --inventario <id> [--faltantes <n>] [--sobrantes <n>] [--finalizar]
 *
 *   --faltantes  Cuántos ítems contar POR DEBAJO del stock (default 3).
 *   --sobrantes  Cuántos contar POR ENCIMA (default 2).
 *   --finalizar  Deja además cada hoja FINALIZADA, lista para cerrar la ronda.
 *
 * El resto de los ítems se cuenta IGUAL al stock del ERP.
 */
import { prisma } from '../src/config/database';
import { finalizar, guardarConteo } from '../src/modules/hojas/hojas.service';
import type { ColaboradorAutenticado } from '../src/shared/tipos-sesion';

/**
 * Un faltante que CRUZA media caja y otro que NO, a propósito.
 *
 * El primero sale del descuento al personal y va al cuadro de paquetes; el
 * segundo se queda. Sembrar solo uno de los dos dejaría medio calculo sin
 * probar, y son justamente los dos lados de la regla que definió el cliente.
 */
const FALTA_QUE_CRUZA = 0.75; // 75% de la caja: bien por encima de la mitad
const FALTA_CHICA = 1; // una sola unidad: nunca llega a media caja

function argNumero(bandera: string, porDefecto: number): number {
  const i = process.argv.indexOf(bandera);
  if (i === -1) return porDefecto;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${bandera} espera un entero >= 0`);
  return n;
}

async function main(): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Este script no corre contra produccion.');
    return 1;
  }
  const modo = process.argv[2];
  if (modo !== '--dry-run' && modo !== '--confirmar') {
    console.error('Uso: npx tsx scripts/contar-primera-ronda.ts --dry-run|--confirmar --inventario <id> [--faltantes <n>] [--sobrantes <n>] [--finalizar]');
    return 1;
  }
  const inventarioId = argNumero('--inventario', 0);
  if (inventarioId === 0) {
    console.error('Falta --inventario <id>.');
    return 1;
  }
  const cuantosFaltantes = argNumero('--faltantes', 3);
  const cuantosSobrantes = argNumero('--sobrantes', 2);
  const dejarFinalizada = process.argv.includes('--finalizar');

  const inventario = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    select: { id: true, sucursalId: true, estado: true, sucursal: { select: { nombre: true } } },
  });
  if (!inventario) {
    console.error(`No existe el inventario ${inventarioId}.`);
    return 1;
  }
  if (inventario.estado !== 'en_curso') {
    console.error(`El inventario ${inventarioId} está en "${inventario.estado}", no en curso.`);
    return 1;
  }

  const hojas = await prisma.hojaConteo.findMany({
    where: { inventarioId, numeroConteo: 1 },
    select: {
      id: true,
      numero: true,
      estado: true,
      asignadoAId: true,
      asignadoA: { select: { id: true, nombre: true, rol: true } },
      productos: { select: { id: true, codigo: true, descripcion: true } },
    },
    orderBy: { numero: 'asc' },
  });
  if (hojas.length === 0) {
    console.error(`El inventario ${inventarioId} no tiene hojas de la ronda 1.`);
    return 1;
  }
  const sinAsignar = hojas.filter((h) => h.asignadoAId === null);
  if (sinAsignar.length > 0) {
    console.error(
      `Hay ${sinAsignar.length} hoja(s) sin asignar (${sinAsignar.map((h) => h.numero).join(', ')}). ` +
        'Los conteos se cargan A NOMBRE de quien tiene la hoja: repártelas primero.',
    );
    return 1;
  }

  // El stock y el empaque salen del catálogo, cruzados por código: es la
  // misma identidad estable que usa el resto del sistema entre rondas.
  const catalogo = await prisma.catalogoItem.findMany({
    where: { inventarioId },
    select: { codigo: true, stockErp: true, empaqueCompra: true, descripcion: true },
  });
  const porCodigo = new Map(catalogo.map((c) => [c.codigo, c] as const));

  // Candidatos a llevar diferencia: hace falta stock suficiente para poder
  // restarle algo y que siga siendo un número que alguien pudo contar.
  const todos = hojas.flatMap((h) => h.productos.map((p) => ({ hoja: h, producto: p })));
  const conStock = todos.filter((t) => (porCodigo.get(t.producto.codigo)?.stockErp ?? 0) > 0);

  const paraCruzar = conStock.filter((t) => {
    const c = porCodigo.get(t.producto.codigo)!;
    return (c.empaqueCompra ?? 1) > 1 && c.stockErp! >= Math.ceil((c.empaqueCompra ?? 1) * FALTA_QUE_CRUZA) + 1;
  });

  const elegidos = new Set<number>();
  const plan: Array<{ hojaId: number; productoId: number; codigo: string; descripcion: string; stock: number; conteo: number; papel: string; empaque: number | null }> = [];

  function anotar(t: { hoja: (typeof hojas)[number]; producto: { id: number; codigo: string; descripcion: string } }, conteo: number, papel: string) {
    const c = porCodigo.get(t.producto.codigo)!;
    elegidos.add(t.producto.id);
    plan.push({
      hojaId: t.hoja.id,
      productoId: t.producto.id,
      codigo: t.producto.codigo,
      descripcion: t.producto.descripcion,
      stock: c.stockErp!,
      conteo,
      papel,
      empaque: c.empaqueCompra,
    });
  }

  // 1) El faltante que CRUZA media caja -- el que prueba la regla del paquete.
  const cruzador = paraCruzar.find((t) => !elegidos.has(t.producto.id));
  if (cruzador && cuantosFaltantes > 0) {
    const c = porCodigo.get(cruzador.producto.codigo)!;
    const falta = Math.ceil((c.empaqueCompra ?? 1) * FALTA_QUE_CRUZA);
    anotar(cruzador, c.stockErp! - falta, `faltante (${falta} de ${c.empaqueCompra}: cruza media caja)`);
  }
  // 2) El resto de los faltantes, chicos: se le descuentan al personal.
  for (const t of conStock) {
    if (plan.filter((p) => p.papel.startsWith('faltante')).length >= cuantosFaltantes) break;
    if (elegidos.has(t.producto.id)) continue;
    const c = porCodigo.get(t.producto.codigo)!;
    if (c.stockErp! < FALTA_CHICA + 1) continue;
    anotar(t, c.stockErp! - FALTA_CHICA, 'faltante (1 unidad)');
  }
  // 3) Los sobrantes.
  for (const t of conStock) {
    if (plan.filter((p) => p.papel.startsWith('sobrante')).length >= cuantosSobrantes) break;
    if (elegidos.has(t.producto.id)) continue;
    const c = porCodigo.get(t.producto.codigo)!;
    anotar(t, c.stockErp! + 1, 'sobrante (1 unidad)');
  }

  const cuadrados = todos.length - plan.length;

  console.log(`\nInventario ${inventarioId} -- ${inventario.sucursal.nombre}`);
  console.log(`Hojas de la ronda 1: ${hojas.length}  ·  productos: ${todos.length}`);
  console.log(`A nombre de: ${[...new Set(hojas.map((h) => h.asignadoA!.nombre))].join(', ')}`);
  console.log(`\nSe van a cargar ${todos.length} conteos: ${cuadrados} cuadrados + ${plan.length} con diferencia.`);
  for (const p of plan) {
    console.log(`  ${p.codigo}  ${p.descripcion.slice(0, 34).padEnd(34)} stock=${String(p.stock).padStart(5)} conteo=${String(p.conteo).padStart(5)}  ${p.papel}`);
  }
  console.log(`Finalizar las hojas al terminar: ${dejarFinalizada ? 'si' : 'no'}`);

  if (modo === '--dry-run') {
    console.log('\nDRY RUN: no se cargo nada. Corre con --confirmar para ejecutar.');
    return 0;
  }

  const conteoPorProducto = new Map(plan.map((p) => [p.productoId, p.conteo] as const));
  let cargados = 0;
  for (const hoja of hojas) {
    const actor: ColaboradorAutenticado = {
      colaboradorId: hoja.asignadoA!.id,
      sucursalId: inventario.sucursalId,
      rol: hoja.asignadoA!.rol,
    };
    for (const producto of hoja.productos) {
      const stock = porCodigo.get(producto.codigo)?.stockErp ?? 0;
      const sueltas = conteoPorProducto.get(producto.id) ?? stock;
      await guardarConteo(actor, hoja.id, producto.id, {
        empaques: [],
        sueltas,
        confirmadoPorEscaner: false,
        contadoEn: new Date(),
      });
      cargados += 1;
    }
    if (dejarFinalizada) await finalizar(actor, hoja.id);
    console.log(`  hoja ${hoja.numero}: ${hoja.productos.length} conteos a nombre de ${hoja.asignadoA!.nombre}${dejarFinalizada ? ' · finalizada' : ''}`);
  }

  console.log(`\nListo: ${cargados} conteos cargados en ${hojas.length} hoja(s).`);
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
