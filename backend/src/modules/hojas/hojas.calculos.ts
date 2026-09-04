/**
 * Calculos del conteo. PUROS -- sin Prisma, sin Express -- para testearlos
 * sin base (mismo criterio que hojas.permisos.ts y config.validadores.ts).
 */

import { SolicitudInvalida } from '../../shared/errores';

/** Una linea del conteo o del catalogo -- misma forma de los dos lados. */
interface LineaEmpaque {
  empaqueNombre: string;
  cantidad: number;
}

interface EmpaqueDisponible {
  nombre: string;
  factor: number;
}

/**
 * EL TOTAL SE CALCULA, NUNCA SE GUARDA.
 *
 * `prisma/schema.prisma#Conteo` no tiene columna `total` a proposito, y este
 * es el unico lugar donde se deriva. Guardar un total junto a sus partes es
 * garantizar que algun dia no coincidan -- y ese numero es exactamente el que
 * se audita contra Dynamics a fin de mes. Cuando no coincidan, nadie va a
 * saber cual de los dos era el bueno.
 *
 * Espeja mobile/lib/dominio/empaque.ts#totalUnidades: la misma cuenta de los
 * dos lados del puente, para que el telefono y el servidor nunca discutan
 * -- incluida la regla de tirar si una linea referencia un empaque que el
 * producto no tiene: es el corazon del inventario, no puede fallar en
 * silencio.
 */
export function totalUnidades(conteo: { empaques: LineaEmpaque[]; sueltas: number }, empaquesDisponibles: EmpaqueDisponible[]): number {
  const factorPorNombre = new Map(empaquesDisponibles.map((e) => [e.nombre, e.factor] as const));
  const totalEmpaques = conteo.empaques.reduce((acumulado, linea) => {
    const factor = factorPorNombre.get(linea.empaqueNombre);
    if (factor === undefined) {
      throw new SolicitudInvalida(`El producto no tiene un empaque llamado "${linea.empaqueNombre}".`);
    }
    return acumulado + linea.cantidad * factor;
  }, 0);
  return totalEmpaques + conteo.sueltas;
}

/**
 * El primer conteo saca la hoja de `pendiente`. Pasar a `finalizada` es una
 * decision aparte y explicita (POST /finalizar), NUNCA automatica: que se
 * hayan contado los 50 items no significa que el operario haya terminado de
 * revisar, y finalizar es un punto de no retorno.
 *
 * Espeja hojas-memoria.ts / hojas-sqlite.ts del front.
 */
export function estadoTrasContar(estadoActual: 'pendiente' | 'en_proceso' | 'finalizada'): 'pendiente' | 'en_proceso' | 'finalizada' {
  return estadoActual === 'pendiente' ? 'en_proceso' : estadoActual;
}

/**
 * Un empaque nunca trae menos de 1 unidad. Un factor 0 o negativo haria que
 * `totalUnidades` diera 0 o un numero negativo para un conteo real, y ese
 * numero termina en la liquidacion de alguien. Valida TODOS los empaques
 * del producto (no solo los que vinieron en el conteo): un factor corrupto
 * en un empaque que hoy no se uso puede usarse en la proxima correccion.
 */
export function validarFactores(empaquesDelProducto: EmpaqueDisponible[]): void {
  for (const empaque of empaquesDelProducto) {
    if (!Number.isInteger(empaque.factor) || empaque.factor < 1) {
      throw new SolicitudInvalida(`El empaque "${empaque.nombre}" tiene un factor invalido: no se puede calcular el total.`);
    }
  }
}

/** El enum de Prisma usa `en_proceso`; el dominio del front, `en-proceso`. */
export function estadoParaElFront(estado: 'pendiente' | 'en_proceso' | 'finalizada'): 'pendiente' | 'en-proceso' | 'finalizada' {
  return estado === 'en_proceso' ? 'en-proceso' : estado;
}
