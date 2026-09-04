import { describe, expect, it } from 'vitest';
import { avance, finalizar, puedeEditar, puedeFinalizar } from './hoja';
import type { Conteo, EstadoHoja, HojaConteo, Producto } from './tipos';

function producto(id: number): Producto {
  return {
    id,
    codigo: String(id).padStart(4, '0'),
    codigoBarras: `775000${id}`,
    descripcion: `Producto ${id}`,
    empaques: [{ nombre: 'Caja', factor: 12 }],
  };
}

function conteoDe(productoId: number): Conteo {
  return {
    productoId,
    empaques: [{ empaqueNombre: 'Caja', cantidad: 1 }],
    sueltas: 0,
    confirmadoPorEscaner: false,
    contadoEn: '2026-09-01T10:00:00.000Z',
  };
}

function hoja(parciales: Partial<HojaConteo> = {}): HojaConteo {
  return {
    id: 1,
    inventarioId: 1,
    numero: '002',
    zona: 'Abarrotes',
    gondola: 'A2',
    tamano: 50,
    estado: 'pendiente',
    sync: 'local',
    asignados: [],
    productos: [],
    conteos: [],
    ...parciales,
  };
}

describe('avance', () => {
  it('cuenta productos distintos contados sobre el total', () => {
    const h = hoja({
      productos: [producto(1), producto(2), producto(3), producto(4), producto(5)],
      conteos: [conteoDe(1), conteoDe(2), conteoDe(3)],
    });
    expect(avance(h)).toEqual({ contados: 3, total: 5, porcentaje: 60 });
  });

  it('hoja vacia (sin productos): 0/0, porcentaje 0 y no NaN', () => {
    const h = hoja({ productos: [], conteos: [] });
    expect(avance(h)).toEqual({ contados: 0, total: 0, porcentaje: 0 });
  });

  it('no cuenta dos veces un conteo repetido para el mismo producto (correccion, no duplicado)', () => {
    const h = hoja({
      productos: [producto(1), producto(2)],
      conteos: [conteoDe(1), { ...conteoDe(1), empaques: [{ empaqueNombre: 'Caja', cantidad: 2 }] }],
    });
    expect(avance(h)).toEqual({ contados: 1, total: 2, porcentaje: 50 });
  });

  it('redondea el porcentaje cuando la division no es exacta', () => {
    const h = hoja({
      productos: [producto(1), producto(2), producto(3)],
      conteos: [conteoDe(1)],
    });
    // 1/3 = 33.33...
    expect(avance(h).porcentaje).toBe(33);
  });
});

describe('puedeEditar', () => {
  it.each<[EstadoHoja, boolean]>([
    ['pendiente', true],
    ['en-proceso', true],
    ['finalizada', false],
  ])('estado %s -> puedeEditar %s', (estado, esperado) => {
    expect(puedeEditar(hoja({ estado }))).toBe(esperado);
  });
});

describe('puedeFinalizar', () => {
  it('pendiente sin nada contado: puede finalizar, todo queda como faltante', () => {
    const h = hoja({ estado: 'pendiente', productos: [producto(1), producto(2)], conteos: [] });
    expect(puedeFinalizar(h)).toEqual({ puede: true, faltantes: 2 });
  });

  it('en-proceso con algunos contados: puede finalizar e informa cuantos faltan', () => {
    const h = hoja({
      estado: 'en-proceso',
      productos: [producto(1), producto(2), producto(3)],
      conteos: [conteoDe(1)],
    });
    expect(puedeFinalizar(h)).toEqual({ puede: true, faltantes: 2 });
  });

  it('completa: puede finalizar y no faltan items', () => {
    const h = hoja({
      estado: 'en-proceso',
      productos: [producto(1), producto(2)],
      conteos: [conteoDe(1), conteoDe(2)],
    });
    expect(puedeFinalizar(h)).toEqual({ puede: true, faltantes: 0 });
  });

  it('ya finalizada: no puede finalizar de nuevo (punto de no retorno)', () => {
    const h = hoja({
      estado: 'finalizada',
      productos: [producto(1), producto(2)],
      conteos: [conteoDe(1)],
    });
    expect(puedeFinalizar(h)).toEqual({ puede: false, faltantes: 1 });
  });
});

describe('finalizar', () => {
  it('pendiente -> finalizada, sin mutar la hoja original', () => {
    const original = hoja({ estado: 'pendiente' });
    const resultado = finalizar(original);
    expect(resultado.estado).toBe('finalizada');
    expect(original.estado).toBe('pendiente');
    expect(resultado).not.toBe(original);
  });

  it('en-proceso -> finalizada', () => {
    const resultado = finalizar(hoja({ estado: 'en-proceso' }));
    expect(resultado.estado).toBe('finalizada');
  });

  it('nunca al reves: finalizar una hoja ya finalizada lanza error en vez de "reabrirla"', () => {
    const yaFinalizada = hoja({ estado: 'finalizada' });
    expect(() => finalizar(yaFinalizada)).toThrow();
  });

  it('una vez finalizada, la hoja resultante ya no se puede editar (no hay vuelta atras)', () => {
    const resultado = finalizar(hoja({ estado: 'en-proceso' }));
    expect(puedeEditar(resultado)).toBe(false);
  });

  it('conserva el resto de los datos de la hoja intactos', () => {
    const original = hoja({ estado: 'pendiente', numero: '007', zona: 'Lacteos' });
    const resultado = finalizar(original);
    expect(resultado.numero).toBe('007');
    expect(resultado.zona).toBe('Lacteos');
  });
});
