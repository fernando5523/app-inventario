/**
 * RECONSTRUYE LA ASISTENCIA DE LOS INVENTARIOS YA CERRADOS a partir de los
 * conteos que quedaron guardados.
 *
 * ===========================================================================
 * POR QUE ES UN SCRIPT APARTE Y NO PARTE DE LA MIGRACION
 * ===========================================================================
 *
 * La migracion 20260918120000_asistencia_registrada_por_dia entra SIN relleno
 * para atras, a proposito: lo que este script escribe no es un dato que
 * estaba y hay que mover de lugar, es una SUPOSICION SOBRE EL PASADO. Los
 * inventarios viejos se cerraron cuando la asistencia se deducia de las hojas
 * y nadie pasaba lista, asi que la hora a la que cada persona entro a la
 * tienda no existe en ningun lado. Lo mas cerca que se puede estar es el
 * primer conteo que cargo: si cargo un renglon a las 15:29, a las 15:29
 * estaba ahi.
 *
 * Una suposicion asi no puede ir escondida dentro de un `ALTER TABLE` que
 * corre solo en cada despliegue. Va aca, con --dry-run, para que quien la
 * haga la vea antes de hacerla.
 *
 * ===========================================================================
 * LA RECONSTRUCCION, TEXTUAL
 * ===========================================================================
 *
 * UNA marca por persona, en el dia de su PRIMER conteo de ese inventario.
 *
 *   - "Persona" sale de la HOJA, no del conteo: `Conteo` no guarda autor.
 *     Cuentan los DOS asignados de la hoja (titular y segundo), exactamente
 *     como hacia la regla vieja (`dominio/asistencia.ts#quienesAsistieron`,
 *     antes de este cambio): en el conteo de a dos ambos estan ahi, una canta
 *     y la otra anota, y atribuirle la hoja a una sola le inventaria una
 *     falta a la otra.
 *   - UNA sola marca, no una por cada dia en que aparecen conteos suyos. La
 *     regla vieja era binaria -- asistio o no asistio -- y este script
 *     reproduce ESA respuesta con una fecha real encima. Inventar un segundo
 *     dia de asistencia porque alguien cargo algo el martes seria afirmar
 *     mas de lo que el dato sostiene.
 *   - `registradoEn` queda en el instante del primer conteo, que es lo mas
 *     parecido a una hora de entrada que existe. NO se usa `now()`: una
 *     marca de agosto con hora de hoy no le sirve a nadie para auditar.
 *   - `registradoPorId` es quien CERRO el conteo (`Inventario.cerradoPorId`).
 *     Si nadie figura -- los inventarios sembrados no lo llenan --, hay que
 *     pasar `--registrado-por <id>` a mano: una marca que mueve plata no
 *     puede quedar sin autor, y el script no elige uno por su cuenta.
 *
 * QUE INVENTARIOS TOCA: los cerrados (`conteo_cerrado`, `liquidado` y, solo
 * con --incluye-lacrados, `lacrado`). NO toca los `en_curso` -- esos los
 * marca el Coordinador desde la app, que es de lo que se trata todo el
 * cambio -- ni los `anulado`, que no producen historico.
 *
 * IDEMPOTENTE: saltea todo inventario que ya tenga marcas o que ya tenga
 * `dias_del_inventario > 0`. Correrlo dos veces no duplica nada ni pisa una
 * asistencia cargada a mano.
 *
 * ===========================================================================
 * LO QUE NO HACE, Y POR QUE
 * ===========================================================================
 *
 * NO TOCA NINGUN MONTO DE LAS PLANILLAS YA LIQUIDADAS.
 * `liquidaciones_colaborador` guarda la multa y el bono congelados de cada
 * persona (ver el comentario del modelo): es lo que se firmo y lo que se
 * descontó de un sueldo, y nada de eso se recalcula.
 *
 * SI completa `liquidaciones_colaborador.dias_asistidos` de los inventarios
 * que rellena, y no es una excepcion a lo anterior: es la contracara del
 * `dias_del_inventario` que este mismo script acaba de escribir. Sin eso, la
 * planilla de un inventario ya liquidado mostraria "0 de 1 dias" para alguien
 * que su propia fila da por asistente -- el denominador nuevo y el numerador
 * viejo contandose distinto. `asistio`, la multa y el bono quedan como
 * estaban.
 *
 * SALTEA EL INVENTARIO QUE RECONSTRUYA MAS DE UN DIA, y es la guarda que
 * importa. Con una marca por persona, un inventario de dos dias deja a todo
 * el que empezo el otro dia con 1 de 2 dias, o sea con una multa que nunca
 * existio -- y esa multa sale por pantalla al lado de una planilla firmada
 * que dice otra cosa. Reconstruir bien un inventario de varios dias exige
 * decidir a mano quien estuvo cada dia; no hay flag que lo resuelva, y por
 * eso no lo hay.
 *
 * COMO SE CORRE:
 *
 *   npx tsx prisma/rellenar-asistencia.ts --dry-run   [--incluye-lacrados] [--registrado-por <id>]
 *   npx tsx prisma/rellenar-asistencia.ts --confirmar [--incluye-lacrados] [--registrado-por <id>]
 */
import { PrismaClient, type EstadoInventario } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Peru esta en UTC-5 TODO EL ANO: no tiene horario de verano desde 1994, asi
 * que un desfase fijo alcanza y no hace falta una libreria de husos.
 *
 * El desfase importa de verdad: Prisma guarda los `DateTime` en UTC, y un
 * conteo cargado a las 20:00 de Lima es 01:00 UTC DEL DIA SIGUIENTE. Tomar la
 * fecha en UTC le pondria a esa persona una marca del dia equivocado -- y si
 * el inventario duro un solo dia, le inventaria un segundo dia al inventario
 * entero, que es justo lo que hace saltar la guarda de mas abajo.
 */
export const DESFASE_LIMA_HORAS = -5;

/** La jornada de Lima a la que pertenece un instante, en `YYYY-MM-DD`. */
export function diaDeLima(instante: Date): string {
  const enLima = new Date(instante.getTime() + DESFASE_LIMA_HORAS * 60 * 60 * 1000);
  return enLima.toISOString().slice(0, 10);
}

/** Lo minimo de un conteo que la reconstruccion necesita. */
export interface ConteoParaReconstruir {
  /** Titular de la hoja a la que pertenece el conteo. `null` = sin asignar. */
  asignadoAId: number | null;
  /** Segunda persona de la hoja (conteo de a dos). `null` = no hay. */
  asignadoA2Id: number | null;
  contadoEn: Date;
}

/** Una marca reconstruida, lista para insertar. */
export interface MarcaReconstruida {
  colaboradorId: number;
  /** La jornada de Lima del primer conteo, `YYYY-MM-DD`. */
  dia: string;
  /** El instante exacto de ese primer conteo -- va a `registradoEn`. */
  primerConteoEn: Date;
}

/**
 * Una marca por persona, con el instante de su PRIMER conteo.
 *
 * Funcion pura y exportada para poder probarla sin base (mismo criterio que
 * `sincronizar-secuencias.ts`): es la unica parte del script donde se decide
 * algo, el resto es leer y escribir.
 *
 * Una hoja sin asignar (los dos en `null`) no aporta a nadie, igual que en la
 * regla vieja: sus conteos existen pero no hay a quien atribuirlos.
 *
 * El resultado sale ORDENADO por colaborador para que el resumen del
 * --dry-run sea comparable entre corridas.
 */
export function reconstruirMarcas(conteos: readonly ConteoParaReconstruir[]): MarcaReconstruida[] {
  const primeroPorColaborador = new Map<number, Date>();

  const anotar = (colaboradorId: number | null, contadoEn: Date): void => {
    if (colaboradorId === null) return;
    const anterior = primeroPorColaborador.get(colaboradorId);
    if (anterior === undefined || contadoEn < anterior) primeroPorColaborador.set(colaboradorId, contadoEn);
  };

  for (const conteo of conteos) {
    anotar(conteo.asignadoAId, conteo.contadoEn);
    anotar(conteo.asignadoA2Id, conteo.contadoEn);
  }

  return [...primeroPorColaborador]
    .sort(([a], [b]) => a - b)
    .map(([colaboradorId, primerConteoEn]) => ({
      colaboradorId,
      dia: diaDeLima(primerConteoEn),
      primerConteoEn,
    }));
}

/** Los dias distintos que cubren las marcas: la duracion del inventario. */
export function diasDistintos(marcas: readonly MarcaReconstruida[]): string[] {
  return [...new Set(marcas.map((m) => m.dia))].sort();
}

/** Lo que se decidio para un inventario, para poder imprimirlo antes de escribir. */
interface PlanInventario {
  inventarioId: number;
  sucursalId: number;
  estado: EstadoInventario;
  /** `null` = no se toca; el motivo esta en `motivo`. */
  marcas: MarcaReconstruida[] | null;
  dias: string[];
  registradoPorId: number | null;
  /** Por que se saltea, o que se va a escribir. */
  motivo: string;
}

/** Los estados que este script considera "ya cerrado". */
const ESTADOS_CERRADOS: EstadoInventario[] = ['conteo_cerrado', 'liquidado'];

async function main(): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.error('SE NIEGA: NODE_ENV=production. Este script reconstruye datos del pasado a partir de una suposicion; se corre en desarrollo, se mira el resultado, y recien despues se decide.');
    return 1;
  }

  const modo = process.argv[2];
  if (modo !== '--dry-run' && modo !== '--confirmar') {
    console.error('Uso: npx tsx prisma/rellenar-asistencia.ts --dry-run|--confirmar [--incluye-lacrados] [--registrado-por <id>]');
    return 1;
  }
  const dryRun = modo === '--dry-run';
  const incluyeLacrados = process.argv.includes('--incluye-lacrados');

  // --registrado-por: solo se usa donde el inventario no dice quien cerro.
  let registradoPorCli: number | null = null;
  const posicionAutor = process.argv.indexOf('--registrado-por');
  if (posicionAutor !== -1) {
    const crudo = process.argv[posicionAutor + 1];
    const id = Number(crudo);
    if (crudo === undefined || !Number.isInteger(id) || id <= 0) {
      console.error(`--registrado-por necesita un id entero positivo (llego "${crudo ?? ''}").`);
      return 1;
    }
    // La tabla no tiene foreign keys (ver el modelo en schema.prisma), asi que
    // un id inexistente NO lo frena la base: lo tiene que frenar este chequeo.
    const autor = await prisma.colaborador.findUnique({ where: { id }, select: { id: true, nombre: true, rol: true, sucursalId: true } });
    if (autor === null) {
      console.error(`--registrado-por ${id}: no existe ese colaborador. Como la tabla no tiene FK, insertarlo dejaria marcas apuntando a nadie.`);
      return 1;
    }
    // Se dice la sucursal a proposito: este id se usa en TODO inventario sin
    // cerrador, tambien en los de otra tienda. Es una atribucion explicita de
    // quien corre el script, no un dato que el sistema sepa.
    console.log(`Autor de las marcas sin cerrador: id=${autor.id} "${autor.nombre}" (${autor.rol}, sucursal ${autor.sucursalId}). Se usa en TODO inventario sin cerrado_por_id, sea de la sucursal que sea.`);
    registradoPorCli = autor.id;
  }

  const estados = incluyeLacrados ? [...ESTADOS_CERRADOS, 'lacrado' as const] : ESTADOS_CERRADOS;
  const inventarios = await prisma.inventario.findMany({
    where: { estado: { in: estados } },
    select: { id: true, sucursalId: true, estado: true, cerradoPorId: true },
    orderBy: { id: 'asc' },
  });

  const lacradosSalteados = incluyeLacrados
    ? 0
    : await prisma.inventario.count({ where: { estado: 'lacrado' } });

  const planes: PlanInventario[] = [];

  for (const inventario of inventarios) {
    const base = { inventarioId: inventario.id, sucursalId: inventario.sucursalId, estado: inventario.estado };

    const marcasExistentes = await prisma.asistenciaInventario.count({ where: { inventarioId: inventario.id } });
    const resultado = await prisma.resultadoInventario.findUnique({
      where: { inventarioId: inventario.id },
      select: { diasDelInventario: true },
    });
    if (marcasExistentes > 0 || (resultado?.diasDelInventario ?? 0) > 0) {
      planes.push({ ...base, marcas: null, dias: [], registradoPorId: null, motivo: `ya tiene asistencia registrada (${marcasExistentes} marca(s), dias=${resultado?.diasDelInventario ?? 0}): no se pisa` });
      continue;
    }

    const conteos = await prisma.conteo.findMany({
      where: { hoja: { inventarioId: inventario.id } },
      select: { contadoEn: true, hoja: { select: { asignadoAId: true, asignadoA2Id: true } } },
    });
    const marcas = reconstruirMarcas(
      conteos.map((c) => ({
        asignadoAId: c.hoja.asignadoAId,
        asignadoA2Id: c.hoja.asignadoA2Id,
        contadoEn: c.contadoEn,
      })),
    );

    if (marcas.length === 0) {
      planes.push({ ...base, marcas: null, dias: [], registradoPorId: null, motivo: `sin conteos atribuibles (${conteos.length} conteo(s), ninguno en una hoja asignada): no hay de donde reconstruir` });
      continue;
    }

    const dias = diasDistintos(marcas);
    if (dias.length > 1) {
      planes.push({ ...base, marcas: null, dias, registradoPorId: null, motivo: `SE SALTEA: la reconstruccion da ${dias.length} dias (${dias.join(', ')}). Con una marca por persona, todo el que empezo otro dia quedaria con una multa que nunca existio. Hay que cargar este inventario a mano.` });
      continue;
    }

    const registradoPorId = inventario.cerradoPorId ?? registradoPorCli;
    if (registradoPorId === null) {
      planes.push({ ...base, marcas: null, dias, registradoPorId: null, motivo: 'SE SALTEA: nadie figura como quien cerro el conteo (cerrado_por_id es NULL) y no se paso --registrado-por <id>. Una marca que mueve plata no queda sin autor.' });
      continue;
    }

    // Cuantas filas de una planilla ya liquidada quedarian con
    // `dias_asistidos` completado. Se cuenta aca para que el --dry-run lo
    // diga: es lo unico que este script toca fuera de su propia tabla.
    const filasPlanilla = await prisma.liquidacionColaborador.count({
      where: { inventarioId: inventario.id, colaboradorId: { in: marcas.map((m) => m.colaboradorId) } },
    });

    planes.push({
      ...base,
      marcas,
      dias,
      registradoPorId,
      motivo: `${marcas.length} marca(s) el ${dias[0] ?? ''}, autor id=${registradoPorId}${inventario.cerradoPorId === null ? ' (de --registrado-por)' : ' (cerro el conteo)'}${resultado === null ? '; SIN resultado_inventario: no se escribe dias_del_inventario' : '; dias_del_inventario -> 1'}${filasPlanilla > 0 ? `; ${filasPlanilla} fila(s) de planilla con dias_asistidos -> 1` : ''}`,
    });
  }

  const aEscribir = planes.filter((p) => p.marcas !== null);
  const totalMarcas = aEscribir.reduce((suma, p) => suma + (p.marcas?.length ?? 0), 0);

  console.log(`\n--- Resumen (${dryRun ? 'DRY RUN, no se escribe nada' : 'MODO REAL'}${incluyeLacrados ? ', INCLUYE LACRADOS' : ''}) ---`);
  console.log(`inventarios cerrados mirados: ${inventarios.length}`);
  console.log(`inventarios a rellenar:       ${aEscribir.length}`);
  console.log(`marcas a insertar:            ${totalMarcas}`);
  if (lacradosSalteados > 0) {
    console.log(`\nSaltando ${lacradosSalteados} inventario(s) LACRADO(S): son inmutables por definicion y no se tocan sin --incluye-lacrados.`);
  }

  console.log('');
  for (const plan of planes) {
    const marca = plan.marcas === null ? '   -' : '  ->';
    console.log(`${marca} inventario ${plan.inventarioId} (suc ${plan.sucursalId}, ${plan.estado}): ${plan.motivo}`);
    for (const m of plan.marcas ?? []) {
      console.log(`       colaborador ${m.colaboradorId}  dia ${m.dia}  entrada ${m.primerConteoEn.toISOString()}`);
    }
  }

  if (dryRun) {
    console.log('\nDRY RUN: no se escribio nada. Correr con --confirmar para ejecutar.');
    return 0;
  }

  if (aEscribir.length === 0) {
    console.log('\nNo hay nada para escribir.');
    return 0;
  }

  for (const plan of aEscribir) {
    const marcas = plan.marcas ?? [];
    const registradoPorId = plan.registradoPorId;
    if (registradoPorId === null) continue;

    let filasPlanilla: { count: number } | undefined;

    // Una transaccion POR INVENTARIO: las marcas y el `dias_del_inventario`
    // que las cuenta tienen que entrar o no entrar juntos -- un inventario
    // con marcas y dias=0 (o al reves) es justo la discrepancia que el campo
    // congelado existe para evitar. Entre inventarios distintos no hace falta
    // atomicidad: si el tercero falla, los dos primeros ya quedaron bien y el
    // script es idempotente.
    await prisma.$transaction(async (tx) => {
      await tx.asistenciaInventario.createMany({
        data: marcas.map((m) => ({
          inventarioId: plan.inventarioId,
          colaboradorId: m.colaboradorId,
          dia: new Date(`${m.dia}T00:00:00.000Z`),
          registradoEn: m.primerConteoEn,
          registradoPorId,
        })),
        skipDuplicates: true,
      });
      await tx.resultadoInventario.updateMany({
        where: { inventarioId: plan.inventarioId },
        data: { diasDelInventario: plan.dias.length },
      });
      // `dias_asistidos` = 1 para todos, y no es un atajo: la reconstruccion
      // produce EXACTAMENTE una marca por persona (ver `reconstruirMarcas`),
      // y este bloque solo corre para inventarios de un solo dia -- los de
      // varios ya se saltearon mas arriba. Quien no tiene marca no se toca y
      // queda en 0, que es lo correcto: no vino.
      filasPlanilla = await tx.liquidacionColaborador.updateMany({
        where: { inventarioId: plan.inventarioId, colaboradorId: { in: marcas.map((m) => m.colaboradorId) } },
        data: { diasAsistidos: 1 },
      });
    });
    console.log(`inventario ${plan.inventarioId}: ${marcas.length} marca(s) insertada(s), dias_del_inventario=${plan.dias.length}, filas de planilla completadas=${filasPlanilla?.count ?? 0}`);
  }

  const totalFinal = await prisma.asistenciaInventario.count();
  console.log(`\nListo. asistencia_inventario tiene ahora ${totalFinal} marca(s).`);
  return 0;
}

/**
 * El runner arranca SOLO cuando el archivo se corre como script. Sin esta
 * guarda, importarlo desde el test abriria una conexion a la base y llamaria
 * a `process.exit` en medio de vitest -- por eso las funciones puras de
 * arriba se pueden probar sin base, igual que las de
 * `sincronizar-secuencias.ts`.
 */
const corriendoComoScript = /rellenar-asistencia\.[tj]s$/.test(process.argv[1] ?? '');

if (corriendoComoScript) {
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
}
