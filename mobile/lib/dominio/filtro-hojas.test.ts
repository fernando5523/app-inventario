import { describe, expect, it } from 'vitest';
import { conteoPorFiltro, cumpleFiltro, filtrarHojas, textoMostrando, type FiltroHojas } from './filtro-hojas';
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
    contadoEn: '2026-09-05T10:00:00.000Z',
  };
}

/** `productos` cuántos tiene, `contados` cuántos de esos tienen conteo. */
function hoja(estado: EstadoHoja, productos: number, contados: number, id = 1): HojaConteo {
  return {
    id,
    inventarioId: 1,
    numero: String(id).padStart(3, '0'),
    zona: 'Abarrotes',
    gondola: 'A2',
    tamano: 50,
    estado,
    sync: 'local',
    asignados: [],
    productos: Array.from({ length: productos }, (_, i) => producto(i + 1)),
    conteos: Array.from({ length: contados }, (_, i) => conteoDe(i + 1)),
  };
}

// Formateador determinista: `toLocaleString('es-PE')` depende del ICU del
// runtime (en Node sin ICU completo da "8,000" en vez de "8.000") y el test
// no puede depender de con qué build de Node se corre.
const miles = (n: number): string => String(n);

describe('cumpleFiltro: todas', () => {
  it.each<EstadoHoja>(['pendiente', 'en-proceso', 'finalizada'])('deja pasar una hoja %s', (estado) => {
    expect(cumpleFiltro(hoja(estado, 5, 0), 'todas')).toBe(true);
  });
});

describe('cumpleFiltro: sin-finalizar', () => {
  it('pasa pendiente y en-proceso', () => {
    expect(cumpleFiltro(hoja('pendiente', 5, 0), 'sin-finalizar')).toBe(true);
    expect(cumpleFiltro(hoja('en-proceso', 5, 3), 'sin-finalizar')).toBe(true);
  });

  it('no pasa una finalizada, aunque le falten productos por contar', () => {
    expect(cumpleFiltro(hoja('finalizada', 5, 2), 'sin-finalizar')).toBe(false);
  });
});

describe('cumpleFiltro: finalizadas', () => {
  it('solo pasa la finalizada', () => {
    expect(cumpleFiltro(hoja('finalizada', 5, 5), 'finalizadas')).toBe(true);
    expect(cumpleFiltro(hoja('en-proceso', 5, 5), 'finalizadas')).toBe(false);
  });

  it('una finalizada con productos sin conteo sigue estando acá (es donde se la mira)', () => {
    expect(cumpleFiltro(hoja('finalizada', 5, 1), 'finalizadas')).toBe(true);
  });
});

describe('cumpleFiltro: sin-conteo (el que usa el Coordinador para ir a buscar lo que falta)', () => {
  it('pasa una hoja en proceso con productos sin contar', () => {
    expect(cumpleFiltro(hoja('en-proceso', 5, 2), 'sin-conteo')).toBe(true);
  });

  it('pasa una pendiente sin nada contado', () => {
    expect(cumpleFiltro(hoja('pendiente', 5, 0), 'sin-conteo')).toBe(true);
  });

  it('no pasa una hoja abierta con todo contado', () => {
    expect(cumpleFiltro(hoja('en-proceso', 5, 5), 'sin-conteo')).toBe(false);
  });

  it('NO pasa una finalizada con productos sin conteo: finalizar registra 0 a propósito', () => {
    // Es la regla que decide todo el filtro. `finalizar` graba 0 en los
    // productos que quedaron sin contar, así que en una hoja cerrada "sin
    // conteo" significa "se contó como cero", no "falta contar esto".
    // Mezclarlas devolvería hojas donde ya no hay nada que hacer.
    expect(cumpleFiltro(hoja('finalizada', 5, 2), 'sin-conteo')).toBe(false);
  });

  it('una hoja vacía (sin productos) no cuenta como "con productos sin conteo"', () => {
    expect(cumpleFiltro(hoja('pendiente', 0, 0), 'sin-conteo')).toBe(false);
  });
});

describe('filtrarHojas', () => {
  const hojas = [
    hoja('pendiente', 5, 0, 1), // sin finalizar, le faltan 5
    hoja('en-proceso', 5, 5, 2), // sin finalizar, no le falta ninguno
    hoja('finalizada', 5, 3, 3), // cerrada, con 2 en cero
    hoja('finalizada', 5, 5, 4), // cerrada y completa
  ];

  it.each<[FiltroHojas, number[]]>([
    ['todas', [1, 2, 3, 4]],
    ['sin-finalizar', [1, 2]],
    ['sin-conteo', [1]],
    ['finalizadas', [3, 4]],
  ])('filtro %s -> hojas %j', (filtro, esperadas) => {
    expect(filtrarHojas(hojas, filtro).map((h) => h.id)).toEqual(esperadas);
  });

  it('conserva el orden original de la lista', () => {
    const desordenadas = [hoja('pendiente', 3, 0, 9), hoja('pendiente', 3, 0, 4), hoja('pendiente', 3, 0, 7)];
    expect(filtrarHojas(desordenadas, 'sin-finalizar').map((h) => h.id)).toEqual([9, 4, 7]);
  });

  it('sin hojas devuelve lista vacía, no rompe', () => {
    expect(filtrarHojas([], 'sin-conteo')).toEqual([]);
  });
});

describe('conteoPorFiltro', () => {
  it('cuenta cada chip sobre TODAS las hojas', () => {
    const hojas = [
      hoja('pendiente', 5, 0, 1),
      hoja('en-proceso', 5, 5, 2),
      hoja('finalizada', 5, 3, 3),
      hoja('finalizada', 5, 5, 4),
    ];
    expect(conteoPorFiltro(hojas)).toEqual({
      todas: 4,
      'sin-finalizar': 2,
      'sin-conteo': 1,
      finalizadas: 2,
    });
  });

  it('`todas` es siempre el total: los otros chips son subconjuntos suyos', () => {
    const hojas = [hoja('en-proceso', 4, 1, 1), hoja('finalizada', 4, 4, 2), hoja('pendiente', 4, 0, 3)];
    const c = conteoPorFiltro(hojas);
    expect(c.todas).toBe(hojas.length);
    expect(c['sin-finalizar'] + c.finalizadas).toBe(c.todas);
    expect(c['sin-conteo']).toBeLessThanOrEqual(c['sin-finalizar']);
  });

  it('sin hojas: todo en cero', () => {
    expect(conteoPorFiltro([])).toEqual({ todas: 0, 'sin-finalizar': 0, 'sin-conteo': 0, finalizadas: 0 });
  });
});

describe('textoMostrando', () => {
  it('con un subconjunto dice "X de Y"', () => {
    expect(textoMostrando(7, 25, miles)).toBe('Mostrando 7 de 25 hojas');
  });

  it('cuando se ven todas NO dice "25 de 25": eso invita a buscar qué se oculta', () => {
    expect(textoMostrando(25, 25, miles)).toBe('Mostrando 25 hojas');
  });

  it('singular cuando hay una sola hoja', () => {
    expect(textoMostrando(1, 1, miles)).toBe('Mostrando 1 hoja');
  });

  it('cero visibles sobre un total: sigue diciendo de cuántas', () => {
    expect(textoMostrando(0, 25, miles)).toBe('Mostrando 0 de 25 hojas');
  });

  it('sin hojas: "Mostrando 0 hojas", en plural', () => {
    expect(textoMostrando(0, 0, miles)).toBe('Mostrando 0 hojas');
  });

  it('usa el formateador que le pasan, no uno propio', () => {
    expect(textoMostrando(1200, 3703, (n) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'))).toBe(
      'Mostrando 1.200 de 3.703 hojas',
    );
  });
});
