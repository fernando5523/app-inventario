/**
 * EL FLUJO QUE VA A HACER EL CLIENTE con la base vacia, en orden:
 *
 *   1. el administrador entra
 *   2. crea una TIENDA, con su almacen de Dynamics
 *   3. crea los USUARIOS de esa tienda (coordinador, contadores, auditores)
 *   4. el coordinador entra y arranca el inventario
 *
 * Cada paso se hace por HTTP, exactamente como lo haria la app desde el
 * telefono. Si alguno no se puede hacer asi, es un agujero: el cliente se va
 * a chocar con el y no va a tener forma de rodearlo.
 *
 * Deja la tienda de prueba borrada al final (salvo que se pase --dejar).
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const DEJAR = process.argv.includes('--dejar');
let fallas = 0;
const ok = (t) => console.log('  [OK]    ' + t);
const mal = (t) => { console.log('  [FALLA] ' + t); fallas += 1; };
const nota = (t) => console.log('  [NOTA]  ' + t);

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

const SUFIJO = Date.now().toString().slice(-6);

// ===========================================================================
console.log('== PASO 1: EL ADMINISTRADOR ENTRA ==');

// La app lista los administradores por un camino aparte: el administrador no
// tiene sucursal, asi que no aparece en /sucursales/:id/colaboradores.
const listaAdmins = await api('GET', '/api/sesion/administradores');
listaAdmins.status === 200 && Array.isArray(listaAdmins.datos) && listaAdmins.datos.length > 0
  ? ok(`la app puede LISTAR administradores sin sesion: ${listaAdmins.datos.map((a) => `${a.nombre} (id ${a.id})`).join(', ')}`)
  : mal(`GET /api/sesion/administradores: ${listaAdmins.status} ${listaAdmins.texto}`);

const admin = await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: 1000, pin: '001000' } });
if (admin.status !== 200) {
  mal(`el administrador NO PUEDE ENTRAR: ${admin.status} ${admin.texto}`);
  console.log('\nSin esto el cliente queda afuera de su propia app. Se corta la prueba.');
  process.exit(1);
}
ok(`entra como ${admin.datos.colaborador.nombre} (rol ${admin.datos.colaborador.rol})`);
admin.datos.sucursal === null
  ? ok('y su sesion trae sucursal:null, que es lo correcto: el administrador es del sistema, no de una tienda')
  : mal(`sucursal deberia ser null: ${JSON.stringify(admin.datos.sucursal)}`);
const tokenAdmin = admin.datos.token;

// ===========================================================================
console.log('\n== PASO 2: CREA UNA TIENDA CON SU ALMACEN ==');

const almacenes = await api('GET', '/api/d365/almacenes', { token: tokenAdmin });
let almacenElegido = null;
if (almacenes.status === 200 && almacenes.datos.length > 0) {
  almacenElegido = almacenes.datos.find((a) => a.codigo.startsWith('MD')) ?? almacenes.datos[0];
  ok(`puede ELEGIR de la lista del ERP: ${almacenes.datos.length} almacenes disponibles`);
} else {
  nota(`no se pudo listar almacenes (${almacenes.status}); se sigue sin almacen`);
}

const tienda = await api('POST', '/api/tiendas', {
  token: tokenAdmin,
  body: {
    nombre: `Market Prueba Carga ${SUFIJO}`,
    direccion: 'Av. Prueba 123',
    ...(almacenElegido !== null ? { almacenId: almacenElegido.codigo } : {}),
  },
});
if (tienda.status !== 201) {
  mal(`crear tienda: ${tienda.status} ${tienda.texto}`);
  process.exit(1);
}
const sucursalId = tienda.datos.id;
ok(`tienda creada: id ${sucursalId} "${tienda.datos.nombre}"`);
tienda.datos.almacenId
  ? ok(`con su almacen: ${tienda.datos.almacenId} "${tienda.datos.almacenNombre}" · puedeTraerStock=${tienda.datos.puedeTraerStock}`)
  : nota('sin almacen (no se pudo consultar el ERP): la tienda existe pero no puede traer stock');

// ===========================================================================
console.log('\n== PASO 3: CREA LOS USUARIOS DE ESA TIENDA ==');

const PERSONAL = [
  { nombre: 'Coordinador Prueba', rol: 'coordinador' },
  { nombre: 'Contador Uno', rol: 'conteo' },
  { nombre: 'Contador Dos', rol: 'conteo' },
  { nombre: 'Auditor Uno', rol: 'auditor' },
  { nombre: 'Auditor Dos', rol: 'auditor' },
];

const creados = [];
for (const [i, persona] of PERSONAL.entries()) {
  const dni = `${SUFIJO}${i}`.slice(-8);
  const r = await api('POST', '/api/usuarios', {
    token: tokenAdmin,
    body: { nombre: persona.nombre, dni, rol: persona.rol, sucursalId, pin: `${SUFIJO}` },
  });
  if (r.status === 201) creados.push({ ...r.datos, pin: SUFIJO });
  else mal(`crear ${persona.rol}: ${r.status} ${r.texto}`);
}
creados.length === PERSONAL.length
  ? ok(`${creados.length} usuarios creados: ${creados.map((c) => c.rol).join(', ')}`)
  : mal(`solo se crearon ${creados.length} de ${PERSONAL.length}`);

// Los DOS auditores importan: son los que despues firman el lacrado, y el
// control de dos personas exige que sean distintos.
creados.filter((c) => c.rol === 'auditor').length >= 2
  ? ok('hay DOS auditores: sin eso el inventario no se puede lacrar (control de dos personas)')
  : mal('faltan auditores para poder lacrar');

// ===========================================================================
console.log('\n== PASO 4: EL COORDINADOR ENTRA Y ARRANCA EL INVENTARIO ==');

const visibles = await api('GET', `/api/sesion/sucursales/${sucursalId}/colaboradores`);
visibles.status === 200 && visibles.datos.length === creados.length
  ? ok(`la app lista a los ${visibles.datos.length} de la tienda nueva para elegir con quien entrar`)
  : mal(`listar colaboradores: ${visibles.status}, ${visibles.datos?.length} de ${creados.length}`);

const enSucursales = await api('GET', '/api/sesion/sucursales');
enSucursales.datos?.some((s) => s.id === sucursalId)
  ? ok('y la tienda nueva aparece en la lista de sucursales del login')
  : mal('la tienda nueva NO aparece en el selector de sucursales');

const coord = creados.find((c) => c.rol === 'coordinador');
const sesionCoord = await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: coord.id, pin: SUFIJO } });
if (sesionCoord.status !== 200) {
  mal(`el coordinador no puede entrar: ${sesionCoord.status} ${sesionCoord.texto}`);
} else {
  ok(`el coordinador entra: ${sesionCoord.datos.colaborador.nombre}, sucursal "${sesionCoord.datos.sucursal?.nombre}"`);

  // Arrancar el inventario = traer el snapshot (paso 1 del Coordinador).
  // Se pide en modo ejemplo para no bajar 11.835 items por la red en una
  // prueba; el camino real es identico salvo el origen del catalogo.
  const snap = await api('POST', '/api/d365/snapshot', {
    token: sesionCoord.datos.token,
    body: { sucursalId, modo: 'ejemplo' },
  });
  if (snap.status === 200) {
    ok(`ARRANCA EL INVENTARIO: inventario ${snap.datos.inventarioId} con ${snap.datos.items} items`);

    const repetido = await api('POST', '/api/d365/snapshot', {
      token: sesionCoord.datos.token,
      body: { sucursalId, modo: 'ejemplo' },
    });
    repetido.datos?.inventarioId === snap.datos.inventarioId
      ? ok('y si lo aprieta dos veces devuelve el mismo, no crea otro')
      : mal(`idempotencia del snapshot: ${repetido.status} ${repetido.texto}`);
  } else {
    mal(`traer snapshot: ${snap.status} ${snap.texto}`);
  }
}

// ===========================================================================
console.log('\n== LIMPIEZA ==');
if (DEJAR) {
  nota(`se deja la tienda ${sucursalId} y sus ${creados.length} usuarios (--dejar)`);
} else {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const invs = await prisma.inventario.findMany({ where: { sucursalId }, select: { id: true } });
    const ids = invs.map((i) => i.id);
    const hojas = await prisma.hojaConteo.findMany({ where: { inventarioId: { in: ids } }, select: { id: true } });
    const idsHoja = hojas.map((h) => h.id);
    await prisma.conteo.deleteMany({ where: { hojaId: { in: idsHoja } } });
    await prisma.producto.deleteMany({ where: { hojaId: { in: idsHoja } } });
    await prisma.hojaConteo.deleteMany({ where: { inventarioId: { in: ids } } });
    await prisma.catalogoItem.deleteMany({ where: { inventarioId: { in: ids } } });
    await prisma.inventario.deleteMany({ where: { sucursalId } });
    await prisma.sesionToken.deleteMany({ where: { colaborador: { sucursalId } } });
    await prisma.registroAuditoria.deleteMany({ where: { actor: { sucursalId } } });
    await prisma.colaborador.deleteMany({ where: { sucursalId } });
    await prisma.sucursal.delete({ where: { id: sucursalId } });
    ok('tienda de prueba y todo lo suyo, borrado');
  } catch (e) {
    nota(`no se pudo limpiar del todo (${e.message?.slice(0, 80)}); revisá la sucursal ${sucursalId}`);
  }
  await prisma.$disconnect();
}

console.log(fallas === 0 ? '\nEL FLUJO DE CARGA ESTA COMPLETO.' : `\n${fallas} PASO(S) DEL FLUJO NO SE PUEDEN HACER DESDE LA APP.`);
process.exit(fallas === 0 ? 0 : 1);
