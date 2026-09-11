/**
 * Los ajustes del mes que siguen siendo manuales tras el cableado del Excel
 * de negativos (2026-09-11, ver liquidacion.ajustes-negativos.ts): el monto
 * de empresa y la nota. `montoNegativos` ya NO se carga por acá -- esos casos
 * (el 0 explícito incluido) se mudaron a `liquidacion.ajustes-negativos.test.ts`.
 *
 * Lo que este archivo sigue protegiendo: quién puede tocar los ajustes del
 * mes, y las dos fronteras de estado (`conteo_cerrado` únicamente).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findUnique: vi.fn() },
  resultadoInventario: { update: vi.fn(), findUnique: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn() }));

import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { estadoDeAjustes, registrarAjustes, validarEstadoParaAjustar } from './liquidacion.ajustes';

// La liquidación es del auditor desde 2026-09-11 (liquidacion.permisos.ts).
// Sin tienda en la ficha: entra por "administradores" y audita toda la cadena.
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: null, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 8, sucursalId: 1, rol: 'coordinador' };
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
    await expect(registrarAjustes(AUDITOR, 9, { nota: 'x' })).rejects.toThrow('no existe');
  });

  /**
   * DECISIÓN DEL CLIENTE (2026-09-11): la liquidación pasa al auditor, y
   * cargar los ajustes es parte de ella. Ver liquidacion.permisos.ts.
   */
  it('el coordinador YA NO carga ajustes, ni los de su tienda, y se corta antes de tocar la base', async () => {
    await expect(registrarAjustes(COORDINADOR, 9, { nota: 'x' })).rejects.toThrow(Prohibido);
    expect(prismaMock.inventario.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.resultadoInventario.update).not.toHaveBeenCalled();
  });

  it('el administrador tampoco: es técnico, no participa del proceso de inventario', async () => {
    await expect(registrarAjustes(ADMIN, 9, { nota: 'Mermas.' })).rejects.toThrow(Prohibido);
    expect(prismaMock.resultadoInventario.update).not.toHaveBeenCalled();
  });

  it('el auditor los carga en cualquier sucursal: audita toda la cadena', async () => {
    mockInventario({ sucursalId: 2 });
    await expect(registrarAjustes(AUDITOR, 9, { montoEmpresa: 170, nota: 'Mermas.' })).resolves.toMatchObject({
      montoFaltanteEmpresa: 170,
    });
  });

  it('guarda quién, cuándo y la nota, no solo el monto de empresa', async () => {
    // Un monto que baja el descuento de once personas no puede quedar sin
    // firma: la pregunta "¿por qué se corrigió el monto de empresa?" se
    // contesta con esto.
    await registrarAjustes(AUDITOR, 9, { montoEmpresa: 170, nota: 'Mermas documentadas de agosto.' });

    expect(prismaMock.resultadoInventario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { inventarioId: 9 },
        data: expect.objectContaining({
          montoFaltanteEmpresa: 170,
          ajustesPorId: 5,
          ajustesNota: 'Mermas documentadas de agosto.',
          ajustesEn: expect.any(Date),
        }),
      }),
    );
    // montoNegativos ya NO lo escribe este endpoint: lo escribe la
    // importación del Excel (liquidacion.ajustes-negativos.ts).
    const { data } = prismaMock.resultadoInventario.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data).not.toHaveProperty('montoNegativos');
  });

  it('la nota queda en el registro de auditoría, sin montoNegativos', async () => {
    await registrarAjustes(AUDITOR, 9, { montoEmpresa: 170, nota: 'Mermas.' });

    const { registrarAuditoria } = await import('../../shared/auditoria');
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'inventario.ajustes_registrados',
        detalle: expect.objectContaining({ montoEmpresa: 170, nota: 'Mermas.' }),
      }),
    );
    const { detalle } = (
      (await import('../../shared/auditoria')).registrarAuditoria as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0]![0] as { detalle: Record<string, unknown> };
    expect(detalle).not.toHaveProperty('montoNegativos');
  });
});

describe('estadoDeAjustes lee montoNegativos igual, venga de donde venga', () => {
  it('lo que haya importado el Excel se ve en estadoDeAjustes sin que este archivo lo escriba', async () => {
    prismaMock.resultadoInventario.findUnique.mockResolvedValue({ ...ACTUALIZADO, montoNegativos: decimal(45) });

    const estado = await estadoDeAjustes(AUDITOR, 9);
    expect(estado.montoNegativos).toBe(45);
  });
});

describe('montoEmpresa: solo se pisa si viene', () => {
  it('sin mandarlo, NO se toca el calculado al cerrar el conteo', async () => {
    // Sale de la matriz real (categorías marcadas `esEmpresa`). Pisarlo con
    // un 0 por omisión borraría ese cálculo sin que nadie lo pida.
    await registrarAjustes(AUDITOR, 9, { nota: 'x' });

    const { data } = prismaMock.resultadoInventario.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data).not.toHaveProperty('montoFaltanteEmpresa');
  });

  it('mandándolo, se guarda', async () => {
    await registrarAjustes(AUDITOR, 9, { montoEmpresa: 170, nota: 'x' });

    const { data } = prismaMock.resultadoInventario.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.montoFaltanteEmpresa).toBe(170);
  });

  it('un montoEmpresa en 0 SÍ se guarda: es distinto de omitirlo', async () => {
    await registrarAjustes(AUDITOR, 9, { montoEmpresa: 0, nota: 'x' });

    const { data } = prismaMock.resultadoInventario.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.montoFaltanteEmpresa).toBe(0);
  });
});

/**
 * Las dos fronteras: después de que las cantidades quedaron fijas, y antes de
 * que la planilla se firme. Compartidas con `liquidacion.ajustes-negativos.ts`
 * vía `validarEstadoParaAjustar` -- se prueban acá A FONDO y allá solo se
 * verifica que están conectadas.
 */
describe('solo en conteo_cerrado', () => {
  it('con el conteo abierto rechaza: el faltante todavía puede cambiar', async () => {
    mockInventario({ estado: 'en_curso' });
    await expect(registrarAjustes(AUDITOR, 9, { nota: 'x' })).rejects.toThrow(/conteo sigue abierto/);
  });

  it('ya liquidado rechaza: el recibo de sueldo ya salió', async () => {
    mockInventario({ estado: 'liquidado' });
    await expect(registrarAjustes(AUDITOR, 9, { nota: 'x' })).rejects.toThrow(/ya se cerró/);
  });

  it('lacrado rechaza', async () => {
    mockInventario({ estado: 'lacrado' });
    await expect(registrarAjustes(AUDITOR, 9, { nota: 'x' })).rejects.toThrow(/ya se cerró/);
  });

  it('sin resultado calculado rechaza: no hay faltante sobre el que ajustar', async () => {
    mockInventario({ resultado: null });
    await expect(registrarAjustes(AUDITOR, 9, { nota: 'x' })).rejects.toThrow(/no tiene resultado/);
  });

  it('se puede CORREGIR mientras siga en conteo_cerrado', async () => {
    // Una nota mal tipeada antes de liquidar tiene que poder arreglarse; la
    // corrección pisa la firma anterior y queda en auditoría.
    await registrarAjustes(AUDITOR, 9, { montoEmpresa: 170, nota: 'primera carga' });
    await registrarAjustes(AUDITOR, 9, { montoEmpresa: 200, nota: 'corregido: faltaba una merma' });

    expect(prismaMock.resultadoInventario.update).toHaveBeenCalledTimes(2);
  });
});

describe('validarEstadoParaAjustar: pura, sin Prisma', () => {
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

describe('estadoDeAjustes: qué muestra la pantalla antes de liquidar', () => {
  it('el coordinador tampoco LEE los ajustes: el 403 vale también para mirar', async () => {
    await expect(estadoDeAjustes(COORDINADOR, 9)).rejects.toThrow(Prohibido);
    expect(prismaMock.resultadoInventario.findUnique).not.toHaveBeenCalled();
  });

  it('sin cargar todavía: registrado false y todo en null', async () => {
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

  it('cargado: dice el monto, quién y cuándo', async () => {
    prismaMock.resultadoInventario.findUnique.mockResolvedValue(ACTUALIZADO);

    const estado = await estadoDeAjustes(AUDITOR, 9);
    expect(estado).toMatchObject({
      registrado: true,
      montoNegativos: 380,
      nota: 'Mermas documentadas de agosto.',
      registradoPor: { id: 5, nombre: 'Nancy Quispe' },
      registradoEn: '2026-09-05T12:00:00.000Z',
    });
  });

  it('un 0 cargado cuenta como REGISTRADO', async () => {
    // Es el caso entero: 0 no es "sin registrar". Ahora el 0 lo carga el
    // Excel (liquidacion.ajustes-negativos.ts), pero el criterio de lectura es el mismo.
    prismaMock.resultadoInventario.findUnique.mockResolvedValue({ ...ACTUALIZADO, montoNegativos: decimal(0) });

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
