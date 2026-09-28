/**
 * PRUEBA POR API, CONTRA EL BACKEND VIVO, de
 * `GET /api/auditoria/cadena/diferencias/exportar` -- el .xlsx con el detalle
 * por producto de los faltantes y sobrantes de todas las tiendas de un periodo.
 *
 * Lo que verifica esto y no puede verificar un test unitario: que el archivo
 * salga de datos REALES (el snapshot del ERP cruzado con las hojas finalizadas)
 * atravesando middleware, rutas, Prisma y exceljs -- y sobre todo QUE CIERRE
 * CONTRA LA TABLA que respalda: se baja tambien `GET /api/auditoria/cadena` para
 * el mismo periodo y se cruzan los seis totales (tres cuadros x faltante y
 * sobrante) tienda por tienda y para la cadena entera.
 *
 * Es la razon de existir del endpoint: si el archivo no suma las cifras de la
 * tabla, no la respalda -- la contradice.
 *
 * Tambien mide el tiempo del endpoint (mejor de 3 corridas), porque el numero
 * que va en el comentario de cabecera del service se mide, no se estima.
 *
 *   BASE_URL=http://localhost:3000 node scripts/verificar-export-cadena-api.mjs
 *   ANIO=2026 MES=9 node scripts/verificar-export-cadena-api.mjs
 */
import ExcelJS from 'exceljs';
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

const AUDITOR = 103;      // Gilmer Quispe
const COORDINADOR = 101;  // Jose, coordinador de la tienda 1

/** Las 16 columnas del archivo, en orden (auditoria.exportar-diferencias.ts). */
const ENCABEZADOS = [
  'Sucursal', 'Año', 'Mes', 'Inventario', 'Código', 'Descripción', 'Zona', 'Hoja', 'Empaque',
  'Cuadro', 'Tipo', 'Stock ERP', 'Conteo final', 'Diferencia', 'Precio unitario', 'Monto',
];

/** El .xlsx bajado, leido como filas de objetos. */
async function bajarArchivo(token, query) {
  const r = await fetch(`${BASE}/api/auditoria/cadena/diferencias/exportar${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status !== 200) throw new Error(`el export devolvio ${r.status}: ${await r.text()}`);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(Buffer.from(await r.arrayBuffer()));
  const hoja = libro.worksheets[0];
  const encabezados = hoja.getRow(1).values.slice(1);
  const filas = [];
  for (let n = 2; n <= hoja.rowCount; n++) {
    const celdas = hoja.getRow(n).values;
    filas.push(Object.fromEntries(encabezados.map((e, i) => [e, celdas[i + 1] ?? null])));
  }
  return {
    nombreHojas: libro.worksheets.map((h) => h.name),
    nombreArchivo: /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? null,
    contentType: r.headers.get('content-type'),
    encabezados,
    filas,
    bytes: Number(r.headers.get('content-length') ?? 0),
  };
}

const ETIQUETA = { unidad: 'Al personal', paquete: 'Por paquete', empresa: 'Empresa' };

/** Suma la columna Monto del archivo para un cuadro y un tipo, opcionalmente de una tienda. */
function sumar(filas, cuadro, tipo, sucursal) {
  return redondear(
    filas
      .filter((f) => f.Cuadro === ETIQUETA[cuadro] && f.Tipo === tipo && (sucursal === undefined || f.Sucursal === sucursal))
      .reduce((total, f) => total + (f.Monto ?? 0), 0),
  );
}

async function main() {
  const anio = Number(process.env.ANIO ?? 2026);
  const mes = Number(process.env.MES ?? 9);
  const query = `?anio=${anio}&mes=${mes}`;
  console.log(`\n== GET /api/auditoria/cadena/diferencias/exportar ${query} contra ${BASE} ==\n`);

  const sesionAuditor = await ingresar(AUDITOR, 'auditor');
  const token = sesionAuditor.token;

  // -------------------------------------------------------------------------
  console.log('PERMISOS -- el mismo recorte que /cadena, sin excepciones nuevas');
  const sinSesion = await fetch(`${BASE}/api/auditoria/cadena/diferencias/exportar${query}`);
  sinSesion.status === 401 ? ok('sin sesion: 401') : mal(`sin sesion: esperaba 401, dio ${sinSesion.status}`);

  const sesionCoordinador = await ingresar(COORDINADOR, 'coordinador');
  const comoCoordinador = await fetch(`${BASE}/api/auditoria/cadena/diferencias/exportar${query}`, {
    headers: { Authorization: `Bearer ${sesionCoordinador.token}` },
  });
  comoCoordinador.status === 403
    ? ok('coordinador: 403, igual que en /cadena')
    : mal(`coordinador: esperaba 403, dio ${comoCoordinador.status}`);

  // -------------------------------------------------------------------------
  console.log('\nEL ARCHIVO');
  const archivo = await bajarArchivo(token, query);
  archivo.contentType?.includes('spreadsheetml.sheet')
    ? ok(`Content-Type de .xlsx (${archivo.contentType})`)
    : mal(`Content-Type inesperado: ${archivo.contentType}`);
  archivo.nombreArchivo === `diferencias-cadena-${anio}-${String(mes).padStart(2, '0')}.xlsx`
    ? ok(`Content-Disposition: ${archivo.nombreArchivo}`)
    : mal(`nombre de archivo inesperado: ${archivo.nombreArchivo}`);
  archivo.nombreHojas.length === 1 && archivo.nombreHojas[0] === 'Diferencias'
    ? ok('UNA hoja, llamada Diferencias')
    : mal(`hojas inesperadas: ${archivo.nombreHojas.join(', ')}`);
  JSON.stringify(archivo.encabezados) === JSON.stringify(ENCABEZADOS)
    ? ok('encabezado exacto en la fila 1')
    : mal(`encabezado distinto: ${JSON.stringify(archivo.encabezados)}`);

  console.log(`  filas de producto: ${archivo.filas.length}`);
  const porTienda = new Map();
  for (const f of archivo.filas) porTienda.set(f.Sucursal, (porTienda.get(f.Sucursal) ?? 0) + 1);
  for (const [tienda, n] of porTienda) console.log(`    ${tienda}: ${n} filas`);

  // Tabla plana de verdad: ninguna fila sin sucursal ni sin codigo, y ningun
  // numero como texto en las columnas que se suman.
  const sinSucursal = archivo.filas.filter((f) => typeof f.Sucursal !== 'string' || f.Sucursal === '');
  sinSucursal.length === 0 ? ok('todas las filas dicen de que tienda son') : mal(`${sinSucursal.length} filas sin sucursal`);
  const comoTexto = archivo.filas.filter(
    (f) => typeof f.Diferencia !== 'number' || (f.Monto !== null && typeof f.Monto !== 'number'),
  );
  comoTexto.length === 0 ? ok('Diferencia y Monto entraron como NUMERO') : mal(`${comoTexto.length} filas con numeros como texto`);

  const conCero = archivo.filas.filter((f) => f.Diferencia === 0);
  conCero.length === 0 ? ok('ninguna fila con diferencia 0') : mal(`${conCero.length} filas con diferencia 0`);

  const signoMal = archivo.filas.filter(
    (f) => (f.Tipo === 'Faltante') !== f.Diferencia < 0 || (f.Monto !== null && Math.sign(f.Monto) !== Math.sign(f.Diferencia)),
  );
  signoMal.length === 0
    ? ok('Faltante <-> negativo, Sobrante <-> positivo, y el Monto sigue el signo')
    : mal(`${signoMal.length} filas con el signo al reves`);

  const sinPrecio = archivo.filas.filter((f) => f['Precio unitario'] === null);
  const sinPrecioConCero = sinPrecio.filter((f) => f.Monto === 0);
  sinPrecioConCero.length === 0
    ? ok(`${sinPrecio.length} filas sin precio, y ninguna con Monto en 0 (celda vacia)`)
    : mal(`${sinPrecioConCero.length} filas sin precio pero con Monto 0`);

  // -------------------------------------------------------------------------
  console.log('\nEL EMPAQUE, VERBATIM');
  const empaques = new Set(archivo.filas.map((f) => f.Empaque).filter((e) => e !== null));
  const corregidos = [...empaques].filter((e) => e.includes('corregido por el auditor'));
  const inventados = [...empaques].filter((e) => /caja|display/i.test(e));
  inventados.length === 0
    ? ok(`${empaques.size} simbolos distintos, ninguno traducido a caja/display`)
    : mal(`simbolos inventados: ${inventados.join(', ')}`);
  console.log(`    corregidos por el auditor: ${corregidos.length}${corregidos.length > 0 ? ' -> ' + corregidos.slice(0, 3).join(' | ') : ''}`);

  // -------------------------------------------------------------------------
  console.log('\nEL CRUCE CONTRA LA TABLA -- GET /api/auditoria/cadena');
  const tabla = await api('GET', `/api/auditoria/cadena${query}`, { token });
  if (tabla.status !== 200) throw new Error(`/cadena devolvio ${tabla.status}`);

  for (const fila of tabla.datos.tiendas) {
    if (fila.inventarioId === null) {
      const filasDeEsa = archivo.filas.filter((f) => f.Sucursal === fila.sucursal);
      filasDeEsa.length === 0
        ? ok(`${fila.sucursal}: sin inventario en el periodo, 0 filas en el archivo`)
        : mal(`${fila.sucursal}: sin inventario pero aporto ${filasDeEsa.length} filas`);
      continue;
    }
    let cierra = true;
    const detalle = [];
    for (const cuadro of ['unidad', 'paquete', 'empresa']) {
      const faltante = -sumar(archivo.filas, cuadro, 'Faltante', fila.sucursal);
      const sobrante = sumar(archivo.filas, cuadro, 'Sobrante', fila.sucursal);
      if (Math.abs(faltante - fila.porClase[cuadro].valorFaltante) > 0.011) cierra = false;
      if (Math.abs(sobrante - fila.porClase[cuadro].valorSobrante) > 0.011) cierra = false;
      detalle.push(`${ETIQUETA[cuadro]} -${faltante.toFixed(2)}/+${sobrante.toFixed(2)} (tabla -${fila.porClase[cuadro].valorFaltante.toFixed(2)}/+${fila.porClase[cuadro].valorSobrante.toFixed(2)})`);
    }
    const n = archivo.filas.filter((f) => f.Sucursal === fila.sucursal).length;
    cierra
      ? ok(`${fila.sucursal} (inv ${fila.inventarioId}, ${n} filas): ${detalle.join(' | ')}`)
      : mal(`${fila.sucursal}: el archivo NO cierra contra la tabla -> ${detalle.join(' | ')}`);
  }

  console.log('\n  la CADENA entera:');
  for (const cuadro of ['unidad', 'paquete', 'empresa']) {
    const faltante = -sumar(archivo.filas, cuadro, 'Faltante');
    const sobrante = sumar(archivo.filas, cuadro, 'Sobrante');
    const t = tabla.datos.total.porClase[cuadro];
    const cierra = Math.abs(faltante - t.valorFaltante) <= 0.011 && Math.abs(sobrante - t.valorSobrante) <= 0.011;
    cierra
      ? ok(`${ETIQUETA[cuadro]}: faltante S/ ${faltante.toFixed(2)} y sobrante S/ ${sobrante.toFixed(2)} == la tabla`)
      : mal(`${ETIQUETA[cuadro]}: archivo -${faltante.toFixed(2)}/+${sobrante.toFixed(2)} contra tabla -${t.valorFaltante.toFixed(2)}/+${t.valorSobrante.toFixed(2)}`);
  }
  const faltanteTotal = -redondear(archivo.filas.filter((f) => f.Tipo === 'Faltante').reduce((t, f) => t + (f.Monto ?? 0), 0));
  const sobranteTotal = redondear(archivo.filas.filter((f) => f.Tipo === 'Sobrante').reduce((t, f) => t + (f.Monto ?? 0), 0));
  Math.abs(faltanteTotal - tabla.datos.total.valorFaltante) <= 0.011 &&
  Math.abs(sobranteTotal - tabla.datos.total.valorSobrante) <= 0.011
    ? ok(`los tres cuadros juntos: faltante S/ ${faltanteTotal.toFixed(2)} y sobrante S/ ${sobranteTotal.toFixed(2)} == el pie de la tabla`)
    : mal(`el total del archivo (-${faltanteTotal}/+${sobranteTotal}) no es el de la tabla (-${tabla.datos.total.valorFaltante}/+${tabla.datos.total.valorSobrante})`);

  // Cada fila tiene que decir el inventario que la tabla eligio para esa tienda.
  const inventarioDeLaTabla = new Map(tabla.datos.tiendas.map((t) => [t.sucursal, t.inventarioId]));
  const inventarioMal = archivo.filas.filter((f) => inventarioDeLaTabla.get(f.Sucursal) !== f.Inventario);
  inventarioMal.length === 0
    ? ok('todas las filas salen del MISMO inventario que eligio la tabla')
    : mal(`${inventarioMal.length} filas de un inventario distinto al de la tabla`);

  // -------------------------------------------------------------------------
  console.log('\nQUE HAY EN LA BASE (para leer los numeros de arriba)');
  const invs = await prisma.inventario.findMany({
    where: { periodoAnio: anio, periodoMes: mes },
    select: { id: true, estado: true, tipo: true, snapshotItems: true, sucursal: { select: { nombre: true } } },
    orderBy: { id: 'asc' },
  });
  for (const inv of invs) {
    const dif = await prisma.diferenciaItem.count({ where: { inventarioId: inv.id } });
    console.log(`  inv ${inv.id} ${inv.sucursal.nombre}: ${inv.estado}/${inv.tipo}, ${inv.snapshotItems} items del snapshot, ${dif} filas en DiferenciaItem`);
  }
  // LA RAZON DE QUE ESTE ENDPOINT EXISTA: con 0 filas en DiferenciaItem, el
  // export del historial bajaria vacio y este trae el detalle igual.
  const sinPersistir = invs.filter((i) => !['conteo_cerrado', 'liquidado', 'lacrado'].includes(i.estado));
  if (sinPersistir.length > 0 && archivo.filas.length > 0) {
    ok(`${sinPersistir.length} inventario(s) sin cerrar aportan filas: la matriz viva, no DiferenciaItem`);
  }

  // -------------------------------------------------------------------------
  console.log('\nCUANTO TARDA -- mejor de 3 corridas');
  const tiempos = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const r = await fetch(`${BASE}/api/auditoria/cadena/diferencias/exportar${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const bytes = (await r.arrayBuffer()).byteLength;
    tiempos.push({ ms: performance.now() - t0, bytes });
  }
  const mejor = tiempos.reduce((a, b) => (a.ms < b.ms ? a : b));
  console.log(`  ${tiempos.map((t) => Math.round(t.ms) + ' ms').join(', ')}  ->  mejor ${Math.round(mejor.ms)} ms, ${(mejor.bytes / 1024).toFixed(1)} KB`);

  const tiemposTabla = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    await api('GET', `/api/auditoria/cadena${query}`, { token });
    tiemposTabla.push(performance.now() - t0);
  }
  console.log(`  para comparar, /cadena: mejor ${Math.round(Math.min(...tiemposTabla))} ms`);

  console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} FALLA(S)\n`);
  await prisma.$disconnect();
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('\nERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
