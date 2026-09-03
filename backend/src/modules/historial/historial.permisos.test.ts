import { describe, expect, it } from 'vitest';
import { Conflicto, Prohibido, SolicitudInvalida } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import {
  resolverSucursalConsultable,
  validarAccesoAInventario,
  validarPeriodo,
  validarPuedeAprobar,
  validarPuedeLacrar,
  verificarNoLacrado,
  type EstadoInventario,
} from './historial.permisos';

const admin: ColaboradorAutenticado = { colaboradorId: 1, sucursalId: null, rol: 'administrador' };
const gilmer: ColaboradorAutenticado = { colaboradorId: 12, sucursalId: 1, rol: 'auditor' };
const rosa: ColaboradorAutenticado = { colaboradorId: 30, sucursalId: 1, rol: 'auditor' };
const auditorOtraTienda: ColaboradorAutenticado = { colaboradorId: 40, sucursalId: 2, rol: 'auditor' };
const contador: ColaboradorAutenticado = { colaboradorId: 50, sucursalId: 1, rol: 'conteo' };
const coordinador: ColaboradorAutenticado = { colaboradorId: 60, sucursalId: 1, rol: 'coordinador' };

const inventario = (estado: EstadoInventario, sucursalId = 1): { sucursalId: number; estado: EstadoInventario } => ({
  sucursalId,
  estado,
});

// ---------------------------------------------------------------------------
// Alcance de lectura: conteo ciego
// ---------------------------------------------------------------------------

describe('resolverSucursalConsultable', () => {
  it('el administrador ve todo cuando no filtra', () => {
    expect(resolverSucursalConsultable(admin, undefined)).toBeUndefined();
  });

  it('el administrador puede filtrar por la sucursal que quiera', () => {
    expect(resolverSucursalConsultable(admin, 3)).toBe(3);
  });

  it('el auditor queda recortado a SU sucursal aunque no pida filtro', () => {
    expect(resolverSucursalConsultable(gilmer, undefined)).toBe(1);
  });

  it('el auditor no puede espiar otra tienda pidiendo otro sucursalId', () => {
    // Se ignora el query param en vez de tirar 403: pedir "todas" desde una
    // cuenta de auditor es la UI mandando su filtro por defecto, no un ataque.
    expect(resolverSucursalConsultable(gilmer, 2)).toBe(1);
  });

  it('un contador NO entra al historico: es la regla de conteo ciego', () => {
    expect(() => resolverSucursalConsultable(contador, undefined)).toThrow(Prohibido);
  });

  it('un coordinador tampoco entra al historico', () => {
    expect(() => resolverSucursalConsultable(coordinador, undefined)).toThrow(Prohibido);
  });

  it('un auditor sin sucursal no recibe el historico entero por las dudas', () => {
    const roto: ColaboradorAutenticado = { colaboradorId: 99, sucursalId: null, rol: 'auditor' };
    expect(() => resolverSucursalConsultable(roto, undefined)).toThrow(Prohibido);
  });
});

describe('validarAccesoAInventario', () => {
  it('el administrador entra a cualquier inventario', () => {
    expect(() => validarAccesoAInventario(admin, { sucursalId: 9 })).not.toThrow();
  });

  it('el auditor entra al de su sucursal', () => {
    expect(() => validarAccesoAInventario(gilmer, { sucursalId: 1 })).not.toThrow();
  });

  it('el auditor NO entra al de otra sucursal', () => {
    expect(() => validarAccesoAInventario(gilmer, { sucursalId: 2 })).toThrow(Prohibido);
  });

  it('un contador no entra ni al de su propia sucursal', () => {
    expect(() => validarAccesoAInventario(contador, { sucursalId: 1 })).toThrow(Prohibido);
  });
});

// ---------------------------------------------------------------------------
// Inmutabilidad
// ---------------------------------------------------------------------------

describe('verificarNoLacrado', () => {
  it('deja pasar un inventario en curso o con el conteo cerrado', () => {
    expect(() => verificarNoLacrado({ estado: 'en_curso' }, 'editar')).not.toThrow();
    expect(() => verificarNoLacrado({ estado: 'conteo_cerrado' }, 'editar')).not.toThrow();
  });

  it('bloquea cualquier accion sobre un inventario lacrado', () => {
    expect(() => verificarNoLacrado({ estado: 'lacrado' }, 'editar')).toThrow(Conflicto);
  });

  it('el mensaje explica que el ajuste va al periodo siguiente', () => {
    expect(() => verificarNoLacrado({ estado: 'lacrado' }, 'editar')).toThrow(/periodo siguiente/);
  });

  it('bloquea tambien un inventario anulado', () => {
    expect(() => verificarNoLacrado({ estado: 'anulado' }, 'editar')).toThrow(Conflicto);
  });
});

// ---------------------------------------------------------------------------
// EL CONTROL DE DOS PERSONAS
// ---------------------------------------------------------------------------

describe('validarPuedeAprobar', () => {
  it('un auditor de la sucursal puede firmar un inventario con el conteo cerrado', () => {
    expect(() => validarPuedeAprobar(gilmer, inventario('conteo_cerrado'), [])).not.toThrow();
  });

  it('tambien se puede firmar cuando ya esta liquidado', () => {
    expect(() => validarPuedeAprobar(gilmer, inventario('liquidado'), [])).not.toThrow();
  });

  it('LA MISMA PERSONA NO COMPLETA EL PAR: la segunda firma la da otro', () => {
    // El corazon del control de dos personas. Gilmer ya firmo; si pudiera
    // firmar de nuevo cerraria el mes solo y la doble validacion seria un
    // boton doble.
    expect(() => validarPuedeAprobar(gilmer, inventario('conteo_cerrado'), [{ aprobadorId: gilmer.colaboradorId }])).toThrow(
      Conflicto,
    );
  });

  it('el mensaje le dice que la otra firma va desde otra sesion', () => {
    expect(() =>
      validarPuedeAprobar(gilmer, inventario('conteo_cerrado'), [{ aprobadorId: gilmer.colaboradorId }]),
    ).toThrow(/OTRA persona/);
  });

  it('OTRA persona SI puede dar la segunda firma', () => {
    expect(() =>
      validarPuedeAprobar(rosa, inventario('conteo_cerrado'), [{ aprobadorId: gilmer.colaboradorId }]),
    ).not.toThrow();
  });

  it('no se firma un inventario que todavia se esta contando', () => {
    // Firmar un resultado que todavia puede cambiar no valida nada.
    expect(() => validarPuedeAprobar(gilmer, inventario('en_curso'), [])).toThrow(Conflicto);
  });

  it('no se firma un inventario ya lacrado', () => {
    expect(() => validarPuedeAprobar(gilmer, inventario('lacrado'), [])).toThrow(Conflicto);
  });

  it('no se firma un inventario anulado', () => {
    expect(() => validarPuedeAprobar(gilmer, inventario('anulado'), [])).toThrow(Conflicto);
  });

  it('un auditor de otra tienda no firma este cierre', () => {
    expect(() => validarPuedeAprobar(auditorOtraTienda, inventario('conteo_cerrado', 1), [])).toThrow(Prohibido);
  });

  it('un contador no firma el cierre', () => {
    expect(() => validarPuedeAprobar(contador, inventario('conteo_cerrado'), [])).toThrow(Prohibido);
  });

  it('un coordinador tampoco firma el cierre hoy (ver ROLES_QUE_APRUEBAN_CIERRE)', () => {
    expect(() => validarPuedeAprobar(coordinador, inventario('conteo_cerrado'), [])).toThrow(Prohibido);
  });

  it('no se agrega una tercera firma sobre un par ya completo', () => {
    expect(() =>
      validarPuedeAprobar(admin, inventario('conteo_cerrado'), [{ aprobadorId: 12 }, { aprobadorId: 30 }]),
    ).toThrow(Conflicto);
  });
});

describe('validarPuedeLacrar', () => {
  const listo = { sucursalId: 1, estado: 'liquidado' as EstadoInventario, yaLacrado: false, todoSincronizado: true };
  const dosFirmas = [{ aprobadorId: 12 }, { aprobadorId: 30 }];

  it('con dos firmas de personas distintas se puede lacrar', () => {
    expect(() => validarPuedeLacrar(gilmer, listo, dosFirmas)).not.toThrow();
  });

  it('SIN DOS APROBACIONES NO SE LACRA', () => {
    expect(() => validarPuedeLacrar(gilmer, listo, [{ aprobadorId: 12 }])).toThrow(Conflicto);
  });

  it('sin ninguna aprobacion tampoco', () => {
    expect(() => validarPuedeLacrar(gilmer, listo, [])).toThrow(Conflicto);
  });

  it('dos firmas de LA MISMA persona no valen como par', () => {
    // Cinturon y tiradores: la base ya lo impide con
    // @@unique([inventarioId, aprobadorId]), pero esta es la ultima puerta
    // antes de un cierre irreversible y no confia en que el indice este.
    expect(() => validarPuedeLacrar(gilmer, listo, [{ aprobadorId: 12 }, { aprobadorId: 12 }])).toThrow(Conflicto);
  });

  it('el mensaje dice cuantas firmas distintas hay', () => {
    expect(() => validarPuedeLacrar(gilmer, listo, [{ aprobadorId: 12 }])).toThrow(/hay 1/);
  });

  it('un inventario ya lacrado no se vuelve a lacrar', () => {
    expect(() => validarPuedeLacrar(gilmer, { ...listo, yaLacrado: true }, dosFirmas)).toThrow(Conflicto);
  });

  it('un inventario todavia en curso no se lacra ni con dos firmas', () => {
    expect(() => validarPuedeLacrar(gilmer, { ...listo, estado: 'en_curso' }, dosFirmas)).toThrow(Conflicto);
  });

  it('un auditor de otra tienda no lacra este inventario', () => {
    expect(() => validarPuedeLacrar(auditorOtraTienda, listo, dosFirmas)).toThrow(Prohibido);
  });

  it('un contador no lacra', () => {
    expect(() => validarPuedeLacrar(contador, listo, dosFirmas)).toThrow(Prohibido);
  });

  it('NO SE LACRA con hojas todavia sin sincronizar', () => {
    // "No se puede lacrar con datos que no llegaron a Dynamics" -- el sello
    // es inmutable, asi que un conteo que no subio a tiempo ya no entra nunca.
    expect(() => validarPuedeLacrar(gilmer, { ...listo, todoSincronizado: false }, dosFirmas)).toThrow(Conflicto);
  });

  it('el mensaje de sincronizacion dice que se puede reintentar, no que fallo algo', () => {
    expect(() => validarPuedeLacrar(gilmer, { ...listo, todoSincronizado: false }, dosFirmas)).toThrow(
      /volvé a intentar/i,
    );
  });

  it('la falta de aprobaciones se reporta ANTES que la sincronizacion', () => {
    // Prioridad deliberada: la sincronizacion se resuelve sola esperando la
    // WiFi; las firmas no. Primero se le dice a la persona lo que SI tiene
    // que ir a hacer.
    expect(() =>
      validarPuedeLacrar(gilmer, { ...listo, todoSincronizado: false }, [{ aprobadorId: 12 }]),
    ).toThrow(/Faltan aprobaciones/);
  });
});

describe('validarPeriodo', () => {
  it('acepta un mes calendario valido', () => {
    expect(() => validarPeriodo(2026, 8)).not.toThrow();
  });

  it('rechaza el mes 0 y el 13', () => {
    expect(() => validarPeriodo(2026, 0)).toThrow(SolicitudInvalida);
    expect(() => validarPeriodo(2026, 13)).toThrow(SolicitudInvalida);
  });

  it('rechaza anios fuera de rango y no enteros', () => {
    expect(() => validarPeriodo(1999, 8)).toThrow(SolicitudInvalida);
    expect(() => validarPeriodo(2026.5, 8)).toThrow(SolicitudInvalida);
  });
});
