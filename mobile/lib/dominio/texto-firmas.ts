/**
 * El texto de firmas de la tarjeta del Historial, con el mínimo de firmas
 * CONFIGURABLE (backend, 5c2c23c -- hoy 1), NUNCA un 2 hardcodeado. Si el
 * parámetro dice 1, la tarjeta dice 1. Pluraliza "firma"/"firmas" y
 * "auditor"/"auditores" según el requerido.
 */

import { pluralizar } from './plural';

/** "0 / 1 firma" · "1 / 2 firmas" — inventario sin lacrar todavía. */
export function textoFirmas(hechas: number, requeridas: number): string {
  return `${hechas} / ${requeridas} firma${requeridas === 1 ? '' : 's'}`;
}

/** "Firmado por 1 auditor" · "Firmado por 2 auditores" — ya lacrado. */
export function textoFirmadoPor(requeridas: number): string {
  return `Firmado por ${requeridas} auditor${requeridas === 1 ? '' : 'es'}`;
}

/**
 * Qué falta para poder lacrar, en el detalle del Historial de un inventario
 * que ya no se recuenta y todavía no está sellado.
 *
 * Con el mínimo de hoy (1 firma) el texto de la pantalla decía "faltan 1 de
 * las 1 firma de auditoría" — número y verbo peleados con el sustantivo. Todo
 * sale del mínimo CONFIGURABLE, nunca de un 2 escrito a mano.
 *
 * `faltan === 0` es un estado real (ya firmaron todos, falta ejecutar el
 * lacrado) y no se puede seguir diciendo que faltan firmas: eso decía antes
 * "faltan 0 de las 2 firmas".
 */
export function textoFirmasPendientes(hechas: number, requeridas: number): string {
  const faltan = Math.max(requeridas - hechas, 0);
  if (faltan === 0) {
    return pluralizar(
      requeridas,
      'la firma ya está registrada y solo falta ejecutar el lacrado',
      `las ${requeridas} firmas ya están registradas y solo falta ejecutar el lacrado`,
    );
  }
  return pluralizar(
    requeridas,
    'falta la firma de auditoría',
    `${pluralizar(faltan, 'falta', 'faltan')} ${faltan} de las ${requeridas} firmas de auditoría`,
  );
}

/**
 * El aviso cuando NO hay suficientes cuentas de Auditor para el lacrado.
 *
 * `hay` cuenta los auditores DEL SISTEMA, no los de una tienda: el auditor ya
 * no pertenece a ninguna sucursal (audita toda la cadena), así que contar "los
 * de esta sucursal" da 0 y le pediría al usuario dar de alta cuentas que no
 * necesita -- de la familia "datos que mienten".
 *
 * El texto sigue el mínimo configurable: con `requeridas === 1` NO menciona
 * "personas distintas / no toques repetidos" -- eso es lenguaje de la DOBLE
 * firma y no tiene sentido cuando alcanza con una.
 */
export function textoAuditoresInsuficientes(hay: number, requeridas: number): string {
  const tiene = hay === 1 ? 'una sola cuenta de Auditor cargada' : `solo ${hay} cuentas de Auditor cargadas`;
  const faltan = requeridas - hay;
  const altas = faltan === 1 ? 'una cuenta más' : `${faltan} cuentas más`;
  const distintas = requeridas === 1 ? '' : ' — tienen que ser personas distintas, no toques repetidos';
  return `El sistema tiene ${tiene}, y el lacrado exige ${requeridas}. Hace falta dar de alta ${altas} de Auditor (en Usuarios)${distintas}.`;
}
