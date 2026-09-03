/**
 * Particion de un lote de inventario en hojas, y reparto de esas hojas
 * entre las personas presentes.
 */

import type { TamanoHoja } from './tipos';

/**
 * Parte `totalItems` en bloques de `tamano`. Cuando la division no es
 * exacta, la ULTIMA hoja queda parcial en vez de forzar un tamano parejo
 * o descartar el resto: cada item del inventario tiene que caer en
 * alguna hoja.
 *
 * Devuelve el tamano de cada hoja resultante (no objetos HojaConteo: el
 * dominio puro no conoce ids de inventario ni productos, eso lo arma
 * quien llame con el snapshot real).
 */
export function partirEnHojas(totalItems: number, tamano: TamanoHoja): number[] {
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
 * Reparte `hojas` entre `personas` en bloques CONTIGUOS: a cada persona
 * le toca un tramo de hojas vecinas, nunca una seleccion salteada.
 * Contar es caminar la gondola, no saltar de punta a punta.
 *
 * El primer `total % personas.length` reciben un bloque con un item de
 * mas, para que ninguna hoja quede sin asignar. Si hay menos hojas que
 * personas, las que sobran quedan con un arreglo vacio: no se reparte
 * una hoja "a medias" entre dos personas.
 */
export function repartir<THoja, TPersona>(
  hojas: THoja[],
  personas: TPersona[],
): AsignacionPersona<THoja, TPersona>[] {
  const cantidadPersonas = personas.length;
  if (cantidadPersonas === 0) return [];

  const base = Math.floor(hojas.length / cantidadPersonas);
  const resto = hojas.length % cantidadPersonas;

  const resultado: AsignacionPersona<THoja, TPersona>[] = [];
  let cursor = 0;
  for (let i = 0; i < cantidadPersonas; i++) {
    const tamanoBloque = base + (i < resto ? 1 : 0);
    resultado.push({
      persona: personas[i],
      hojas: hojas.slice(cursor, cursor + tamanoBloque),
    });
    cursor += tamanoBloque;
  }
  return resultado;
}
