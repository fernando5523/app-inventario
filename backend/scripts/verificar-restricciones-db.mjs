/**
 * Prueba de las restricciones del historico CONTRA POSTGRES REAL.
 *
 * Corre entera dentro de una transaccion que termina en rollback: no deja
 * una fila en la base. Cada intento que DEBE fallar va envuelto en un
 * SAVEPOINT, porque en Postgres un error aborta la transaccion entera y sin
 * el savepoint no se podria seguir probando despues del primer rechazo.
 *
 * Se prueba contra la BASE y no contra el codigo a proposito: una regla que
 * solo vive en un `if` la saltea cualquiera que escriba directo en la tabla.
 */
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
let fallas = 0;
const ok = (t) => console.log('  [OK]    ' + t);
const mal = (t) => { console.log('  [FALLA] ' + t); fallas += 1; };

class Rollback extends Error {}

/** Ejecuta algo que TIENE que ser rechazado por la base, sin romper la transaccion. */
async function debeRechazar(tx, etiqueta, fn) {
  await tx.$executeRawUnsafe('SAVEPOINT sp');
  try {
    await fn();
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp');
    mal(`${etiqueta} -- la base lo ACEPTO`);
  } catch (e) {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp');
    if (e.code === 'P2002') ok(`${etiqueta} -> P2002 sobre (${e.meta.target.join(', ')})`);
    else if (/inmutable|no se puede modificar/i.test(e.message)) {
      ok(`${etiqueta} -> el TRIGGER de Postgres lo bloqueo`);
    } else mal(`${etiqueta} -- fallo pero con otro error: ${e.code ?? e.message}`);
  }
}

const previos = await p.inventario.findMany({ select: { id: true, sucursalId: true, abierto: true, estado: true } });
console.log('Inventarios ya en la base:', JSON.stringify(previos), '\n');

try {
  await p.$transaction(async (tx) => {
    const suc = await tx.sucursal.create({ data: { id: 9001, nombre: 'Market Prueba Restricciones' } });
    const g = await tx.colaborador.create({ data: { id: 9001, nombre: 'Auditor Uno', dni: '90000001', rol: 'auditor', pinHash: 'x', sucursalId: suc.id } });
    const r = await tx.colaborador.create({ data: { id: 9002, nombre: 'Auditor Dos', dni: '90000002', rol: 'auditor', pinHash: 'x', sucursalId: suc.id } });

    console.log('== REGLA 1: no dos inventarios ABIERTOS en la misma sucursal ==');
    const a = await tx.inventario.create({ data: { id: 9001, sucursalId: suc.id, periodoAnio: 2026, periodoMes: 7, snapshotItems: 10 } });
    ok(`inventario 1 creado; nace abierto sin declararlo (abierto=${a.abierto}, estado=${a.estado})`);

    await debeRechazar(tx, 'segundo inventario ABIERTO en la misma sucursal', () =>
      tx.inventario.create({ data: { id: 9002, sucursalId: suc.id, periodoAnio: 2026, periodoMes: 8, snapshotItems: 10 } }));

    await tx.inventario.update({ where: { id: a.id }, data: { estado: 'conteo_cerrado', abierto: null, cerradoEn: new Date() } });
    const b = await tx.inventario.create({ data: { id: 9003, sucursalId: suc.id, periodoAnio: 2026, periodoMes: 8, snapshotItems: 10 } });
    ok('cerrar el primero con abierto=NULL libera la sucursal: inventario 2 creado');

    await tx.inventario.update({ where: { id: b.id }, data: { estado: 'lacrado', abierto: null } });
    const c = await tx.inventario.create({ data: { id: 9004, sucursalId: suc.id, periodoAnio: 2026, periodoMes: 9, snapshotItems: 10 } });

    const abiertos = await tx.inventario.count({ where: { sucursalId: suc.id, abierto: true } });
    const total = await tx.inventario.count({ where: { sucursalId: suc.id } });
    abiertos === 1
      ? ok(`N cerrados conviven (NULL != NULL en Postgres): ${total} inventarios en la sucursal, ${abiertos} abierto`)
      : mal(`quedaron ${abiertos} abiertos`);

    await debeRechazar(tx, 'dos inventarios del MISMO periodo en la misma sucursal', () =>
      tx.inventario.update({ where: { id: c.id }, data: { periodoMes: 8 } }));

    console.log('\n== REGLA 2: una sola persona NO completa el par de aprobaciones ==');
    await tx.inventario.update({ where: { id: c.id }, data: { estado: 'conteo_cerrado', abierto: null } });

    const f1 = await tx.aprobacionCierre.create({ data: { id: 9001, inventarioId: c.id, aprobadorId: g.id, rolAlAprobar: 'auditor' } });
    ok(`firma 1: ${g.nombre} (id ${g.id}) el ${f1.aprobadoEn.toISOString()}`);

    await debeRechazar(tx, 'la MISMA persona firmando dos veces para completar el par', () =>
      tx.aprobacionCierre.create({ data: { id: 9002, inventarioId: c.id, aprobadorId: g.id, rolAlAprobar: 'auditor' } }));

    const f2 = await tx.aprobacionCierre.create({ data: { id: 9003, inventarioId: c.id, aprobadorId: r.id, rolAlAprobar: 'auditor', nota: 'Revisado' } });
    ok(`firma 2 de OTRA persona aceptada: ${r.nombre} (id ${r.id}) el ${f2.aprobadoEn.toISOString()}`);

    const firmas = await tx.aprobacionCierre.findMany({ where: { inventarioId: c.id }, orderBy: { id: 'asc' } });
    ok(`quien firmo y cuando queda guardado: ${firmas.map((f) => `#${f.aprobadorId}/${f.rolAlAprobar}`).join(' + ')}`);

    console.log('\n== REGLA 3: un inventario se lacra UNA sola vez ==');
    await tx.lacradoInventario.create({
      data: { id: 9001, inventarioId: c.id, folio: 'INV-2026-09-PRU-10-AAA', hash: 'a'.repeat(64), contenido: { version: 1 }, lacradoPorId: g.id },
    });
    await tx.inventario.update({ where: { id: c.id }, data: { estado: 'lacrado', abierto: null } });
    ok('inventario lacrado; sello guardado con folio y hash');

    await debeRechazar(tx, 'un SEGUNDO lacrado sobre el mismo inventario', () =>
      tx.lacradoInventario.create({
        data: { id: 9002, inventarioId: c.id, folio: 'INV-2026-09-PRU-10-BBB', hash: 'b'.repeat(64), contenido: { version: 1 }, lacradoPorId: r.id },
      }));

    await debeRechazar(tx, 'reutilizar el hash de otro sello', () =>
      tx.lacradoInventario.create({
        data: { id: 9003, inventarioId: b.id, folio: 'INV-2026-08-PRU-10-CCC', hash: 'a'.repeat(64), contenido: { version: 1 }, lacradoPorId: r.id },
      }));

    console.log('');
    console.log('== REGLA 4: un lacrado es INMUTABLE en la base, no solo en el codigo ==');
    await debeRechazar(tx, 'UPDATE del hash de un sello ya guardado', () =>
      tx.lacradoInventario.update({ where: { id: 9001 }, data: { hash: 'f'.repeat(64) } }));

    await debeRechazar(tx, 'UPDATE del contenido sellado', () =>
      tx.lacradoInventario.update({ where: { id: 9001 }, data: { contenido: { version: 1, alterado: true } } }));

    await debeRechazar(tx, 'DELETE del sello para poder re-lacrar', () =>
      tx.lacradoInventario.delete({ where: { id: 9001 } }));

    await debeRechazar(tx, 'UPDATE de una firma para cambiar QUIEN aprobo', () =>
      tx.aprobacionCierre.update({ where: { id: 9001 }, data: { aprobadorId: r.id } }));

    const selloIntacto = await tx.lacradoInventario.findUnique({ where: { id: 9001 } });
    selloIntacto.hash === 'a'.repeat(64)
      ? ok('despues de los 4 intentos, el sello sigue con su hash original')
      : mal('el sello se modifico');

    throw new Rollback();
  }, { timeout: 30000 });
} catch (e) {
  if (!(e instanceof Rollback)) { console.error('ERROR INESPERADO:', e.code ?? e.message); fallas += 1; }
}

const despues = await p.inventario.count();
console.log(`\nRollback aplicado: la base sigue con ${despues} inventario(s), sin rastro de la prueba.`);
console.log(fallas === 0 ? '\nTODAS LAS RESTRICCIONES SE CUMPLEN EN LA BASE.' : `\n${fallas} FALLA(S).`);
await p.$disconnect();
process.exit(fallas === 0 ? 0 : 1);
