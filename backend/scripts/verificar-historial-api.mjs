/**
 * Prueba de PUNTA A PUNTA contra el backend vivo en localhost:3000.
 * Lo que se verifica aca no se puede verificar con un test unitario: que la
 * identidad de quien firma salga del TOKEN y no del body, atravesando el
 * middleware de sesion, las rutas y el service reales.
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
  try { datos = await r.json(); } catch { /* 204 */ }
  return { status: r.status, datos };
}

const ingresar = async (id) => {
  const r = await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: id, pin: String(id).padStart(6, '0') } });
  if (r.status !== 200) throw new Error(`no se pudo ingresar como ${id}: ${r.status} ${JSON.stringify(r.datos)}`);
  return r.datos;
};

console.log('== SESIONES ==');
const gilmer = await ingresar(103);   // auditor Luzuriaga
const rosa = await ingresar(106);     // auditor Luzuriaga
const maria = await ingresar(102);    // rol conteo, Luzuriaga
const nilda = await ingresar(203);    // auditor de OTRA sucursal (Carhuaz)
ok(`${gilmer.colaborador.nombre} (${gilmer.colaborador.rol}), ${rosa.colaborador.nombre}, ${maria.colaborador.nombre} (${maria.colaborador.rol}), ${nilda.colaborador.nombre} (Carhuaz)`);

console.log('\n== CONTEO CIEGO: quien entra al historico ==');
{
  const r = await api('GET', '/api/historial/inventarios', { token: gilmer.token });
  r.status === 200 ? ok(`auditor lista el historico: ${r.datos.total} inventarios`) : mal(`auditor recibio ${r.status}`);

  const c = await api('GET', '/api/historial/inventarios', { token: maria.token });
  c.status === 403 ? ok('rol conteo recibe 403: la regla de conteo ciego se sostiene') : mal(`rol conteo recibio ${c.status}, esperaba 403`);

  const sin = await api('GET', '/api/historial/inventarios');
  sin.status === 401 ? ok('sin token: 401') : mal(`sin token recibio ${sin.status}`);
}

console.log('\n== ALCANCE POR SUCURSAL ==');
{
  const r = await api('GET', '/api/historial/inventarios?sucursalId=1', { token: nilda.token });
  const deOtra = (r.datos.inventarios ?? []).filter((i) => i.sucursalId !== 2);
  deOtra.length === 0
    ? ok('un auditor de Carhuaz pidiendo sucursalId=1 NO ve datos de Luzuriaga (se ignora el filtro)')
    : mal(`filtro ignorado mal: vio ${deOtra.length} inventarios ajenos`);

  const d = await api('GET', '/api/historial/inventarios/8001', { token: nilda.token });
  d.status === 403 ? ok('detalle de un inventario ajeno: 403') : mal(`detalle ajeno devolvio ${d.status}`);
}

console.log('\n== DETALLE E HISTORICO ==');
let inventarioDemo;
{
  const r = await api('GET', '/api/historial/inventarios/8001', { token: gilmer.token });
  inventarioDemo = r.datos;
  r.status === 200 ? ok(`detalle de ${r.datos.periodo}: estado=${r.datos.estado}, folio=${r.datos.lacrado?.folio}`) : mal(`detalle devolvio ${r.status}`);
  r.datos.resultado?.itemsCuadrados === 7870
    ? ok(`derivados calculados, no columnas: itemsCuadrados=7870, cuota=${r.datos.resultado.cuotaBase}, neto=${r.datos.resultado.montoFaltanteNeto}`)
    : mal(`itemsCuadrados = ${r.datos.resultado?.itemsCuadrados}, esperaba 7870`);
  r.datos.aprobaciones?.length === 2
    ? ok(`dos firmas con identidad: ${r.datos.aprobaciones.map((a) => `${a.aprobadorNombre}/${a.rolAlAprobar}`).join(' + ')}`)
    : mal(`hay ${r.datos.aprobaciones?.length} aprobaciones`);

  const v = await api('GET', '/api/historial/inventarios/8001/lacrado/verificacion', { token: gilmer.token });
  v.datos.intacto === true
    ? ok(`verificacion del sello: INTACTO (hash ${v.datos.hashGuardado.slice(0, 12)}...)`)
    : mal(`el sello no verifica: ${JSON.stringify(v.datos.seccionesAlteradas)}`);

  const dif = await api('GET', '/api/historial/inventarios/8001/diferencias?tipo=faltante', { token: gilmer.token });
  dif.status === 200 ? ok(`diferencias paginadas: ${dif.datos.total} faltantes, peor = ${dif.datos.diferencias[0]?.codigo} (${dif.datos.diferencias[0]?.diferencia})`) : mal(`diferencias: ${dif.status}`);

  const liq = await api('GET', '/api/historial/inventarios/8001/liquidacion', { token: gilmer.token });
  const carla = liq.datos.planilla?.find((p) => p.nombre === 'Carla Depaz');
  const luis = liq.datos.planilla?.find((p) => p.nombre === 'Luis Shuan');
  carla?.totalDescuento === 118.86 && luis?.totalDescuento === 146.36
    ? ok(`planilla con los numeros del mockup: asistio ${carla.totalDescuento}, falto ${luis.totalDescuento}`)
    : mal(`planilla: asistio ${carla?.totalDescuento} (esperaba 118.86), falto ${luis?.totalDescuento} (esperaba 146.36)`);

  const item = await api('GET', '/api/historial/items/IT-1001', { token: gilmer.token });
  // Aparece en los 3 periodos cerrados: eso es exactamente lo que el cliente
  // queria poder ver -- un articulo que da faltante TODOS los meses no es un
  // error de conteo, es merma sistematica o robo.
  item.datos.resumen?.veces === 3 && item.datos.resumen.vecesFaltante === 3
    ? ok(`historico por articulo: IT-1001 dio faltante ${item.datos.resumen.vecesFaltante}/3 meses, ${item.datos.resumen.unidadesFaltantes} unidades y S/${Math.abs(item.datos.resumen.montoAcumulado)} acumulados`)
    : mal(`historico del item: ${JSON.stringify(item.datos.resumen)}`);

  const comp = await api('GET', '/api/historial/comparativo?sucursalId=1', { token: gilmer.token });
  comp.datos.serie?.length >= 2
    ? ok(`comparativo entre periodos: ${comp.datos.serie.map((s) => `${s.periodo} (${s.variacionFaltantePct ?? 'base'}%)`).join(' -> ')}`)
    : mal(`comparativo: ${JSON.stringify(comp.datos)}`);
}

console.log('\n== INMUTABILIDAD VIA API ==');
{
  const r = await api('POST', '/api/historial/inventarios/8001/lacrado', { token: gilmer.token, body: {} });
  r.status === 409 ? ok(`re-lacrar un inventario ya lacrado: 409 -- "${r.datos.error.slice(0, 60)}..."`) : mal(`re-lacrado devolvio ${r.status}`);

  const a = await api('POST', '/api/historial/inventarios/8001/aprobaciones', { token: gilmer.token, body: {} });
  a.status === 409 ? ok('aprobar un inventario lacrado: 409') : mal(`aprobar lacrado devolvio ${a.status}`);
}

console.log('\n== EL CONTROL DE DOS PERSONAS, VIA HTTP ==');
{
  // El inventario en curso (el de d365) sirve para probar el rechazo por estado.
  const lista = await api('GET', '/api/historial/inventarios?estado=en_curso', { token: gilmer.token });
  const enCurso = lista.datos.inventarios?.[0];
  if (enCurso) {
    const r = await api('POST', `/api/historial/inventarios/${enCurso.id}/aprobaciones`, { token: gilmer.token, body: {} });
    r.status === 409 ? ok(`no se firma un inventario todavia en curso: 409`) : mal(`aprobar en_curso devolvio ${r.status}`);
  }

  // LO CENTRAL: el body no puede declarar quien firma.
  const suplantacion = await api('POST', '/api/historial/inventarios/8003/aprobaciones', {
    token: gilmer.token,
    body: { aprobadorId: 106 }, // Gilmer intentando firmar como Rosa
  });
  suplantacion.status === 400
    ? ok(`Gilmer mandando aprobadorId=106 (Rosa) -> 400 RECHAZADO, no ignorado en silencio`)
    : mal(`suplantacion devolvio ${suplantacion.status}: ${JSON.stringify(suplantacion.datos)}`);

  const conRol = await api('POST', '/api/historial/inventarios/8003/aprobaciones', {
    token: maria.token,
    body: { rolAlAprobar: 'auditor' }, // rol conteo intentando declararse auditor
  });
  conRol.status === 403 || conRol.status === 400
    ? ok(`rol conteo declarando rolAlAprobar=auditor -> ${conRol.status}, el rol sale del token`)
    : mal(`declarar rol devolvio ${conRol.status}`);
}

console.log('');
console.log('== CAMINO FELIZ: DOS FIRMAS, DOS SESIONES, UN LACRADO ==');
{
  const ID = 8003; // agosto 2026, liquidado y sin firmar
  const yaLacrado = (await api('GET', `/api/historial/inventarios/${ID}`, { token: gilmer.token })).datos.estado === 'lacrado';

  if (yaLacrado) {
    console.log('  (ya lacrado por una corrida anterior; correr `npx tsx prisma/limpiar-historial-demo.ts && npm run prisma:seed-historial` para repetir)');
  } else {
    const f1 = await api('POST', `/api/historial/inventarios/${ID}/aprobaciones`, { token: gilmer.token, body: {} });
    f1.status === 201 && f1.datos.aprobadorId === 103
      ? ok(`firma 1 desde la sesion de Gilmer -> registrada contra el id ${f1.datos.aprobadorId} (${f1.datos.aprobadorNombre}), rol "${f1.datos.rolAlAprobar}", listoParaLacrar=${f1.datos.listoParaLacrar}`)
      : mal(`firma 1: ${f1.status} ${JSON.stringify(f1.datos)}`);

    const repetida = await api('POST', `/api/historial/inventarios/${ID}/aprobaciones`, { token: gilmer.token, body: {} });
    repetida.status === 409
      ? ok(`Gilmer intentando dar TAMBIEN la segunda firma -> 409: "${repetida.datos.error.slice(0, 68)}..."`)
      : mal(`segunda firma del mismo: ${repetida.status}`);

    const sinPar = await api('POST', `/api/historial/inventarios/${ID}/lacrado`, { token: gilmer.token, body: {} });
    sinPar.status === 409
      ? ok(`lacrar con UNA sola firma -> 409: "${sinPar.datos.error.slice(0, 68)}..."`)
      : mal(`lacrado con una firma: ${sinPar.status}`);

    const f2 = await api('POST', `/api/historial/inventarios/${ID}/aprobaciones`, {
      token: rosa.token,
      body: { nota: 'Revisado contra el reporte de Jocelyn.' },
    });
    f2.status === 201 && f2.datos.aprobadorId === 106 && f2.datos.listoParaLacrar === true
      ? ok(`firma 2 desde la sesion de Rosa -> id ${f2.datos.aprobadorId} (${f2.datos.aprobadorNombre}), listoParaLacrar=true`)
      : mal(`firma 2: ${f2.status} ${JSON.stringify(f2.datos)}`);

    const lac = await api('POST', `/api/historial/inventarios/${ID}/lacrado`, { token: gilmer.token, body: {} });
    lac.status === 201
      ? ok(`LACRADO: folio ${lac.datos.folio}, hash ${lac.datos.hash.slice(0, 12)}..., firmado por ${lac.datos.aprobadoPor.map((a) => a.nombre).join(' + ')}`)
      : mal(`lacrado: ${lac.status} ${JSON.stringify(lac.datos)}`);

    const v = await api('GET', `/api/historial/inventarios/${ID}/lacrado/verificacion`, { token: gilmer.token });
    v.datos.intacto === true ? ok('el sello recien creado verifica INTACTO') : mal(`verificacion: ${JSON.stringify(v.datos)}`);

    const det = await api('GET', `/api/historial/inventarios/${ID}`, { token: gilmer.token });
    det.datos.estado === 'lacrado' && det.datos.abierto === false
      ? ok('el inventario quedo estado=lacrado y libero la sucursal (abierto=false)')
      : mal(`estado post-lacrado: ${det.datos.estado}, abierto=${det.datos.abierto}`);

    const erp = await api('POST', `/api/historial/inventarios/${ID}/lacrado/registro-erp`, {
      token: gilmer.token,
      body: { referencia: 'AJ-2026-08-0221' },
    });
    erp.status === 201
      ? ok(`registro MANUAL en Dynamics (fase 2) anotado: ${erp.datos.referencia}`)
      : mal(`registro erp: ${erp.status} ${JSON.stringify(erp.datos)}`);
  }
}

console.log(fallas === 0 ? '\nTODO EL FLUJO HTTP SE COMPORTA COMO SE ESPERA.' : `\n${fallas} FALLA(S).`);
process.exit(fallas === 0 ? 0 : 1);
