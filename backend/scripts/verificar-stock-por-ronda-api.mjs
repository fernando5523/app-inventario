/**
 * EL STOCK POR RONDA, CONTRA EL BACKEND VIVO (BASE_URL, por defecto
 * http://localhost:3000). Lo que un test unitario no puede verificar: que la
 * tabla nueva (`stock_rondas`), la migracion de datos de la ronda 1, la matriz
 * del Auditor y la tabla de la cadena digan lo mismo atravesando middleware,
 * rutas y Prisma.
 *
 * QUE COMPRUEBA, EN ESTE ORDEN:
 *
 *  1. LA MIGRACION DE DATOS. Hay una fila de la ronda 1 por cada item del
 *     catalogo, y su cifra es EXACTAMENTE `catalogo_items.stock_erp`. Sin esto
 *     la ronda 1 se leeria como `sin_erp` en todo el sistema.
 *
 *  2. QUE LA CADENA SIGA CERRANDO CONSIGO MISMA. Cada fila con diferencia tiene
 *     que cumplir `conteoFinal - stockDeLaMedicion.stockErp === diferenciaUnidades`,
 *     y la matriz tiene que decir de que ronda salio cada stock.
 *
 *  3. QUE UN INVENTARIO **SOLO CON RONDA 1** DE LO DE SIEMPRE. Ese es el caso de
 *     todos los inventarios que ya estaban en la base: el stock por ronda no les
 *     cambia un centavo. Se chequea contra los valores medidos el 2026-09-29
 *     (Luzuriaga: 161.7 / 130.4 / 4.1) y SOLO si esa tienda todavia no tiene
 *     stock de una ronda posterior -- cuando lo tiene, que los numeros cambien
 *     es el cambio pedido, no una regresion.
 *
 *  4. QUE EL STOCK NUEVO DE UNA RONDA MUEVA LA MEDICION. Se escribe stock de la
 *     ronda del reconteo para UN item con diferencia, igual a lo que se conto, y
 *     ese item tiene que salir cuadrado -- sin que nadie toque el estante. Es el
 *     caso que describio el cliente: "se vendio una unidad entre las dos rondas".
 *
 *  5. QUE SE PUEDA VOLVER ATRAS. La fila que habia antes se restaura TAL CUAL
 *     (cifra y `tomadoEn`), o se borra si no existia, y la cadena vuelve al
 *     numero con el que arranco el script.
 *
 * ESCRIBE EN LA BASE (paso 4) Y LO DESHACE (paso 5), asi que es de DESARROLLO.
 * Nunca toca la ronda 1 -- la que la migracion de datos relleno -- y restaura el
 * valor previo en vez de borrar: la descarga del stock de una ronda puede ser de
 * otro (el modulo de d365 la escribe de verdad), y perderla obligaria a volver a
 * bajarla del ERP.
 */
import { PrismaClient } from '@prisma/client';
import { pinDev } from './_pin-dev.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const ANIO = Number(process.env.ANIO ?? 2026);
const MES = Number(process.env.MES ?? 9);
const TIENDA = process.env.TIENDA ?? 'Market Luzuriaga';
const prisma = new PrismaClient();
let fallas = 0;
const ok = (t) => console.log('  [OK]    ' + t);
const mal = (t) => { console.log('  [FALLA] ' + t); fallas += 1; };

const AUDITOR = 103; // Gilmer Quispe

/**
 * Lo medido el 2026-09-29 sobre el inventario 8078 (Luzuriaga, 985 items en
 * `ajuste_auditor` con 6 diferencias) ANTES de que existiera el stock por ronda.
 * Es el ancla de la regresion: con solo la ronda 1 cargada, el cambio no mueve
 * un centavo.
 */
const CADENA_SOLO_RONDA_1 = { valorFaltante: 161.7, valorSobrante: 130.4, valorADescontar: 4.1 };

async function api(metodo, ruta, { token } = {}) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  let datos = null;
  try { datos = await r.json(); } catch { /* sin body */ }
  return { status: r.status, datos };
}

// El PIN de un colaborador sembrado sale de su ROL, no del id (ver _pin-dev.mjs).
// UN SOLO intento: el backend limita a 8 cada 15 minutos por colaboradorId
// (sesion.routes.ts#limitadorIngreso), asi que un POST de prueba de mas gasta
// cupo real.
const ingresar = async (id, rol) => {
  const r = await fetch(BASE + '/api/sesion/ingresar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ colaboradorId: id, pin: pinDev(rol) }),
  });
  const datos = await r.json();
  if (r.status !== 200) throw new Error(`no se pudo ingresar como ${id} (${rol}): ${r.status} ${JSON.stringify(datos)}`);
  return datos;
};

/** La fila de una tienda en la tabla de la cadena. */
async function tiendaEnLaCadena(token) {
  const r = await api('GET', `/api/auditoria/cadena?anio=${ANIO}&mes=${MES}`, { token });
  if (r.status !== 200) throw new Error(`cadena devolvio ${r.status}: ${JSON.stringify(r.datos)}`);
  const fila = r.datos.tiendas.find((t) => t.sucursal === TIENDA);
  if (fila === undefined) throw new Error(`la cadena no trae ${TIENDA}`);
  return fila;
}

const clave = (inventarioId, numeroConteo, codigo) => ({
  inventarioId_numeroConteo_codigo: { inventarioId, numeroConteo, codigo },
});

async function main() {
  console.log(`\n== EL STOCK POR RONDA contra ${BASE} (periodo ${ANIO}-${MES}, ${TIENDA}) ==\n`);
  const { token } = await ingresar(AUDITOR, 'auditor');

  // -------------------------------------------------------------------------
  console.log('1. LA MIGRACION DE DATOS: la ronda 1 quedo escrita en stock_rondas');
  // -------------------------------------------------------------------------
  const filasCatalogo = await prisma.catalogoItem.count();
  const filasRonda1 = await prisma.stockRonda.count({ where: { numeroConteo: 1 } });
  if (filasRonda1 === filasCatalogo) ok(`ronda 1 completa: ${filasRonda1} filas, una por item del catalogo`);
  else mal(`ronda 1 incompleta: ${filasRonda1} filas contra ${filasCatalogo} items del catalogo`);

  // La cifra tiene que ser LA MISMA que en catalogo_items: son el mismo hecho, y
  // de las dos manda la del catalogo (la lee el sello del lacrado).
  const desalineadas = await prisma.$queryRawUnsafe(
    `select count(*)::int as n
       from stock_rondas sr
       join catalogo_items ci
         on ci.inventario_id = sr.inventario_id and ci.codigo = sr.codigo
      where sr.numero_conteo = 1 and ci.stock_erp is distinct from sr.stock_erp`,
  );
  if (desalineadas[0].n === 0) ok('ninguna fila de la ronda 1 difiere de catalogo_items.stock_erp');
  else mal(`${desalineadas[0].n} filas de la ronda 1 NO coinciden con catalogo_items.stock_erp`);

  const arranque = await tiendaEnLaCadena(token);
  const inventarioId = arranque.inventarioId;
  console.log(`    inventario ${inventarioId}: ${arranque.items} items, ${arranque.auditables} auditables, ${arranque.cuadrados} cuadrados`);

  // -------------------------------------------------------------------------
  console.log('\n2. LA MATRIZ DICE CONTRA QUE STOCK SE MIDIO CADA FILA');
  // -------------------------------------------------------------------------
  const conFalta = await api('GET', `/api/auditoria/inventarios/${inventarioId}/matriz?filtro=faltante&limite=50`, { token });
  if (conFalta.status !== 200) throw new Error(`matriz devolvio ${conFalta.status}: ${JSON.stringify(conFalta.datos)}`);
  const filas = conFalta.datos.matriz;
  console.log(`    ${conFalta.datos.total} items con diferencia`);

  const sinMedicion = filas.filter((f) => f.stockDeLaMedicion === undefined);
  if (sinMedicion.length === 0) ok('todas las filas traen `stockDeLaMedicion`');
  else mal(`${sinMedicion.length} filas sin \`stockDeLaMedicion\``);

  const cerraron = filas.filter((f) => f.conteoFinal - f.stockDeLaMedicion.stockErp === f.diferenciaUnidades);
  if (cerraron.length === filas.length) ok('en todas: conteoFinal - stockDeLaMedicion.stockErp === diferenciaUnidades');
  else mal(`${filas.length - cerraron.length} filas donde la cuenta no cierra`);

  const cayeron = filas.filter((f) => f.stockDeLaMedicion.cayoALaRonda1);
  console.log(`    ${cayeron.length} de ${filas.length} filas se midieron con el stock de la ronda 1 (su ronda no bajo el suyo)`);
  for (const f of filas.slice(0, 5)) {
    const m = f.stockDeLaMedicion;
    console.log(`    ${f.codigo}: conteo ${f.conteoFinal} (ronda ${m.rondaDelConteo}) contra stock ${m.stockErp} (ronda ${m.rondaDelStock}) -> ${f.diferenciaUnidades}`);
  }

  // -------------------------------------------------------------------------
  console.log('\n3. CON SOLO LA RONDA 1, LA CADENA NO SE MUEVE UN CENTAVO');
  // -------------------------------------------------------------------------
  const rondasConStock = await prisma.stockRonda.findMany({
    where: { inventarioId, numeroConteo: { gt: 1 } },
    distinct: ['numeroConteo'],
    select: { numeroConteo: true },
  });
  if (rondasConStock.length === 0) {
    for (const [campo, valor] of Object.entries(CADENA_SOLO_RONDA_1)) {
      if (arranque[campo] === valor) ok(`${TIENDA} ${campo} = ${valor}, igual que antes del cambio`);
      else mal(`${TIENDA} ${campo} = ${arranque[campo]}, se esperaba ${valor}`);
    }
  } else {
    const cuales = rondasConStock.map((r) => r.numeroConteo).sort().join(', ');
    console.log(`    SALTEADO: este inventario ya tiene stock propio de la(s) ronda(s) ${cuales}.`);
    console.log(`    Sus numeros (faltante ${arranque.valorFaltante}, sobrante ${arranque.valorSobrante}, a descontar ${arranque.valorADescontar})`);
    console.log(`    YA NO son los de la vara unica (${CADENA_SOLO_RONDA_1.valorFaltante} / ${CADENA_SOLO_RONDA_1.valorSobrante} / ${CADENA_SOLO_RONDA_1.valorADescontar}),`);
    console.log('    y eso ES el cambio pedido: cada reconteo se mide contra el stock de su dia.');
    console.log('    Para volver a ver el ancla, corre este script sobre un inventario sin stock de reconteo.');
  }

  // -------------------------------------------------------------------------
  console.log('\n4. EL INVENTARIO ACTIVO DICE SI LA RONDA YA BAJO SU STOCK');
  // -------------------------------------------------------------------------
  const activo = await api('GET', `/api/sucursales/${arranque.sucursalId}/inventarios/activo`, { token });
  if (activo.status !== 200) {
    mal(`activo devolvio ${activo.status}: ${JSON.stringify(activo.datos)}`);
  } else {
    const d = activo.datos;
    console.log(`    ronda activa ${d.rondaActiva}: stockDeRondaItems=${d.stockDeRondaItems}, stockDeRondaTomadoEn=${d.stockDeRondaTomadoEn}`);
    const enLaBase = d.rondaActiva === null
      ? 0
      : await prisma.stockRonda.count({ where: { inventarioId: d.inventarioId, numeroConteo: d.rondaActiva } });
    const esperado = enLaBase === 0 ? null : enLaBase;
    if (d.stockDeRondaItems === esperado) {
      ok(`coincide con la base: ${esperado === null ? 'esta ronda todavia no bajo stock (null, no 0)' : `${esperado} items`}`);
    } else {
      mal(`stockDeRondaItems=${d.stockDeRondaItems} y en la base hay ${enLaBase} filas`);
    }
    if ((d.stockDeRondaTomadoEn === null) === (esperado === null)) ok('`tomadoEn` y `items` viajan juntos: los dos con dato o los dos en null');
    else mal(`incoherentes: items=${d.stockDeRondaItems}, tomadoEn=${d.stockDeRondaTomadoEn}`);
  }

  // -------------------------------------------------------------------------
  console.log('\n5. EL STOCK NUEVO DE LA RONDA MUEVE LA MEDICION');
  // -------------------------------------------------------------------------
  const elegida = filas.find((f) => f.diferenciaUnidades !== 0 && f.stockDeLaMedicion.rondaDelConteo > 1);
  if (elegida === undefined) {
    console.log('    SALTEADO: ninguna fila con diferencia resuelta en una ronda posterior a la 1.');
    console.log('    (Este paso necesita un reconteo: en la ronda 1 el stock siempre sale del catalogo.)');
  } else {
    const ronda = elegida.stockDeLaMedicion.rondaDelConteo;
    // SE GUARDA LO QUE HABIA para restaurarlo tal cual -- la descarga de esa
    // ronda puede ser real y perderla obligaria a volver a bajarla del ERP.
    const previa = await prisma.stockRonda.findUnique({ where: clave(inventarioId, ronda, elegida.codigo) });
    try {
      // El ERP "se movio": ahora dice exactamente lo que se conto.
      await prisma.stockRonda.upsert({
        where: clave(inventarioId, ronda, elegida.codigo),
        create: { inventarioId, numeroConteo: ronda, codigo: elegida.codigo, stockErp: elegida.conteoFinal },
        update: { stockErp: elegida.conteoFinal },
      });

      const releida = await api('GET', `/api/auditoria/inventarios/${inventarioId}/matriz?busqueda=${elegida.codigo}&limite=5`, { token });
      const fila = releida.datos.matriz.find((f) => f.codigo === elegida.codigo);
      if (fila === undefined) {
        mal(`${elegida.codigo} desaparecio de la matriz`);
      } else if (fila.diferenciaUnidades === 0 && fila.veredicto === 'cuadrado') {
        ok(`${elegida.codigo}: ${elegida.diferenciaUnidades} contra el stock viejo (${elegida.stockDeLaMedicion.stockErp}) y CUADRA contra el nuevo (${fila.stockDeLaMedicion.stockErp}), sin tocar el conteo`);
        if (fila.stockDeLaMedicion.rondaDelStock === ronda && fila.stockDeLaMedicion.cayoALaRonda1 === false) {
          ok(`el stock salio de la ronda ${ronda}, sin caida a la ronda 1`);
        } else {
          mal(`el stock salio de la ronda ${fila.stockDeLaMedicion.rondaDelStock} (cayoALaRonda1=${fila.stockDeLaMedicion.cayoALaRonda1})`);
        }
      } else {
        mal(`${elegida.codigo}: sigue con diferencia ${fila.diferenciaUnidades} contra stock ${fila.stockDeLaMedicion.stockErp}`);
      }

      const conStockNuevo = await tiendaEnLaCadena(token);
      const bajo = elegida.diferenciaUnidades < 0
        ? conStockNuevo.valorFaltante < arranque.valorFaltante
        : conStockNuevo.valorSobrante < arranque.valorSobrante;
      if (bajo) ok(`la tabla de la cadena lo refleja: faltante ${arranque.valorFaltante} -> ${conStockNuevo.valorFaltante}, sobrante ${arranque.valorSobrante} -> ${conStockNuevo.valorSobrante}`);
      else mal(`la cadena no cambio: faltante ${conStockNuevo.valorFaltante}, sobrante ${conStockNuevo.valorSobrante}`);
    } finally {
      // -------------------------------------------------------------------
      console.log('\n6. VOLVER ATRAS: la fila queda como estaba');
      // -------------------------------------------------------------------
      if (ronda === 1) throw new Error('este script nunca escribe ni borra la ronda 1');
      if (previa === null) {
        await prisma.stockRonda.delete({ where: clave(inventarioId, ronda, elegida.codigo) });
        ok(`${elegida.codigo} de la ronda ${ronda} no existia y se borro`);
      } else {
        // `tomadoEn` TAMBIEN se restaura: es el instante de la descarga y lo lee
        // `activo()` para decidir si el paso 1 esta hecho.
        await prisma.stockRonda.update({
          where: clave(inventarioId, ronda, elegida.codigo),
          data: { stockErp: previa.stockErp, tomadoEn: previa.tomadoEn },
        });
        ok(`${elegida.codigo} de la ronda ${ronda} volvio a ${previa.stockErp} (tomado ${previa.tomadoEn.toISOString()})`);
      }

      const cierre = await tiendaEnLaCadena(token);
      for (const campo of ['valorFaltante', 'valorSobrante', 'valorADescontar']) {
        if (cierre[campo] === arranque[campo]) ok(`${TIENDA} ${campo} volvio a ${arranque[campo]}`);
        else mal(`${TIENDA} ${campo} quedo en ${cierre[campo]}, arranco en ${arranque[campo]}`);
      }
    }
  }

  console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} FALLA(S)\n`);
  process.exitCode = fallas === 0 ? 0 : 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
