/**
 * Cierre de pendientes: verifica contra la BASE y la API real
 *   1. que la auditoria lea stock_erp del catalogo y distinga NULL de 0;
 *   2. que el camino de rotacion de PIN funcione con los permisos correctos;
 *   3. las tres reglas del historico/lacrado, escribiendo DIRECTO en Postgres.
 *
 * El punto 3 no usa la API a proposito: una regla que solo vive en un `if`
 * del servicio la saltea cualquiera que escriba directo en la tabla.
 */
import { PrismaClient } from '@prisma/client';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const prisma = new PrismaClient();
let fallas = 0;
const ok = (t) => console.log('  [OK]    ' + t);
const mal = (t) => { console.log('  [FALLA] ' + t); fallas += 1; };

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

const ingresar = async (id, pin = String(id).padStart(6, '0')) => {
  const r = await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: id, pin } });
  return r.status === 200 ? r.datos : null;
};

class Rollback extends Error {}

/** Algo que la BASE tiene que rechazar, sin abortar la transaccion entera. */
async function debeRechazar(tx, etiqueta, fn) {
  await tx.$executeRawUnsafe('SAVEPOINT sp');
  try {
    await fn();
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp');
    mal(`${etiqueta} -- la base lo ACEPTO`);
  } catch (e) {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp');
    if (e.code === 'P2002') ok(`${etiqueta} -> P2002 sobre (${e.meta.target.join(', ')})`);
    else if (/inmutable|no se puede modificar/i.test(e.message ?? '')) ok(`${etiqueta} -> el TRIGGER de Postgres lo bloqueo`);
    else mal(`${etiqueta} -- fallo con otro error: ${e.code ?? e.message}`);
  }
}

// ===========================================================================
console.log('== 1. STOCK DEL ERP: la auditoria distingue "sin dato" de "cero" ==');
{
  const total = await prisma.catalogoItem.count();
  const sinStock = await prisma.catalogoItem.count({ where: { stockErp: null } });
  console.log(`  catalogo: ${total} items, ${sinStock} sin stock del ERP`);

  const gilmer = await ingresar(103);
  if (gilmer === null) { mal('no se pudo ingresar como auditor'); }
  else {
    // El inventario con los 11.835 productos reales sin stock cargado.
    const conCatalogoReal = await prisma.catalogoItem.groupBy({
      by: ['inventarioId'],
      _count: true,
      orderBy: { _count: { inventarioId: 'desc' } },
      take: 1,
    });
    const invGrande = conCatalogoReal[0]?.inventarioId;

    const admin = await ingresar(1000);
    if (admin !== null && invGrande !== undefined) {
      const r = await api('GET', `/api/auditoria/inventarios/${invGrande}/resumen`, { token: admin.token });
      if (r.status !== 200) mal(`resumen del inventario ${invGrande}: ${r.status} ${r.texto}`);
      else {
        const s = r.datos.resumen;
        s.cuadrados === 0 && s.sinDatoErp > 0
          ? ok(`inventario ${invGrande}: ${s.sinDatoErp} items SIN DATO DEL ERP, ${s.cuadrados} cuadrados — no dice "100% cuadrado"`)
          : mal(`el resumen sigue mintiendo: cuadrados=${s.cuadrados}, sinDatoErp=${s.sinDatoErp}`);

        s.auditables === 0 && s.porcentajeAuditable === 0
          ? ok('porcentajeAuditable=0%: dice que hoy no se puede auditar nada de ese inventario')
          : mal(`auditables=${s.auditables}, porcentajeAuditable=${s.porcentajeAuditable}`);
      }

      const m = await api('GET', `/api/auditoria/inventarios/${invGrande}/matriz?limite=1`, { token: admin.token });
      const fila = m.datos?.matriz?.[0];
      fila?.stockErp === null && fila.diferenciaUnidades === null && fila.veredicto === 'sin_erp'
        ? ok(`la fila viaja con stockErp=null y diferencia=null, veredicto "${fila.veredicto}"`)
        : mal(`la fila: ${JSON.stringify(fila)}`);
      fila?.motivoSinDato !== null && fila?.motivoSinDato !== undefined
        ? ok(`y con el motivo legible: "${fila.motivoSinDato.slice(0, 62)}..."`)
        : mal('falta motivoSinDato');
    }

    // El inventario de demo, que SI tiene stock: sigue auditando bien.
    const demo = await api('GET', '/api/auditoria/inventarios/8004/resumen', { token: gilmer.token });
    demo.status === 200 && demo.datos.resumen.auditables > 0
      ? ok(`el inventario con stock cargado sigue auditando: ${demo.datos.resumen.auditables} auditables, ${demo.datos.resumen.cuadrados} cuadrados (${demo.datos.resumen.porcentajeCuadrado}%)`)
      : mal(`demo: ${demo.status} ${JSON.stringify(demo.datos?.resumen)}`);
  }
}

// ===========================================================================
console.log('\n== 2. ROTACION DE PIN ==');
{
  const admin = await ingresar(1000);
  const gilmer = await ingresar(103);   // auditor Luzuriaga
  const nilda = await ingresar(203);    // auditor Carhuaz
  const maria = await ingresar(102);    // conteo Luzuriaga

  if (admin === null || gilmer === null) { mal('no se pudo ingresar'); }
  else {
    // -- El administrador resetea a cualquiera ------------------------------
    const NUEVO = '778899';
    const r1 = await api('POST', '/api/usuarios/111/resetear-pin', { token: admin.token, body: { pin: NUEVO } });
    r1.status === 204 ? ok('el administrador resetea el PIN de un colaborador: 204') : mal(`admin reseteando: ${r1.status} ${r1.texto}`);

    const conNuevo = await ingresar(111, NUEVO);
    conNuevo !== null ? ok('y el colaborador PUEDE ingresar con el PIN nuevo: el cambio llego a la base') : mal('el PIN nuevo no sirve para ingresar');

    const conViejo = await ingresar(111, '000111');
    conViejo === null ? ok('y ya NO puede ingresar con el viejo') : mal('el PIN viejo sigue funcionando');

    // Se lo devuelve al valor del seed: los PIN predecibles sirven para probar.
    await api('POST', '/api/usuarios/111/resetear-pin', { token: admin.token, body: { pin: '000111' } });
    ok('restaurado al PIN del seed para no romper las pruebas de nadie');

    // -- El auditor, solo su sucursal ---------------------------------------
    const propio = await api('POST', '/api/usuarios/107/resetear-pin', { token: gilmer.token, body: { pin: '000107' } });
    propio.status === 204 ? ok('el auditor resetea a un colaborador DE SU sucursal: 204') : mal(`auditor en su sucursal: ${propio.status}`);

    if (nilda !== null) {
      const ajeno = await api('POST', '/api/usuarios/107/resetear-pin', { token: nilda.token, body: { pin: '999999' } });
      ajeno.status === 403 ? ok('un auditor de OTRA sucursal: 403') : mal(`auditor de otra sucursal: ${ajeno.status}`);
    }

    const aOtroAuditor = await api('POST', '/api/usuarios/106/resetear-pin', { token: gilmer.token, body: { pin: '999999' } });
    aOtroAuditor.status === 403 ? ok('un auditor NO resetea a otro auditor: 403') : mal(`auditor a auditor: ${aOtroAuditor.status}`);

    const alAdmin = await api('POST', '/api/usuarios/1000/resetear-pin', { token: gilmer.token, body: { pin: '999999' } });
    alAdmin.status === 403 ? ok('un auditor NO resetea al administrador: 403') : mal(`auditor al admin: ${alAdmin.status}`);

    if (maria !== null) {
      const conteo = await api('POST', '/api/usuarios/104/resetear-pin', { token: maria.token, body: { pin: '999999' } });
      conteo.status === 403 ? ok('el rol conteo no resetea a nadie: 403') : mal(`conteo reseteando: ${conteo.status}`);
    }

    // -- Cambiar el PIN PROPIO ----------------------------------------------
    if (maria !== null) {
      const MIO = '445566';
      const cambio = await api('POST', '/api/sesion/cambiar-pin', {
        token: maria.token,
        body: { pinActual: '000102', pinNuevo: MIO },
      });
      if (cambio.status === 404) {
        mal('NO EXISTE el endpoint de cambio de PIN propio');
      } else if (cambio.status === 204) {
        ok('un colaborador cambia SU PROPIO PIN: 204');

        const conMio = await ingresar(102, MIO);
        conMio !== null ? ok('e ingresa con el nuevo') : mal('el PIN propio nuevo no sirve');

        const sinElActual = await api('POST', '/api/sesion/cambiar-pin', {
          token: conMio?.token ?? maria.token,
          body: { pinActual: '000000', pinNuevo: '112233' },
        });
        sinElActual.status === 401
          ? ok('con el PIN actual equivocado: 401 — un token robado no alcanza para cambiar el PIN')
          : mal(`PIN actual equivocado: ${sinElActual.status}`);

        const predecible = await api('POST', '/api/sesion/cambiar-pin', {
          token: conMio?.token ?? maria.token,
          body: { pinActual: MIO, pinNuevo: '000102' },
        });
        predecible.status === 400
          ? ok('y rechaza volver al PIN predecible del seed (el id con ceros): 400')
          : mal(`PIN predecible: ${predecible.status}`);

        // Restaurar
        await api('POST', '/api/usuarios/102/resetear-pin', { token: admin.token, body: { pin: '000102' } });
        ok('restaurado al PIN del seed');
      } else {
        mal(`cambio de PIN propio: ${cambio.status} ${cambio.texto}`);
      }
    }
  }
}

// ===========================================================================
console.log('\n== 3. LAS TRES REGLAS, ESCRIBIENDO DIRECTO EN POSTGRES ==');
try {
  await prisma.$transaction(async (tx) => {
    const suc = await tx.sucursal.create({ data: { id: 9101, nombre: 'Market Prueba Cierre' } });
    const a1 = await tx.colaborador.create({ data: { id: 9101, nombre: 'Auditor A', dni: '91010001', rol: 'auditor', pinHash: 'x', sucursalId: suc.id } });
    const a2 = await tx.colaborador.create({ data: { id: 9102, nombre: 'Auditor B', dni: '91010002', rol: 'auditor', pinHash: 'x', sucursalId: suc.id } });

    // -- Regla 1 -------------------------------------------------------------
    const inv = await tx.inventario.create({ data: { id: 9101, sucursalId: suc.id, periodoAnio: 2027, periodoMes: 1 } });
    ok(`inventario creado, nace abierto sin declararlo (abierto=${inv.abierto})`);

    await debeRechazar(tx, 'REGLA 1: un segundo inventario ABIERTO en la misma sucursal', () =>
      tx.inventario.create({ data: { id: 9102, sucursalId: suc.id, periodoAnio: 2027, periodoMes: 2 } }));

    await tx.inventario.update({ where: { id: 9101 }, data: { estado: 'conteo_cerrado', abierto: null } });
    await tx.inventario.create({ data: { id: 9103, sucursalId: suc.id, periodoAnio: 2027, periodoMes: 2 } });
    ok('  al cerrar el primero (abierto=NULL) la sucursal se libera');

    // -- Regla 3 (aprobaciones) ---------------------------------------------
    await tx.aprobacionCierre.create({ data: { id: 9101, inventarioId: 9101, aprobadorId: a1.id, rolAlAprobar: 'auditor' } });
    ok(`firma 1 registrada: ${a1.nombre}`);

    await debeRechazar(tx, 'REGLA 3: la MISMA persona dando las dos aprobaciones', () =>
      tx.aprobacionCierre.create({ data: { id: 9102, inventarioId: 9101, aprobadorId: a1.id, rolAlAprobar: 'auditor' } }));

    await tx.aprobacionCierre.create({ data: { id: 9103, inventarioId: 9101, aprobadorId: a2.id, rolAlAprobar: 'auditor' } });
    ok(`  firma 2 de OTRA persona aceptada: ${a2.nombre}`);

    // -- Regla 2 (inmutabilidad) --------------------------------------------
    await tx.lacradoInventario.create({
      data: { id: 9101, inventarioId: 9101, folio: 'INV-2027-01-PRU-0-ZZZ', hash: 'z'.repeat(64), contenido: { version: 1 }, lacradoPorId: a1.id },
    });
    await tx.inventario.update({ where: { id: 9101 }, data: { estado: 'lacrado', abierto: null } });
    ok('inventario lacrado');

    await debeRechazar(tx, 'REGLA 2: UPDATE del hash de un sello', () =>
      tx.lacradoInventario.update({ where: { id: 9101 }, data: { hash: 'f'.repeat(64) } }));
    await debeRechazar(tx, 'REGLA 2: DELETE del sello', () =>
      tx.lacradoInventario.delete({ where: { id: 9101 } }));
    await debeRechazar(tx, 'REGLA 2: UPDATE de una firma para cambiar QUIEN aprobo', () =>
      tx.aprobacionCierre.update({ where: { id: 9101 }, data: { aprobadorId: a2.id } }));
    await debeRechazar(tx, 'REGLA 2 bis: un SEGUNDO lacrado sobre el mismo inventario', () =>
      tx.lacradoInventario.create({ data: { id: 9104, inventarioId: 9101, folio: 'X', hash: 'y'.repeat(64), contenido: {}, lacradoPorId: a2.id } }));

    const sello = await tx.lacradoInventario.findUnique({ where: { id: 9101 } });
    sello.hash === 'z'.repeat(64) ? ok('  el sello sigue con su hash original tras los 4 intentos') : mal('el sello cambio');

    throw new Rollback();
  }, { timeout: 30000 });
} catch (e) {
  if (!(e instanceof Rollback)) { console.error('  ERROR INESPERADO:', e.code ?? e.message); fallas += 1; }
}

const invs = await prisma.inventario.count();
console.log(`\nRollback aplicado: la base sigue con ${invs} inventarios, sin rastro de la prueba.`);
console.log(fallas === 0 ? '\nTODO VERIFICADO.' : `\n${fallas} FALLA(S).`);
await prisma.$disconnect();
process.exit(fallas === 0 ? 0 : 1);
