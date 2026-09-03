import { describe, expect, it } from 'vitest';
import { actualizarTiendaSchema, crearTiendaSchema } from './tiendas.schema';

describe('crearTiendaSchema', () => {
  it('exige nombre, direccion/telefono son opcionales', () => {
    expect(crearTiendaSchema.safeParse({ nombre: 'Market Test' }).success).toBe(true);
    expect(crearTiendaSchema.safeParse({ nombre: '' }).success).toBe(false);
    expect(crearTiendaSchema.safeParse({}).success).toBe(false);
  });
});

describe('actualizarTiendaSchema', () => {
  it('rechaza un PATCH sin ningun campo', () => {
    expect(actualizarTiendaSchema.safeParse({}).success).toBe(false);
  });

  it('acepta actualizar solo activa', () => {
    expect(actualizarTiendaSchema.safeParse({ activa: false }).success).toBe(true);
  });

  it('acepta poner direccion/telefono en null (borrarlos)', () => {
    expect(actualizarTiendaSchema.safeParse({ direccion: null }).success).toBe(true);
  });
});
