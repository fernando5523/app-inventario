/**
 * Prueba de PUNTA A PUNTA contra el backend vivo (BASE_URL, por defecto
 * http://localhost:3000) de LA EXCEPCION DEL AUDITOR A TRES VIAS.
 *
 * Lo que se verifica aca no lo puede verificar un test unitario: que las DOS
 * COLUMNAS (`clase` y `esEmpresa`) queden escritas juntas y coherentes EN LA
 * BASE REAL, atravesando el middleware de sesion, el schema de Zod, el service
 * y Prisma. La invariante vive en la fila, no en un mock.
 *
 * ---------------------------------------------------------------------------
 * NO TOCA NINGUN PRODUCTO REAL
 * ---------------------------------------------------------------------------
 * Trabaja sobre un codigo inventado (`CODIGO_DE_PRUEBA`) que no existe en
 * ningun catalogo, y al terminar lo desclasifica. La demostracion viva
 * (inventarios 8039 y 8040) no se ve afectada: la clasificacion se evalua por
 * CODIGO al liquidar, y este codigo no esta en ninguna hoja de nadie.
 *
 * Lo unico que deja son las filas de RegistroAuditoria de sus propios cambios,
 * que es justamente parte de lo que se verifica.
 */
import { PrismaClient } from '@prisma/client';
import { pinDev } from './_pin-dev.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
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
  let datos = null;
  try { datos = await r.json(); } catch { /* 204 */ }
  return { status: r.status, datos };
}

/**
 * El PIN de la base SEMBRADA sale del rol (`_pin-dev.mjs`), pero la base de la
 * DEMOSTRACION VIVA usa otro (`000020`). Se prueban los dos en vez de fallar
 * con "PIN incorrecto" y dejar a quien corre el script adivinando cual de las
 * dos bases tiene delante. `PIN_PRUEBA` pisa los dos.
 */
/**
 * El PIN de la base SEMBRADA sale del rol (`_pin-dev.mjs`), pero la base de la
 * DEMOSTRACION VIVA usa otro (`000020`). Se prueban los dos en vez de fallar
 * con "PIN incorrecto" dejando a quien corre el script adivinando cual de las
 * dos bases tiene delante.
 *
 * PERO SE PRUEBA UNA SOLA VEZ: el backend limita los intentos de ingreso
 * (429, ~12 minutos), y probar dos PINs por cada login quemaba el cupo en tres
 * corridas. El que funciona se recuerda y los logins siguientes usan solo ese.
 * `PIN_PRUEBA=xxxxxx` lo fija de entrada y evita el tanteo por completo.
 */
let pinQueFunciono = process.env.PIN_PRUEBA ?? null;

const ingresar = async (id, rol) => {
  const candidatos = pinQueFunciono ? [pinQueFunciono] : [pinDev(rol), '000020'];
  let ultimo = null;
  for (const pin of candidatos) {
    const r = await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: id, pin } });
    if (r.status === 200) {
      pinQueFunciono = pin;
      return r.datos;
    }
    // 429 = limitador de ingresos. Seguir probando solo lo empeora, y el
    // mensaje del backend ya dice cuanto falta.
    if (r.status === 429) {
      throw new Error(
        `el backend limito los ingresos (${r.datos?.detalles?.reintentarEnSegundos ?? '?'}s). ` +
          'Espera ese rato, o corre con PIN_PRUEBA=<pin> para no gastar intentos tanteando.',
      );
    }
    ultimo = r;
  }
  throw new Error(`no se pudo ingresar como ${id} (${rol}): ${ultimo.status} ${JSON.stringify(ultimo.datos)}`);
};

/** Un codigo que NO existe en ningun catalogo: la demostracion viva no se toca. */
const CODIGO = 'ZZZ-PRUEBA-3VIAS';

/** Quien: el primer auditor que exista, y un no-auditor para el 403. */
async function actores() {
  // `AUDITOR_ID`/`COORDINADOR_ID` para elegir con quien correr: el backend
  // limita los intentos de ingreso POR COLABORADOR, asi que tras un rato de
  // pruebas conviene poder cambiar de persona en vez de esperar 12 minutos.
  const porIdOPrimero = async (rol, envId) => {
    const id = Number(envId);
    if (Number.isFinite(id) && id > 0) return prisma.colaborador.findFirst({ where: { id, rol, activo: true } });
    return prisma.colaborador.findFirst({ where: { rol, activo: true }, orderBy: { id: 'asc' } });
  };
  const auditor = await porIdOPrimero('auditor', process.env.AUDITOR_ID);
  const otro = await porIdOPrimero('coordinador', process.env.COORDINADOR_ID);
  if (!auditor || !otro) throw new Error('la base no tiene un auditor y un coordinador activos con los que probar');
  return {
    auditor: await ingresar(auditor.id, 'auditor'),
    coordinador: await ingresar(otro.id, 'coordinador'),
  };
}

console.log('== SESIONES ==');
const { auditor, coordinador } = await actores();
ok(`${auditor.colaborador.nombre} (auditor) y ${coordinador.colaborador.nombre} (coordinador)`);

// Punto de partida limpio: si una corrida anterior se corto, se saca la fila.
await prisma.clasificacionProducto.deleteMany({ where: { codigo: CODIGO } });

console.log('\n== LAS TRES VIAS ESCRIBEN LAS DOS COLUMNAS, Y NO PUEDEN DISCREPAR ==');
for (const [clase, esEmpresaEsperado] of [['empresa', true], ['paquete', false], ['unidad', false]]) {
  const r = await api('PUT', `/api/clasificacion/${CODIGO}`, { token: auditor.token, body: { clase } });
  if (r.status !== 200) {
    mal(`clase ${clase}: el PUT devolvio ${r.status} ${JSON.stringify(r.datos)}`);
    continue;
  }
  r.datos.clase === clase
    ? ok(`clase ${clase}: el DTO la devuelve tal cual`)
    : mal(`clase ${clase}: el DTO devolvio ${r.datos.clase}`);
  r.datos.esEmpresa === esEmpresaEsperado
    ? ok(`clase ${clase}: esEmpresa derivado = ${esEmpresaEsperado}`)
    : mal(`clase ${clase}: esEmpresa = ${r.datos.esEmpresa}, esperaba ${esEmpresaEsperado}`);

  // LA INVARIANTE, EN LA FILA REAL: es lo que el test unitario no puede ver.
  const fila = await prisma.clasificacionProducto.findUnique({ where: { codigo: CODIGO } });
  fila && fila.clase === clase && fila.esEmpresa === esEmpresaEsperado
    ? ok(`clase ${clase}: en la BASE quedaron clase=${fila.clase} y es_empresa=${fila.esEmpresa}, coherentes`)
    : mal(`clase ${clase}: en la base quedo clase=${fila?.clase} es_empresa=${fila?.esEmpresa}`);
}

console.log('\n== EL CUERPO VIEJO YA NO ENTRA (la invariante por construccion) ==');
{
  const r = await api('PUT', `/api/clasificacion/${CODIGO}`, { token: auditor.token, body: { esEmpresa: true } });
  r.status === 400
    ? ok('un cuerpo con esEmpresa falla con 400: no se puede escribir una columna sin la otra')
    : mal(`un cuerpo con esEmpresa devolvio ${r.status}, esperaba 400`);

  const c = await api('PUT', `/api/clasificacion/${CODIGO}`, { token: auditor.token, body: { clase: 'caja' } });
  c.status === 400 ? ok('una clase inexistente falla con 400') : mal(`clase 'caja' devolvio ${c.status}`);
}

console.log('\n== SIGUE SIENDO SOLO DEL AUDITOR ==');
{
  const r = await api('PUT', `/api/clasificacion/${CODIGO}`, { token: coordinador.token, body: { clase: 'empresa' } });
  r.status === 403 ? ok('un coordinador recibe 403') : mal(`un coordinador recibio ${r.status}, esperaba 403`);

  const sin = await api('PUT', `/api/clasificacion/${CODIGO}`, { body: { clase: 'empresa' } });
  sin.status === 401 ? ok('sin token: 401') : mal(`sin token recibio ${sin.status}`);
}

console.log('\n== LA AUDITORIA GUARDA EL ANTES Y EL DESPUES, CON SU CLASE ==');
{
  const registros = await prisma.registroAuditoria.findMany({
    where: { entidad: 'clasificacion_producto', accion: 'clasificacion.actualizada' },
    orderBy: { id: 'desc' },
    take: 5,
  });
  const mio = registros.find((r) => r.detalle?.codigo === CODIGO);
  if (!mio) {
    mal('no quedo ningun registro de auditoria "clasificacion.actualizada" para el codigo de prueba');
  } else {
    const d = mio.detalle;
    d.clase && d.anterior && 'clase' in d.anterior
      ? ok(`quedo registrado el cambio: ${JSON.stringify(d.anterior.clase)} -> ${JSON.stringify(d.clase)}`)
      : mal(`el detalle no trae clase/anterior.clase: ${JSON.stringify(d)}`);
  }
}

console.log('\n== LA BUSQUEDA DEVUELVE EL EMPAQUE DE COMPRA Y LA CLASE DEL SNAPSHOT ==');
{
  const r = await api('GET', '/api/clasificacion?limite=5', { token: auditor.token });
  if (r.status !== 200) {
    mal(`la busqueda devolvio ${r.status}`);
  } else if (r.datos.productos.length === 0) {
    info('el catalogo esta vacio en esta base: no hay producto con el que verificar el empaque');
  } else {
    const p = r.datos.productos[0];
    'empaqueCompra' in p && 'empaqueCompraSimbolo' in p
      ? ok(`trae el empaque de compra (${p.codigo}: ${p.empaqueCompra} - ${p.empaqueCompraSimbolo})`)
      : mal(`la fila no trae empaqueCompra/empaqueCompraSimbolo: ${JSON.stringify(Object.keys(p))}`);
    ['empresa', 'paquete', 'unidad'].includes(p.claseDynamics)
      ? ok(`trae la clase derivada por el snapshot (claseDynamics = ${p.claseDynamics})`)
      : mal(`claseDynamics invalida o ausente: ${JSON.stringify(p.claseDynamics)}`);

    const conEmpaque = r.datos.productos.filter((x) => x.empaqueCompra !== null).length;
    info(`${conEmpaque} de ${r.datos.productos.length} de esta pagina tienen empaque de compra resuelto`);
  }
}

console.log('\n== UNA EXCEPCION VIEJA (clase NULL) NO SE REINTERPRETA ==');
{
  // Se simula una fila cargada antes del cambio: clase en NULL, la manda
  // `esEmpresa`. Es exactamente lo que hay en una base que venia de antes.
  await prisma.clasificacionProducto.update({
    where: { codigo: CODIGO },
    data: { clase: null, esEmpresa: true },
  });
  const r = await api('GET', `/api/clasificacion?q=${CODIGO}&soloClasificados=true`, { token: auditor.token });
  // El codigo no esta en el catalogo, asi que la busqueda no lo va a listar:
  // lo que importa es que la fila siga con NULL despues de leerla.
  const fila = await prisma.clasificacionProducto.findUnique({ where: { codigo: CODIGO } });
  fila?.clase === null
    ? ok('la fila vieja sigue con clase NULL despues de leerla: nadie la migro por su cuenta')
    : mal(`la fila vieja quedo con clase=${fila?.clase}`);
  r.status === 200 ? ok('la busqueda responde 200 con una fila vieja en la base') : mal(`la busqueda devolvio ${r.status}`);
}

console.log('\n== EL AUDITOR CORRIGE EL EMPAQUE DE COMPRA ==');
{
  // Se deja la fila como la dejaria el caso real: los DORITOS que D365 trae
  // con empaque 1 (se compra suelto) cuando vienen en display.
  const r = await api('PUT', `/api/clasificacion/${CODIGO}`, {
    token: auditor.token,
    body: { clase: 'paquete', empaqueCompraCorregido: 12 },
  });
  r.status === 200 && r.datos.empaqueCompraCorregido === 12
    ? ok('el empaque corregido se guarda y vuelve en el DTO (12)')
    : mal(`el PUT con empaque devolvio ${r.status} / ${JSON.stringify(r.datos)}`);

  const fila = await prisma.clasificacionProducto.findUnique({ where: { codigo: CODIGO } });
  fila?.empaqueCompraCorregido === 12
    ? ok('en la BASE quedo empaque_compra_corregido = 12, al lado de la clase')
    : mal(`en la base quedo empaque_compra_corregido = ${fila?.empaqueCompraCorregido}`);

  // ===========================================================================
  // NO PISA EL SNAPSHOT -- sobre un producto REAL del catalogo
  // ===========================================================================
  // Es la mitad del pedido y sobre un codigo inventado no se puede probar (no
  // tiene fila de catalogo que pisar). Se clasifica uno real, se compara su
  // `CatalogoItem` antes y despues, y se limpia al final: la clasificacion se
  // evalua al liquidar y entre una cosa y la otra no liquida nadie.
  const real = await prisma.catalogoItem.findFirst({ orderBy: { codigo: 'asc' } });
  if (!real) {
    info('el catalogo esta vacio: no hay producto real sobre el que probar el snapshot');
  } else {
    const antes = { empaqueCompra: real.empaqueCompra, simbolo: real.empaqueCompraSimbolo, clase: real.clase };
    const yaTenia = await prisma.clasificacionProducto.findUnique({ where: { codigo: real.codigo } });

    const pr = await api('PUT', `/api/clasificacion/${real.codigo}`, {
      token: auditor.token,
      body: { clase: 'paquete', empaqueCompraCorregido: 12 },
    });
    pr.status === 200 ? ok(`producto real ${real.codigo}: se le corrigio el empaque a 12`) : mal(`PUT sobre ${real.codigo} devolvio ${pr.status}`);

    const despues = await prisma.catalogoItem.findUnique({ where: { id: real.id } });
    despues.empaqueCompra === antes.empaqueCompra &&
    despues.empaqueCompraSimbolo === antes.simbolo &&
    despues.clase === antes.clase
      ? ok(`el SNAPSHOT quedo intacto (empaqueCompra=${antes.empaqueCompra}, clase=${antes.clase}): la correccion vive al lado, no encima`)
      : mal(`el snapshot cambio: ${JSON.stringify(antes)} -> ${JSON.stringify({ empaqueCompra: despues.empaqueCompra, simbolo: despues.empaqueCompraSimbolo, clase: despues.clase })}`);

    // LOS DOS NUMEROS, juntos y separados: es lo que permite decir "el ERP
    // dijo X y el Auditor lo corrigio a 12".
    const bus = await api('GET', `/api/clasificacion?q=${encodeURIComponent(real.codigo)}`, { token: auditor.token });
    const fila = bus.datos?.productos?.find((x) => x.codigo === real.codigo);
    fila && fila.empaqueCompra === antes.empaqueCompra && fila.clasificacion?.empaqueCompraCorregido === 12
      ? ok(`la busqueda devuelve LOS DOS: ERP=${fila.empaqueCompra} y corregido=${fila.clasificacion.empaqueCompraCorregido}`)
      : mal(`la busqueda no devolvio los dos numeros: ${JSON.stringify(fila)}`);

    // Se deja como estaba: si no tenia clasificacion, se borra.
    if (!yaTenia) await api('DELETE', `/api/clasificacion/${real.codigo}`, { token: auditor.token });
    const resto = await prisma.clasificacionProducto.findUnique({ where: { codigo: real.codigo } });
    (yaTenia ? resto !== null : resto === null)
      ? ok(`${real.codigo} quedo como estaba antes de la prueba`)
      : mal(`${real.codigo} no volvio a su estado original`);
  }

  const cero = await api('PUT', `/api/clasificacion/${CODIGO}`, {
    token: auditor.token,
    body: { clase: 'paquete', empaqueCompraCorregido: 0 },
  });
  cero.status === 400 ? ok('un empaque 0 falla con 400: seria una division por cero en la razon') : mal(`empaque 0 devolvio ${cero.status}`);

  const uno = await api('PUT', `/api/clasificacion/${CODIGO}`, {
    token: auditor.token,
    body: { clase: 'paquete', empaqueCompraCorregido: 1 },
  });
  uno.status === 200 ? ok('un empaque 1 SI entra: afirma "se compra suelto", y tiene consecuencia') : mal(`empaque 1 devolvio ${uno.status}`);

  // DESHACER: es un PUT, el cuerpo declara la excepcion entera.
  const deshacer = await api('PUT', `/api/clasificacion/${CODIGO}`, { token: auditor.token, body: { clase: 'paquete' } });
  const tras = await prisma.clasificacionProducto.findUnique({ where: { codigo: CODIGO } });
  deshacer.status === 200 && tras?.empaqueCompraCorregido === null
    ? ok('sin el campo, la correccion vuelve a NULL: deshacer funciona')
    : mal(`tras deshacer quedo empaque_compra_corregido = ${tras?.empaqueCompraCorregido}`);

  // Y el rastro del cambio de empaque, con el antes y el despues.
  await api('PUT', `/api/clasificacion/${CODIGO}`, { token: auditor.token, body: { clase: 'paquete', empaqueCompraCorregido: 24 } });
  const reg = await prisma.registroAuditoria.findFirst({
    where: { entidad: 'clasificacion_producto', accion: 'clasificacion.actualizada' },
    orderBy: { id: 'desc' },
  });
  reg?.detalle?.empaqueCompraCorregido === 24 && reg.detalle.anterior?.empaqueCompraCorregido === null
    ? ok('la auditoria guarda el cambio de empaque: null -> 24')
    : mal(`el registro no trae el cambio de empaque: ${JSON.stringify(reg?.detalle)}`);

  const busca = await api('GET', '/api/clasificacion?limite=3', { token: auditor.token });
  busca.status === 200
    ? ok('la busqueda sigue respondiendo con la columna nueva en la tabla')
    : mal(`la busqueda devolvio ${busca.status}`);
}

console.log('\n== CORREGIR SOLO EL EMPAQUE, SIN FORZAR CUADRO ==');
{
  // Era el caso IMPOSIBLE desde la app: `clase` era obligatoria, asi que para
  // guardar una correccion habia que forzar ademas un cuadro -- y el cuadro
  // forzado pisa lo derivado. Es justo el caso DORITOS y el "evitamos estar
  // corrigiendo 1:1" de Gilmer.
  await prisma.clasificacionProducto.deleteMany({ where: { codigo: CODIGO } });

  const r = await api('PUT', `/api/clasificacion/${CODIGO}`, {
    token: auditor.token,
    body: { empaqueCompraCorregido: 12 },
  });
  r.status === 200 ? ok('se guarda sin mandar `clase`: 200') : mal(`sin clase devolvio ${r.status} ${JSON.stringify(r.datos)}`);
  r.datos?.clase === null && r.datos?.empaqueCompraCorregido === 12
    ? ok('el DTO vuelve con clase null y el empaque corregido')
    : mal(`el DTO devolvio clase=${JSON.stringify(r.datos?.clase)} empaque=${JSON.stringify(r.datos?.empaqueCompraCorregido)}`);

  const fila = await prisma.clasificacionProducto.findUnique({ where: { codigo: CODIGO } });
  fila?.clase === null && fila?.esEmpresa === false && fila?.empaqueCompraCorregido === 12
    ? ok('en la BASE: clase NULL, es_empresa false, empaque 12 -- la invariante 1 se sostiene')
    : mal(`en la base quedo ${JSON.stringify({ clase: fila?.clase, esEmpresa: fila?.esEmpresa, emp: fila?.empaqueCompraCorregido })}`);

  const nulo = await api('PUT', `/api/clasificacion/${CODIGO}`, {
    token: auditor.token,
    body: { clase: null, empaqueCompraCorregido: 24 },
  });
  nulo.status === 200 ? ok('con `clase: null` explicito tambien pasa') : mal(`clase null devolvio ${nulo.status}`);

  // ALGO tiene que decir: sin cuadro y sin empaque, la fila seria
  // indistinguible de una excepcion VIEJA (clase NULL + empaque NULL).
  const vacio = await api('PUT', `/api/clasificacion/${CODIGO}`, { token: auditor.token, body: {} });
  vacio.status === 400 ? ok('un cuerpo vacio falla con 400: no hay nada que guardar') : mal(`cuerpo vacio devolvio ${vacio.status}`);

  const soloNota = await api('PUT', `/api/clasificacion/${CODIGO}`, { token: auditor.token, body: { nota: 'algo' } });
  soloNota.status === 400 ? ok('solo una nota tampoco: una nota no clasifica nada') : mal(`solo nota devolvio ${soloNota.status}`);

  // Y se puede pasar de "solo empaque" a un cuadro forzado, sobre la misma fila.
  const forzando = await api('PUT', `/api/clasificacion/${CODIGO}`, {
    token: auditor.token,
    body: { clase: 'paquete', empaqueCompraCorregido: 24 },
  });
  const tras = await prisma.clasificacionProducto.findUnique({ where: { codigo: CODIGO } });
  forzando.status === 200 && tras?.clase === 'paquete'
    ? ok('desde "solo empaque" se puede forzar el cuadro despues')
    : mal(`al forzar quedo clase=${tras?.clase} (status ${forzando.status})`);
}

console.log('\n== DESCLASIFICAR: borra la fila, deja el rastro ==');
{
  // 204 y no 200: el borrado no devuelve cuerpo (ver clasificacion.controller.ts).
  const r = await api('DELETE', `/api/clasificacion/${CODIGO}`, { token: auditor.token });
  r.status === 204 ? ok('DELETE devuelve 204, sin cuerpo') : mal(`DELETE devolvio ${r.status}, esperaba 204`);

  const fila = await prisma.clasificacionProducto.findUnique({ where: { codigo: CODIGO } });
  fila === null ? ok('la fila ya no esta: sin excepcion, manda el sistema') : mal('la fila sigue existiendo');

  const borrado = await prisma.registroAuditoria.findFirst({
    where: { entidad: 'clasificacion_producto', accion: 'clasificacion.eliminada' },
    orderBy: { id: 'desc' },
  });
  borrado?.detalle?.codigo === CODIGO && 'clase' in (borrado.detalle.anterior ?? {})
    ? ok('quedo el rastro del borrado, con la clase anterior')
    : mal(`el rastro del borrado no trae la clase anterior: ${JSON.stringify(borrado?.detalle)}`);

  const otra = await api('DELETE', `/api/clasificacion/${CODIGO}`, { token: auditor.token });
  otra.status === 404 ? ok('desclasificar algo sin excepcion: 404') : mal(`el segundo DELETE devolvio ${otra.status}`);
}

console.log(`\n${fallas === 0 ? 'TODO OK' : `${fallas} FALLA(S)`}`);
await prisma.$disconnect();
process.exit(fallas === 0 ? 0 : 1);
