/**
 * CORREGIR CON LA RONDA CERRADA SACA EL ITEM DE LA RONDA SIGUIENTE, de punta a
 * punta contra el backend vivo.
 *
 * Es la mitad que faltaba de para lo que el cliente pidio la correccion
 * (reunion 2, 00:12:12): *"yo le he finalizado la hoja y he encontrado una
 * caja mas de aceite. Puedes corregirlo PARA QUE YA NO SALGA EN MI SEGUNDO
 * CONTEO"*.
 *
 * Lo que se prueba de verdad y no de palabra:
 *   - corregir con la ronda 2 SIN EMPEZAR saca el item de la ronda 2;
 *   - si la hoja queda vacia se borra, y si era la unica, la ronda desaparece;
 *   - con la ronda desaparecida, `abrirRondaExtra` e `iniciarAjuste` siguen
 *     funcionando (el borde que mas facil se rompe);
 *   - corregir con la ronda 2 YA EMPEZADA no toca nada -- no se le cambia la
 *     hoja a alguien que ya la tiene en la mano;
 *   - una correccion que NO hace cuadrar deja el item donde estaba.
 *
 * Arma su propia tienda: no toca ningun inventario existente.
 *
 *   node backend/scripts/verificar-correccion-saca-de-ronda.mjs [--dejar]
 *
 * `TOKEN_ADMIN=<token>` saltea el login del administrador. Hace falta cuando
 * la base tiene colaboradores sembrados por un script con PIN propio, no el de
 * `_pin-dev.mjs` -- pasa en la base de la demostracion.
 */
import { pinDev } from './_pin-dev.mjs';

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

/**
 * MISMA GUARDA QUE `verificar-ciclo-rondas.mjs`, y por la misma razon: los ids
 * salen de respuestas HTTP, y si el backend contesta algo distinto quedan
 * `undefined`. Prisma IGNORA las condiciones `undefined`, asi que un
 * `where: { inventarioId: undefined }` no filtra nada -- filtra TODO. Se corta
 * aca, antes de tocar la base.
 */
function exigirId(valor, que, tiendaId) {
  if (Number.isInteger(valor) && valor > 0) return valor;
  console.error(`\n  [ABORTA] ${que}: se esperaba un id y llego ${JSON.stringify(valor)}.`);
  console.error('  El escenario no se armo; sin ese id, un filtro de Prisma no filtra NADA.');
  if (Number.isInteger(tiendaId)) console.error(`  Puede haber quedado la tienda ${tiendaId} sin borrar.`);
  process.exit(1);
}

console.log('== ESCENARIO ==');
const tokenAdmin = process.env.TOKEN_ADMIN ?? (await entrar(1000, pinDev('administrador')))?.token;
if (!tokenAdmin) {
  console.error('\n  [ABORTA] no se pudo entrar como administrador.');
  console.error('  Si esta base tiene PINes propios, pasa TOKEN_ADMIN=<token>.');
  process.exit(1);
}

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const armados = [];

/**
 * Arma una tienda propia con su inventario ya en la ronda 2.
 *
 * HACEN FALTA DOS escenarios y no uno: el caso "la ronda ya empezo" deja la
 * ronda 2 a medio contar para siempre, y el caso "la ronda desaparecio" exige
 * que nadie la haya tocado. En el mismo inventario se pisan.
 */
async function armarEscenario(etiqueta) {
  const suf = `${S}${armados.length}`;
  const tienda = (await api('POST', '/api/tiendas', {
    token: tokenAdmin, body: { nombre: `Market SacarRonda ${suf}`, almacenId: 'MD01_LUZ' },
  })).datos;
  exigirId(tienda?.id, `la tienda de ${etiqueta}`);

  const gente = {};
  for (const [clave, rol] of [['coord', 'coordinador'], ['cont', 'conteo'], ['aud', 'auditor']]) {
    gente[clave] = (await api('POST', '/api/usuarios', {
      token: tokenAdmin,
      body: {
        nombre: `${rol} ${suf}`,
        dni: `${suf}${Object.keys(gente).length}`.slice(-8),
        rol,
        // El auditor lleva `sucursalId` porque `usuarios.schema.ts` lo exige a
        // todos menos al administrador. NO lo convierte en personal de tienda:
        // `ROLES_DE_TIENDA` filtra por ROL, no por sucursal -- es el mismo caso
        // de Gilmer, sembrado con una tienda que no le corresponde.
        sucursalId: tienda.id,
        pin: PIN,
      },
    })).datos;
    exigirId(gente[clave]?.id, `el ${rol} de ${etiqueta}`, tienda.id);
  }
  const ses = {
    coord: await entrar(gente.coord.id, PIN),
    cont: await entrar(gente.cont.id, PIN),
    aud: await entrar(gente.aud.id, PIN),
  };

  const snap = (await api('POST', '/api/d365/snapshot', {
    token: ses.coord.token, body: { sucursalId: tienda.id, modo: 'ejemplo' },
  })).datos;
  const inv = snap?.inventarioId;
  exigirId(inv, `el inventario de ${etiqueta}`, tienda.id);
  armados.push({ tienda, inv, gente });

  // El catalogo de ejemplo viene SIN stock del ERP, y sin ese numero todo
  // caeria en `sin_dato_erp` y nada pasaria a recontar.
  const items = await prisma.catalogoItem.findMany({
    where: { inventarioId: inv }, select: { id: true, inventarioId: true }, orderBy: { codigo: 'asc' },
  });
  // Segunda red, fila por fila: si el filtro de arriba se rompiera, no se
  // escribe NADA.
  if (items.some((it) => it.inventarioId !== inv)) {
    console.error('\n  [ABORTA] el catalogo a modificar trae filas de otro inventario. No se escribe nada.');
    process.exit(1);
  }
  for (const [i, it] of items.entries()) {
    await prisma.catalogoItem.update({ where: { id: it.id }, data: { stockErp: 100 + i * 10 } });
  }
  const catalogo = await prisma.catalogoItem.findMany({
    where: { inventarioId: inv }, select: { codigo: true, stockErp: true }, orderBy: { codigo: 'asc' },
  });
  const stockDe = new Map(catalogo.map((c) => [c.codigo, c.stockErp]));

  await api('POST', `/api/inventarios/${inv}/hojas`, { token: ses.coord.token, body: { tamano: 50 } });
  await api('POST', `/api/inventarios/${inv}/hojas/asignar`, { token: ses.coord.token, body: { colaboradorIds: [gente.cont.id] } });

  // Dos items mal a proposito: son los que van a pasar a la ronda 2.
  const malos = [catalogo[0].codigo, catalogo[1].codigo];
  const hojas = (await api('GET', `/api/hojas?alcance=mias&inventarioId=${inv}&ronda=1`, { token: ses.cont.token })).datos;
  for (const hoja of hojas) {
    const productos = (await api('GET', `/api/hojas/${hoja.id}/productos`, { token: ses.cont.token })).datos;
    for (const prod of productos) {
      const base = stockDe.get(prod.codigo) ?? 0;
      await api('PUT', `/api/hojas/${hoja.id}/conteos/${prod.id}`, {
        token: ses.cont.token,
        body: { empaques: [], sueltas: malos.includes(prod.codigo) ? base - 1 : base, contadoEn: new Date().toISOString() },
      });
    }
    await api('POST', `/api/hojas/${hoja.id}/finalizar`, { token: ses.cont.token });
  }
  const cierre = (await api('POST', `/api/inventarios/${inv}/rondas/1/cerrar`, { token: ses.coord.token })).datos;
  if (cierre?.rondaAbierta !== 2) {
    console.error(`\n  [ABORTA] ${etiqueta}: se esperaba abrir la ronda 2, llego ${JSON.stringify(cierre?.rondaAbierta)}.`);
    process.exit(1);
  }
  ok(`${etiqueta}: tienda ${tienda.id}, inventario ${inv}, ronda 2 con ${cierre.resumen.aRecontar} item(s)`);
  return { tienda, inv, gente, ses, stockDe, malos };
}

/** Corrige el conteo de la RONDA 1 de ese codigo. */
async function corregirEnRonda1(esc, codigo, sueltas, motivo, token) {
  const prod = await prisma.producto.findFirst({
    where: { codigo, hoja: { inventarioId: esc.inv, numeroConteo: 1 } },
    select: { id: true, hojaId: true },
  });
  return api('PATCH', `/api/hojas/${prod.hojaId}/conteos/${prod.id}/corregir`, {
    token: token ?? esc.ses.coord.token,
    body: { empaques: [], sueltas, motivo },
  });
}

const A = await armarEscenario('escenario A (ronda 2 intacta)');
const [malA, malB] = A.malos;
const inv = A.inv;
const stockDe = A.stockDe;

// ===========================================================================
console.log('\n== CASO 1: la correccion NO hace cuadrar -> no se toca nada ==');
{
  const antes = await prisma.producto.count({ where: { codigo: malB, hoja: { inventarioId: inv, numeroConteo: 2 } } });
  const r = await corregirEnRonda1(A, malB, (stockDe.get(malB) ?? 0) - 2, 'Sigue sin cuadrar');

  if (r.datos?.salioDeLaRonda == null) ok('no dice que haya salido de ninguna ronda');
  else mal(`se esperaba salioDeLaRonda null, llego ${JSON.stringify(r.datos?.salioDeLaRonda)}`);

  const despues = await prisma.producto.count({ where: { codigo: malB, hoja: { inventarioId: inv, numeroConteo: 2 } } });
  if (despues === antes) ok(`${malB} sigue en la ronda 2, como corresponde`);
  else mal(`${malB} salio de la ronda 2 sin cuadrar`);
}

// ===========================================================================
console.log('\n== CASO 2: la ronda 2 NO empezo -> el item sale y `tamano` baja ==');
{
  const antes = await prisma.producto.count({ where: { hoja: { inventarioId: inv, numeroConteo: 2 } } });
  const r = await corregirEnRonda1(A, malA, stockDe.get(malA), 'Aparecio una caja mas: ahora cuadra');

  if (r.status !== 200) mal(`la correccion fallo: HTTP ${r.status} ${r.texto.slice(0, 140)}`);
  else if (r.datos?.salioDeLaRonda?.ronda === 2) ok('la respuesta avisa que el item salio de la ronda 2');
  else mal(`se esperaba salioDeLaRonda.ronda=2, llego ${JSON.stringify(r.datos?.salioDeLaRonda)}`);

  const sigue = await prisma.producto.count({ where: { codigo: malA, hoja: { inventarioId: inv, numeroConteo: 2 } } });
  if (sigue === 0) ok(`${malA} ya no esta en la ronda 2`);
  else mal(`${malA} sigue en la ronda 2 (${sigue} fila(s))`);

  const despues = await prisma.producto.count({ where: { hoja: { inventarioId: inv, numeroConteo: 2 } } });
  if (despues === antes - 1) ok(`la ronda 2 paso de ${antes} a ${despues} producto(s)`);
  else mal(`se esperaba ${antes - 1} producto(s), hay ${despues}`);

  // `tamano` es CUANTOS ITEMS TIENE ESTA HOJA: si no baja, la pantalla dice
  // "1 / 2 Productos" con la hoja entera hecha.
  const hojas = await prisma.hojaConteo.findMany({
    where: { inventarioId: inv, numeroConteo: 2 },
    select: { id: true, tamano: true, _count: { select: { productos: true } } },
  });
  const descuadradas = hojas.filter((h) => h.tamano !== h._count.productos);
  if (descuadradas.length === 0) ok('`tamano` de cada hoja coincide con sus productos');
  else mal(`hojas con tamano != productos: ${descuadradas.map((h) => `${h.id}(${h.tamano}!=${h._count.productos})`).join(', ')}`);

  const log = await prisma.registroAuditoria.findFirst({
    where: { accion: 'inventario.item_salio_de_ronda', entidadId: inv }, orderBy: { id: 'desc' },
  });
  if (log) ok('quedo el registro `inventario.item_salio_de_ronda`');
  else mal('no quedo registro de auditoria de la salida');
}

// ===========================================================================
console.log('\n== CASO 3: la hoja queda vacia -> se borra, y con ella la ronda ==');
{
  // Ahora el AUDITOR, que desde el alcance anterior tiene la misma potestad.
  const r = await corregirEnRonda1(A, malB, stockDe.get(malB), 'Recontado: cuadra', A.ses.aud.token);
  const salida = r.datos?.salioDeLaRonda;

  if (salida?.hojaBorrada) ok('la hoja quedo sin productos y se borro');
  else mal(`se esperaba hojaBorrada, llego ${JSON.stringify(salida)}`);

  if (salida?.rondaBorrada) ok('era la unica hoja: la ronda 2 desaparecio');
  else mal(`se esperaba rondaBorrada, llego ${JSON.stringify(salida)}`);

  const quedan = await prisma.hojaConteo.count({ where: { inventarioId: inv, numeroConteo: 2 } });
  if (quedan === 0) ok('no queda ninguna hoja de la ronda 2 en la base');
  else mal(`quedan ${quedan} hoja(s) de la ronda 2`);

  // El auditor ve el stock al corregir (alcance anterior): tiene que seguir viniendo.
  if (r.datos?.stockErp === stockDe.get(malB)) ok('al Auditor le sigue llegando stockErp');
  else mal(`se esperaba stockErp=${stockDe.get(malB)}, llego ${JSON.stringify(r.datos?.stockErp)}`);
}

// ===========================================================================
console.log('\n== CASO 4: con la ronda borrada, el Auditor sigue pudiendo seguir ==');
{
  const activo = (await api('GET', `/api/sucursales/${A.tienda.id}/inventarios/activo`, { token: A.ses.coord.token })).datos;
  if (activo?.estado === 'en_curso' && activo?.rondaActiva === 1) ok('el inventario sigue en_curso y la ronda activa volvio a ser la 1');
  else mal(`se esperaba en_curso / rondaActiva 1, llego ${JSON.stringify({ estado: activo?.estado, ronda: activo?.rondaActiva })}`);

  // Todo cuadra: no hay nada que recontar, asi que abrir otra ronda se rechaza
  // con el motivo del caso feliz.
  const extra = await api('POST', `/api/inventarios/${inv}/rondas/abrir`, { token: A.ses.aud.token });
  if (extra.status === 409 && /cuadraron/i.test(extra.texto)) ok('abrirRondaExtra corta con 409: ya no queda nada para recontar');
  else mal(`abrirRondaExtra: se esperaba 409 "cuadraron", llego HTTP ${extra.status} ${extra.texto.slice(0, 140)}`);

  // `iniciarAjuste` arranca de `ultimaRondaDe`: tiene que funcionar sobre la
  // ronda 1, que volvio a ser la ultima.
  const aj = await api('POST', `/api/inventarios/${inv}/ajuste/iniciar`, { token: A.ses.aud.token });
  if (aj.status === 200 && aj.datos?.ronda === 1) ok('el ajuste arranco sobre la ronda 1');
  else mal(`iniciarAjuste: se esperaba 200 ronda 1, llego HTTP ${aj.status} ${aj.texto.slice(0, 160)}`);
}

// ===========================================================================
console.log('\n== CASO 5: la ronda 2 YA empezo -> no se le saca nada a nadie ==');
{
  const B = await armarEscenario('escenario B (ronda 2 en uso)');
  const [otroA, otroB] = B.malos;

  // Se reparte la ronda 2 y se cuenta UN producto: con eso la ronda arranco.
  await api('POST', `/api/inventarios/${B.inv}/hojas/asignar`, { token: B.ses.coord.token, body: { colaboradorIds: [B.gente.cont.id] } });
  const hojasR2 = (await api('GET', `/api/hojas?alcance=mias&inventarioId=${B.inv}&ronda=2`, { token: B.ses.cont.token })).datos;
  const productos = (await api('GET', `/api/hojas/${hojasR2[0].id}/productos`, { token: B.ses.cont.token })).datos;
  const contado = productos.find((p) => p.codigo === otroA) ?? productos[0];
  await api('PUT', `/api/hojas/${hojasR2[0].id}/conteos/${contado.id}`, {
    token: B.ses.cont.token, body: { empaques: [], sueltas: 1, contadoEn: new Date().toISOString() },
  });
  ok('la ronda 2 arranco: hay un conteo cargado');

  // Se corrige el OTRO item -- el que en la ronda 2 nadie toco todavia. POR
  // RONDA, no por producto: igual no sale.
  const antes = await prisma.producto.count({ where: { codigo: otroB, hoja: { inventarioId: B.inv, numeroConteo: 2 } } });
  const r = await corregirEnRonda1(B, otroB, B.stockDe.get(otroB), 'Cuadra, pero la ronda ya empezo');

  if (r.datos?.salioDeLaRonda == null) ok('aunque ahora cuadre, NO sale: la ronda ya empezo');
  else mal(`saco un item de una ronda en uso: ${JSON.stringify(r.datos?.salioDeLaRonda)}`);

  const despues = await prisma.producto.count({ where: { codigo: otroB, hoja: { inventarioId: B.inv, numeroConteo: 2 } } });
  if (despues === antes) ok(`${otroB} sigue en la hoja de quien la esta contando`);
  else mal(`${otroB} desaparecio de una hoja en uso`);
}

// ===========================================================================
if (DEJAR) {
  info(`--dejar: quedan ${armados.map((a) => `tienda ${a.tienda.id}/inv ${a.inv}`).join(', ')}`);
} else {
  for (const { tienda, inv: invId, gente } of armados) {
    const hs = await prisma.hojaConteo.findMany({ where: { inventarioId: invId }, select: { id: true } });
    const ids = hs.map((h) => h.id);
    await prisma.lineaConteo.deleteMany({ where: { conteo: { hojaId: { in: ids } } } });
    await prisma.conteo.deleteMany({ where: { hojaId: { in: ids } } });
    await prisma.empaque.deleteMany({ where: { producto: { hojaId: { in: ids } } } });
    await prisma.producto.deleteMany({ where: { hojaId: { in: ids } } });
    await prisma.hojaConteo.deleteMany({ where: { inventarioId: invId } });
    await prisma.empaqueCatalogo.deleteMany({ where: { catalogoItem: { inventarioId: invId } } });
    await prisma.catalogoItem.deleteMany({ where: { inventarioId: invId } });
    await prisma.diferenciaItem.deleteMany({ where: { inventarioId: invId } });
    await prisma.resultadoInventario.deleteMany({ where: { inventarioId: invId } });
    await prisma.registroAuditoria.deleteMany({ where: { entidad: 'inventario', entidadId: invId } });
    await prisma.inventario.delete({ where: { id: invId } });

    const idsGente = Object.values(gente).map((g) => g.id);
    await prisma.sesionToken.deleteMany({ where: { colaboradorId: { in: idsGente } } });
    /**
     * `registro_auditoria.actor_id` es RESTRICT: lo que esta gente HIZO frena
     * el borrado de la cuenta. Hay que sacarlo antes -- y solo lo de ellos,
     * que es escenario de prueba y no el log de nadie real.
     */
    await prisma.registroAuditoria.deleteMany({ where: { actorId: { in: idsGente } } });
    await prisma.registroAuditoria.deleteMany({ where: { entidad: 'colaborador', entidadId: { in: idsGente } } });
    await prisma.colaborador.deleteMany({ where: { id: { in: idsGente } } });
    await prisma.registroAuditoria.deleteMany({ where: { entidad: 'sucursal', entidadId: tienda.id } });
    await prisma.sucursal.delete({ where: { id: tienda.id } });
    info(`escenario borrado (tienda ${tienda.id}, inventario ${invId})`);
  }
}

await prisma.$disconnect();
console.log(fallas === 0 ? '\nTODO OK.' : `\n${fallas} FALLA(S).`);
process.exit(fallas === 0 ? 0 : 1);
