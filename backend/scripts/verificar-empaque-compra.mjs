/**
 * EL EMPAQUE DE COMPRA Y LAS TRES VIAS, de punta a punta contra el backend
 * vivo: que el snapshot los ESCRIBA de verdad en la base.
 *
 * Es la mitad que los tests no prueban. `empaqueDeCompra` y `clasificarItem`
 * estan cubiertos sin base; lo que esto verifica es que el camino completo
 * --tomar el snapshot por la API y persistir el catalogo-- llene las columnas
 * nuevas en vez de dejarlas en su default.
 *
 * Lo que mide:
 *   - que cada item del catalogo quede con `empaque_compra`, su simbolo y su
 *     `clase`;
 *   - que la clase concuerde con el empaque (paquete si >1, unidad si =1) y
 *     con `es_empresa` (que son el mismo hecho mientras las dos convivan);
 *   - que el UMBRAL de la config quede CONGELADO en el inventario, que es la
 *     perilla que hasta ahora no movia nada.
 *
 * ARMA SU PROPIA TIENDA y borra todo al terminar. No toca ningun inventario
 * existente -- menos todavia el escenario de demostracion.
 *
 *   PIN_ADMIN=<pin> node scripts/verificar-empaque-compra.mjs
 */
import { pinDev } from './_pin-dev.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

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
const entrar = async (id, pin) => (await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: id, pin } })).datos;

const S = Date.now().toString().slice(-6);
const PIN = S;

console.log('== ESCENARIO PROPIO ==');
const admin = await entrar(1000, process.env.PIN_ADMIN ?? pinDev('administrador'));
const tienda = (await api('POST', '/api/tiendas', {
  token: admin?.token, body: { nombre: `Market Empaque ${S}`, almacenId: 'MD01_LUZ' },
})).datos;
const coord = (await api('POST', '/api/usuarios', {
  token: admin?.token,
  body: { nombre: `coord ${S}`, dni: `${S}9`.slice(-8), rol: 'coordinador', sucursalId: tienda?.id, pin: PIN },
})).datos;

/** Misma guarda que el resto de los verificadores: sin id, un filtro de Prisma no filtra NADA. */
function exigirId(valor, que) {
  if (Number.isInteger(valor) && valor > 0) return valor;
  console.error(`\n  [ABORTA] ${que}: se esperaba un id y llego ${JSON.stringify(valor)}. No se toca la base.`);
  process.exit(1);
}
exigirId(tienda?.id, 'la tienda de prueba');
exigirId(coord?.id, 'el coordinador');

const sCoord = await entrar(coord.id, PIN);
/**
 * `--real` toma el snapshot contra DYNAMICS de verdad (~11.800 productos y
 * 37.000 conversiones): es la unica forma de probar que el empaque de compra
 * se resuelve sobre los datos del tenant y no solo sobre los 4 de ejemplo.
 * Tarda, asi que el default sigue siendo `ejemplo`.
 */
const REAL = process.argv.includes('--real');
const snap = (await api('POST', '/api/d365/snapshot', {
  token: sCoord?.token, body: { sucursalId: tienda?.id, modo: REAL ? 'real' : 'ejemplo' },
})).datos;
console.log(`  modo: ${REAL ? 'REAL (contra Dynamics)' : 'ejemplo'}`);
const inv = exigirId(snap?.inventarioId, 'el inventario del snapshot');
ok(`tienda ${tienda.id}, inventario ${inv}`);

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
try {
  console.log('\n== EL SNAPSHOT ESCRIBIO LAS COLUMNAS NUEVAS ==');

  const items = await prisma.catalogoItem.findMany({
    where: { inventarioId: inv },
    select: { codigo: true, empaqueCompra: true, empaqueCompraSimbolo: true, clase: true, esEmpresa: true },
    orderBy: { codigo: 'asc' },
  });
  items.length > 0 ? ok(`${items.length} items en el catalogo`) : mal('el catalogo quedo vacio');

  const conEmpaque = items.filter((i) => i.empaqueCompra !== null);
  if (REAL) {
    // Contra el catalogo real NO se exige el 100%: hay items cuya unidad de
    // compra no tiene conversion ni numero en el nombre ("SA"), y para esos
    // NULL es la respuesta correcta -- "no se sabe el tamano del paquete" no
    // es lo mismo que 1. Lo que si se exige es que la enorme mayoria resuelva:
    // si cayera, seria que el simbolo o la conversion cambiaron de forma.
    const porcentaje = (conEmpaque.length / items.length) * 100;
    porcentaje >= 90
      ? ok(`${conEmpaque.length} de ${items.length} items (${porcentaje.toFixed(1)}%) con empaque de compra resuelto`)
      : mal(`solo ${porcentaje.toFixed(1)}% resolvio el empaque de compra: se esperaba >=90%`);
    const sinDato = items.filter((i) => i.empaqueCompra === null).slice(0, 3);
    for (const i of sinDato) console.log(`          sin empaque: item ${i.codigo} (simbolo "${i.empaqueCompraSimbolo ?? ''}")`);
  } else {
    conEmpaque.length === items.length
      ? ok(`los ${items.length} tienen empaque de compra resuelto`)
      : mal(`${items.length - conEmpaque.length} items quedaron con empaque_compra en NULL`);
  }

  const conSimbolo = items.filter((i) => (i.empaqueCompraSimbolo ?? '') !== '');
  conSimbolo.length >= conEmpaque.length
    ? ok('los que tienen numero guardan tambien el simbolo del ERP, para poder auditarlo')
    : mal(`hay items con empaque_compra y sin simbolo: ${conEmpaque.length - conSimbolo.length}`);

  if (REAL) {
    // El reparto entre las tres vias sobre datos reales. `unidad` tiene que
    // ser una parte importante (457 de los primeros 2.000 se compran sueltos)
    // y `paquete` la mayoria: si esto se diera vuelta, la clasificacion
    // estaria leyendo el empaque equivocado.
    const porClase = new Map();
    for (const i of items) porClase.set(i.clase, (porClase.get(i.clase) ?? 0) + 1);
    console.log(`          reparto por clase: ${[...porClase].map(([c, n]) => `${c}=${n}`).join(', ')}`);
  }

  for (const i of items.slice(0, 4)) {
    console.log(`          item ${i.codigo}: ${i.empaqueCompraSimbolo} = ${i.empaqueCompra} -> clase ${i.clase}`);
  }

  console.log('\n== LA CLASE CONCUERDA CON LO QUE DICE ==');

  const claseMal = items.filter((i) => {
    const esperada = i.esEmpresa ? 'empresa' : (i.empaqueCompra !== null && i.empaqueCompra > 1 ? 'paquete' : 'unidad');
    return i.clase !== esperada;
  });
  claseMal.length === 0
    ? ok('la clase de cada item concuerda con su empaque y su es_empresa')
    : mal(`${claseMal.length} items con la clase que no corresponde (ej. ${claseMal[0]?.codigo})`);

  // Las dos columnas son el MISMO hecho mientras convivan. Si alguna vez
  // discrepan, la auditoria y el calculo nuevo leen cosas distintas del mismo
  // item y nadie se entera hasta que alguien compara dos pantallas.
  const discrepan = items.filter((i) => i.esEmpresa !== (i.clase === 'empresa'));
  discrepan.length === 0
    ? ok('`clase = empresa` y `es_empresa = true` no discrepan en ninguna fila')
    : mal(`${discrepan.length} filas donde clase y es_empresa dicen cosas distintas`);

  const conPaquete = items.filter((i) => i.clase === 'paquete').length;
  conPaquete > 0
    ? ok(`${conPaquete} items quedaron como \`paquete\`: la regla del umbral tiene a quien aplicarse`)
    : mal('ningun item quedo como `paquete`: la regla no tendria sobre que correr');

  console.log('\n== LA PERILLA QUEDO CABLEADA ==');

  const config = await prisma.configuracion.findUnique({
    where: { clave: 'UMBRAL_MEDIA_UNIDAD_PAQUETE' }, select: { valor: true },
  });
  const inventario = await prisma.inventario.findUnique({
    where: { id: inv }, select: { umbralMediaUnidadPaquete: true },
  });
  const congelado = Number(inventario?.umbralMediaUnidadPaquete);
  const esperado = config === null ? 0.5 : Number(config.valor);

  Number.isFinite(congelado) && congelado > 0
    ? ok(`el inventario congelo el umbral en ${congelado}`)
    : mal(`el inventario quedo con un umbral inutilizable: ${inventario?.umbralMediaUnidadPaquete}`);

  Math.abs(congelado - esperado) < 0.0005
    ? ok(`y coincide con la config (${config === null ? 'sin fila -> default 0.5' : config.valor})`)
    : mal(`el umbral congelado (${congelado}) no coincide con la config (${esperado})`);
} finally {
  console.log('\n== LIMPIEZA ==');
  await prisma.empaqueCatalogo.deleteMany({ where: { catalogoItem: { inventarioId: inv } } });
  await prisma.catalogoItem.deleteMany({ where: { inventarioId: inv } });
  await prisma.hojaConteo.deleteMany({ where: { inventarioId: inv } });
  await prisma.inventario.deleteMany({ where: { id: inv } });
  await prisma.sesionToken.deleteMany({ where: { colaborador: { sucursalId: tienda.id } } });
  await prisma.registroAuditoria.deleteMany({ where: { actor: { sucursalId: tienda.id } } });
  await prisma.colaborador.deleteMany({ where: { sucursalId: tienda.id } });
  await prisma.sucursal.delete({ where: { id: tienda.id } });
  ok('escenario borrado');
  await prisma.$disconnect();
}

console.log('');
if (fallas === 0) {
  console.log('EL EMPAQUE DE COMPRA Y LAS TRES VIAS SE PERSISTEN.');
  process.exit(0);
}
console.log(`${fallas} FALLA(S).`);
process.exit(1);
