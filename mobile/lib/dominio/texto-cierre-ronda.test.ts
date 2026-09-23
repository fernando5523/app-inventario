import { describe, expect, it } from 'vitest';

import {
  textoRondaYaCerrada,
  esUltimaPasada,
  estadoDePaso,
  etiquetaARecontar,
  ordinal,
  ORDINAL,
  textoBotonCierre,
  textoCierreExplicacion,
} from './texto-cierre-ronda';

/**
 * LAS RONDAS YA NO SON TRES. Con la tabla vieja de tres entradas, la ronda 4
 * -- la que el Auditor acaba de mandar a hacer -- se leía `undefined`, y la
 * app decía "undefined conteo abierto" justo en el paso recién inventado.
 */
describe('ordinal: nombra cualquier ronda, no solo las tres del ciclo', () => {
  it('las primeras llevan su forma irregular', () => {
    expect(ordinal(1)).toBe('1er');
    expect(ordinal(3)).toBe('3er');
    expect(ordinal(4)).toBe('4to');
  });

  it('de la séptima en adelante se compone con el número, nunca undefined', () => {
    expect(ordinal(7)).toBe('7°');
    expect(ordinal(12)).toBe('12°');
  });

  it('ORDINAL[n] responde igual para las seis pantallas que ya lo usan como tabla', () => {
    expect(ORDINAL[2]).toBe('2do');
    expect(ORDINAL[5]).toBe('5to');
    expect(ORDINAL[9]).toBe('9°');
  });
});

// Formateador trivial: lo que se prueba acá es el TEXTO (qué ronda cierra y
// qué pasa después), no el formato de miles — ese ya tiene su propio test.
const fmt = (n: number) => String(n);

describe('textoBotonCierre: el botón dice qué ronda CIERRA y qué pasa DESPUÉS', () => {
  it('ronda 1 con ítems por recontar: cierra la 1ra y abre la 2da', () => {
    expect(textoBotonCierre(1, 136, fmt)).toBe('Cerrar el 1er conteo y abrir el 2do · 136 ítems');
  });

  it('ronda 2 con ítems por recontar: cierra la 2da y abre la 3ra — NUNCA "abrir el 2do" (esa era la mentira)', () => {
    expect(textoBotonCierre(2, 40, fmt)).toBe('Cerrar el 2do conteo y abrir el 3er · 40 ítems');
  });

  /**
   * ESTO CAMBIÓ. Decía "y terminar el inventario", y era cierto hasta que el
   * Auditor pudo abrir un 4to conteo o arrancar el ajuste final: ahora cerrar
   * la última pasada del ciclo NO termina nada, se lo pasa a él. Prometer el
   * fin acá sería mentir sobre el paso más delicado del cierre.
   */
  it('ronda 3 (última pasada del ciclo): cierra la 3ra y se lo pasa al auditor, no promete una 4ta', () => {
    expect(textoBotonCierre(3, 5, fmt)).toBe('Cerrar el 3er conteo y pasarlo al auditor');
  });

  it('sin nada por recontar (aRecontar 0, todo cuadró): cierra sin prometer otra ronda, aunque sea la 1ra', () => {
    expect(textoBotonCierre(1, 0, fmt)).toBe('Cerrar el 1er conteo y pasarlo al auditor');
  });

  it('UN solo ítem por recontar: "1 ítem", no "1 ítems" — en la 2da y la 3ra pasada esa cifra llega a uno', () => {
    expect(textoBotonCierre(1, 1, fmt)).toBe('Cerrar el 1er conteo y abrir el 2do · 1 ítem');
    expect(textoBotonCierre(2, 2, fmt)).toBe('Cerrar el 2do conteo y abrir el 3er · 2 ítems');
  });
});

describe('esUltimaPasada: cuándo cerrar TERMINA el conteo en vez de abrir otra ronda', () => {
  it('la 3ra siempre; y cualquier ronda cuando ya no queda nada por recontar', () => {
    expect(esUltimaPasada(3, 5)).toBe(true);
    expect(esUltimaPasada(1, 0)).toBe(true);
    expect(esUltimaPasada(2, 40)).toBe(false);
    expect(esUltimaPasada(1, 136)).toBe(false);
  });
});

describe('estadoDePaso: el badge de cada paso sale de la ronda ACTIVA, no de un literal', () => {
  it('EL BUG DEL CLIENTE — inventario en la 3ra: 1ro y 2do CERRADOS, 3ro EN CURSO', () => {
    expect(estadoDePaso(1, 3, true)).toBe('cerrado');
    // Antes el Paso 2 decía "en-proceso" (En curso) fijo: esa era la mentira.
    expect(estadoDePaso(2, 3, true)).toBe('cerrado');
    expect(estadoDePaso(3, 3, true)).toBe('en-curso');
  });

  it('inventario en la 1ra: la 1ra en curso, la 2da y 3ra pendientes', () => {
    expect(estadoDePaso(1, 1, true)).toBe('en-curso');
    expect(estadoDePaso(2, 1, false)).toBe('pendiente');
    expect(estadoDePaso(3, 1, false)).toBe('pendiente');
  });

  it('inventario en la 2da (intermedia): la 1ra cerrada, la 2da en curso, la 3ra pendiente', () => {
    expect(estadoDePaso(1, 2, true)).toBe('cerrado');
    expect(estadoDePaso(2, 2, true)).toBe('en-curso');
    expect(estadoDePaso(3, 2, false)).toBe('pendiente');
  });

  it('la ronda activa sin un solo conteo cargado es "pendiente", no "en curso"', () => {
    expect(estadoDePaso(1, 1, false)).toBe('pendiente');
  });

  it('sin ronda activa (el conteo ya cerró): las que corrieron cerradas, las que no, sin datos', () => {
    expect(estadoDePaso(1, null, true)).toBe('cerrado');
    expect(estadoDePaso(3, null, false)).toBe('sin-datos');
  });
});

describe('textos del bloque de cierre: nombran la ronda que corresponde, con ORDINAL', () => {
  it('ronda 1: la fila y el párrafo nombran el 2do conteo', () => {
    expect(etiquetaARecontar(1, 136)).toBe('A recontar en el 2do conteo');
    expect(textoCierreExplicacion(1, 136)).toContain('abre el 2do conteo');
  });

  it('ronda 2 (intermedia): nombran el 3er conteo, NUNCA el 2do (era la mentira reportada)', () => {
    expect(etiquetaARecontar(2, 40)).toBe('A recontar en el 3er conteo');
    const texto = textoCierreExplicacion(2, 40);
    expect(texto).toContain('abre el 3er conteo');
    expect(texto).not.toContain('2do conteo');
  });

  it('ronda 3 (última): sin "siguiente conteo"; queda en manos del auditor', () => {
    expect(etiquetaARecontar(3, 5)).toBe('Sin cuadrar (pasan al auditor)');
    const texto = textoCierreExplicacion(3, 5);
    expect(texto).toContain('auditor');
    expect(texto).not.toMatch(/abre el .* conteo/);
  });

  it('todo cuadró antes de la última (aRecontar 0): tampoco promete otra ronda', () => {
    expect(etiquetaARecontar(1, 0)).toBe('Sin cuadrar (pasan al auditor)');
    expect(textoCierreExplicacion(1, 0)).toContain('auditor');
  });
});

/**
 * Reemplaza al bloque que ofrecía cerrar una ronda YA cerrada. El backend lo
 * frenaba con un 409, pero el botón invitaba a un error garantizado.
 */
describe('textoRondaYaCerrada', () => {
  it('dice qué ronda cerró y que sigue el auditor', () => {
    const t = textoRondaYaCerrada(1);
    expect(t).toContain('1er conteo');
    expect(t).toMatch(/auditor/i);
  });

  /**
   * LO QUE NO SE PUEDE PERDER: la ventana de corrección sigue abierta. El
   * inventario está `en_curso` hasta que el auditor arranque su ajuste, y es
   * deliberado -- para el que detecta un error cinco minutos después.
   */
  it('deja claro que todavía puede corregir, y por dónde', () => {
    const t = textoRondaYaCerrada(1);
    expect(t).toMatch(/corregir/i);
    expect(t).toContain('Gestión de hojas');
  });

  /** NO dice que el conteo terminó: terminarlo es del auditor. */
  it('no afirma que el conteo terminó', () => {
    expect(textoRondaYaCerrada(2)).not.toMatch(/(conteo|inventario) (ya )?(terminó|cerró del todo|finalizó)/i);
  });

  it('sirve para una ronda extra del auditor', () => {
    expect(textoRondaYaCerrada(5)).toContain('5to conteo');
  });
});
