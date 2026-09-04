import { describe, expect, it } from 'vitest';
import { cambiarPinSchema } from './sesion.schema';

describe('cambiarPinSchema', () => {
  it('acepta los dos PIN de 6 digitos', () => {
    expect(cambiarPinSchema.safeParse({ pinActual: '000102', pinNuevo: '445566' }).success).toBe(true);
  });

  it('exige 6 digitos exactos en los dos', () => {
    expect(cambiarPinSchema.safeParse({ pinActual: '12345', pinNuevo: '445566' }).success).toBe(false);
    expect(cambiarPinSchema.safeParse({ pinActual: '000102', pinNuevo: 'abcdef' }).success).toBe(false);
  });

  it('RECHAZA un colaboradorId en el body: quien cambia el PIN sale del token', () => {
    // Misma regla que la aprobacion del lacrado -- lo que manda el cliente
    // no define quien es. Falla ruidosamente en vez de ignorarse.
    expect(cambiarPinSchema.safeParse({ colaboradorId: 999, pinActual: '000102', pinNuevo: '445566' }).success).toBe(
      false,
    );
  });

  it('exige el PIN actual: un token robado no alcanza', () => {
    expect(cambiarPinSchema.safeParse({ pinNuevo: '445566' }).success).toBe(false);
  });
});
