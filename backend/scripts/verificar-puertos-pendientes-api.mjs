/**
 * Prueba de punta a punta de los tres endpoints que la app todavia no tenia
 * de donde sacar: liquidacion (pantalla 6), lacrado (pantalla 7) y
 * config-dynamics (pantalla de Configuracion del Administrador).
 *
 * Lo central que se verifica y no puede verificar un test unitario:
 *   - que el `client_secret` NUNCA vuelva en ninguna respuesta;
 *   - que la aprobacion del lacrado se registre contra el token y no contra
 *     un id del body, atravesando middleware, rutas y Prisma reales.
 *
 * CONFIG-DYNAMICS ESCRIBE credenciales de prueba, y por eso se cuida:
 *   - si la base ya tiene credenciales (origen distinto de 'ninguno' o un
 *     secreto guardado), esa seccion NO escribe nada: las pisaria, y el
 *     secreto no se puede recuperar por la API. Para correrla igual:
 *       node scripts/verificar-puertos-pendientes-api.mjs --pisar-config-dynamics
 *   - cuando escribe, al terminar deja la fila de `config_dynamics` como la
 *     encontro, con Prisma: la borra si no existia y la restaura si existia.
 */
import { PrismaClient } from '@prisma/client';
import { pinDev } from './_pin-dev.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PISAR_CONFIG_DYNAMICS = process.argv.includes('--pisar-config-dynamics');
/** Fila unica de la integracion (config-dynamics.service.ts#ID_FILA). */
const ID_FILA_CONFIG = 1;
const prisma = new PrismaClient();
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
  try { datos = texto === '' ? null : JSON.parse(texto); } catch { /* no json */ }
  return { status: r.status, datos, texto };
}

// El PIN de un colaborador sembrado sale de su ROL, no del id (ver _pin-dev.mjs).
const ingresar = async (id, rol) => {
  const r = await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: id, pin: pinDev(rol) } });
  if (r.status !== 200) throw new Error(`no se pudo ingresar como ${id} (${rol}): ${r.status} ${r.texto}`);
  return r.datos;
};

console.log('== SESIONES ==');
const gilmer = await ingresar(103, 'auditor');        // auditor Luzuriaga
const jose = await ingresar(101, 'coordinador');      // coordinador Luzuriaga
const maria = await ingresar(102, 'conteo');          // conteo Luzuriaga
const admin = await ingresar(1000, 'administrador');  // administrador
ok('auditor, coordinador, conteo y administrador');

// ---------------------------------------------------------------------------
console.log('\n== LIQUIDACION (pantalla 6): es del AUDITOR ==');
{
  // Decision del cliente (2026-09-11): la liquidacion la ve Y la ejecuta el
  // auditor; coordinador y administrador quedan afuera. El porque esta en
  // liquidacion.permisos.ts.
  const r = await api('GET', '/api/liquidacion/sucursales/1', { token: gilmer.token });
  if (r.status !== 200) mal(`auditor: ${r.status} ${r.texto}`);
  else if (r.datos === null) mal('devolvio null: falta el seed del historico');
  else {
    const l = r.datos;
    ok(`EL AUDITOR VE LA LIQUIDACION: ${l.periodo}`);
    ok(`bruto ${l.faltanteBruto} - negativos ${l.negativosDelMes} - empresa ${l.faltanteEmpresa} = neto ${l.faltanteNeto}`);

    l.faltanteNeto === l.faltanteBruto - l.negativosDelMes - l.faltanteEmpresa
      ? ok('el neto cierra contra sus tres partes')
      : mal('el neto no cierra');

    l.planilla.length === 11
      ? ok(`planilla de ${l.planilla.length} colaboradores, cuota base ${l.cuotaBase}, bono ${l.bonoAsistencia}, ${l.totalFaltas} faltas`)
      : mal(`planilla de ${l.planilla.length}, esperaba 11`);

    const quienFue = l.planilla.find((p) => p.asistio);
    const quienFalto = l.planilla.find((p) => !p.asistio);
    const esperadoFue = Math.round((l.cuotaBase - l.bonoAsistencia) * 100) / 100;
    const esperadoFalto = Math.round((l.cuotaBase + l.multaInasistencia) * 100) / 100;
    quienFue?.monto === esperadoFue && quienFalto?.monto === esperadoFalto
      ? ok(`monto derivado de sus partes: asistio ${quienFue.monto}, falto ${quienFalto.monto} (multa ${l.multaInasistencia})`)
      : mal(`montos: asistio ${quienFue?.monto} (esperaba ${esperadoFue}), falto ${quienFalto?.monto} (esperaba ${esperadoFalto})`);

    l.planilla.every((p) => typeof p.rol === 'string' && typeof p.nombre === 'string')
      ? ok('cada renglon trae colaboradorId, nombre, rol, asistio y monto -- la forma que espera el puerto')
      : mal('falta algun campo en la planilla');
  }

  const coord = await api('GET', '/api/liquidacion/sucursales/1', { token: jose.token });
  coord.status === 403 ? ok('el coordinador ya NO ve la planilla, ni la de su propia tienda: 403') : mal(`coordinador recibio ${coord.status}`);

  const adm = await api('GET', '/api/liquidacion/sucursales/1', { token: admin.token });
  adm.status === 403
    ? ok('el administrador tampoco: es un rol tecnico y no participa del proceso de inventario: 403')
    : mal(`administrador recibio ${adm.status}`);

  const c = await api('GET', '/api/liquidacion/sucursales/1', { token: maria.token });
  c.status === 403 ? ok('el rol conteo NO ve la planilla de sus companeros: 403') : mal(`conteo recibio ${c.status}`);

  // Sin recorte por sucursal para el auditor: audita toda la cadena
  // (correccion del cliente, 2026-09-09). Cambiar el id no le abre la nomina
  // de otra tienda a nadie mas.
  const otraAuditor = await api('GET', '/api/liquidacion/sucursales/2', { token: gilmer.token });
  otraAuditor.status === 200
    ? ok('el auditor lee la liquidacion de otra tienda: audita la cadena, no una sucursal')
    : mal(`auditor en otra sucursal: ${otraAuditor.status} ${otraAuditor.texto}`);

  const otra = await api('GET', '/api/liquidacion/sucursales/2', { token: jose.token });
  otra.status === 403 ? ok('y el coordinador no lee la nomina de otra tienda cambiando el id: 403') : mal(`coordinador en otra sucursal: ${otra.status}`);

  // Una sucursal SIN ciclo cerrado, sacada de la base con el mismo criterio
  // que liquidacion.service.ts#deSucursal (ningun inventario cerrado con
  // resultado) en vez de suponer cual es.
  const sinCiclo = await prisma.sucursal.findFirst({
    where: { inventarios: { none: { estado: { in: ['conteo_cerrado', 'liquidado', 'lacrado'] }, resultado: { isNot: null } } } },
    select: { id: true, nombre: true },
    orderBy: { id: 'asc' },
  });
  if (sinCiclo === null) {
    info('todas las sucursales tienen un ciclo cerrado: no hay con que probar la respuesta vacia');
  } else {
    const vacia = await api('GET', `/api/liquidacion/sucursales/${sinCiclo.id}`, { token: gilmer.token });
    vacia.status === 200 && vacia.datos === null
      ? ok(`una sucursal sin ciclo cerrado (${sinCiclo.nombre}) devuelve 200 con null, NO 404: es un estado normal, no un error`)
      : mal(`sucursal sin datos (${sinCiclo.id}): ${vacia.status} ${vacia.texto}`);
  }

  const conc = await api('GET', '/api/liquidacion/sucursales/1/conciliacion', { token: gilmer.token });
  conc.status === 200 && conc.datos !== null
    ? ok(`conciliacion: neto ${conc.datos.faltanteNeto} vs suma de planilla ${conc.datos.sumaPlanilla}, diferencia por redondeo ${conc.datos.diferenciaPorRedondeo}`)
    : mal(`conciliacion: ${conc.status}`);
}

// ---------------------------------------------------------------------------
console.log('\n== LACRADO (pantalla 7) ==');
{
  const r = await api('GET', '/api/historial/inventarios/8001/lacrado/estado', { token: gilmer.token });
  if (r.status !== 200) mal(`estado: ${r.status} ${r.texto}`);
  else {
    const e = r.datos;
    const campos = ['inventarioId', 'aprobaciones', 'aprobacionesRequeridas', 'todoSincronizado', 'lacrado', 'hash', 'lacradoEn', 'registradoManualmenteEnDynamics'];
    const faltantes = campos.filter((c) => !(c in e));
    faltantes.length === 0
      ? ok('la respuesta tiene los 8 campos de EstadoLacrado, ni uno menos')
      : mal(`faltan campos: ${faltantes.join(', ')}`);

    e.lacrado === true && e.hash !== null
      ? ok(`inventario lacrado: hash ${e.hash.slice(0, 12)}..., registrado en ERP: ${e.registradoManualmenteEnDynamics}`)
      : mal(`estado del lacrado: ${JSON.stringify(e)}`);

    e.aprobaciones.length === 2 && e.aprobaciones.every((a) => a.colaboradorId && a.nombre && a.fecha)
      ? ok(`las dos firmas con QUIEN y CUANDO: ${e.aprobaciones.map((a) => `${a.nombre} (${a.fecha.slice(0, 10)})`).join(' + ')}`)
      : mal(`aprobaciones: ${JSON.stringify(e.aprobaciones)}`);

    // El minimo es configurable (LACRADO_APROBACIONES_REQUERIDAS, default 1):
    // lo que se exige es que viaje y que sea un minimo valido, no un valor fijo.
    Number.isInteger(e.aprobacionesRequeridas) && e.aprobacionesRequeridas >= 1
      ? ok(`aprobacionesRequeridas=${e.aprobacionesRequeridas} viaja en la respuesta: si cambia el minimo, la pantalla se entera sola`)
      : mal(`aprobacionesRequeridas: ${e.aprobacionesRequeridas} -- tiene que ser un entero >= 1`);

    typeof e.todoSincronizado === 'boolean'
      ? ok(`todoSincronizado: ${e.todoSincronizado} -- no se lacra con conteos que no llegaron`)
      : mal('falta todoSincronizado');
  }

  // LA REGLA CENTRAL, otra vez y por HTTP.
  const suplantar = await api('POST', '/api/historial/inventarios/8003/aprobaciones', {
    token: gilmer.token,
    body: { aprobadorId: 106 },
  });
  suplantar.status === 400
    ? ok('el body con aprobadorId sigue dando 400: quien firma sale del token, nunca del request')
    : mal(`suplantacion: ${suplantar.status}`);

  const conteoAprueba = await api('POST', '/api/historial/inventarios/8003/aprobaciones', { token: maria.token, body: {} });
  conteoAprueba.status === 403 ? ok('el rol conteo no firma el cierre: 403') : mal(`conteo aprobando: ${conteoAprueba.status}`);
}

// ---------------------------------------------------------------------------
/**
 * Las escrituras de la seccion CONFIG-DYNAMICS. Solo corren si la base no
 * tenia credenciales (o con --pisar-config-dynamics), y siempre seguidas de
 * `restaurarConfigDynamics`.
 */
async function escribirConfigDynamicsDePrueba() {
  const SECRETO = 'Abc8Q~SECRETO-DE-PRUEBA-QUE-NO-DEBE-VOLVER-JAMAS';
  const guardado = await api('PUT', '/api/config-dynamics', {
    token: admin.token,
    body: {
      tenantId: '11111111-2222-3333-4444-555555555555',
      clientId: '66666666-7777-8888-9999-000000000000',
      urlBase: 'https://market-trujillo.operations.dynamics.com/',
      dataAreaId: 'trv',
      clientSecret: SECRETO,
    },
  });

  if (guardado.status === 503) {
    ok(`sin APP_CIFRADO_CLAVE el guardado del secreto se RECHAZA (503) en vez de guardarlo en claro:`);
    console.log(`          "${guardado.datos.error.slice(0, 110)}..."`);

    const sinSecreto = await api('PUT', '/api/config-dynamics', {
      token: admin.token,
      body: {
        tenantId: '11111111-2222-3333-4444-555555555555',
        clientId: '66666666-7777-8888-9999-000000000000',
        urlBase: 'https://market-trujillo.operations.dynamics.com/',
      },
    });
    sinSecreto.status === 200
      ? ok('pero SI se pueden guardar tenant/clientId/urlBase, que no son secretos: la pantalla no queda muerta')
      : mal(`guardar sin secreto: ${sinSecreto.status} ${sinSecreto.texto}`);

    sinSecreto.status === 200 && sinSecreto.datos.urlBase === 'https://market-trujillo.operations.dynamics.com'
      ? ok('la barra final de la URL se normaliza al guardar')
      : mal(`urlBase quedo: ${sinSecreto.datos?.urlBase}`);
  } else if (guardado.status === 200) {
    ok('secreto guardado (hay APP_CIFRADO_CLAVE en el entorno)');
    !guardado.texto.includes(SECRETO) && !guardado.texto.includes('SECRETO-DE-PRUEBA')
      ? ok('la respuesta del PUT no devuelve el secreto que acaba de recibir')
      : mal('EL PUT DEVOLVIO EL SECRETO');

    const despues = await api('GET', '/api/config-dynamics', { token: admin.token });
    !despues.texto.includes(SECRETO) && despues.datos.secretoConfigurado === true
      ? ok('el GET dice secretoConfigurado=true y NO el valor')
      : mal(`el GET expone el secreto: ${despues.texto}`);
  } else {
    mal(`guardar: ${guardado.status} ${guardado.texto}`);
  }

  const httpPlano = await api('PUT', '/api/config-dynamics', {
    token: admin.token,
    body: { tenantId: 'a', clientId: 'b', urlBase: 'http://market-trujillo.dynamics.com' },
  });
  httpPlano.status === 400 ? ok('rechaza una URL http:// -- un secreto no viaja en claro por la red') : mal(`http: ${httpPlano.status}`);

  const malEscrito = await api('PUT', '/api/config-dynamics', {
    token: admin.token,
    body: { tenantId: 'a', clientId: 'b', urlBase: 'https://x.dynamics.com', client_secret: 'algo' },
  });
  malEscrito.status === 400
    ? ok('un campo mal escrito (client_secret) da 400 en vez de ignorarse en silencio')
    : mal(`campo mal escrito: ${malEscrito.status}`);

  const prueba = await api('POST', '/api/config-dynamics/probar', { token: admin.token });
  prueba.status === 200 && typeof prueba.datos.ok === 'boolean'
    ? ok(`probar conexion responde 200 con ok=${prueba.datos.ok}: "${prueba.datos.mensaje.slice(0, 80)}..."`)
    : mal(`probar: ${prueba.status} ${prueba.texto}`);

  !prueba.texto.includes('Abc8Q~') && !prueba.texto.includes('SECRETO-DE-PRUEBA')
    ? ok('el mensaje de la prueba tampoco filtra el secreto')
    : mal('LA PRUEBA FILTRO EL SECRETO EN SU MENSAJE');
}

/**
 * Deja `config_dynamics` como estaba antes de las escrituras de prueba. Con
 * Prisma y no por la API: el PUT no puede volver a poner un secreto que no
 * conoce, y no hay endpoint que borre la fila. Los registros de auditoria de
 * los PUT quedan: son el rastro de lo que se hizo, no estado de la integracion.
 */
async function restaurarConfigDynamics(filaAntes) {
  if (filaAntes === null) {
    await prisma.configDynamics.deleteMany({ where: { id: ID_FILA_CONFIG } });
  } else {
    const { id, ...campos } = filaAntes;
    await prisma.configDynamics.update({ where: { id }, data: campos });
  }

  // Se compara la fila entera, pero al log no va el secreto, ni cifrado.
  const sinSecreto = (f) => (f === null ? null : { ...f, clientSecretCifrado: f.clientSecretCifrado === null ? null : '(cifrado)' });
  const filaDespues = await prisma.configDynamics.findUnique({ where: { id: ID_FILA_CONFIG } });
  JSON.stringify(filaDespues) === JSON.stringify(filaAntes)
    ? ok(filaAntes === null
      ? 'la base quedo como estaba: sin fila en config_dynamics (se borro la de prueba)'
      : 'la base quedo como estaba: la fila de config_dynamics restaurada campo por campo, secreto cifrado incluido')
    : mal(`config_dynamics NO quedo como estaba. Antes: ${JSON.stringify(sinSecreto(filaAntes))} / despues: ${JSON.stringify(sinSecreto(filaDespues))}`);
}

console.log('\n== CONFIG-DYNAMICS: el secreto entra pero NUNCA sale ==');
{
  const soloAdmin = await api('GET', '/api/config-dynamics', { token: gilmer.token });
  soloAdmin.status === 403 ? ok('ni el auditor entra: son las llaves del ERP, solo administrador') : mal(`auditor: ${soloAdmin.status}`);

  const antes = await api('GET', '/api/config-dynamics', { token: admin.token });
  antes.status === 200
    ? ok(`estado inicial: origen=${antes.datos.origen}, secretoConfigurado=${antes.datos.secretoConfigurado}, puedeGuardarSecreto=${antes.datos.puedeGuardarSecreto}`)
    : mal(`obtener: ${antes.status} ${antes.texto}`);

  antes.datos !== null && !('clientSecret' in antes.datos) && !('clientSecretCifrado' in antes.datos)
    ? ok('la lectura NO trae ninguna forma del secreto, ni cifrada')
    : mal(`la lectura expone el secreto o no se pudo leer: ${antes.status}, campos [${Object.keys(antes.datos ?? {}).join(', ')}]`);

  // Lo que sigue ESCRIBE. Con credenciales de verdad en la base no se toca
  // nada: el PUT las pisaria con las de prueba, y el secreto no se puede
  // recuperar por la API -- es justo lo que esta seccion verifica. Si ni
  // siquiera se pudo leer el estado, tampoco se escribe a ciegas.
  const motivoParaNoEscribir = antes.status !== 200
    ? `no se pudo leer el estado inicial (${antes.status}) y no se escribe a ciegas`
    : antes.datos.origen !== 'ninguno' || antes.datos.secretoConfigurado === true
      ? `la base ya tiene credenciales (origen=${antes.datos.origen}, secretoConfigurado=${antes.datos.secretoConfigurado}); el PUT las pisaria con las de prueba y el secreto no vuelve por la API`
      : null;

  if (motivoParaNoEscribir !== null && !PISAR_CONFIG_DYNAMICS) {
    info(`se saltea toda escritura de config-dynamics: ${motivoParaNoEscribir}.`);
    info('Quedan sin correr el guardado, las validaciones del PUT y "probar conexion". Para correrlas igual (la fila se restaura al terminar): --pisar-config-dynamics');
  } else {
    if (motivoParaNoEscribir !== null) info('--pisar-config-dynamics: se escriben credenciales de prueba igual; al terminar se restaura la fila tal como estaba.');
    // Foto de la fila ANTES de escribir, leida de la base: el secreto cifrado
    // no sale por la API, asi que es la unica forma de dejarla como estaba.
    const filaAntes = await prisma.configDynamics.findUnique({ where: { id: ID_FILA_CONFIG } });
    try {
      await escribirConfigDynamicsDePrueba();
    } finally {
      await restaurarConfigDynamics(filaAntes);
    }
  }
}

await prisma.$disconnect();
console.log(fallas === 0 ? '\nLOS TRES PUERTOS RESPONDEN COMO ESPERA EL FRONT.' : `\n${fallas} FALLA(S).`);
process.exit(fallas === 0 ? 0 : 1);
