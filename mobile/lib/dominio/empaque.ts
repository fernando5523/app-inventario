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

/** Una línea del desglose: el empaque, cuántos, su factor y el subtotal en unidades. */
export interface LineaDesglose {
  /** El nombre TAL CUAL viene del sistema (Empaque.nombre) — no se pluraliza ni reformatea. */
  nombre: string;
  cantidad: number;
  factor: number;
  /** cantidad × factor. */
  subtotal: number;
}

export interface DesgloseConteo {
  /** Una por cada línea del conteo (incluye las de cantidad 0; filtrarlas es cosa de la UI). */
  lineas: LineaDesglose[];
  sueltas: number;
  /** Sum(subtotales) + sueltas — EXACTAMENTE el número que se guarda. */
  total: number;
}

/**
 * La conversión completa de un conteo: cada empaque × su factor = subtotal, más
 * las sueltas, y el total. Es la ÚNICA cuenta -- `totalUnidades` sale de acá
 * (`.total`), así que lo que la pantalla MUESTRA (el desglose) y lo que se
 * GUARDA no pueden diferir: son el mismo cálculo. Revienta si una línea
 * referencia un empaque que el producto no tiene (subcontar en silencio por
 * una línea huérfana es peor que un error ruidoso; `validarConteo` lo detecta
 * antes, sin cortar la ejecución).
 */
export function desgloseConteo(conteo: Conteo, empaquesDisponibles: Empaque[]): DesgloseConteo {
  const factorPorNombre = new Map(empaquesDisponibles.map((e) => [e.nombre, e.factor] as const));
  const lineas: LineaDesglose[] = conteo.empaques.map((linea) => {
    const factor = factorPorNombre.get(linea.empaqueNombre);
    if (factor === undefined) {
      throw new Error(`El producto no tiene un empaque llamado "${linea.empaqueNombre}".`);
    }
    return { nombre: linea.empaqueNombre, cantidad: linea.cantidad, factor, subtotal: linea.cantidad * factor };
  });
  const totalEmpaques = lineas.reduce((acumulado, l) => acumulado + l.subtotal, 0);
  return { lineas, sueltas: conteo.sueltas, total: totalEmpaques + conteo.sueltas };
}

/**
 * Suma cada línea (cantidad × factor) más las sueltas. DELEGA en
 * `desgloseConteo` -- no repite la cuenta -- para que el total que se guarda
 * sea idéntico al que la pantalla muestra. Revienta ante una línea huérfana,
 * igual que `desgloseConteo`.
 */
export function totalUnidades(conteo: Conteo, empaquesDisponibles: Empaque[]): number {
  return desgloseConteo(conteo, empaquesDisponibles).total;
}

/**
 * Las líneas del total, listas para mostrar en el modal: una por empaque con
 * CANTIDAD > 0 ("2 Emp.45 × 45 = 90 und") y, si hay, las sueltas. El nombre del
 * empaque va TAL CUAL vino del sistema -- no se pluraliza ("Emp.45", nunca
 * "Emp.45s"). "suelta/sueltas" sí flexiona: es una palabra nuestra, no un valor
 * del ERP. El TOTAL se muestra aparte (es `desglose.total`).
 */
export function lineasDeTotal(desglose: DesgloseConteo): string[] {
  const lineas = desglose.lineas
    .filter((l) => l.cantidad > 0)
    .map((l) => `${l.cantidad} ${l.nombre} × ${l.factor} = ${l.subtotal} und`);
  if (desglose.sueltas > 0) {
    lineas.push(`${desglose.sueltas} ${desglose.sueltas === 1 ? 'suelta' : 'sueltas'}`);
  }
  return lineas;
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
