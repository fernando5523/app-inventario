/**
 * LA ASISTENCIA REGISTRADA, de punta a punta contra el backend vivo.
 *
 * Lo que prueba de verdad y no de palabra:
 *   - que los DIAS del inventario salgan solos de las marcas, sin que nadie
 *     los declare;
 *   - que la multa sea `(dias del inventario - dias asistidos) x tarifa`;
 *   - que el FONDO CIERRE AL CENTAVO: `diasFaltadosEnTotal x tarifa ===
 *     fondoMultas`, y que la planilla siga sumando el neto.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESA ULTIMA COMPROBACION EXISTE
 * ---------------------------------------------------------------------------
 * Porque ya fallo. Con la multa por dia, `totalFaltas x tarifa` dejo de
 * reconstruir el fondo: `totalFaltas` cuenta PERSONAS y cada una falto una
 * cantidad distinta de dias. Tres personas que faltan 1, 2 y 3 dias son 3
 * personas pero 6 dias -- S/60 contra S/120, la mitad del fondo evaporada.
 * El movil llego a mostrarlo mal. El multiplicando correcto es
 * `diasFaltadosEnTotal`, y esta prueba lo fija para que no vuelva en silencio.
 *
 * ---------------------------------------------------------------------------
 * ARMA SU PROPIA TIENDA: no toca ningun inventario existente, y borra todo al
 * terminar salvo que se pase --dejar.
 *
 *   node scripts/verificar-asistencia.mjs
 *   node scripts/verificar-asistencia.mjs --dejar
 *   PIN_ADMIN=000020 node scripts/verificar-asistencia.mjs
 */
import { pinDev } from './_pin-dev.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const DEJAR = process.argv.includes('--dejar');

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
const entrar = async (id, pin) => (await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: id, pin } })).datos;
const lista = (r) => (Array.isArray(r.datos) ? r.datos : (r.datos?.datos ?? []));

/** Dia en hora de Lima (UTC-5), que es el que usa el backend. */
function diaLima(desfaseDias = 0) {
  const t = Date.now() + desfaseDias * 86400000 - 5 * 3600000;
  return new Date(t).toISOString().slice(0, 10);
}

const S = Date.now().toString().slice(-6);
const PIN = S;

// ===========================================================================
console.log('== ESCENARIO PROPIO ==');

const admin = await entrar(1000, process.env.PIN_ADMIN ?? pinDev('administrador'));
const tienda = (await api('POST', '/api/tiendas', {
  token: admin?.token, body: { nombre: `Market Asistencia ${S}`, almacenId: 'MD01_LUZ' },
})).datos;

const gente = {};
// El auditor NO es personal de tienda (no entra a la planilla), pero la
// proyeccion de liquidacion es de su rol: sin el, este script no puede mirar
// la plata.
for (const [clave, rol] of [['coord', 'coordinador'], ['cont1', 'conteo'], ['cont2', 'conteo'], ['aud', 'auditor']]) {
  gente[clave] = (await api('POST', '/api/usuarios', {
    token: admin?.token,
    body: { nombre: `${clave} ${S}`, dni: `${S}${Object.keys(gente).length}`.slice(-8), rol, sucursalId: tienda?.id, pin: PIN },
  })).datos;
}
const sCoord = await entrar(gente.coord?.id, PIN);
const snap = (await api('POST', '/api/d365/snapshot', {
  token: sCoord?.token, body: { sucursalId: tienda?.id, modo: 'ejemplo' },
})).datos;
const inv = snap?.inventarioId;

/**
 * GUARDA DE ALCANCE -- la misma que verificar-ciclo-rondas.mjs. Los ids salen
 * de respuestas HTTP; si el backend contesta otra cosa (un 429 alcanza) quedan
 * `undefined`, y Prisma IGNORA las condiciones `undefined`: el filtro deja de
 * filtrar y la limpieza de mas abajo borra la base entera.
 */
function exigirId(valor, que) {
  if (Number.isInteger(valor) && valor > 0) return valor;
  console.error(`\n  [ABORTA] ${que}: se esperaba un id y llego ${JSON.stringify(valor)}.`);
  console.error('  Sin ese id, un filtro de Prisma no filtra NADA. No se toca la base.');
  process.exit(1);
}
exigirId(tienda?.id, 'la tienda de prueba');
for (const [c, p] of Object.entries(gente)) exigirId(p?.id, `el usuario "${c}"`);
exigirId(inv, 'el inventario del snapshot');
ok(`tienda ${tienda.id}, inventario ${inv}, 3 personas`);

// ===========================================================================
console.log('\n== PASO 1: REGISTRAR LA ASISTENCIA DE TRES DIAS ==');

const HOY = diaLima(0), AYER = diaLima(-1), ANTEAYER = diaLima(-2);
const PLAN = [
  [ANTEAYER, ['coord', 'cont1', 'cont2']],
  [AYER, ['coord', 'cont1']],
  [HOY, ['coord', 'cont1']],
];
for (const [dia, quienes] of PLAN) {
  for (const clave of quienes) {
    const r = await api('POST', `/api/inventarios/${inv}/asistencia`, {
      token: sCoord.token, body: { colaboradorId: gente[clave].id, dia },
    });
    if (r.status >= 400) mal(`no pudo marcar a ${clave} el ${dia}: HTTP ${r.status} ${r.texto.slice(0, 120)}`);
  }
}
ok(`7 marcas cargadas: los 3 el ${ANTEAYER}, dos el ${AYER} y dos el ${HOY}`);

// Idempotente: la unique tiene que absorber el doble toque sin sumar un dia.
await api('POST', `/api/inventarios/${inv}/asistencia`, {
  token: sCoord.token, body: { colaboradorId: gente.coord.id, dia: HOY },
});

const estado = await api('GET', `/api/inventarios/${inv}/asistencia`, { token: sCoord.token });
const dias = estado.datos?.dias ?? [];
dias.length === 3
  ? ok(`el inventario declara ${dias.length} dias, deducidos de las marcas: ${dias.join(', ')}`)
  : mal(`se esperaban 3 dias distintos y hay ${dias.length}: ${dias.join(', ')}`);

const marcas = estado.datos?.marcas ?? [];
marcas.length === 7
  ? ok('7 marcas, o sea que marcar dos veces el mismo dia no suma otra')
  : mal(`se esperaban 7 marcas (la repetida no cuenta) y hay ${marcas.length}`);

// ===========================================================================
console.log('\n== PASO 2: LAS GUARDAS ==');

const ajeno = await api('POST', `/api/inventarios/${inv}/asistencia`, {
  token: sCoord.token, body: { colaboradorId: 1000, dia: HOY },
});
ajeno.status >= 400
  ? ok(`no deja marcar a alguien que no es personal de esta tienda (HTTP ${ajeno.status})`)
  : mal('dejo marcar a un colaborador ajeno a la tienda');

const sCont1 = await entrar(gente.cont1.id, PIN);
const noCoord = await api('POST', `/api/inventarios/${inv}/asistencia`, {
  token: sCont1.token, body: { colaboradorId: gente.cont2.id, dia: HOY },
});
noCoord.status === 403
  ? ok('un contador no puede registrar asistencia (403)')
  : mal(`un contador registro asistencia o dio otro error: HTTP ${noCoord.status}, se esperaba 403`);

// ===========================================================================
console.log('\n== PASO 3: CONTAR Y CERRAR EL CICLO ==');

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
try {
  // El catalogo de ejemplo viene sin stock del ERP: sin ese numero no hay
  // contra que comparar. Se le carga, acotado a ESTE inventario.
  const items = await prisma.catalogoItem.findMany({
    where: { inventarioId: inv }, select: { id: true, inventarioId: true }, orderBy: { codigo: 'asc' },
  });
  if (items.some((i) => i.inventarioId !== inv)) {
    console.error('  [ABORTA] el catalogo trae filas de otro inventario: no se escribe nada.');
    process.exit(1);
  }
  /**
   * Se carga stock Y PRECIO. El precio no es decorativo: sin el, el faltante
   * vale cero, el neto da 0 y la comprobacion de "la planilla suma el neto"
   * pasa sola (0 === 0) aunque el reparto este roto. Una prueba que no puede
   * fallar no es una prueba.
   */
  for (const [i, it] of items.entries()) {
    await prisma.catalogoItem.update({
      where: { id: it.id },
      data: { stockErp: 100 + i * 10, precioVenta: 25.5 + i },
    });
  }

  await api('POST', `/api/inventarios/${inv}/hojas`, { token: sCoord.token, body: { tamano: 20 } });
  await api('POST', `/api/inventarios/${inv}/hojas/asignar`, { token: sCoord.token, body: { colaboradorIds: [gente.cont1.id] } });

  // Tres rondas contando SIEMPRE uno de menos en el primer producto: la
  // diferencia tiene que sobrevivir hasta la ultima ronda para congelarse.
  for (const ronda of [1, 2, 3]) {
    const hojas = lista(await api('GET', `/api/hojas?alcance=mias&inventarioId=${inv}&ronda=${ronda}`, { token: sCont1.token }));
    if (hojas.length === 0) { info(`la ronda ${ronda} no abrio: el ciclo termino antes`); break; }
    for (const hoja of hojas) {
      const prods = lista(await api('GET', `/api/hojas/${hoja.id}/productos`, { token: sCont1.token }));
      for (const [i, p] of prods.entries()) {
        const cat = await prisma.catalogoItem.findFirst({ where: { inventarioId: inv, codigo: p.codigo }, select: { stockErp: true } });
        const cantidad = i === 0 ? Math.max(0, (cat?.stockErp ?? 0) - 1) : (cat?.stockErp ?? 0);
        await api('PUT', `/api/hojas/${hoja.id}/conteos/${p.id}`, {
          token: sCont1.token,
          body: { empaques: [], sueltas: cantidad, confirmadoPorEscaner: false, contadoEn: new Date().toISOString() },
        });
      }
      await api('POST', `/api/hojas/${hoja.id}/finalizar`, { token: sCont1.token });
    }
    const cierre = await api('POST', `/api/inventarios/${inv}/rondas/${ronda}/cerrar`, { token: sCoord.token });
    // Responde 201: el cierre CREA el resultado de la ronda, no actualiza algo.
    if (cierre.status !== 200 && cierre.status !== 201) {
      mal(`cerrar la ronda ${ronda} dio HTTP ${cierre.status}: ${cierre.texto.slice(0, 140)}`); break;
    }
    if (ronda < 3) {
      await api('POST', `/api/inventarios/${inv}/hojas/asignar`, { token: sCoord.token, body: { colaboradorIds: [gente.cont1.id] } });
    }
  }

  const cerrado = await prisma.inventario.findUnique({ where: { id: inv }, select: { estado: true } });
  cerrado?.estado === 'conteo_cerrado'
    ? ok('el inventario quedo en conteo_cerrado')
    : mal(`el inventario quedo en "${cerrado?.estado}", se esperaba conteo_cerrado`);

  const resultado = await prisma.resultadoInventario.findUnique({
    where: { inventarioId: inv }, select: { diasDelInventario: true, multaInasistencia: true, colaboradoresAsistieron: true },
  });
  resultado?.diasDelInventario === 3
    ? ok('los 3 dias quedaron congelados en el resultado del inventario')
    : mal(`diasDelInventario quedo en ${resultado?.diasDelInventario}, se esperaba 3`);

  // Asistencia completa: coord y cont1 (3 de 3). cont2 vino 1 de 3.
  resultado?.colaboradoresAsistieron === 2
    ? ok('2 personas con asistencia completa, que es lo que significa el campo ahora')
    : mal(`colaboradoresAsistieron dice ${resultado?.colaboradoresAsistieron}, se esperaba 2`);

  // =========================================================================
  console.log('\n== PASO 4: LA PLATA ==');

  const tarifa = Number(resultado?.multaInasistencia ?? 0);
  const sAud = await entrar(gente.aud.id, PIN);

  /**
   * SIN EL EXCEL DE AJUSTES NO HAY PLATA QUE MIRAR. La proyeccion devuelve
   * `null` -- no 0 -- en cuotaBase, totalFaltas, fondoMultas y compania
   * mientras `ResultadoInventario.montoNegativos` siga en NULL, porque un 0
   * ahi significaria "no hubo mermas" cuando en realidad significa "nadie las
   * cargo", y esa diferencia se le descuenta de mas a gente que no la debe.
   *
   * Se sube uno VALIDO Y VACIO: los 11 encabezados y cero filas. Eso es
   * `ok: true` y deja montoNegativos en 0 -- un cero real, "alguien miro y no
   * habia" -- que es lo que destraba la liquidacion.
   *
   * Va como BINARIO CRUDO, no multipart: el backend lo lee con express.raw().
   */
  const ExcelJS = (await import('exceljs')).default;
  const libro = new ExcelJS.Workbook();
  libro.addWorksheet('Ajustes').addRow([
    'Diario', 'Descripcion', 'Almacen', 'Codigo', 'Nombre2', 'Cantidad',
    'Precio', 'Importe', 'Motivo de ajuste', 'Registrado en', 'Responsable',
  ]);
  const xlsx = Buffer.from(await libro.xlsx.writeBuffer());
  const subida = await fetch(
    `${BASE}/api/liquidacion/inventarios/${inv}/ajustes-negativos/confirmar?nombreArchivo=ajustes-vacio.xlsx`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sAud?.token}`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      body: xlsx,
    },
  );
  subida.ok
    ? ok('ajustes importados (archivo valido y vacio): montoNegativos pasa de null a 0')
    : mal(`no se pudo importar el Excel de ajustes: HTTP ${subida.status} ${(await subida.text()).slice(0, 140)}`);
  const liq = await api('GET', `/api/liquidacion/sucursales/${tienda.id}`, { token: sAud?.token });
  if (liq.status !== 200 || liq.datos === null) {
    mal(`la proyeccion de liquidacion dio HTTP ${liq.status}: ${liq.texto.slice(0, 160)}`);
  } else {
    const L = liq.datos;
    const planilla = L.planilla ?? [];

    planilla.length === 3 && planilla.every((p) => p.colaboradorId !== gente.aud.id)
      ? ok('la planilla trae solo al personal de tienda: el auditor queda afuera')
      : mal(`la planilla trae ${planilla.length} filas y deberia traer 3 sin el auditor`);

    const fila = (id) => planilla.find((p) => p.colaboradorId === id);
    const f2 = fila(gente.cont2.id);
    f2?.diasAsistidos === 1
      ? ok(`quien vino un solo dia figura con 1 de ${L.diasDelInventario}`)
      : mal(`diasAsistidos de cont2 es ${f2?.diasAsistidos}, se esperaba 1`);

    /**
     * La fila NO expone la multa ni el bono por separado: expone `monto`, que
     * es `cuotaBase + multa - bono` ya calculado (el repo no guarda un total
     * al lado de sus partes, ver liquidacion.cierre.ts#armarPlanilla). Asi que
     * la multa se verifica por su EFECTO en la plata, que es lo que cobra la
     * persona.
     */
    Number(L.diasFaltadosEnTotal) === 2
      ? ok('2 dias faltados en total: uno solo falto, pero falto dos dias')
      : mal(`diasFaltadosEnTotal dice ${L.diasFaltadosEnTotal}, se esperaba 2`);

    /**
     * EL FONDO, POR LOS DOS CAMINOS. Es la comprobacion que motiva este
     * script: `totalFaltas x tarifa` daria 1 x 20 = 20, la mitad. El
     * multiplicando correcto es `diasFaltadosEnTotal`.
     */
    const fondo = Number(L.diasFaltadosEnTotal) * tarifa;
    const asistieronTodo = planilla.filter((p) => p.asistio).length;
    const repartido = Number(L.bonoAsistencia) * asistieronTodo;
    Math.abs(fondo - repartido) < 0.005
      ? ok(`el fondo cierra: ${L.diasFaltadosEnTotal} dias x ${tarifa} = ${fondo}, repartido entre ${asistieronTodo} = ${L.bonoAsistencia} c/u`)
      : mal(`el fondo NO cierra: ${L.diasFaltadosEnTotal} dias x ${tarifa} = ${fondo} pero se reparten ${repartido} (${L.bonoAsistencia} x ${asistieronTodo})`);

    Number(L.totalFaltas) * tarifa !== fondo
      ? ok(`y confirma el bug que se corrigio: totalFaltas x tarifa daria ${Number(L.totalFaltas) * tarifa}, no ${fondo}`)
      : info('en este escenario totalFaltas x tarifa coincide con el fondo: no distingue el bug');

    /**
     * LA INVARIANTE QUE NO SE PUEDE ROMPER: la planilla suma el neto.
     * `sum(cuota) + sum(multa) - sum(bono) = neto + fondo - fondo = neto`.
     * Si alguna vez alguien saca el bono, esta linea lo caza.
     */
    const suma = planilla.reduce((t, p) => t + Number(p.monto ?? 0), 0);
    const neto = Number(L.faltanteNeto ?? 0);
    Math.abs(neto) > 0.005
      ? ok(`hay neto de verdad que repartir (${neto.toFixed(2)}): la comprobacion de abajo no pasa sola`)
      : mal('el neto dio 0: la suma de la planilla se cumpliria sola y no probaria nada');
    Math.abs(suma - neto) < 0.02
      ? ok(`la planilla suma el neto: ${suma.toFixed(2)} contra ${neto.toFixed(2)}`)
      : mal(`la planilla NO suma el neto: ${suma.toFixed(2)} contra ${neto.toFixed(2)} (diferencia ${(suma - neto).toFixed(2)})`);

    // Quien falto dos dias paga, respecto de quien vino todos, la multa MAS el
    // bono que no cobra.
    const brecha = Number(fila(gente.cont2.id)?.monto) - Number(fila(gente.coord.id)?.monto);
    const brechaEsperada = 2 * tarifa + Number(L.bonoAsistencia);
    Math.abs(brecha - brechaEsperada) < 0.02
      ? ok(`quien falto 2 dias paga ${brecha.toFixed(2)} mas que quien vino todos (2 x ${tarifa} de multa + ${L.bonoAsistencia} de bono no cobrado)`)
      : mal(`la brecha es ${brecha.toFixed(2)} y se esperaba ${brechaEsperada.toFixed(2)}`);

    fila(gente.coord.id)?.asistio === true && fila(gente.cont2.id)?.asistio === false
      ? ok('asistio significa asistencia COMPLETA: true para 3 de 3, false para 1 de 3')
      : mal('asistio no refleja la asistencia completa');
  }
} finally {
  // =========================================================================
  if (!DEJAR) {
    console.log('\n== LIMPIEZA ==');
    const ids = [inv];
    await prisma.lineaConteo.deleteMany({ where: { conteo: { hoja: { inventarioId: inv } } } });
    await prisma.conteo.deleteMany({ where: { hoja: { inventarioId: inv } } });
    await prisma.empaque.deleteMany({ where: { producto: { hoja: { inventarioId: inv } } } });
    await prisma.producto.deleteMany({ where: { hoja: { inventarioId: inv } } });
    await prisma.hojaConteo.deleteMany({ where: { inventarioId: inv } });
    await prisma.empaqueCatalogo.deleteMany({ where: { catalogoItem: { inventarioId: inv } } });
    await prisma.catalogoItem.deleteMany({ where: { inventarioId: inv } });
    await prisma.resultadoInventario.deleteMany({ where: { inventarioId: { in: ids } } });
    await prisma.diferenciaItem.deleteMany({ where: { inventarioId: { in: ids } } });
    await prisma.aprobacionCierre.deleteMany({ where: { inventarioId: { in: ids } } });
    await prisma.liquidacionColaborador.deleteMany({ where: { inventarioId: { in: ids } } });
    await prisma.lineaAjusteDynamics.deleteMany({ where: { importacion: { inventarioId: inv } } });
    await prisma.importacionAjustesDynamics.deleteMany({ where: { inventarioId: { in: ids } } });
    /**
     * `asistencia_inventario` NO tiene claves foraneas hacia inventarios, asi
     * que no cae en cascada NI frena el borrado: si no se la borra aca, quedan
     * marcas huerfanas apuntando a un inventario que ya no existe.
     */
    await prisma.asistenciaInventario.deleteMany({ where: { inventarioId: inv } });
    await prisma.inventario.deleteMany({ where: { id: inv } });
    await prisma.sesionToken.deleteMany({ where: { colaborador: { sucursalId: tienda.id } } });
    await prisma.registroAuditoria.deleteMany({ where: { actor: { sucursalId: tienda.id } } });
    await prisma.colaborador.deleteMany({ where: { sucursalId: tienda.id } });
    await prisma.sucursal.delete({ where: { id: tienda.id } });
    ok('escenario borrado');
  } else {
    info(`--dejar: quedan la tienda ${tienda.id} y el inventario ${inv}`);
  }
  await prisma.$disconnect();
}

console.log('');
if (fallas === 0) {
  console.log('LA ASISTENCIA REGISTRADA FUNCIONA.');
  process.exit(0);
}
console.log(`${fallas} FALLA(S).`);
process.exit(1);
