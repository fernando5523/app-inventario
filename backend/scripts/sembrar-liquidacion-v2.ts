/**
 * Deja un inventario en `conteo_cerrado`, LISTO PARA QUE EL AUDITOR LO
 * LIQUIDE, con los casos de la liquidacion v2 armados a proposito -- y
 * opcionalmente el Excel de ajustes de Dynamics que le corresponde.
 *
 * ---------------------------------------------------------------------------
 * EL CATALOGO ES FICTICIO, A PROPOSITO
 * ---------------------------------------------------------------------------
 * A diferencia de sembrar-inventario-prueba.ts y sembrar-tiendas-consolidado.ts,
 * el catalogo NO sale de Dynamics: precios y stocks son redondos e inventados
 * para que la liquidacion se pueda verificar A OJO en la pantalla (pedido
 * explicito). Con precios reales (S/3.90, S/12.45) cada monto es una cuenta.
 * Los codigos son `PRB-LIQ-NN` y las descripciones empiezan con "PRUEBA LIQ":
 * ClasificacionProducto es GLOBAL por codigo, y clasificar un codigo real
 * como empresa durante la prueba cambiaria liquidaciones reales.
 *
 * Solo el catalogo se inserta directo (no hay servicio que cree un catalogo
 * sin Dynamics), con la MISMA forma que `crearSnapshot`: un empaque "UND"
 * factor 1 por item, como un producto sin conversiones
 * (d365-catalogo.service.ts#elegirEmpaques). Todo lo demas usa los servicios
 * REALES: crearHojas, asignarHojas, guardarConteo, finalizar y cerrar (las 3
 * rondas -- con diferencias, cerrar la ronda 1 abre la 2; ver
 * sembrar-tiendas-consolidado.ts).
 *
 * ---------------------------------------------------------------------------
 * LOS CASOS (precio x diferencia = monto)
 * ---------------------------------------------------------------------------
 *   PRB-LIQ-01  faltante empleado   10.00 x -2 = -20.00
 *   PRB-LIQ-02  faltante empleado    5.00 x -4 = -20.00
 *   PRB-LIQ-03  faltante empleado   25.00 x -2 = -50.00
 *   PRB-LIQ-04  faltante empleado    2.50 x -4 = -10.00
 *   PRB-LIQ-05  CERVEZA, faltante    6.00 x -5 = -30.00   Dynamics dice EMPLEADO
 *   PRB-LIQ-06  sobrante empleado    4.00 x +5 = +20.00
 *   PRB-LIQ-07  sobrante empleado   15.00 x +2 = +30.00
 *   PRB-LIQ-08..12  cuadrados (conteo = stock)
 *
 * ---------------------------------------------------------------------------
 * RESULTADO ESPERADO -- neto = bruto - negativos - empresa - sobrante
 * ---------------------------------------------------------------------------
 * bruto = 130.00 siempre (TODOS los faltantes, cerveza incluida: asi lo
 * congela el cierre, ver liquidacion.reclasificacion.ts). sobrante = 50.00.
 * negativos = 40.00 al importar el Excel (la fila con importe que no cierra
 * es ADVERTENCIA y SUMA) o 30.00 si el Auditor la excluye.
 *
 *                               negativos 40   negativos 30
 *   cerveza sin clasificar      empresa  0.00  neto 40.00     neto 50.00
 *   cerveza = EMPRESA           empresa 30.00  neto 10.00     neto 20.00
 *
 * La clasificacion se evalua AL LIQUIDAR: hay que clasificar la cerveza
 * ANTES de liquidar. Despues de liquidar queda congelada.
 *
 * ---------------------------------------------------------------------------
 * TIENDA Y PERIODO
 * ---------------------------------------------------------------------------
 * Default: sucursal 35 (Market Prueba Conteo), periodo 2026-10. Al
 * 2026-09-11 NINGUNA tienda tenia libre el mensual de 2026-09
 * (@@unique([sucursalId, periodoAnio, periodoMes, tipo])), y la pantalla de
 * liquidacion toma el inventario MAS RECIENTE por periodo de la sucursal
 * (liquidacion.service.ts#deSucursal): un periodo pasado quedaria tapado por
 * el de septiembre. La 35 es la unica cuyo septiembre (inventario 45) ya esta
 * LACRADO -- no le tapa nada pendiente a nadie.
 *
 * ---------------------------------------------------------------------------
 * GUARDAS
 * ---------------------------------------------------------------------------
 *   - Se niega con NODE_ENV=production.
 *   - Dry-run por defecto: sin --confirmar no escribe NADA en la base.
 *   - ADITIVO: crea UN inventario nuevo con su catalogo. No crea, modifica
 *     ni borra usuarios ni tiendas. Este archivo no tiene ningun delete (el
 *     unico que corre es el interno de crearHojas, sobre el inventario recien
 *     creado y todavia vacio).
 *   - Inventarios 34 a 45 PROTEGIDOS: nunca se opera sobre ellos, y si el
 *     inventario creado cayera en ese rango se aborta antes de sembrar.
 *   - Se niega si el periodo ya esta ocupado en esa tienda, si la tienda
 *     tiene un inventario abierto, o si tiene uno de un periodo POSTERIOR
 *     (la pantalla no mostraria este).
 *
 *   npx tsx scripts/sembrar-liquidacion-v2.ts --dry-run   [--sucursal 35] [--periodo 2026-10] [--excel <ruta.xlsx>]
 *   npx tsx scripts/sembrar-liquidacion-v2.ts --confirmar [--sucursal 35] [--periodo 2026-10] [--excel <ruta.xlsx>]
 *
 *   --excel  Escribe el Excel de ajustes de ESA tienda y ESE periodo (no toca
 *            la base, vale tambien en --dry-run) y lo pasa por el lector
 *            real (liquidacion.ajustes-dynamics.ts) para mostrar que va a
 *            ver el Auditor al importarlo.
 */
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { prisma } from '../src/config/database';
import { calcularResumenLiquidacion, redondear } from '../src/modules/historial/historial.calculos';
import { finalizar, guardarConteo } from '../src/modules/hojas/hojas.service';
import { asignarHojas, crearHojas } from '../src/modules/inventarios/inventarios.service';
import { cerrar } from '../src/modules/inventarios/rondas.service';
import { leerAjustesDynamics } from '../src/modules/liquidacion/liquidacion.ajustes-dynamics';
import {
  reclasificarAlLiquidar,
  type FilaDiferenciaParaReclasificar,
} from '../src/modules/liquidacion/liquidacion.reclasificacion';
import { registrarAuditoria } from '../src/shared/auditoria';
import type { ColaboradorAutenticado, Rol } from '../src/shared/tipos';

const SUCURSAL_POR_DEFECTO = 35;
const PERIODO_POR_DEFECTO = { anio: 2026, mes: 10 };

/** Inventarios que este script no toca nunca -- los que se usan para probar el export y el lacrado. */
const INVENTARIOS_PROTEGIDOS = { desde: 34, hasta: 45 };

/** 12 items en hojas de 6: dos hojas en la ronda 1, una por persona en una tienda de dos. */
const TAMANO_HOJA = 6;
const RONDAS_MAXIMAS = 3;
const MULTA_POR_DEFECTO = 20;

type Papel = 'faltante' | 'sobrante' | 'cuadrado';

interface ItemDelPlan {
  codigo: string;
  descripcion: string;
  categoria: string;
  precio: number;
  stock: number;
  /** Lo que se siembra en CADA ronda: repetir el numero es lo que mantiene la diferencia hasta la 3ra. */
  contado: number;
  papel: Papel;
  /** El caso de Gilmer: Dynamics dice empleado, pero la asume la empresa. */
  esCerveza?: true;
}

const PLAN: readonly ItemDelPlan[] = [
  { codigo: 'PRB-LIQ-01', descripcion: 'PRUEBA LIQ - ARROZ 750G', categoria: 'ABARROTES', precio: 10, stock: 20, contado: 18, papel: 'faltante' },
  { codigo: 'PRB-LIQ-02', descripcion: 'PRUEBA LIQ - AZUCAR 1KG', categoria: 'ABARROTES', precio: 5, stock: 30, contado: 26, papel: 'faltante' },
  { codigo: 'PRB-LIQ-03', descripcion: 'PRUEBA LIQ - ACEITE 900ML', categoria: 'ABARROTES', precio: 25, stock: 10, contado: 8, papel: 'faltante' },
  { codigo: 'PRB-LIQ-04', descripcion: 'PRUEBA LIQ - FIDEO 500G', categoria: 'FIDEOS Y PASTAS', precio: 2.5, stock: 40, contado: 36, papel: 'faltante' },
  { codigo: 'PRB-LIQ-05', descripcion: 'PRUEBA LIQ - CERVEZA 630ML', categoria: 'CERVEZAS', precio: 6, stock: 24, contado: 19, papel: 'faltante', esCerveza: true },
  { codigo: 'PRB-LIQ-06', descripcion: 'PRUEBA LIQ - GALLETA SODA', categoria: 'GALLETAS', precio: 4, stock: 15, contado: 20, papel: 'sobrante' },
  { codigo: 'PRB-LIQ-07', descripcion: 'PRUEBA LIQ - DETERGENTE 900G', categoria: 'DETERGENTES', precio: 15, stock: 8, contado: 10, papel: 'sobrante' },
  { codigo: 'PRB-LIQ-08', descripcion: 'PRUEBA LIQ - SAL 1KG', categoria: 'ABARROTES', precio: 3, stock: 12, contado: 12, papel: 'cuadrado' },
  { codigo: 'PRB-LIQ-09', descripcion: 'PRUEBA LIQ - LECHE 400G', categoria: 'LACTEOS', precio: 8, stock: 24, contado: 24, papel: 'cuadrado' },
  { codigo: 'PRB-LIQ-10', descripcion: 'PRUEBA LIQ - ATUN 170G', categoria: 'CONSERVAS', precio: 12, stock: 6, contado: 6, papel: 'cuadrado' },
  { codigo: 'PRB-LIQ-11', descripcion: 'PRUEBA LIQ - JABON 90G', categoria: 'CUIDADO PERSONAL', precio: 1.5, stock: 50, contado: 50, papel: 'cuadrado' },
  { codigo: 'PRB-LIQ-12', descripcion: 'PRUEBA LIQ - CAFE 200G', categoria: 'ABARROTES', precio: 5, stock: 9, contado: 9, papel: 'cuadrado' },
];

// ---------------------------------------------------------------------------
// El Excel de ajustes -- 4 lineas validas y 2 rotas a proposito.
// ---------------------------------------------------------------------------

/** EXACTAMENTE los encabezados pedidos, en este orden. */
const ENCABEZADOS = [
  'Diario',
  'Descripcion',
  'Almacen',
  'Codigo',
  'Nombre2',
  'Cantidad',
  'Precio',
  'Importe',
  'Motivo de ajuste',
  'Registrado en',
  'Responsable',
] as const;

interface LineaExcel {
  diario: string;
  codigo: string;
  cantidad: number;
  precio: number;
  importe: number;
  /** Dia del mes del periodo: todos caen dentro del corte (29 del anterior al 28), ninguno en el borde. */
  dia: number;
  /** `otra-tienda` = va con el almacen de OTRA sucursal. */
  rota?: 'otra-tienda' | 'importe-no-cierra';
}

const LINEAS_EXCEL: readonly LineaExcel[] = [
  { diario: 'IAJ-PRB-0001', codigo: 'PRB-LIQ-01', cantidad: 1, precio: 10, importe: 10, dia: 3 },
  { diario: 'IAJ-PRB-0002', codigo: 'PRB-LIQ-02', cantidad: 2, precio: 5, importe: 10, dia: 8 },
  { diario: 'IAJ-PRB-0003', codigo: 'PRB-LIQ-04', cantidad: 2, precio: 2.5, importe: 5, dia: 14 },
  { diario: 'IAJ-PRB-0004', codigo: 'PRB-LIQ-12', cantidad: 1, precio: 5, importe: 5, dia: 20 },
  // 3 x 3.00 = 9.00, pero dice 10.00: ADVERTENCIA, sigue sumando hasta que el Auditor la excluya.
  { diario: 'IAJ-PRB-0005', codigo: 'PRB-LIQ-06', cantidad: 3, precio: 3, importe: 10, dia: 22, rota: 'importe-no-cierra' },
  // Importe grande a proposito: si llegara a sumarse, se nota a simple vista.
  { diario: 'IAJ-PRB-0006', codigo: 'PRB-LIQ-03', cantidad: 1, precio: 99, importe: 99, dia: 10, rota: 'otra-tienda' },
];

/** Lo que tiene que dar montoNegativos: todas menos la de otra tienda; y sin la del importe mal. */
const NEGATIVOS_AL_IMPORTAR = redondear(LINEAS_EXCEL.filter((l) => l.rota !== 'otra-tienda').reduce((s, l) => s + l.importe, 0));
const NEGATIVOS_EXCLUYENDO = redondear(LINEAS_EXCEL.filter((l) => l.rota === undefined).reduce((s, l) => s + l.importe, 0));

function leerArg(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre);
  return i === -1 ? undefined : process.argv[i + 1];
}

function enRangoProtegido(inventarioId: number): boolean {
  return inventarioId >= INVENTARIOS_PROTEGIDOS.desde && inventarioId <= INVENTARIOS_PROTEGIDOS.hasta;
}

async function escribirExcel(
  ruta: string,
  almacen: string,
  otroAlmacen: string,
  periodo: { anio: number; mes: number },
): Promise<void> {
  const porCodigo = new Map(PLAN.map((p) => [p.codigo, p]));
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Ajustes');
  hoja.addRow([...ENCABEZADOS]);
  hoja.getRow(1).font = { bold: true };

  for (const l of LINEAS_EXCEL) {
    hoja.addRow([
      l.diario,
      'Ajuste por análisis de Inventarios',
      l.rota === 'otra-tienda' ? otroAlmacen : almacen,
      l.codigo,
      porCodigo.get(l.codigo)?.descripcion ?? '',
      l.cantidad,
      l.precio,
      l.importe,
      'Sobrante único por unidad',
      // Mediodia UTC: ninguna zona horaria lo corre de dia.
      new Date(Date.UTC(periodo.anio, periodo.mes - 1, l.dia, 12, 0, 0)),
      'Empleado',
    ]);
  }

  hoja.getColumn(7).numFmt = '0.00';
  hoja.getColumn(8).numFmt = '0.00';
  hoja.getColumn(10).numFmt = 'dd/mm/yyyy';
  hoja.columns.forEach((c) => {
    c.width = 18;
  });

  await libro.xlsx.writeFile(ruta);
}

/** Pasa el Excel por el lector REAL y muestra lo que va a ver el Auditor. */
async function verificarExcel(ruta: string, almacen: string, periodo: { anio: number; mes: number }): Promise<void> {
  const r = await leerAjustesDynamics(await readFile(ruta), {
    almacenEsperado: almacen,
    periodoAnio: periodo.anio,
    periodoMes: periodo.mes,
  });
  if (!r.ok) {
    console.log(`  EL LECTOR RECHAZA EL ARCHIVO ENTERO: ${r.motivo} -- ${r.detalle}`);
    return;
  }
  for (const v of r.validas) {
    const adv = v.advertencias.length > 0 ? `  ADVERTENCIA: ${v.advertencias.join(', ')}` : '';
    console.log(`  fila ${v.fila}  VALIDA     ${v.codigo}  importe ${v.importe.toFixed(2)}${adv}`);
  }
  for (const x of r.rechazadas) {
    console.log(`  fila ${x.fila}  RECHAZADA  motivo: ${x.motivo}`);
  }
  console.log(`  montoNegativos al confirmar: ${redondear(r.totalImporte).toFixed(2)} (esperado ${NEGATIVOS_AL_IMPORTAR.toFixed(2)})`);
}

/**
 * El resultado esperado, calculado con las MISMAS funciones puras que usa
 * `liquidar()` (reclasificarAlLiquidar + calcularResumenLiquidacion). Tiene
 * que coincidir con la tabla de la cabecera, que esta hecha a mano: si no
 * coinciden, el error esta en uno de los dos y hay que mirarlo antes de
 * probar nada en la app.
 */
function imprimirEsperado(personas: number): void {
  const filas: FilaDiferenciaParaReclasificar[] = PLAN.filter((p) => p.papel !== 'cuadrado').map((p) => ({
    codigo: p.codigo,
    diferencia: p.contado - p.stock,
    montoDiferencia: redondear((p.contado - p.stock) * p.precio),
    esEmpresaCatalogo: false,
  }));
  const bruto = redondear(filas.filter((f) => f.diferencia < 0).reduce((s, f) => s - (f.montoDiferencia ?? 0), 0));
  const cerveza = PLAN.find((p) => p.esCerveza)!;

  const escenarios: Array<[string, Map<string, boolean>]> = [
    ['cerveza sin clasificar', new Map()],
    ['cerveza = EMPRESA     ', new Map([[cerveza.codigo, true]])],
  ];

  console.log(`\nRESULTADO ESPERADO (bruto ${bruto.toFixed(2)}; ${personas} persona(s), todas asistiendo):`);
  for (const [nombre, clasificacion] of escenarios) {
    const r = reclasificarAlLiquidar(filas, clasificacion);
    const celdas = [NEGATIVOS_AL_IMPORTAR, NEGATIVOS_EXCLUYENDO].map((negativos) => {
      const res = calcularResumenLiquidacion({
        montoFaltanteBruto: bruto,
        montoNegativos: negativos,
        montoFaltanteEmpresa: r.montoFaltanteEmpresa,
        montoSobranteEmpleado: r.montoSobranteEmpleado,
        colaboradoresAlcanzados: personas,
        colaboradoresAsistieron: personas,
        multaInasistencia: MULTA_POR_DEFECTO,
      });
      return `neg ${negativos.toFixed(2)} -> neto ${res.montoFaltanteNeto.toFixed(2)} (cuota ${res.cuotaBase.toFixed(2)})`;
    });
    console.log(
      `  ${nombre}  empresa ${r.montoFaltanteEmpresa.toFixed(2)}  sobrante ${r.montoSobranteEmpleado.toFixed(2)}  |  ${celdas.join('  |  ')}`,
    );
  }
}

/** Siembra una ronda: cada hoja a nombre de quien la tiene asignada, con el mismo numero en cada ronda. */
async function sembrarRonda(inventarioId: number, ronda: number, contadoPorCodigo: Map<string, number>): Promise<number> {
  const hojas = await prisma.hojaConteo.findMany({
    where: { inventarioId, numeroConteo: ronda },
    select: {
      id: true,
      asignadoA: { select: { id: true, rol: true, sucursalId: true } },
      productos: { select: { id: true, codigo: true } },
    },
    orderBy: { id: 'asc' },
  });

  let conteos = 0;
  for (const hoja of hojas) {
    if (!hoja.asignadoA) throw new Error(`La hoja ${hoja.id} (ronda ${ronda}) quedo sin asignar.`);
    const actor: ColaboradorAutenticado = {
      colaboradorId: hoja.asignadoA.id,
      sucursalId: hoja.asignadoA.sucursalId,
      rol: hoja.asignadoA.rol as Rol,
    };
    for (const producto of hoja.productos) {
      const sueltas = contadoPorCodigo.get(producto.codigo);
      if (sueltas === undefined) throw new Error(`El producto ${producto.codigo} no esta en el plan.`);
      await guardarConteo(actor, hoja.id, producto.id, {
        empaques: [],
        sueltas,
        confirmadoPorEscaner: false,
        contadoEn: new Date(),
      });
      conteos++;
    }
    await finalizar(actor, hoja.id);
  }
  return conteos;
}

async function main(): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.error('SE NIEGA: NODE_ENV=production. Este script siembra datos de PRUEBA, nunca corre contra produccion.');
    return 1;
  }

  const modo = process.argv[2];
  if (modo !== '--dry-run' && modo !== '--confirmar') {
    console.error(
      'Uso: npx tsx scripts/sembrar-liquidacion-v2.ts --dry-run|--confirmar [--sucursal <id>] [--periodo AAAA-MM] [--excel <ruta.xlsx>]',
    );
    return 1;
  }
  const dryRun = modo === '--dry-run';

  const sucursalId = Number(leerArg('--sucursal') ?? SUCURSAL_POR_DEFECTO);
  if (!Number.isInteger(sucursalId) || sucursalId <= 0) {
    console.error(`--sucursal invalido: "${leerArg('--sucursal')}".`);
    return 1;
  }

  const periodoArg = leerArg('--periodo');
  const periodo = { ...PERIODO_POR_DEFECTO };
  if (periodoArg !== undefined) {
    const m = /^(\d{4})-(\d{2})$/.exec(periodoArg);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
      console.error(`--periodo invalido: "${periodoArg}". Formato AAAA-MM.`);
      return 1;
    }
    periodo.anio = Number(m[1]);
    periodo.mes = Number(m[2]);
  }
  const rutaExcel = leerArg('--excel');

  const sucursal = await prisma.sucursal.findUnique({
    where: { id: sucursalId },
    select: { id: true, nombre: true, almacenId: true, activa: true },
  });
  if (!sucursal) {
    console.error(`No existe la sucursal ${sucursalId}.`);
    return 1;
  }
  if (!sucursal.activa) {
    console.error(`La sucursal ${sucursalId} ("${sucursal.nombre}") esta deshabilitada.`);
    return 1;
  }
  if (!sucursal.almacenId) {
    console.error(`La sucursal ${sucursalId} no tiene almacen: el import del Excel no podria saber que lineas son de otra tienda.`);
    return 1;
  }

  const personal = await prisma.colaborador.findMany({
    where: { sucursalId, activo: true },
    select: { id: true, nombre: true, rol: true },
    orderBy: { id: 'asc' },
  });
  if (personal.length === 0) {
    console.error(`La sucursal ${sucursalId} no tiene personal activo: no hay a nombre de quien contar. Este script no crea usuarios.`);
    return 1;
  }

  // --- Guardas de la tienda: periodo libre, nada abierto, nada posterior.
  const inventarios = await prisma.inventario.findMany({
    where: { sucursalId },
    select: { id: true, estado: true, abierto: true, periodoAnio: true, periodoMes: true, tipo: true },
  });
  const ocupado = inventarios.find((i) => i.tipo === 'mensual' && i.periodoAnio === periodo.anio && i.periodoMes === periodo.mes);
  const abierto = inventarios.find((i) => i.abierto === true);
  const posterior = inventarios.find((i) => i.periodoAnio * 12 + i.periodoMes > periodo.anio * 12 + periodo.mes);

  const otra = await prisma.sucursal.findFirst({
    where: { id: { not: sucursalId }, almacenId: { not: null } },
    select: { almacenId: true },
    orderBy: { id: 'asc' },
  });
  const otroAlmacen = otra?.almacenId ?? 'MD99_OTRA';

  const hojasRonda1 = Math.ceil(PLAN.length / TAMANO_HOJA);
  console.log(`--- Siembra liquidacion v2 (${dryRun ? 'DRY RUN, no se escribe nada en la base' : 'MODO REAL'}) ---`);
  console.log(`Tienda: ${sucursal.id} "${sucursal.nombre}"  almacen ${sucursal.almacenId}`);
  console.log(`Periodo: ${periodo.anio}-${String(periodo.mes).padStart(2, '0')} mensual`);
  console.log(`Personal que cuenta (${personal.length}): ${personal.map((p) => `${p.id} ${p.nombre} (${p.rol})`).join(', ')}`);
  console.log(`Items: ${PLAN.length} en hojas de ${TAMANO_HOJA} (${hojasRonda1} hoja(s) en la ronda 1)`);
  console.log(`Protegidos: inventarios ${INVENTARIOS_PROTEGIDOS.desde} a ${INVENTARIOS_PROTEGIDOS.hasta}; usuarios y tiendas no se tocan.`);
  if (personal.length > hojasRonda1) {
    console.log(`AVISO: ${personal.length} personas y ${hojasRonda1} hojas -- alguien va a quedar sin hoja y figurar AUSENTE (multa).`);
  }

  const problemas: string[] = [];
  if (ocupado) problemas.push(`el periodo ya esta ocupado en esta tienda por el inventario ${ocupado.id} (${ocupado.estado})`);
  if (abierto) problemas.push(`la tienda tiene abierto el inventario ${abierto.id} (${abierto.estado})`);
  if (posterior) {
    problemas.push(
      `la tienda tiene el inventario ${posterior.id} de un periodo POSTERIOR (${posterior.periodoAnio}-${posterior.periodoMes}): ` +
        'la pantalla de liquidacion mostraria ese y no este',
    );
  }

  imprimirEsperado(personal.length);

  if (rutaExcel !== undefined) {
    await escribirExcel(rutaExcel, sucursal.almacenId, otroAlmacen, periodo);
    console.log(`\nEXCEL escrito en ${rutaExcel} (otra tienda = ${otroAlmacen}). Lo que va a ver el Auditor al importarlo:`);
    await verificarExcel(rutaExcel, sucursal.almacenId, periodo);
    console.log(`  excluyendo la fila del importe que no cierra: ${NEGATIVOS_EXCLUYENDO.toFixed(2)}`);
  }

  if (problemas.length > 0) {
    console.error(`\nSE NIEGA: ${problemas.join('; ')}. No se escribio nada.`);
    return 1;
  }

  if (dryRun) {
    console.log('\nDRY RUN: la tienda y el periodo estan libres. No se escribio nada en la base. Correr con --confirmar.');
    return 0;
  }

  const admin = await prisma.colaborador.findFirst({ where: { rol: 'administrador', activo: true }, select: { id: true } });
  if (!admin) {
    console.error('No hay ningun administrador activo -- hace falta uno como actor de crearHojas/asignar/cerrar.');
    return 1;
  }
  const actorAdmin: ColaboradorAutenticado = { colaboradorId: admin.id, sucursalId: null, rol: 'administrador' };

  // --- 1. Inventario + catalogo ficticio (misma forma que crearSnapshot).
  const inventario = await prisma.inventario.create({
    data: {
      sucursalId,
      tipo: 'mensual',
      periodoAnio: periodo.anio,
      periodoMes: periodo.mes,
      tamanoHoja: TAMANO_HOJA,
      snapshotItems: PLAN.length,
      snapshotTomadoEn: new Date(),
    },
    select: { id: true },
  });
  if (enRangoProtegido(inventario.id)) {
    // No puede pasar con un autoincrement que ya va por encima de 45, pero si
    // pasara se corta ACA, antes de sembrarle un solo conteo encima.
    console.error(`El inventario creado tiene id ${inventario.id}, dentro del rango PROTEGIDO. Abortado antes de sembrar.`);
    return 1;
  }
  await prisma.$transaction(
    PLAN.map((item, i) =>
      prisma.catalogoItem.create({
        data: {
          inventarioId: inventario.id,
          codigo: item.codigo,
          codigoBarras: `99900000000${String(i + 1).padStart(2, '0')}`,
          descripcion: item.descripcion,
          categoria: item.categoria,
          // Dynamics dice EMPLEADO para TODOS, cerveza incluida: ese es el caso.
          esEmpresa: false,
          responsable: 'empleado',
          stockErp: item.stock,
          precioVenta: item.precio,
          empaques: { create: [{ nombre: 'UND', factor: 1, orden: 0 }] },
        },
      }),
    ),
  );
  await registrarAuditoria({
    actorId: admin.id,
    accion: 'inventario.sembrado_prueba',
    entidad: 'inventario',
    entidadId: inventario.id,
    detalle: { script: 'sembrar-liquidacion-v2.ts', catalogo: 'FICTICIO: precios y stocks inventados para verificar la liquidacion a ojo' },
  });
  console.log(`\n+ inventario ${inventario.id} con ${PLAN.length} items`);

  // --- 2. Hojas y las 3 rondas: asignar -> sembrar -> finalizar -> cerrar.
  await crearHojas(actorAdmin, inventario.id, TAMANO_HOJA);
  const contadoPorCodigo = new Map(PLAN.map((p) => [p.codigo, p.contado]));
  const ids = personal.map((p) => p.id);

  for (let ronda = 1; ronda <= RONDAS_MAXIMAS; ronda++) {
    await asignarHojas(actorAdmin, inventario.id, ids);
    const conteos = await sembrarRonda(inventario.id, ronda, contadoPorCodigo);
    const cierre = await cerrar(actorAdmin, inventario.id, ronda);
    console.log(
      `  ronda ${ronda}: ${conteos} conteo(s) -> ` +
        (cierre.rondaAbierta ? `abre la ronda ${cierre.rondaAbierta}` : `CIERRA el conteo (${cierre.motivoSinSiguiente})`),
    );
    if (!cierre.rondaAbierta) break;
  }

  // --- 3. Lo que quedo, leido de la base.
  const final = await prisma.inventario.findUniqueOrThrow({
    where: { id: inventario.id },
    select: {
      estado: true,
      resultado: {
        select: {
          montoFaltanteBruto: true,
          montoFaltanteEmpresa: true,
          montoNegativos: true,
          colaboradoresAlcanzados: true,
          colaboradoresAsistieron: true,
        },
      },
      _count: { select: { diferencias: true } },
    },
  });
  const r = final.resultado;
  console.log(`\nInventario ${inventario.id}: estado=${final.estado}  diferencias=${final._count.diferencias}`);
  if (r) {
    console.log(
      `  bruto ${r.montoFaltanteBruto.toFixed(2)}  empresa(cierre, solo Dynamics) ${r.montoFaltanteEmpresa.toFixed(2)}  ` +
        `negativos ${r.montoNegativos === null ? 'NULL (falta importar el Excel)' : r.montoNegativos.toFixed(2)}  ` +
        `alcanzados ${r.colaboradoresAlcanzados}  asistieron ${r.colaboradoresAsistieron ?? 'NULL'}`,
    );
  }
  console.log(`El inventario queda listo para: importar el Excel -> (clasificar la cerveza) -> liquidar.`);
  return final.estado === 'conteo_cerrado' ? 0 : 1;
}

main()
  .then(async (codigo) => {
    await prisma.$disconnect();
    process.exit(codigo);
  })
  .catch(async (e: unknown) => {
    console.error('[ERROR]', e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });
