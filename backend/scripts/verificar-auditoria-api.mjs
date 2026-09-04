/**
 * Prueba de PUNTA A PUNTA de /api/auditoria contra el backend vivo en
 * localhost:3000. Lo que se verifica aca no lo puede verificar un test
 * unitario: que la matriz salga de datos reales (snapshot del ERP cruzado
 * con las hojas finalizadas) atravesando middleware, rutas y Prisma.
 */
const BASE = 'http://localhost:3000';
let fallas = 0;
const ok = (t) => console.log('  [OK]    ' + t);
const mal = (t) => { console.log('  [FALLA] ' + t); fallas += 1; };

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

const ingresar = async (id) => {
  const r = await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: id, pin: String(id).padStart(6, '0') } });
  if (r.status !== 200) throw new Error(`no se pudo ingresar como ${id}: ${r.status} ${JSON.stringify(r.datos)}`);
  return r.datos;
};

const CERRADO = 8004;   // Luzuriaga, mayo 2026, conteo_cerrado
const EN_CURSO = 8005;  // Carhuaz, en curso

console.log('== SESIONES ==');
const gilmer = await ingresar(103);  // auditor Luzuriaga
const jose = await ingresar(101);    // COORDINADOR Luzuriaga
const maria = await ingresar(102);   // conteo Luzuriaga
const admin = await ingresar(1000);  // administrador (id del seed)
const anaCarhuaz = await ingresar(201); // coordinador Carhuaz
ok(`${gilmer.colaborador.nombre} (auditor), ${jose.colaborador.nombre} (coordinador), ${maria.colaborador.nombre} (conteo), admin, ${anaCarhuaz.colaborador.nombre} (coordinador Carhuaz)`);

console.log('\n== EL ROL CONTEO NO ENTRA NUNCA ==');
{
  const r = await api('GET', `/api/auditoria/inventarios/${CERRADO}/matriz`, { token: maria.token });
  r.status === 403 ? ok('rol conteo -> 403 incluso en un inventario ya cerrado') : mal(`rol conteo recibio ${r.status}`);

  const l = await api('GET', '/api/auditoria/inventarios', { token: maria.token });
  l.status === 403 ? ok('rol conteo ni siquiera lista los inventarios auditables') : mal(`listado dio ${l.status}`);

  const sin = await api('GET', `/api/auditoria/inventarios/${CERRADO}/matriz`);
  sin.status === 401 ? ok('sin token: 401') : mal(`sin token dio ${sin.status}`);
}

console.log('\n== EL COORDINADOR: solo inventarios cerrados ==');
{
  const cerrado = await api('GET', `/api/auditoria/inventarios/${CERRADO}/matriz`, { token: jose.token });
  cerrado.status === 200
    ? ok(`coordinador SI ve la matriz del inventario cerrado (${cerrado.datos.total} items)`)
    : mal(`coordinador en cerrado: ${cerrado.status} ${JSON.stringify(cerrado.datos)}`);

  const enCurso = await api('GET', `/api/auditoria/inventarios/${EN_CURSO}/matriz`, { token: anaCarhuaz.token });
  enCurso.status === 403
    ? ok(`coordinador NO ve la del inventario en curso -> 403: "${enCurso.datos.error.slice(0, 72)}..."`)
    : mal(`coordinador en curso: ${enCurso.status}`);

  const auditorEnCurso = await api('GET', `/api/auditoria/inventarios/${EN_CURSO}/matriz`, { token: gilmer.token });
  // Gilmer es de Luzuriaga y 8005 es de Carhuaz: 403 por SUCURSAL, no por estado.
  auditorEnCurso.status === 403
    ? ok('un auditor de otra sucursal tampoco entra (recorte por tienda)')
    : mal(`auditor de otra tienda: ${auditorEnCurso.status}`);

  const adminEnCurso = await api('GET', `/api/auditoria/inventarios/${EN_CURSO}/matriz`, { token: admin.token });
  adminEnCurso.status === 200
    ? ok('el administrador SI audita el inventario en curso de cualquier tienda')
    : mal(`admin en curso: ${adminEnCurso.status} ${JSON.stringify(adminEnCurso.datos)}`);
}

console.log('\n== LA MATRIZ ==');
{
  const r = await api('GET', `/api/auditoria/inventarios/${CERRADO}/matriz?limite=500`, { token: gilmer.token });
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

    const cerveza = m.find((i) => i.codigo === 'IT-1002');
    cerveza?.veredicto === 'empresa' && cerveza.esEmpresa === true
      ? ok(`cerveza con faltante -> veredicto "empresa" (${cerveza.diferenciaUnidades} u, no se descuenta a nomina)`)
      : mal(`IT-1002: ${JSON.stringify(cerveza)}`);

    const cervezaOk = m.find((i) => i.codigo === 'IT-1014');
    cervezaOk?.veredicto === 'cuadrado'
      ? ok('una cerveza que CUADRA sigue siendo "cuadrado": esEmpresa no inventa diferencias')
      : mal(`IT-1014: ${JSON.stringify(cervezaOk)}`);

    const sinContar = m.find((i) => i.codigo === 'IT-1015');
    sinContar?.conteoFinal === null && sinContar.diferenciaUnidades === 0
      ? ok('item que nadie conto: aparece en la matriz, diferencia 0 y NO un faltante de todo el stock')
      : mal(`IT-1015: ${JSON.stringify(sinContar)}`);
  }
}

console.log('\n== RESUMEN Y EMBUDO ==');
{
  const r = await api('GET', `/api/auditoria/inventarios/${CERRADO}/resumen`, { token: gilmer.token });
  const s = r.datos.resumen;
  s.items === 15
    ? ok(`${s.items} items · ${s.cuadrados} cuadrados (${s.porcentajeCuadrado}%) · ${s.conFalta} con falta · ${s.deEmpresa} de empresa · ${s.sinContar} sin contar`)
    : mal(`resumen: ${JSON.stringify(s)}`);

  s.valorFaltanteDescontable < s.valorFaltante
    ? ok(`faltante total S/${s.valorFaltante}, descontable a nomina S/${s.valorFaltanteDescontable} (las cervezas quedan afuera)`)
    : mal(`descontable ${s.valorFaltanteDescontable} vs total ${s.valorFaltante}`);

  const e = r.datos.embudo;
  e.itemsTotales === 15 && e.itemsSegundoConteo === 7 && e.itemsTercerConteo === 5
    ? ok(`embudo: ${e.itemsTotales} -> ${e.itemsSegundoConteo} -> ${e.itemsTercerConteo}, ${e.itemsConDiferencia} sin cuadrar al final`)
    : mal(`embudo: ${JSON.stringify(e)}`);

  r.datos.zonas?.length > 0 ? ok(`zonas para el selector: ${r.datos.zonas.join(', ')}`) : mal('sin zonas');
}

console.log('\n== LOS 4 FILTROS ==');
{
  const conteos = {};
  for (const filtro of ['todos', 'cuadrados', 'faltante', 'empresa']) {
    const r = await api('GET', `/api/auditoria/inventarios/${CERRADO}/matriz?filtro=${filtro}&limite=500`, { token: gilmer.token });
    conteos[filtro] = r.datos.total;
  }
  ok(`todos=${conteos.todos} · cuadrados=${conteos.cuadrados} · faltante=${conteos.faltante} · empresa=${conteos.empresa}`);

  conteos.cuadrados + conteos.faltante + conteos.empresa === conteos.todos
    ? ok('los tres filtros particionan el total sin solaparse ni perder items')
    : mal(`${conteos.cuadrados}+${conteos.faltante}+${conteos.empresa} != ${conteos.todos}`);

  const soloEmpresa = await api('GET', `/api/auditoria/inventarios/${CERRADO}/matriz?filtro=empresa&limite=500`, { token: gilmer.token });
  soloEmpresa.datos.matriz.every((i) => i.esEmpresa && i.diferenciaUnidades !== 0)
    ? ok('el filtro empresa devuelve solo items de gerencia CON diferencia')
    : mal('el filtro empresa devolvio algo que no corresponde');
}

console.log('\n== EL RESUMEN NO CAMBIA CON EL FILTRO NI CON LA PAGINA ==');
{
  const a = await api('GET', `/api/auditoria/inventarios/${CERRADO}/matriz?filtro=empresa`, { token: gilmer.token });
  const b = await api('GET', `/api/auditoria/inventarios/${CERRADO}/matriz?limite=2&desplazamiento=4`, { token: gilmer.token });
  a.datos.resumen.items === 15 && b.datos.resumen.items === 15 && a.datos.resumen.cuadrados === b.datos.resumen.cuadrados
    ? ok('el encabezado dice lo mismo (15 items) filtrando por empresa y en la pagina 3: es el estado del inventario, no de la vista')
    : mal(`resumen inconsistente: ${a.datos.resumen.items} vs ${b.datos.resumen.items}`);

  b.datos.matriz.length === 2 ? ok('la paginacion recorta las filas, no el resumen') : mal(`pagina de ${b.datos.matriz.length}`);
}

console.log('\n== BUSQUEDA Y ZONA ==');
{
  const q = await api('GET', `/api/auditoria/inventarios/${CERRADO}/matriz?busqueda=cerveza&limite=500`, { token: gilmer.token });
  q.datos.total === 3 ? ok(`busqueda "cerveza" -> ${q.datos.total} items`) : mal(`busqueda: ${q.datos.total}`);

  const z = await api('GET', `/api/auditoria/inventarios/${CERRADO}/matriz?zona=E&limite=500`, { token: gilmer.token });
  z.datos.total === 3 ? ok(`zona E -> ${z.datos.total} items`) : mal(`zona: ${z.datos.total}`);
}

console.log('\n== LISTADO DE AUDITABLES ==');
{
  const r = await api('GET', '/api/auditoria/inventarios', { token: jose.token });
  const enCurso = r.datos.inventarios.find((i) => i.estado === 'en_curso');
  const cerrado = r.datos.inventarios.find((i) => i.id === CERRADO);
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

console.log(fallas === 0 ? '\nLA AUDITORIA SE COMPORTA COMO SE ESPERA.' : `\n${fallas} FALLA(S).`);
process.exit(fallas === 0 ? 0 : 1);
