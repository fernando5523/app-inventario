/**
 * Unico lugar que llama a argon2 directo -- sesion.service.ts y
 * usuarios.service.ts pasan siempre por aca, nunca hashean a mano, para
 * que "el PIN nunca se guarda en claro" sea una garantia de UN archivo en
 * vez de una convencion que cada service tiene que recordar sola.
 */

import argon2 from 'argon2';

export function hashearPin(pin: string): Promise<string> {
  return argon2.hash(pin);
}

export function verificarPin(pinHash: string, pin: string): Promise<boolean> {
  return argon2.verify(pinHash, pin);
}
