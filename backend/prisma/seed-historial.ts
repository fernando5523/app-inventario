/**
 * Historico de demo: dos inventarios ya cerrados y lacrados de Luzuriaga,
 * para que la pantalla de historial tenga algo que mostrar y se pueda
 * validar con el cliente. Vive en su propio archivo y no dentro de seed.ts
 * porque son cosas distintas: seed.ts siembra el PADRON (las personas y las
 * tiendas reales, que existen igual), esto siembra DATOS DE EJEMPLO de un
 * proceso que todavia no corrio nunca.
 *
 * Los numeros NO son al azar: julio 2026 usa el ejemplo del mockup del
 * cliente (8.000 items, faltante bruto 1850 - 310 negativos - 150 empresa =
 * 1390 neto, 11 colaboradores, 3 faltas) y agosto 2026 los de la maqueta
 * mobile/design/liquidacion.html (2200 - 380 - 170 = 1650). Asi lo que se
 * ve en la pantalla se puede cruzar contra lo que el cliente ya aprobo.
 *
 * IDEMPOTENTE: si los inventarios de demo ya existen, no hace nada. Nunca
 * borra ni modifica un inventario que no sea suyo -- y no podria aunque
 * quisiera para los lacrados, que tienen el trigger de inmutabilidad.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { repartirExacto } from '../src/dominio/reparto-de-fondo';
import { armarContenidoLacrado, armarFolio, calcularHash, ALGORITMO_HASH } from '../src/modules/historial/historial.lacrado';

const prisma = new PrismaClient();

/** Ids altos y reservados para la demo: no chocan con los del padron real. */
const SUCURSAL_DEMO = 1; // Market Central Luzuriaga
const ID_JUNIO = 8001;
const ID_JULIO = 8002;
const ID_AGOSTO = 8003;

/** Los dos auditores de Luzuriaga del seed: son quienes firman el cierre. */
const GILMER = 103; // Gilmer Quispe, auditor
const ROSA = 106; // Rosa Melgarejo, auditor

/** Los 11 de Luzuriaga (ids del seed) con su asistencia al inventario. */
const PLANILLA = [
  { id: 101, nombre: 'José Tarazona', rol: 'coordinador' as const, asistio: true },
  { id: 102, nombre: 'María Rojas', rol: 'conteo' as const, asistio: true },
  { id: 103, nombre: 'Gilmer Quispe', rol: 'auditor' as const, asistio: true },
  { id: 104, nombre: 'Elena Príncipe', rol: 'conteo' as const, asistio: true },
  { id: 105, nombre: 'Walter Norabuena', rol: 'conteo' as const, asistio: true },
  { id: 106, nombre: 'Rosa Melgarejo', rol: 'auditor' as const, asistio: true },
  { id: 107, nombre: 'Luis Shuan', rol: 'conteo' as const, asistio: false },
  { id: 108, nombre: 'Carla Depaz', rol: 'conteo' as const, asistio: true },
  { id: 109, nombre: 'Manuel Chávez', rol: 'conteo' as const, asistio: false },
  { id: 110, nombre: 'Yeni Sotelo', rol: 'conteo' as const, asistio: false },
  { id: 111, nombre: 'Hugo Vergaray', rol: 'conteo' as const, asistio: true },
];

/**
 * Productos reales del catalogo de ejemplo ya validado en conteo.html.
 *
 * `precioVenta`, no costo: es lo que va a `DiferenciaItem.precioUnitario` y
 * el sistema NO conoce costos (el snapshot de Dynamics no los trae). La
 * propiedad se llamaba `costo` y sembraba en la base un dato que decia ser
 * una cosa y era otra -- justo lo que el rename de la columna vino a
 * arreglar.
 */
const ITEMS = [
  { codigo: 'IT-1001', descripcion: 'Aceite Vegetal Primor 900ml', precioVenta: 8.9 },
  { codigo: 'IT-1002', descripcion: 'Cerveza Cusqueña Dorada 620ml', precioVenta: 6.5 },
  { codigo: 'IT-1003', descripcion: 'Leche Evaporada Gloria 400g', precioVenta: 4.2 },
  { codigo: 'IT-1004', descripcion: 'Fideos Canuto Don Vittorio 500g', precioVenta: 3.8 },
  { codigo: 'IT-1005', descripcion: 'Arroz Costeño Extra 5kg', precioVenta: 24.5 },
  { codigo: 'IT-1006', descripcion: 'Azúcar Rubia Cartavio 1kg', precioVenta: 4.9 },
  { codigo: 'IT-1007', descripcion: 'Atún Florida en aceite 170g', precioVenta: 5.6 },
  { codigo: 'IT-1008', descripcion: 'Detergente Bolívar 780g', precioVenta: 9.3 },
];

interface DatosPeriodo {
  id: number;
  anio: number;
  mes: number;
  tamanoHoja: number;
  itemsTotales: number;
  itemsConDiferencia: number;
  itemsSegundoConteo: number;
  itemsTercerConteo: number;
  unidadesFaltantes: number;
  unidadesSobrantes: number;
  bruto: number;
  negativos: number;
  empresa: number;
  /** Diferencia por item: negativo = faltante. */
  diferencias: Array<{ i: number; stock: number; contado: number; ronda: number }>;
}

const JUNIO: DatosPeriodo = {
  id: ID_JUNIO,
  anio: 2026,
  mes: 6,
  tamanoHoja: 50,
  // Los numeros del mockup del cliente (docs/pantallas.md, Pantalla 4).
  itemsTotales: 8000,
  itemsConDiferencia: 130,
  itemsSegundoConteo: 650,
  itemsTercerConteo: 130,
  unidadesFaltantes: 412,
  unidadesSobrantes: 55,
  bruto: 1850,
  negativos: 310,
  empresa: 150,
  diferencias: [
    { i: 0, stock: 120, contado: 98, ronda: 3 },
    { i: 1, stock: 240, contado: 215, ronda: 3 },
    { i: 2, stock: 480, contado: 492, ronda: 2 },
    { i: 3, stock: 96, contado: 84, ronda: 3 },
    { i: 4, stock: 60, contado: 55, ronda: 2 },
    { i: 5, stock: 300, contado: 288, ronda: 3 },
  ],
};

const JULIO: DatosPeriodo = {
  id: ID_JULIO,
  anio: 2026,
  mes: 7,
  // Cambia el tamaño de hoja entre inventarios: es configurable
  // (docs/pantallas.md, Decision 4) y por eso se guarda POR inventario.
  tamanoHoja: 30,
  itemsTotales: 8000,
  itemsConDiferencia: 168,
  itemsSegundoConteo: 720,
  itemsTercerConteo: 168,
  unidadesFaltantes: 505,
  unidadesSobrantes: 61,
  bruto: 2050,
  negativos: 340,
  empresa: 160,
  diferencias: [
    { i: 0, stock: 130, contado: 101, ronda: 3 },
    { i: 1, stock: 260, contado: 302, ronda: 2 },
    { i: 2, stock: 500, contado: 471, ronda: 3 },
    { i: 3, stock: 100, contado: 92, ronda: 3 },
    { i: 5, stock: 320, contado: 305, ronda: 2 },
    { i: 6, stock: 180, contado: 156, ronda: 3 },
    { i: 7, stock: 75, contado: 68, ronda: 3 },
  ],
};

/** Plata SIEMPRE como Decimal, nunca Float: asi no se pierden centavos. */
const dec = (n: number): Prisma.Decimal => new Prisma.Decimal(n.toFixed(2));
const redondear = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Fecha fija por periodo: un seed que corre dos veces no debe dar fechas distintas. */
const fecha = (anio: number, mes: number, dia: number, hora: number): Date =>
  new Date(Date.UTC(anio, mes - 1, dia, hora, 0, 0));

async function sembrarPeriodo(d: DatosPeriodo, sucursalNombre: string): Promise<void> {
  const existente = await prisma.inventario.findUnique({ where: { id: d.id } });
  if (existente !== null) {
    console.log(`  ${d.anio}-${String(d.mes).padStart(2, '0')}: ya existe (id ${d.id}), no se toca.`);
    return;
  }

  const abiertoEn = fecha(d.anio, d.mes, 1, 9);
  const cerradoEn = fecha(d.anio, d.mes, 28, 18);

  // 1. El inventario, ya CERRADO: `abierto: null` para no ocupar el unico
  //    lugar de inventario abierto de la sucursal (el de d365 lo tiene).
  await prisma.inventario.create({
    data: {
      id: d.id,
      sucursalId: SUCURSAL_DEMO,
      estado: 'liquidado',
      periodoAnio: d.anio,
      periodoMes: d.mes,
      tamanoHoja: d.tamanoHoja,
      snapshotItems: d.itemsTotales,
      snapshotTomadoEn: abiertoEn,
      abiertoEn,
      cerradoEn,
      cerradoPorId: GILMER,
      abierto: null,
    },
  });

  // 2. El resumen del mes.
  const multa = 20;
  const asistieron = PLANILLA.filter((p) => p.asistio).length;
  await prisma.resultadoInventario.create({
    data: {
      inventarioId: d.id,
      itemsTotales: d.itemsTotales,
      itemsConDiferencia: d.itemsConDiferencia,
      itemsSegundoConteo: d.itemsSegundoConteo,
      itemsTercerConteo: d.itemsTercerConteo,
      unidadesFaltantes: d.unidadesFaltantes,
      unidadesSobrantes: d.unidadesSobrantes,
      montoFaltanteBruto: dec(d.bruto),
      montoNegativos: dec(d.negativos),
      montoFaltanteEmpresa: dec(d.empresa),
      colaboradoresAlcanzados: PLANILLA.length,
      colaboradoresAsistieron: asistieron,
      multaInasistencia: dec(multa),
      calculadoEn: cerradoEn,
    },
  });

  // 3. El detalle por item -- lo que responde "cuantas veces dio diferencia
  //    este producto este ano". Los mismos codigos en los dos periodos a
  //    proposito: sin repeticion no hay historico por articulo que mirar.
  for (const dif of d.diferencias) {
    const item = ITEMS[dif.i]!;
    const diferencia = dif.contado - dif.stock;
    await prisma.diferenciaItem.create({
      data: {
        inventarioId: d.id,
        codigo: item.codigo,
        descripcion: item.descripcion,
        stockSistema: dif.stock,
        conteoFinal: dif.contado,
        diferencia,
        resueltoEnConteo: dif.ronda,
        precioUnitario: dec(item.precioVenta),
        montoDiferencia: dec(redondear(diferencia * item.precioVenta)),
        createdAt: cerradoEn,
      },
    });
  }

  // 4. La planilla de descuentos. Se guardan las PARTES (cuota, multa,
  //    bono); el total se calcula -- ver historial.calculos.ts.
  const neto = redondear(d.bruto - d.negativos - d.empresa);
  const cuotaBase = redondear(neto / PLANILLA.length);
  const faltas = PLANILLA.length - asistieron;

  // El fondo se reparte EXACTO entre los asistentes: la suma de los bonos da
  // el fondo al centavo. Con `redondear(fondo / asistentes)` para todos, la
  // empresa a veces ponia y a veces se quedaba con la diferencia -- ver
  // src/dominio/reparto-de-fondo.ts.
  const fondo = redondear(faltas * multa);
  const bonos = repartirExacto(
    fondo,
    PLANILLA.filter((p) => p.asistio).map((p) => p.id),
  );

  for (const p of PLANILLA) {
    await prisma.liquidacionColaborador.create({
      data: {
        inventarioId: d.id,
        colaboradorId: p.id,
        nombreAlLiquidar: p.nombre,
        rolAlLiquidar: p.rol,
        asistio: p.asistio,
        cuotaBase: dec(cuotaBase),
        multaInasistencia: dec(p.asistio ? 0 : multa),
        bonoAsistencia: dec(bonos.get(p.id) ?? 0),
        createdAt: cerradoEn,
      },
    });
  }

  // 5. Las DOS firmas, de dos personas distintas y en dos momentos
  //    distintos: es el control de dos personas, no un boton doble.
  const firmaGilmer = fecha(d.anio, d.mes, 29, 10);
  const firmaRosa = fecha(d.anio, d.mes, 29, 14);
  await prisma.aprobacionCierre.create({
    data: { inventarioId: d.id, aprobadorId: GILMER, rolAlAprobar: 'auditor', aprobadoEn: firmaGilmer },
  });
  await prisma.aprobacionCierre.create({
    data: {
      inventarioId: d.id,
      aprobadorId: ROSA,
      rolAlAprobar: 'auditor',
      aprobadoEn: firmaRosa,
      nota: 'Revisado contra el reporte de negativos de Jocelyn.',
    },
  });

  // 6. El sello. El hash se calcula con las MISMAS funciones que usa el
  //    endpoint de lacrado, no con un valor inventado: asi
  //    GET /lacrado/verificacion sobre estos datos de demo da "intacto" de
  //    verdad, y la pantalla se puede validar de punta a punta.
  const inv = await prisma.inventario.findUniqueOrThrow({
    where: { id: d.id },
    include: {
      resultado: true,
      diferencias: { orderBy: { codigo: 'asc' } },
      liquidaciones: { orderBy: { colaboradorId: 'asc' } },
      aprobaciones: { orderBy: { aprobadorId: 'asc' } },
    },
  });

  const contenido = armarContenidoLacrado({
    inventarioId: inv.id,
    sucursalId: inv.sucursalId,
    sucursalNombre,
    periodoAnio: inv.periodoAnio,
    periodoMes: inv.periodoMes,
    tamanoHoja: inv.tamanoHoja,
    snapshotItems: inv.snapshotItems,
    snapshotTomadoEn: inv.snapshotTomadoEn?.toISOString() ?? null,
    cerradoEn: inv.cerradoEn?.toISOString() ?? null,
    resultado: {
      itemsTotales: inv.resultado!.itemsTotales,
      itemsConDiferencia: inv.resultado!.itemsConDiferencia,
      itemsSegundoConteo: inv.resultado!.itemsSegundoConteo,
      itemsTercerConteo: inv.resultado!.itemsTercerConteo,
      unidadesFaltantes: inv.resultado!.unidadesFaltantes,
      unidadesSobrantes: inv.resultado!.unidadesSobrantes,
      montoFaltanteBruto: inv.resultado!.montoFaltanteBruto.toNumber(),
      montoNegativos: inv.resultado!.montoNegativos.toNumber(),
      montoFaltanteEmpresa: inv.resultado!.montoFaltanteEmpresa.toNumber(),
      colaboradoresAlcanzados: inv.resultado!.colaboradoresAlcanzados,
      colaboradoresAsistieron: inv.resultado!.colaboradoresAsistieron,
      multaInasistencia: inv.resultado!.multaInasistencia.toNumber(),
    },
    diferencias: inv.diferencias.map((x) => ({
      codigo: x.codigo,
      stockSistema: x.stockSistema,
      conteoFinal: x.conteoFinal,
      diferencia: x.diferencia,
      resueltoEnConteo: x.resueltoEnConteo,
      montoDiferencia: x.montoDiferencia?.toNumber() ?? null,
    })),
    liquidaciones: inv.liquidaciones.map((x) => ({
      colaboradorId: x.colaboradorId,
      asistio: x.asistio,
      cuotaBase: x.cuotaBase.toNumber(),
      multaInasistencia: x.multaInasistencia.toNumber(),
      bonoAsistencia: x.bonoAsistencia.toNumber(),
    })),
    aprobaciones: inv.aprobaciones.map((x) => ({
      aprobadorId: x.aprobadorId,
      rolAlAprobar: x.rolAlAprobar,
      aprobadoEn: x.aprobadoEn.toISOString(),
    })),
  });

  const hash = calcularHash(contenido);
  const folio = armarFolio({
    periodoAnio: d.anio,
    periodoMes: d.mes,
    sucursalNombre,
    items: d.itemsTotales,
    hash,
  });

  const lacrado = await prisma.lacradoInventario.create({
    data: {
      inventarioId: d.id,
      folio,
      hash,
      hashAlgoritmo: ALGORITMO_HASH,
      contenido: contenido as Prisma.InputJsonValue,
      lacradoEn: fecha(d.anio, d.mes, 29, 16),
      lacradoPorId: GILMER,
      createdAt: fecha(d.anio, d.mes, 29, 16),
    },
  });

  await prisma.inventario.update({ where: { id: d.id }, data: { estado: 'lacrado' } });

  // Solo julio quedo registrado en el ERP: agosto muestra el estado
  // "lacrado pero pendiente de registro manual", que es un caso real -- la
  // maqueta lo muestra como dos tarjetas separadas.
  if (d.mes === 6) {
    await prisma.registroErpInventario.create({
      data: {
        lacradoId: lacrado.id,
        referencia: `AJ-${d.anio}-${String(d.mes).padStart(2, '0')}-0114`,
        registradoEn: fecha(d.anio, d.mes + 1, 2, 11),
        registradoPorId: GILMER,
      },
    });
  }

  console.log(`  ${d.anio}-${String(d.mes).padStart(2, '0')}: lacrado ${folio}`);
}

/**
 * Un tercer inventario con el conteo YA CERRADO pero SIN FIRMAR. Es el que
 * deja ver la pantalla de lacrado en su estado interesante ("0 / 2 aprobado",
 * boton de lacrar bloqueado) -- con solo inventarios ya lacrados, esa
 * pantalla no se puede validar con el cliente.
 */
async function sembrarPendienteDeFirma(): Promise<void> {
  const existente = await prisma.inventario.findUnique({ where: { id: ID_AGOSTO } });
  if (existente !== null) {
    console.log('  2026-08: ya existe (id 8003), no se toca.');
    return;
  }

  const abiertoEn = fecha(2026, 8, 1, 9);
  const cerradoEn = fecha(2026, 8, 28, 18);
  const multa = 20;
  const asistieron = PLANILLA.filter((p) => p.asistio).length;
  // Los numeros de mobile/design/liquidacion.html, que es la maqueta de
  // "Agosto 2026": 2200 - 380 - 170 = 1650, cuota 150 exacta.
  const bruto = 2200, negativos = 380, empresa = 170;
  const neto = redondear(bruto - negativos - empresa);
  const cuotaBase = redondear(neto / PLANILLA.length);
  // Reparto EXACTO del fondo, igual que en sembrarPeriodo.
  const bonos = repartirExacto(
    redondear((PLANILLA.length - asistieron) * multa),
    PLANILLA.filter((p) => p.asistio).map((p) => p.id),
  );

  await prisma.inventario.create({
    data: {
      id: ID_AGOSTO,
      sucursalId: SUCURSAL_DEMO,
      // Conteo cerrado y liquidado, pero SIN firmas: listo para que dos
      // personas distintas lo aprueben desde sus propias sesiones.
      estado: 'liquidado',
      periodoAnio: 2026,
      periodoMes: 8,
      tamanoHoja: 50,
      snapshotItems: 8000,
      snapshotTomadoEn: abiertoEn,
      abiertoEn,
      cerradoEn,
      cerradoPorId: GILMER,
      abierto: null,
    },
  });

  await prisma.resultadoInventario.create({
    data: {
      inventarioId: ID_AGOSTO,
      itemsTotales: 8000,
      itemsConDiferencia: 96,
      itemsSegundoConteo: 540,
      itemsTercerConteo: 96,
      unidadesFaltantes: 302,
      unidadesSobrantes: 48,
      montoFaltanteBruto: dec(bruto),
      montoNegativos: dec(negativos),
      montoFaltanteEmpresa: dec(empresa),
      colaboradoresAlcanzados: PLANILLA.length,
      colaboradoresAsistieron: asistieron,
      multaInasistencia: dec(multa),
      calculadoEn: cerradoEn,
    },
  });

  for (const dif of [
    { i: 0, stock: 125, contado: 110, ronda: 3 },
    { i: 2, stock: 490, contado: 478, ronda: 3 },
    { i: 4, stock: 65, contado: 71, ronda: 2 },
    { i: 7, stock: 80, contado: 74, ronda: 3 },
  ]) {
    const item = ITEMS[dif.i]!;
    const diferencia = dif.contado - dif.stock;
    await prisma.diferenciaItem.create({
      data: {
        inventarioId: ID_AGOSTO,
        codigo: item.codigo,
        descripcion: item.descripcion,
        stockSistema: dif.stock,
        conteoFinal: dif.contado,
        diferencia,
        resueltoEnConteo: dif.ronda,
        precioUnitario: dec(item.precioVenta),
        montoDiferencia: dec(redondear(diferencia * item.precioVenta)),
        createdAt: cerradoEn,
      },
    });
  }

  for (const p of PLANILLA) {
    await prisma.liquidacionColaborador.create({
      data: {
        inventarioId: ID_AGOSTO,
        colaboradorId: p.id,
        nombreAlLiquidar: p.nombre,
        rolAlLiquidar: p.rol,
        asistio: p.asistio,
        cuotaBase: dec(cuotaBase),
        multaInasistencia: dec(p.asistio ? 0 : multa),
        bonoAsistencia: dec(bonos.get(p.id) ?? 0),
        createdAt: cerradoEn,
      },
    });
  }

  console.log('  2026-08: liquidado y SIN FIRMAR (0 / 2) -- listo para probar el lacrado.');
}

async function main(): Promise<void> {
  const sucursal = await prisma.sucursal.findUnique({ where: { id: SUCURSAL_DEMO } });
  if (sucursal === null) {
    console.error('Corré primero `npm run prisma:seed`: falta el padron de sucursales.');
    process.exitCode = 1;
    return;
  }

  console.log(`Sembrando historico de demo en ${sucursal.nombre}:`);
  await sembrarPeriodo(JUNIO, sucursal.nombre);
  await sembrarPeriodo(JULIO, sucursal.nombre);
  await sembrarPendienteDeFirma();
  console.log('Listo: 2 inventarios lacrados + 1 esperando las dos firmas.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
