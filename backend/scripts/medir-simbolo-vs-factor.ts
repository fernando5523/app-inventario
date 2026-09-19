/**
 * ¿EL SIMBOLO DEL EMPAQUE Y SU FACTOR PUEDEN DISCREPAR?
 *
 * La pregunta sale de la pantalla: el movil muestra el simbolo tal cual lo
 * pidio el usuario ("Emp.12"), y el calculo del faltante por paquete divide
 * por `empaqueCompra`. Si Dynamics dice "Emp.12" pero el factor a la unidad
 * suelta es 30, la pantalla afirma 12 mientras la plata se reparte por 30 --
 * y quien lea la planilla saca 30/12 sin entender. Es un numero que descuenta
 * sueldo: la discrepancia se descubriria discutiendo una liquidacion.
 *
 * Los 80 items del catalogo de EJEMPLO no divergen ni una vez. Esto lo mide
 * contra el catalogo COMPLETO del tenant real.
 *
 * ---------------------------------------------------------------------------
 * DONDE PUEDE NACER LA DIVERGENCIA
 * ---------------------------------------------------------------------------
 * `d365-catalogo.service.ts#empaqueDeCompra` resuelve en tres ramas:
 *
 *   unidad_base  el simbolo es U/U.  -> 1
 *   conversion   hay ProductSpecificUnitOfMeasureConversions del simbolo a la
 *                unidad base -> ESE Factor manda (dato duro del ERP)
 *   nombre       no hay conversion   -> el numero del nombre ("Emp.12" -> 12)
 *
 * Solo la rama `conversion` puede divergir: la rama `nombre` saca el numero
 * del mismo texto que se muestra, asi que coincide por construccion. Por eso
 * el informe separa por ORIGEN -- si todas las divergencias caen en
 * `conversion`, ya se sabe donde mirar.
 *
 * SOLO LECTURA. No escribe en Dynamics ni en Postgres.
 *
 *   npx tsx scripts/medir-simbolo-vs-factor.ts [--md]
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ruta = resolve(import.meta.dirname, '..', '.env');
if (existsSync(ruta)) process.loadEnvFile(ruta);

import { d365AuthService } from '../src/modules/d365/d365-auth.service';
import { d365EntityService } from '../src/modules/d365/d365-entity.service';
import { empaqueDeCompra } from '../src/modules/d365/d365-catalogo.service';
import type { D365ReleasedProduct, D365UnitConversion } from '../src/modules/d365/d365.types';

/** Campos de agrupacion, para responder si una divergencia es sistematica. */
interface Producto extends D365ReleasedProduct {
  ProductGroupId?: string | null;
  PrimaryVendorAccountNumber?: string | null;
}

const MD = process.argv.includes('--md');

/** El numero que un humano LEE en el simbolo. `null` = el simbolo no trae ninguno. */
function numeroDelSimbolo(simbolo: string): number | null {
  const numeros = simbolo.match(/\d+/g);
  if (!numeros || numeros.length === 0) return null;
  const n = Number.parseInt(numeros[0]!, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const esUnidadBase = (s: string): boolean => /^u\.?$/i.test(s.trim());
/** La forma documentada: prefijo "Emp" + separador opcional + numero. */
const esEmpN = (s: string): boolean => /^emp[\s._-]*\d+$/i.test(s.trim());

type Forma = 'unidad_base' | 'Emp.N' | 'otra_con_numero' | 'sin_numero';
type Origen = 'unidad_base' | 'conversion' | 'nombre' | 'sin_resolver';

class Cuenta<K> {
  readonly n = new Map<K, number>();
  readonly ej = new Map<K, string[]>();
  constructor(private readonly max = 6) {}
  sumar(k: K, ejemplo?: string): void {
    this.n.set(k, (this.n.get(k) ?? 0) + 1);
    if (ejemplo === undefined) return;
    const l = this.ej.get(k) ?? [];
    if (l.length < this.max) this.ej.set(k, [...l, ejemplo]);
  }
  /** De mayor a menor. */
  orden(): Array<[K, number]> {
    return [...this.n.entries()].sort((a, b) => b[1] - a[1]);
  }
}

const pct = (p: number, t: number): string => (t === 0 ? '0.0%' : `${((p / t) * 100).toFixed(2)}%`);

async function main(): Promise<void> {
  const area = await d365AuthService.getDataAreaId();
  const filtro = area ? `dataAreaId eq '${area}'` : undefined;
  console.log(`# Simbolo vs factor -- tenant ${area ?? '(sin filtro)'}\n`);

  console.log('Bajando el catalogo completo (esto tarda)...');
  const [productos, conversiones] = await Promise.all([
    d365EntityService.obtenerTodos<Producto>('ReleasedProductsV2', {
      $select: 'ItemNumber,SearchName,PurchaseUnitSymbol,InventoryUnitSymbol,ProductGroupId,PrimaryVendorAccountNumber',
      ...(filtro ? { $filter: filtro } : {}),
    }),
    d365EntityService.obtenerTodos<D365UnitConversion>('ProductSpecificUnitOfMeasureConversions', {
      $select: 'ProductNumber,FromUnitSymbol,ToUnitSymbol,Factor',
    }),
  ]);

  /**
   * CONTROL DE PAGINACION, y no es ceremonia: a la primera medicion de este
   * tema OData le corto en 10.000 filas y la conclusion salio al reves. Si lo
   * traido no coincide con el `$count` del servidor, el informe lo dice con
   * numero en vez de convertirlo en un hallazgo falso.
   */
  const controles = [
    { entidad: 'ReleasedProductsV2', traidas: productos.length, declaradas: await d365EntityService.contar('ReleasedProductsV2', filtro) },
    { entidad: 'ProductSpecificUnitOfMeasureConversions', traidas: conversiones.length, declaradas: await d365EntityService.contar('ProductSpecificUnitOfMeasureConversions') },
  ];
  console.log('\n## Control de paginacion\n');
  let corto = false;
  for (const c of controles) {
    const ok = c.traidas === c.declaradas;
    if (!ok) corto = true;
    console.log(`- ${c.entidad}: ${c.traidas} traidas / ${c.declaradas} declaradas ${ok ? 'OK' : '<-- CORTO'}`);
  }
  if (corto) console.log('\n**OJO: la bajada quedo corta. Los numeros de abajo son un piso, no el total.**');

  const porItem = new Map<string, D365UnitConversion[]>();
  for (const c of conversiones) {
    const lista = porItem.get(c.ProductNumber) ?? [];
    lista.push(c);
    porItem.set(c.ProductNumber, lista);
  }

  const formas = new Cuenta<Forma>();
  const origenes = new Cuenta<Origen>();
  const simbolosSinNumero = new Cuenta<string>();
  const factorDeSimboloSinNumero = new Cuenta<string>();
  const divergencias: Array<{
    item: string; simbolo: string; leido: number; real: number; origen: Origen;
    grupo: string; proveedor: string;
  }> = [];
  const simbolosConNumero = new Cuenta<string>();

  let conSimbolo = 0;
  let sinSimbolo = 0;
  let sinResolver = 0;

  for (const p of productos) {
    const simbolo = (p.PurchaseUnitSymbol ?? '').trim();
    if (simbolo === '') { sinSimbolo += 1; continue; }
    conSimbolo += 1;

    const conv = porItem.get(p.ItemNumber) ?? [];
    // LA FUNCION REAL, no una reimplementacion: lo que se mide tiene que ser
    // lo que el sistema hace, no una copia que puede haber quedado atras.
    const resuelto = empaqueDeCompra(conv, p);

    const leido = numeroDelSimbolo(simbolo);
    const forma: Forma = esUnidadBase(simbolo)
      ? 'unidad_base'
      : esEmpN(simbolo)
        ? 'Emp.N'
        : leido !== null
          ? 'otra_con_numero'
          : 'sin_numero';
    formas.sumar(forma, `${p.ItemNumber} "${simbolo}"`);

    let origen: Origen;
    if (resuelto === null) { origen = 'sin_resolver'; sinResolver += 1; }
    else if (esUnidadBase(simbolo)) origen = 'unidad_base';
    else {
      const aLaBase = conv.find((c) => c.FromUnitSymbol === simbolo && esUnidadBase(c.ToUnitSymbol));
      origen = aLaBase && Number.isFinite(aLaBase.Factor) && aLaBase.Factor > 0 ? 'conversion' : 'nombre';
    }
    origenes.sumar(origen, `${p.ItemNumber} "${simbolo}"`);

    if (leido === null) {
      if (!esUnidadBase(simbolo)) {
        simbolosSinNumero.sumar(simbolo, p.ItemNumber);
        factorDeSimboloSinNumero.sumar(`"${simbolo}" -> ${resuelto === null ? 'sin resolver' : resuelto.unidades}`, p.ItemNumber);
      }
      continue;
    }
    simbolosConNumero.sumar(simbolo, p.ItemNumber);

    if (resuelto !== null && resuelto.unidades !== leido) {
      divergencias.push({
        item: p.ItemNumber,
        simbolo,
        leido,
        real: resuelto.unidades,
        origen,
        grupo: p.ProductGroupId ?? '(sin grupo)',
        proveedor: p.PrimaryVendorAccountNumber ?? '(sin proveedor)',
      });
    }
  }

  const conNumero = [...simbolosConNumero.n.values()].reduce((a, b) => a + b, 0);

  console.log('\n## 1. El universo\n');
  console.log(`- Items del catalogo: **${productos.length}**`);
  console.log(`- Con \`PurchaseUnitSymbol\`: **${conSimbolo}** (${pct(conSimbolo, productos.length)}); sin simbolo: ${sinSimbolo}`);
  console.log(`- Con un NUMERO leible en el simbolo: **${conNumero}** (${pct(conNumero, conSimbolo)} de los que tienen simbolo)`);
  console.log(`- Sin empaque de compra resoluble: ${sinResolver}`);

  console.log('\n### Formas de simbolo\n');
  console.log('| forma | items | ejemplos |');
  console.log('|---|---:|---|');
  for (const [f, n] of formas.orden()) {
    console.log(`| \`${f}\` | ${n} | ${(formas.ej.get(f) ?? []).slice(0, 3).join(', ')} |`);
  }

  console.log('\n### De donde sale el factor\n');
  console.log('| origen | items | ejemplos |');
  console.log('|---|---:|---|');
  for (const [o, n] of origenes.orden()) {
    console.log(`| \`${o}\` | ${n} | ${(origenes.ej.get(o) ?? []).slice(0, 3).join(', ')} |`);
  }

  console.log('\n## 2. DIVERGENCIAS simbolo vs factor\n');
  console.log(`**${divergencias.length}** de ${conNumero} items con numero en el simbolo (${pct(divergencias.length, conNumero)}).`);
  if (divergencias.length === 0) {
    console.log('\nNinguna. Mostrar el simbolo tal cual NO le miente a nadie en este tenant.');
  } else {
    console.log('\n| ItemNumber | simbolo | lee | usa | origen | grupo | proveedor |');
    console.log('|---|---|---:|---:|---|---|---|');
    for (const d of divergencias.slice(0, 40)) {
      console.log(`| ${d.item} | \`${d.simbolo}\` | ${d.leido} | ${d.real} | ${d.origen} | ${d.grupo} | ${d.proveedor} |`);
    }
    if (divergencias.length > 40) console.log(`\n(y ${divergencias.length - 40} mas)`);

    // ¿Sistematicas o sueltas? Se agrupa por las tres dimensiones que
    // podrian explicarlas.
    for (const [titulo, clave] of [
      ['Por par simbolo->factor', (d: (typeof divergencias)[number]) => `"${d.simbolo}" -> ${d.real}`],
      ['Por grupo de producto', (d: (typeof divergencias)[number]) => d.grupo],
      ['Por proveedor', (d: (typeof divergencias)[number]) => d.proveedor],
    ] as const) {
      const c = new Cuenta<string>();
      for (const d of divergencias) c.sumar(clave(d), d.item);
      console.log(`\n### ${titulo}\n`);
      console.log('| clave | items | ejemplos |');
      console.log('|---|---:|---|');
      for (const [k, n] of c.orden().slice(0, 15)) {
        console.log(`| ${k} | ${n} | ${(c.ej.get(k) ?? []).slice(0, 4).join(', ')} |`);
      }
    }
  }

  console.log('\n## 3. Simbolos SIN numero (los que la pantalla no puede leer)\n');
  const totalSinNumero = [...simbolosSinNumero.n.values()].reduce((a, b) => a + b, 0);
  console.log(`**${totalSinNumero}** items (${pct(totalSinNumero, conSimbolo)} de los que tienen simbolo), en ${simbolosSinNumero.n.size} simbolo(s) distinto(s).`);
  if (totalSinNumero > 0) {
    console.log('\n| simbolo -> factor con el que resuelve | items | ejemplos |');
    console.log('|---|---:|---|');
    for (const [k, n] of factorDeSimboloSinNumero.orden().slice(0, 25)) {
      console.log(`| ${k} | ${n} | ${(factorDeSimboloSinNumero.ej.get(k) ?? []).slice(0, 4).join(', ')} |`);
    }
  }

  console.log('\n## Simbolos CON numero mas frecuentes\n');
  console.log('| simbolo | items |');
  console.log('|---|---:|');
  for (const [s, n] of simbolosConNumero.orden().slice(0, 15)) console.log(`| \`${s}\` | ${n} |`);

  if (MD) console.log('\n<!-- generado por scripts/medir-simbolo-vs-factor.ts -->');
}

main().catch((e: unknown) => {
  console.error('\nFALLO:', e instanceof Error ? e.message : e);
  process.exit(1);
});
