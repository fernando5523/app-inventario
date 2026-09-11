/**
 * Dominio puro de la pantalla de importar el Excel de ajustes de Dynamics
 * (contra backend/src/modules/liquidacion/liquidacion.ajustes-negativos.ts,
 * e39b370): textos de cada motivo, y la distinción NULL != 0 llevada a la
 * pantalla ("todavía no se importó" bloquea liquidar; "se importó y dio 0"
 * no bloquea nada).
 */
import { describe, expect, it } from 'vitest';
import {
  estadoNegativos,
  textoMotivoAdvertencia,
  textoMotivoRechazo,
  totalLineasNoExcluidas,
  type MotivoAdvertenciaLinea,
  type MotivoRechazoLinea,
} from './ajustes-negativos';

describe('textoMotivoRechazo', () => {
  it('cubre los DOS motivos de rechazo del backend, cada uno con su propio texto', () => {
    const motivos: MotivoRechazoLinea[] = ['otra-tienda', 'datos-invalidos'];
    const textos = motivos.map(textoMotivoRechazo);
    expect(new Set(textos).size).toBe(2); // ninguno repetido
    for (const t of textos) expect(t.length).toBeGreaterThan(0);
  });

  it('otra-tienda menciona la tienda/almacén', () => {
    expect(textoMotivoRechazo('otra-tienda')).toMatch(/tienda|almac[ée]n/i);
  });

  it('datos-invalidos menciona que no se pudo leer/interpretar', () => {
    expect(textoMotivoRechazo('datos-invalidos')).toMatch(/no se p(u|o)d/i);
  });
});

describe('textoMotivoAdvertencia', () => {
  it('cubre las TRES advertencias del backend, cada una con su propio texto', () => {
    const motivos: MotivoAdvertenciaLinea[] = ['importe-no-coincide', 'fuera-de-periodo', 'responsable-no-empleado'];
    const textos = motivos.map(textoMotivoAdvertencia);
    expect(new Set(textos).size).toBe(3);
    for (const t of textos) expect(t.length).toBeGreaterThan(0);
  });

  it('importe-no-coincide menciona Cantidad y Precio', () => {
    expect(textoMotivoAdvertencia('importe-no-coincide')).toMatch(/cantidad/i);
  });

  it('fuera-de-periodo menciona el período/fecha', () => {
    expect(textoMotivoAdvertencia('fuera-de-periodo')).toMatch(/per[ií]odo|fecha/i);
  });

  it('responsable-no-empleado menciona "Empleado"', () => {
    expect(textoMotivoAdvertencia('responsable-no-empleado')).toMatch(/empleado/i);
  });
});

describe('estadoNegativos: NULL != 0, la regla completa', () => {
  it('null: "sin-importar", bloquea liquidar, sin monto', () => {
    const e = estadoNegativos(null);
    expect(e.estado).toBe('sin-importar');
    expect(e.bloqueaLiquidar).toBe(true);
    expect(e.monto).toBeNull();
  });

  it('0: "importado", NO bloquea, monto 0 explícito (no confundir con sin-importar)', () => {
    const e = estadoNegativos(0);
    expect(e.estado).toBe('importado');
    expect(e.bloqueaLiquidar).toBe(false);
    expect(e.monto).toBe(0);
  });

  it('380: "importado", NO bloquea, monto 380', () => {
    const e = estadoNegativos(380);
    expect(e.estado).toBe('importado');
    expect(e.bloqueaLiquidar).toBe(false);
    expect(e.monto).toBe(380);
  });

  it('el texto de "sin-importar" es DISTINTO del texto de "importado en 0" -- nunca el mismo mensaje para los dos', () => {
    expect(estadoNegativos(null).texto).not.toBe(estadoNegativos(0).texto);
  });

  it('el texto de "sin-importar" dice explícitamente que bloquea liquidar', () => {
    expect(estadoNegativos(null).texto).toMatch(/no se import|liquidar/i);
  });

  it('el texto de "importado en 0" dice que SÍ se importó (no que falta hacerlo)', () => {
    expect(estadoNegativos(0).texto).not.toMatch(/todav[ií]a no/i);
  });
});

describe('totalLineasNoExcluidas', () => {
  it('suma solo las NO excluidas', () => {
    const lineas = [
      { importe: 30, excluida: false },
      { importe: 15, excluida: true },
      { importe: 5, excluida: false },
    ];
    expect(totalLineasNoExcluidas(lineas)).toBe(35);
  });

  it('lista vacía da 0 explícito', () => {
    expect(totalLineasNoExcluidas([])).toBe(0);
  });

  it('todas excluidas da 0', () => {
    expect(totalLineasNoExcluidas([{ importe: 100, excluida: true }])).toBe(0);
  });
});
