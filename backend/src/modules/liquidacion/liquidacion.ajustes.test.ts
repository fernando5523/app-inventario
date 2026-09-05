/**
 * Los ajustes del mes: el eslabón que faltaba para poder cerrar el mes.
 *
 * Lo que estos tests protegen, en una línea: que un `0` cargado por una
 * persona destrabe la liquidación, y que el `NULL` que deja el cierre del
 * conteo NO lo haga. Toda la regla vive en esa diferencia.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findUnique: vi.fn() },
  resultadoInventario: { update: vi.fn(), findUnique: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn() }));

import type { ColaboradorAutenticado } from '../../shared/tipos';
import { estadoDeAjustes, registrarAjustes } from './liquidacion.ajustes';

const COORD: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: 1, rol: 'coordinador' };
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 8, sucursalId: 1, rol: 'auditor' };
const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };

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

const ACTUALIZADO = {
  montoNegativos: decimal(380),
  montoFaltanteEmpresa: decimal(170),
  ajustesNota: 'Mermas documentadas de agosto.',
  ajustesEn: new Date('2026-09-05T12:00:00.000Z'),
  ajustesPor: { id: 5, nombre: 'Nancy Quispe' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInventario();
  prismaMock.resultadoInventario.update.mockResolvedValue(ACTUALIZADO);
});

describe('registrarAjustes: quién y cuándo', () => {
  it('el inventario que no existe es 404', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue(null);
    await expect(registrarAjustes(COORD, 9, { montoNegativos: 0, nota: 'x' })).rejects.toThrow('no existe');
  });

  /**
   * El auditor firma el lacrado, y el sello incluye estos montos. Si pudiera
   * cargarlos Y firmarlos, decidiría solo cuánta plata no se descuenta.
   */
  it('el auditor NO carga ajustes: es quien después firma el sello que los incluye', async () => {
    await expect(registrarAjustes(AUDITOR, 9, { montoNegativos: 0, nota: 'x' })).rejects.toThrow(/coordinador/);
    expect(prismaMock.resultadoInventario.update).not.toHaveBeenCalled();
  });

  it('un coordinador de otra sucursal no puede', async () => {
    await expect(
      registrarAjustes({ ...COORD, sucursalId: 2 }, 9, { montoNegativos: 0, nota: 'x' }),
    ).rejects.toThrow('no es la tuya');
  });

  it('el administrador puede: no pertenece a ninguna tienda', async () => {
    await expect(registrarAjustes(ADMIN, 9, { montoNegativos: 380, nota: 'Mermas.' })).resolves.toMatchObject({
      montoNegativos: 380,
    });
  });

  it('guarda quién, cuándo y la nota, no solo el monto', async () => {
    // Un monto que baja el descuento de once personas no puede quedar sin
    // firma: la pregunta "¿por qué agosto tuvo S/380?" se contesta con esto.
    await registrarAjustes(COORD, 9, { montoNegativos: 380, nota: 'Mermas documentadas de agosto.' });

    expect(prismaMock.resultadoInventario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { inventarioId: 9 },
        data: expect.objectContaining({
          montoNegativos: 380,
          ajustesPorId: 5,
          ajustesNota: 'Mermas documentadas de agosto.',
          ajustesEn: expect.any(Date),
        }),
      }),
    );
  });

  it('el monto queda en el registro de auditoría', async () => {
    await registrarAjustes(COORD, 9, { montoNegativos: 380, nota: 'Mermas.' });

    const { registrarAuditoria } = await import('../../shared/auditoria');
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'inventario.ajustes_registrados',
        detalle: expect.objectContaining({ montoNegativos: 380 }),
      }),
    );
  });
});

/**
 * EL CASO QUE DESTRABA TODO. `0` cargado por una persona identificada, con
 * fecha y nota, significa "alguien miró y no había" -- y eso es un dato
 * verificado, no el cero cómodo que veníamos evitando.
 */
describe('el 0 explícito', () => {
  it('se persiste como 0, no se ignora por falsy', async () => {
    prismaMock.resultadoInventario.update.mockResolvedValue({ ...ACTUALIZADO, montoNegativos: decimal(0) });
    await registrarAjustes(COORD, 9, { montoNegativos: 0, nota: 'Revisado con Jocelyn: no hubo ajustes.' });

    const { data } = prismaMock.resultadoInventario.update.mock.calls[0]![0] as { data: { montoNegativos: number } };
    expect(data.montoNegativos).toBe(0);
  });

  it('deja el resultado con 0 y no con null: eso es lo que destraba liquidar', async () => {
    prismaMock.resultadoInventario.update.mockResolvedValue({ ...ACTUALIZADO, montoNegativos: decimal(0) });
    const dto = await registrarAjustes(COORD, 9, { montoNegativos: 0, nota: 'No hubo.' });

    expect(dto.montoNegativos).toBe(0);
    expect(dto.montoNegativos).not.toBeNull();
  });
});

describe('montoEmpresa: solo se pisa si viene', () => {
  it('sin mandarlo, NO se toca el calculado al cerrar el conteo', async () => {
    // Sale de la matriz real (categorías marcadas `esEmpresa`). Pisarlo con
    // un 0 por omisión borraría ese cálculo sin que nadie lo pida.
    await registrarAjustes(COORD, 9, { montoNegativos: 380, nota: 'x' });

    const { data } = prismaMock.resultadoInventario.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data).not.toHaveProperty('montoFaltanteEmpresa');
  });

  it('mandándolo, se guarda', async () => {
    await registrarAjustes(COORD, 9, { montoNegativos: 380, montoEmpresa: 170, nota: 'x' });

    const { data } = prismaMock.resultadoInventario.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.montoFaltanteEmpresa).toBe(170);
  });

  it('un montoEmpresa en 0 SÍ se guarda: es distinto de omitirlo', async () => {
    await registrarAjustes(COORD, 9, { montoNegativos: 380, montoEmpresa: 0, nota: 'x' });

    const { data } = prismaMock.resultadoInventario.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.montoFaltanteEmpresa).toBe(0);
  });
});

/**
 * Las dos fronteras: después de que las cantidades quedaron fijas, y antes de
 * que la planilla se firme.
 */
describe('solo en conteo_cerrado', () => {
  it('con el conteo abierto rechaza: el faltante todavía puede cambiar', async () => {
    mockInventario({ estado: 'en_curso' });
    await expect(registrarAjustes(COORD, 9, { montoNegativos: 0, nota: 'x' })).rejects.toThrow(/conteo sigue abierto/);
  });

  it('ya liquidado rechaza: el recibo de sueldo ya salió', async () => {
    mockInventario({ estado: 'liquidado' });
    await expect(registrarAjustes(COORD, 9, { montoNegativos: 0, nota: 'x' })).rejects.toThrow(/ya se cerró/);
  });

  it('lacrado rechaza', async () => {
    mockInventario({ estado: 'lacrado' });
    await expect(registrarAjustes(COORD, 9, { montoNegativos: 0, nota: 'x' })).rejects.toThrow(/ya se cerró/);
  });

  it('sin resultado calculado rechaza: no hay faltante sobre el que ajustar', async () => {
    mockInventario({ resultado: null });
    await expect(registrarAjustes(COORD, 9, { montoNegativos: 0, nota: 'x' })).rejects.toThrow(/no tiene resultado/);
  });

  it('se puede CORREGIR mientras siga en conteo_cerrado', async () => {
    // Un monto mal tipeado antes de liquidar tiene que poder arreglarse; la
    // corrección pisa la firma anterior y queda en auditoría.
    await registrarAjustes(COORD, 9, { montoNegativos: 380, nota: 'primera carga' });
    await registrarAjustes(COORD, 9, { montoNegativos: 420, nota: 'corregido: faltaba una merma' });

    expect(prismaMock.resultadoInventario.update).toHaveBeenCalledTimes(2);
  });
});

describe('estadoDeAjustes: qué muestra la pantalla antes de liquidar', () => {
  it('sin cargar todavía: registrado false y todo en null', async () => {
    prismaMock.resultadoInventario.findUnique.mockResolvedValue({
      montoNegativos: null,
      montoFaltanteEmpresa: decimal(170),
      ajustesNota: null,
      ajustesEn: null,
      ajustesPor: null,
    });

    const estado = await estadoDeAjustes(COORD, 9);
    expect(estado.registrado).toBe(false);
    expect(estado.montoNegativos).toBeNull();
    expect(estado.registradoPor).toBeNull();
  });

  it('cargado: dice el monto, quién y cuándo', async () => {
    prismaMock.resultadoInventario.findUnique.mockResolvedValue(ACTUALIZADO);

    const estado = await estadoDeAjustes(COORD, 9);
    expect(estado).toMatchObject({
      registrado: true,
      montoNegativos: 380,
      nota: 'Mermas documentadas de agosto.',
      registradoPor: { id: 5, nombre: 'Nancy Quispe' },
      registradoEn: '2026-09-05T12:00:00.000Z',
    });
  });

  it('un 0 cargado cuenta como REGISTRADO', async () => {
    // Es el caso entero: 0 no es "sin registrar".
    prismaMock.resultadoInventario.findUnique.mockResolvedValue({ ...ACTUALIZADO, montoNegativos: decimal(0) });

    const estado = await estadoDeAjustes(COORD, 9);
    expect(estado.registrado).toBe(true);
    expect(estado.montoNegativos).toBe(0);
  });

  it('sin resultado todavía no revienta: devuelve no registrado', async () => {
    prismaMock.resultadoInventario.findUnique.mockResolvedValue(null);

    const estado = await estadoDeAjustes(COORD, 9);
    expect(estado.registrado).toBe(false);
  });
});
