/**
 * Geometría del filtro por bounds del escáner.
 *
 * Vive en un módulo aparte de ModalEscaner.tsx a propósito: acá NO se
 * importa react-native, así que estas funciones —las que evitan contar el
 * producto de al lado— se pueden probar de verdad (ver
 * escaner-geometria.test.ts). Importándolas desde el componente, el test
 * arrastraría el runtime de RN y ni siquiera levantaría.
 *
 * `BarcodeScanningResult` entra como `import type`: se borra al compilar,
 * no agrega dependencia en runtime.
 */

import type { BarcodeScanningResult } from 'expo-camera';

export interface Punto {
  x: number;
  y: number;
}

/**
 * Proporción del visor que ocupa el recuadro. Es la MISMA constante que
 * dibuja el marco (ModalEscaner.tsx) y que filtra las lecturas acá: si se
 * separaran, el marco volvería a mentir sobre qué zona lee de verdad, y un
 * marco que acota una zona distinta a la que el operario ve es peor que no
 * tener filtro.
 *
 * EL ANCHO SE BAJÓ DE 0.82 A 0.60 (2026-09-04). Con 0.82 + 6% de tolerancia
 * por lado, la zona aceptada era el 94% del ancho del visor: se rechazaban
 * 9 px de 296 por lado. En el eje VERTICAL el filtro sí acotaba (52% del
 * alto), pero en góndola los códigos están uno AL LADO del otro — o sea que
 * el eje que importa es el horizontal, y ahí el filtro prácticamente no
 * filtraba. El vecino entraba en cuadro y pasaba.
 *
 * Con 0.60 + 5%, la zona aceptada es el 70% del ancho: se rechaza el 15%
 * (44 px) de cada lado. El marco sigue midiendo ~178 px en un visor de 296,
 * de sobra para apuntar un EAN-13 a distancia de brazo.
 *
 * Es el número a AJUSTAR EN GÓNDOLA con el cliente: si todavía se cuela un
 * vecino, bajarlo; si cuesta capturar, subirlo. Cambiarlo acá cambia a la
 * vez el marco dibujado y la zona filtrada, que es el punto de que sea una
 * sola constante.
 */
export const MARCO_ANCHO = 0.6;
export const MARCO_ALTO = 0.4;

/**
 * Margen de tolerancia sobre el recuadro dibujado, en proporción del visor.
 * Existe porque `bounds` es aproximado por contrato: la doc de expo-camera
 * avisa que "no tiene por qué acotar el código entero" y que a veces
 * representa el área que usó el escáner. Sin un poco de aire, un código bien
 * apuntado se rechazaría por unos píxeles. Es el número a ajustar si en
 * campo se cuela un vecino (bajarlo) o cuesta capturar (subirlo).
 */
export const TOLERANCIA = 0.05;

/**
 * Dónde apareció el código dentro del visor.
 *
 * Se prefieren los `cornerPoints` sobre `bounds` porque son los cuatro
 * vértices reales del código; `bounds` es el rectángulo que los envuelve y,
 * según la doc, "puede representar un rectángulo vacío". Si ninguno de los
 * dos sirve, devuelve null — y una lectura sin ubicación NO se acepta: no
 * poder ubicarla es exactamente el caso que este filtro existe para atajar.
 */
export function centroDeLectura(resultado: BarcodeScanningResult): Punto | null {
  const puntos = resultado.cornerPoints;
  if (puntos && puntos.length >= 3) {
    const xs = puntos.map((p) => p.x);
    const ys = puntos.map((p) => p.y);
    const ancho = Math.max(...xs) - Math.min(...xs);
    const alto = Math.max(...ys) - Math.min(...ys);
    // Extensión cero = polígono degenerado (algunos dispositivos devuelven
    // los cuatro puntos en 0,0 en vez de omitir el campo).
    if (ancho > 0 && alto > 0) {
      return { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length };
    }
  }

  const b = resultado.bounds;
  if (b?.size && b.size.width > 0 && b.size.height > 0) {
    return { x: b.origin.x + b.size.width / 2, y: b.origin.y + b.size.height / 2 };
  }

  return null;
}

/**
 * ¿La lectura cae dentro del recuadro que se dibuja, más la tolerancia?
 *
 * EL filtro: en góndola los códigos están pegados uno al lado del otro y
 * expo-camera escanea el FRAME COMPLETO, así que el del producto de al lado
 * entra en cuadro y se lee perfecto — dato limpio, producto equivocado. Se
 * calcula con las mismas constantes que dibujan el marco, y los tests fijan
 * esa correspondencia.
 */
export function dentroDelMarco(centro: Punto, visor: { ancho: number; alto: number }): boolean {
  const medioAncho = (MARCO_ANCHO / 2 + TOLERANCIA) * visor.ancho;
  const medioAlto = (MARCO_ALTO / 2 + TOLERANCIA) * visor.alto;
  return Math.abs(centro.x - visor.ancho / 2) <= medioAncho && Math.abs(centro.y - visor.alto / 2) <= medioAlto;
}
