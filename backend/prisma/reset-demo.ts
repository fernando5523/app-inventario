/**
 * ============================================================================
 *  BORRA TODOS LOS DATOS DE LA BASE, MENOS LAS CUENTAS DE ADMINISTRADOR.
 *  No hay deshacer. Leé esto entero antes de correrlo.
 * ============================================================================
 *
 * Para que existe: el cliente pidio empezar a cargar datos reales desde la
 * app -- "solo dejar los usuarios administradores para acceder y empezar a
 * poblar la app". Este script deja exactamente eso: la puerta de entrada y
 * nada mas.
 *
 * QUE BORRA
 *   Sucursales, colaboradores (menos administradores), inventarios, hojas,
 *   conteos, productos, catalogo, empaques, resultados, diferencias,
 *   liquidaciones, aprobaciones, lacrados, registros de ERP, sesiones y el
 *   log de auditoria.
 *
 * QUE DEJA, y por que
 *
 *   TODAS las cuentas con rol=administrador -- no solo una.
 *     El cliente escribio "los usuarios administradores", en plural, y hoy
 *     hay dos. La asimetria del error manda: si sobra un administrador, se
 *     deshabilita desde la app en dos toques; si falta, NADIE puede entrar y
 *     no hay forma de arreglarlo desde el telefono. De los dos errores
 *     posibles, uno es reversible y el otro no.
 *
 *   Las 3 configuraciones del sistema (TAMANO_HOJA_DEFECTO,
 *   CANTIDAD_CONTEOS_CICLO, UMBRAL_MEDIA_UNIDAD_PAQUETE).
 *     Son PARAMETROS, no datos de demo: definen como se comporta el sistema,
 *     no que paso en una tienda. Borrarlas dejaria al primer inventario sin
 *     tamaño de hoja por defecto y sin saber cuantas rondas tiene el ciclo.
 *
 *   Las credenciales de Dynamics (`config_dynamics`), si las hay.
 *     Son configuracion real y cargarlas de nuevo exige ir a buscar el
 *     secreto a Azure. Su `actualizado_por_id` apunta a un colaborador que
 *     puede desaparecer, pero esa FK es SET NULL: no rompe nada.
 *
 * COMO SE CORRE (hacen falta LAS DOS cosas, a proposito):
 *
 *   RESET_DEMO=SI_BORRAR_TODO npm run db:reset-demo -- --si-estoy-seguro
 *
 * Dos confirmaciones y no una porque un flag solo se copia y se pega de un
 * README sin leerlo, y una variable de entorno sola se queda pegada en una
 * terminal y se dispara con el comando siguiente. Las dos juntas exigen
 * escribir dos cosas distintas, en el mismo momento, a proposito.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const VAR = 'RESET_DEMO';
const VALOR = 'SI_BORRAR_TODO';
const FLAG = '--si-estoy-seguro';

/**
 * Orden de borrado: SIEMPRE los hijos antes que los padres.
 *
 * No se confia en el `ON DELETE CASCADE` aunque algunas FK lo tengan: la
 * mayoria son RESTRICT (ver el mapa de FKs), y depender de que Postgres
 * arrastre las dependencias hace que el dia que alguien cambie una regla el
 * script falle a mitad de camino, con media base borrada.
 */
async function borrarTodo(): Promise<Record<string, number>> {
  const borrados: Record<string, number> = {};
  const contar = (tabla: string, r: { count: number }): void => {
    if (r.count > 0) borrados[tabla] = r.count;
  };

  // --- Lo que cuelga del lacrado ---
  contar('registros_erp_inventario', await prisma.registroErpInventario.deleteMany({}));

  // El sello tiene un TRIGGER que bloquea DELETE (lacrado_inmutable). Se
  // desactiva solo para esto y se vuelve a activar en el `finally`: si el
  // borrado falla a mitad, la tabla NO puede quedar sin su proteccion.
  await prisma.$executeRawUnsafe('ALTER TABLE "lacrados_inventario" DISABLE TRIGGER lacrado_inmutable');
  try {
    contar('lacrados_inventario', await prisma.lacradoInventario.deleteMany({}));
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "lacrados_inventario" ENABLE TRIGGER lacrado_inmutable');
  }

  // --- Conteos y lo que cuelga de ellos ---
  contar('lineas_conteo', await prisma.lineaConteo.deleteMany({}));
  contar('conteos', await prisma.conteo.deleteMany({}));
  contar('empaques', await prisma.empaque.deleteMany({}));
  contar('productos', await prisma.producto.deleteMany({}));

  // --- Catalogo del snapshot ---
  contar('empaques_catalogo', await prisma.empaqueCatalogo.deleteMany({}));
  contar('catalogo_items', await prisma.catalogoItem.deleteMany({}));

  // --- Lo que cuelga del inventario ---
  contar('hojas_conteo', await prisma.hojaConteo.deleteMany({}));
  contar('aprobaciones_cierre', await prisma.aprobacionCierre.deleteMany({}));
  contar('liquidaciones_colaborador', await prisma.liquidacionColaborador.deleteMany({}));
  contar('diferencias_item', await prisma.diferenciaItem.deleteMany({}));
  contar('resultados_inventario', await prisma.resultadoInventario.deleteMany({}));
  contar('inventarios', await prisma.inventario.deleteMany({}));

  // --- Sesiones y auditoria: cuelgan de colaboradores con FK RESTRICT ---
  // Se borran TODAS, incluidas las del administrador: es un reset, y un
  // token vivo apuntando a una base recien vaciada es peor que pedirle que
  // vuelva a ingresar con su PIN.
  contar('sesiones_token', await prisma.sesionToken.deleteMany({}));
  contar('registro_auditoria', await prisma.registroAuditoria.deleteMany({}));

  // --- Colaboradores: TODOS menos los administradores ---
  contar('colaboradores', await prisma.colaborador.deleteMany({ where: { rol: { not: 'administrador' } } }));

  // --- Sucursales: al final, porque colaboradores e inventarios la referencian ---
  contar('sucursales', await prisma.sucursal.deleteMany({}));

  return borrados;
}

async function contarTodo(): Promise<Array<{ tabla: string; filas: number }>> {
  const tablas = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE '_prisma%' ORDER BY tablename`,
  );
  const filas: Array<{ tabla: string; filas: number }> = [];
  for (const t of tablas) {
    const r = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT COUNT(*)::int AS n FROM "${t.tablename}"`);
    filas.push({ tabla: t.tablename, filas: r[0]?.n ?? 0 });
  }
  return filas;
}

async function main(): Promise<void> {
  const tieneVar = process.env[VAR] === VALOR;
  const tieneFlag = process.argv.includes(FLAG);

  if (!tieneVar || !tieneFlag) {
    console.error('');
    console.error('  ESTE SCRIPT BORRA TODOS LOS DATOS DE LA BASE. No hay deshacer.');
    console.error('');
    console.error(`  Falta: ${!tieneVar ? `la variable ${VAR}=${VALOR}` : ''}${!tieneVar && !tieneFlag ? ' y ' : ''}${!tieneFlag ? `el flag ${FLAG}` : ''}`);
    console.error('');
    console.error('  Para correrlo de verdad:');
    console.error(`    ${VAR}=${VALOR} npm run db:reset-demo -- ${FLAG}`);
    console.error('');
    console.error('  Se piden las dos cosas a proposito: un flag solo se copia y pega de un');
    console.error('  README sin leerlo, y una variable sola se queda pegada en la terminal.');
    console.error('');
    process.exitCode = 1;
    return;
  }

  const antes = await contarTodo();
  const totalAntes = antes.reduce((t, x) => t + x.filas, 0);

  const admins = await prisma.colaborador.findMany({
    where: { rol: 'administrador' },
    select: { id: true, nombre: true, dni: true, activo: true },
    orderBy: { id: 'asc' },
  });

  if (admins.length === 0) {
    console.error('');
    console.error('  NO HAY NINGUNA CUENTA DE ADMINISTRADOR EN LA BASE.');
    console.error('  Si se borra todo, nadie va a poder entrar a cargar nada y no hay forma');
    console.error('  de arreglarlo desde la app. Sembrá un administrador antes de resetear:');
    console.error('    npm run prisma:seed');
    console.error('');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log(`Base con ${totalAntes} filas. Se van a conservar:`);
  for (const a of admins) {
    console.log(`  administrador  id ${a.id}  ${a.nombre} (DNI ${a.dni})${a.activo ? '' : '  [DESHABILITADO]'}`);
  }
  const configs = await prisma.configuracion.count();
  const credenciales = await prisma.configDynamics.count();
  console.log(`  ${configs} configuraciones del sistema (parametros, no datos de demo)`);
  console.log(`  ${credenciales} fila(s) de credenciales de Dynamics`);
  console.log('');

  const activos = admins.filter((a) => a.activo);
  if (activos.length === 0) {
    console.error('  TODOS los administradores estan DESHABILITADOS: ninguno puede ingresar.');
    console.error('  Habilitá alguno antes de resetear, o nadie va a poder entrar despues.');
    console.error('');
    process.exitCode = 1;
    return;
  }

  console.log('Borrando...');
  const borrados = await borrarTodo();

  const despues = await contarTodo();
  const totalDespues = despues.reduce((t, x) => t + x.filas, 0);

  console.log('');
  console.log('BORRADO:');
  const filasBorradas = Object.entries(borrados).sort((a, b) => b[1] - a[1]);
  if (filasBorradas.length === 0) console.log('  (nada: la base ya estaba limpia)');
  for (const [tabla, n] of filasBorradas) console.log(`  ${tabla.padEnd(28)} ${n}`);

  console.log('');
  console.log('COMO QUEDO LA BASE:');
  for (const t of despues) {
    console.log(`  ${t.tabla.padEnd(28)} ${t.filas}${t.filas === 0 ? '' : '  <-'}`);
  }
  console.log(`  ${'TOTAL'.padEnd(28)} ${totalDespues} (antes: ${totalAntes})`);

  console.log('');
  console.log('El administrador ya puede entrar desde la app y empezar a cargar:');
  console.log('  1. crear las tiendas, cada una con su almacen de Dynamics');
  console.log('  2. crear los usuarios de cada tienda (coordinador, conteo, auditores)');
  console.log('  3. el coordinador entra y trae el snapshot para arrancar el inventario');
  console.log('');
  console.log('Comprobalo con: node scripts/verificar-flujo-de-carga.mjs');
  console.log('');
}

main()
  .catch((err) => {
    console.error('');
    console.error('EL RESET FALLO A MITAD DE CAMINO. La base puede haber quedado a medias:');
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
