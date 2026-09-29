/**
 * LA DESCARGA DE STOCK DE UN RECONTEO, CONTRA EL BACKEND VIVO Y EL DYNAMICS REAL.
 *
 * `POST /api/inventarios/:id/rondas/:n/stock` -- ver la cabecera de
 * `src/modules/d365/d365.stock-ronda.service.ts` para el cambio de negocio.
 *
 * NO CONFUNDIR CON `verificar-stock-por-ronda-api.mjs`, que es del mismo cambio
 * y mide la otra mitad: aquel verifica que el CALCULO lea bien el stock por
 * ronda (la migracion de datos, la matriz del Auditor, la tabla de la cadena);
 * este verifica que la DESCARGA lo escriba bien (el `$filter` por lista de
 * codigos contra el tenant real, el conjunto que arrastra la ronda, la
 * idempotencia y cuanto tarda). De ahi el `-descarga` en el nombre.
 *
 * Los tests de vitest cubren las reglas con Prisma y D365 mockeados. Esto cubre
 * lo que ningun mock puede: que el `$filter` por lista de codigos SEA una
 * consulta valida para el tenant real, que los codigos que devuelve sean los
 * que arrastra la ronda, y CUANTO TARDA de verdad. El numero medido va a la
 * cabecera del service -- una estimacion escrita ahi seria peor que nada.
 *
 * ---------------------------------------------------------------------------
 * POR QUE TOCA EL ESTADO DEL INVENTARIO, Y COMO LO DEVUELVE
 * ---------------------------------------------------------------------------
 * El inventario de desarrollo (8078, Market Luzuriaga, almacen MD01_LUZ) esta
 * en `ajuste_auditor`, y el endpoint rechaza ese estado a proposito: con el
 * ajuste final empezado no hay ninguna ronda mas que preparar. Para medir hace
 * falta que este `en_curso`, asi que este script lo pasa a `en_curso`, mide, y
 * lo DEVUELVE a `ajuste_auditor` en un `finally`. Son dos UPDATE de una columna
 * sobre una fila, sin borrar nada.
 *
 * Lo que SI deja escrito son las filas de `stock_rondas` de la ronda que midio
 * -- que es justamente lo que se vino a verificar. Con `--limpiar` las borra al
 * terminar.
 *
 * Uso:
 *   node scripts/verificar-stock-por-ronda.mjs            # mide y deja el stock escrito
 *   node scripts/verificar-stock-por-ronda.mjs --limpiar  # y despues lo borra
 *   INVENTARIO=8078 RONDA=4 node scripts/verificar-stock-por-ronda.mjs
 */
import { execFileSync } from 'node:child_process';
import { pinDev } from './_pin-dev.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const INVENTARIO = Number(process.env.INVENTARIO ?? 8078);
const RONDA = Number(process.env.RONDA ?? 4);
const LIMPIAR = process.argv.includes('--limpiar');

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

/**
 * SQL contra la base de desarrollo, para lo que no tiene endpoint: el estado del
 * inventario y las filas que quedaron escritas. Va por `prisma db execute` en
 * vez de un cliente propio para no tener que leer `.env` desde acá.
 */
const RAIZ = new URL('..', import.meta.url).pathname;

function sql(consulta) {
  execFileSync('npx', ['prisma', 'db', 'execute', '--stdin', '--schema', 'prisma/schema.prisma'], {
    cwd: RAIZ,
    input: consulta,
    stdio: ['pipe', 'ignore', 'inherit'],
  });
}

/**
 * Una consulta que DEVUELVE filas: `db execute` no las imprime, así que va por
 * Prisma. `JSON.stringify` con un reemplazo para los `bigint` que salen de un
 * `count(*)` -- `JSON` no los serializa y el error que da no nombra la columna.
 */
function consultar(consulta) {
  const salida = execFileSync('npx', ['tsx', '-e', `
    import { prisma } from './src/config/database';
    prisma.$queryRawUnsafe(${JSON.stringify(consulta)})
      .then((f) => { console.log('FILAS' + JSON.stringify(f, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))); })
      .catch((e) => { console.error(e.message); process.exit(1); })
      .finally(() => prisma.$disconnect());
  `], { cwd: RAIZ, encoding: 'utf8' });
  const linea = salida.split('\n').find((l) => l.startsWith('FILAS'));
  if (linea === undefined) throw new Error(`la consulta no devolvio filas:\n${consulta}\n${salida}`);
  return JSON.parse(linea.slice('FILAS'.length));
}

/**
 * LA RONDA 1 DE UN INVENTARIO NUEVO, que es la mitad del cambio que NO pasa por
 * el endpoint de la descarga: la escribe `crearSnapshot` en la misma transaccion
 * que `catalogo_items`.
 *
 * Arma su propia tienda y su propio inventario y los borra al terminar: sin eso
 * habria que pisar un inventario de otro, y este es justamente el caso que solo
 * se ve en uno RECIEN creado (la migracion de datos cubre los que ya estaban).
 *
 * `modo: 'ejemplo'` a proposito: lo que se verifica es la ESCRITURA, no la
 * conversacion con Dynamics -- esa ya la cubre el resto del script, y bajar el
 * catalogo real de 11.863 items para esto costaria minutos.
 */
async function verificarRonda1DeUnInventarioNuevo() {
  console.log('\n== LA RONDA 1 DE UN INVENTARIO NUEVO (la escribe el snapshot) ==');
  const admin = (await api('POST', '/api/sesion/ingresar', {
    body: { colaboradorId: 1000, pin: pinDev('administrador') },
  })).datos;
  if (!admin?.token) { mal('no se pudo entrar como administrador'); return; }

  const marca = Date.now().toString().slice(-6);
  const tienda = (await api('POST', '/api/tiendas', {
    token: admin.token, body: { nombre: `Market StockR1 ${marca}`, almacenId: 'MD01_LUZ' },
  })).datos;
  if (!Number.isInteger(tienda?.id)) { mal('no se pudo crear la tienda de prueba'); return; }

  let inventarioId;
  try {
    const snap = (await api('POST', '/api/d365/snapshot', {
      token: admin.token, body: { sucursalId: tienda.id, modo: 'ejemplo' },
    })).datos;
    inventarioId = snap?.inventarioId;
    if (!Number.isInteger(inventarioId)) { mal('el snapshot no devolvio inventarioId'); return; }

    const [fila] = consultar(
      `SELECT count(*)::int AS filas,
              count(DISTINCT tomado_en)::int AS instantes,
              min(tomado_en)::text AS tomado_en
         FROM stock_rondas WHERE inventario_id = ${inventarioId} AND numero_conteo = 1`,
    );
    fila.filas === snap.items
      ? ok(`inventario ${inventarioId}: ${fila.filas} fila(s) de ronda 1, igual que los ${snap.items} items del catalogo`)
      : mal(`el catalogo tiene ${snap.items} items y stock_rondas ${fila.filas} filas de ronda 1`);

    fila.instantes === 1
      ? ok('un solo `tomado_en` para toda la ronda 1')
      : mal(`hay ${fila.instantes} instantes distintos en la ronda 1`);

    // LA MISMA CIFRA QUE `catalogo_items.stock_erp`, NULL incluido: son la misma
    // cifra y de las dos manda esa (ver stockDeLaMedicion).
    const [discrepan] = consultar(
      `SELECT count(*)::int AS n
         FROM catalogo_items ci
         FULL JOIN stock_rondas sr
           ON sr.inventario_id = ci.inventario_id AND sr.codigo = ci.codigo AND sr.numero_conteo = 1
        WHERE COALESCE(ci.inventario_id, sr.inventario_id) = ${inventarioId}
          AND (ci.codigo IS NULL OR sr.codigo IS NULL OR ci.stock_erp IS DISTINCT FROM sr.stock_erp)`,
    );
    discrepan.n === 0
      ? ok('cada fila coincide con `catalogo_items.stock_erp`, NULL incluido -- ningun 0 inventado')
      : mal(`${discrepan.n} item(s) no coinciden entre catalogo_items y stock_rondas`);

    // Y el `tomado_en` es el del snapshot, no un now() por fila.
    const [inv] = consultar(`SELECT snapshot_tomado_en::text AS ts FROM inventarios WHERE id = ${inventarioId}`);
    String(inv.ts) === String(fila.tomado_en)
      ? ok('`tomado_en` es el del snapshot, no un now() por fila')
      : mal(`tomado_en ${fila.tomado_en} != snapshot_tomado_en ${inv.ts}`);
  } finally {
    if (Number.isInteger(inventarioId)) {
      sql(`DELETE FROM stock_rondas WHERE inventario_id = ${inventarioId};`);
      sql(`DELETE FROM empaques_catalogo WHERE catalogo_item_id IN (SELECT id FROM catalogo_items WHERE inventario_id = ${inventarioId});`);
      sql(`DELETE FROM catalogo_items WHERE inventario_id = ${inventarioId};`);
      sql(`DELETE FROM registro_auditoria WHERE entidad = 'inventario' AND entidad_id = ${inventarioId};`);
      sql(`DELETE FROM inventarios WHERE id = ${inventarioId};`);
    }
    sql(`DELETE FROM sucursales WHERE id = ${tienda.id};`);
    info('tienda e inventario de prueba borrados');
  }
}

console.log(`\n== ESCENARIO: inventario ${INVENTARIO}, conteo ${RONDA}, contra ${BASE} ==`);

const [inv] = consultar(
  `SELECT i.id, i.estado::text AS estado, i.ultima_ronda_cerrada, s.almacen_id, s.nombre
     FROM inventarios i JOIN sucursales s ON s.id = i.sucursal_id WHERE i.id = ${INVENTARIO}`,
);
if (!inv) { mal(`no existe el inventario ${INVENTARIO}`); process.exit(1); }
info(`${inv.nombre} · almacen ${inv.almacen_id} · estado ${inv.estado} · ultima ronda cerrada ${inv.ultima_ronda_cerrada}`);

const [coord] = consultar(
  `SELECT c.id FROM colaboradores c
     WHERE c.rol = 'coordinador'
       AND c.sucursal_id = (SELECT sucursal_id FROM inventarios WHERE id = ${INVENTARIO})
     ORDER BY c.id LIMIT 1`,
);
if (!coord) { mal('no hay coordinador en esa tienda'); process.exit(1); }
const coordId = coord.id;

const sesion = (await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: coordId, pin: pinDev('coordinador') } })).datos;
if (!sesion?.token) { mal(`no se pudo entrar como coordinador ${coordId}`); process.exit(1); }
ok(`sesion de coordinador ${coordId}`);

const estadoOriginal = inv.estado;
let limpiar = () => {};
try {
  // ------------------------------------------------------------------ RONDA 1
  console.log('\n== LA RONDA 1 SE RECHAZA CON SU EXPLICACION ==');
  {
    const r = await api('POST', `/api/inventarios/${INVENTARIO}/rondas/1/stock`, { token: sesion.token });
    const dice = /snapshot/i.test(r.datos?.error ?? '');
    r.status === 400 && dice
      ? ok(`400 · "${(r.datos.error ?? '').slice(0, 110)}..."`)
      : mal(`esperaba 400 nombrando el snapshot; llego ${r.status} ${r.texto.slice(0, 200)}`);
  }

  // ------------------------------------- EL ESTADO, PARA PODER MEDIR DE VERDAD
  if (estadoOriginal !== 'en_curso') {
    console.log(`\n== EL AJUSTE YA EMPEZO: se rechaza, y despues se pasa a en_curso para medir ==`);
    const r = await api('POST', `/api/inventarios/${INVENTARIO}/rondas/${RONDA}/stock`, { token: sesion.token });
    r.status === 409 && /ajuste final/i.test(r.datos?.error ?? '')
      ? ok(`409 · "${(r.datos.error ?? '').slice(0, 110)}..."`)
      : mal(`esperaba 409 por el ajuste final; llego ${r.status} ${r.texto.slice(0, 200)}`);

    sql(`UPDATE inventarios SET estado = 'en_curso' WHERE id = ${INVENTARIO};`);
    limpiar = () => sql(`UPDATE inventarios SET estado = '${estadoOriginal}' WHERE id = ${INVENTARIO};`);
    info(`estado ${estadoOriginal} -> en_curso (se devuelve al terminar)`);
  }

  // ---------------------------------------------------- LA DESCARGA, CRONOMETRADA
  console.log(`\n== DESCARGA DEL STOCK DEL CONTEO ${RONDA} (Dynamics real) ==`);
  const t0 = Date.now();
  const primera = await api('POST', `/api/inventarios/${INVENTARIO}/rondas/${RONDA}/stock`, { token: sesion.token });
  const ms = Date.now() - t0;

  if (primera.status !== 200) {
    mal(`la descarga fallo: ${primera.status} ${primera.texto.slice(0, 300)}`);
  } else {
    const d = primera.datos;
    ok(`${d.items} item(s) · ${d.sinStockEnErp} sin stock en el ERP · tomadoEn ${d.tomadoEn}`);
    ok(`TIEMPO MEDIDO: ${ms} ms (${(ms / 1000).toFixed(2)} s) de punta a punta del POST`);

    const filas = consultar(
      `SELECT codigo, stock_erp, tomado_en FROM stock_rondas
         WHERE inventario_id = ${INVENTARIO} AND numero_conteo = ${RONDA} ORDER BY codigo`,
    );
    info('codigos y stock traido: ' + filas.map((f) => `${f.codigo}=${f.stock_erp ?? 'null'}`).join(', '));

    filas.length === d.items
      ? ok(`las ${filas.length} filas estan en stock_rondas`)
      : mal(`la respuesta dice ${d.items} y en la tabla hay ${filas.length}`);

    // UN SOLO tomadoEn: media ronda medida contra el ERP de las 14:30 y media
    // contra el de las 14:35 haria que la fecha de la pantalla no signifique nada.
    new Set(filas.map((f) => String(f.tomado_en))).size === 1
      ? ok('un solo `tomado_en` para toda la ronda')
      : mal('hay mas de un `tomado_en` en la misma ronda');

    // Y que sean LOS QUE ARRASTRA: los productos de la ronda son exactamente el
    // conjunto que el cierre mando a recontar.
    const productos = consultar(
      `SELECT DISTINCT p.codigo FROM productos p JOIN hojas_conteo h ON h.id = p.hoja_id
         WHERE h.inventario_id = ${INVENTARIO} AND h.numero_conteo = ${RONDA} ORDER BY p.codigo`,
    ).map((p) => p.codigo);
    const iguales = productos.length === filas.length && productos.every((c, i) => c === filas[i].codigo);
    iguales
      ? ok(`coinciden con los ${productos.length} productos de las hojas del conteo ${RONDA}`)
      : mal(`no coinciden · hojas: [${productos.join(', ')}] · stock: [${filas.map((f) => f.codigo).join(', ')}]`);

    // ------------------------------------------------------------ IDEMPOTENCIA
    console.log('\n== IDEMPOTENCIA: el segundo toque del boton ==');
    const t1 = Date.now();
    const segunda = await api('POST', `/api/inventarios/${INVENTARIO}/rondas/${RONDA}/stock`, { token: sesion.token });
    const ms2 = Date.now() - t1;
    if (segunda.status !== 200) {
      mal(`el reintento fallo: ${segunda.status} ${segunda.texto.slice(0, 200)}`);
    } else {
      segunda.datos.items === d.items
        ? ok(`mismos ${segunda.datos.items} item(s) · ${ms2} ms`)
        : mal(`el reintento trajo ${segunda.datos.items} y la primera ${d.items}`);
      Date.parse(segunda.datos.tomadoEn) > Date.parse(d.tomadoEn)
        ? ok(`tomadoEn actualizado: ${d.tomadoEn} -> ${segunda.datos.tomadoEn}`)
        : mal('el tomadoEn no se actualizo: el Coordinador no sabria si su reintento sirvio');
      const despues = consultar(
        `SELECT count(*)::int AS n, count(DISTINCT tomado_en)::int AS instantes FROM stock_rondas
           WHERE inventario_id = ${INVENTARIO} AND numero_conteo = ${RONDA}`,
      )[0];
      despues.n === d.items && despues.instantes === 1
        ? ok(`sigue habiendo ${despues.n} fila(s) y un solo instante: reemplazo, no duplicado`)
        : mal(`quedaron ${despues.n} filas con ${despues.instantes} instantes distintos`);
    }

    // ------------------------------------------------- UNA RONDA QUE NO CERRO
    console.log('\n== UNA RONDA CUYA ANTERIOR NO CERRO ==');
    const futura = Number(inv.ultima_ronda_cerrada) + 3;
    const r = await api('POST', `/api/inventarios/${INVENTARIO}/rondas/${futura}/stock`, { token: sesion.token });
    r.status === 409 && /cerrar antes el conteo/i.test(r.datos?.error ?? '')
      ? ok(`conteo ${futura}: 409 · "${(r.datos.error ?? '').slice(0, 110)}..."`)
      : mal(`esperaba 409 por la ronda anterior sin cerrar; llego ${r.status} ${r.texto.slice(0, 200)}`);

    // ------------------------------------------------------------- LOS ROLES
    console.log('\n== LOS ROLES ==');
    const [auditor] = consultar(`SELECT id FROM colaboradores WHERE rol = 'auditor' AND activo = true LIMIT 1`);
    if (auditor) {
      const sAud = (await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: auditor.id, pin: pinDev('auditor') } })).datos;
      const rAud = await api('POST', `/api/inventarios/${INVENTARIO}/rondas/${RONDA}/stock`, { token: sAud?.token });
      rAud.status === 403
        ? ok('auditor: 403 -- esto ESCRIBE la vara que el audita')
        : mal(`el auditor recibio ${rAud.status}, esperaba 403`);
    } else {
      info('sin auditor activo en la base: no se probo ese rol');
    }

    if (LIMPIAR) {
      sql(`DELETE FROM stock_rondas WHERE inventario_id = ${INVENTARIO} AND numero_conteo = ${RONDA};`);
      info(`stock_rondas del conteo ${RONDA} borrado (--limpiar)`);
    } else {
      info(`las ${d.items} fila(s) de stock_rondas quedan escritas (usa --limpiar para borrarlas)`);
    }
  }
} finally {
  limpiar();
  if (estadoOriginal !== 'en_curso') info(`estado devuelto a ${estadoOriginal}`);
}

await verificarRonda1DeUnInventarioNuevo();

console.log(fallas === 0 ? '\n== TODO OK ==\n' : `\n== ${fallas} FALLA(S) ==\n`);
process.exit(fallas === 0 ? 0 : 1);
