import { describe, expect, it } from 'vitest';
import { actualizarEstadoSchema, crearUsuarioSchema, resetearPinSchema } from './usuarios.schema';

const base = { nombre: 'Ana Test', dni: '12345678', pin: '123456' };

describe('crearUsuarioSchema', () => {
  it('acepta un administrador SIN sucursalId', () => {
    const resultado = crearUsuarioSchema.safeParse({ ...base, rol: 'administrador' });
    expect(resultado.success).toBe(true);
  });

  it('rechaza un administrador CON sucursalId (nadie le inventa una tienda)', () => {
    const resultado = crearUsuarioSchema.safeParse({ ...base, rol: 'administrador', sucursalId: 1 });
    expect(resultado.success).toBe(false);
  });

  it('rechaza coordinador SIN sucursalId', () => {
    const resultado = crearUsuarioSchema.safeParse({ ...base, rol: 'coordinador' });
    expect(resultado.success).toBe(false);
  });

  it('rechaza conteo SIN sucursalId', () => {
    const resultado = crearUsuarioSchema.safeParse({ ...base, rol: 'conteo' });
    expect(resultado.success).toBe(false);
  });

  it('rechaza auditor SIN sucursalId', () => {
    const resultado = crearUsuarioSchema.safeParse({ ...base, rol: 'auditor' });
    expect(resultado.success).toBe(false);
  });

  it('acepta coordinador CON sucursalId', () => {
    const resultado = crearUsuarioSchema.safeParse({ ...base, rol: 'coordinador', sucursalId: 1 });
    expect(resultado.success).toBe(true);
  });

  it('rechaza un rol que no existe (el rol nunca lo elige libremente el cliente)', () => {
    const resultado = crearUsuarioSchema.safeParse({ ...base, rol: 'superadmin', sucursalId: 1 });
    expect(resultado.success).toBe(false);
  });

  it('rechaza un PIN que no sean 6 digitos', () => {
    const resultado = crearUsuarioSchema.safeParse({ ...base, rol: 'coordinador', sucursalId: 1, pin: '123' });
    expect(resultado.success).toBe(false);
  });

  it('rechaza un PIN con letras', () => {
    const resultado = crearUsuarioSchema.safeParse({ ...base, rol: 'coordinador', sucursalId: 1, pin: 'abcdef' });
    expect(resultado.success).toBe(false);
  });

  it('rechaza un DNI de menos de 4 digitos', () => {
    const resultado = crearUsuarioSchema.safeParse({ ...base, dni: '12', rol: 'coordinador', sucursalId: 1 });
    expect(resultado.success).toBe(false);
  });

  it('acepta un DNI de 4 digitos (placeholders del seed actual, ver prisma/seed.ts)', () => {
    const resultado = crearUsuarioSchema.safeParse({ ...base, dni: '1256', rol: 'coordinador', sucursalId: 1 });
    expect(resultado.success).toBe(true);
  });

  it('rechaza nombre vacio', () => {
    const resultado = crearUsuarioSchema.safeParse({ ...base, nombre: '  ', rol: 'coordinador', sucursalId: 1 });
    expect(resultado.success).toBe(false);
  });
});

describe('actualizarEstadoSchema', () => {
  it('exige que activo sea booleano', () => {
    expect(actualizarEstadoSchema.safeParse({ activo: true }).success).toBe(true);
    expect(actualizarEstadoSchema.safeParse({ activo: 'true' }).success).toBe(false);
    expect(actualizarEstadoSchema.safeParse({}).success).toBe(false);
  });
});

describe('resetearPinSchema', () => {
  it('exige un PIN de 6 digitos', () => {
    expect(resetearPinSchema.safeParse({ pin: '000000' }).success).toBe(true);
    expect(resetearPinSchema.safeParse({ pin: '00000' }).success).toBe(false);
  });
});
