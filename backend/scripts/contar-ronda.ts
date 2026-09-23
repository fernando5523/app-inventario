/**
 * Carga UNA RONDA completa de conteo en un inventario que ya tiene las hojas
 * de esa ronda creadas y repartidas.
 *
 * SE LLAMABA `contar-primera-ronda.ts` y solo sabia de la ronda 1. Con
 * `--ronda` sirve igual para la 2da y la 3ra, que es donde se prueba el
 * embudo: la ronda N+1 nace SOLO con lo que no cuadro, asi que sembrarla a
 * mano era la unica forma de llegar al ajuste del Auditor con un ciclo de
 * verdad. Es una herramienta de DESARROLLO para llegar rápido
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
 *   npx tsx scripts/contar-ronda.ts --dry-run   --inventario <id> [--ronda <n>] [--faltantes <n>] [--cruzan <n>] [--sobrantes <n>] [--finalizar]
 *   npx tsx scripts/contar-ronda.ts --confirmar --inventario <id> [--ronda <n>] [--faltantes <n>] [--cruzan <n>] [--sobrantes <n>] [--finalizar]
 *
 *   --ronda      Cual ronda se cuenta (default 1). La ronda tiene que existir
 *                y tener sus hojas repartidas.
 *
 *   --faltantes  Cuántos ítems contar POR DEBAJO del stock (default 3).
 *   --cruzan     Cuántos de esos faltantes CRUZAN media caja (default 1). Son
 *                los que salen del descuento al personal y van al cuadro de
 *                paquetes: con uno solo, ese cuadro queda con un ítem y no
 *                alcanza para mirar cómo se comporta la pantalla con varios.
 *   --sobrantes  Cuántos contar POR ENCIMA (default 2).
 *   --sobrantes-cruzan  Cuántos de esos sobrantes CRUZAN media caja (default 0).
 *                La regla del paquete mira el VALOR ABSOLUTO de la diferencia,
 *                así que un sobrante de más de media caja también sale del
 *                descuento al personal y se audita aparte. Sin sembrar uno, ese
 *                lado de la fórmula no se puede mirar en pantalla.
 *   --finalizar  Deja además cada hoja FINALIZADA, lista para cerrar la ronda.
 *
 * El resto de los ítems se cuenta IGUAL al stock del ERP -- o sea que CUADRAN,
 * y en una ronda de reconteo eso es lo que los saca del embudo.
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

/**
 * Precio maximo de un producto elegido para SOBRAR. Ver el comentario del
 * paso 3: un sobrante caro da vuelta el cuadro del personal en plata aunque
 * en unidades haya mas faltante.
 */
const TECHO_SOBRANTE = 50;

/**
 * Elige `cuantos` elementos REPARTIDOS a lo largo de la lista, no los primeros.
 *
 * Los primeros caen todos juntos: el catálogo viene ordenado por código y las
 * hojas se arman en ese mismo orden, así que las 16 diferencias terminaban en
 * dos hojas y en una sola categoría (todas ACEITES, medido el 2026-09-22). Con
 * eso no se puede probar el filtro por hoja ni por categoría de la matriz, que
 * es justamente para lo que se siembran.
 */
function espaciados<T>(lista: T[], cuantos: number): T[] {
  if (cuantos <= 0 || lista.length === 0) return [];
  if (cuantos >= lista.length) return [...lista];
  const paso = lista.length / cuantos;
  return Array.from({ length: cuantos }, (_, i) => lista[Math.floor(i * paso)]!);
}

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
  const ronda = argNumero('--ronda', 1);
  if (ronda < 1) {
    console.error('--ronda espera un entero >= 1.');
    return 1;
  }
  const cuantosFaltantes = argNumero('--faltantes', 3);
  const cuantosCruzan = argNumero('--cruzan', 1);
  if (cuantosCruzan > cuantosFaltantes) {
    console.error(`--cruzan (${cuantosCruzan}) no puede superar a --faltantes (${cuantosFaltantes}): los que cruzan SON faltantes.`);
    return 1;
  }
  const cuantosSobrantes = argNumero('--sobrantes', 2);
  const sobrantesQueCruzan = argNumero('--sobrantes-cruzan', 0);
  if (sobrantesQueCruzan > cuantosSobrantes) {
    console.error(`--sobrantes-cruzan (${sobrantesQueCruzan}) no puede superar a --sobrantes (${cuantosSobrantes}).`);
    return 1;
  }
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
    where: { inventarioId, numeroConteo: ronda },
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
    console.error(`El inventario ${inventarioId} no tiene hojas de la ronda ${ronda}.`);
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
    select: { codigo: true, stockErp: true, empaqueCompra: true, descripcion: true, precioVenta: true },
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

  // 1) Los faltantes que CRUZAN media caja -- los que prueban la regla del
  //    paquete. Van PRIMERO para que se lleven los mejores candidatos: son los
  //    unicos que necesitan empaque > 1 y stock suficiente para restarle casi
  //    una caja entera.
  for (const t of espaciados(paraCruzar, cuantosCruzan * 3)) {
    if (plan.length >= cuantosCruzan) break;
    if (elegidos.has(t.producto.id)) continue;
    const c = porCodigo.get(t.producto.codigo)!;
    const falta = Math.ceil((c.empaqueCompra ?? 1) * FALTA_QUE_CRUZA);
    anotar(t, c.stockErp! - falta, `faltante (${falta} de ${c.empaqueCompra}: cruza media caja)`);
  }
  if (plan.length < cuantosCruzan) {
    console.error(
      `Solo hay ${plan.length} item(s) que puedan cruzar media caja y se pidieron ${cuantosCruzan}. ` +
        'Hace falta empaque de compra > 1 Y stock suficiente para restarle casi una caja.',
    );
    return 1;
  }
  // 2) El resto de los faltantes, chicos: se le descuentan al personal.
  for (const t of espaciados(conStock, (cuantosFaltantes - cuantosCruzan) * 3)) {
    if (plan.filter((p) => p.papel.startsWith('faltante')).length >= cuantosFaltantes) break;
    if (elegidos.has(t.producto.id)) continue;
    const c = porCodigo.get(t.producto.codigo)!;
    if (c.stockErp! < FALTA_CHICA + 1) continue;
    anotar(t, c.stockErp! - FALTA_CHICA, 'faltante (1 unidad)');
  }
  /**
   * 3) Los sobrantes, sobre productos BARATOS.
   *
   * MEDIDO el 2026-09-22: uno de los cuatro sobrantes cayo en un Chivas Regal
   * 18 años de S/250 y dio vuelta el cuadro del personal -- 8 unidades
   * faltantes por S/160,90 contra 4 sobrantes por S/289,30. En unidades habia
   * mas faltante, pero en plata ganaba el sobrante y la liquidacion se quedaba
   * sin nada que descontar, que es justamente lo que estos datos existen para
   * probar.
   *
   * Un solo item caro alcanza para eso, asi que los sobrantes se buscan entre
   * los de precio bajo. Si no hay suficientes, se cae a la lista completa: es
   * preferible un escenario con un sobrante caro que uno sin sobrantes.
   */
  // 3a) Los sobrantes que CRUZAN media caja: el mismo umbral que los faltantes,
  //     para el otro lado del signo. Van antes que los chicos porque necesitan
  //     empaque > 1 y se llevan los pocos candidatos que hay.
  for (const t of espaciados(paraCruzar, Math.max(1, sobrantesQueCruzan * 3))) {
    if (plan.filter((p) => p.papel.startsWith('sobrante')).length >= sobrantesQueCruzan) break;
    if (elegidos.has(t.producto.id)) continue;
    const c = porCodigo.get(t.producto.codigo)!;
    const sobra = Math.ceil((c.empaqueCompra ?? 1) * FALTA_QUE_CRUZA);
    anotar(t, c.stockErp! + sobra, `sobrante (${sobra} de ${c.empaqueCompra}: cruza media caja)`);
  }

  const baratos = conStock.filter((t) => (porCodigo.get(t.producto.codigo)?.precioVenta?.toNumber() ?? 0) <= TECHO_SOBRANTE);
  const paraSobrantes = baratos.length >= cuantosSobrantes ? baratos : conStock;
  // Se recorre al REVES para que no caigan encima de los faltantes: los dos
  // grupos salen de la misma lista espaciada.
  for (const t of espaciados(paraSobrantes, cuantosSobrantes * 3).reverse()) {
    if (plan.filter((p) => p.papel.startsWith('sobrante')).length >= cuantosSobrantes) break;
    if (elegidos.has(t.producto.id)) continue;
    const c = porCodigo.get(t.producto.codigo)!;
    anotar(t, c.stockErp! + 1, 'sobrante (1 unidad)');
  }

  const cuadrados = todos.length - plan.length;

  console.log(`\nInventario ${inventarioId} -- ${inventario.sucursal.nombre}`);
  console.log(`Hojas de la ronda ${ronda}: ${hojas.length}  ·  productos: ${todos.length}`);
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
