import { describe, expect, it } from 'vitest';
import {
  CifradoNoConfigurado,
  cifradoDisponible,
  cifrar,
  descifrar,
  enmascarar,
  VAR_CLAVE,
} from './config-dynamics.cifrado';

/** Clave de prueba: nunca se toma la del entorno en los tests. */
const CLAVE = 'clave-de-prueba-para-los-tests-0123456789';
const SECRETO = 'Abc8Q~un-secreto-de-azure-que-no-debe-verse-jamas';

describe('cifradoDisponible', () => {
  it('false sin clave, o con una demasiado corta para ser una clave', () => {
    expect(cifradoDisponible(undefined)).toBe(false);
    expect(cifradoDisponible('')).toBe(false);
    expect(cifradoDisponible('corta')).toBe(false);
  });

  it('true con una clave de largo razonable', () => {
    expect(cifradoDisponible(CLAVE)).toBe(true);
  });
});

describe('cifrar / descifrar', () => {
  it('el ida y vuelta devuelve el secreto original', () => {
    expect(descifrar(cifrar(SECRETO, CLAVE), CLAVE)).toBe(SECRETO);
  });

  it('el texto cifrado NO contiene el secreto en ninguna parte', () => {
    // Lo mas basico y lo mas importante: si el secreto se leyera del blob,
    // todo lo demas de este archivo seria decoracion.
    const guardado = cifrar(SECRETO, CLAVE);
    expect(guardado).not.toContain(SECRETO);
    expect(guardado).not.toContain('un-secreto-de-azure');
  });

  it('cifrar dos veces el MISMO secreto da dos cadenas distintas', () => {
    // El IV es aleatorio por cada cifrado. Si no lo fuera, la base filtraria
    // que el secreto no cambio entre dos guardados -- y eso ya es informacion.
    expect(cifrar(SECRETO, CLAVE)).not.toBe(cifrar(SECRETO, CLAVE));
  });

  it('las dos cadenas distintas descifran al mismo valor', () => {
    expect(descifrar(cifrar(SECRETO, CLAVE), CLAVE)).toBe(descifrar(cifrar(SECRETO, CLAVE), CLAVE));
  });

  it('guarda en formato iv:tag:cifrado, los tres en hexadecimal', () => {
    const partes = cifrar(SECRETO, CLAVE).split(':');
    expect(partes).toHaveLength(3);
    for (const parte of partes) expect(parte).toMatch(/^[0-9a-f]+$/);
  });

  it('con OTRA clave no descifra: falla en vez de devolver basura', () => {
    const guardado = cifrar(SECRETO, CLAVE);
    expect(() => descifrar(guardado, 'otra-clave-completamente-distinta-000')).toThrow();
  });

  it('un secreto MANIPULADO en la base falla al descifrar (el tag de GCM)', () => {
    // La razon de usar GCM y no CBC: sin autenticacion, un blob alterado
    // descifraria a bytes cualquiera que despues se le mandan a Azure AD
    // como si fueran un secreto valido.
    const [iv, tag, datos] = cifrar(SECRETO, CLAVE).split(':') as [string, string, string];
    const alterado = datos.slice(0, -2) + (datos.endsWith('00') ? '11' : '00');
    expect(() => descifrar(`${iv}:${tag}:${alterado}`, CLAVE)).toThrow();
  });

  it('un tag de autenticacion cambiado tambien falla', () => {
    const [iv, tag, datos] = cifrar(SECRETO, CLAVE).split(':') as [string, string, string];
    const tagFalso = tag.slice(0, -2) + (tag.endsWith('00') ? '11' : '00');
    expect(() => descifrar(`${iv}:${tagFalso}:${datos}`, CLAVE)).toThrow();
  });

  it('un formato que no es iv:tag:cifrado se rechaza con un mensaje claro', () => {
    expect(() => descifrar('no-es-un-secreto-cifrado', CLAVE)).toThrow(/formato/i);
  });

  it('sin clave configurada, cifrar y descifrar lanzan CifradoNoConfigurado', () => {
    // No se guarda un secreto que no se puede proteger: se falla.
    expect(() => cifrar(SECRETO, undefined)).toThrow(CifradoNoConfigurado);
    expect(() => descifrar('a:b:c', undefined)).toThrow(CifradoNoConfigurado);
  });

  it('el error dice como generar la clave, no solo que falta', () => {
    expect(() => cifrar(SECRETO, undefined)).toThrow(new RegExp(VAR_CLAVE));
    expect(() => cifrar(SECRETO, undefined)).toThrow(/openssl rand/);
  });

  it('soporta secretos con caracteres raros y acentos', () => {
    const raro = 'ñ~!@#$%^&*()_+áéíóú-secreto-con-todo';
    expect(descifrar(cifrar(raro, CLAVE), CLAVE)).toBe(raro);
  });
});

describe('enmascarar', () => {
  it('muestra 2 caracteres de cada punta y el largo', () => {
    expect(enmascarar('Abc8Q~secreto-largo-de-azure')).toBe('Ab******re (28 caracteres)');
  });

  it('un secreto corto se tapa ENTERO', () => {
    // Con 4 de cada lado un secreto corto quedaria casi entero a la vista.
    expect(enmascarar('abc123')).toBe('****** (6 caracteres)');
  });

  it('nunca deja ver el medio del secreto', () => {
    const secreto = 'inicio-PARTE-SECRETA-DEL-MEDIO-final';
    expect(enmascarar(secreto)).not.toContain('SECRETA');
    expect(enmascarar(secreto)).not.toContain('MEDIO');
  });
});
