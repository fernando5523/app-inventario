import { describe, expect, it } from 'vitest';
import {
  conteoQueManda,
  cuadro,
  destinoTrasRonda,
  itemsParaLaRondaSiguiente,
  puedeAbrirRondaSiguiente,
  resumirRonda,
  RONDAS_DEL_CICLO,
  type ItemDeRonda,
} from './ciclo-conteos';

const item = (parcial: Partial<ItemDeRonda> = {}): ItemDeRonda => ({
  codigo: 'IT-0001',
  stockErp: 100,
  conteos: [100],
  ...parcial,
});

// ===========================================================================
// LA REGLA DEL CLIENTE: EL ÚLTIMO CONTEO MANDA
// ===========================================================================

describe('conteoQueManda — el ÚLTIMO conteo manda', () => {
  it('EL EJEMPLO DEL CLIENTE: 18 → 12 → 17 vale 17', () => {
    // Ni consenso, ni el más parecido al ERP: el último y punto.
    expect(conteoQueManda([18, 12, 17])).toBe(17);
  });

  it('las 3 iguales: vale ese número (no hay nada que decidir)', () => {
    expect(conteoQueManda([40, 40, 40])).toBe(40);
  });

  it('las 3 DISTINTAS: vale la tercera, aunque las dos primeras se parezcan entre sí', () => {
    // 18 y 19 casi coinciden y 3 es la rara -- da igual, manda la última.
    // Es exactamente el tradeoff que el cliente aceptó.
    expect(conteoQueManda([18, 19, 3])).toBe(3);
  });

  it('contado en la ronda 1 y NO en la 2: manda el de la ronda 1', () => {
    // Es el último que EXISTE para ese ítem. No es "sin contar": hay un
    // conteo, es viejo pero existe.
    expect(conteoQueManda([25, null])).toBe(25);
  });

  it('contado en la 1, salteado en la 2, contado en la 3: manda el de la 3', () => {
    expect(conteoQueManda([25, null, 30])).toBe(30);
  });

  it('contado solo en la ronda 2 (no entró a la 1): manda ese', () => {
    expect(conteoQueManda([null, 14])).toBe(14);
  });

  it('NINGUNA ronda lo contó: null, y eso NO es cero', () => {
    expect(conteoQueManda([null, null, null])).toBeNull();
    expect(conteoQueManda([])).toBeNull();
  });

  it('un conteo de CERO es un dato real y manda como cualquier otro', () => {
    // "No hay ninguno en góndola" es una afirmación, no una ausencia. Si se
    // comparara por falsy en vez de contra null, este 0 se saltearía y
    // mandaría el 30 anterior -- que es justo el faltante que se quiere ver.
    expect(conteoQueManda([30, 0])).toBe(0);
    expect(conteoQueManda([0])).toBe(0);
  });

  it('un cero en el medio no tapa al conteo posterior', () => {
    expect(conteoQueManda([30, 0, 28])).toBe(28);
  });
});

describe('cuadro — el conteo que manda contra el ERP', () => {
  it('cuadra cuando el ÚLTIMO conteo coincide con el ERP, aunque los previos no', () => {
    // 18 y 12 estaban mal; el 3ro da 100 y coincide. Cuadra.
    expect(cuadro(item({ stockErp: 100, conteos: [18, 12, 100] }))).toBe(true);
  });

  it('NO cuadra si el último difiere, aunque los dos anteriores coincidieran con el ERP', () => {
    // El caso que duele: dos pasadas daban 100 y la tercera 97. Vale 97.
    expect(cuadro(item({ stockErp: 100, conteos: [100, 100, 97] }))).toBe(false);
  });

  it('un stock de CERO cuadra si el último conteo fue cero', () => {
    expect(cuadro(item({ stockErp: 0, conteos: [5, 0] }))).toBe(true);
  });

  it('SIN stock del ERP nunca cuadra: no hay contra qué comparar', () => {
    expect(cuadro(item({ stockErp: null, conteos: [100] }))).toBe(false);
  });

  it('SIN ningún conteo nunca cuadra, ni contra un ERP en cero', () => {
    expect(cuadro(item({ stockErp: 0, conteos: [null, null] }))).toBe(false);
  });
});

describe('destinoTrasRonda', () => {
  it('lo que cuadra sale del ciclo', () => {
    expect(destinoTrasRonda(item({ stockErp: 50, conteos: [50] }))).toBe('cuadrado');
  });

  it('lo que tiene diferencia va a recontar', () => {
    expect(destinoTrasRonda(item({ stockErp: 50, conteos: [47] }))).toBe('recontar');
    expect(destinoTrasRonda(item({ stockErp: 50, conteos: [53] }))).toBe('recontar');
  });

  it('contado en la ronda 1 y no en la 2: se juzga POR EL DE LA RONDA 1', () => {
    // Si el de la ronda 1 coincidía con el ERP, cuadra -- no vuelve a
    // recontar solo porque la ronda 2 lo salteó.
    expect(destinoTrasRonda(item({ stockErp: 50, conteos: [50, null] }))).toBe('cuadrado');
    expect(destinoTrasRonda(item({ stockErp: 50, conteos: [47, null] }))).toBe('recontar');
  });

  it('lo que NINGUNA ronda contó va a recontar, no se asume cero', () => {
    expect(destinoTrasRonda(item({ stockErp: 50, conteos: [null, null] }))).toBe('recontar');
    expect(destinoTrasRonda(item({ stockErp: 50, conteos: [null] }))).not.toBe('cuadrado');
  });

  it('sin stock del ERP no se recuenta NI se da por cuadrado', () => {
    expect(destinoTrasRonda(item({ stockErp: null, conteos: [50] }))).toBe('sin_dato_erp');
    expect(destinoTrasRonda(item({ stockErp: null, conteos: [null] }))).toBe('sin_dato_erp');
  });
});

describe('itemsParaLaRondaSiguiente', () => {
  const universo: ItemDeRonda[] = [
    { codigo: 'A', stockErp: 100, conteos: [100] }, // cuadra
    { codigo: 'B', stockErp: 100, conteos: [88] }, // falta
    { codigo: 'C', stockErp: 100, conteos: [120] }, // sobra
    { codigo: 'D', stockErp: 100, conteos: [null] }, // nunca contado
    { codigo: 'E', stockErp: null, conteos: [50] }, // sin dato del ERP
    { codigo: 'F', stockErp: 0, conteos: [0] }, // cuadra en cero
    { codigo: 'G', stockErp: 100, conteos: [100, null] }, // ronda 2 lo salteó, el de la 1 cuadra
  ];

  it('SOLO pasan los que no cuadraron: el embudo es el sentido del ciclo', () => {
    expect(itemsParaLaRondaSiguiente(universo).map((i) => i.codigo)).toEqual(['B', 'C', 'D']);
  });

  it('el que la ronda siguiente salteó NO vuelve si su último conteo cuadraba', () => {
    expect(itemsParaLaRondaSiguiente(universo).map((i) => i.codigo)).not.toContain('G');
  });

  it('el que no tiene dato del ERP tampoco vuelve: recontarlo no lo resuelve', () => {
    expect(itemsParaLaRondaSiguiente(universo).map((i) => i.codigo)).not.toContain('E');
  });

  it('conserva el orden de entrada (el recorrido de la tienda)', () => {
    const alReves = [...universo].reverse();
    expect(itemsParaLaRondaSiguiente(alReves).map((i) => i.codigo)).toEqual(['D', 'C', 'B']);
  });

  it('no muta el arreglo que recibe', () => {
    const copia = [...universo];
    itemsParaLaRondaSiguiente(universo);
    expect(universo).toEqual(copia);
  });

  it('si todo cuadra, no pasa nadie', () => {
    expect(itemsParaLaRondaSiguiente([item(), item({ codigo: 'X' })])).toEqual([]);
  });
});

describe('resumirRonda (el embudo de la Pantalla 4)', () => {
  const r = resumirRonda([
    { codigo: 'A', stockErp: 100, conteos: [100] },
    { codigo: 'B', stockErp: 100, conteos: [88] },
    { codigo: 'C', stockErp: 100, conteos: [null] },
    { codigo: 'D', stockErp: null, conteos: [50] },
    { codigo: 'E', stockErp: 200, conteos: [200] },
  ]);

  it('cuenta cada destino por separado', () => {
    expect(r.contados).toBe(5);
    expect(r.cuadrados).toBe(2);
    expect(r.aRecontar).toBe(2);
    expect(r.sinDatoErp).toBe(1);
  });

  it('separa cuántos van a recontar POR NO HABERSE CONTADO NUNCA', () => {
    expect(r.sinContar).toBe(1);
  });

  it('un ítem con conteo viejo NO cuenta como "sin contar"', () => {
    // Tiene el de la ronda 1: no es que nadie lo miró, es que difiere.
    const conViejo = resumirRonda([{ codigo: 'X', stockErp: 100, conteos: [88, null] }]);
    expect(conViejo.aRecontar).toBe(1);
    expect(conViejo.sinContar).toBe(0);
  });

  it('el porcentaje se calcula sobre los AUDITABLES, no sobre el total', () => {
    expect(r.porcentajeCuadrado).toBe(50);
  });

  it('no divide por cero cuando ningún ítem tiene stock del ERP', () => {
    const sinNada = resumirRonda([{ codigo: 'X', stockErp: null, conteos: [null] }]);
    expect(sinNada.porcentajeCuadrado).toBe(0);
    expect(sinNada.sinDatoErp).toBe(1);
  });

  it('con la ronda vacía devuelve todo en cero', () => {
    expect(resumirRonda([]).contados).toBe(0);
  });

  it('reproduce el embudo del ejemplo del cliente (8.000 → 650)', () => {
    const ochoMil: ItemDeRonda[] = Array.from({ length: 8000 }, (_, n) => ({
      codigo: `IT-${n}`,
      stockErp: 10,
      conteos: [n < 650 ? 9 : 10],
    }));
    const resumen = resumirRonda(ochoMil);
    expect(resumen.aRecontar).toBe(650);
    expect(resumen.cuadrados).toBe(7350);
    expect(itemsParaLaRondaSiguiente(ochoMil)).toHaveLength(650);
  });

  it('el embudo se angosta en la 2da ronda: de 650 quedan 130', () => {
    const seiscientos: ItemDeRonda[] = Array.from({ length: 650 }, (_, n) => ({
      codigo: `IT-${n}`,
      stockErp: 10,
      // Los primeros 130 siguen sin cuadrar en la 2da pasada.
      conteos: [9, n < 130 ? 9 : 10],
    }));
    expect(resumirRonda(seiscientos).aRecontar).toBe(130);
  });
});

describe('puedeAbrirRondaSiguiente', () => {
  it('deja abrir la 2 después de cerrar la 1, si quedó algo', () => {
    expect(puedeAbrirRondaSiguiente(1, 650)).toEqual({ puede: true, motivo: null });
  });

  it('deja abrir la 3 después de cerrar la 2', () => {
    expect(puedeAbrirRondaSiguiente(2, 130).puede).toBe(true);
  });

  it('NO deja abrir una 4ta: el ciclo son 3 pasadas', () => {
    const r = puedeAbrirRondaSiguiente(3, 12);
    expect(r.puede).toBe(false);
    expect(r.motivo).toMatch(/última del ciclo/i);
  });

  it('NO deja abrir otra ronda si todo cuadró -- y ese es el caso feliz', () => {
    const r = puedeAbrirRondaSiguiente(1, 0);
    expect(r.puede).toBe(false);
    expect(r.motivo).toMatch(/cuadraron/i);
  });

  it('que no quede nada gana sobre el límite de rondas: el motivo es más útil', () => {
    expect(puedeAbrirRondaSiguiente(3, 0).motivo).toMatch(/cuadraron/i);
  });

  it('el total de rondas se puede configurar (CANTIDAD_CONTEOS_CICLO)', () => {
    expect(RONDAS_DEL_CICLO).toBe(3);
    expect(puedeAbrirRondaSiguiente(3, 5, 5).puede).toBe(true);
    expect(puedeAbrirRondaSiguiente(5, 5, 5).puede).toBe(false);
  });
});
