import { describe, expect, it } from 'vitest';
import { bonoBase, repartirExacto, sobranteSinRepartir } from './reparto-de-fondo';

/** Suma los montos repartidos, en centavos, para poder comparar sin floats. */
function sumaEnCentavos(reparto: ReadonlyMap<number, number>): number {
  let total = 0;
  for (const monto of reparto.values()) total += Math.round(monto * 100);
  return total;
}

describe('repartirExacto — los casos que hoy no cerraban', () => {
  it('EL CASO REAL DE LA REUNIÓN: S/80 entre 7 asistentes cierra exacto', () => {
    // Antes: redondear(80/7) = 11.43 para los 7 = 80.01. La empresa ponía
    // un centavo. Es el ejemplo textual que dio Gilmer (11 personas, 4 faltas).
    const reparto = repartirExacto(80, [1, 2, 3, 4, 5, 6, 7]);
    expect(sumaEnCentavos(reparto)).toBe(8000);
    expect(sobranteSinRepartir(80, reparto)).toBe(0);
  });

  it('y reparte 11.43 a los primeros 3, 11.42 al resto', () => {
    // 80.00 / 7 = 11.4285... -> base 11.42, sobran 6 centavos -> los 6
    // primeros llevan 11.43. La suma da 80.00 clavado.
    const reparto = repartirExacto(80, [1, 2, 3, 4, 5, 6, 7]);
    expect(reparto.get(1)).toBe(11.43);
    expect(reparto.get(6)).toBe(11.43);
    expect(reparto.get(7)).toBe(11.42);
  });

  it('S/40 entre 9: antes la empresa se quedaba con 4 centavos', () => {
    const reparto = repartirExacto(40, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(sumaEnCentavos(reparto)).toBe(4000);
  });

  it('el caso del mockup (S/60 entre 8) sigue dando 7.50 parejo', () => {
    // Este ya cerraba por casualidad: la división daba exacta. Tiene que
    // seguir dando lo mismo, sin centavos sueltos.
    const reparto = repartirExacto(60, [1, 2, 3, 4, 5, 6, 7, 8]);
    for (const monto of reparto.values()) expect(monto).toBe(7.5);
    expect(sumaEnCentavos(reparto)).toBe(6000);
  });
});

describe('repartirExacto — el criterio de quién recibe el centavo', () => {
  it('el sobrante va por ID ASCENDENTE, no por orden de entrada', () => {
    // Si dependiera del orden en que llegan (o del que devolvió la base), la
    // misma liquidación daría distinto en dos corridas.
    const enOrden = repartirExacto(10, [1, 2, 3]);
    const alReves = repartirExacto(10, [3, 2, 1]);
    const mezclado = repartirExacto(10, [2, 3, 1]);

    expect(enOrden.get(1)).toBe(3.34);
    expect(enOrden.get(2)).toBe(3.33);
    expect(enOrden.get(3)).toBe(3.33);
    expect(alReves).toEqual(enOrden);
    expect(mezclado).toEqual(enOrden);
  });

  it('el mismo reparto dos veces da idéntico', () => {
    expect(repartirExacto(80, [7, 3, 1, 5])).toEqual(repartirExacto(80, [7, 3, 1, 5]));
  });

  it('no muta el arreglo de ids que recibe', () => {
    const ids = [3, 1, 2];
    repartirExacto(10, ids);
    expect(ids).toEqual([3, 1, 2]);
  });
});

describe('repartirExacto — bordes', () => {
  it('CERO asistentes: no reparte nada, y el fondo queda sin repartir', () => {
    // Solo pasa si NADIE asistió: todos pagan multa y no hay a quién
    // redistribuirla. Devolver un reparto vacío es más honesto que inventar
    // un destinatario -- y `sobranteSinRepartir` lo deja visible.
    const reparto = repartirExacto(80, []);
    expect(reparto.size).toBe(0);
    expect(sobranteSinRepartir(80, reparto)).toBe(80);
  });

  it('UN asistente: se lleva todo el fondo', () => {
    const reparto = repartirExacto(80, [42]);
    expect(reparto.get(42)).toBe(80);
    expect(sobranteSinRepartir(80, reparto)).toBe(0);
  });

  it('fondo CERO: todos reciben 0, no null ni undefined', () => {
    const reparto = repartirExacto(0, [1, 2, 3]);
    expect([...reparto.values()]).toEqual([0, 0, 0]);
    expect(sobranteSinRepartir(0, reparto)).toBe(0);
  });

  it('un fondo con más de dos decimales se redondea UNA vez, al principio', () => {
    // 33.333 -> 3333 centavos, repartidos exacto.
    const reparto = repartirExacto(33.333, [1, 2, 3]);
    expect(sumaEnCentavos(reparto)).toBe(3333);
  });
});

// ===========================================================================
// EL TEST QUE VALE: la propiedad, sobre muchas combinaciones.
// ===========================================================================

describe('PROPIEDAD: la suma de lo repartido SIEMPRE es igual al fondo', () => {
  const fondos = [0, 0.01, 1, 20, 40, 60, 80, 100, 120, 140, 333.33, 1000, 1650.55];
  const cantidades = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 17, 29, 30, 100];

  it(`se cumple en los ${fondos.length * cantidades.length} casos de fondo × asistentes`, () => {
    const fallos: string[] = [];

    for (const fondo of fondos) {
      for (const n of cantidades) {
        const ids = Array.from({ length: n }, (_, i) => i + 1);
        const reparto = repartirExacto(fondo, ids);

        const esperado = Math.round(fondo * 100);
        const repartido = sumaEnCentavos(reparto);
        if (repartido !== esperado) {
          fallos.push(`fondo ${fondo} entre ${n}: se repartieron ${repartido} centavos, esperaba ${esperado}`);
        }
        if (reparto.size !== n) fallos.push(`fondo ${fondo} entre ${n}: reparto de ${reparto.size} personas`);
      }
    }

    expect(fallos).toEqual([]);
  });

  it('y ninguna diferencia entre dos personas supera UN centavo', () => {
    // Repartir "exacto" no puede significar que a uno le toque el doble: el
    // sobrante se distribuye de a un centavo, no en bloque.
    for (const fondo of fondos) {
      for (const n of cantidades) {
        const ids = Array.from({ length: n }, (_, i) => i + 1);
        const montos = [...repartirExacto(fondo, ids).values()].map((m) => Math.round(m * 100));
        const diferencia = Math.max(...montos) - Math.min(...montos);
        expect(diferencia).toBeLessThanOrEqual(1);
      }
    }
  });

  it('nadie recibe un monto negativo con un fondo positivo', () => {
    for (const fondo of fondos) {
      for (const n of cantidades) {
        const ids = Array.from({ length: n }, (_, i) => i + 1);
        for (const monto of repartirExacto(fondo, ids).values()) {
          expect(monto).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('bonoBase — el número del encabezado', () => {
  it('es el PISO del reparto, no el promedio', () => {
    // "−S/11.42 para cada asistente" es cierto para todos; 11.4285 no lo
    // recibe nadie.
    expect(bonoBase(80, 7)).toBe(11.42);
  });

  it('coincide con el mínimo que devuelve el reparto', () => {
    for (const [fondo, n] of [[80, 7], [40, 9], [60, 8], [140, 23]] as const) {
      const ids = Array.from({ length: n }, (_, i) => i + 1);
      const montos = [...repartirExacto(fondo, ids).values()];
      expect(bonoBase(fondo, n)).toBe(Math.min(...montos));
    }
  });

  it('con cero personas no divide por cero', () => {
    expect(bonoBase(80, 0)).toBe(0);
    expect(bonoBase(80, -1)).toBe(0);
  });
});
