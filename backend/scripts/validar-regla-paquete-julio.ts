/**
 * LA PRUEBA DECISIVA: ¿la regla del umbral reproduce la clasificacion que
 * Gilmer hizo A MANO en el inventario real de Bolivar, julio 2026?
 *
 * ---------------------------------------------------------------------------
 * QUE SE ESTA PROBANDO
 * ---------------------------------------------------------------------------
 * El Excel del cliente ("INVENTARIO MES DE JULIO 2026 ACTUAL MKT BOLIVAR")
 * trae el cuadro por paquete YA HECHO: 107 renglones que Gilmer mando, uno
 * por uno, al cuadro de PRODUCTOS UNICOS (que es el que entra al descuento
 * del personal) o al de FALTANTE/SOBRANTE POR PAQUETE (que queda afuera).
 *
 * Esa clasificacion manual es la especificacion del requisito, escrita por
 * quien lo pidio. Si la regla
 *
 *     |cantidad| / empaqueCompra > 0.5  ->  cuadro de PAQUETE
 *
 * la reproduce, el requisito queda validado contra el propio trabajo del
 * cliente y no hace falta preguntarle nada mas. Si no la reproduce, cada
 * fallo es una pregunta concreta -- con codigo, cantidad y empaque -- en vez
 * de una duda general.
 *
 * SOLO LECTURA contra D365. No escribe nada.
 *
 *   npx tsx scripts/validar-regla-paquete-julio.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rutaEnv = resolve(import.meta.dirname, '..', '.env');
if (existsSync(rutaEnv)) process.loadEnvFile(rutaEnv);

import { d365AuthService } from '../src/modules/d365/d365-auth.service';
import { d365EntityService } from '../src/modules/d365/d365-entity.service';
import {
  agruparConversionesPorProducto,
  empaqueDeCompra,
} from '../src/modules/d365/d365-catalogo.service';
import type { D365ReleasedProduct, D365UnitConversion } from '../src/modules/d365/d365.types';

const RUTA_CLASIFICADOS =
  process.env['CLASIFICADOS'] ??
  '/tmp/claude-1000/-home-user-Projects-app-inventario/e54c58ee-7fb4-48da-96c8-06bda2652317/scratchpad/julio-bolivar-clasificado.json';

/** Un renglon del Excel, tal como lo clasifico Gilmer. */
interface Renglon {
  cod: string;
  cant: number;
  desc: string;
  /** El cuadro al que lo mando: UNICO entra al descuento, PAQUETE no. */
  cuadro: 'UNICO' | 'PAQUETE';
}

/** El umbral que la regla usa hoy (config UMBRAL_MEDIA_UNIDAD_PAQUETE). */
const UMBRAL = 0.5;

/**
 * REGLA A -- la literal, tal como se enuncia: `|cantidad| / empaque > 0.5`.
 *
 * Tiene un agujero conocido y este script sirve justamente para medirlo: con
 * empaque = 1 (producto que se compra suelto), CUALQUIER faltante de una
 * unidad da ratio 1 y se va al cuadro de paquetes. No hay paquete que medir.
 */
function predecirLiteral(cantidad: number, empaque: number | null): 'UNICO' | 'PAQUETE' | null {
  if (empaque === null || empaque <= 0) return null;
  return Math.abs(cantidad) / empaque > UMBRAL ? 'PAQUETE' : 'UNICO';
}

/**
 * REGLA B -- la misma, pero con la COMPUERTA DE LA CLASE: el umbral solo
 * aplica a los items que vienen en paquete (`empaqueCompra > 1`). Los que se
 * compran por unidad son `clase = unidad` y su faltante va siempre al
 * descuento del personal, que es el tratamiento de siempre.
 *
 * Es exactamente lo que ya hace `clasificarItem` en el snapshot. Se evalua
 * aparte para poder DEMOSTRAR con los datos del cliente que esa compuerta
 * hacia falta, en vez de afirmarlo.
 */
function predecirConClase(cantidad: number, empaque: number | null): 'UNICO' | 'PAQUETE' | null {
  if (empaque === null || empaque <= 0) return null;
  if (empaque === 1) return 'UNICO';
  return Math.abs(cantidad) / empaque > UMBRAL ? 'PAQUETE' : 'UNICO';
}

async function main(): Promise<void> {
  const renglones = JSON.parse(readFileSync(RUTA_CLASIFICADOS, 'utf8')) as Renglon[];
  const codigos = new Set(renglones.map((r) => r.cod));

  const dataAreaId = await d365AuthService.getDataAreaId();
  const filtroCompania = dataAreaId ? `dataAreaId eq '${dataAreaId}'` : undefined;

  console.log(`Renglones clasificados por Gilmer: ${renglones.length} (${codigos.size} codigos)\n`);
  console.log('Bajando productos y conversiones de Dynamics...');

  const [productos, conversiones] = await Promise.all([
    d365EntityService.obtenerTodos<D365ReleasedProduct>('ReleasedProductsV2', {
      $select: 'ItemNumber,SearchName,InventoryUnitSymbol,PurchaseUnitSymbol',
      ...(filtroCompania ? { $filter: filtroCompania } : {}),
    }),
    d365EntityService.obtenerTodos<D365UnitConversion>('ProductSpecificUnitOfMeasureConversions', {
      $select: 'ProductNumber,FromUnitSymbol,ToUnitSymbol,Factor',
    }),
  ]);
  console.log(`  ${productos.length} productos, ${conversiones.length} conversiones\n`);

  const productoPorItem = new Map(productos.map((p) => [p.ItemNumber, p]));
  const conversionesPorItem = agruparConversionesPorProducto(conversiones);

  interface Evaluado extends Renglon {
    empaque: number | null;
    simbolo: string | null;
    ratio: number | null;
    prediccion: 'UNICO' | 'PAQUETE' | null;
    literal: 'UNICO' | 'PAQUETE' | null;
    acierta: boolean;
  }

  const evaluados: Evaluado[] = renglones.map((r) => {
    const producto = productoPorItem.get(r.cod);
    const compra = producto ? empaqueDeCompra(conversionesPorItem.get(r.cod) ?? [], producto) : null;
    const empaque = compra?.unidades ?? null;
    const prediccion = predecirConClase(r.cant, empaque);
    const literal = predecirLiteral(r.cant, empaque);
    return {
      ...r,
      empaque,
      simbolo: compra?.simbolo ?? null,
      ratio: empaque === null || empaque <= 0 ? null : Math.abs(r.cant) / empaque,
      prediccion,
      literal,
      acierta: prediccion !== null && prediccion === r.cuadro,
    };
  });

  const sinDato = evaluados.filter((e) => e.prediccion === null);
  const conDato = evaluados.filter((e) => e.prediccion !== null);
  const aciertos = conDato.filter((e) => e.acierta);
  const fallos = conDato.filter((e) => !e.acierta);

  const pct = (p: number, t: number): string => (t === 0 ? '-' : `${((p / t) * 100).toFixed(1)}%`);

  const aciertosLiteral = conDato.filter((e) => e.literal === e.cuadro).length;

  console.log('== RESULTADO ==');
  console.log(`  renglones evaluables:     ${conDato.length} de ${evaluados.length}`);
  console.log(`\n  REGLA A (literal: ratio > ${UMBRAL})`);
  console.log(`    aciertos: ${aciertosLiteral}  (${pct(aciertosLiteral, conDato.length)})`);
  console.log(`\n  REGLA B (con la compuerta de la clase: solo si empaque > 1)`);
  console.log(`    ACIERTOS: ${aciertos.length}  (${pct(aciertos.length, conDato.length)})`);
  console.log(`    FALLOS:   ${fallos.length}  (${pct(fallos.length, conDato.length)})`);
  console.log(`\n  lo que aporta la compuerta: ${aciertos.length - aciertosLiteral} renglones`);

  // Los fallos, partidos por SIGNO: un faltante y un sobrante del mismo
  // tamano pueden no tratarse igual, y el Excel tiene DOS cuadros de paquete
  // (uno para cada signo). Si los fallos se amontonan de un lado, la regla no
  // es simetrica y eso es la pregunta.
  const faltantes = conDato.filter((e) => e.cant < 0);
  const sobrantes = conDato.filter((e) => e.cant > 0);
  const aciertaEn = (lista: typeof conDato): string =>
    `${lista.filter((e) => e.acierta).length}/${lista.length} (${pct(lista.filter((e) => e.acierta).length, lista.length)})`;
  console.log(`\n  por signo, con la regla B:`);
  console.log(`    faltantes (cant < 0): ${aciertaEn(faltantes)}`);
  console.log(`    sobrantes (cant > 0): ${aciertaEn(sobrantes)}`);
  if (sinDato.length > 0) {
    console.log(`  sin empaque de compra:    ${sinDato.length}  -> ${sinDato.map((e) => e.cod).join(', ')}`);
  }

  // Matriz de confusion: no es lo mismo mandar al descuento algo que Gilmer
  // saco (le cobra de mas al personal) que sacar algo que el dejo adentro.
  const m = (real: string, pred: string): number =>
    conDato.filter((e) => e.cuadro === real && e.prediccion === pred).length;
  console.log('\n  matriz (fila = Gilmer, columna = la regla):');
  console.log(`                  pred UNICO   pred PAQUETE`);
  console.log(`    Gilmer UNICO      ${String(m('UNICO', 'UNICO')).padStart(4)}          ${String(m('UNICO', 'PAQUETE')).padStart(4)}`);
  console.log(`    Gilmer PAQUETE    ${String(m('PAQUETE', 'UNICO')).padStart(4)}          ${String(m('PAQUETE', 'PAQUETE')).padStart(4)}`);

  if (fallos.length > 0) {
    console.log('\n== LOS FALLOS, UNO POR UNO ==');
    for (const f of [...fallos].sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))) {
      console.log(
        `  ${f.cod}  cant ${String(f.cant).padStart(4)}  empaque ${String(f.empaque).padStart(4)} (${f.simbolo})` +
          `  ratio ${f.ratio?.toFixed(3)}  -> regla dice ${f.prediccion}, Gilmer ${f.cuadro}`,
      );
      console.log(`      ${f.desc}`);
    }
  }

  // -------------------------------------------------------------------------
  // LOS PARES QUE EL USUARIO MARCO: misma cantidad, cuadros distintos.
  // Son los que prueban o rompen la regla, porque con la cantidad sola no se
  // pueden distinguir -- si la regla los separa bien, es porque de verdad
  // esta mirando el empaque.
  // -------------------------------------------------------------------------
  const PARES: Array<[string, string]> = [
    ['103474', '105618'],
    ['110764', '104714'],
    ['111140', '102452'],
  ];
  console.log('\n== LOS PARES DECISIVOS (misma cantidad, cuadros distintos) ==');
  for (const [a, b] of PARES) {
    for (const cod of [a, b]) {
      const e = evaluados.find((x) => x.cod === cod);
      if (e === undefined) continue;
      console.log(
        `  ${e.acierta ? '[OK]   ' : '[FALLA]'} ${e.cod} cant ${String(e.cant).padStart(4)}` +
          ` / empaque ${String(e.empaque).padStart(4)} = ratio ${e.ratio === null ? '-' : e.ratio.toFixed(3)}` +
          `  -> regla ${e.prediccion}, Gilmer ${e.cuadro}   ${e.desc}`,
      );
    }
    console.log('');
  }

  // -------------------------------------------------------------------------
  // EL EJEMPLO DE GILMER: los chocolates que quedaron en UNICO con cantidades
  // grandes. Si tienen empaque de compra grande, la regla los explica sola.
  // -------------------------------------------------------------------------
  console.log('== LOS CHOCOLATES DE CANTIDAD GRANDE QUE QUEDARON EN UNICO ==');
  for (const cod of ['103470', '103471', '103474']) {
    const e = evaluados.find((x) => x.cod === cod);
    if (e === undefined) continue;
    console.log(
      `  ${e.acierta ? '[OK]   ' : '[FALLA]'} ${e.cod} cant ${String(e.cant).padStart(4)}` +
        ` / empaque ${String(e.empaque).padStart(4)} (${e.simbolo}) = ratio ${e.ratio === null ? '-' : e.ratio.toFixed(3)}` +
        `  -> regla ${e.prediccion}, Gilmer ${e.cuadro}`,
    );
    console.log(`      ${e.desc}`);
  }

  // -------------------------------------------------------------------------
  // ¿HAY UN UMBRAL QUE SEPARE MEJOR? Si con otro valor los aciertos suben
  // mucho, el numero de la config esta mal elegido y eso es un hallazgo.
  // -------------------------------------------------------------------------
  console.log('\n== SENSIBILIDAD AL UMBRAL (con la compuerta de la clase) ==');
  for (const u of [0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9, 1]) {
    const ok = conDato.filter(
      (e) => (e.empaque === 1 ? 'UNICO' : Math.abs(e.cant) / e.empaque! > u ? 'PAQUETE' : 'UNICO') === e.cuadro,
    ).length;
    const marca = Math.abs(u - UMBRAL) < 1e-9 ? '  <- el configurado' : '';
    console.log(`  umbral ${u.toFixed(2)}: ${String(ok).padStart(3)} aciertos (${pct(ok, conDato.length)})${marca}`);
  }
}

main().catch((e: unknown) => {
  console.error('[ERROR]', e instanceof Error ? e.message : e);
  process.exit(1);
});
