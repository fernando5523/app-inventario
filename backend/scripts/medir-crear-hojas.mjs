/**
 * Mide cuanto tarda partir un inventario REAL en hojas, y verifica que el
 * resultado sea correcto: ningun item perdido ni duplicado, y las hojas
 * agrupadas por categoria de verdad.
 *
 * POR QUE MEDIR Y NO SOLO PROBAR: el wizard se verifico con 4 items de
 * ejemplo (verificar-wizard-coordinador.mjs). Con ~3.000 reales cambia la
 * escala: `crearHojas` hace un `create` anidado por hoja dentro de una
 * transaccion, y cada hoja arrastra sus productos y los empaques de cada
 * producto. Si eso tarda mas que el timeout del movil (TIMEOUT_LARGO_MS = 5
 * min en mobile/lib/adaptadores/_http.ts), el Coordinador ve un error
 * despues de esperar cinco minutos -- con las hojas quiza ya creadas.
 *
 *   node scripts/medir-crear-hojas.mjs <inventarioId> [tamano]
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const inventarioId = Number(process.argv[2]);
const tamano = Number(process.argv[3] ?? 50);

if (!Number.isInteger(inventarioId) || inventarioId <= 0) {
  console.error('Uso: node scripts/medir-crear-hojas.mjs <inventarioId> [tamano]');
  process.exit(1);
}

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

async function entrar() {
  const admins = await api('GET', '/api/sesion/administradores');
  for (const c of admins.datos ?? []) {
    const pin = process.env.PIN_ADMIN ?? String(c.id).padStart(6, '0');
    const login = await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: c.id, pin } });
    if (login.status === 200) return login.datos.token;
  }
  throw new Error('Ningún administrador pudo entrar.');
}

const seg = (ms) => (ms / 1000).toFixed(1) + 's';

async function main() {
  const token = await entrar();

  console.log(`\n=== Partir el inventario ${inventarioId} en hojas de ${tamano} ===\n`);

  const t0 = Date.now();
  const r = await api('POST', `/api/inventarios/${inventarioId}/hojas`, { token, body: { tamano } });
  const ms = Date.now() - t0;

  if (r.status !== 201) {
    console.error(`FALLO HTTP ${r.status}: ${JSON.stringify(r.datos).slice(0, 300)}`);
    process.exit(1);
  }

  const hojas = r.datos;
  const items = hojas.reduce((n, h) => n + h.productos.length, 0);

  console.log(`  TIEMPO ................ ${seg(ms)}`);
  console.log(`  hojas creadas ......... ${hojas.length}`);
  console.log(`  ítems repartidos ...... ${items}`);
  console.log(`  ms por hoja ........... ${(ms / hojas.length).toFixed(0)}`);

  // El limite que importa: el movil corta a los 5 minutos.
  const LIMITE_MOVIL_MS = 5 * 60_000;
  if (ms > LIMITE_MOVIL_MS) {
    console.log(`\n  ⚠ SE PASA DEL TIMEOUT DEL MÓVIL (${seg(LIMITE_MOVIL_MS)}): el Coordinador vería un error.`);
  } else {
    console.log(`\n  ✓ dentro del timeout del móvil (${seg(LIMITE_MOVIL_MS)}), con ${seg(LIMITE_MOVIL_MS - ms)} de margen`);
  }

  // --- que el resultado sea correcto, no solo rapido -------------------------
  console.log('\n--- verificación ---');

  const codigos = hojas.flatMap((h) => h.productos.map((p) => p.codigo));
  const unicos = new Set(codigos);
  if (unicos.size !== codigos.length) {
    console.log(`  [FALLA] ${codigos.length - unicos.size} ítem(s) DUPLICADOS entre hojas`);
  } else {
    console.log(`  [OK]    ningún ítem duplicado (${unicos.size} distintos)`);
  }

  const tamanos = hojas.map((h) => h.productos.length);
  const parciales = tamanos.filter((t) => t !== tamano);
  if (parciales.length > 1) {
    console.log(`  [FALLA] ${parciales.length} hojas con tamaño distinto de ${tamano} (debería ser solo la última)`);
  } else {
    console.log(`  [OK]    solo la última hoja queda parcial (${parciales[0] ?? tamano} ítems)`);
  }

  // LO QUE HACE UTIL A LA HOJA: pocas categorias por hoja = un tramo del
  // recorrido. Si cada hoja tuviera 30 categorias distintas, el orden no
  // estaria sirviendo para nada.
  const porHoja = hojas.map((h) => new Set(h.productos.map((p) => p.categoria ?? 'SIN CATEGORIA')).size);
  const promedio = porHoja.reduce((a, b) => a + b, 0) / porHoja.length;
  const sinCategoria = codigos.length - hojas.flatMap((h) => h.productos).filter((p) => p.categoria).length;
  console.log(`  [DATO]  categorías por hoja: ${Math.min(...porHoja)}–${Math.max(...porHoja)} (promedio ${promedio.toFixed(1)})`);
  console.log(`  [DATO]  ítems sin categoría en el ERP: ${sinCategoria}`);

  const conStock = hojas.flatMap((h) => h.productos).filter((p) => 'stockErp' in p || 'precioVenta' in p);
  if (conStock.length > 0) console.log(`  [FALLA] CONTEO CIEGO ROTO: ${conStock.length} producto(s) traen stock o precio`);
  else console.log('  [OK]    conteo ciego: ningún producto trae stock ni precio');

  console.log('\n--- primeras 8 hojas ---');
  for (const h of hojas.slice(0, 8)) {
    console.log(`  ${h.numero}  ${String(h.productos.length).padStart(3)} ítems  ·  ${h.zona}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error('\n[ERROR]', e.message);
  process.exit(1);
});
