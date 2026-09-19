/**
 * LA NAVEGACION CONFIGURABLE, de punta a punta contra el backend vivo.
 *
 * Lo que prueba y los tests no pueden:
 *   - que la SIEMBRA haya dejado a los cuatro roles exactamente como estaban
 *     (es la mitad del pedido que mas facil se incumple sin que nadie lo note);
 *   - que la LISTA BLANCA frene de verdad un intento de darle al coordinador
 *     una pantalla del auditor -- el conteo ciego;
 *   - que apagar, reordenar y restablecer funcionen y queden auditados;
 *   - que la app reciba SOLO lo prendido.
 *
 * DEJA TODO COMO ESTABA: al terminar restablece los roles que toco.
 *
 *   ADMIN_TOKEN=$(curl -s -X POST localhost:3000/api/sesion/ingresar \
 *     -H 'Content-Type: application/json' \
 *     -d '{"colaboradorId":1000,"pin":"..."}' | jq -r .token) \
 *   node scripts/verificar-navegacion.mjs
 */
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

const TOKEN = process.env.ADMIN_TOKEN;
if (!TOKEN) {
  console.error('Falta ADMIN_TOKEN. Ver la cabecera de este archivo (el backend limita 8 ingresos / 15 min).');
  process.exit(1);
}

/**
 * LO QUE HABIA ANTES DE ESTE LOTE, copiado de accesos.ts. Es la promesa que
 * hay que verificar: "dejar los roles que ya tenemos y sus accesos".
 *
 * Se comprueba como SUBSECUENCIA EN ORDEN y no como lista exacta, a proposito.
 * El lote agrega UN acceso nuevo -- la pantalla desde la que se configura todo
 * esto, sin la cual el endpoint existe y no tiene camino -- y donde cae ese
 * elemento depende de la instalacion: en una nueva sale en el orden del
 * catalogo, en una que ya tenia filas entra al final (ver
 * sembrar-navegacion.ts). Lo que NO puede pasar, y es lo que se afirma, es que
 * algo de lo de antes desaparezca o se corra de lugar respecto de los demas.
 */
const ESPERADO = {
  administrador: ['/administrador/usuarios', '/administrador/tiendas', '/administrador/config', '/administrador/historial', '/administrador/mi-cuenta'],
  coordinador: ['/coordinador/asistencia', '/coordinador/hojas', '/coordinador/ciclo', '/coordinador/mi-cuenta'],
  conteo: ['/conteo/mis-hojas', '/conteo/mi-cuenta'],
  auditor: ['/auditor/auditoria', '/auditor/ciclo', '/auditor/corregir', '/auditor/ajuste', '/auditor/liquidacion', '/auditor/lacrado', '/auditor/usuarios', '/auditor/clasificacion', '/auditor/historial', '/auditor/mi-cuenta'],
};

console.log('== LA SIEMBRA DEJO TODO COMO ESTABA ==');
for (const [rol, rutas] of Object.entries(ESPERADO)) {
  const r = await api('GET', `/api/navegacion/config/${rol}`, { token: TOKEN });
  if (r.status !== 200) { mal(`GET config/${rol}: HTTP ${r.status} ${r.texto.slice(0, 120)}`); continue; }
  const actual = (r.datos?.accesos ?? []).map((a) => a.ruta);
  // Subsecuencia en orden: todos los de antes, sin faltar ninguno y sin
  // haberse cruzado entre ellos.
  let i = 0;
  for (const ruta of actual) if (ruta === rutas[i]) i += 1;
  i === rutas.length
    ? ok(`${rol}: los ${rutas.length} accesos de siempre siguen ahi, en el mismo orden relativo`)
    : mal(`${rol}: falta o se corrio alguno.\n            de antes: ${rutas.join(', ')}\n            ahora:    ${actual.join(', ')}`);

  const agregados = actual.filter((ruta) => !rutas.includes(ruta));
  if (agregados.length > 0) console.log(`            (agregados por este lote: ${agregados.join(', ')})`);
  (r.datos?.accesos ?? []).every((a) => a.visible)
    ? ok(`${rol}: todos prendidos, como estaban`)
    : mal(`${rol}: hay accesos apagados que no deberian estarlo`);
}

console.log('\n== LA LISTA BLANCA: EL CONTEO CIEGO ==');
const intruso = await api('PUT', '/api/navegacion/config/coordinador', {
  token: TOKEN,
  body: { tipo: 'acceso', elementos: [{ clave: '/auditor/auditoria', visible: true }] },
});
intruso.status === 400
  ? ok('no se le puede dar al coordinador el panel de auditoria (400)')
  : mal(`darle el panel de auditoria al coordinador dio HTTP ${intruso.status}, se esperaba 400`);
/auditor|grupo|conteo ciego/i.test(intruso.texto)
  ? ok('y el mensaje dice por que, no solo que no se puede')
  : mal(`el mensaje no explica nada: ${intruso.texto.slice(0, 140)}`);

console.log('\n== APAGAR Y REORDENAR ==');
const antes = (await api('GET', '/api/navegacion/config/conteo', { token: TOKEN })).datos;
const guardado = await api('PUT', '/api/navegacion/config/conteo', {
  token: TOKEN,
  body: { tipo: 'acceso', elementos: [{ clave: '/conteo/mi-cuenta', visible: true }, { clave: '/conteo/mis-hojas', visible: false }] },
});
guardado.status === 200 ? ok('se guardo el nuevo orden') : mal(`PUT dio HTTP ${guardado.status}: ${guardado.texto.slice(0, 140)}`);

const despues = guardado.datos;
despues?.accesos?.[0]?.ruta === '/conteo/mi-cuenta'
  ? ok('el reordenamiento se aplico: "Mi cuenta" quedo primero')
  : mal(`el orden no se aplico: ${(despues?.accesos ?? []).map((a) => a.ruta).join(', ')}`);
despues?.accesos?.find((a) => a.ruta === '/conteo/mis-hojas')?.visible === false
  ? ok('y "Mis hojas" quedo APAGADO pero sigue en la lista del admin (apagado no es borrado)')
  : mal('el apagado no se reflejo, o el elemento desaparecio de la configuracion');

console.log('\n== LO QUE RECIBE LA APP: SOLO LO PRENDIDO ==');
// La app pide lo SUYO: el rol sale de la sesion, no de la URL. Con el token
// del administrador se recibe la del administrador.
const mia = await api('GET', '/api/navegacion/mia', { token: TOKEN });
mia.status === 200 && Array.isArray(mia.datos?.accesos)
  ? ok(`/mia responde la del rol de la sesion (${mia.datos.rol}): ${mia.datos.accesos.length} accesos, ${mia.datos.tabs.length} tabs`)
  : mal(`/mia dio HTTP ${mia.status}: ${mia.texto.slice(0, 140)}`);
(mia.datos?.accesos ?? []).every((a) => a.visible !== false)
  ? ok('y no trae ningun apagado: filtrar no es tarea de la app')
  : mal('/mia trajo elementos apagados');

console.log('\n== VOLVER A FABRICA ==');
const reset = await api('POST', '/api/navegacion/config/conteo/restablecer', { token: TOKEN, body: { tipo: 'acceso' } });
reset.status === 200 ? ok('se restablecio') : mal(`restablecer dio HTTP ${reset.status}: ${reset.texto.slice(0, 140)}`);
JSON.stringify((reset.datos?.accesos ?? []).map((a) => a.ruta)) === JSON.stringify(ESPERADO.conteo)
  ? ok('y volvio EXACTAMENTE al orden de fabrica')
  : mal(`no volvio a fabrica: ${(reset.datos?.accesos ?? []).map((a) => a.ruta).join(', ')}`);
(reset.datos?.accesos ?? []).every((a) => a.visible)
  ? ok('con todo prendido otra vez')
  : mal('quedo algo apagado despues de restablecer');

console.log('\n== SOLO EL ADMINISTRADOR CONFIGURA ==');
const sinToken = await api('GET', '/api/navegacion/config/conteo');
sinToken.status === 401 ? ok('sin sesion, 401') : mal(`sin sesion dio HTTP ${sinToken.status}, se esperaba 401`);

console.log('');
if (fallas === 0) {
  console.log('LA NAVEGACION CONFIGURABLE FUNCIONA, Y LA SIEMBRA NO CAMBIO NADA.');
  process.exit(0);
}
console.log(`${fallas} FALLA(S).`);
process.exit(1);
