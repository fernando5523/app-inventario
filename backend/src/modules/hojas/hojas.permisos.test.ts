import { describe, expect, it } from 'vitest';
import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import {
  estaAsignadaA,
  puedeVerTodasLasHojas,
  validarAlcance,
  validarEscrituraDeHoja,
  validarLecturaDeHoja,
  validarSucursal,
} from './hojas.permisos';

const CONTADOR: ColaboradorAutenticado = { colaboradorId: 10, sucursalId: 1, rol: 'conteo' };
const OTRO_CONTADOR: ColaboradorAutenticado = { colaboradorId: 11, sucursalId: 1, rol: 'conteo' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 20, sucursalId: 1, rol: 'coordinador' };
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 30, sucursalId: 1, rol: 'auditor' };
const ADMIN: ColaboradorAutenticado = { colaboradorId: 999, sucursalId: null, rol: 'administrador' };

/** Hoja de la sucursal 1, asignada al contador 10. */
const HOJA = { sucursalId: 1, asignadoAId: 10, asignadoA2Id: null };

describe('conteo ciego: quien puede ver el lote entero', () => {
  it('un Contador NUNCA ve todas las hojas', () => {
    // Ver el lote completo es ver lo que conto el resto: el conteo cruzado
    // deja de ser ciego.
    expect(puedeVerTodasLasHojas('conteo')).toBe(false);
    expect(() => validarAlcance(CONTADOR, 'todas')).toThrow(Prohibido);
  });

  it('pero si ve las suyas', () => {
    expect(() => validarAlcance(CONTADOR, 'mias')).not.toThrow();
  });

  it.each(['coordinador', 'auditor', 'administrador'] as const)('%s si tiene vista de conjunto', (rol) => {
    expect(puedeVerTodasLasHojas(rol)).toBe(true);
  });
});

describe('alcance por sucursal', () => {
  it('nadie sale de su sucursal cambiando un id en la URL', () => {
    expect(() => validarSucursal(COORDINADOR, 2)).toThrow(Prohibido);
  });

  it('el administrador no pertenece a ninguna y ve todas', () => {
    expect(() => validarSucursal(ADMIN, 2)).not.toThrow();
  });
});

describe('lectura de una hoja', () => {
  it('el contador asignado la abre', () => {
    expect(() => validarLecturaDeHoja(CONTADOR, HOJA)).not.toThrow();
  });

  it('otro contador de la misma sucursal NO la abre', () => {
    expect(() => validarLecturaDeHoja(OTRO_CONTADOR, HOJA)).toThrow(Prohibido);
  });

  it('reconoce al segundo asignado (una hoja admite dos)', () => {
    expect(estaAsignadaA({ ...HOJA, asignadoA2Id: 11 }, 11)).toBe(true);
    expect(() => validarLecturaDeHoja(OTRO_CONTADOR, { ...HOJA, asignadoA2Id: 11 })).not.toThrow();
  });

  it('coordinador y auditor abren cualquiera de su sucursal aunque no sea suya', () => {
    expect(() => validarLecturaDeHoja(COORDINADOR, HOJA)).not.toThrow();
    expect(() => validarLecturaDeHoja(AUDITOR, HOJA)).not.toThrow();
  });
});

describe('escritura: mas estricta que la lectura', () => {
  it('solo escribe quien tiene la hoja asignada', () => {
    expect(() => validarEscrituraDeHoja(CONTADOR, HOJA)).not.toThrow();
    expect(() => validarEscrituraDeHoja(OTRO_CONTADOR, HOJA)).toThrow(Prohibido);
  });

  it('un coordinador NO escribe sobre una hoja que no es suya, aunque pueda leerla', () => {
    // El inventario se audita: "quien conto esto" tiene que tener respuesta.
    // Tener mas jerarquia no lo pone frente a la gondola.
    expect(() => validarLecturaDeHoja(COORDINADOR, HOJA)).not.toThrow();
    expect(() => validarEscrituraDeHoja(COORDINADOR, HOJA)).toThrow(Prohibido);
  });

  it('el administrador tampoco escribe sobre una hoja ajena', () => {
    expect(() => validarEscrituraDeHoja(ADMIN, HOJA)).toThrow(Prohibido);
  });
});
