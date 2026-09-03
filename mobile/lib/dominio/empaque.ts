/**
 * Aritmetica y validacion del conteo por empaque.
 *
 * El total NUNCA se guarda (ver tipos.ts): se calcula siempre desde
 * `empaques` y `sueltas`. Este archivo es la unica fuente de esa cuenta.
 */

import type { Conteo, Empaque } from './tipos';

export type TipoAdvertenciaConteo = 'valor-invalido' | 'sueltas-exceden-factor';

export interface AdvertenciaConteo {
  tipo: TipoAdvertenciaConteo;
  mensaje: string;
}

/** empaques * factor + sueltas. Pura: no valida, no corrige, no redondea. */
export function totalUnidades(conteo: Conteo, empaque: Empaque): number {
  return conteo.empaques * empaque.factor + conteo.sueltas;
}

/**
 * Detecta datos sospechosos SIN corregirlos. Corregir en silencio un dato
 * que despues se audita es lo peor que se puede hacer: la interfaz decide
 * que hacer con la advertencia (mostrarla, pedir confirmacion), el dominio
 * solo la detecta.
 */
export function validarConteo(conteo: Conteo, empaque: Empaque): AdvertenciaConteo[] {
  const advertencias: AdvertenciaConteo[] = [];

  if (!esEnteroNoNegativo(conteo.empaques)) {
    advertencias.push({
      tipo: 'valor-invalido',
      mensaje: `Los empaques deben ser un entero mayor o igual a 0 (se recibio ${conteo.empaques}).`,
    });
  }

  if (!esEnteroNoNegativo(conteo.sueltas)) {
    advertencias.push({
      tipo: 'valor-invalido',
      mensaje: `Las sueltas deben ser un entero mayor o igual a 0 (se recibio ${conteo.sueltas}).`,
    });
  }

  // Con factor 1 no existe un empaque "mas grande" en el que estas sueltas
  // deberian entrar: cualquier cantidad es normal y no hay nada que advertir.
  if (empaque.factor > 1 && conteo.sueltas >= empaque.factor) {
    advertencias.push({
      tipo: 'sueltas-exceden-factor',
      mensaje:
        `${conteo.sueltas} sueltas alcanzan para armar otro(a) ${empaque.nombre} ` +
        `de ${empaque.factor}: revisar antes de guardar.`,
    });
  }

  return advertencias;
}

function esEnteroNoNegativo(valor: number): boolean {
  return Number.isInteger(valor) && valor >= 0;
}
