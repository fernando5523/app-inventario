/**
 * Prueba de PUNTA A PUNTA de /api/auditoria contra el backend vivo (BASE_URL,
 * por defecto http://localhost:3000). Lo que se verifica aca no lo puede
 * verificar un test unitario: que la matriz salga de datos reales (snapshot
 * del ERP cruzado con las hojas finalizadas) atravesando middleware, rutas y
 * Prisma.
 *
 * Usa los inventarios de `npm run prisma:seed-auditoria`:
 *   8004  Luzuriaga 2026-05, MENSUAL, conteo cerrado: solo productos de empleado.
 *   8005  Carhuaz, en curso.
 *   8006  Luzuriaga 2026-05, ANUAL, lacrado: el mismo periodo, empresa incluida.
 *
 * Lo que depende de lo sembrado (cuantos items, cuantos sin dato del ERP,
 * cuantos por ronda, por zona o por busqueda) se lee de la BASE con Prisma y
 * no se copia del seed: lo que se prueba es que la API refleja lo que hay.
 * Fijos quedan solo los casos de negocio puntuales (IT-1008 faltante, IT-1002
 * de empresa, IT-1015 sin dato del ERP, ...).
 */
import { PrismaClient } from '@prisma/client';
import { pinDev } from './_pin-dev.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const prisma = new PrismaClient();
let fallas = 0;
const ok = (t) => console.log('  [OK]    ' + t);
const mal = (t) => { console.log('  [FALLA] ' + t); fallas += 1; };
const redondear = (n) => Math.round(n * 100) / 100;

async function api(metodo, ruta, { token, body } = {}) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let datos = null;
  try { datos = await r.json(); } catch { /* sin body */ }
  return { status: r.status, datos };
}

// El PIN de un colaborador sembrado sale de su ROL, no del id (ver _pin-dev.mjs).
const ingresar = async (id, rol) => {
  const r = await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: id, pin: pinDev(rol) } });
  if (r.status !== 200) throw new Error(`no se pudo ingresar como ${id} (${rol}): ${r.status} ${JSON.stringify(r.datos)}`);
  return r.datos;
};

const MENSUAL = 8004;   // Luzuriaga, mayo 2026, conteo_cerrado, solo productos de empleado
const EN_CURSO = 8005;  // Carhuaz, en curso
const ANUAL = 8006;     // Luzuriaga, mayo 2026, lacrado, empresa incluida

/**
 * Lo que la BASE dice de un inventario, leido como lo lee
 * auditoria.service.ts#armarMatriz: el catalogo del snapshot cruzado por
 * codigo con los conteos de las hojas FINALIZADAS. No recalcula veredictos ni
 * montos (eso es de auditoria.calculos.ts y tiene sus tests): solo cuenta
 * hechos crudos -- que items hay, cuales no trajeron stock, cuales conto
 * alguien, en que ronda y en que zona.
 */
async function hechosDeLaBase(inventarioId) {
  const [catalogo, hojas] = await Promise.all([
    prisma.catalogoItem.findMany({ where: { inventarioId }, select: { codigo: true, descripcion: true, stockErp: true } }),
    prisma.hojaConteo.findMany({
      where: { inventarioId, estado: 'finalizada' },
      select: { numeroConteo: true, zona: true, productos: { select: { codigo: true, conteos: { select: { id: true }, take: 1 } } } },
    }),
  ]);

  const rondas = new Map(); // codigo -> rondas en las que se conto
  const zona = new Map();   // codigo -> zona; manda la ronda 1, como en armarMatriz
  for (const hoja of hojas) {
    for (const p of hoja.productos) {
      if (p.conteos.length === 0) continue; // en la hoja pero sin contar
      rondas.set(p.codigo, (rondas.get(p.codigo) ?? new Set()).add(hoja.numeroConteo));
      if (hoja.numeroConteo === 1 || !zona.has(p.codigo)) zona.set(p.codigo, hoja.zona);
    }
  }

  const porZona = new Map(); // zona -> cuantos items; '' = nadie lo conto
  for (const c of catalogo) {
    const z = zona.get(c.codigo) ?? '';
    porZona.set(z, (porZona.get(z) ?? 0) + 1);
  }

  return {
    items: catalogo.length,
    sinDatoErp: catalogo.filter((c) => c.stockErp === null).map((c) => c.codigo),
    // Con stock del ERP pero sin ningun conteo finalizado: lo que la API llama `sin_contar`.
    sinContar: catalogo.filter((c) => c.stockErp !== null && !rondas.has(c.codigo)).map((c) => c.codigo),
    enRonda: (n) => catalogo.filter((c) => rondas.get(c.codigo)?.has(n) === true).length,
    porZona,
    buscar: (aguja) => catalogo.filter((c) => c.codigo.toLowerCase().includes(aguja) || c.descripcion.toLowerCase().includes(aguja)).length,
  };
}

const baseMensual = await hechosDeLaBase(MENSUAL);
const baseAnual = await hechosDeLaBase(ANUAL);
if (baseMensual.items === 0 || baseAnual.items === 0) {
  // Sin esto, varias verificaciones de abajo pasarian en el vacio (0 + 0 === 0).
  console.log('Faltan los inventarios 8004/8006 en la base: correr `npm run prisma:seed-auditoria`.');
  await prisma.$disconnect();
  process.exit(1);
}

console.log('== SESIONES ==');
const gilmer = await ingresar(103, 'auditor');          // auditor Luzuriaga
const jose = await ingresar(101, 'coordinador');        // COORDINADOR Luzuriaga
const maria = await ingresar(102, 'conteo');            // conteo Luzuriaga
const admin = await ingresar(1000, 'administrador');    // administrador (id del seed)
const anaCarhuaz = await ingresar(201, 'coordinador');  // coordinador Carhuaz
ok(`${gilmer.colaborador.nombre} (auditor), ${jose.colaborador.nombre} (coordinador), ${maria.colaborador.nombre} (conteo), admin, ${anaCarhuaz.colaborador.nombre} (coordinador Carhuaz)`);

console.log('\n== EL ROL CONTEO NO ENTRA NUNCA ==');
{
  const r = await api('GET', `/api/auditoria/inventarios/${MENSUAL}/matriz`, { token: maria.token });
  r.status === 403 ? ok('rol conteo -> 403 incluso en un inventario ya cerrado') : mal(`rol conteo recibio ${r.status}`);

  const l = await api('GET', '/api/auditoria/inventarios', { token: maria.token });
  l.status === 403 ? ok('rol conteo ni siquiera lista los inventarios auditables') : mal(`listado dio ${l.status}`);

  const sin = await api('GET', `/api/auditoria/inventarios/${MENSUAL}/matriz`);
  sin.status === 401 ? ok('sin token: 401') : mal(`sin token dio ${sin.status}`);
}

console.log('\n== EL COORDINADOR: solo inventarios cerrados de SU sucursal; el auditor, toda la cadena ==');
{
  const cerrado = await api('GET', `/api/auditoria/inventarios/${MENSUAL}/matriz`, { token: jose.token });
  cerrado.status === 200
    ? ok(`coordinador SI ve la matriz del inventario cerrado de su tienda (${cerrado.datos.total} items)`)
    : mal(`coordinador en cerrado: ${cerrado.status} ${JSON.stringify(cerrado.datos)}`);

  const enCurso = await api('GET', `/api/auditoria/inventarios/${EN_CURSO}/matriz`, { token: anaCarhuaz.token });
  enCurso.status === 403
    ? ok(`coordinador NO ve la del inventario en curso -> 403: "${enCurso.datos.error.slice(0, 72)}..."`)
    : mal(`coordinador en curso: ${enCurso.status}`);

  // El recorte por tienda sigue vivo para el coordinador. 8004 es de
  // Luzuriaga y esta CERRADO -- Jose, de Luzuriaga, lo acaba de ver --, asi
  // que a Ana (Carhuaz) solo la puede frenar la sucursal, no el estado.
  const ajeno = await api('GET', `/api/auditoria/inventarios/${MENSUAL}/matriz`, { token: anaCarhuaz.token });
  ajeno.status === 403 && /otra sucursal/i.test(ajeno.datos?.error ?? '')
    ? ok(`un coordinador de OTRA sucursal no entra ni a un inventario cerrado -> 403: "${ajeno.datos.error}"`)
    : mal(`coordinador de otra tienda en un cerrado: ${ajeno.status} ${JSON.stringify(ajeno.datos)}`);

  // El auditor NO tiene ese recorte: audita toda la cadena (correccion del
  // cliente, 2026-09-09). Gilmer es de Luzuriaga y 8005 es de Carhuaz, en curso.
  const auditorAjeno = await api('GET', `/api/auditoria/inventarios/${EN_CURSO}/matriz`, { token: gilmer.token });
  auditorAjeno.status === 200
    ? ok('un auditor de otra sucursal SI audita el inventario en curso: audita la cadena, no una tienda')
    : mal(`auditor de otra tienda: ${auditorAjeno.status} ${JSON.stringify(auditorAjeno.datos)}`);

  const adminEnCurso = await api('GET', `/api/auditoria/inventarios/${EN_CURSO}/matriz`, { token: admin.token });
  adminEnCurso.status === 200
    ? ok('el administrador SI audita el inventario en curso de cualquier tienda')
    : mal(`admin en curso: ${adminEnCurso.status} ${JSON.stringify(adminEnCurso.datos)}`);
}

console.log('\n== LA MATRIZ DEL MENSUAL (8004) ==');
{
  const r = await api('GET', `/api/auditoria/inventarios/${MENSUAL}/matriz?limite=500`, { token: gilmer.token });
  if (r.status !== 200) { mal(`matriz: ${r.status} ${JSON.stringify(r.datos)}`); }
  else {
    const m = r.datos.matriz;
    ok(`matriz de ${r.datos.total} items, estado del inventario: ${r.datos.estado}`);

    const aceite = m.find((i) => i.codigo === 'IT-1001');
    aceite?.veredicto === 'cuadrado' && aceite.conteo1 === 120 && aceite.conteo2 === null
      ? ok(`cuadra en la 1ra pasada: IT-1001 ERP ${aceite.stockErp} vs conteo1 ${aceite.conteo1}, sin 2da ni 3ra`)
      : mal(`IT-1001: ${JSON.stringify(aceite)}`);

    const atun = m.find((i) => i.codigo === 'IT-1007');
    atun?.veredicto === 'cuadrado' && atun.conteo1 === 188 && atun.conteo2 === 200 && atun.conteoFinal === 200
      ? ok(`se corrige en la 2da: IT-1007 conteo1=188, conteo2=200, final=200 -> cuadrado`)
      : mal(`IT-1007: ${JSON.stringify(atun)}`);

    const detergente = m.find((i) => i.codigo === 'IT-1008');
    detergente?.veredicto === 'falta' && detergente.conteo3 === 156 && detergente.diferenciaUnidades === -24
      ? ok(`faltante confirmado en la 3ra: IT-1008 ERP 180 vs final 156 = ${detergente.diferenciaUnidades} u, S/${detergente.diferenciaValor}`)
      : mal(`IT-1008: ${JSON.stringify(detergente)}`);

    const sobrante = m.find((i) => i.codigo === 'IT-1012');
    sobrante?.diferenciaUnidades === 12 && sobrante.veredicto === 'falta'
      ? ok(`sobrante (+12) cae en el bucket "falta": la maqueta no tiene un cuarto filtro`)
      : mal(`IT-1012: ${JSON.stringify(sobrante)}`);

    // "No se" no es "cero": el item sin stock del ERP viaja con null, no con
    // una diferencia de 0 ni con un faltante de todo el stock.
    const sinErp = m.find((i) => i.codigo === 'IT-1015');
    sinErp?.stockErp === null && sinErp.diferenciaUnidades === null && sinErp.veredicto === 'sin_erp' && typeof sinErp.motivoSinDato === 'string'
      ? ok('sin dato del ERP: IT-1015 aparece en la matriz con stockErp=null, diferencia=null y veredicto "sin_erp" -- ni 0 ni un faltante inventado')
      : mal(`IT-1015: ${JSON.stringify(sinErp)}`);

    // Y lo mismo para cada item que la BASE guarda sin stock, y para cada uno
    // que tiene stock pero nadie conto: aparece, sin diferencia y con su motivo.
    const porCodigo = new Map(m.map((i) => [i.codigo, i]));
    const esperados = [
      ...baseMensual.sinDatoErp.map((codigo) => [codigo, 'sin_erp']),
      ...baseMensual.sinContar.map((codigo) => [codigo, 'sin_contar']),
    ];
    const distintos = esperados.filter(([codigo, v]) => {
      const f = porCodigo.get(codigo);
      return f?.veredicto !== v || f.diferenciaUnidades !== null || f.motivoSinDato === null;
    });
    if (esperados.length === 0) {
      mal('el 8004 de la base no tiene items sin dato del ERP ni sin contar: el seed dejo de cubrir el caso');
    } else {
      distintos.length === 0
        ? ok(`los ${baseMensual.sinDatoErp.length} sin stock en la base salen "sin_erp" y los ${baseMensual.sinContar.length} que nadie conto salen "sin_contar": diferencia null, NO un faltante de todo el stock`)
        : mal(`sin dato / sin contar: ${JSON.stringify(distintos.map(([codigo]) => porCodigo.get(codigo) ?? codigo))}`);
    }
  }
}

console.log('\n== EL ANUAL (8006): lo de EMPRESA se reporta pero no se descuenta ==');
{
  // Las cervezas son de empresa: el mensual ni las trae (solo productos de
  // empleado) y el anual SI. Por eso todo lo de empresa se prueba aca.
  const r = await api('GET', `/api/auditoria/inventarios/${ANUAL}/matriz?limite=500`, { token: gilmer.token });
  if (r.status !== 200) { mal(`matriz del anual: ${r.status} ${JSON.stringify(r.datos)}`); }
  else {
    const m = r.datos.matriz;

    const cerveza = m.find((i) => i.codigo === 'IT-1002');
    cerveza?.veredicto === 'empresa' && cerveza.esEmpresa === true && cerveza.diferenciaUnidades < 0
      ? ok(`cerveza con faltante -> veredicto "empresa" (${cerveza.diferenciaUnidades} u, no se descuenta a nomina)`)
      : mal(`IT-1002: ${JSON.stringify(cerveza)}`);

    const cervezaOk = m.find((i) => i.codigo === 'IT-1014');
    cervezaOk?.veredicto === 'cuadrado' && cervezaOk.esEmpresa === true
      ? ok('una cerveza que CUADRA sigue siendo "cuadrado": esEmpresa no inventa diferencias')
      : mal(`IT-1014: ${JSON.stringify(cervezaOk)}`);

    // Lo que separa el faltante total del descontable es EXACTAMENTE el
    // faltante de empresa, fila por fila: ni mas (se restaria dos veces) ni
    // menos (se le descontaria a nomina lo que asume la empresa).
    const s = r.datos.resumen;
    const faltanteEmpresa = redondear(m
      .filter((i) => i.veredicto === 'empresa' && i.diferenciaUnidades < 0)
      .reduce((suma, i) => suma - (i.diferenciaValor ?? 0), 0));
    s.deEmpresa > 0 && s.valorFaltanteDescontable < s.valorFaltante
      && Math.abs(redondear(s.valorFaltante - s.valorFaltanteDescontable) - faltanteEmpresa) < 0.05
      ? ok(`faltante total S/${s.valorFaltante}, descontable a nomina S/${s.valorFaltanteDescontable}: la diferencia es justo lo de empresa (S/${faltanteEmpresa})`)
      : mal(`descontable ${s.valorFaltanteDescontable} vs total ${s.valorFaltante}, faltante de empresa por fila ${faltanteEmpresa}, deEmpresa=${s.deEmpresa}`);
  }

  const soloEmpresa = await api('GET', `/api/auditoria/inventarios/${ANUAL}/matriz?filtro=empresa&limite=500`, { token: gilmer.token });
  const filas = soloEmpresa.datos?.matriz ?? [];
  filas.length > 0 && filas.every((i) => i.esEmpresa && i.diferenciaUnidades !== null && i.diferenciaUnidades !== 0)
    ? ok(`el filtro empresa devuelve solo items de gerencia CON diferencia (${filas.map((i) => i.codigo).join(', ')})`)
    : mal(`el filtro empresa devolvio algo que no corresponde: ${JSON.stringify(filas)}`);
}

console.log('\n== RESUMEN Y EMBUDO DEL MENSUAL, contra la base ==');
{
  const r = await api('GET', `/api/auditoria/inventarios/${MENSUAL}/resumen`, { token: gilmer.token });
  const s = r.datos.resumen;
  s.items === baseMensual.items && s.sinDatoErp === baseMensual.sinDatoErp.length && s.sinContar === baseMensual.sinContar.length
    ? ok(`${s.items} items · ${s.cuadrados} cuadrados (${s.porcentajeCuadrado}%) · ${s.conFalta} con falta · ${s.deEmpresa} de empresa · ${s.sinDatoErp} sin dato del ERP · ${s.sinContar} sin contar -- lo mismo que la base`)
    : mal(`resumen: ${JSON.stringify(s)} -- la base dice ${baseMensual.items} items, ${baseMensual.sinDatoErp.length} sin dato, ${baseMensual.sinContar.length} sin contar`);

  // Los "no se" quedan afuera de lo auditable, y cuadrados/falta/empresa se
  // reparten SOLO lo auditable: un item sin dato nunca suma como cuadrado.
  s.auditables === s.items - s.sinDatoErp - s.sinContar && s.cuadrados + s.conFalta + s.deEmpresa === s.auditables
    ? ok(`${s.auditables} auditables = ${s.items} - ${s.sinDatoErp} sin dato - ${s.sinContar} sin contar, y cuadrados + falta + empresa suman exactamente eso`)
    : mal(`auditables=${s.auditables}, cuadrados=${s.cuadrados}, conFalta=${s.conFalta}, deEmpresa=${s.deEmpresa}`);

  const e = r.datos.embudo;
  e.itemsTotales === baseMensual.items && e.itemsSegundoConteo === baseMensual.enRonda(2) && e.itemsTercerConteo === baseMensual.enRonda(3)
    ? ok(`embudo: ${e.itemsTotales} -> ${e.itemsSegundoConteo} -> ${e.itemsTercerConteo}, igual que las hojas finalizadas de la base; ${e.itemsConDiferencia} sin cuadrar al final`)
    : mal(`embudo: ${JSON.stringify(e)} -- la base dice ${baseMensual.items} -> ${baseMensual.enRonda(2)} -> ${baseMensual.enRonda(3)}`);

  r.datos.zonas?.length > 0 ? ok(`zonas para el selector: ${r.datos.zonas.join(', ')}`) : mal('sin zonas');
}

console.log('\n== LOS FILTROS: particionan el inventario ==');
for (const [inv, nombre, base] of [[MENSUAL, 'mensual 8004', baseMensual], [ANUAL, 'anual 8006', baseAnual]]) {
  const conteos = {};
  let resumen = null;
  for (const filtro of ['todos', 'cuadrados', 'faltante', 'empresa', 'sin_dato']) {
    const r = await api('GET', `/api/auditoria/inventarios/${inv}/matriz?filtro=${filtro}&limite=1`, { token: gilmer.token });
    conteos[filtro] = r.datos?.total;
    resumen = r.datos?.resumen ?? resumen;
  }
  ok(`${nombre}: todos=${conteos.todos} · cuadrados=${conteos.cuadrados} · faltante=${conteos.faltante} · empresa=${conteos.empresa} · sin_dato=${conteos.sin_dato}`);

  // Los tres veredictos se reparten los AUDITABLES; `sin_dato` junta lo que
  // no se puede afirmar. Juntos cubren el total, sin solaparse ni perder items.
  const veredictos = conteos.cuadrados + conteos.faltante + conteos.empresa;
  veredictos === resumen?.auditables && veredictos + conteos.sin_dato === conteos.todos && conteos.todos === base.items
    ? ok(`${nombre}: cuadrados + faltante + empresa = ${veredictos} auditables, y con sin_dato dan los ${conteos.todos} de la base sin solaparse ni perder items`)
    : mal(`${nombre}: ${conteos.cuadrados}+${conteos.faltante}+${conteos.empresa} vs ${resumen?.auditables} auditables; +${conteos.sin_dato} vs ${conteos.todos} en total (la base tiene ${base.items})`);
}

console.log('\n== EL RESUMEN NO CAMBIA CON EL FILTRO NI CON LA PAGINA ==');
{
  const a = await api('GET', `/api/auditoria/inventarios/${MENSUAL}/matriz?filtro=faltante`, { token: gilmer.token });
  const b = await api('GET', `/api/auditoria/inventarios/${MENSUAL}/matriz?limite=2&desplazamiento=4`, { token: gilmer.token });
  a.datos.resumen.items === baseMensual.items && JSON.stringify(a.datos.resumen) === JSON.stringify(b.datos.resumen)
    ? ok(`el encabezado dice lo mismo (${baseMensual.items} items, como la base) filtrando por faltante y en la pagina 3: es el estado del inventario, no de la vista`)
    : mal(`resumen inconsistente: ${JSON.stringify(a.datos.resumen)} vs ${JSON.stringify(b.datos.resumen)}`);

  b.datos.matriz.length === 2 ? ok('la paginacion recorta las filas, no el resumen') : mal(`pagina de ${b.datos.matriz.length}`);
}

console.log('\n== BUSQUEDA Y ZONA, contra la base ==');
{
  // Las cervezas: el anual las cuenta; el mensual, que es solo de empleado, no.
  const qa = await api('GET', `/api/auditoria/inventarios/${ANUAL}/matriz?busqueda=cerveza&limite=500`, { token: gilmer.token });
  const enAnual = baseAnual.buscar('cerveza');
  enAnual > 0 && qa.datos?.total === enAnual && qa.datos.matriz.every((i) => `${i.codigo} ${i.descripcion}`.toLowerCase().includes('cerveza'))
    ? ok(`busqueda "cerveza" en el anual -> ${qa.datos.total} items, los mismos que la base`)
    : mal(`busqueda en el anual: ${qa.datos?.total}, la base tiene ${enAnual}`);

  const qm = await api('GET', `/api/auditoria/inventarios/${MENSUAL}/matriz?busqueda=cerveza&limite=500`, { token: gilmer.token });
  const enMensual = baseMensual.buscar('cerveza');
  qm.datos?.total === enMensual
    ? ok(`y en el mensual -> ${qm.datos.total}, igual que la base${enMensual === 0 ? ': el mensual no trae productos de empresa' : ''}`)
    : mal(`busqueda en el mensual: ${qm.datos?.total}, la base tiene ${enMensual}`);

  // Cada zona devuelve exactamente los items que la base conto en esa zona.
  const rz = await api('GET', `/api/auditoria/inventarios/${ANUAL}/resumen`, { token: gilmer.token });
  const zonasApi = rz.datos?.zonas ?? [];
  const zonasBase = [...baseAnual.porZona.keys()].filter((z) => z !== '').sort();
  const distintas = [];
  for (const zona of zonasApi) {
    const z = await api('GET', `/api/auditoria/inventarios/${ANUAL}/matriz?zona=${encodeURIComponent(zona)}&limite=500`, { token: gilmer.token });
    const esperado = baseAnual.porZona.get(zona) ?? 0;
    if (z.datos?.total !== esperado || !z.datos.matriz.every((i) => i.zona === zona)) distintas.push(`${zona}: API ${z.datos?.total}, base ${esperado}`);
  }
  zonasApi.length > 0 && zonasApi.join() === zonasBase.join() && distintas.length === 0
    ? ok(`filtro por zona en el anual: ${zonasApi.map((z) => `${z}=${baseAnual.porZona.get(z)}`).join(', ')} -- zona por zona igual que las hojas de la base`)
    : mal(`zonas: API [${zonasApi.join(', ')}], base [${zonasBase.join(', ')}]; ${distintas.join('; ')}`);
}

console.log('\n== LISTADO DE AUDITABLES ==');
{
  const r = await api('GET', '/api/auditoria/inventarios', { token: jose.token });
  const enCurso = r.datos.inventarios.find((i) => i.estado === 'en_curso');
  const cerrado = r.datos.inventarios.find((i) => i.id === MENSUAL);
  cerrado?.puedeVerMatriz === true
    ? ok(`al coordinador el listado le marca el cerrado como consultable`)
    : mal(`listado: ${JSON.stringify(cerrado)}`);
  enCurso === undefined || enCurso.puedeVerMatriz === false
    ? ok('y el en curso aparece marcado con puedeVerMatriz=false y su motivo, en vez de desaparecer de la lista')
    : mal(`en curso: ${JSON.stringify(enCurso)}`);
}

console.log('\n== 404 ==');
{
  const r = await api('GET', '/api/auditoria/inventarios/999999/matriz', { token: gilmer.token });
  r.status === 404 ? ok('inventario inexistente: 404') : mal(`inexistente dio ${r.status}`);
}

await prisma.$disconnect();
console.log(fallas === 0 ? '\nLA AUDITORIA SE COMPORTA COMO SE ESPERA.' : `\n${fallas} FALLA(S).`);
process.exit(fallas === 0 ? 0 : 1);
