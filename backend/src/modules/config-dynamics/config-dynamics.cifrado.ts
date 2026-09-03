/**
 * Cifrado del `client_secret` de Dynamics. PURO -- solo `node:crypto`, sin
 * Prisma ni Express -- para testearlo sin base (mismo criterio que
 * historial.lacrado.ts).
 *
 * POR QUE SE CIFRA, si igual nunca se devuelve por la API.
 *
 * Que la API no lo devuelva resuelve un problema: que el secreto termine en
 * un log de requests, en el cache de un cliente o en la captura de pantalla
 * de alguien. No resuelve el otro: que quede en claro dentro de una columna
 * de Postgres, donde lo lee cualquier `SELECT *`, cualquier backup que se
 * copie a un disco compartido y cualquier dump que alguien mande por mail
 * para "revisar un problema". Un backup de base de datos viaja a muchos mas
 * lugares que una respuesta HTTP.
 *
 * AES-256-GCM y no AES-CBC: GCM trae autenticacion. Un secreto manipulado en
 * la base FALLA al descifrar en vez de devolver bytes cualquiera que despues
 * se mandan a Azure AD como si fueran validos.
 *
 * LO QUE ESTO NO PROTEGE, dicho de frente: la clave sale de una variable de
 * entorno del mismo servidor. Quien tiene acceso al proceso tiene las dos
 * mitades. No es defensa contra un servidor comprometido -- es defensa
 * contra la ruta por la que estas cosas se filtran de verdad, que es un
 * dump de base de datos dando vueltas.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITMO = 'aes-256-gcm';
const LARGO_IV = 12; // 96 bits, el recomendado para GCM
const SAL = 'app-inventario/config-dynamics/v1';

/** Nombre de la variable de entorno con la clave maestra. */
export const VAR_CLAVE = 'APP_CIFRADO_CLAVE';

export class CifradoNoConfigurado extends Error {
  constructor() {
    super(
      `Falta la variable de entorno ${VAR_CLAVE}: no se puede guardar el secreto de Dynamics sin una clave para cifrarlo. ` +
        'Generá una con `openssl rand -hex 32` y agregala a backend/.env.',
    );
    this.name = 'CifradoNoConfigurado';
  }
}

/** true si el entorno tiene con qué cifrar. */
export function cifradoDisponible(clave: string | undefined = process.env[VAR_CLAVE]): boolean {
  return typeof clave === 'string' && clave.length >= 16;
}

/**
 * Deriva la clave de 32 bytes con scrypt. No se usa la variable de entorno
 * como clave directa: casi nunca mide exactamente 32 bytes, y recortarla o
 * rellenarla a mano es como se arruinan estas cosas.
 */
function derivarClave(claveMaestra: string): Buffer {
  return scryptSync(claveMaestra, SAL, 32);
}

/**
 * Devuelve `iv:tag:textoCifrado`, todo en hexadecimal. El IV es aleatorio
 * por cada cifrado: guardar dos veces el mismo secreto tiene que dar dos
 * cadenas distintas, si no la base filtra que el secreto no cambio.
 */
export function cifrar(textoPlano: string, claveMaestra: string | undefined = process.env[VAR_CLAVE]): string {
  if (!cifradoDisponible(claveMaestra)) throw new CifradoNoConfigurado();

  const iv = randomBytes(LARGO_IV);
  const cipher = createCipheriv(ALGORITMO, derivarClave(claveMaestra as string), iv);
  const cifrado = Buffer.concat([cipher.update(textoPlano, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${cifrado.toString('hex')}`;
}

/**
 * Descifra lo que produjo `cifrar`. Lanza si la clave es otra, si el
 * contenido fue manipulado (el tag de GCM no valida) o si el formato no es
 * el esperado -- las tres cosas significan lo mismo para quien llama: ese
 * secreto no se puede usar, y es mejor fallar que mandarle basura a Azure.
 */
export function descifrar(guardado: string, claveMaestra: string | undefined = process.env[VAR_CLAVE]): string {
  if (!cifradoDisponible(claveMaestra)) throw new CifradoNoConfigurado();

  const partes = guardado.split(':');
  if (partes.length !== 3) {
    throw new Error('El secreto guardado no tiene el formato iv:tag:cifrado.');
  }
  const [ivHex, tagHex, datosHex] = partes as [string, string, string];

  const decipher = createDecipheriv(ALGORITMO, derivarClave(claveMaestra as string), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(datosHex, 'hex')), decipher.final()]).toString('utf8');
}

/**
 * Enmascara un secreto para poder mencionarlo en un log o en la auditoria
 * sin exponerlo: "abcd…wxyz" con el largo, nunca el valor.
 *
 * Se muestran 2 caracteres de cada punta y NO 4: con 4 de cada lado, un
 * secreto corto queda casi entero a la vista. Sirve para confirmar "cargué
 * el que empieza con ab", que es lo unico para lo que hace falta.
 */
export function enmascarar(secreto: string): string {
  if (secreto.length <= 6) return `${'*'.repeat(secreto.length)} (${secreto.length} caracteres)`;
  return `${secreto.slice(0, 2)}${'*'.repeat(6)}${secreto.slice(-2)} (${secreto.length} caracteres)`;
}
