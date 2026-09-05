/**
 * Los pasos 2 y 3 del wizard del Coordinador: partir el inventario en hojas
 * y repartirlas entre la gente presente.
 *
 * Unico archivo del modulo que toca Prisma (regla de capas dura). Las reglas
 * de particion, orden y reparto viven en `src/dominio/lote.ts`, sin Prisma,
 * y se prueban sin base.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE ESTE MODULO
 * ---------------------------------------------------------------------------
 * Hasta ahora el wizard corria contra el adaptador EN MEMORIA del movil: el
 * Coordinador creaba hojas, las repartia, cerraba la app y no quedaba nada.
 * `mobile/lib/adaptadores/inventario-api.ts` tenia las rutas escritas y
 * marcadas como "Adivinadas: el backend todavia no tiene modulo de
 * hojas/inventario". Este archivo es ese modulo.
 *
 * ---------------------------------------------------------------------------
 * LA DIFERENCIA ENTRE CatalogoItem Y Producto, QUE ES TODO EL CONTEO CIEGO
 * ---------------------------------------------------------------------------
 * `CatalogoItem` es el snapshot crudo de Dynamics: trae `stockErp`,
 * `precioVenta` y `esEmpresa`. Lo consumen el backend y el Auditor DESPUES de
 * cerrado el ciclo.
 *
 * `Producto` es lo que ve la persona que cuenta. NO tiene stock ni precio, y
 * no puede tenerlos nunca. Crear las hojas es copiar de uno a otro DEJANDO
 * ESAS COLUMNAS ATRAS -- no es una omision que haya que recordar, es el
 * motivo por el que son dos tablas.
 */

import { prisma } from '../../config/database';
import { numeroDeHoja, ordenarParaContar, partirEnHojas, repartir, zonaDeHoja } from '../../dominio/lote';
import { registrarAuditoria } from '../../shared/auditoria';
import { Conflicto, NoEncontrado, SolicitudInvalida } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { INCLUIR_TODO, aHojaDto, type HojaDto } from '../hojas/hojas.service';

/** Lo que devuelve `GET /api/sucursales/:id/inventarios/activo`. */
export interface InventarioActivoDto {
  inventarioId: number;
  items: number;
  tomadoEn: string;
  /** null = todavia no se crearon hojas (el Coordinador esta en el paso 1). */
  tamanoHoja: number | null;
  totalHojas: number;
  /**
   * La ronda MAS ALTA que tiene hojas creadas (HojaConteo.numeroConteo) --
   * es lo unico que el front necesita para saber en que ronda esta parado.
   * null = todavia no se creo ninguna hoja, mismo momento que `tamanoHoja:
   * null` (el Coordinador esta en el paso 1, antes de partir en hojas).
   *
   * SIEMPRE es una ronda que todavia admite conteo, y no por construccion
   * de este campo sino porque `activo()` filtra `estado: 'en_curso'`: en
   * cuanto `rondas.service.ts#cerrar()` cierra la ultima ronda del ciclo (o
   * cualquiera, si no queda nada para recontar), pasa el inventario a
   * `conteo_cerrado` en la MISMA transaccion -- y ese inventario deja de
   * aparecer aca. Un "rondaActiva: 3" de este endpoint nunca puede referirse
   * a una ronda 3 ya cerrada, porque ese inventario ya no es el activo de la
   * sucursal. (Antes de ese cambio esto era un caso limite sin resolver;
   * quedo cerrado junto con el hueco que lo causaba.)
   */
  rondaActiva: number | null;
}

/**
 * El inventario en curso de una sucursal, o `null` si el Coordinador
 * todavia no trajo el snapshot.
 *
 * "En curso" es `estado: en_curso`, no "el ultimo": un inventario cerrado no
 * puede seguir apareciendo como activo o el Coordinador reabriria por error
 * el del mes pasado.
 */
export async function activo(sucursalId: number): Promise<InventarioActivoDto | null> {
  const inventario = await prisma.inventario.findFirst({
    where: { sucursalId, estado: 'en_curso' },
    orderBy: { id: 'desc' },
    include: { _count: { select: { hojas: true } } },
  });
  if (inventario === null) return null;

  // Sin hojas, ni siquiera vale la pena preguntar: no hay fila de
  // HojaConteo con la que calcular un maximo, y MAX() sobre nada en SQL ya
  // da null -- pero pedirlo igual seria una consulta de mas en el camino
  // mas comun (inventario recien creado, Coordinador todavia en el paso 1).
  const rondaActiva =
    inventario._count.hojas > 0
      ? (
          await prisma.hojaConteo.aggregate({
            where: { inventarioId: inventario.id },
            _max: { numeroConteo: true },
          })
        )._max.numeroConteo
      : null;

  return {
    inventarioId: inventario.id,
    // `snapshotItems` es nullable: un inventario puede existir sin snapshot
    // todavia. 0 y no null porque quien llama espera un numero para mostrar.
    items: inventario.snapshotItems ?? 0,
    tomadoEn: (inventario.snapshotTomadoEn ?? inventario.createdAt).toISOString(),
    // `tamanoHoja` tiene default 50 en la base, asi que SIEMPRE trae un
    // numero -- incluso antes de que existan hojas. Devolverlo ahi seria
    // mentir: la pantalla mostraria "hojas de 50" cuando no hay ninguna. Por
    // eso se condiciona a que existan.
    tamanoHoja: inventario._count.hojas > 0 ? inventario.tamanoHoja : null,
    totalHojas: inventario._count.hojas,
    rondaActiva,
  };
}

/** Que el inventario exista, este en curso y sea de la sucursal del actor. */
async function inventarioDelActor(actor: ColaboradorAutenticado, inventarioId: number) {
  const inventario = await prisma.inventario.findUnique({ where: { id: inventarioId } });
  if (inventario === null) throw new NoEncontrado('Inventario no encontrado.');

  // El administrador no pertenece a ninguna sucursal (sucursalId null): no se
  // le aplica el cerco, es quien puede mirar cualquier tienda.
  if (actor.rol !== 'administrador' && inventario.sucursalId !== actor.sucursalId) {
    throw new NoEncontrado('Inventario no encontrado.');
  }
  if (inventario.estado !== 'en_curso') {
    throw new Conflicto('Este inventario ya no está en curso: no se pueden crear ni repartir hojas.');
  }
  return inventario;
}

/**
 * PASO 2 -- parte el inventario en hojas del tamaño elegido.
 *
 * DESTRUCTIVO A PROPOSITO: borra las hojas anteriores de este inventario y
 * las vuelve a crear. El Coordinador tiene que poder equivocarse de tamaño y
 * rehacerlo -- es una decision que se toma antes de empezar a contar.
 *
 * PERO NO SI YA SE CONTO. Si alguna hoja tiene conteos, rehacer borraria
 * trabajo hecho: se rechaza con 409 en vez de perderlo. Ese es el limite
 * entre "todavia estoy armando" y "ya arrancamos".
 */
export async function crearHojas(actor: ColaboradorAutenticado, inventarioId: number, tamano: number): Promise<HojaDto[]> {
  await inventarioDelActor(actor, inventarioId);

  const yaContadas = await prisma.conteo.count({ where: { hoja: { inventarioId } } });
  if (yaContadas > 0) {
    throw new Conflicto(
      `No se pueden rehacer las hojas: ya hay ${yaContadas} conteo(s) cargado(s). Rehacerlas borraría ese trabajo.`,
    );
  }

  const items = await prisma.catalogoItem.findMany({
    where: { inventarioId },
    include: { empaques: { orderBy: { orden: 'asc' } } },
  });
  if (items.length === 0) {
    throw new SolicitudInvalida('Este inventario no tiene ítems: traé primero el catálogo de Dynamics (paso 1).');
  }

  // EL ORDEN ES LO QUE HACE UTIL A LA HOJA: agrupado por categoria, cada
  // hoja es un tramo del recorrido de la tienda. Ver dominio/lote.ts.
  const ordenados = ordenarParaContar(items);
  const tamanos = partirEnHojas(ordenados.length, tamano);

  await prisma.$transaction(async (tx) => {
    // Los productos se van con las hojas: son sus hijos (Producto.hojaId).
    await tx.empaque.deleteMany({ where: { producto: { hoja: { inventarioId } } } });
    await tx.producto.deleteMany({ where: { hoja: { inventarioId } } });
    await tx.hojaConteo.deleteMany({ where: { inventarioId } });

    let cursor = 0;
    for (const [indice, cantidad] of tamanos.entries()) {
      const bloque = ordenados.slice(cursor, cursor + cantidad);
      cursor += cantidad;

      await tx.hojaConteo.create({
        data: {
          inventarioId,
          numeroConteo: 1,
          numero: numeroDeHoja(indice),
          // La zona sale de los datos, no de un campo que alguien tipea:
          // es la categoria dominante del bloque (ver zonaDeHoja).
          zona: zonaDeHoja(bloque),
          // `gondola` no viene de Dynamics -- el ERP no sabe donde esta
          // fisicamente cada producto. Se deja el numero de hoja como
          // referencia en vez de inventar una ubicacion que seria mentira.
          gondola: numeroDeHoja(indice),
          /**
           * `cantidad` y NO `tamano`: cuantos items tiene ESTA hoja, no
           * cuantos se pidieron al armar el lote.
           *
           * Guardaba `tamano` (el 20/30/50 elegido) en todas, incluida la
           * ultima, que casi siempre queda parcial. La ultima de 1.236 items
           * en hojas de 50 tiene 36, y decia 50. El movil confiaba en este
           * campo y le mostraba a la persona parada en la gondola "36 / 50
           * Productos" con TODO contado, y al cerrar "quedan 14 items sin
           * contar" cuando no quedaba ninguno -- o sale a buscar productos
           * que no existen, o duda de su trabajo y recuenta la hoja entera.
           *
           * El tamaño PEDIDO no se pierde: vive en `Inventario.tamanoHoja`,
           * que es donde tiene sentido para el historico. Cada dato en el
           * lugar donde es verdad.
           */
          tamano: cantidad,
          productos: {
            create: bloque.map((item) => ({
              codigo: item.codigo,
              codigoBarras: item.codigoBarras,
              descripcion: item.descripcion,
              categoria: item.categoria,
              // NI stockErp NI precioVenta: ver el comentario de arriba.
              // Que no esten aca es el conteo ciego, no un olvido.
              empaques: {
                create: item.empaques.map((e) => ({
                  nombre: e.nombre,
                  factor: e.factor,
                  orden: e.orden,
                  ...(e.codigoBarras !== null ? { codigoBarras: e.codigoBarras } : {}),
                })),
              },
            })),
          },
        },
      });
    }

    // El tamaño queda en el INVENTARIO y no solo en cada hoja: el historico
    // tiene que poder decir con cuantos items por hoja se conto ese mes,
    // aunque manana el default del sistema pase a valer otra cosa (ver
    // schema.prisma#Inventario.tamanoHoja).
    await tx.inventario.update({ where: { id: inventarioId }, data: { tamanoHoja: tamano } });
  });

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'inventario.hojas_creadas',
    entidad: 'inventario',
    entidadId: inventarioId,
    detalle: { tamano, hojas: tamanos.length, items: ordenados.length },
  });

  return listarHojas(inventarioId);
}

/**
 * PASO 3 -- reparte entre los presentes las hojas SIN asignar.
 *
 * "Sin asignar" y no "todas": si el Coordinador reparte, llega alguien mas
 * tarde y vuelve a repartir, quien ya empezo a contar no puede quedarse sin
 * sus hojas a mitad de camino.
 */
export async function asignarHojas(
  actor: ColaboradorAutenticado,
  inventarioId: number,
  colaboradorIds: number[],
): Promise<HojaDto[]> {
  const inventario = await inventarioDelActor(actor, inventarioId);

  if (colaboradorIds.length === 0) {
    throw new SolicitudInvalida('Elegí al menos una persona para repartir las hojas.');
  }

  /**
   * Los que se pasan tienen que existir, estar activos y ser DE ESA TIENDA.
   * Sin esta verificacion se le puede asignar una hoja a alguien de otra
   * sucursal -- que despues la ve en "Mis hojas" y cuenta gondolas que no
   * son las suyas.
   */
  const encontrados = await prisma.colaborador.findMany({
    where: { id: { in: colaboradorIds }, activo: true, sucursalId: inventario.sucursalId },
    select: { id: true, nombre: true },
  });
  if (encontrados.length !== colaboradorIds.length) {
    throw new SolicitudInvalida('Alguna de las personas elegidas no existe, está inactiva o no es de esta tienda.');
  }

  /**
   * EL ORDEN QUE LLEGA ES EL ORDEN DE REPARTO. Prisma devuelve las filas en
   * el orden que quiere, asi que se reordenan segun `colaboradorIds`.
   *
   * No es cosmetico: el primero se lleva el primer bloque de hojas, que con
   * las hojas ordenadas por categoria es el primer tramo del recorrido de la
   * tienda. El Coordinador decide quien arranca por donde, y ese es el
   * contrato que declara el adaptador del movil
   * (mobile/lib/adaptadores/inventario-api.ts#asignarHojas). Ordenar por id
   * lo romperia en silencio: el reparto seria valido pero no el pedido.
   */
  const porId = new Map(encontrados.map((c) => [c.id, c]));
  const presentes = colaboradorIds.map((id) => porId.get(id)!);

  const sinAsignar = await prisma.hojaConteo.findMany({
    where: { inventarioId, asignadoAId: null },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  if (sinAsignar.length === 0) {
    throw new Conflicto('No quedan hojas sin asignar en este inventario.');
  }

  const reparto = repartir(sinAsignar, presentes);

  await prisma.$transaction(
    reparto.flatMap((r) =>
      r.hojas.map((hoja) =>
        prisma.hojaConteo.update({ where: { id: hoja.id }, data: { asignadoAId: r.persona.id } }),
      ),
    ),
  );

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'inventario.hojas_asignadas',
    entidad: 'inventario',
    entidadId: inventarioId,
    detalle: {
      personas: presentes.map((p) => p.nombre),
      repartidas: reparto.reduce((n, r) => n + r.hojas.length, 0),
    },
  });

  return listarHojas(inventarioId);
}

/** Todas las hojas del inventario -- solo el Coordinador ve el lote entero. */
async function listarHojas(inventarioId: number): Promise<HojaDto[]> {
  const hojas = await prisma.hojaConteo.findMany({
    where: { inventarioId },
    orderBy: { id: 'asc' },
    include: INCLUIR_TODO,
  });
  return hojas.map(aHojaDto);
}
