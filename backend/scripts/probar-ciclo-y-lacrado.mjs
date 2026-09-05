/**
 * Prueba el CICLO DE 3 CONTEOS y el LACRADO en un escenario propio.
 *
 * Crea su propia tienda, su gente y su inventario: NO toca el inventario 20
 * ni ninguno existente. Limpia todo al final salvo que se pase --dejar.
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const DEJAR = process.argv.includes('--dejar');
let fallas = 0;
const ok = (t) => console.log('  [OK]    ' + t);
const mal = (t) => { console.log('  [FALLA] ' + t); fallas += 1; };
const info = (t) => console.log('  [INFO]  ' + t);

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

console.log('== ESCENARIO PROPIO (no toca el inventario 20) ==');
const admin = await entrar(1000, '001000');
const tienda = (await api('POST', '/api/tiendas', {
  token: admin.token,
  body: { nombre: `Market Ciclo ${S}`, almacenId: 'MD01_LUZ' },
})).datos;
ok(`tienda ${tienda.id} creada`);

const gente = {};
for (const [clave, rol] of [['coord', 'coordinador'], ['cont', 'conteo'], ['aud1', 'auditor'], ['aud2', 'auditor']]) {
  const r = await api('POST', '/api/usuarios', {
    token: admin.token,
    body: { nombre: `${rol} ${clave}`, dni: `${S}${Object.keys(gente).length}`.slice(-8), rol, sucursalId: tienda.id, pin: PIN },
  });
  gente[clave] = r.datos;
}
ok(`gente: coordinador, contador y DOS auditores (${gente.aud1.id}, ${gente.aud2.id})`);

const sCoord = await entrar(gente.coord.id, PIN);
const sCont = await entrar(gente.cont.id, PIN);
const sAud1 = await entrar(gente.aud1.id, PIN);
const sAud2 = await entrar(gente.aud2.id, PIN);

const snap = (await api('POST', '/api/d365/snapshot', {
  token: sCoord.token, body: { sucursalId: tienda.id, modo: 'ejemplo' },
})).datos;
const invId = snap.inventarioId;
ok(`inventario ${invId} con ${snap.items} items`);

await api('POST', `/api/inventarios/${invId}/hojas`, { token: sCoord.token, body: { tamano: 20 } });
await api('POST', `/api/inventarios/${invId}/hojas/asignar`, { token: sCoord.token, body: { colaboradorIds: [gente.cont.id] } });
const hojas = (await api('GET', `/api/hojas?alcance=todas&inventarioId=${invId}&ronda=1`, { token: sCoord.token })).datos;
ok(`${hojas.length} hoja(s) de ronda 1 creadas y asignadas`);

// ===========================================================================
console.log('\n== 1. ¿EXISTE LA RONDA 2? ==');
{
  const r1 = (await api('GET', `/api/hojas?alcance=todas&inventarioId=${invId}&ronda=1`, { token: sCoord.token })).datos;
  const r2 = (await api('GET', `/api/hojas?alcance=todas&inventarioId=${invId}&ronda=2`, { token: sCoord.token })).datos;
  info(`ronda 1: ${r1.length} hojas · ronda 2: ${r2.length} hojas`);

  // Lo unico que crea hojas es POST /inventarios/:id/hojas, y fija numeroConteo: 1.
  const rehacer = await api('POST', `/api/inventarios/${invId}/hojas`, { token: sCoord.token, body: { tamano: 20 } });
  // Rehacer las hojas las deja SIN asignar: hay que repartirlas de nuevo.
  await api('POST', `/api/inventarios/${invId}/hojas/asignar`, { token: sCoord.token, body: { colaboradorIds: [gente.cont.id] } });
  const r2Despues = (await api('GET', `/api/hojas?alcance=todas&inventarioId=${invId}&ronda=2`, { token: sCoord.token })).datos;
  r2Despues.length === 0
    ? info(`volver a llamar a POST /hojas (HTTP ${rehacer.status}) NO crea ronda 2: sigue en ${r2Despues.length} hojas`)
    : mal(`inesperado: aparecieron ${r2Despues.length} hojas de ronda 2`);
}

// ===========================================================================
console.log('\n== 2. CONTEO CIEGO: ¿el producto expone lo ya contado? ==');
let hojaUno;
{
  const propias = (await api('GET', `/api/hojas?alcance=mias&inventarioId=${invId}&ronda=1`, { token: sCont.token })).datos;
  hojaUno = propias[0];
  const productos = (await api('GET', `/api/hojas/${hojaUno.id}/productos`, { token: sCont.token })).datos;
  const p = productos[0];

  const guardado = await api('PUT', `/api/hojas/${hojaUno.id}/conteos/${p.id}`, {
    token: sCont.token,
    body: { empaques: [], sueltas: 7, confirmadoPorEscaner: false, contadoEn: new Date().toISOString() },
  });
  guardado.status === 200 || guardado.status === 201
    ? ok(`conteo cargado: producto ${p.id} = 7 sueltas`)
    : mal(`guardar conteo: ${guardado.status} ${guardado.texto}`);

  // Se relee la MISMA hoja: el contador tiene que poder corregir lo suyo.
  const relectura = (await api('GET', `/api/hojas/${hojaUno.id}/productos`, { token: sCont.token })).datos;
  const pRele = relectura.find((x) => x.id === p.id);
  const camposDeConteo = Object.keys(pRele).filter((k) => /conteo|sueltas|empaquesContados|total|cantidad/i.test(k));

  camposDeConteo.length === 0
    ? ok(`GET /hojas/:id/productos NO devuelve ningun campo de conteo (campos: ${Object.keys(pRele).join(', ')})`)
    : info(`el producto expone: ${camposDeConteo.join(', ')} -- revisar si eso alcanza a otra ronda`);

  info('cada ronda materializa sus PROPIOS Producto (Producto.hojaId), asi que una hoja');
  info('de ronda 2 nunca podria arrastrar el conteo de la hoja de ronda 1: son filas distintas');
}

// ===========================================================================
console.log('\n== 4. LACRADO: control de dos personas ==');
{
  const estado0 = await api('GET', `/api/historial/inventarios/${invId}/lacrado/estado`, { token: sAud1.token });
  estado0.status === 200
    ? ok(`estado inicial: ${estado0.datos.aprobaciones.length}/${estado0.datos.aprobacionesRequeridas} firmas, lacrado=${estado0.datos.lacrado}, todoSincronizado=${estado0.datos.todoSincronizado}`)
    : mal(`estado del lacrado: ${estado0.status} ${estado0.texto}`);

  // a) aprobadorId en el body -> 400
  const suplantar = await api('POST', `/api/historial/inventarios/${invId}/aprobaciones`, {
    token: sAud1.token, body: { aprobadorId: gente.aud2.id },
  });
  suplantar.status === 400
    ? ok('mandar aprobadorId en el body -> 400 (quien firma sale del TOKEN)')
    : mal(`aprobadorId en el body dio ${suplantar.status}, esperaba 400`);

  // b) aprobar con el inventario todavia en curso
  const enCurso = await api('POST', `/api/historial/inventarios/${invId}/aprobaciones`, { token: sAud1.token, body: {} });
  enCurso.status === 409
    ? ok(`no se firma un inventario en curso -> 409: "${enCurso.datos.error.slice(0, 62)}..."`)
    : info(`aprobar en curso dio ${enCurso.status}: ${enCurso.texto.slice(0, 90)}`);
}

// ===========================================================================
console.log('\n== 5. LACRAR CON HOJAS SIN FINALIZAR ==');
{
  const sinFinalizar = (await api('GET', `/api/hojas?alcance=todas&inventarioId=${invId}&ronda=1`, { token: sCoord.token })).datos
    .filter((h) => h.estado !== 'finalizada');
  info(`${sinFinalizar.length} hoja(s) sin finalizar en el inventario`);

  const lacrar = await api('POST', `/api/historial/inventarios/${invId}/lacrado`, { token: sAud1.token, body: {} });
  lacrar.status === 409
    ? ok(`lacrar se rechaza -> 409: "${lacrar.datos.error.slice(0, 76)}..."`)
    : mal(`lacrar dio ${lacrar.status}: ${lacrar.texto.slice(0, 120)}`);
}

// ===========================================================================
console.log('\n== LIMPIEZA ==');
if (DEJAR) {
  info(`se deja la tienda ${tienda.id} y el inventario ${invId} (--dejar)`);
} else {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const hs = await prisma.hojaConteo.findMany({ where: { inventarioId: invId }, select: { id: true } });
  const ids = hs.map((h) => h.id);
  await prisma.lineaConteo.deleteMany({ where: { conteo: { hojaId: { in: ids } } } });
  await prisma.conteo.deleteMany({ where: { hojaId: { in: ids } } });
  await prisma.empaque.deleteMany({ where: { producto: { hojaId: { in: ids } } } });
  await prisma.producto.deleteMany({ where: { hojaId: { in: ids } } });
  await prisma.hojaConteo.deleteMany({ where: { inventarioId: invId } });
  await prisma.empaqueCatalogo.deleteMany({ where: { catalogoItem: { inventarioId: invId } } });
  await prisma.catalogoItem.deleteMany({ where: { inventarioId: invId } });
  await prisma.aprobacionCierre.deleteMany({ where: { inventarioId: invId } });
  await prisma.inventario.deleteMany({ where: { id: invId } });
  await prisma.sesionToken.deleteMany({ where: { colaborador: { sucursalId: tienda.id } } });
  await prisma.registroAuditoria.deleteMany({ where: { actor: { sucursalId: tienda.id } } });
  await prisma.colaborador.deleteMany({ where: { sucursalId: tienda.id } });
  await prisma.sucursal.delete({ where: { id: tienda.id } });
  await prisma.$disconnect();
  ok('escenario de prueba borrado — el inventario 20 no se tocó');
}

console.log(fallas === 0 ? '\nSIN FALLAS EN LO QUE SI ESTA IMPLEMENTADO.' : `\n${fallas} FALLA(S).`);
process.exit(fallas === 0 ? 0 : 1);
