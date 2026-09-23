/**
 * Como se parte un inventario en hojas de conteo y como se reparten esas
 * hojas entre la gente presente.
 *
 * PURO -- sin Prisma ni Express -- para poder probar las reglas de verdad
 * (ver lote.test.ts). Mismo criterio que `dominio/empaque.ts`.
 *
 * ESPEJA `mobile/lib/dominio/lote.ts`, que existia primero y corria contra
 * el adaptador en memoria. La logica de particion y reparto es identica a
 * proposito: lo que el Coordinador ve en pantalla al elegir el tamaño tiene
 * que ser exactamente lo que el servidor va a crear. Si divergieran, la
 * previa diria "31 hojas" y el backend crearia otra cosa.
 *
 * Lo que SI vive solo aca es `ordenarParaContar`: el movil no tiene los
 * items del catalogo, solo el total.
 */

/** Lo minimo que necesita el ordenamiento. Cualquier objeto con esto sirve. */
export interface ItemOrdenable {
  /** ItemNumber de Dynamics. Desempata dentro de una misma categoria. */
  codigo: string;
  /** Categoria de "Catalogo Ventas". `null` = el ERP no la tiene. */
  categoria: string | null;
}

/**
 * Ordena los items en el orden en que se van a CONTAR, que no es el orden en
 * que Dynamics los devuelve.
 *
 * EL PROBLEMA QUE RESUELVE. El codigo de item de Dynamics no sigue el
 * recorrido fisico de la tienda: ordenando por codigo, una hoja de 50
 * arranca con un shampoo, sigue con una gaseosa y despues una lata de atun.
 * El operario cruza el local en cada renglon, y con 31 hojas cruza la tienda
 * treinta y una veces. Agrupando por categoria barre un sector y pasa al
 * siguiente -- es la diferencia entre una jornada y dos.
 *
 * Es el mismo criterio que usa el sistema de reportes que el cliente ya
 * tiene andando (`app_inventarioautomatico`), que ordena por categoria y
 * despues por producto. No se invento nada: se copio lo que ya funciona.
 *
 * LOS SIN CATEGORIA VAN AL FINAL, JUNTOS. No se descartan: un producto que
 * esta en la gondola tiene que contarse aunque el ERP no lo haya
 * clasificado. Y van juntos y no mezclados para que el operario sepa que
 * entro en la parte rara del recorrido y tenga que buscar.
 *
 * No muta el arreglo que recibe.
 */
export function ordenarParaContar<T extends ItemOrdenable>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const catA = a.categoria ?? '';
    const catB = b.categoria ?? '';
    if (catA !== catB) {
      // El vacio SIEMPRE ultimo, sin importar el alfabeto.
      if (catA === '') return 1;
      if (catB === '') return -1;
      return catA.localeCompare(catB, 'es');
    }
    return a.codigo.localeCompare(b.codigo, 'es');
  });
}

/**
 * EL TAMANO DE HOJA QUE DE VERDAD SE USA: el MENOR entre el que eligio el
 * Coordinador y lo que da repartir los items entre los presentes.
 *
 *     tamano efectivo = max(1, min(tamanoElegido, piso(totalItems / presentes)))
 *
 * ---------------------------------------------------------------------------
 * EL PROBLEMA QUE RESUELVE: LAS RONDAS CHICAS SALEN EN UNA SOLA HOJA
 * ---------------------------------------------------------------------------
 * El embudo angosta cada ronda. Con un tamano fijo de 50, la ronda 1 de 980
 * items da 20 hojas -- cinco por cabeza con 4 contadores, perfecto -- pero la
 * ronda 2 de 16 items da UNA hoja para UNA persona, y los otros tres se
 * quedan mirando. Medido en el inventario 8073 de Luzuriaga: ronda 2 = 1 hoja
 * de 16, ronda 3 = 1 hoja de 8, ronda 4 = 1 hoja de 5.
 *
 * Es el pedido textual de Gilmer (reunion 2, 00:38:29): *"solamente tienes 3
 * hojas de 20 items. ¿Como haria en ese caso para distribuirlos, solamente
 * asigno a 3 personas?"*, y el acuerdo: si hay 20 productos se le asigne a los
 * 20 presentes, *"uno, uno, uno cada uno... de manera que todos alcancen"*.
 * Su cierre dice por que importa: *"si no, va a salir por una persona y ya"*.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EL MENOR DE LOS DOS, Y NO SIEMPRE EL REPARTO
 * ---------------------------------------------------------------------------
 * El tamano elegido (20/30/50) sigue siendo un TECHO real: es cuanto puede
 * cargar una persona de una sentada sin perder el hilo del recorrido. Con 980
 * items y 4 presentes, repartir daria hojas de 245 -- nadie cuenta 245 items
 * seguidos. Por eso manda el menor: el reparto solo baja el tamano cuando la
 * ronda es tan chica que el techo ya no aprieta.
 *
 * Asi la ronda 1 NO CAMBIA en absoluto, que es lo que se quiere: lo que estaba
 * bien sigue igual y solo se arregla lo que estaba mal.
 *
 * ---------------------------------------------------------------------------
 * LOS DOS BORDES, Y LO QUE NO SE INVENTA EN NINGUNO
 * ---------------------------------------------------------------------------
 * MAS PRESENTES QUE ITEMS (5 items, 8 presentes): el piso da 0 y el `max(1,)`
 * lo sube a 1, o sea cinco hojas de un item. Tres personas se quedan sin hoja
 * y NO HAY FORMA DE EVITARLO: un item no se parte en ocho. No se inventan
 * hojas vacias ni se duplica un item en dos hojas -- eso romperia el conteo
 * ciego y la asistencia deducida. Cinco personas cuentan, tres no.
 *
 * SIN PRESENTES (`presentes === 0`): manda el tamano elegido, sin tocar nada.
 * Cero presentes es "todavia no se tomo asistencia", no "nadie va a contar":
 * dividir por cero, o forzar hojas de 1, seria decidir algo sobre un dato que
 * todavia no existe. Es el mismo criterio de null-no-es-cero que sostiene el
 * resto del dominio.
 */
export function tamanoEfectivoDeHoja(totalItems: number, presentes: number, tamanoElegido: number): number {
  if (!Number.isInteger(tamanoElegido) || tamanoElegido <= 0) {
    throw new Error(`El tamano elegido debe ser un entero > 0 (se recibio ${tamanoElegido}).`);
  }
  // Sin asistencia tomada no hay nada que repartir: manda lo que se eligio.
  if (!Number.isInteger(presentes) || presentes <= 0) return tamanoElegido;
  if (!Number.isInteger(totalItems) || totalItems < 0) {
    throw new Error(`totalItems debe ser un entero >= 0 (se recibio ${totalItems}).`);
  }

  const porCabeza = Math.floor(totalItems / presentes);
  return Math.max(1, Math.min(tamanoElegido, porCabeza));
}

/**
 * Parte `totalItems` en bloques de `tamano`. Cuando la division no es
 * exacta, la ULTIMA hoja queda parcial en vez de forzar un tamaño parejo o
 * descartar el resto: cada item del inventario tiene que caer en alguna
 * hoja.
 *
 * Devuelve el tamaño de cada hoja (no las hojas): el dominio no conoce ids
 * de inventario ni productos.
 */
export function partirEnHojas(totalItems: number, tamano: number): number[] {
  if (!Number.isInteger(totalItems) || totalItems < 0) {
    throw new Error(`totalItems debe ser un entero >= 0 (se recibio ${totalItems}).`);
  }
  if (!Number.isInteger(tamano) || tamano <= 0) {
    throw new Error(`El tamano de hoja debe ser un entero > 0 (se recibio ${tamano}).`);
  }

  const hojas: number[] = [];
  let restante = totalItems;
  while (restante > 0) {
    const bloque = Math.min(tamano, restante);
    hojas.push(bloque);
    restante -= bloque;
  }
  return hojas;
}

export interface AsignacionPersona<THoja, TPersona> {
  persona: TPersona;
  hojas: THoja[];
}

/**
 * Reparte `hojas` entre `personas` en bloques CONTIGUOS: a cada persona le
 * toca un tramo de hojas vecinas, nunca una seleccion salteada. Contar es
 * caminar la gondola, no saltar de punta a punta -- y con las hojas ya
 * ordenadas por categoria (ver `ordenarParaContar`), un tramo contiguo es un
 * sector contiguo de la tienda.
 *
 * Las primeras `total % personas` reciben una hoja de mas, para que ninguna
 * quede sin asignar. Si hay menos hojas que personas, las que sobran quedan
 * con un arreglo vacio: no se parte una hoja a medias entre dos personas
 * (dos personas contando la misma hoja es como se cuenta dos veces lo mismo
 * y no se cuenta nada de lo otro).
 */
export function repartir<THoja, TPersona>(hojas: readonly THoja[], personas: readonly TPersona[]): AsignacionPersona<THoja, TPersona>[] {
  const cantidadPersonas = personas.length;
  if (cantidadPersonas === 0) return [];

  const base = Math.floor(hojas.length / cantidadPersonas);
  const resto = hojas.length % cantidadPersonas;

  const resultado: AsignacionPersona<THoja, TPersona>[] = [];
  let cursor = 0;
  for (let i = 0; i < cantidadPersonas; i++) {
    const tamanoBloque = base + (i < resto ? 1 : 0);
    resultado.push({ persona: personas[i]!, hojas: hojas.slice(cursor, cursor + tamanoBloque) });
    cursor += tamanoBloque;
  }
  return resultado;
}

/**
 * El numero visible de la hoja: "001", "002". Con base 1, no 0 -- el
 * operario dice "estoy en la hoja 1", nunca "en la hoja 0".
 *
 * Tres digitos porque el inventario mas grande medido (11.835 items en
 * hojas de 20) da 592 hojas. Si algun dia pasara de 999, `padStart` no
 * trunca: devuelve "1000" y sigue siendo unico, solo que desalineado.
 */
export function numeroDeHoja(indice: number): string {
  return String(indice + 1).padStart(3, '0');
}

/**
 * La "zona" de una hoja: la categoria que mas items aporta.
 *
 * Una hoja de 50 puede cruzar el limite entre dos categorias (termina
 * GALLETAS, empieza WAFERS). Se rotula con la dominante en vez de inventar
 * una zona compuesta: el rotulo existe para que el operario sepa DONDE
 * pararse, y "GALLETAS" lo lleva al lugar correcto aunque los ultimos cinco
 * renglones sean de la gondola de al lado.
 */
export function zonaDeHoja(items: readonly ItemOrdenable[]): string {
  const cuenta = new Map<string, number>();
  for (const i of items) {
    const cat = i.categoria ?? 'SIN CATEGORIA';
    cuenta.set(cat, (cuenta.get(cat) ?? 0) + 1);
  }
  let mejor = 'SIN CATEGORIA';
  let mejorN = -1;
  for (const [cat, n] of cuenta) {
    if (n > mejorN) {
      mejor = cat;
      mejorN = n;
    }
  }
  return mejor;
}
