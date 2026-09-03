import { describe, expect, it } from 'vitest';
import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { validarAlcanceDeGestion, validarPermisoDeAlta } from './usuarios.permisos';

const administrador: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const auditorLuzuriaga: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const coordinadorLuzuriaga: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
const conteoLuzuriaga: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };

describe('validarPermisoDeAlta', () => {
  it('administrador puede crear cualquier rol, en cualquier sucursal', () => {
    expect(() => validarPermisoDeAlta(administrador, { rol: 'administrador', sucursalId: undefined })).not.toThrow();
    expect(() => validarPermisoDeAlta(administrador, { rol: 'auditor', sucursalId: 2 })).not.toThrow();
    expect(() => validarPermisoDeAlta(administrador, { rol: 'coordinador', sucursalId: 3 })).not.toThrow();
    expect(() => validarPermisoDeAlta(administrador, { rol: 'conteo', sucursalId: 4 })).not.toThrow();
  });

  it('auditor puede crear coordinador de SU PROPIA sucursal', () => {
    expect(() => validarPermisoDeAlta(auditorLuzuriaga, { rol: 'coordinador', sucursalId: 1 })).not.toThrow();
  });

  it('auditor puede crear conteo de SU PROPIA sucursal', () => {
    expect(() => validarPermisoDeAlta(auditorLuzuriaga, { rol: 'conteo', sucursalId: 1 })).not.toThrow();
  });

  it('auditor NUNCA puede crear otro auditor, ni siquiera de su propia sucursal', () => {
    expect(() => validarPermisoDeAlta(auditorLuzuriaga, { rol: 'auditor', sucursalId: 1 })).toThrow(Prohibido);
  });

  it('auditor NUNCA puede crear un administrador', () => {
    expect(() => validarPermisoDeAlta(auditorLuzuriaga, { rol: 'administrador', sucursalId: undefined })).toThrow(Prohibido);
  });

  it('auditor no puede crear cuentas de OTRA sucursal', () => {
    expect(() => validarPermisoDeAlta(auditorLuzuriaga, { rol: 'conteo', sucursalId: 2 })).toThrow(Prohibido);
  });

  it('coordinador no tiene acceso a dar de alta a nadie (cinturon y tiradores: las rutas ya lo bloquean antes)', () => {
    expect(() => validarPermisoDeAlta(coordinadorLuzuriaga, { rol: 'conteo', sucursalId: 1 })).toThrow(Prohibido);
  });

  it('conteo no tiene acceso a dar de alta a nadie', () => {
    expect(() => validarPermisoDeAlta(conteoLuzuriaga, { rol: 'conteo', sucursalId: 1 })).toThrow(Prohibido);
  });
});

describe('validarAlcanceDeGestion (habilitar/deshabilitar/resetear PIN de una cuenta existente)', () => {
  it('administrador gestiona cualquier cuenta, incluido otro administrador', () => {
    expect(() => validarAlcanceDeGestion(administrador, { rol: 'administrador', sucursalId: null })).not.toThrow();
    expect(() => validarAlcanceDeGestion(administrador, { rol: 'auditor', sucursalId: 2 })).not.toThrow();
  });

  it('auditor gestiona coordinador/conteo de su propia sucursal', () => {
    expect(() => validarAlcanceDeGestion(auditorLuzuriaga, { rol: 'coordinador', sucursalId: 1 })).not.toThrow();
    expect(() => validarAlcanceDeGestion(auditorLuzuriaga, { rol: 'conteo', sucursalId: 1 })).not.toThrow();
  });

  it('auditor NO gestiona a otro auditor de su misma sucursal', () => {
    expect(() => validarAlcanceDeGestion(auditorLuzuriaga, { rol: 'auditor', sucursalId: 1 })).toThrow(Prohibido);
  });

  it('auditor NO gestiona a un administrador', () => {
    expect(() => validarAlcanceDeGestion(auditorLuzuriaga, { rol: 'administrador', sucursalId: null })).toThrow(Prohibido);
  });

  it('auditor NO gestiona cuentas de otra sucursal', () => {
    expect(() => validarAlcanceDeGestion(auditorLuzuriaga, { rol: 'conteo', sucursalId: 2 })).toThrow(Prohibido);
  });
});
