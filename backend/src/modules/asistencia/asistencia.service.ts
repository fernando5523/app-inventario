/**
 * PASAR LISTA: quién vino al inventario y qué día.
 *
 * Único archivo del módulo que toca Prisma (regla de capas dura). La regla de
 * negocio -- qué es un día del inventario, cuánta multa le toca a cada uno --
 * vive en `src/dominio/asistencia.ts`, sin Prisma, y se prueba sin base.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EXISTE ESTE MÓDULO
 * ---------------------------------------------------------------------------
 * Hasta este cambio nadie pasaba lista: la asistencia se DEDUCIA de las hojas
 * ("tenés un conteo cargado, entonces viniste"). El cliente aceptó ese trato y
 * después lo revirtió, porque le cobraba multa a gente que sí había ido a
 * trabajar y no había llegado a contar. El razonamiento completo está en la
 * cabecera de `dominio/asistencia.ts`; esta API es la carga manual que lo
 * reemplaza.
 *
 * Lo que se guarda es una MARCA DE ENTRADA por persona y por día. No hay
 * salida: pedirla obligaría al coordinador a acordarse de cerrar la jornada, y
 * una salida sin cargar no se distingue de una ausencia.
 */

import { prisma } from '../../config/database';
import { aMarcaAsistencia } from '../../dominio/asistencia';
import { registrarAuditoria } from '../../shared/auditoria';
import { NoEncontrado, SolicitudInvalida } from '../../shared/errores';
import type { ColaboradorAutenticado, Rol } from '../../shared/tipos';
import type { EstadoInventario } from '../historial/historial.permisos';
import { ROLES_DE_TIENDA } from '../sesion/sesion.service';
import { validarLectura, validarRegistro } from './asistencia.permisos';
import { aFechaUtc } from './asistencia.schema';

export interface MarcaDto {
  colaboradorId: number;
  /** La jornada, `YYYY-MM-DD`. */
  dia: string;
  /** Fecha y HORA de la entrada, ISO 8601. */
  registradoEn: string;
}

export interface PersonaDto {
  id: number;
  nombre: string;
  rol: Rol;
}

export interface AsistenciaDto {
  /**
   * Los días distintos con al menos una marca, de menor a mayor. Su CANTIDAD
   * es la duración del inventario (`dominio/asistencia.ts#diasDelInventario`),
   * que es el denominador de todas las multas: la pantalla muestra los días y
   * la planilla cuenta cuántos son, pero los dos números salen de las mismas
   * marcas y no pueden discrepar.
   */
  dias: string[];
  marcas: MarcaDto[];
  /** A quién se le puede marcar asistencia -- ver `personalDelInventario`. */
  personal: PersonaDto[];
}

/** Que el inventario exista. El permiso (rol, sucursal, estado) lo deciden los validadores. */
async function inventarioDe(inventarioId: number) {
  const inventario = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    select: { id: true, sucursalId: true, estado: true },
  });
  if (inventario === null) throw new NoEncontrado('Inventario no encontrado.');
  return { ...inventario, estado: inventario.estado as EstadoInventario };
}

/**
 * A QUIÉN SE LE PUEDE MARCAR: el personal de tienda activo de esa sucursal
 * (`ROLES_DE_TIENDA`, decisión del cliente -- el auditor y el administrador no
 * pertenecen a ninguna tienda), MÁS cualquiera que ya tenga una marca en este
 * inventario.
 *
 * La segunda mitad no es un capricho. Si a alguien lo dan de baja a mitad de
 * mes, sus marcas quedan (contó esos días, y la planilla se las va a pagar):
 * sin ella la pantalla recibiría una marca de un `colaboradorId` que no está
 * en la lista y no tendría con qué escribir el nombre. Aparecer en la lista no
 * es poder marcarlo de nuevo -- eso lo decide `marcar`, que exige `activo`.
 */
async function personalDelInventario(sucursalId: number, yaMarcados: readonly number[]): Promise<PersonaDto[]> {
  const personal = await prisma.colaborador.findMany({
    where: {
      OR: [
        { sucursalId, activo: true, rol: { in: ROLES_DE_TIENDA } },
        // Los ids salen de las marcas que ya se leyeron, no de un `distinct`
        // aparte sobre la misma tabla: el dato ya estaba a mano.
        { id: { in: [...new Set(yaMarcados)] } },
      ],
    },
    select: { id: true, nombre: true, rol: true },
    orderBy: { nombre: 'asc' },
  });

  return personal.map((p) => ({ id: p.id, nombre: p.nombre, rol: p.rol as Rol }));
}

/**
 * El estado completo de la asistencia de un inventario.
 *
 * Se devuelve entero (días + marcas + personal) también después de escribir:
 * la pantalla marca y repinta con una sola llamada, sin quedar un instante
 * mostrando algo distinto de lo que hay en la base. Mismo criterio que
 * `inventarios.service.ts#asignarHojas`, que responde con las hojas ya
 * repartidas en vez de un `{ ok: true }`.
 */
export async function listar(actor: ColaboradorAutenticado, inventarioId: number): Promise<AsistenciaDto> {
  const inventario = await inventarioDe(inventarioId);
  validarLectura(actor, inventario);
  return estadoDe(inventario.id, inventario.sucursalId);
}

async function estadoDe(inventarioId: number, sucursalId: number): Promise<AsistenciaDto> {
  const filas = await prisma.asistenciaInventario.findMany({
    where: { inventarioId },
    select: { colaboradorId: true, dia: true, registradoEn: true },
    // Orden estable para la pantalla (y para los tests): por día y, dentro
    // del día, por persona. Prisma no garantiza ningún orden sin esto.
    orderBy: [{ dia: 'asc' }, { colaboradorId: 'asc' }],
  });

  const marcas: MarcaDto[] = filas.map((fila) => ({
    // `aMarcaAsistencia` y no un `slice` propio: la traducción de la columna
    // `@db.Date` a `YYYY-MM-DD` vive en el dominio, en un solo lugar, porque
    // hacerla en hora local corre todas las marcas un día (ver su comentario).
    ...aMarcaAsistencia(fila),
    registradoEn: fila.registradoEn.toISOString(),
  }));

  return {
    dias: [...new Set(marcas.map((m) => m.dia))].sort(),
    marcas,
    personal: await personalDelInventario(sucursalId, marcas.map((m) => m.colaboradorId)),
  };
}

/**
 * MARCAR LA ENTRADA de una persona en un día. IDEMPOTENTE: volver a marcar lo
 * mismo no cambia nada ni falla.
 *
 * Lo resuelve el `@@unique([inventarioId, colaboradorId, dia])` vía
 * `skipDuplicates`, no un `findUnique` previo: con dos toques seguidos en la
 * pantalla, el chequeo y el insert serían dos viajes y entre medio entra el
 * segundo toque. Así el candado lo pone la base, que es la única que puede.
 *
 * Y la marca vieja NO se pisa: `registradoEn` sigue siendo la hora de la
 * PRIMERA vez que se marcó, que es cuando la persona efectivamente entró. Un
 * segundo toque a las 6 de la tarde no puede convertir una entrada de las 8 de
 * la mañana en una de las 18.
 */
export async function marcar(
  actor: ColaboradorAutenticado,
  inventarioId: number,
  colaboradorId: number,
  dia: string,
): Promise<{ creada: boolean; asistencia: AsistenciaDto }> {
  const inventario = await inventarioDe(inventarioId);
  validarRegistro(actor, inventario);

  /**
   * LA PERSONA TIENE QUE SER DE ESA TIENDA, ESTAR ACTIVA Y SER DE UN ROL DE
   * TIENDA. Sin esto se le puede marcar asistencia a cualquier id del padrón,
   * y eso no es una fila de más: los días del inventario son los días
   * DISTINTOS con alguna marca, así que una marca a un desconocido en un día
   * que nadie trabajó le suma un día al inventario -- y una tarifa de multa a
   * los once que sí fueron.
   *
   * Y acá no hay red debajo: `AsistenciaInventario` NO tiene foreign keys (es
   * la única tabla del schema así, decisión anotada en su comentario). La base
   * acepta sin chistar una marca de un colaborador que no existe. Esta
   * consulta -- y el `inventarioDe` de arriba -- son toda la integridad
   * referencial que tiene la tabla; borrarlas no "relaja una validación",
   * deja entrar basura que nadie va a rechazar después.
   */
  const persona = await prisma.colaborador.findFirst({
    where: { id: colaboradorId, activo: true, sucursalId: inventario.sucursalId, rol: { in: ROLES_DE_TIENDA } },
    select: { id: true, nombre: true },
  });
  if (persona === null) {
    // No se dice CUÁL de las causas es (inexistente / deshabilitada / de otra
    // tienda / auditor o administrador), por lo mismo que en
    // `inventarios.service.ts#asignarHojas`: distinguirlas confirmaría que un
    // id existe en otra sucursal.
    throw new SolicitudInvalida(
      `No se puede marcar asistencia a la persona ${colaboradorId}: no es personal activo de esta tienda. ` +
        'Revísala en Usuarios y vuelve a intentar.',
    );
  }

  const { count } = await prisma.asistenciaInventario.createMany({
    data: { inventarioId, colaboradorId, dia: aFechaUtc(dia), registradoPorId: actor.colaboradorId },
    skipDuplicates: true,
  });

  // Solo si de verdad se creó algo: un re-toque idempotente no cambió nada, y
  // un log que dice "marcó asistencia" cuando no pasó nada es ruido que
  // después hay que descartar a mano al auditar un reclamo.
  if (count > 0) {
    await registrarAuditoria({
      actorId: actor.colaboradorId,
      accion: 'inventario.asistencia_marcada',
      entidad: 'inventario',
      entidadId: inventarioId,
      detalle: { colaboradorId, persona: persona.nombre, dia },
    });
  }

  return { creada: count > 0, asistencia: await estadoDe(inventarioId, inventario.sucursalId) };
}

/**
 * BORRAR UNA MARCA -- la de esa persona ESE día, no su asistencia entera. Es
 * cómo se corrige un dedo del coordinador, que es la única razón por la que
 * este endpoint existe.
 *
 * Idempotente también: borrar algo que ya no está devuelve el estado actual
 * en vez de un 404. Es la semántica de DELETE en HTTP, y acá además es lo
 * útil -- si la pantalla se desincronizó, el 404 la dejaría mostrando una
 * marca que en la base ya no existe.
 *
 * NO exige que la persona siga siendo personal activo de la tienda (a
 * diferencia de `marcar`): justamente a alguien dado de baja por error es a
 * quien hay que poder sacarle la marca.
 */
export async function borrar(
  actor: ColaboradorAutenticado,
  inventarioId: number,
  colaboradorId: number,
  dia: string,
): Promise<AsistenciaDto> {
  const inventario = await inventarioDe(inventarioId);
  validarRegistro(actor, inventario);

  const { count } = await prisma.asistenciaInventario.deleteMany({
    where: { inventarioId, colaboradorId, dia: aFechaUtc(dia) },
  });

  if (count > 0) {
    await registrarAuditoria({
      actorId: actor.colaboradorId,
      accion: 'inventario.asistencia_borrada',
      entidad: 'inventario',
      entidadId: inventarioId,
      detalle: { colaboradorId, dia },
    });
  }

  return estadoDe(inventarioId, inventario.sucursalId);
}
