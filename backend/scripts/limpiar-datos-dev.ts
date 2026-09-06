/**
 * Decision del cliente: limpiar TODOS los datos operativos y dejar SOLO a
 * los administradores (rol = 'administrador'), antes de compilar el
 * 2.12.0. Borra en orden de FKs todo lo que cuelga de un inventario
 * (lacrado, aprobaciones, liquidaciones, resultado, diferencias, hojas,
 * productos, conteos, catalogo), los inventarios mismos, los colaboradores
 * no administradores y las sucursales que se quedan sin inventarios.
 *
 * NUNCA toca: Colaborador con rol=administrador, Configuracion,
 * ConfigDynamics (las credenciales en si -- solo se limpia el puntero de
 * "quien la actualizo por ultimo" si apuntaba a alguien que se borra, para
 * no dejar una FK rota).
 *
 * DOS GUARDAS, aparte de --dry-run/--confirmar:
 *
 *  1. Se niega si NODE_ENV=production. Este script hace DELETE masivo y
 *     desactiva un trigger de integridad -- es limpieza de la base de
 *     DESARROLLO, nunca corre contra produccion.
 *  2. Un inventario LACRADO (ver migracion 20260904020954_lacrado_inmutable:
 *     trigger `lacrado_inmutable`, BEFORE UPDATE OR DELETE) no se toca a
 *     menos que se pida --incluye-lacrados. Sin ese flag, esos inventarios
 *     (y todo lo que cuelga de ellos: hojas, catalogo, resultado,
 *     diferencias, aprobaciones, liquidaciones, y su sucursal si solo tiene
 *     inventarios lacrados) sobreviven a la limpieza, y el script lo dice.
 *     Con el flag, desactiva el trigger DENTRO de la misma transaccion,
 *     borra, y lo vuelve a activar antes de terminar -- la proteccion sigue
 *     intacta para produccion, solo se salta en este momento puntual.
 *
 *   npx tsx scripts/limpiar-datos-dev.ts --dry-run   [--incluye-lacrados]
 *   npx tsx scripts/limpiar-datos-dev.ts --confirmar [--incluye-lacrados]
 */
import { prisma } from '../src/config/database';

async function main(): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.error('SE NIEGA: NODE_ENV=production. Este script es limpieza de la base de desarrollo, nunca corre contra produccion.');
    return 1;
  }

  const modo = process.argv[2];
  if (modo !== '--dry-run' && modo !== '--confirmar') {
    console.error('Uso: npx tsx scripts/limpiar-datos-dev.ts --dry-run|--confirmar [--incluye-lacrados]');
    return 1;
  }
  const dryRun = modo === '--dry-run';
  const incluyeLacrados = process.argv.includes('--incluye-lacrados');

  const noAdminWhere = { rol: { not: 'administrador' as const } };

  const lacrados = await prisma.lacradoInventario.findMany({ select: { inventarioId: true, folio: true } });
  const idsLacrados = lacrados.map((l) => l.inventarioId);
  // Sin --incluye-lacrados, cualquier tabla colgada de un inventario excluye
  // los inventarios lacrados. Con el flag, no hay exclusion: se borra todo.
  const invNotIn = incluyeLacrados ? {} : { inventarioId: { notIn: idsLacrados } };
  const idNotIn = incluyeLacrados ? {} : { id: { notIn: idsLacrados } };
  const porHoja = incluyeLacrados ? {} : { hoja: { inventarioId: { notIn: idsLacrados } } };
  const porProductoHoja = incluyeLacrados ? {} : { producto: { hoja: { inventarioId: { notIn: idsLacrados } } } };
  const porConteoHoja = incluyeLacrados ? {} : { conteo: { hoja: { inventarioId: { notIn: idsLacrados } } } };
  const porCatalogo = incluyeLacrados ? {} : { catalogoItem: { inventarioId: { notIn: idsLacrados } } };
  const porLacrado = incluyeLacrados ? {} : { lacrado: { inventarioId: { notIn: idsLacrados } } };

  const conteoLineas = await prisma.lineaConteo.count({ where: porConteoHoja });
  const conteoConteos = await prisma.conteo.count({ where: porHoja });
  const conteoEmpaques = await prisma.empaque.count({ where: porProductoHoja });
  const conteoProductos = await prisma.producto.count({ where: porHoja });
  const conteoRegistrosErp = await prisma.registroErpInventario.count({ where: porLacrado });
  const conteoLacrados = await prisma.lacradoInventario.count({ where: invNotIn });
  const conteoAprobaciones = await prisma.aprobacionCierre.count({ where: invNotIn });
  const conteoLiquidaciones = await prisma.liquidacionColaborador.count({ where: invNotIn });
  const conteoDiferencias = await prisma.diferenciaItem.count({ where: invNotIn });
  const conteoResultados = await prisma.resultadoInventario.count({ where: invNotIn });
  const conteoHojas = await prisma.hojaConteo.count({ where: invNotIn });
  const conteoEmpaquesCatalogo = await prisma.empaqueCatalogo.count({ where: porCatalogo });
  const conteoCatalogo = await prisma.catalogoItem.count({ where: invNotIn });
  const conteoInventarios = await prisma.inventario.count({ where: idNotIn });
  const conteoSesionesNoAdmin = await prisma.sesionToken.count({ where: { colaborador: noAdminWhere } });
  const conteoAuditoriaNoAdmin = await prisma.registroAuditoria.count({ where: { actor: noAdminWhere } });
  const conteoColaboradoresNoAdmin = await prisma.colaborador.count({ where: noAdminWhere });

  const todosLosInventarios = await prisma.inventario.findMany({ select: { id: true, sucursalId: true } });
  const idsQueSobreviven = incluyeLacrados ? [] : todosLosInventarios.filter((i) => idsLacrados.includes(i.id)).map((i) => i.id);
  const sucursalesQueSobreviven = new Set(
    todosLosInventarios.filter((i) => idsQueSobreviven.includes(i.id)).map((i) => i.sucursalId),
  );
  const conteoSucursalesTotal = await prisma.sucursal.count();
  const conteoSucursalesABorrar = conteoSucursalesTotal - sucursalesQueSobreviven.size;

  const configDynamicsAApuntarANoAdmin = await prisma.configDynamics.count({ where: { actualizadoPor: noAdminWhere } });
  const adminsConCreadorNoAdmin = await prisma.colaborador.count({ where: { rol: 'administrador', creadoPor: noAdminWhere } });

  console.log(`--- Resumen (${dryRun ? 'DRY RUN, no se borra nada' : 'MODO REAL'}${incluyeLacrados ? ', INCLUYE LACRADOS' : ''}) ---`);
  console.log(`lineas_conteo:            ${conteoLineas}`);
  console.log(`conteos:                  ${conteoConteos}`);
  console.log(`empaques:                 ${conteoEmpaques}`);
  console.log(`productos:                ${conteoProductos}`);
  console.log(`registros_erp_inventario: ${conteoRegistrosErp}`);
  console.log(`lacrados_inventario:      ${conteoLacrados}`);
  console.log(`aprobaciones_cierre:      ${conteoAprobaciones}`);
  console.log(`liquidaciones_colaborador:${conteoLiquidaciones}`);
  console.log(`diferencias_item:         ${conteoDiferencias}`);
  console.log(`resultados_inventario:    ${conteoResultados}`);
  console.log(`hojas_conteo:             ${conteoHojas}`);
  console.log(`empaques_catalogo:        ${conteoEmpaquesCatalogo}`);
  console.log(`catalogo_items:           ${conteoCatalogo}`);
  console.log(`inventarios:              ${conteoInventarios}`);
  console.log(`sesiones_token (no-admin):${conteoSesionesNoAdmin}`);
  console.log(`registro_auditoria (no-admin actor): ${conteoAuditoriaNoAdmin}`);
  console.log(`colaboradores NO admin:   ${conteoColaboradoresNoAdmin}`);
  console.log(`sucursales:               ${conteoSucursalesABorrar}`);
  console.log(`config_dynamics.actualizado_por_id a limpiar (apuntaba a no-admin): ${configDynamicsAApuntarANoAdmin}`);
  console.log(`colaboradores ADMIN con creado_por_id a limpiar (apuntaba a no-admin): ${adminsConCreadorNoAdmin}`);

  if (idsLacrados.length > 0) {
    const folios = lacrados.map((l) => l.folio).join(', ');
    if (incluyeLacrados) {
      console.log(`\n${idsLacrados.length} inventario(s) LACRADO(S) (ids: ${idsLacrados.join(', ')}; folios: ${folios}) SE VAN A BORRAR -- se desactiva el trigger lacrado_inmutable solo durante esta transaccion.`);
    } else {
      console.log(`\nSaltando ${idsLacrados.length} inventario(s) lacrado(s) (ids: ${idsLacrados.join(', ')}; folios: ${folios}): no se tocan -- falta --incluye-lacrados.`);
    }
  }

  const admins = await prisma.colaborador.findMany({ where: { rol: 'administrador' }, select: { id: true, nombre: true, dni: true } });
  console.log(`\nQuedan como administradores (${admins.length}):`);
  for (const a of admins) console.log(`  id=${a.id} nombre="${a.nombre}" dni=${a.dni}`);

  if (dryRun) {
    console.log('\nDRY RUN: no se borro nada. Correr con --confirmar para ejecutar.');
    return 0;
  }

  await prisma.$transaction(
    async (tx) => {
      if (incluyeLacrados) {
        await tx.$executeRawUnsafe('ALTER TABLE lacrados_inventario DISABLE TRIGGER lacrado_inmutable');
      }

      // Puntero de auditoria de ConfigDynamics: la fila y sus credenciales
      // quedan intactas, solo se limpia quien la actualizo por ultimo si esa
      // persona va a dejar de existir.
      await tx.configDynamics.updateMany({ where: { actualizadoPor: noAdminWhere }, data: { actualizadoPorId: null } });
      // Mismo criterio para un administrador cuyo creador (creadoPorId) fuera
      // un no-administrador -- no deberia pasar dada la jerarquia de alta,
      // pero se limpia igual para no dejar una FK rota.
      await tx.colaborador.updateMany({ where: { rol: 'administrador', creadoPor: noAdminWhere }, data: { creadoPorId: null } });

      await tx.lineaConteo.deleteMany({ where: porConteoHoja });
      await tx.conteo.deleteMany({ where: porHoja });
      await tx.empaque.deleteMany({ where: porProductoHoja });
      await tx.producto.deleteMany({ where: porHoja });
      await tx.registroErpInventario.deleteMany({ where: porLacrado });
      await tx.lacradoInventario.deleteMany({ where: invNotIn });
      await tx.aprobacionCierre.deleteMany({ where: invNotIn });
      await tx.liquidacionColaborador.deleteMany({ where: invNotIn });
      await tx.diferenciaItem.deleteMany({ where: invNotIn });
      await tx.resultadoInventario.deleteMany({ where: invNotIn });
      await tx.hojaConteo.deleteMany({ where: invNotIn });
      await tx.empaqueCatalogo.deleteMany({ where: porCatalogo });
      await tx.catalogoItem.deleteMany({ where: invNotIn });
      await tx.inventario.deleteMany({ where: idNotIn });

      await tx.sesionToken.deleteMany({ where: { colaborador: noAdminWhere } });
      await tx.registroAuditoria.deleteMany({ where: { actor: noAdminWhere } });
      // Un solo deleteMany: Postgres chequea la FK autoreferencial
      // (creado_por_id) al final del statement, cuando ya no queda ninguna
      // fila no-admin -- borrar de a una rompería con quien creo a quien.
      await tx.colaborador.deleteMany({ where: noAdminWhere });

      // Solo las sucursales que se quedaron sin ningun inventario (las que
      // tenian unicamente inventarios lacrados sobreviven si no se paso
      // --incluye-lacrados, porque ese inventario sigue colgando de ellas).
      await tx.sucursal.deleteMany({ where: { inventarios: { none: {} } } });

      if (incluyeLacrados) {
        await tx.$executeRawUnsafe('ALTER TABLE lacrados_inventario ENABLE TRIGGER lacrado_inmutable');
      }
    },
    { timeout: 30000 },
  );

  if (incluyeLacrados) {
    const estado = await prisma.$queryRawUnsafe<{ tgenabled: string }[]>(
      "SELECT tgenabled FROM pg_trigger WHERE tgname = 'lacrado_inmutable'",
    );
    const tgenabled = estado[0]?.tgenabled;
    console.log(`\nVerificacion post-limpieza: trigger lacrado_inmutable tgenabled=${tgenabled} (${tgenabled === 'O' ? 'HABILITADO, correcto' : 'ATENCION: no quedo habilitado como se esperaba'})`);
  }

  console.log('\nListo. Datos limpiados, solo quedan los administradores.');
  return 0;
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
