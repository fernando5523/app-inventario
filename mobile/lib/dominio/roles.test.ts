import { describe, expect, it } from 'vitest';
import { puedeCrearRol, rolesQuePuedeCrear } from './roles';
import type { Rol } from './tipos';

describe('rolesQuePuedeCrear', () => {
  it('el administrador puede crear los 4 roles, incluido administrador', () => {
    expect(rolesQuePuedeCrear('administrador')).toEqual(
      expect.arrayContaining<Rol>(['administrador', 'auditor', 'coordinador', 'conteo']),
    );
    expect(rolesQuePuedeCrear('administrador')).toHaveLength(4);
  });

  it('el auditor puede crear coordinador y conteo', () => {
    expect(rolesQuePuedeCrear('auditor')).toEqual(expect.arrayContaining<Rol>(['coordinador', 'conteo']));
    expect(rolesQuePuedeCrear('auditor')).toHaveLength(2);
  });

  it('el auditor NO puede crear auditor (su propio rol) ni administrador', () => {
    expect(rolesQuePuedeCrear('auditor')).not.toContain('auditor');
    expect(rolesQuePuedeCrear('auditor')).not.toContain('administrador');
  });

  it('coordinador y conteo no pueden crear a nadie', () => {
    expect(rolesQuePuedeCrear('coordinador')).toEqual([]);
    expect(rolesQuePuedeCrear('conteo')).toEqual([]);
  });
});

describe('puedeCrearRol', () => {
  it('el administrador puede otorgar cualquiera de los 4 roles', () => {
    expect(puedeCrearRol('administrador', 'administrador')).toBe(true);
    expect(puedeCrearRol('administrador', 'auditor')).toBe(true);
    expect(puedeCrearRol('administrador', 'coordinador')).toBe(true);
    expect(puedeCrearRol('administrador', 'conteo')).toBe(true);
  });

  it('el auditor puede otorgar coordinador y conteo', () => {
    expect(puedeCrearRol('auditor', 'coordinador')).toBe(true);
    expect(puedeCrearRol('auditor', 'conteo')).toBe(true);
  });

  it('el auditor NO puede otorgar auditor (su propio rol) ni administrador', () => {
    // Este es el caso que importa de verdad: si mañana alguien toca la
    // tabla y un auditor queda habilitado para crear administradores, este
    // test tiene que romper.
    expect(puedeCrearRol('auditor', 'auditor')).toBe(false);
    expect(puedeCrearRol('auditor', 'administrador')).toBe(false);
  });

  it('coordinador y conteo no pueden otorgar ningún rol', () => {
    expect(puedeCrearRol('coordinador', 'conteo')).toBe(false);
    expect(puedeCrearRol('coordinador', 'coordinador')).toBe(false);
    expect(puedeCrearRol('conteo', 'conteo')).toBe(false);
    expect(puedeCrearRol('conteo', 'coordinador')).toBe(false);
  });
});
