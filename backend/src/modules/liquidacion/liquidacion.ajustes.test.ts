/**
 * Los ajustes del mes: lo que queda de este archivo es LECTURA.
 *
 * `PUT /ajustes` (y `registrarAjustes`) se borraron el 2026-09-14: los ajustes
 * a favor del personal entran por el Excel de Dynamics
 * (liquidacion.ajustes-negativos.ts), el faltante de empresa lo calcula la
 * clasificación, y la nota que quedaba no la leía nada más. La guarda de
 * `liquidar` solo mira `montoNegativos` (liquidacion.cierre.ts), que escribe el
 * Excel.
 *
 * Lo que este archivo sigue protegiendo:
 *  - `estadoDeAjustes`: quién puede leer y qué dice, incluidas las notas que
 *    ese endpoint dejó en inventarios viejos -- se siguen leyendo igual;
 *  - `validarEstadoParaAjustar`: las fronteras de estado que usa el Excel.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findUnique: vi.fn() },
  resultadoInventario: { findUnique: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import * as modulo from './liquidacion.ajustes';
import { estadoDeAjustes, validarEstadoParaAjustar } from './liquidacion.ajustes';

// La liquidación es del auditor desde 2026-09-11 (liquidacion.permisos.ts).
// Sin tienda en la ficha: entra por "administradores" y audita toda la cadena.
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: null, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 8, sucursalId: 1, rol: 'coordinador' };

const decimal = (v: number) => ({ toNumber: () => v });

function mockInventario(parcial: Record<string, unknown> = {}): void {
  prismaMock.inventario.findUnique.mockResolvedValue({
    id: 9,
    sucursalId: 1,
    estado: 'conteo_cerrado',
    resultado: { id: 3 },
    ...parcial,
  });
}

/** Lo que dejó PUT /ajustes en un inventario de antes del 2026-09-14: la nota, quién y cuándo. */
const VIEJO_CON_NOTA = {
  montoNegativos: decimal(380),
  montoFaltanteEmpresa: decimal(170),
  ajustesNota: 'Mermas documentadas de agosto.',
  ajustesEn: new Date('2026-09-05T12:00:00.000Z'),
  ajustesPor: { id: 5, nombre: 'Nancy Quispe' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInventario();
});

describe('PUT /ajustes se borró: ya no hay forma de escribir la nota', () => {
  it('el módulo ya no exporta registrarAjustes', () => {
    expect('registrarAjustes' in modulo).toBe(false);
  });
});

describe('validarEstadoParaAjustar: pura, sin Prisma (la usa el Excel de ajustes)', () => {
  it('conteo_cerrado con resultado no tira nada', () => {
    expect(() => validarEstadoParaAjustar({ estado: 'conteo_cerrado', resultado: { id: 1 } })).not.toThrow();
  });

  it('en_curso rechaza', () => {
    expect(() => validarEstadoParaAjustar({ estado: 'en_curso', resultado: { id: 1 } })).toThrow(/conteo sigue abierto/);
  });

  it('liquidado y lacrado rechazan igual', () => {
    expect(() => validarEstadoParaAjustar({ estado: 'liquidado', resultado: { id: 1 } })).toThrow(/ya se cerró/);
    expect(() => validarEstadoParaAjustar({ estado: 'lacrado', resultado: { id: 1 } })).toThrow(/ya se cerró/);
  });

  it('sin resultado calculado rechaza', () => {
    expect(() => validarEstadoParaAjustar({ estado: 'conteo_cerrado', resultado: null })).toThrow(/no tiene resultado/);
  });
});

describe('estadoDeAjustes: qué muestra la pantalla', () => {
  it('el inventario que no existe es 404', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue(null);
    await expect(estadoDeAjustes(AUDITOR, 9)).rejects.toThrow('no existe');
  });

  it('el coordinador tampoco LEE los ajustes: el 403 vale también para mirar', async () => {
    await expect(estadoDeAjustes(COORDINADOR, 9)).rejects.toThrow(Prohibido);
    expect(prismaMock.resultadoInventario.findUnique).not.toHaveBeenCalled();
  });

  it('sin importar todavía: registrado false y todo en null', async () => {
    prismaMock.resultadoInventario.findUnique.mockResolvedValue({
      montoNegativos: null,
      montoFaltanteEmpresa: decimal(170),
      ajustesNota: null,
      ajustesEn: null,
      ajustesPor: null,
    });

    const estado = await estadoDeAjustes(AUDITOR, 9);
    expect(estado.registrado).toBe(false);
    expect(estado.montoNegativos).toBeNull();
    expect(estado.registradoPor).toBeNull();
  });

  it('lo que haya importado el Excel se ve, sin que este archivo lo escriba', async () => {
    prismaMock.resultadoInventario.findUnique.mockResolvedValue({ ...VIEJO_CON_NOTA, montoNegativos: decimal(45) });

    const estado = await estadoDeAjustes(AUDITOR, 9);
    expect(estado.montoNegativos).toBe(45);
  });

  /**
   * LOS DATOS VIEJOS SE SIGUEN LEYENDO IGUAL: las columnas `ajustes*` no se
   * borraron -- solo dejó de existir el endpoint que las escribía.
   */
  it('un inventario VIEJO, con la nota que dejó PUT /ajustes: monto, nota, quién y cuándo, tal cual', async () => {
    prismaMock.resultadoInventario.findUnique.mockResolvedValue(VIEJO_CON_NOTA);

    const estado = await estadoDeAjustes(AUDITOR, 9);
    expect(estado).toMatchObject({
      registrado: true,
      montoNegativos: 380,
      nota: 'Mermas documentadas de agosto.',
      registradoPor: { id: 5, nombre: 'Nancy Quispe' },
      registradoEn: '2026-09-05T12:00:00.000Z',
    });
  });

  it('un 0 importado cuenta como REGISTRADO: 0 no es "sin importar"', async () => {
    prismaMock.resultadoInventario.findUnique.mockResolvedValue({ ...VIEJO_CON_NOTA, montoNegativos: decimal(0) });

    const estado = await estadoDeAjustes(AUDITOR, 9);
    expect(estado.registrado).toBe(true);
    expect(estado.montoNegativos).toBe(0);
  });

  it('sin resultado todavía no revienta: devuelve no registrado', async () => {
    prismaMock.resultadoInventario.findUnique.mockResolvedValue(null);

    const estado = await estadoDeAjustes(AUDITOR, 9);
    expect(estado.registrado).toBe(false);
  });
});
