/**
 * EL INGRESO, de punta a punta contra el backend vivo.
 *
 * Es la puerta de toda la app: si esto se rompe, no importa que ande el resto.
 * Y tiene una regla de negocio que ya se rompio una vez (ver commit 233f4b7),
 * asi que se verifica explicitamente:
 *
 *   La lista de UNA TIENDA trae solo al PERSONAL DE TIENDA -- coordinador y
 *   conteo (ROLES_DE_TIENDA en sesion.service.ts). El auditor y el
 *   administrador NO pertenecen a ninguna tienda y entran por un grupo
 *   aparte, `/api/sesion/administradores`. Entrar por ese grupo NO da
 *   permisos de administrador: el rol sale del padron.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTE SCRIPT NO PRUEBA, A PROPOSITO
 * ---------------------------------------------------------------------------
 * EL LIMITADOR DE INTENTOS (8 cada 15 minutos por colaboradorId, ver
 * sesion.routes.ts#limitadorIngreso). Probarlo exige agotarlo, y agotarlo
 * deja a una persona REAL sin poder entrar durante 15 minutos -- en una base
 * de desarrollo compartida eso frena a quien este probando en el emulador.
 * Peor: sondear el endpoint para ver si se libero consume la misma cuota, asi
 * que "esperar a que se destrabe" no es gratis. Su prueba vive en los tests
 * de sesion.routes.test.ts, con el reloj simulado, que es donde corresponde.
 *
 * Por el mismo motivo este script gasta UN solo intento fallido, y lo gasta
 * en el colaborador que ya uso para el intento exitoso: dos de ocho.
 *
 * ---------------------------------------------------------------------------
 * USO
 * ---------------------------------------------------------------------------
 *   node scripts/verificar-login.mjs
 *   PIN=000020 node scripts/verificar-login.mjs
 *
 * El PIN entra por entorno y no se deriva de `_pin-dev.mjs` a proposito: esta
 * base tiene los PIN unificados para pruebas manuales, y el del seed ya no
 * sirve. Si algun dia se resiembra, alcanza con no pasar PIN.
 */
import { pinDev } from './_pin-dev.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const ROLES_DE_TIENDA = ['coordinador', 'conteo'];
const ROLES_SIN_TIENDA = ['auditor', 'administrador'];

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

/** La lista de un endpoint que puede venir cruda o envuelta en `datos`. */
const lista = (r) => (Array.isArray(r.datos) ? r.datos : (r.datos?.datos ?? []));

// ===========================================================================
console.log('== PASO 1: LA PANTALLA DE INGRESO CARGA SIN SESION ==');

const sucursales = await api('GET', '/api/sesion/sucursales');
if (sucursales.status !== 200) {
  mal(`/api/sesion/sucursales dio HTTP ${sucursales.status}: sin esto no se puede ni dibujar el login.`);
  process.exit(1);
}
const tiendas = lista(sucursales);
tiendas.length > 0
  ? ok(`${tiendas.length} tienda(s) listadas sin token: ${tiendas.map((t) => t.nombre).join(', ')}`)
  : mal('no hay ninguna tienda: el login no tiene que ofrecer.');

const admins = await api('GET', '/api/sesion/administradores');
admins.status === 200
  ? ok(`el grupo sin tienda carga: ${lista(admins).length} persona(s)`)
  : mal(`/api/sesion/administradores dio HTTP ${admins.status}`);

// ===========================================================================
console.log('\n== PASO 2: QUIEN APARECE EN CADA GRUPO ==');

const tienda = tiendas[0];
const gente = await api('GET', `/api/sesion/sucursales/${tienda.id}/colaboradores`);
if (gente.status !== 200) {
  mal(`colaboradores de la tienda ${tienda.id} dio HTTP ${gente.status}`);
  process.exit(1);
}
const personal = lista(gente);

const intrusos = personal.filter((c) => !ROLES_DE_TIENDA.includes(c.rol));
intrusos.length === 0
  ? ok(`"${tienda.nombre}" lista solo personal de tienda (${personal.map((c) => c.rol).join(', ')})`)
  : mal(`se colaron roles que no son de tienda: ${intrusos.map((c) => `${c.nombre} (${c.rol})`).join(', ')}`);

// El numero que muestra el login tiene que ser EL MISMO que la lista que abre.
tienda.colaboradores === personal.length
  ? ok(`el contador de la tarjeta (${tienda.colaboradores}) coincide con la lista que abre (${personal.length})`)
  : mal(`la tarjeta dice ${tienda.colaboradores} y la lista trae ${personal.length}: dos verdades para el mismo numero`);

const sinTienda = lista(admins);
const malGrupo = sinTienda.filter((c) => !ROLES_SIN_TIENDA.includes(c.rol));
malGrupo.length === 0
  ? ok(`el grupo sin tienda trae solo ${ROLES_SIN_TIENDA.join(' y ')} (${sinTienda.map((c) => c.rol).join(', ')})`)
  : mal(`el grupo sin tienda trae roles que no corresponden: ${malGrupo.map((c) => c.rol).join(', ')}`);

// El auditor es el caso que rompio 233f4b7: tiene sucursalId en su ficha pero
// NO es personal de tienda.
const idsDeTienda = new Set(personal.map((c) => c.id));
const auditores = sinTienda.filter((c) => c.rol === 'auditor');
auditores.length === 0
  ? info('no hay auditores cargados: no se puede verificar que queden fuera de la tienda.')
  : auditores.every((a) => !idsDeTienda.has(a.id))
    ? ok(`los ${auditores.length} auditor(es) estan fuera de la lista de la tienda, donde corresponde`)
    : mal('un auditor aparece en la lista de la tienda: es el bug de 233f4b7 de vuelta');

// ===========================================================================
console.log('\n== PASO 3: ENTRAR ==');

const quien = personal.find((c) => c.rol === 'conteo') ?? personal[0];
const PIN = process.env.PIN ?? pinDev(quien.rol);

const entrada = await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: quien.id, pin: PIN } });
if (entrada.status !== 200) {
  mal(`no pudo entrar ${quien.nombre} (id ${quien.id}): HTTP ${entrada.status}. Proba con PIN=<pin> node scripts/verificar-login.mjs`);
  console.log(`\n${fallas} FALLA(S).`);
  process.exit(1);
}
const sesion = entrada.datos;
ok(`entro ${sesion.colaborador.nombre} (id ${sesion.colaborador.id})`);

typeof sesion.token === 'string' && sesion.token.length > 20
  ? ok('devolvio un token')
  : mal('la sesion no trae token utilizable');

// El rol sale del PADRON, no del grupo por el que se lo eligio.
sesion.colaborador.rol === quien.rol
  ? ok(`el rol de la sesion sale del padron: "${sesion.colaborador.rol}"`)
  : mal(`el rol cambio al entrar: el padron dice "${quien.rol}" y la sesion "${sesion.colaborador.rol}"`);

sesion.sucursal?.id === tienda.id
  ? ok(`la sesion trae su tienda (${sesion.sucursal.nombre})`)
  : mal('la sesion no trae la tienda de la persona');

// ===========================================================================
console.log('\n== PASO 4: NO ENTRAR ==');

const malPin = await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: quien.id, pin: '999999' } });
malPin.status === 401
  ? ok('un PIN equivocado da 401')
  : mal(`un PIN equivocado dio HTTP ${malPin.status}, se esperaba 401`);

malPin.datos?.token === undefined
  ? ok('y no filtra ningun token')
  : mal('un ingreso rechazado devolvio un token');

/**
 * El rechazo tiene que ser INDISTINGUIBLE entre "ese id no existe" y "el PIN
 * esta mal". Si difieren, quien prueba a ciegas descubre que ids son validos
 * y le queda solo el PIN -- seis digitos, un espacio chico.
 *
 * No alcanza con mirar un mensaje y buscarle palabras: eso pasa igual aunque
 * el texto delate. Hay que COMPARAR las dos respuestas. El id inexistente
 * tiene su propio cupo en el limitador (que va por colaboradorId), asi que
 * este intento no le gasta nada a nadie.
 */
const idFantasma = await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: 999999, pin: '999999' } });
const distingue =
  idFantasma.status !== malPin.status || (idFantasma.datos?.error ?? '') !== (malPin.datos?.error ?? '');

if (!distingue) {
  ok(`un id inexistente responde igual que un PIN equivocado (${malPin.status}, mismo mensaje)`);
} else {
  /**
   * HOY ESTO NO ES UNA FUGA, y por eso es INFO y no FALLA.
   *
   * El padron de esta app es PUBLICO a proposito: la pantalla de ingreso
   * lista ids y nombres sin token (`/api/sesion/sucursales/:id/colaboradores`,
   * que este mismo script usa arriba sin autenticarse) porque el operario
   * elige su nombre de una lista, no lo tipea. Distinguir 404 de 401 no
   * regala nada que no este servido al lado sin credenciales.
   *
   * SE VUELVE UN PROBLEMA el dia que esa lista deje de ser publica -- si
   * alguna vez se pide identificarse antes de ver quien trabaja en la tienda,
   * este endpoint pasa a ser el unico que enumera el padron, y ahi los dos
   * rechazos tienen que volverse indistinguibles. Queda escrito para que
   * quien haga ese cambio se acuerde de este.
   */
  info(
    `el rechazo distingue los casos (id inexistente: ${idFantasma.status}, PIN malo: ${malPin.status}). ` +
      'No es fuga: el padron ya es publico sin token. Revisar si algun dia deja de serlo.',
  );
}

// ===========================================================================
console.log('\n== PASO 5: EL TOKEN MANDA ==');

const sinToken = await api('GET', `/api/sucursales/${tienda.id}/inventarios/activo`);
sinToken.status === 401
  ? ok('una ruta protegida sin token da 401')
  : mal(`una ruta protegida sin token dio HTTP ${sinToken.status}, se esperaba 401`);

const conToken = await api('GET', `/api/sucursales/${tienda.id}/inventarios/activo`, { token: sesion.token });
conToken.status === 200
  ? ok('la misma ruta con token responde 200')
  : mal(`la misma ruta con token dio HTTP ${conToken.status}`);

const tokenFalso = await api('GET', `/api/sucursales/${tienda.id}/inventarios/activo`, { token: 'a'.repeat(64) });
tokenFalso.status === 401
  ? ok('un token inventado da 401')
  : mal(`un token inventado dio HTTP ${tokenFalso.status}, se esperaba 401`);

// ===========================================================================
console.log('');
if (fallas === 0) {
  console.log('EL INGRESO FUNCIONA.');
  process.exit(0);
}
console.log(`${fallas} FALLA(S) EN EL INGRESO.`);
process.exit(1);
