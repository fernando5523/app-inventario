/**
 * Tests del progreso del snapshot.
 *
 * Lo que protegen, en una línea: que la barra que mira el Coordinador
 * mientras espera 90 segundos diga la verdad y no retroceda.
 *
 * El bug que originó esto (medido en el emulador el 2026-09-05): "0 ítems
 * traídos…" durante toda la bajada y salto a 951 al final, al lado del
 * cartel "puede tardar varios minutos". Se lee como "se colgó".
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  acotarAlTotal,
  avanceMonotono,
  iniciar,
  leer,
  limpiar,
  marcarGuardando,
  reportar,
  terminar,
} from './d365.progreso';

beforeEach(() => {
  limpiar();
});

// ---------------------------------------------------------------------------
// Las reglas, puras
// ---------------------------------------------------------------------------

describe('avanceMonotono', () => {
  /**
   * LA REGLA QUE IMPORTA. Las 7 entidades del snapshot se bajan con
   * `Promise.all`, así que los callbacks llegan intercalados. Sin esto, la
   * barra iría 500 → 120 → 800 y quien la mira deja de creerle.
   */
  it('nunca retrocede', () => {
    expect(avanceMonotono(500, 120)).toBe(500);
  });

  it('avanza cuando el nuevo es mayor', () => {
    expect(avanceMonotono(500, 800)).toBe(800);
  });

  it('con el mismo valor se queda igual', () => {
    expect(avanceMonotono(500, 500)).toBe(500);
  });
});

describe('acotarAlTotal', () => {
  it('recorta al total: "8.100 de 8.000" se lee como un error del sistema', () => {
    // El $count de Dynamics se calcula aparte de la página y puede quedar
    // desactualizado. El snapshot está bien; el número, mal.
    expect(acotarAlTotal(8100, 8000)).toBe(8000);
  });

  it('sin total conocido no recorta nada', () => {
    expect(acotarAlTotal(1200, null)).toBe(1200);
  });

  it('por debajo del total lo deja pasar', () => {
    expect(acotarAlTotal(1200, 8000)).toBe(1200);
  });
});

// ---------------------------------------------------------------------------
// El registro
// ---------------------------------------------------------------------------

describe('registro de progreso', () => {
  it('sin snapshot en curso devuelve null, no un cero', () => {
    // `null` = "no hay nada corriendo"; `{traidos: 0}` = "arrancó y no trajo
    // nada". Son cosas distintas y la pantalla las dibuja distinto.
    expect(leer(1)).toBeNull();
  });

  it('al iniciar arranca en 0 con total desconocido', () => {
    iniciar(1);
    expect(leer(1)).toMatchObject({ traidos: 0, total: null, fase: 'bajando' });
  });

  /**
   * `total: null` y NUNCA 0 mientras no se sepa: un 0 se dibuja como barra
   * llena o como división por cero. Mismo criterio que CatalogoItem.stockErp.
   */
  it('el total desconocido es null, no 0', () => {
    iniciar(1);
    expect(leer(1)?.total).toBeNull();
    expect(leer(1)?.total).not.toBe(0);
  });

  it('reportar páginas hace avanzar el número', () => {
    iniciar(1);
    reportar(1, 0, 8000);
    reportar(1, 500, 8000);
    reportar(1, 1000, 8000);

    expect(leer(1)).toMatchObject({ traidos: 1000, total: 8000 });
  });

  it('un reporte que llega tarde y desordenado NO hace retroceder la barra', () => {
    iniciar(1);
    reportar(1, 800, 8000);
    reportar(1, 500, 8000); // llegó tarde, de otra entidad en paralelo

    expect(leer(1)?.traidos).toBe(800);
  });

  it('un traidos mayor que el total se recorta', () => {
    iniciar(1);
    reportar(1, 8100, 8000);
    expect(leer(1)?.traidos).toBe(8000);
  });

  it('un reporte sin snapshot en curso NO resucita el progreso', () => {
    // Un callback huérfano —de un snapshot que ya terminó o se canceló— no
    // debe hacer aparecer un avance que nadie está esperando.
    reportar(99, 500, 8000);
    expect(leer(99)).toBeNull();
  });

  it('el total se conserva si un reporte posterior no lo trae', () => {
    iniciar(1);
    reportar(1, 500, 8000);
    reportar(1, 900, null);

    expect(leer(1)).toMatchObject({ traidos: 900, total: 8000 });
  });

  it('marca la fase de guardado: la transacción también tarda', () => {
    // Son N `create` en una sola transacción, así que hasta el commit no hay
    // ni una fila visible. Si la fase no cambiara, la barra quedaría clavada
    // en 100% sin explicación.
    iniciar(1);
    reportar(1, 8000, 8000);
    marcarGuardando(1);

    expect(leer(1)).toMatchObject({ traidos: 8000, fase: 'guardando' });
  });

  it('terminar borra el progreso', () => {
    iniciar(1);
    reportar(1, 500, 8000);
    terminar(1);

    expect(leer(1)).toBeNull();
  });

  it('cada sucursal lleva su propio progreso', () => {
    // Dos tiendas pueden estar bajando su catálogo a la vez.
    iniciar(1);
    iniciar(2);
    reportar(1, 500, 8000);
    reportar(2, 30, 900);

    expect(leer(1)).toMatchObject({ traidos: 500, total: 8000 });
    expect(leer(2)).toMatchObject({ traidos: 30, total: 900 });
  });

  it('iniciar de nuevo pisa el progreso viejo, no lo suma', () => {
    iniciar(1);
    reportar(1, 5000, 8000);
    iniciar(1);

    expect(leer(1)).toMatchObject({ traidos: 0, total: null });
  });

  it('actualizadoEn permite detectar un snapshot colgado', () => {
    iniciar(1);
    const t = leer(1)?.actualizadoEn ?? '';
    expect(Date.parse(t)).not.toBeNaN();
  });
});
