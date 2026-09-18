import { describe, expect, it } from 'vitest';

import { textoAuditoresInsuficientes, textoFirmadoPor, textoFirmas, textoFirmasPendientes } from './texto-firmas';

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

describe('textoFirmasPendientes: qué falta para lacrar, concordado con el mínimo', () => {
  it('con requerido 1 (config de hoy): "falta la firma", no "faltan 1 de las 1 firma"', () => {
    expect(textoFirmasPendientes(0, 1)).toBe('falta la firma de auditoría');
  });

  it('con requerido 2 y una sola pendiente: el verbo concuerda con la que falta', () => {
    expect(textoFirmasPendientes(1, 2)).toBe('falta 1 de las 2 firmas de auditoría');
  });

  it('con requerido 2 y ninguna hecha: plural en el verbo', () => {
    expect(textoFirmasPendientes(0, 2)).toBe('faltan 2 de las 2 firmas de auditoría');
  });

  it('ya firmaron todos: no dice que faltan firmas (decía "faltan 0"), dice qué falta de verdad', () => {
    expect(textoFirmasPendientes(1, 1)).toBe('la firma ya está registrada y solo falta ejecutar el lacrado');
    expect(textoFirmasPendientes(2, 2)).toBe('las 2 firmas ya están registradas y solo falta ejecutar el lacrado');
  });
});

describe('textoAuditoresInsuficientes: cuenta del sistema y sigue el mínimo', () => {
  it('habla del SISTEMA, no de "esta sucursal" (el auditor ya no tiene tienda)', () => {
    expect(textoAuditoresInsuficientes(0, 2)).toContain('El sistema tiene');
    expect(textoAuditoresInsuficientes(0, 2)).not.toContain('sucursal');
  });

  it('con requerido 2: SÍ menciona personas distintas (es doble firma)', () => {
    const t = textoAuditoresInsuficientes(1, 2);
    expect(t).toContain('el lacrado exige 2');
    expect(t).toContain('una cuenta más');
    expect(t).toContain('personas distintas, no toques repetidos');
  });

  it('con requerido 1: NO menciona personas distintas (confunde, no es doble firma)', () => {
    const t = textoAuditoresInsuficientes(0, 1);
    expect(t).toContain('el lacrado exige 1');
    expect(t).not.toContain('personas distintas');
    expect(t).not.toContain('toques repetidos');
  });
});
