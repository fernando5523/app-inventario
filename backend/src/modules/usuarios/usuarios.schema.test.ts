import { describe, expect, it } from 'vitest';
import { actualizarEstadoSchema, crearUsuarioSchema, editarUsuarioSchema, resetearPinSchema } from './usuarios.schema';

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

describe('editarUsuarioSchema', () => {
  it('acepta un objeto vacio (todos los campos opcionales)', () => {
    expect(editarUsuarioSchema.safeParse({}).success).toBe(true);
  });

  it('acepta campos parciales validos', () => {
    expect(editarUsuarioSchema.safeParse({ nombre: 'Juan Modificado' }).success).toBe(true);
    expect(editarUsuarioSchema.safeParse({ dni: '87654321' }).success).toBe(true);
    expect(editarUsuarioSchema.safeParse({ rol: 'coordinador', sucursalId: 2 }).success).toBe(true);
  });

  it('rechaza administrador con sucursalId no nulo', () => {
    expect(editarUsuarioSchema.safeParse({ rol: 'administrador', sucursalId: 2 }).success).toBe(false);
  });

  it('acepta administrador con sucursalId null', () => {
    expect(editarUsuarioSchema.safeParse({ rol: 'administrador', sucursalId: null }).success).toBe(true);
  });

  it('rechaza DNI invalido o nombre vacio', () => {
    expect(editarUsuarioSchema.safeParse({ dni: 'abc' }).success).toBe(false);
    expect(editarUsuarioSchema.safeParse({ nombre: '' }).success).toBe(false);
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

