import { describe, expect, it } from 'vitest';
import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import type { EstadoInventario } from '../historial/historial.permisos';
import {
  inventarioCerrado,
  puedeVerLaMatriz,
  validarAccesoALaMatriz,
  validarSucursal,
} from './auditoria.permisos';

const admin: ColaboradorAutenticado = { colaboradorId: 1, sucursalId: null, rol: 'administrador' };
const gilmer: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const jose: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
const maria: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };
const deOtraTienda: ColaboradorAutenticado = { colaboradorId: 203, sucursalId: 2, rol: 'auditor' };

const inv = (estado: EstadoInventario, sucursalId = 1): { sucursalId: number; estado: EstadoInventario } => ({
  sucursalId,
  estado,
});

describe('el rol conteo NUNCA ve la matriz', () => {
  // No es un permiso de mas: la matriz contiene stockErp, que es el numero
  // que los 3 conteos cruzados existen para no conocer.
  it.each<EstadoInventario>(['en_curso', 'conteo_cerrado', 'liquidado', 'lacrado'])(
    'rechazado con el inventario en estado %s',
    (estado) => {
      expect(() => validarAccesoALaMatriz(maria, inv(estado))).toThrow(Prohibido);
    },
  );

  it('el mensaje explica el conteo ciego, no dice solo "prohibido"', () => {
    expect(() => validarAccesoALaMatriz(maria, inv('lacrado'))).toThrow(/conteo es ciego/i);
  });
});

describe('auditor y administrador ven la matriz en cualquier estado', () => {
  it.each<EstadoInventario>(['en_curso', 'conteo_cerrado', 'liquidado', 'lacrado'])(
    'el auditor entra con el inventario en %s',
    (estado) => {
      // Auditar mientras se cuenta es literalmente su trabajo: la 3ra ronda
      // es suya.
      expect(() => validarAccesoALaMatriz(gilmer, inv(estado))).not.toThrow();
    },
  );

  it('el administrador entra a cualquier sucursal', () => {
    expect(() => validarAccesoALaMatriz(admin, inv('en_curso', 9))).not.toThrow();
  });
});

describe('EL COORDINADOR: solo inventarios ya cerrados', () => {
  it('NO ve la matriz del inventario EN CURSO', () => {
    // Es quien asigna hojas y habla con los once contadores: si ve el stock
    // del ERP con el ciclo abierto, alcanza con decir el numero en voz alta
    // para que el inventario "cuadre" sin haberse contado.
    expect(() => validarAccesoALaMatriz(jose, inv('en_curso'))).toThrow(Prohibido);
  });

  it('el mensaje le dice que va a poder verla al cerrar, no solo que no puede', () => {
    expect(() => validarAccesoALaMatriz(jose, inv('en_curso'))).toThrow(/cuando el conteo cierre/i);
  });

  it.each<EstadoInventario>(['conteo_cerrado', 'liquidado', 'lacrado'])(
    'SI la ve cuando el inventario esta en %s',
    (estado) => {
      // Cerrado el ciclo, las cantidades estan fijas y ya no hay nada que
      // contaminar: la razon para bloquearlo desaparece.
      expect(() => validarAccesoALaMatriz(jose, inv(estado))).not.toThrow();
    },
  );

  it('nunca ve la de otra sucursal, ni siquiera cerrada', () => {
    expect(() => validarAccesoALaMatriz(jose, inv('lacrado', 2))).toThrow(Prohibido);
  });
});

describe('alcance por sucursal', () => {
  it('un auditor no entra al inventario de otra tienda', () => {
    expect(() => validarAccesoALaMatriz(deOtraTienda, inv('lacrado', 1))).toThrow(Prohibido);
  });

  it('validarSucursal deja pasar al administrador, que no tiene sucursal', () => {
    expect(() => validarSucursal(admin, 4)).not.toThrow();
  });

  it('validarSucursal corta a los otros roles fuera de la suya', () => {
    expect(() => validarSucursal(gilmer, 2)).toThrow(Prohibido);
    expect(() => validarSucursal(gilmer, 1)).not.toThrow();
  });
});

describe('inventarioCerrado', () => {
  it('en_curso no esta cerrado', () => {
    expect(inventarioCerrado('en_curso')).toBe(false);
  });

  it('anulado tampoco cuenta como cerrado: no produce resultado', () => {
    expect(inventarioCerrado('anulado')).toBe(false);
  });

  it.each<EstadoInventario>(['conteo_cerrado', 'liquidado', 'lacrado'])('%s si', (estado) => {
    expect(inventarioCerrado(estado)).toBe(true);
  });
});

describe('puedeVerLaMatriz (para marcar el listado sin tirar)', () => {
  it('responde false en vez de lanzar', () => {
    expect(puedeVerLaMatriz(jose, inv('en_curso'))).toBe(false);
    expect(puedeVerLaMatriz(jose, inv('lacrado'))).toBe(true);
    expect(puedeVerLaMatriz(maria, inv('lacrado'))).toBe(false);
    expect(puedeVerLaMatriz(gilmer, inv('en_curso'))).toBe(true);
  });
});
