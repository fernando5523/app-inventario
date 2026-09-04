import { describe, expect, it } from 'vitest';
import { listarAuditablesQuerySchema, matrizQuerySchema, parametrosInventarioSchema } from './auditoria.schema';

describe('matrizQuerySchema', () => {
  it('el filtro por defecto es "todos": la pantalla no lo manda en la primera carga', () => {
    expect(matrizQuerySchema.parse({}).filtro).toBe('todos');
  });

  it('acepta los 4 chips que ya valido el cliente', () => {
    for (const filtro of ['todos', 'cuadrados', 'faltante', 'empresa']) {
      expect(matrizQuerySchema.safeParse({ filtro }).success).toBe(true);
    }
  });

  it('rechaza un filtro inventado', () => {
    expect(matrizQuerySchema.safeParse({ filtro: 'sobrantes' }).success).toBe(false);
  });

  it('pagina de a 100 por defecto', () => {
    const r = matrizQuerySchema.parse({});
    expect(r.limite).toBe(100);
    expect(r.desplazamiento).toBe(0);
  });

  it('pone techo en 500: nadie se baja los 8.000 items de una', () => {
    expect(matrizQuerySchema.safeParse({ limite: 8000 }).success).toBe(false);
    expect(matrizQuerySchema.safeParse({ limite: 500 }).success).toBe(true);
  });

  it('coerce los numeros que llegan como string en el query', () => {
    const r = matrizQuerySchema.parse({ limite: '50', desplazamiento: '100' });
    expect(r.limite).toBe(50);
    expect(r.desplazamiento).toBe(100);
  });

  it('rechaza desplazamiento negativo', () => {
    expect(matrizQuerySchema.safeParse({ desplazamiento: -1 }).success).toBe(false);
  });

  it('acepta busqueda y zona, y rechaza una busqueda vacia', () => {
    expect(matrizQuerySchema.safeParse({ busqueda: 'aceite', zona: 'A' }).success).toBe(true);
    expect(matrizQuerySchema.safeParse({ busqueda: '   ' }).success).toBe(false);
  });
});

describe('parametrosInventarioSchema', () => {
  it('coerce el id de la ruta', () => {
    expect(parametrosInventarioSchema.parse({ inventarioId: '7' }).inventarioId).toBe(7);
  });

  it('rechaza ids no positivos o no numericos', () => {
    expect(parametrosInventarioSchema.safeParse({ inventarioId: '0' }).success).toBe(false);
    expect(parametrosInventarioSchema.safeParse({ inventarioId: 'abc' }).success).toBe(false);
  });
});

describe('listarAuditablesQuerySchema', () => {
  it('sucursalId es opcional', () => {
    expect(listarAuditablesQuerySchema.parse({}).sucursalId).toBeUndefined();
    expect(listarAuditablesQuerySchema.parse({ sucursalId: '2' }).sucursalId).toBe(2);
  });
});
