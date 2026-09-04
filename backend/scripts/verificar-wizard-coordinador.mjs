/**
 * EL FLUJO DEL COORDINADOR de punta a punta, por HTTP, exactamente como lo
 * haria la app desde el telefono:
 *
 *   1. traer el catalogo            → POST /api/d365/snapshot
 *   2. partir en hojas              → POST /api/inventarios/:id/hojas
 *   3. repartir entre los presentes → POST /api/inventarios/:id/hojas/asignar
 *   4. ver el inventario en curso   → GET  /api/sucursales/:id/inventarios/activo
 *
 * Hasta hoy los pasos 2, 3 y 4 daban 404 y el wizard corria contra memoria.
 * Este script existe para que eso no vuelva a pasar sin que nadie se entere.
 *
 * USA `modo: "ejemplo"` -- no baja los 8.000 items reales de Dynamics. Lo que
 * se verifica es el WIZARD, no la integracion con el ERP (que tiene su propia
 * prueba en /api/config-dynamics/probar).
 *
 * DEJA LA BASE COMO LA ENCONTRO: borra el inventario de prueba al final,
 * salvo que se pase --dejar. Corre contra la base del cliente, que tiene
 * datos reales: no puede ensuciarla.
 *
 *   node scripts/verificar-wizard-coordinador.mjs
 *   node scripts/verificar-wizard-coordinador.mjs --dejar
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const DEJAR = process.argv.includes('--dejar');
const PIN_ADMIN = process.env.PIN_ADMIN ?? '001000';

let fallas = 0;
const ok = (t) => console.log('  [OK]    ' + t);
const mal = (t) => {
  console.log('  [FALLA] ' + t);
  fallas += 1;
};
const nota = (t) => console.log('  [NOTA]  ' + t);

async function api(metodo, ruta, { token, body } = {}) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const texto = await r.text();
  let datos = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = texto;
  }
  return { status: r.status, datos };
}

async function main() {
  console.log('\n=== Wizard del Coordinador, de punta a punta ===\n');

  // --- entrar ---------------------------------------------------------------
  const admins = await api('GET', '/api/sesion/administradores');
  if (admins.status !== 200 || !Array.isArray(admins.datos) || admins.datos.length === 0) {
    mal(`No hay administradores para entrar (HTTP ${admins.status}). ¿Corriste el seed?`);
    return;
  }
  /**
   * Se prueba con CADA administrador y no solo con el primero: el PIN de
   * desarrollo es el id con ceros adelante (prisma/seed.ts), asi que "el
   * primero de la lista" no es necesariamente el que entra. Con PIN_ADMIN se
   * fuerza uno puntual.
   */
  let token = null;
  let admin = null;
  for (const candidato of admins.datos) {
    const pines = process.env.PIN_ADMIN ? [process.env.PIN_ADMIN] : [String(candidato.id).padStart(6, '0')];
    for (const pin of pines) {
      const login = await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: candidato.id, pin } });
      if (login.status === 200) {
        token = login.datos.token;
        admin = candidato;
        break;
      }
    }
    if (token) break;
  }
  if (!token) {
    mal(`Ningún administrador pudo entrar. Probá con PIN_ADMIN=<pin> node scripts/verificar-wizard-coordinador.mjs`);
    nota(`Administradores: ${admins.datos.map((a) => `${a.nombre} (id ${a.id})`).join(', ')}`);
    return;
  }
  ok(`Entró ${admin.nombre}`);

  // --- una tienda donde probar ---------------------------------------------
  const tiendas = await api('GET', '/api/tiendas', { token });
  if (tiendas.status !== 200 || tiendas.datos.length === 0) {
    mal('No hay ninguna tienda cargada: creá una antes de correr esto.');
    return;
  }
  const tienda = tiendas.datos[0];
  ok(`Tienda de prueba: ${tienda.nombre} (id ${tienda.id})`);

  // --- estado inicial -------------------------------------------------------
  const antes = await api('GET', `/api/sucursales/${tienda.id}/inventarios/activo`, { token });
  if (antes.status !== 200) mal(`activo dio HTTP ${antes.status}, se esperaba 200`);
  else ok(`Estado inicial: ${antes.datos === null ? 'sin inventario en curso' : `inventario ${antes.datos.inventarioId} ya abierto`}`);

  if (antes.datos !== null) {
    nota('Ya hay un inventario en curso: este script NO lo toca para no pisar trabajo real.');
    nota('Cerralo o usá una tienda sin inventario abierto.');
    return;
  }

  // --- PASO 1: catalogo -----------------------------------------------------
  const snapshot = await api('POST', '/api/d365/snapshot', {
    token,
    body: { sucursalId: tienda.id, modo: 'ejemplo' },
  });
  if (snapshot.status !== 200 && snapshot.status !== 201) {
    mal(`PASO 1 (snapshot) dio HTTP ${snapshot.status}: ${JSON.stringify(snapshot.datos).slice(0, 200)}`);
    return;
  }
  const inventarioId = snapshot.datos.inventarioId;
  ok(`PASO 1 — catálogo traído: inventario ${inventarioId}, ${snapshot.datos.items} ítems`);

  let creado = false;
  try {
    // --- PASO 2: hojas de golpe ---------------------------------------------
    const hojas = await api('POST', `/api/inventarios/${inventarioId}/hojas`, { token, body: { tamano: 20 } });
    if (hojas.status !== 201) {
      mal(`PASO 2 (crear hojas) dio HTTP ${hojas.status}: ${JSON.stringify(hojas.datos).slice(0, 200)}`);
      return;
    }
    creado = true;
    ok(`PASO 2 — ${hojas.datos.length} hoja(s) creadas DE UNA, no una por una`);

    // Lo que hace util a la hoja: que este ordenada por categoria.
    const primera = hojas.datos[0];
    if (!primera) {
      mal('No se creó ninguna hoja.');
    } else {
      ok(`  hoja ${primera.numero} · zona "${primera.zona}" · ${primera.productos.length} productos`);
      const categorias = [...new Set(primera.productos.map((p) => p.categoria ?? 'SIN CATEGORIA'))];
      ok(`  categorías en la hoja: ${categorias.join(', ')}`);

      // EL CONTEO CIEGO: ningun producto puede traer stock.
      const conStock = primera.productos.filter((p) => 'stockErp' in p || 'precioVenta' in p);
      if (conStock.length > 0) mal(`CONTEO CIEGO ROTO: ${conStock.length} producto(s) traen stock o precio`);
      else ok('  conteo ciego respetado: ningún producto trae stock ni precio');
    }

    const total = hojas.datos.reduce((n, h) => n + h.productos.length, 0);
    if (total !== snapshot.datos.items) mal(`Se perdieron ítems: ${snapshot.datos.items} en el catálogo, ${total} en las hojas`);
    else ok(`  ningún ítem perdido: ${total} de ${snapshot.datos.items}`);

    // --- PASO 3: repartir ----------------------------------------------------
    const gente = await api('GET', `/api/usuarios?sucursalId=${tienda.id}`, { token });
    const contadores = (Array.isArray(gente.datos) ? gente.datos : []).filter((c) => c.rol === 'conteo' && c.activo);
    if (contadores.length === 0) {
      nota('PASO 3 salteado: esta tienda no tiene contadores activos.');
    } else {
      const ids = contadores.slice(0, 3).map((c) => c.id);
      const reparto = await api('POST', `/api/inventarios/${inventarioId}/hojas/asignar`, {
        token,
        body: { colaboradorIds: ids },
      });
      if (reparto.status !== 200) {
        mal(`PASO 3 (asignar) dio HTTP ${reparto.status}: ${JSON.stringify(reparto.datos).slice(0, 200)}`);
      } else {
        const sinAsignar = reparto.datos.filter((h) => h.asignados.length === 0).length;
        ok(`PASO 3 — repartidas entre ${ids.length} persona(s), ${sinAsignar} sin asignar`);

        // Bloques CONTIGUOS: cada persona camina un tramo, no salta.
        const porPersona = new Map();
        reparto.datos.forEach((h, i) => {
          const quien = h.asignados[0];
          if (!quien) return;
          if (!porPersona.has(quien)) porPersona.set(quien, []);
          porPersona.get(quien).push(i);
        });
        const contiguos = [...porPersona.values()].every((idx) => idx.every((v, k) => k === 0 || v === idx[k - 1] + 1));
        if (contiguos) ok('  cada persona tiene un tramo CONTIGUO de hojas');
        else mal('  las hojas quedaron salteadas: alguien va a cruzar la tienda');
      }
    }

    // --- PASO 4: el estado se ve --------------------------------------------
    const despues = await api('GET', `/api/sucursales/${tienda.id}/inventarios/activo`, { token });
    if (despues.status !== 200 || despues.datos === null) {
      mal(`PASO 4 (activo) no devolvió el inventario en curso (HTTP ${despues.status})`);
    } else {
      ok(`PASO 4 — activo: inventario ${despues.datos.inventarioId}, ${despues.datos.totalHojas} hojas de ${despues.datos.tamanoHoja}`);
      if (despues.datos.tamanoHoja !== 20) mal(`  tamanoHoja dice ${despues.datos.tamanoHoja}, se creó con 20`);
    }

    // --- que NO se pueda rehacer con conteos cargados no se prueba aca:
    //     necesitaria contar de verdad. Lo cubre inventarios.service.test.ts.
  } finally {
    if (creado && !DEJAR) {
      const borrado = await limpiar(inventarioId);
      console.log(borrado ? '\n  [LIMPIO] inventario de prueba borrado' : '\n  [OJO] no se pudo borrar el inventario de prueba');
    } else if (DEJAR) {
      console.log(`\n  [--dejar] queda el inventario ${inventarioId} para revisarlo a mano`);
    }
  }

  console.log(`\n${fallas === 0 ? 'TODO OK' : `${fallas} FALLA(S)`}\n`);
  process.exitCode = fallas === 0 ? 0 : 1;
}

/**
 * Borra el inventario de prueba delegando en `borrar-inventario.ts`, que es
 * el que sabe el orden de borrado y se niega si hay conteos cargados.
 *
 * Delegar y no repetir el SQL aca: la primera version armaba el borrado
 * inline con `npx tsx -e` y fallaba por el quoting, dejando el inventario de
 * prueba en la base del cliente sin que el script lo notara mas que con un
 * aviso. Un limpiador que falla en silencio es peor que no tenerlo.
 */
async function limpiar(inventarioId) {
  try {
    // Prisma Client directo, sin subproceso. Las dos vias anteriores
    // fallaron en Windows: `npx tsx -e` por el quoting del SQL inline, y
    // `execFileSync('npx.cmd')` con EINVAL (Node no puede spawnear .cmd asi).
    // Importar el client es mas simple que las dos y no depende del shell.
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    try {
      const conteos = await prisma.conteo.count({ where: { hoja: { inventarioId } } });
      if (conteos > 0) {
        console.error(`    SE NIEGA a borrar: el inventario ${inventarioId} tiene ${conteos} conteo(s).`);
        return false;
      }
      // Los hijos primero: Postgres no borra en cascada acá.
      await prisma.$transaction([
        prisma.empaque.deleteMany({ where: { producto: { hoja: { inventarioId } } } }),
        prisma.producto.deleteMany({ where: { hoja: { inventarioId } } }),
        prisma.hojaConteo.deleteMany({ where: { inventarioId } }),
        prisma.empaqueCatalogo.deleteMany({ where: { catalogoItem: { inventarioId } } }),
        prisma.catalogoItem.deleteMany({ where: { inventarioId } }),
        prisma.inventario.delete({ where: { id: inventarioId } }),
      ]);
      return true;
    } finally {
      await prisma.$disconnect();
    }
  } catch (e) {
    console.error('    ' + (e.message ?? String(e)));
    return false;
  }
}

main().catch((e) => {
  console.error('\n[ERROR]', e.message);
  process.exitCode = 1;
});
