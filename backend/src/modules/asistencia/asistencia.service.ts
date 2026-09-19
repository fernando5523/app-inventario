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
import { validarJustificacion, validarLectura, validarRegistro } from './asistencia.permisos';
import { aDia, aFechaUtc } from './asistencia.schema';

export interface MarcaDto {
  colaboradorId: number;
  /** La jornada, `YYYY-MM-DD`. */
  dia: string;
  /** Fecha y HORA de la entrada, ISO 8601. */
  registradoEn: string;
}

/** Una falta perdonada por el auditor. */
export interface JustificacionDto {
  colaboradorId: number;
  /** La jornada perdonada, `YYYY-MM-DD`. */
  dia: string;
  /** Por qué se perdonó. Obligatorio al cargarla -- ver el schema. */
  motivo: string;
  /** Cuándo se firmó el perdón, ISO 8601. */
  justificadoEn: string;
  /** Qué auditor lo firmó. */
  justificadoPorId: number;
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
  /**
   * Las faltas que el auditor perdonó. Viajan APARTE de `marcas` y no
   * mezcladas con ellas, igual que en la base: una marca dice "estuvo" y una
   * justificación dice "no estuvo, y está bien". La pantalla las muestra
   * distinto y la planilla las suma sólo para la plata (ver
   * `schema.prisma#JustificacionAsistencia`).
   */
  justificaciones: JustificacionDto[];
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

  const filasJustificadas = await prisma.justificacionAsistencia.findMany({
    where: { inventarioId },
    select: { colaboradorId: true, dia: true, motivo: true, justificadoEn: true, justificadoPorId: true },
    orderBy: [{ dia: 'asc' }, { colaboradorId: 'asc' }],
  });

  const justificaciones: JustificacionDto[] = filasJustificadas.map((fila) => ({
    colaboradorId: fila.colaboradorId,
    // Misma traducción de `@db.Date` que las marcas, por el mismo motivo: en
    // hora local, la medianoche UTC del 3 es el 2 y el día se corre entero.
    dia: aDia(fila.dia),
    motivo: fila.motivo,
    justificadoEn: fila.justificadoEn.toISOString(),
    justificadoPorId: fila.justificadoPorId,
  }));

  return {
    /**
     * LOS DIAS DEL INVENTARIO SALEN SOLO DE LAS MARCAS, nunca de las
     * justificaciones. Un día que nadie trabajó no se convierte en jornada
     * porque a alguien le perdonen la falta -- y si entrara acá, cada perdón
     * le sumaría un día al denominador y una tarifa de multa a TODOS los
     * demás. Sería lo contrario de lo que el perdón intenta hacer.
     */
    dias: [...new Set(marcas.map((m) => m.dia))].sort(),
    marcas,
    justificaciones,
    // El personal sale de las dos listas: a quien tiene una falta perdonada y
    // ya no está en el padrón hay que poder escribirle el nombre igual.
    personal: await personalDelInventario(sucursalId, [
      ...marcas.map((m) => m.colaboradorId),
      ...justificaciones.map((j) => j.colaboradorId),
    ]),
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
   * La base ya NO es la última red: desde
   * `20260918160000_asistencia_claves_foraneas`, `asistencia_inventario`
   * tiene sus tres FK en RESTRICT, así que una marca de un colaborador
   * inexistente rebota sola. Pero la FK sólo sabe que el id EXISTE -- no que
   * esa persona sea de esta tienda, esté activa y tenga un rol de tienda, que
   * es lo que de verdad decide si corresponde marcarla. Eso lo sigue
   * chequeando únicamente esta consulta.
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

/**
 * JUSTIFICAR UNA FALTA: el auditor perdona la inasistencia de una persona en
 * un día, y ese día deja de cobrarse.
 *
 * Decisión del cliente, textual: *"si cobra el bono de distribución, es como
 * si hubiera asistido"*. El día perdonado vale como asistido para los DOS
 * efectos -- no paga multa por él y, si con eso completa el inventario, cobra
 * el bono. La cuenta vive en `dominio/asistencia.ts`; acá sólo se guarda el
 * hecho.
 *
 * IDEMPOTENTE, por el `@@unique([inventarioId, colaboradorId, dia])` y con
 * `skipDuplicates`, igual que `marcar`. Y con la misma consecuencia
 * deliberada: si ya había una justificación de ese día, el `motivo` viejo NO
 * se pisa. El primero es el que se firmó, el que quedó en el log de auditoría
 * y el que la planilla va a tener que explicar; dejar que un segundo toque lo
 * reescriba sería poder cambiar la explicación de un descuento sin que quede
 * rastro. Para cambiarlo hay que dar de baja el perdón y volver a cargarlo --
 * dos acciones, las dos auditadas.
 *
 * NO SE EXIGE que la persona esté ausente ese día. Una justificación sobre un
 * día que además tiene marca no rompe nada: `diasFaltadosCobrables` recorta en
 * 0 y esa persona ya no pagaba multa por ese día. Pedir que primero esté
 * ausente obligaría a chequear contra las marcas de ESTE instante, y las
 * marcas todavía se pueden mover -- el resultado dependería del orden en que
 * el coordinador y el auditor hacen sus cosas.
 */
export async function justificar(
  actor: ColaboradorAutenticado,
  inventarioId: number,
  colaboradorId: number,
  dia: string,
  motivo: string,
): Promise<{ creada: boolean; asistencia: AsistenciaDto }> {
  const inventario = await inventarioDe(inventarioId);
  validarJustificacion(actor, inventario);

  /**
   * LA PERSONA TIENE QUE SER PARTE DE ESTE INVENTARIO. No se exige `activo`
   * -- a diferencia de `marcar` --, y la diferencia es de negocio: a alguien
   * dado de baja a mitad de mes se le liquida igual el inventario que
   * trabajó, así que también se le tiene que poder perdonar una falta de esos
   * días. Lo que sí se exige es que sea personal de ESTA tienda y de un rol
   * de tienda: el universo de la planilla es ése (ver
   * `liquidacion.cierre.ts#proyectarPlanilla`), y perdonarle una falta a
   * alguien que no entra a la planilla es una fila que no le cambia la multa
   * a nadie y que después nadie entiende.
   */
  const persona = await prisma.colaborador.findFirst({
    where: { id: colaboradorId, sucursalId: inventario.sucursalId, rol: { in: ROLES_DE_TIENDA } },
    select: { id: true, nombre: true },
  });
  if (persona === null) {
    // Sin distinguir la causa, mismo criterio que `marcar`: decir cuál sería
    // confirmar que un id existe en otra sucursal.
    throw new SolicitudInvalida(
      `No se puede justificar la falta de la persona ${colaboradorId}: no es personal de esta tienda. ` +
        'Revísala en Usuarios y vuelve a intentar.',
    );
  }

  const { count } = await prisma.justificacionAsistencia.createMany({
    data: { inventarioId, colaboradorId, dia: aFechaUtc(dia), motivo, justificadoPorId: actor.colaboradorId },
    skipDuplicates: true,
  });

  // Sólo si de verdad se creó: un re-toque idempotente no perdonó nada nuevo,
  // y un log que dice "justificó" cuando no pasó nada es ruido que después
  // hay que descartar a mano al auditar un reclamo (igual que en `marcar`).
  if (count > 0) {
    await registrarAuditoria({
      actorId: actor.colaboradorId,
      accion: 'inventario.falta_justificada',
      entidad: 'inventario',
      entidadId: inventarioId,
      // QUIÉN (actorId), A QUIÉN, QUÉ DÍA y POR QUÉ. El motivo va acá además
      // de en la fila: la fila se puede dar de baja, el log no.
      detalle: { colaboradorId, persona: persona.nombre, dia, motivo },
    });
  }

  return { creada: count > 0, asistencia: await estadoDe(inventarioId, inventario.sucursalId) };
}

/**
 * DAR DE BAJA UNA JUSTIFICACIÓN: se levanta el perdón de ESE día y la multa
 * vuelve a correr.
 *
 * Es la contracara de `justificar` y tiene la misma ventana: hasta antes de
 * liquidar. Existe por lo mismo que `borrar` para las marcas -- un dedo del
 * auditor, o un motivo que resultó no ser cierto -- y también para poder
 * corregir un motivo mal escrito, que es la única forma de hacerlo (ver
 * `justificar`: el motivo no se pisa).
 *
 * NO PIDE UN MOTIVO PROPIO para la baja. El cliente pidió motivo para
 * justificar, que es lo que mueve plata a favor de alguien; la baja devuelve
 * las cosas a como estaban y queda igual de auditada. Si más adelante hace
 * falta, se agrega -- pero es una regla nueva y la tiene que pedir él.
 *
 * Idempotente: dar de baja algo que ya no está devuelve el estado actual en
 * vez de un 404, misma semántica que `borrar`.
 */
export async function quitarJustificacion(
  actor: ColaboradorAutenticado,
  inventarioId: number,
  colaboradorId: number,
  dia: string,
): Promise<AsistenciaDto> {
  const inventario = await inventarioDe(inventarioId);
  validarJustificacion(actor, inventario);

  // Se lee ANTES de borrar para poder dejar en el log QUÉ se dio de baja --
  // con su motivo original. Sin esto, el log diría "se levantó un perdón" sin
  // decir cuál era, y esa es justamente la información que hace falta cuando
  // alguien pregunta por qué le volvieron a descontar.
  const justificacion = await prisma.justificacionAsistencia.findUnique({
    where: { inventarioId_colaboradorId_dia: { inventarioId, colaboradorId, dia: aFechaUtc(dia) } },
    select: { motivo: true, justificadoPorId: true },
  });

  if (justificacion !== null) {
    await prisma.justificacionAsistencia.delete({
      where: { inventarioId_colaboradorId_dia: { inventarioId, colaboradorId, dia: aFechaUtc(dia) } },
    });

    await registrarAuditoria({
      actorId: actor.colaboradorId,
      accion: 'inventario.justificacion_quitada',
      entidad: 'inventario',
      entidadId: inventarioId,
      detalle: {
        colaboradorId,
        dia,
        // El motivo del perdón que se levanta, y quién lo había firmado: puede
        // no ser el mismo auditor que lo está dando de baja.
        motivo: justificacion.motivo,
        justificadoPorId: justificacion.justificadoPorId,
      },
    });
  }

  return estadoDe(inventarioId, inventario.sucursalId);
}
