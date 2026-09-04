/**
 * Aritmetica y validacion del conteo por empaque.
 *
 * El total NUNCA se guarda (ver tipos.ts): se calcula siempre desde
 * `empaques` (una linea por cada empaque cerrado que se cargo) y
 * `sueltas`. Este archivo es la unica fuente de esa cuenta.
 */

import type { Conteo, Empaque } from './tipos';

export type TipoAdvertenciaConteo = 'valor-invalido' | 'sueltas-exceden-factor';

export interface AdvertenciaConteo {
  tipo: TipoAdvertenciaConteo;
  mensaje: string;
}

/**
 * Suma cada linea (cantidad * factor del empaque que le corresponde) mas
 * las sueltas. Pura: no valida, no corrige, no redondea — PERO revienta
 * si una linea referencia un empaque que no esta en `empaquesDisponibles`:
 * es el corazon del inventario, y subcontar en silencio por una linea
 * huerfana es peor que un error ruidoso. `validarConteo` es la funcion
 * que detecta ese caso ANTES de llegar aca sin cortar la ejecucion.
 */
export function totalUnidades(conteo: Conteo, empaquesDisponibles: Empaque[]): number {
  const factorPorNombre = new Map(empaquesDisponibles.map((e) => [e.nombre, e.factor] as const));
  const totalEmpaques = conteo.empaques.reduce((acumulado, linea) => {
    const factor = factorPorNombre.get(linea.empaqueNombre);
    if (factor === undefined) {
      throw new Error(`El producto no tiene un empaque llamado "${linea.empaqueNombre}".`);
    }
    return acumulado + linea.cantidad * factor;
  }, 0);
  return totalEmpaques + conteo.sueltas;
}

/**
 * Detecta datos sospechosos SIN corregirlos. Corregir en silencio un dato
 * que despues se audita es lo peor que se puede hacer: la interfaz decide
 * que hacer con la advertencia (mostrarla, pedir confirmacion), el dominio
 * solo la detecta. A diferencia de `totalUnidades`, nunca revienta: es la
 * funcion que se llama tambien con datos a medio cargar mientras la
 * persona todavia esta tipeando en el modal.
 */
export function validarConteo(conteo: Conteo, empaquesDisponibles: Empaque[]): AdvertenciaConteo[] {
  const advertencias: AdvertenciaConteo[] = [];
  const nombresValidos = new Set(empaquesDisponibles.map((e) => e.nombre));

  for (const linea of conteo.empaques) {
    if (!nombresValidos.has(linea.empaqueNombre)) {
      advertencias.push({
        tipo: 'valor-invalido',
        mensaje: `"${linea.empaqueNombre}" no es un empaque de este producto.`,
      });
      continue;
    }
    if (!esEnteroNoNegativo(linea.cantidad)) {
      advertencias.push({
        tipo: 'valor-invalido',
        mensaje: `La cantidad de ${linea.empaqueNombre} debe ser un entero mayor o igual a 0 (se recibio ${linea.cantidad}).`,
      });
    }
  }

  if (!esEnteroNoNegativo(conteo.sueltas)) {
    advertencias.push({
      tipo: 'valor-invalido',
      mensaje: `Las sueltas deben ser un entero mayor o igual a 0 (se recibio ${conteo.sueltas}).`,
    });
  }

  // Con varios empaques, "las sueltas alcanzan para armar otro" se
  // compara contra el MENOR factor disponible: 8 sueltas cuando existe
  // un Pack de 6 significa que el operario no armo el pack mas chico
  // posible, aunque el producto tambien venga en Caja de 12 (con Caja
  // sola, 8 sueltas no alcanzarian para nada).
  const factoresEmpacables = empaquesDisponibles.map((e) => e.factor).filter((f) => f > 1);
  if (factoresEmpacables.length > 0) {
    const factorMinimo = Math.min(...factoresEmpacables);
    if (conteo.sueltas >= factorMinimo) {
      const empaqueDelMinimo = empaquesDisponibles.find((e) => e.factor === factorMinimo)!;
      advertencias.push({
        tipo: 'sueltas-exceden-factor',
        mensaje:
          `${conteo.sueltas} sueltas alcanzan para armar otro(a) ${empaqueDelMinimo.nombre} ` +
          `de ${empaqueDelMinimo.factor}: revisar antes de guardar.`,
      });
    }
  }

  return advertencias;
}

function esEnteroNoNegativo(valor: number): boolean {
  return Number.isInteger(valor) && valor >= 0;
}
