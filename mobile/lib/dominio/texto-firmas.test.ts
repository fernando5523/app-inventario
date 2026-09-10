import { describe, expect, it } from 'vitest';

import { textoFirmadoPor, textoFirmas } from './texto-firmas';

describe('textoFirmas: sigue el mínimo configurable, no un 2 hardcodeado', () => {
  it('con requerido 1 (config de hoy): "0 / 1 firma", singular', () => {
    expect(textoFirmas(0, 1)).toBe('0 / 1 firma');
    expect(textoFirmas(1, 1)).toBe('1 / 1 firma');
  });

  it('con requerido 2: "0 / 2 firmas", plural (el bug era este 2 escrito a mano)', () => {
    expect(textoFirmas(0, 2)).toBe('0 / 2 firmas');
    expect(textoFirmas(1, 2)).toBe('1 / 2 firmas');
  });

  it('con requerido 3 (el día que sean tres): la tarjeta se entera sola', () => {
    expect(textoFirmas(2, 3)).toBe('2 / 3 firmas');
  });
});

describe('textoFirmadoPor: pluraliza auditor según el requerido', () => {
  it('1 -> "Firmado por 1 auditor"; 2 -> "Firmado por 2 auditores"', () => {
    expect(textoFirmadoPor(1)).toBe('Firmado por 1 auditor');
    expect(textoFirmadoPor(2)).toBe('Firmado por 2 auditores');
  });
});
