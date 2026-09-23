/**
 * EL ESTADO DEL REPARTO: quién tiene hoja, quién está presente, y si por eso
 * hace falta repartir de nuevo.
 *
 * Vive acá y no dentro de `app/coordinador/armar.tsx` por lo mismo que
 * `asistencia.ts`: es una regla de negocio, y así se prueba sin montar React
 * Native (ver reparto-de-hojas.test.ts). La pantalla se queda solo con
 * pintar lo que estas funciones devuelven.
 *
 * ---------------------------------------------------------------------------
 * EL FALSO POSITIVO QUE ESTO ARREGLA (medido en el inventario 8073, 2026-09-22)
 * ---------------------------------------------------------------------------
 * La ronda 4 de Market Luzuriaga tenía UNA hoja de 5 ítems, asignada a Carla
 * Depaz, con 4 contadores presentes marcados desde la mañana. La asistencia
 * no había cambiado y la pantalla igual mostraba "La asistencia cambió
 * después de repartir" con el botón rojo de repartir de nuevo; tocarlo
 * reasignaba esa única hoja y el aviso volvía a aparecer.
 *
 * La condición vieja comparaba el CONJUNTO de gente con hoja contra el
 * CONJUNTO de presentes y exigía que fueran IGUALES. Con 1 hoja y 4
 * presentes esa igualdad es imposible -- una hoja va a una persona, no a
 * cuatro -- así que el aviso quedaba prendido para siempre. Y las rondas de
 * reconteo son justo donde hay pocas hojas: es el caso normal, no el raro.
 *
 * ---------------------------------------------------------------------------
 * PARA QUÉ EXISTE EL AVISO, QUE ES LO QUE DEFINE CUÁNDO VA
 * ---------------------------------------------------------------------------
 * Existe por EL QUE LLEGA TARDE: se repartió, apareció alguien más, el
 * Coordinador le marcó la entrada y hay que incluirlo. O sea, el aviso va
 * cuando repartir de nuevo CAMBIA algo:
 *
 *   `hoja-sin-contador`  alguien que TIENE hoja ya no está presente (se fue,
 *                        o se le desmarcó la entrada). Hay que repartir sí o
 *                        sí: esa hoja no la va a contar nadie.
 *   `presente-sin-hoja`  hay presentes sin hoja Y repartir de nuevo les daría
 *                        una DE VERDAD, o sea hay más hojas que personas con
 *                        hoja. Sin esa segunda mitad el aviso vuelve a ser el
 *                        falso positivo de arriba.
 *
 * Si hay MENOS hojas que presentes y todas están en manos de alguien que
 * está, no hay nada que arreglar y el aviso no va. Menos ítems que personas
 * es un caso real que no se puede evitar, y no es un error.
 */

import { pluralizar, unirConY } from './plural';

/** Lo único que hace falta de una hoja: a quiénes quedó asignada, por nombre. */
export interface HojaRepartida {
  /**
   * Los NOMBRES (ver `HojaConteo.asignados`). Se compara por nombre porque es
   * lo único que trae la hoja -- el servidor devuelve los nombres ya
   * resueltos, no los ids. Alcanza: son los nombres del mismo padrón, y una
   * coincidencia falsa (dos personas con el mismo nombre en una tienda) haría
   * que no se ofrezca repartir de nuevo, no que se reparta mal.
   */
  asignados: readonly string[];
}

export type MotivoParaRepartirDeNuevo = 'hoja-sin-contador' | 'presente-sin-hoja';

export interface EstadoDelReparto {
  /** `null` = el reparto está bien como está y no va ningún aviso. */
  motivo: MotivoParaRepartirDeNuevo | null;
  /** Quiénes tienen al menos una hoja, en el orden en que aparecen en las hojas. */
  conHoja: string[];
  /** De ésos, los que hoy no figuran presentes. */
  conHojaAusentes: string[];
  /** Los contadores presentes que no tienen ninguna hoja. */
  presentesSinHoja: string[];
  /** Cuántas hojas quedaron en manos de alguien que hoy no está. */
  hojasDeAusentes: number;
  totalHojas: number;
  totalPresentes: number;
  /** Cuántas hojas tiene cada persona con hoja: `[mínimo, máximo]`. `[0, 0]` sin hojas. */
  hojasPorPersona: [number, number];
}

export function estadoDelReparto(
  hojas: readonly HojaRepartida[],
  presentes: readonly string[],
): EstadoDelReparto {
  const presentesSet = new Set(presentes);

  // Cuántas hojas tiene cada uno, contando TODOS los asignados de cada hoja:
  // una hoja compartida entre dos la tienen los dos. `Map` conserva el orden
  // de aparición, que es el orden de las hojas -- el mismo que ve el
  // Coordinador en la lista.
  const hojasDe = new Map<string, number>();
  for (const hoja of hojas) {
    for (const nombre of hoja.asignados) {
      hojasDe.set(nombre, (hojasDe.get(nombre) ?? 0) + 1);
    }
  }

  const conHoja = [...hojasDe.keys()];
  const conHojaAusentes = conHoja.filter((nombre) => !presentesSet.has(nombre));
  const presentesSinHoja = presentes.filter((nombre) => !hojasDe.has(nombre));
  const hojasDeAusentes = hojas.filter((h) => h.asignados.some((n) => !presentesSet.has(n))).length;

  const cuentas = [...hojasDe.values()];
  const hojasPorPersona: [number, number] =
    cuentas.length === 0 ? [0, 0] : [Math.min(...cuentas), Math.max(...cuentas)];

  // El orden de las dos preguntas importa: una hoja en manos de alguien que
  // no está es plata parada (nadie la cuenta), y eso manda sobre "falta
  // incluir a alguien".
  const motivo: MotivoParaRepartirDeNuevo | null =
    conHojaAusentes.length > 0
      ? 'hoja-sin-contador'
      : // La segunda mitad -- `totalHojas > conHoja.length` -- es la que mata
        // el falso positivo: sin ella, 1 hoja y 4 presentes pedía repartir de
        // nuevo eternamente. Con ella, el aviso solo aparece cuando después
        // de repartir hay MÁS gente con hoja que ahora.
        presentesSinHoja.length > 0 && hojas.length > conHoja.length
        ? 'presente-sin-hoja'
        : null;

  return {
    motivo,
    conHoja,
    conHojaAusentes,
    presentesSinHoja,
    hojasDeAusentes,
    totalHojas: hojas.length,
    totalPresentes: presentes.length,
    hojasPorPersona,
  };
}

/**
 * Hasta tres nombres; de ahí en adelante, "y N más".
 *
 * Sin el tope, una tienda grande con ocho contadores sin hoja pinta un
 * párrafo de nombres dentro de un aviso que se lee de un vistazo. Los tres
 * primeros alcanzan para reconocer de quién se habla, y el "y N más" no
 * esconde el tamaño del problema.
 *
 * El tope se estira en uno: con CUATRO nombres, recortar el último para
 * escribir "y 1 más" no ahorra nada y encima esconde justo al que suele
 * importar (el que se fue, el que llegó tarde). El recorte recién paga
 * cuando de verdad hay varios de sobra.
 */
function nombresCortos(nombres: readonly string[], maximo = 3): string {
  if (nombres.length <= maximo + 1) return unirConY(nombres);
  return `${nombres.slice(0, maximo).join(', ')} y ${nombres.length - maximo} más`;
}

/**
 * EL AVISO, o `null` si no hay nada que avisar.
 *
 * Cada motivo tiene su texto porque son dos situaciones distintas y la vieja
 * las decía las dos mal a la vez: "las hojas están repartidas entre otra
 * gente" es falso cuando los que tienen hoja SÍ están presentes y lo único
 * que pasa es que llegó alguien más.
 */
export function textoRepartoDesactualizado(estado: EstadoDelReparto): string | null {
  const presentes = `${estado.totalPresentes} ${pluralizar(estado.totalPresentes, 'contador presente', 'contadores presentes')}`;

  if (estado.motivo === 'hoja-sin-contador') {
    const quienes = estado.conHojaAusentes;
    return (
      `${nombresCortos(quienes)} ${pluralizar(quienes.length, 'tiene', 'tienen')} ` +
      `${estado.hojasDeAusentes} ${pluralizar(estado.hojasDeAusentes, 'hoja asignada', 'hojas asignadas')} ` +
      `y hoy no ${pluralizar(quienes.length, 'figura', 'figuran')} entre los presentes: ` +
      `${pluralizar(estado.hojasDeAusentes, 'nadie la va a contar', 'nadie las va a contar')}. ` +
      `Vuelve a repartir entre los ${presentes}.`
    );
  }

  if (estado.motivo === 'presente-sin-hoja') {
    const quienes = estado.presentesSinHoja;
    return (
      `${nombresCortos(quienes)} ${pluralizar(quienes.length, 'está presente', 'están presentes')} ` +
      `y todavía no ${pluralizar(quienes.length, 'tiene', 'tienen')} hoja, ` +
      `y las ${estado.totalHojas} hojas están repartidas entre ${estado.conHoja.length} ` +
      `${pluralizar(estado.conHoja.length, 'persona', 'personas')}. ` +
      `Vuelve a repartir entre los ${presentes}.`
    );
  }

  return null;
}

/**
 * EL TEXTO DEL PASO 3 CON EL REPARTO HECHO.
 *
 * Cuando todos los presentes tienen hoja, dice lo de siempre: "repartidas
 * entre los N contadores presentes". Cuando NO -- porque hay menos hojas que
 * gente, o porque alguien llegó después -- nombra a quién quedó asignada en
 * vez de prometer un reparto que no ocurrió. Ese "ya está repartida entre los
 * 4 contadores presentes" sobre una única hoja en manos de una sola persona
 * era la otra mitad del mismo bug.
 *
 * `formatoMiles` entra por parámetro para no importar `components/ui` desde
 * el dominio -- mismo criterio que `textoDeCriterios`.
 */
export function textoRepartoHecho(estado: EstadoDelReparto, formatoMiles: (n: number) => string): string {
  const lasHojas = pluralizar(estado.totalHojas, 'La única hoja', `Las ${formatoMiles(estado.totalHojas)} hojas`);
  const [min, max] = estado.hojasPorPersona;
  const porPersona = min === max ? `${min} ${pluralizar(min, 'hoja', 'hojas')} por persona` : `${min}–${max} hojas por persona`;

  if (estado.presentesSinHoja.length === 0 && estado.conHojaAusentes.length === 0) {
    const reparto = pluralizar(
      estado.totalPresentes,
      `${pluralizar(estado.totalHojas, 'está asignada', 'están asignadas')} al contador presente`,
      `${pluralizar(estado.totalHojas, 'está repartida', 'están repartidas')} entre los ${estado.totalPresentes} contadores presentes`,
    );
    return `${lasHojas} ya ${reparto}, en bloques contiguos (${porPersona}).`;
  }

  const quedaron = `${lasHojas} ${pluralizar(estado.totalHojas, 'quedó asignada', 'quedaron asignadas')} a ${nombresCortos(estado.conHoja)}.`;

  if (estado.conHojaAusentes.length > 0) {
    const quienes = estado.conHojaAusentes;
    return `${quedaron} ${nombresCortos(quienes)} ya no ${pluralizar(quienes.length, 'figura', 'figuran')} entre los presentes de hoy.`;
  }

  // Quedan dos formas de tener presentes sin hoja, y son lo contrario una de
  // la otra: o sobran hojas (llegó alguien después del reparto) o faltan
  // (menos ítems que personas, que no es un error de nadie).
  if (estado.totalHojas > estado.conHoja.length) {
    const quienes = estado.presentesSinHoja;
    return `${quedaron} ${nombresCortos(quienes)} ${pluralizar(quienes.length, 'está presente', 'están presentes')} y todavía no ${pluralizar(quienes.length, 'tiene', 'tienen')} hoja.`;
  }

  return `${quedaron} Hay ${estado.totalPresentes} contadores presentes: no alcanzan las hojas para todos.`;
}
