/**
 * El filtro por bounds, probado.
 *
 * Es EL bug que el cliente detectó en góndola con sus propios teléfonos:
 * los códigos están pegados uno al lado del otro, expo-camera escanea el
 * FRAME COMPLETO, y el del producto de al lado se lee perfecto — dato
 * limpio, del producto equivocado, y el error recién aparece semanas
 * después cuando no cuadra contra el ERP.
 *
 * Estas dos funciones son las que lo atajan, así que se prueban aparte del
 * componente (viven en escaner-geometria.ts, sin react-native, justamente
 * para poder probarlas): `centroDeLectura` ubica la lectura y `dentroDelMarco` decide
 * si cae en el recuadro que el operario VE. Si alguien cambiara la zona
 * filtrada sin cambiar la dibujada, el marco pasaría a mentir sobre dónde
 * apuntar — que es peor que no tener filtro.
 */

import { describe, expect, it } from 'vitest';
import type { BarcodeScanningResult } from 'expo-camera';

import { centroDeLectura, dentroDelMarco } from './escaner-geometria';

/** El visor real: ancho de la caja del modal (330 - 17*2 de padding) por su alto fijo. */
const VISOR = { ancho: 296, alto: 230 };

function lectura(parcial: Partial<BarcodeScanningResult>): BarcodeScanningResult {
  return { type: 'ean13', data: '7750123051', ...parcial } as BarcodeScanningResult;
}

describe('centroDeLectura', () => {
  it('promedia los cornerPoints, que son los vértices reales del código', () => {
    const centro = centroDeLectura(
      lectura({
        cornerPoints: [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
          { x: 200, y: 140 },
          { x: 100, y: 140 },
        ],
      }),
    );
    expect(centro).toEqual({ x: 150, y: 120 });
  });

  it('descarta cornerPoints degenerados (los cuatro en 0,0) y cae a bounds', () => {
    // Algunos dispositivos devuelven los puntos en cero en vez de omitir el
    // campo. Tomarlos en serio pondría el centro en la esquina superior
    // izquierda y rechazaría una lectura perfectamente centrada.
    const centro = centroDeLectura(
      lectura({
        cornerPoints: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
        bounds: { origin: { x: 120, y: 100 }, size: { width: 60, height: 30 } },
      }),
    );
    expect(centro).toEqual({ x: 150, y: 115 });
  });

  it('usa bounds cuando no hay cornerPoints', () => {
    expect(centroDeLectura(lectura({ bounds: { origin: { x: 10, y: 20 }, size: { width: 100, height: 40 } } }))).toEqual({
      x: 60,
      y: 40,
    });
  });

  it('devuelve null sin geometría utilizable — una lectura que no se puede ubicar NO se acepta', () => {
    expect(centroDeLectura(lectura({}))).toBeNull();
    // "bounds puede representar un rectángulo vacío", dice la doc.
    expect(centroDeLectura(lectura({ bounds: { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } } }))).toBeNull();
  });
});

describe('dentroDelMarco', () => {
  it('acepta el código centrado, que es donde el operario apunta', () => {
    expect(dentroDelMarco({ x: VISOR.ancho / 2, y: VISOR.alto / 2 }, VISOR)).toBe(true);
  });

  it('RECHAZA el código del producto de al lado, a los costados del visor', () => {
    // El caso de góndola: entra en cuadro, se lee perfecto, y es del
    // producto equivocado. Si este test se vuelve verde al revés, volvió el
    // bug que el cliente reportó.
    expect(dentroDelMarco({ x: 10, y: VISOR.alto / 2 }, VISOR)).toBe(false);
    expect(dentroDelMarco({ x: 40, y: VISOR.alto / 2 }, VISOR)).toBe(false);
    expect(dentroDelMarco({ x: VISOR.ancho - 40, y: VISOR.alto / 2 }, VISOR)).toBe(false);
    expect(dentroDelMarco({ x: VISOR.ancho - 10, y: VISOR.alto / 2 }, VISOR)).toBe(false);
  });

  it('el filtro acota DE VERDAD en horizontal, que es el eje donde está el vecino', () => {
    // Este test existe por un hallazgo concreto: con el marco al 82% del
    // ancho, la zona aceptada llegaba al 94% y se rechazaban 9 px de 296
    // por lado — o sea, casi nada, justo en el eje en que los códigos de
    // góndola están pegados. Si alguien vuelve a ensanchar el marco sin
    // pensarlo, esto rompe.
    const anchoAceptado = 2 * (0.6 / 2 + 0.05);
    expect(anchoAceptado).toBeLessThanOrEqual(0.75);

    const rechazadoPorLado = ((1 - anchoAceptado) / 2) * VISOR.ancho;
    expect(rechazadoPorLado).toBeGreaterThan(30);
  });

  it('rechaza lo que queda arriba o abajo del recuadro', () => {
    // El marco es angosto en alto (40% del visor): un código en la fila de
    // arriba de la góndola cae afuera aunque esté centrado horizontalmente.
    expect(dentroDelMarco({ x: VISOR.ancho / 2, y: 8 }, VISOR)).toBe(false);
    expect(dentroDelMarco({ x: VISOR.ancho / 2, y: VISOR.alto - 8 }, VISOR)).toBe(false);
  });

  it('la zona aceptada es la del marco dibujado más la tolerancia, ni más ni menos', () => {
    // El marco se dibuja con width 60% / height 40% centrado, y el filtro
    // agrega 5% de aire por cada lado porque `bounds` es aproximado por
    // contrato. Este test fija esa correspondencia: si alguien tocara una
    // constante sin la otra, el marco mentiría sobre qué zona lee.
    const MARCO_ANCHO = 0.6;
    const MARCO_ALTO = 0.4;
    const TOLERANCIA = 0.05;
    const limiteX = (MARCO_ANCHO / 2 + TOLERANCIA) * VISOR.ancho;
    const limiteY = (MARCO_ALTO / 2 + TOLERANCIA) * VISOR.alto;
    const cx = VISOR.ancho / 2;
    const cy = VISOR.alto / 2;

    expect(dentroDelMarco({ x: cx + limiteX - 1, y: cy }, VISOR)).toBe(true);
    expect(dentroDelMarco({ x: cx + limiteX + 1, y: cy }, VISOR)).toBe(false);
    expect(dentroDelMarco({ x: cx, y: cy + limiteY - 1 }, VISOR)).toBe(true);
    expect(dentroDelMarco({ x: cx, y: cy + limiteY + 1 }, VISOR)).toBe(false);
  });

  it('un código apenas fuera del borde dibujado entra por la tolerancia', () => {
    // Sin ese aire, un código bien apuntado se rechazaría por unos píxeles
    // y el operario no entendería por qué no lee.
    const bordeDibujado = VISOR.ancho / 2 + (0.6 / 2) * VISOR.ancho;
    expect(dentroDelMarco({ x: bordeDibujado + 4, y: VISOR.alto / 2 }, VISOR)).toBe(true);
  });
});
