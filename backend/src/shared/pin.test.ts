import { describe, expect, it } from 'vitest';
import { hashearPin, verificarPin } from './pin';

describe('pin', () => {
  it('nunca guarda el PIN en claro: el hash no es igual al PIN', async () => {
    const hash = await hashearPin('123456');
    expect(hash).not.toBe('123456');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('dos hashes del mismo PIN son distintos (salt de argon2)', async () => {
    const hashA = await hashearPin('123456');
    const hashB = await hashearPin('123456');
    expect(hashA).not.toBe(hashB);
  });

  it('verificarPin acepta el PIN correcto', async () => {
    const hash = await hashearPin('654321');
    await expect(verificarPin(hash, '654321')).resolves.toBe(true);
  });

  it('verificarPin rechaza un PIN incorrecto', async () => {
    const hash = await hashearPin('654321');
    await expect(verificarPin(hash, '000000')).resolves.toBe(false);
  });
});
