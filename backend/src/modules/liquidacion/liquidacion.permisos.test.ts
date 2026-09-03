import { describe, expect, it } from 'vitest';
import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { validarAcceso } from './liquidacion.permisos';

const admin: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const gilmer: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const jose: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
const maria: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };

describe('validarAcceso a la liquidacion', () => {
  it('EL COORDINADOR SI VE LA LIQUIDACION -- al reves que la matriz de auditoria', () => {
    // La liquidacion es plata y nomina: no contiene stockErp, asi que no hay
    // conteo ciego que romper. Es la Pantalla 6, no la 5.
    expect(() => validarAcceso(jose, 1)).not.toThrow();
  });

  it('el auditor tambien', () => {
    expect(() => validarAcceso(gilmer, 1)).not.toThrow();
  });

  it('el administrador ve la de cualquier sucursal', () => {
    expect(() => validarAcceso(admin, 4)).not.toThrow();
  });

  it('el rol conteo NO: el descuento de sus companeros no es asunto suyo', () => {
    expect(() => validarAcceso(maria, 1)).toThrow(Prohibido);
  });

  it('nadie lee la nomina de otra tienda cambiando un id en la URL', () => {
    expect(() => validarAcceso(jose, 2)).toThrow(Prohibido);
    expect(() => validarAcceso(gilmer, 2)).toThrow(Prohibido);
  });
});
