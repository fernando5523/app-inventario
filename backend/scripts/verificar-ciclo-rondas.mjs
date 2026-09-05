/**
 * El CICLO DE 3 CONTEOS de punta a punta, contra el backend vivo.
 *
 * Lo que se prueba de verdad y no de palabra:
 *   - que la ronda 2 se abra SOLO con lo que no cuadró;
 *   - que las hojas de la ronda 1 NO se borren;
 *   - que el contador NO vea en la ronda 2 lo que él mismo contó en la 1.
 *
 * Arma su propia tienda: no toca ningún inventario existente.
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

console.log('== ESCENARIO ==');
const admin = await entrar(1000, '001000');
const tienda = (await api('POST', '/api/tiendas', {
  token: admin.token, body: { nombre: `Market Rondas ${S}`, almacenId: 'MD01_LUZ' },
})).datos;
const gente = {};
for (const [clave, rol] of [['coord', 'coordinador'], ['cont', 'conteo']]) {
  gente[clave] = (await api('POST', '/api/usuarios', {
    token: admin.token,
    body: { nombre: `${rol} ${S}`, dni: `${S}${Object.keys(gente).length}`.slice(-8), rol, sucursalId: tienda.id, pin: PIN },
  })).datos;
}
const sCoord = await entrar(gente.coord.id, PIN);
const sCont = await entrar(gente.cont.id, PIN);

const snap = (await api('POST', '/api/d365/snapshot', {
  token: sCoord.token, body: { sucursalId: tienda.id, modo: 'ejemplo' },
})).datos;
const inv = snap.inventarioId;
await api('POST', `/api/inventarios/${inv}/hojas`, { token: sCoord.token, body: { tamano: 20 } });
await api('POST', `/api/inventarios/${inv}/hojas/asignar`, { token: sCoord.token, body: { colaboradorIds: [gente.cont.id] } });
ok(`tienda ${tienda.id}, inventario ${inv} con ${snap.items} items`);

// El catálogo de ejemplo viene SIN stock del ERP (stockErp: null), y sin ese
// número no hay contra qué comparar: todo caería en `sin_dato_erp` y nada
// pasaría a recontar. Se le carga stock para simular un snapshot real -- es
// el escenario de prueba, no un inventario de nadie.
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
{
  const items = await prisma.catalogoItem.findMany({ where: { inventarioId: inv }, select: { id: true }, orderBy: { codigo: 'asc' } });
  for (const [i, it] of items.entries()) {
    await prisma.catalogoItem.update({ where: { id: it.id }, data: { stockErp: 100 + i * 10 } });
  }
}
const catalogo = await prisma.catalogoItem.findMany({
  where: { inventarioId: inv }, select: { codigo: true, stockErp: true }, orderBy: { codigo: 'asc' },
});
info(`stock del ERP cargado: ${catalogo.map((c) => `${c.codigo}=${c.stockErp ?? 'null'}`).join(', ')}`);

// ===========================================================================
console.log('\n== RONDA 1: se cuenta, dos items MAL a propósito ==');
const hojasR1 = (await api('GET', `/api/hojas?alcance=mias&inventarioId=${inv}&ronda=1`, { token: sCont.token })).datos;
const contadoR1 = new Map();
for (const hoja of hojasR1) {
  const productos = (await api('GET', `/api/hojas/${hoja.id}/productos`, { token: sCont.token })).datos;
  for (const [i, p] of productos.entries()) {
    const stock = catalogo.find((c) => c.codigo === p.codigo)?.stockErp ?? 0;
    // Los dos primeros se cuentan MAL: son los que tienen que volver.
    const cuenta = i < 2 ? stock - 3 : stock;
    await api('PUT', `/api/hojas/${hoja.id}/conteos/${p.id}`, {
      token: sCont.token,
      body: { empaques: [], sueltas: cuenta, confirmadoPorEscaner: false, contadoEn: new Date().toISOString() },
    });
    contadoR1.set(p.codigo, cuenta);
  }
  await api('POST', `/api/hojas/${hoja.id}/finalizar`, { token: sCont.token });
}
ok(`ronda 1 contada y finalizada: ${contadoR1.size} items, 2 con diferencia deliberada`);

// ===========================================================================
console.log('\n== PREVIEW: el resumen NO muta nada ==');
{
  const r = await api('GET', `/api/inventarios/${inv}/rondas/1/resumen`, { token: sCoord.token });
  r.status === 200
    ? ok(`resumen: ${r.datos.contados} contados · ${r.datos.cuadrados} cuadrados (${r.datos.porcentajeCuadrado}%) · ${r.datos.aRecontar} a recontar · sinDatoErp=${r.datos.sinDatoErp}`)
    : mal(`resumen: ${r.status} ${r.texto}`);
  r.datos.sePuedeCerrar === true ? ok('sePuedeCerrar=true: todas las hojas finalizadas') : mal(`sePuedeCerrar=${r.datos.sePuedeCerrar}`);
  r.datos.siguienteRonda === 2 ? ok('siguienteRonda=2') : mal(`siguienteRonda=${r.datos.siguienteRonda}`);

  const r2Antes = (await api('GET', `/api/hojas?alcance=todas&inventarioId=${inv}&ronda=2`, { token: sCoord.token })).datos;
  r2Antes.length === 0 ? ok('y NO creó nada: la ronda 2 sigue vacía') : mal(`el preview creó ${r2Antes.length} hojas`);
}

// ===========================================================================
console.log('\n== CERRAR LA RONDA 1 Y ABRIR LA 2 ==');
let hojasR2;
{
  const cierre = await api('POST', `/api/inventarios/${inv}/rondas/1/cerrar`, { token: sCoord.token });
  cierre.status === 201
    ? ok(`ronda 1 cerrada · ronda ${cierre.datos.rondaAbierta} abierta con ${cierre.datos.hojas.length} hoja(s)`)
    : mal(`cerrar: ${cierre.status} ${cierre.texto}`);

  hojasR2 = (await api('GET', `/api/hojas?alcance=todas&inventarioId=${inv}&ronda=2`, { token: sCoord.token })).datos;

  // LO CENTRAL: la ronda 2 trae SOLO lo que no cuadró.
  const enR2 = [];
  for (const h of hojasR2) {
    const ps = (await api('GET', `/api/hojas/${h.id}/productos`, { token: sCoord.token })).datos;
    enR2.push(...ps.map((p) => p.codigo));
  }
  enR2.length === 2
    ? ok(`la ronda 2 tiene SOLO los 2 que no cuadraron (${enR2.join(', ')}), no los ${snap.items} del catálogo`)
    : mal(`la ronda 2 tiene ${enR2.length} items, esperaba 2: ${enR2.join(', ')}`);

  // Y la ronda 1 sigue intacta.
  const r1Despues = (await api('GET', `/api/hojas?alcance=todas&inventarioId=${inv}&ronda=1`, { token: sCoord.token })).datos;
  r1Despues.length === hojasR1.length
    ? ok(`la ronda 1 NO se borró: sigue con ${r1Despues.length} hoja(s) — la auditoría compara las 3`)
    : mal(`la ronda 1 pasó de ${hojasR1.length} a ${r1Despues.length} hojas`);

  const conteosR1 = await prisma.conteo.count({ where: { hoja: { inventarioId: inv, numeroConteo: 1 } } });
  conteosR1 === contadoR1.size
    ? ok(`y sus ${conteosR1} conteos siguen guardados`)
    : mal(`quedan ${conteosR1} conteos de ronda 1, había ${contadoR1.size}`);
}

// ===========================================================================
console.log('\n== CONTEO CIEGO: lo que NO se puede errar ==');
{
  await api('POST', `/api/inventarios/${inv}/hojas/asignar`, { token: sCoord.token, body: { colaboradorIds: [gente.cont.id] } });
  const misR2 = (await api('GET', `/api/hojas?alcance=mias&inventarioId=${inv}&ronda=2`, { token: sCont.token })).datos;

  let ciego = true;
  let detalle = '';
  for (const h of misR2) {
    const ps = (await api('GET', `/api/hojas/${h.id}/productos`, { token: sCont.token })).datos;
    for (const p of ps) {
      const cuerpo = JSON.stringify(p);
      const suyoAntes = contadoR1.get(p.codigo);
      // El número que él mismo cargó en la ronda 1 no puede estar en ningún
      // campo del producto de la ronda 2.
      const camposDeConteo = Object.keys(p).filter((k) => /conteo|sueltas|contad|total|cantidad/i.test(k));
      if (camposDeConteo.length > 0) { ciego = false; detalle = `expone ${camposDeConteo.join(', ')}`; }
      if (suyoAntes !== undefined && cuerpo.includes(`:${suyoAntes},`)) {
        ciego = false; detalle = `el valor ${suyoAntes} de la ronda 1 aparece en ${cuerpo.slice(0, 90)}`;
      }
    }
  }
  ciego
    ? ok('el producto de la ronda 2 NO trae ningún campo de conteo ni el número de la ronda 1')
    : mal(`CONTEO CIEGO ROTO: ${detalle}`);

  // Y en la base: las hojas de ronda 2 nacen sin ningún Conteo.
  const conteosR2 = await prisma.conteo.count({ where: { hoja: { inventarioId: inv, numeroConteo: 2 } } });
  conteosR2 === 0
    ? ok('en la base, las hojas de la ronda 2 nacen SIN ningún Conteo asociado')
    : mal(`la ronda 2 nació con ${conteosR2} conteos`);

  // Son filas distintas: el mismo código es otro Producto en cada ronda.
  const codigo = [...contadoR1.keys()][0];
  const enAmbas = await prisma.producto.findMany({
    where: { hoja: { inventarioId: inv }, codigo }, select: { id: true, hoja: { select: { numeroConteo: true } } },
  });
  const idsDistintos = new Set(enAmbas.map((p) => p.id)).size === enAmbas.length;
  enAmbas.length >= 1 && idsDistintos
    ? ok(`"${codigo}" es un Producto distinto en cada ronda (${enAmbas.map((p) => `r${p.hoja.numeroConteo}:id${p.id}`).join(', ')}) — el conteo ciego es estructural`)
    : info(`"${codigo}" aparece en ${enAmbas.length} ronda(s)`);
}

// ===========================================================================
console.log('\n== GUARDAS DEL CIERRE ==');
{
  const doble = await api('POST', `/api/inventarios/${inv}/rondas/1/cerrar`, { token: sCoord.token });
  doble.status === 409
    ? ok(`cerrar dos veces la misma ronda -> 409: "${doble.datos.error.slice(0, 66)}..."`)
    : mal(`cerrar dos veces dio ${doble.status}`);

  const sinFinalizar = await api('POST', `/api/inventarios/${inv}/rondas/2/cerrar`, { token: sCoord.token });
  sinFinalizar.status === 409
    ? ok(`cerrar la ronda 2 con hojas sin finalizar -> 409: "${sinFinalizar.datos.error.slice(0, 66)}..."`)
    : mal(`cerrar con hojas sin finalizar dio ${sinFinalizar.status}: ${sinFinalizar.texto.slice(0, 100)}`);

  const delContador = await api('POST', `/api/inventarios/${inv}/rondas/2/cerrar`, { token: sCont.token });
  delContador.status === 403
    ? ok('el contador NO puede cerrar una ronda -> 403 (es decisión del coordinador)')
    : mal(`el contador cerrando dio ${delContador.status}`);
}

// ===========================================================================
console.log('\n== EL CICLO TERMINA: ronda 2 con todo bien ==');
{
  const misR2 = (await api('GET', `/api/hojas?alcance=mias&inventarioId=${inv}&ronda=2`, { token: sCont.token })).datos;
  for (const h of misR2) {
    const ps = (await api('GET', `/api/hojas/${h.id}/productos`, { token: sCont.token })).datos;
    for (const p of ps) {
      const stock = catalogo.find((c) => c.codigo === p.codigo)?.stockErp ?? 0;
      await api('PUT', `/api/hojas/${h.id}/conteos/${p.id}`, {
        token: sCont.token,
        body: { empaques: [], sueltas: stock, confirmadoPorEscaner: false, contadoEn: new Date().toISOString() },
      });
    }
    await api('POST', `/api/hojas/${h.id}/finalizar`, { token: sCont.token });
  }

  const cierre2 = await api('POST', `/api/inventarios/${inv}/rondas/2/cerrar`, { token: sCoord.token });
  cierre2.status === 201 && cierre2.datos.rondaAbierta === null
    ? ok(`ronda 2 cerrada y el ciclo TERMINA sin abrir la 3: "${cierre2.datos.motivoSinSiguiente}"`)
    : mal(`cierre de ronda 2: ${cierre2.status} rondaAbierta=${cierre2.datos?.rondaAbierta} ${cierre2.texto.slice(0, 90)}`);

  const r3 = (await api('GET', `/api/hojas?alcance=todas&inventarioId=${inv}&ronda=3`, { token: sCoord.token })).datos;
  r3.length === 0 ? ok('no se creó ninguna hoja de ronda 3: no quedaba nada por recontar') : mal(`se crearon ${r3.length} hojas de ronda 3`);
}

// ===========================================================================
console.log('\n== LA AUDITORÍA VE LAS DOS RONDAS ==');
{
  const m = await api('GET', `/api/auditoria/inventarios/${inv}/matriz?limite=50`, { token: admin.token });
  const conDos = (m.datos?.matriz ?? []).filter((i) => i.conteo1 !== null && i.conteo2 !== null);
  conDos.length === 2
    ? ok(`la matriz muestra conteo1 y conteo2 de los 2 items recontados: ${conDos.map((i) => `${i.codigo}(${i.conteo1}→${i.conteo2})`).join(', ')}`)
    : mal(`items con conteo1 y conteo2: ${conDos.length}, esperaba 2`);
  const cuadrados = (m.datos?.matriz ?? []).filter((i) => i.veredicto === 'cuadrado').length;
  info(`veredicto final: ${cuadrados} de ${m.datos?.matriz?.length} cuadrados`);
}

// ===========================================================================
console.log('\n== LIMPIEZA ==');
if (DEJAR) {
  info(`se deja la tienda ${tienda.id} / inventario ${inv} (--dejar)`);
} else {
  const hs = await prisma.hojaConteo.findMany({ where: { inventarioId: inv }, select: { id: true } });
  const ids = hs.map((h) => h.id);
  await prisma.lineaConteo.deleteMany({ where: { conteo: { hojaId: { in: ids } } } });
  await prisma.conteo.deleteMany({ where: { hojaId: { in: ids } } });
  await prisma.empaque.deleteMany({ where: { producto: { hojaId: { in: ids } } } });
  await prisma.producto.deleteMany({ where: { hojaId: { in: ids } } });
  await prisma.hojaConteo.deleteMany({ where: { inventarioId: inv } });
  await prisma.empaqueCatalogo.deleteMany({ where: { catalogoItem: { inventarioId: inv } } });
  await prisma.catalogoItem.deleteMany({ where: { inventarioId: inv } });
  await prisma.inventario.deleteMany({ where: { id: inv } });
  await prisma.sesionToken.deleteMany({ where: { colaborador: { sucursalId: tienda.id } } });
  await prisma.registroAuditoria.deleteMany({ where: { actor: { sucursalId: tienda.id } } });
  await prisma.colaborador.deleteMany({ where: { sucursalId: tienda.id } });
  await prisma.sucursal.delete({ where: { id: tienda.id } });
  ok('escenario borrado');
}
await prisma.$disconnect();

console.log(fallas === 0 ? '\nEL CICLO DE 3 CONTEOS FUNCIONA.' : `\n${fallas} FALLA(S).`);
process.exit(fallas === 0 ? 0 : 1);
