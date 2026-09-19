/**
 * El CICLO DE CONTEOS: qué cantidad vale para un ítem, qué pasa cuando se
 * cierra una ronda y qué ítems vuelven a contarse en la siguiente.
 *
 * PURO -- sin Prisma ni Express -- para poder probar las reglas de verdad
 * (ver ciclo-conteos.test.ts). Mismo criterio que `dominio/lote.ts`.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EL CICLO EXISTE
 * ---------------------------------------------------------------------------
 * Recontar 1.236 ítems tres veces son tres jornadas. El sentido del ciclo no
 * es contar todo tres veces: es CERRAR lo que ya cuadró y volver solo sobre
 * lo dudoso. En el ejemplo del cliente: 8.000 ítems en la 1ra ronda, 650 en
 * la 2da, 130 en la 3ra (docs/pantallas.md, Pantalla 4). El embudo es el
 * mecanismo, no un adorno del mockup.
 *
 * ---------------------------------------------------------------------------
 * YA NO SON TRES PASADAS Y SE ACABO. DECISION DEL CLIENTE (2026-09-19)
 * ---------------------------------------------------------------------------
 * El AUDITOR puede abrir MAS conteos de los configurados -- un 4to, un 5to --
 * inventario por inventario, cuando haga falta. No es un número fijo decidido
 * por adelantado: es una decisión que se toma mirando lo que quedó sin cuadrar.
 *
 * Eso parte en dos lo que antes era una sola pregunta. `RONDAS_DEL_CICLO`
 * dejó de ser el techo del inventario y pasó a ser el final del tramo
 * AUTOMATICO -- hasta ahí el ciclo se encadena solo al cerrar cada ronda.
 * Después no se termina nada: el inventario queda esperando al Auditor, que
 * decide entre abrir otra pasada (`puedeAuditorAbrirOtraRonda`) o arrancar su
 * ajuste final. Por eso hay DOS funciones y no una con un parámetro más:
 * quien pregunta "¿sigo solo?" y quien pregunta "¿puedo abrir otra?" no son
 * la misma persona ni el mismo momento.
 *
 * Las reglas de acá abajo ya eran indiferentes a la cantidad de rondas --
 * todas trabajan sobre la lista de conteos, no sobre tres campos.
 */

/**
 * Lo mínimo para decidir el destino de un ítem al cerrar una ronda.
 * Cualquier objeto con esto sirve -- el dominio no conoce Prisma.
 */
export interface ItemDeRonda {
  /** ItemNumber de Dynamics: la identidad estable entre rondas. */
  codigo: string;
  /**
   * Lo que dice el ERP. `null` = el snapshot no lo trajo, así que este ítem
   * NO SE PUEDE AUDITAR -- ver CatalogoItem.stockErp.
   */
  stockErp: number | null;
  /**
   * Lo contado en CADA ronda, en orden: índice 0 = ronda 1, índice 1 = ronda
   * 2, etc. `null` en una posición = ese ítem no se contó en esa ronda (o
   * porque no entró, o porque la hoja se finalizó sin contarlo).
   *
   * Es una lista y no tres campos sueltos porque `CANTIDAD_CONTEOS_CICLO` es
   * configurable. Ese día llegó (2026-09-19: el Auditor abre rondas extra) y
   * efectivamente no hubo que cambiar nada acá -- la lista puede tener 3
   * elementos o 7. Lo que sí hubo que cambiar fue `auditoria.calculos.ts`,
   * que tenía los tres campos sueltos.
   */
  conteos: ReadonlyArray<number | null>;
}

/**
 * ===========================================================================
 * LA REGLA DEL CLIENTE: **EL ÚLTIMO CONTEO MANDA**
 * ===========================================================================
 *
 * Vale la última pasada que se hizo del ítem, sin importar las anteriores.
 *
 *     1º  18 unidades
 *     2º  12 unidades
 *     3º  17 unidades   <- vale 17
 *
 * NO es consenso 2-de-3, y el número que vale NO se elige mirando cuál se
 * parece más al ERP. Se toma el último que exista y punto. (El ERP sí entra
 * después, en `cuadro`, para decidir si hay diferencia -- son dos preguntas
 * distintas: "cuánto hay" y "coincide con lo que el sistema esperaba".)
 *
 * ---------------------------------------------------------------------------
 * EL TRADEOFF, QUE EL CLIENTE ACEPTÓ CONSCIENTEMENTE
 * ---------------------------------------------------------------------------
 * Si el 3er conteo se hace apurado a fin de jornada, ese número entra igual y
 * NADA LO FRENA. No hay consenso que lo contradiga, ni una comparación con
 * las pasadas anteriores que levante la mano: 17 pisa a 18 y a 12 aunque esas
 * dos se parecieran entre sí y la tercera fuera la rara.
 *
 * Se eligió así igual, y por una razón: la última pasada es la que hace el
 * Auditor sobre un universo ya chico (130 ítems, no 8.000), con tiempo y
 * mirando el producto de nuevo. Darle más peso a dos conteos rápidos de
 * góndola que a esa revisión sería al revés de como trabaja la gente.
 *
 * ESTO FUE UNA DECISIÓN, NO UN DESCUIDO. Quien lea esto en seis meses y vea
 * un faltante raro no tiene que "arreglar" la regla: tiene que preguntar
 * quién hizo la última pasada de ese ítem y cuándo.
 *
 * Si alguna vez se revierte, se cambia SOLO esta función.
 */
export function conteoQueManda(conteos: ReadonlyArray<number | null>): number | null {
  // De atrás hacia adelante: la primera ronda con dato, empezando por la
  // última. Un `0` es un conteo válido ("no hay ninguno en góndola"), así que
  // se compara contra null, nunca por falsy.
  for (let i = conteos.length - 1; i >= 0; i--) {
    const valor = conteos[i];
    if (valor !== null && valor !== undefined) return valor;
  }
  return null;
}

/**
 * Si el ítem coincide con lo que dice el ERP.
 *
 * Compara `conteoQueManda` (la regla de arriba) contra `stockErp`. Es la
 * misma comparación que hace `auditoria.calculos.ts#veredicto` -- si esta
 * cambia, aquella tiene que cambiar igual.
 *
 * Sin stock del ERP nunca "cuadra": no hay contra qué comparar. Tampoco
 * cuenta como diferencia -- ver `destinoTrasRonda`.
 */
export function cuadro(item: ItemDeRonda): boolean {
  const contado = conteoQueManda(item.conteos);
  if (item.stockErp === null || contado === null) return false;
  return contado === item.stockErp;
}

/**
 * Qué le pasa a un ítem cuando se cierra la ronda:
 *
 *   'cuadrado'      Coincide con el ERP. Sale del ciclo: no se recuenta.
 *   'recontar'      Hay diferencia, o nunca se contó en ninguna ronda.
 *   'sin_dato_erp'  El snapshot no trajo stock. NO se recuenta y NO se da por
 *                   cuadrado: contarlo diez veces más no arregla que falte el
 *                   número del ERP. Se reporta aparte para que alguien vaya a
 *                   buscar el dato en Dynamics, que es lo único que lo resuelve.
 */
export type DestinoItem = 'cuadrado' | 'recontar' | 'sin_dato_erp';

/**
 * UN ÍTEM QUE NUNCA SE CONTÓ VA A RECONTAR, no se asume cero.
 *
 * Ojo con la diferencia respecto de "no se contó en ESTA ronda": si se contó
 * en la ronda 1 y la hoja de la ronda 2 se finalizó sin tocarlo, manda el de
 * la ronda 1 (`conteoQueManda`) y ese número se compara contra el ERP. NO es
 * "sin contar" -- hay un conteo, es viejo pero existe.
 *
 * "Sin contar" (todas las rondas en null) es cuando NINGUNA ronda tiene dato,
 * y ahí este dominio NO asume cero: que nadie haya mirado el renglón no
 * significa que en la góndola no haya nada. Darlo por cero reportaría un
 * faltante total inventado, y con el precio de venta encima eso termina en el
 * descuento de sueldo de alguien. En la duda, se recuenta: cuesta un ítem más
 * en la ronda siguiente.
 *
 * DECISIÓN DEL CLIENTE (2026-09-05): ese `null` casi no aparece más, y no por
 * este dominio sino por `finalizar`. Al finalizar una hoja, cada producto sin
 * contar se registra con un Conteo en 0 EXPLÍCITO ("si no hay el producto, es
 * 0"; ver hojas.service.ts#finalizar y el adaptador móvil). Eso llega acá
 * como `[0]`, no como `[null]`: un conteo real que se trata como cualquier
 * otro (0 vs stock > 0 = diferencia → recontar; 0 vs stock 0 = cuadra). El
 * `null` que queda es solo lo que de verdad nadie miró -- un ítem que jamás
 * entró a una hoja finalizada. El 0 afirmado por quien cerró la hoja y el
 * cero automático prohibido son dos cosas distintas, y mantener esa
 * distinción es lo que hace esta función.
 */
export function destinoTrasRonda(item: ItemDeRonda): DestinoItem {
  if (item.stockErp === null) return 'sin_dato_erp';
  return cuadro(item) ? 'cuadrado' : 'recontar';
}

/**
 * Los ítems que entran a la ronda siguiente: los que no cuadraron.
 *
 * Conserva el orden de entrada -- quien llama ya los ordenó para contar
 * (`lote.ts#ordenarParaContar`) y reordenarlos acá rompería el recorrido de
 * la tienda. No muta el arreglo recibido.
 */
export function itemsParaLaRondaSiguiente<T extends ItemDeRonda>(items: readonly T[]): T[] {
  return items.filter((i) => destinoTrasRonda(i) === 'recontar');
}

/**
 * Las cifras del cierre. LOS NOMBRES IMPORTAN ACÁ MÁS QUE EN NINGÚN OTRO
 * LADO: esto es lo que lee el Coordinador para decidir si cierra la ronda y
 * manda a once personas a recontar.
 *
 * Antes existía un campo `contados` que en realidad era el total del
 * universo, y sobre una ronda sin ningún conteo cargado devolvía
 * `contados: 1236` junto con `sinContar: 1236`. Leído rápido, eso dice "ya
 * se contaron los 1.236" — y el Coordinador cerraba una ronda vacía. Un
 * resumen cuyas cifras no cierran entre sí es peor que no tener resumen,
 * porque se lee igual y lleva a decidir mal.
 *
 * DOS INVARIANTES, verificados en los tests:
 *
 *     total = cuadrados + aRecontar + sinDatoErp     (los tres destinos)
 *     total = contados  + sinContar                  (con dato o sin dato)
 */
export interface ResumenDeRonda {
  /** Ítems que ENTRARON a la ronda. No dice nada sobre si se contaron. */
  total: number;
  /** De esos, cuántos tienen conteo en alguna ronda (la actual o anterior). */
  contados: number;
  /** Cuántos no tienen conteo en NINGUNA ronda: nadie los miró todavía. */
  sinContar: number;
  cuadrados: number;
  /** Van a la ronda siguiente. */
  aRecontar: number;
  /** No se pueden auditar: falta el stock del ERP. No se recuentan. */
  sinDatoErp: number;
  /** % de ítems que cuadraron sobre los AUDITABLES (los que tienen stock). */
  porcentajeCuadrado: number;
}

/**
 * El embudo de la Pantalla 4, calculado al cerrar la ronda. Es lo que le
 * dice al Coordinador si tiene sentido abrir otra pasada: si de 1.236 ítems
 * quedan 12, la ronda 2 es media hora; si quedan 900, algo se contó mal y hay
 * que mirar eso antes de mandar a la gente a recontar.
 */
export function resumirRonda(items: readonly ItemDeRonda[]): ResumenDeRonda {
  const r: ResumenDeRonda = {
    total: items.length,
    contados: 0,
    sinContar: 0,
    cuadrados: 0,
    aRecontar: 0,
    sinDatoErp: 0,
    porcentajeCuadrado: 0,
  };

  for (const item of items) {
    // Contado o no, INDEPENDIENTE del destino: un ítem sin stock del ERP
    // igual puede estar contado, y uno que va a recontar puede tener un
    // conteo viejo. Así `contados + sinContar` cierra siempre contra el total.
    if (conteoQueManda(item.conteos) === null) r.sinContar += 1;
    else r.contados += 1;

    const destino = destinoTrasRonda(item);
    if (destino === 'cuadrado') r.cuadrados += 1;
    else if (destino === 'sin_dato_erp') r.sinDatoErp += 1;
    else r.aRecontar += 1;
  }

  const auditables = items.length - r.sinDatoErp;
  r.porcentajeCuadrado = auditables === 0 ? 0 : Math.round((r.cuadrados / auditables) * 1000) / 10;
  return r;
}

/**
 * Hasta dónde llega el tramo AUTOMATICO del ciclo. Es el DEFAULT: el valor
 * real sale de la config `CANTIDAD_CONTEOS_CICLO` y viaja por parámetro.
 *
 * NO es el máximo de rondas de un inventario. Desde que el Auditor puede
 * abrir pasadas extra, este número solo dice hasta dónde se encadenan las
 * rondas solas al cerrar cada una. Un inventario puede terminar con 6 rondas
 * y este valor seguir en 3.
 */
export const RONDAS_DEL_CICLO = 3;

/** La respuesta a las dos preguntas de abajo. `motivo` explica el `false`. */
export interface AperturaDeRonda {
  puede: boolean;
  motivo: string | null;
}

/**
 * NADA QUE RECONTAR: el final feliz del ciclo, y vale para los dos que
 * pueden abrir una ronda.
 *
 * Se factoriza porque es la MISMA regla en las dos preguntas y tiene que dar
 * lo mismo: si todo cuadró, no hay ronda que abrir, la pida el ciclo o la
 * pida el Auditor. Contar de nuevo un universo vacío no es cero trabajo --
 * es mandar gente a la tienda a mirar una lista sin renglones.
 */
function siHayAlgoQueRecontar(itemsARecontar: number): AperturaDeRonda | null {
  if (itemsARecontar === 0) {
    return { puede: false, motivo: 'Todos los ítems cuadraron contra el ERP: no queda nada para recontar.' };
  }
  return null;
}

/**
 * ¿SIGUE SOLO EL CICLO después de cerrar `ronda`? La pregunta del
 * Coordinador, que es quien cierra las rondas.
 *
 * OJO CON EL SIGNIFICADO DE `puede: false`, QUE CAMBIO. Antes quería decir
 * "se terminó el conteo, andá a auditar". Ahora quiere decir "hasta acá llega
 * lo automático": el inventario NO pasa a cerrado, queda esperando al
 * Auditor, que abre otra pasada o arranca su ajuste final. Un llamador que
 * lea este `false` como "cerrá el conteo" se saltea al Auditor -- que es
 * justamente el paso que el cliente pidió agregar.
 *
 * Los dos motivos del `false` siguen siendo los mismos y siguen en ese orden:
 * primero "no quedó nada" (el caso feliz, y el mensaje más útil), después el
 * límite del tramo automático.
 */
export function puedeAbrirRondaSiguiente(
  ronda: number,
  itemsARecontar: number,
  totalRondas: number = RONDAS_DEL_CICLO,
): AperturaDeRonda {
  const nadaQueRecontar = siHayAlgoQueRecontar(itemsARecontar);
  if (nadaQueRecontar !== null) return nadaQueRecontar;

  if (ronda >= totalRondas) {
    return {
      puede: false,
      motivo:
        `La ronda ${ronda} es la última del ciclo automático (${totalRondas} conteos). ` +
        'Sigue el Auditor: puede abrir otra pasada o iniciar el ajuste final.',
    };
  }
  return { puede: true, motivo: null };
}

/**
 * ¿PUEDE EL AUDITOR ABRIR OTRA PASADA? La pregunta del botón nuevo
 * (`POST /api/inventarios/:id/rondas/abrir`).
 *
 * NO MIRA EL LIMITE DEL CICLO, a propósito: ese límite es el del tramo
 * automático y el Auditor existe justamente para pasarlo. Que la ronda 4
 * exista es la funcionalidad, no una excepción que haya que justificar.
 *
 * Lo único que lo frena es que no quede nada por recontar -- la misma regla
 * que frena al ciclo, por la misma razón.
 *
 * LO QUE ESTA FUNCION NO SABE, y tiene que chequear quien la llame: en qué
 * estado está el inventario. El Auditor abre rondas ANTES de iniciar su
 * ajuste; una vez en `ajuste_auditor` ya no se vuelve atrás. Ese dato es de
 * la capa de servicio (`Inventario.estado`) y este dominio no lo conoce, por
 * la misma razón que no conoce Prisma.
 */
export function puedeAuditorAbrirOtraRonda(itemsARecontar: number): AperturaDeRonda {
  return siHayAlgoQueRecontar(itemsARecontar) ?? { puede: true, motivo: null };
}

/**
 * ¿YA EMPEZÓ A CONTARSE ESTA RONDA?
 *
 * La pregunta la hace la corrección: cuando se corrige un conteo con la ronda
 * ya cerrada y el ítem pasa a cuadrar, se lo saca de la ronda siguiente para
 * que nadie lo recuente al pedo -- que es textual para lo que el cliente pidió
 * la corrección: *"puedes corregirlo para que ya no salga en mi segundo
 * conteo"*. Pero solo si esa ronda todavía no arrancó.
 *
 * EL PORQUÉ, que es lo que decide todos los bordes: NO SE LE CAMBIA LA HOJA A
 * ALGUIEN QUE YA LA TIENE EN LA MANO. Sacar un renglón de una hoja que alguien
 * está recorriendo es peor que dejar un renglón de más -- el de más se cuenta
 * y cuadra, el que desaparece deja a la persona buscando un producto que ya no
 * figura, o peor, corre la numeración de lo que tiene anotado en papel.
 *
 * ---------------------------------------------------------------------------
 * POR RONDA, NO POR PRODUCTO
 * ---------------------------------------------------------------------------
 * Alcanza con que UNA hoja de la ronda haya arrancado para que no se saque
 * NADA, ni siquiera un ítem que en esa ronda todavía nadie tocó. Es la
 * decisión del usuario, preguntada explícitamente: mirar producto por producto
 * corrige más casos, pero le modifica la hoja a alguien que ya está trabajando
 * en ella, y eso es justo lo que no se quiere.
 *
 * ---------------------------------------------------------------------------
 * LAS DOS CONDICIONES, Y POR QUÉ NINGUNA ALCANZA SOLA
 * ---------------------------------------------------------------------------
 *   - `estado !== 'pendiente'` cubre a la persona que abrió la hoja y está
 *     caminando la góndola sin haber cargado nada todavía. Solo con los
 *     conteos, esa hoja parecería intacta.
 *   - `conteos > 0` cubre el caso contrario: un estado que quedó atrás. La
 *     hoja nace `pendiente` (ver `materializarRonda`) y pasa a `en_proceso` al
 *     guardar el primer conteo, pero apoyarse solo en el estado es confiar en
 *     que esa transición nunca falló ni se salteó por otro camino.
 *
 * Una ronda SIN NINGUNA HOJA da `false` -- no empezó. En la práctica no se
 * llega con ese caso (si no hay hojas no hay ronda siguiente que limpiar), y
 * `false` es igual la respuesta honesta: nadie empezó a contar algo que no
 * existe.
 */
export interface HojaDeLaRonda {
  /** `HojaConteo.estado` (schema.prisma#EstadoHoja). La hoja nace `pendiente`. */
  estado: 'pendiente' | 'en_proceso' | 'finalizada';
  /** Cuántas filas `Conteo` tiene la hoja. */
  conteos: number;
}

export function rondaEmpezo(hojas: readonly HojaDeLaRonda[]): boolean {
  return hojas.some((h) => h.estado !== 'pendiente' || h.conteos > 0);
}
