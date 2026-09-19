/**
 * QUIEN ASISTIO AL INVENTARIO, Y CUANTOS DIAS. Regla del cliente, aislada acá
 * y sin Prisma por la misma razón que `ciclo-conteos.ts#conteoQueManda`: es
 * una decisión de negocio, no una consecuencia del modelo de datos, y el día
 * que cambie se toca esta función y nada más.
 *
 * ---------------------------------------------------------------------------
 * SE REVIRTIO EL ACUERDO ANTERIOR. LEER ESTO ANTES DE TOCAR NADA
 * ---------------------------------------------------------------------------
 * Hasta este cambio, la asistencia SE DEDUCIA DE LAS HOJAS: asistió quien
 * tenía al menos una hoja con al menos un conteo, en cualquier ronda. Cero
 * carga manual, nadie pasaba lista. El cliente había aceptado explícitamente
 * el costo de esa regla, y estaba documentado acá:
 *
 *     QUIEN VINO Y NO LLEGO A CONTAR FIGURA COMO AUSENTE. Alguien que fue a
 *     la tienda, se le asignó una hoja y no alcanzó a cargar ni un renglón
 *     -- porque lo mandaron a otra cosa, porque el teléfono no andaba,
 *     porque terminó la jornada -- aparecía con multa por inasistencia.
 *
 * ESE ACUERDO YA NO RIGE. Ahora EL COORDINADOR REGISTRA LA ASISTENCIA a mano,
 * por día, con fecha y hora. La deducción desapareció por completo: las hojas
 * ya no dicen nada sobre quién vino. La razón es la misma que hacía dudosa la
 * regla vieja -- le costaba plata a gente que sí había ido a trabajar -- y el
 * precio de revertirla es el simétrico: ahora hay carga manual, y si el
 * coordinador no marca a alguien, esa persona figura ausente aunque haya
 * contado media tienda. El dato pasó de ser inferido a ser declarado, y quien
 * lo declara es responsable de él.
 *
 * Quien lea esto en seis meses y encuentre un reclamo de alguien que "sí
 * vino": antes la respuesta era "el sistema respondió lo único que podía
 * saber". Ahora la respuesta es OTRA -- hay un registro, con hora y con
 * autor, y si falta una marca es porque no se cargó. Se arregla mirando
 * `asistencia_inventario`, no discutiendo la regla.
 *
 * ---------------------------------------------------------------------------
 * LA REGLA NUEVA, TEXTUAL
 * ---------------------------------------------------------------------------
 * 1. Una MARCA es "esta persona entró este día". Solo entrada, no hay salida:
 *    marcar la salida obligaría al coordinador a acordarse de cerrar el día,
 *    y una salida sin cargar no se distingue de una ausencia.
 * 2. Los DIAS DEL INVENTARIO son los días distintos con al menos una marca de
 *    cualquiera. No se declara la duración: se observa. Un inventario donde
 *    nadie marcó nada dura 0 días, y eso se corta antes de liquidar.
 * 3. La MULTA es por DIA FALTADO: `(días del inventario − días que asistió) ×
 *    tarifa`. Antes era un monto fijo por persona ausente; faltar un día de
 *    tres costaba lo mismo que no aparecer nunca, y eso el cliente lo pedía
 *    cambiado.
 * 4. COBRA BONO quien vino TODOS los días -- es decir, quien no paga multa.
 *    Antes alcanzaba con haber asistido; ahora, con la multa prorrateada, "el
 *    que asistió" dejó de ser una categoría: casi todos asistieron algún día.
 *    El bono premia la asistencia completa, que es lo único que sigue siendo
 *    binario.
 * 5. El AUDITOR puede JUSTIFICAR una falta, y ese día deja de cobrarse.
 *    Decisión del cliente, textual: *"si cobra el bono de distribución, es
 *    como si hubiera asistido"*. Un día justificado vale como asistido para
 *    LOS DOS efectos -- no paga multa por él y, si con eso completa el
 *    inventario, cobra el bono. No existe la media medida "te perdono la
 *    multa pero no cobrás bono": el cliente la descartó en esa misma frase.
 *
 * El fondo de multas SE SIGUE REDISTRIBUYENDO entre quienes lo cobran, al
 * centavo (`dominio/reparto-de-fondo.ts`). Eso NO cambió, y no se puede
 * sacar: es lo que hace que la planilla sume el faltante neto y no más.
 *
 * ---------------------------------------------------------------------------
 * ASISTIDO Y JUSTIFICADO SE SUMAN PARA LA PLATA, NUNCA PARA EL RELATO
 * ---------------------------------------------------------------------------
 * Los días justificados viven en OTRA tabla y viajan en OTRO parámetro. En
 * ningún lado de este archivo se los mete adentro de `diasAsistidos`, y no es
 * prolijidad: `LiquidacionColaborador.diasAsistidos` entra al sello del
 * lacrado (`historial.lacrado.ts`), que existe para poder defender la
 * planilla cuando alguien reclama. Un sello que dice "asistió 3 de 3" sobre
 * alguien que vino 1 día y tuvo 2 perdonados afirma un hecho falso, y deja de
 * servir justo el día que hace falta.
 *
 * Por eso las dos cuentas de abajo reciben los dos números por separado y los
 * suman *ahí*, donde se ve.
 */

/**
 * Una marca de entrada: "esta persona, este día".
 *
 * `dia` es un texto `YYYY-MM-DD` y no un `Date` A PROPOSITO. Lo que importa
 * es la jornada, no un instante: dos marcas del mismo día tienen que ser el
 * mismo día, y con `Date` eso depende del huso horario de quien compare. Un
 * texto en formato ISO se compara y se agrupa por igualdad, sin ambigüedad.
 * La traducción desde Prisma vive en `aMarcaAsistencia`, en un solo lugar.
 */
export interface MarcaAsistencia {
  colaboradorId: number;
  /** La jornada, `YYYY-MM-DD`. */
  dia: string;
}

/**
 * CUANTO DURO EL INVENTARIO: días distintos con al menos una marca.
 *
 * No se cuenta desde la fecha de apertura hasta el cierre: un inventario
 * abierto un viernes y cerrado el lunes no duró cuatro días, duró los días
 * que alguien fue a contar. Y no se declara a mano porque sería un segundo
 * dato que mantener en sincronía con las marcas -- el día que discrepen, la
 * multa de alguien sale de un número que nadie cargó.
 *
 * Es el denominador de TODAS las multas del inventario, así que se congela en
 * `ResultadoInventario.diasDelInventario` al cerrar el conteo: sin eso, una
 * marca agregada en noviembre cambiaría la multa de agosto.
 */
export function diasDelInventario(marcas: readonly MarcaAsistencia[]): number {
  const dias = new Set<string>();
  for (const marca of marcas) dias.add(marca.dia);
  return dias.size;
}

/**
 * Cuántos días distintos asistió cada persona.
 *
 * Un `Map` y no una lista por la misma razón que antes era un `Set`: la
 * pregunta de quien llama es "¿cuántos días hizo ESTA persona?", una por fila
 * de la planilla, y con una lista cada respuesta cuesta un recorrido.
 *
 * DIAS DISTINTOS, no marcas: el `@@unique([inventarioId, colaboradorId, dia])`
 * ya impide dos marcas iguales en la base, pero esta función es pura y no
 * puede apoyarse en eso -- la reciben tests, y el día que la alimente otra
 * consulta (un `findMany` con join mal armado, un import) dos filas repetidas
 * le regalarían un día de asistencia a alguien.
 *
 * Quien no tiene ninguna marca NO APARECE en el Map. No se devuelve con 0
 * porque esta función no conoce el universo de personal alcanzado: eso lo
 * sabe la planilla, que recorre a todos y resuelve el faltante con `?? 0`.
 */
export function diasAsistidosPorColaborador(marcas: readonly MarcaAsistencia[]): Map<number, number> {
  return contarDiasDistintos(marcas);
}

/**
 * Una falta PERDONADA por el auditor: "esta persona no vino este día, y no se
 * le cobra".
 *
 * Tiene la misma forma que `MarcaAsistencia` y es un tipo aparte igual, para
 * que el compilador no deje pasar una lista por la otra. Afirman cosas
 * opuestas -- una dice que estuvo, la otra que no -- y confundirlas le
 * regalaría a alguien un día de asistencia que nunca ocurrió, justo el dato
 * que el sello del lacrado firma.
 */
export interface JustificacionAsistencia {
  colaboradorId: number;
  /** La jornada perdonada, `YYYY-MM-DD`. */
  dia: string;
  /**
   * SIEMPRE `true`, y es OBLIGATORIO a propósito. Es lo que hace que los dos
   * tipos sean de verdad incompatibles: con un campo opcional, TypeScript
   * acepta una lista de marcas donde se esperan justificaciones (el chequeo
   * de propiedades de más sólo corre sobre literales), y el error que este
   * tipo existe para evitar pasaría igual. Con él obligatorio, no compila.
   */
  readonly justificada: true;
}

/**
 * Cuántos días distintos le PERDONARON a cada persona.
 *
 * Misma cuenta que `diasAsistidosPorColaborador` -- días distintos, no filas
 * -- y por las mismas razones, así que comparten el helper. Son dos funciones
 * y no una con un parámetro porque el resultado significa cosas distintas y
 * el que llama tiene que elegir cuál pide: uno es "estuvo", el otro es "no
 * estuvo y está bien".
 */
export function diasJustificadosPorColaborador(
  justificaciones: readonly JustificacionAsistencia[],
): Map<number, number> {
  return contarDiasDistintos(justificaciones);
}

/**
 * Días DISTINTOS por colaborador. Privado: lo que se exporta son las dos
 * lecturas con nombre, no la cuenta cruda.
 *
 * Cuenta días distintos y no filas porque el `@@unique([inventarioId,
 * colaboradorId, dia])` de las dos tablas ya lo impide en la base, pero estas
 * funciones son puras y no pueden apoyarse en eso: las reciben tests, y el
 * día que las alimente otra consulta (un `findMany` con join mal armado, un
 * import) dos filas repetidas le regalarían un día a alguien.
 */
function contarDiasDistintos(filas: readonly { colaboradorId: number; dia: string }[]): Map<number, number> {
  const diasPorColaborador = new Map<number, Set<string>>();

  for (const fila of filas) {
    const dias = diasPorColaborador.get(fila.colaboradorId);
    if (dias) dias.add(fila.dia);
    else diasPorColaborador.set(fila.colaboradorId, new Set([fila.dia]));
  }

  return new Map([...diasPorColaborador].map(([colaboradorId, dias]) => [colaboradorId, dias.size]));
}

/**
 * LA MULTA DE UNA PERSONA: `(días del inventario − días que asistió) × tarifa`.
 *
 * NUNCA NEGATIVA, y el recorte no es defensivo de adorno: `diasInventario`
 * viene CONGELADO del cierre del conteo y `diasAsistidos` de las marcas de
 * hoy. Si alguna vez se agregara una marca en un día nuevo después de cerrar
 * -- hoy la API lo impide, mañana la impide otra persona -- alguien tendría
 * más días asistidos que días de inventario, y una multa negativa es un PAGO
 * al colaborador que nadie autorizó. Se recorta acá, donde se ve.
 *
 * La cuenta va en CENTAVOS ENTEROS, igual que `reparto-de-fondo.ts`: una
 * tarifa de S/20.10 por 3 días da 60.300000000000004 en punto flotante, y
 * este número entra directo a la suma que tiene que cerrar contra el fondo.
 * Con centavos es exacto por construcción, no por suerte del redondeo.
 */
export function multaPorInasistencia(dias: DiasDeUnaPersona, tarifaPorDia: number): number {
  return (Math.round(tarifaPorDia * 100) * diasFaltadosCobrables(dias)) / 100;
}

/**
 * Los días de una persona en un inventario. UN OBJETO y no tres parámetros
 * sueltos a propósito: son tres enteros que el compilador no puede
 * distinguir entre sí, y pasarlos en el orden equivocado no rompe nada --
 * devuelve una multa distinta, sin error, sobre un sueldo.
 */
export interface DiasDeUnaPersona {
  /** El denominador CONGELADO del inventario (`ResultadoInventario.diasDelInventario`). */
  diasInventario: number;
  /** Días que estuvo de verdad: marcas del coordinador. */
  diasAsistidos: number;
  /** Días que faltó y el auditor le perdonó. Se SUMAN a los asistidos, acá. */
  diasJustificados: number;
}

/**
 * LOS DÍAS QUE DE VERDAD SE COBRAN: `dias − asistidos − justificados`, nunca
 * negativo.
 *
 * Existe como función propia -- en vez de estar suelta adentro de la multa --
 * porque la misma resta decide DOS cosas que no pueden discrepar: cuánta
 * multa paga alguien y si cobra bono. `quienesCobranBono` la usa también, así
 * que "no paga multa" y "cobra bono" son literalmente el mismo cálculo. El
 * día que dejen de serlo, el fondo se reparte entre gente que además aportó y
 * la planilla deja de sumar el neto.
 *
 * EL RECORTE A 0 NO ES DEFENSIVO DE ADORNO: `diasInventario` viene congelado
 * del cierre del conteo y los otros dos salen de las tablas de hoy. Con una
 * marca o una justificación de más -- un día fuera del inventario, un padrón
 * que cambió -- alguien tendría más días cubiertos que días de inventario, y
 * una multa negativa es un PAGO al colaborador que nadie autorizó.
 */
export function diasFaltadosCobrables(dias: DiasDeUnaPersona): number {
  return Math.max(0, dias.diasInventario - dias.diasAsistidos - dias.diasJustificados);
}

/**
 * QUIENES COBRAN BONO: los que cubrieron todos los días del inventario --
 * viniendo o con la falta perdonada --, o sea los que no pagan multa. Las dos
 * frases describen el mismo conjunto y tiene que seguir siendo así: si alguna
 * vez alguien pudiera cobrar bono Y pagar multa, el fondo dejaría de cerrar
 * (se repartiría entre gente que además aportó). Por eso el criterio es
 * `diasFaltadosCobrables(...) === 0` y no una comparación escrita de nuevo
 * acá: es la MISMA función que calcula la multa.
 *
 * SE LLAMABA `quienesAsistieronTodo`, y se renombró con las justificaciones.
 * El nombre viejo pasó a ser mentira: quien tiene los tres días perdonados
 * está en este conjunto y no asistió ni uno. Lo que el conjunto describe es
 * quién COBRA, no quién estuvo -- y ese es el dato que se usa para repartir.
 *
 * `diasInventario` llega por parámetro en vez de calcularse de `marcas`
 * porque el número que manda es el CONGELADO al cerrar el conteo. Derivarlo
 * acá haría que el conjunto cambiara si alguien borra la última marca de un
 * día: se caería un día del inventario, y de golpe una persona que faltó ese
 * día pasaría a "vino todos los días" y cobraría bono. La multa y el bono
 * tienen que mirar el MISMO denominador o el fondo no cierra.
 *
 * Con `diasInventario` en 0 no cobra bono nadie: no hubo inventario que
 * asistir. Es el caso degenerado que el cierre de la planilla corta antes de
 * escribir una fila.
 */
export function quienesCobranBono(e: {
  marcas: readonly MarcaAsistencia[];
  justificaciones: readonly JustificacionAsistencia[];
  diasInventario: number;
}): Set<number> {
  const conBono = new Set<number>();
  if (e.diasInventario <= 0) return conBono;

  const asistidos = diasAsistidosPorColaborador(e.marcas);
  const justificados = diasJustificadosPorColaborador(e.justificaciones);

  // El universo son las dos listas juntas: alguien que faltó todos los días y
  // tiene TODOS perdonados cobra bono, y no aparece en las marcas.
  for (const colaboradorId of new Set([...asistidos.keys(), ...justificados.keys()])) {
    const dias = {
      diasInventario: e.diasInventario,
      diasAsistidos: asistidos.get(colaboradorId) ?? 0,
      diasJustificados: justificados.get(colaboradorId) ?? 0,
    };
    if (diasFaltadosCobrables(dias) === 0) conBono.add(colaboradorId);
  }

  return conBono;
}

/**
 * La consulta de Prisma que alimenta a todo lo de arriba, EN UN SOLO LUGAR.
 *
 * Mismo criterio que tenía `SELECT_ASISTENCIA` cuando la asistencia se
 * deducía de las hojas, y por la misma razón: la usan el cierre del conteo
 * (para congelar `diasDelInventario` y `colaboradoresAsistieron`) y el cierre
 * de la planilla (para la multa de cada fila). Si cada uno armara su propia
 * query, un día una filtraría algo que la otra no, y la planilla tendría un
 * denominador distinto del que quedó firmado en el resultado. Ese número lo
 * firma alguien.
 */
export const SELECT_ASISTENCIA = {
  colaboradorId: true,
  dia: true,
} as const;

/**
 * La consulta de las JUSTIFICACIONES, por lo mismo y en el mismo lugar. No
 * trae `motivo` ni quién firmó: para la plata sólo cuenta qué días son de
 * quién. El motivo es para la pantalla y para el reclamo, y lo lee el módulo
 * de asistencia.
 */
export const SELECT_JUSTIFICACIONES = {
  colaboradorId: true,
  dia: true,
} as const;

/** Traduce la fila de Prisma a una justificación. Mismo cuidado con el día. */
export function aJustificacionAsistencia(fila: { colaboradorId: number; dia: Date }): JustificacionAsistencia {
  return {
    colaboradorId: fila.colaboradorId,
    dia: fila.dia.toISOString().slice(0, 10),
    justificada: true,
  };
}

/**
 * Traduce la fila de Prisma a lo que la regla entiende.
 *
 * `dia` es `@db.Date` y Prisma lo devuelve como un `Date` en MEDIANOCHE UTC.
 * Se formatea con los getters UTC, NUNCA con los locales: en Lima (UTC−5),
 * `getDate()` sobre la medianoche UTC del 3 devuelve el 2. Todas las marcas
 * se correrían un día para atrás, los días del inventario podrían duplicarse
 * y alguien pagaría una multa por un día que no existió.
 */
export function aMarcaAsistencia(fila: { colaboradorId: number; dia: Date }): MarcaAsistencia {
  return {
    colaboradorId: fila.colaboradorId,
    dia: fila.dia.toISOString().slice(0, 10),
  };
}
