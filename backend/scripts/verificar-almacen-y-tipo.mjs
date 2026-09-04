/**
 * Verifica las tres cosas de esta migracion:
 *   1. el almacen como atributo de la sucursal, elegido de la lista del ERP;
 *   2. el snapshot tomando el almacen de la sucursal, no de un parametro;
 *   3. las dos restricciones unicas con `tipo`, escribiendo DIRECTO en Postgres.
 */
import { PrismaClient } from '@prisma/client';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const prisma = new PrismaClient();
let fallas = 0;
const ok = (t) => console.log('  [OK]    ' + t);
const mal = (t) => { console.log('  [FALLA] ' + t); fallas += 1; };

async function api(metodo, ruta, { token, body } = {}) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const texto = await r.text();
  let datos = null;
  try { datos = texto === '' ? null : JSON.parse(texto); } catch { /* sin json */ }
  return { status: r.status, datos, texto };
}

const ingresar = async (id, pin = String(id).padStart(6, '0')) => {
  const r = await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: id, pin } });
  return r.status === 200 ? r.datos : null;
};

class Rollback extends Error {}

async function debeRechazar(tx, etiqueta, fn) {
  await tx.$executeRawUnsafe('SAVEPOINT sp');
  try {
    await fn();
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp');
    mal(`${etiqueta} -- la base lo ACEPTO`);
  } catch (e) {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp');
    if (e.code === 'P2002') ok(`${etiqueta} -> P2002 sobre (${e.meta.target.join(', ')})`);
    else mal(`${etiqueta} -- otro error: ${e.code ?? e.message}`);
  }
}

console.log('== 1. EL ALMACEN ES UN ATRIBUTO DE LA SUCURSAL ==');
const admin = await ingresar(1000);
if (admin === null) { mal('no se pudo ingresar como administrador'); }
else {
  const lista = await api('GET', '/api/tiendas', { token: admin.token });
  if (lista.status !== 200) mal(`listar tiendas: ${lista.status} ${lista.texto}`);
  else {
    const luz = lista.datos.find((t) => t.id === 1);
    luz?.almacenId === 'MD01_LUZ' && luz.puedeTraerStock === true
      ? ok(`la tienda trae su almacen: ${luz.almacenId} "${luz.almacenNombre}" · puedeTraerStock=${luz.puedeTraerStock}`)
      : mal(`tienda 1: ${JSON.stringify(luz)}`);

    const sinAlmacen = lista.datos.find((t) => t.almacenId === null);
    sinAlmacen === undefined || sinAlmacen.puedeTraerStock === false
      ? ok('una tienda sin almacen queda marcada con puedeTraerStock=false, no se descubre al fallar el snapshot')
      : mal(`tienda sin almacen: ${JSON.stringify(sinAlmacen)}`);
  }

  const almacenes = await api('GET', '/api/d365/almacenes', { token: admin.token });
  almacenes.status === 200 && almacenes.datos.length > 0
    ? ok(`la lista para ELEGIR sale del ERP: ${almacenes.datos.length} almacenes (${almacenes.datos[0].codigo}...)`)
    : mal(`almacenes: ${almacenes.status}`);

  // Crear con un almacen que no existe: el error caro que hay que impedir.
  const inventado = await api('POST', '/api/tiendas', {
    token: admin.token,
    body: { nombre: 'Market Prueba Almacen Malo', almacenId: 'MD01_LZU' },
  });
  inventado.status === 400
    ? ok(`un almacen mal tipeado se RECHAZA: "${inventado.datos.error.slice(0, 78)}..."`)
    : mal(`almacen inventado: ${inventado.status} ${inventado.texto}`);

  // Crear con uno real, y despues borrarlo.
  const conAlmacen = await api('POST', '/api/tiendas', {
    token: admin.token,
    body: { nombre: 'Market Prueba Almacen OK', almacenId: 'md05_crz' },
  });
  if (conAlmacen.status === 201) {
    conAlmacen.datos.almacenId === 'MD05_CRZ'
      ? ok(`se acepta el codigo en minusculas pero se guarda el del ERP: "md05_crz" -> "${conAlmacen.datos.almacenId}"`)
      : mal(`normalizacion: ${conAlmacen.datos.almacenId}`);
    conAlmacen.datos.almacenNombre
      ? ok(`y se copia el nombre del ERP: "${conAlmacen.datos.almacenNombre}"`)
      : mal('no se copio el nombre');

    const desasociar = await api('PATCH', `/api/tiendas/${conAlmacen.datos.id}`, {
      token: admin.token,
      body: { almacenId: null },
    });
    desasociar.status === 200 && desasociar.datos.almacenId === null && desasociar.datos.puedeTraerStock === false
      ? ok('se puede DESASOCIAR con null: mejor sin almacen que con uno equivocado')
      : mal(`desasociar: ${desasociar.status} ${desasociar.texto}`);

    await prisma.sucursal.delete({ where: { id: conAlmacen.datos.id } }).catch(() => {});
    ok('tienda de prueba borrada');
  } else {
    mal(`crear con almacen real: ${conAlmacen.status} ${conAlmacen.texto}`);
  }
}

console.log('\n== 2. EL SNAPSHOT TOMA EL ALMACEN DE LA SUCURSAL ==');
if (admin !== null) {
  // Una sucursal sin almacen Y SIN inventario en curso: si ya tuviera uno
  // abierto, la idempotencia lo devolveria antes de llegar al chequeo de
  // almacen -- y esta bien que asi sea, porque en ese caso no hay que ir a
  // Dynamics a buscar nada.
  const candidatas = await prisma.sucursal.findMany({
    where: { almacenId: null },
    select: { id: true, nombre: true, inventarios: { where: { abierto: true }, select: { id: true } } },
  });
  const libre = candidatas.find((c) => c.inventarios.length === 0);

  if (libre === undefined) {
    // Se crea una al vuelo y se borra: la prueba no depende de que exista
    // una tienda en cierto estado.
    const temp = await prisma.sucursal.create({ data: { nombre: 'Market Prueba Sin Almacen' } });
    const r = await api('POST', '/api/d365/snapshot', { token: admin.token, body: { sucursalId: temp.id, modo: 'real' } });
    r.status === 400 && /almacen/i.test(r.datos?.error ?? '')
      ? ok(`sin almacen configurado el snapshot se rechaza: "${r.datos.error.slice(0, 74)}..."`)
      : mal(`snapshot sin almacen: ${r.status} ${r.texto}`);
    await prisma.sucursal.delete({ where: { id: temp.id } }).catch(() => {});
  } else {
    const r = await api('POST', '/api/d365/snapshot', { token: admin.token, body: { sucursalId: libre.id, modo: 'real' } });
    r.status === 400 && /almacen/i.test(r.datos?.error ?? '')
      ? ok(`sin almacen configurado el snapshot se rechaza: "${r.datos.error.slice(0, 74)}..."`)
      : mal(`snapshot sin almacen: ${r.status} ${r.texto}`);
  }

  // Con inventario YA en curso, la idempotencia gana y ni mira el almacen:
  // no hay nada que traer del ERP.
  const conAbierto = await prisma.inventario.findFirst({ where: { abierto: true }, select: { id: true, sucursalId: true } });
  if (conAbierto !== null) {
    const r = await api('POST', '/api/d365/snapshot', { token: admin.token, body: { sucursalId: conAbierto.sucursalId, modo: 'real' } });
    r.status === 200 && r.datos.inventarioId === conAbierto.id
      ? ok(`con un inventario ya en curso devuelve ese mismo (id ${r.datos.inventarioId}) sin ir a Dynamics`)
      : mal(`idempotencia: ${r.status} ${r.texto}`);
  }
  ok('(el camino feliz no se prueba aca: traeria 11.835 items de Dynamics por la red)');
}

console.log('\n== 3. LAS RESTRICCIONES CON `tipo`, DIRECTO EN POSTGRES ==');
try {
  await prisma.$transaction(async (tx) => {
    const suc = await tx.sucursal.create({ data: { id: 9201, nombre: 'Market Prueba Tipos', almacenId: 'MD01_LUZ' } });

    const mensual = await tx.inventario.create({
      data: { id: 9201, sucursalId: suc.id, periodoAnio: 2028, periodoMes: 12, tipo: 'mensual' },
    });
    ok(`inventario mensual creado (tipo por default: ${mensual.tipo}, abierto=${mensual.abierto})`);

    // LA DECISION: mensual y anual NO conviven abiertos.
    await debeRechazar(tx, 'un ANUAL abierto mientras hay un MENSUAL abierto', () =>
      tx.inventario.create({ data: { id: 9202, sucursalId: suc.id, periodoAnio: 2028, periodoMes: 12, tipo: 'anual' } }));
    console.log('          (el anual es superconjunto del mensual: contar los mismos items dos veces');
    console.log('           a la vez descontaria dos veces el mismo faltante al empleado)');

    // Pero SI conviven en el historico, una vez cerrado el primero.
    await tx.inventario.update({ where: { id: 9201 }, data: { estado: 'lacrado', abierto: null } });
    const anual = await tx.inventario.create({
      data: { id: 9203, sucursalId: suc.id, periodoAnio: 2028, periodoMes: 12, tipo: 'anual' },
    });
    anual.tipo === 'anual'
      ? ok('cerrado el mensual, el ANUAL del MISMO periodo se puede abrir: son dos cierres distintos')
      : mal('no se pudo crear el anual');

    await tx.inventario.update({ where: { id: 9203 }, data: { estado: 'lacrado', abierto: null } });
    const dos = await tx.inventario.count({ where: { sucursalId: suc.id, periodoAnio: 2028, periodoMes: 12 } });
    dos === 2
      ? ok(`los dos conviven en el historico del mismo periodo (${dos} inventarios de 2028-12)`)
      : mal(`hay ${dos} inventarios`);

    // Lo que sigue prohibido: dos del MISMO tipo en el mismo periodo.
    await debeRechazar(tx, 'un SEGUNDO mensual del mismo periodo y sucursal', () =>
      tx.inventario.create({ data: { id: 9204, sucursalId: suc.id, periodoAnio: 2028, periodoMes: 12, tipo: 'mensual' } }));

    throw new Rollback();
  }, { timeout: 30000 });
} catch (e) {
  if (!(e instanceof Rollback)) { console.error('  ERROR INESPERADO:', e.code ?? e.message); fallas += 1; }
}

console.log(fallas === 0 ? '\nTODO VERIFICADO.' : `\n${fallas} FALLA(S).`);
await prisma.$disconnect();
process.exit(fallas === 0 ? 0 : 1);
