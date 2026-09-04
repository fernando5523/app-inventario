/**
 * Calculos del conteo. PUROS -- sin Prisma, sin Express -- para testearlos
 * sin base (mismo criterio que hojas.permisos.ts y config.validadores.ts).
 */

import { SolicitudInvalida } from '../../shared/errores';

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
 * dos lados del puente, para que el telefono y el servidor nunca discutan.
 */
export function totalUnidades(conteo: { empaques: number; sueltas: number }, empaqueFactor: number): number {
  return conteo.empaques * empaqueFactor + conteo.sueltas;
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
 * numero termina en la liquidacion de alguien.
 */
export function validarFactor(empaqueFactor: number): void {
  if (!Number.isInteger(empaqueFactor) || empaqueFactor < 1) {
    throw new SolicitudInvalida('El empaque del producto tiene un factor invalido: no se puede calcular el total.');
  }
}

/** El enum de Prisma usa `en_proceso`; el dominio del front, `en-proceso`. */
export function estadoParaElFront(estado: 'pendiente' | 'en_proceso' | 'finalizada'): 'pendiente' | 'en-proceso' | 'finalizada' {
  return estado === 'en_proceso' ? 'en-proceso' : estado;
}
