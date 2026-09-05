/**
 * Tests del cierre de la planilla.
 *
 * Dos capas separadas, como el resto del proyecto: `armarPlanilla` es puro y
 * se prueba sin base (es donde vive la plata de cada persona), y `liquidar`
 * se prueba con Prisma mockeado (es donde viven las guardas y la
 * transaccion).
 *
 * Lo que estos tests protegen, en una linea: que nadie firme un descuento
 * calculado sobre un dato que no existe.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findUnique: vi.fn(), update: vi.fn() },
  colaborador: { findMany: vi.fn() },
  liquidacionColaborador: { createMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn() }));

import { calcularTotalDescuento } from '../historial/historial.calculos';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { armarPlanilla, liquidar, type ColaboradorParaLiquidar } from './liquidacion.cierre';

const COORD: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: 1, rol: 'coordinador' };
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 8, sucursalId: 1, rol: 'auditor' };

const decimal = (valor: number) => ({ toNumber: () => valor });

/** Los 11 colaboradores del ejemplo real de la reunión. */
const equipo = (cantidad: number): ColaboradorParaLiquidar[] =>
  Array.from({ length: cantidad }, (_, i) => ({
    id: i + 1,
    nombre: `Colaborador ${i + 1}`,
    rol: 'conteo' as const,
  }));

// ---------------------------------------------------------------------------
// armarPlanilla -- puro
// ---------------------------------------------------------------------------

describe('armarPlanilla', () => {
  it('una fila por persona alcanzada, no solo por quien asistió', () => {
    // Quien faltó también entra en la planilla: su fila es la que lleva la
    // multa. Dejarlo afuera sería no cobrársela.
    const filas = armarPlanilla({
      colaboradores: equipo(11),
      idsQueAsistieron: [1, 2, 3, 4, 5, 6, 7],
      cuotaBase: 126.36,
      multaInasistencia: 20,
      fondoMultas: 80,
    });
    expect(filas).toHaveLength(11);
    expect(filas.filter((f) => f.asistio)).toHaveLength(7);
  });

  it('quien asistió no paga multa; quien faltó no cobra bono', () => {
    const filas = armarPlanilla({
      colaboradores: equipo(11),
      idsQueAsistieron: [1, 2, 3, 4, 5, 6, 7],
      cuotaBase: 126.36,
      multaInasistencia: 20,
      fondoMultas: 80,
    });

    for (const fila of filas) {
      if (fila.asistio) {
        expect(fila.multaInasistencia).toBe(0);
        expect(fila.bonoAsistencia).toBeGreaterThan(0);
      } else {
        expect(fila.multaInasistencia).toBe(20);
        expect(fila.bonoAsistencia).toBe(0);
      }
    }
  });

  /**
   * EL CASO REAL DE LA REUNIÓN: 11 personas, 4 faltas, S/80 entre 7.
   * `redondear(80 / 7)` da 11.43 y repartía S/80.01 -- la empresa ponía un
   * centavo. Ver dominio/reparto-de-fondo.ts.
   */
  it('la suma de los bonos da EXACTAMENTE el fondo de multas', () => {
    const filas = armarPlanilla({
      colaboradores: equipo(11),
      idsQueAsistieron: [1, 2, 3, 4, 5, 6, 7],
      cuotaBase: 126.36,
      multaInasistencia: 20,
      fondoMultas: 80,
    });

    const repartido = filas.reduce((total, f) => total + Math.round(f.bonoAsistencia * 100), 0);
    expect(repartido).toBe(8000); // S/80.00 al centavo, no 80.01
  });

  it('el centavo de más va por id ascendente, no por el orden de la lista', () => {
    // Si dependiera del orden en que vino la query, la misma liquidación
    // daría distinto en dos corridas. Un centavo que se mueve solo hace
    // dudar del cálculo entero.
    const alReves = [...equipo(3)].reverse();
    const filas = armarPlanilla({
      colaboradores: alReves,
      idsQueAsistieron: [1, 2, 3],
      cuotaBase: 10,
      multaInasistencia: 20,
      fondoMultas: 1, // 100 centavos entre 3: 34/33/33
    });

    const porId = new Map(filas.map((f) => [f.colaboradorId, f.bonoAsistencia]));
    expect(porId.get(1)).toBe(0.34);
    expect(porId.get(2)).toBe(0.33);
    expect(porId.get(3)).toBe(0.33);
  });

  it('NO guarda el total: solo las tres partes', () => {
    // Misma regla que deja a Conteo sin columna `total`. Un total guardado
    // al lado de sus partes puede desincronizarse, y ahí hay dos verdades.
    const [fila] = armarPlanilla({
      colaboradores: equipo(1),
      idsQueAsistieron: [1],
      cuotaBase: 100,
      multaInasistencia: 20,
      fondoMultas: 0,
    });
    expect(fila).not.toHaveProperty('monto');
    expect(fila).not.toHaveProperty('total');
    expect(calcularTotalDescuento(fila!)).toBe(100);
  });

  it('congela nombre y rol del momento de liquidar', () => {
    const [fila] = armarPlanilla({
      colaboradores: [{ id: 1, nombre: 'Nancy Quispe', rol: 'coordinador' }],
      idsQueAsistieron: [1],
      cuotaBase: 50,
      multaInasistencia: 20,
      fondoMultas: 0,
    });
    expect(fila?.nombreAlLiquidar).toBe('Nancy Quispe');
    expect(fila?.rolAlLiquidar).toBe('coordinador');
  });

  it('si no fue NADIE, nadie cobra bono y todos pagan multa', () => {
    // Caso degenerado (si no fue nadie tampoco hubo inventario), pero no
    // puede reventar ni inventar un destinatario para el fondo.
    const filas = armarPlanilla({
      colaboradores: equipo(3),
      idsQueAsistieron: [],
      cuotaBase: 10,
      multaInasistencia: 20,
      fondoMultas: 60,
    });
    expect(filas.every((f) => f.bonoAsistencia === 0)).toBe(true);
    expect(filas.every((f) => f.multaInasistencia === 20)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// liquidar -- contra la base
// ---------------------------------------------------------------------------

const resultadoCompleto = {
  montoFaltanteBruto: decimal(1500),
  montoNegativos: decimal(100),
  montoFaltanteEmpresa: decimal(10),
  colaboradoresAlcanzados: 11,
  colaboradoresAsistieron: 7,
  multaInasistencia: decimal(20),
};

function mockInventario(parcial: Record<string, unknown> = {}): void {
  prismaMock.inventario.findUnique.mockResolvedValue({
    id: 9,
    sucursalId: 1,
    estado: 'conteo_cerrado',
    resultado: resultadoCompleto,
    ...parcial,
  });
}

describe('liquidar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInventario();
    prismaMock.colaborador.findMany.mockResolvedValue(
      equipo(11).map((c) => ({ id: c.id, nombre: c.nombre, rol: c.rol })),
    );
    prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : arg,
    );
  });

  it('el inventario que no existe es 404', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue(null);
    await expect(liquidar(COORD, 9)).rejects.toThrow('no existe');
  });

  /**
   * EL AUDITOR NO LIQUIDA. Es quien firma el lacrado, y el sello incluye la
   * planilla: si cerrara la planilla y después la firmara, el control de dos
   * personas se completa solo.
   */
  it('el auditor NO puede liquidar, y el mensaje dice quién sí', async () => {
    await expect(liquidar(AUDITOR, 9)).rejects.toThrow(/coordinador/);
    expect(prismaMock.liquidacionColaborador.createMany).not.toHaveBeenCalled();
  });

  it('el coordinador de otra sucursal no puede', async () => {
    await expect(liquidar({ ...COORD, sucursalId: 2 }, 9)).rejects.toThrow('no es la tuya');
  });

  it('con el conteo todavía abierto rechaza y dice qué falta', async () => {
    mockInventario({ estado: 'en_curso' });
    await expect(liquidar(COORD, 9)).rejects.toThrow(/cerrar la ultima ronda/);
  });

  it('no se reliquida: un inventario ya liquidado da 409', async () => {
    // El recibo de sueldo de ese mes ya salió. Recalcular con el padrón de
    // hoy daría otro número para un pago que ya se hizo.
    mockInventario({ estado: 'liquidado' });
    await expect(liquidar(COORD, 9)).rejects.toThrow(/ya se cerro/);
    expect(prismaMock.liquidacionColaborador.createMany).not.toHaveBeenCalled();
  });

  it('un inventario lacrado tampoco se reliquida', async () => {
    mockInventario({ estado: 'lacrado' });
    await expect(liquidar(COORD, 9)).rejects.toThrow(/ya se cerro/);
  });

  /**
   * LA GUARDA QUE HOY CORTA SIEMPRE, y que es el punto de todo esto: NULL es
   * "no se capturó", nunca "cero". Escribir la planilla igual sería
   * descontarle a alguien un monto calculado sobre un dato que nadie cargó.
   */
  describe('sin los datos que nadie capturó todavía', () => {
    it('sin asistencia registrada NO escribe la planilla', async () => {
      mockInventario({ resultado: { ...resultadoCompleto, colaboradoresAsistieron: null } });

      await expect(liquidar(COORD, 9)).rejects.toThrow(/asistencia/);
      expect(prismaMock.liquidacionColaborador.createMany).not.toHaveBeenCalled();
      expect(prismaMock.inventario.update).not.toHaveBeenCalled();
    });

    it('sin los ajustes del mes tampoco', async () => {
      mockInventario({ resultado: { ...resultadoCompleto, montoNegativos: null } });

      await expect(liquidar(COORD, 9)).rejects.toThrow(/ajustes del mes/);
      expect(prismaMock.liquidacionColaborador.createMany).not.toHaveBeenCalled();
    });

    it('el mensaje explica la consecuencia, no solo que no se puede', async () => {
      mockInventario({ resultado: { ...resultadoCompleto, colaboradoresAsistieron: null } });
      await expect(liquidar(COORD, 9)).rejects.toThrow(/nadie cargo/);
    });

    it('sin resultado calculado avisa antes de firmar nada', async () => {
      mockInventario({ resultado: null });
      await expect(liquidar(COORD, 9)).rejects.toThrow(/no tiene resultado/);
    });
  });

  describe('con todos los datos cargados', () => {
    beforeEach(() => {
      // Se fuerza el escenario completo: es el que existirá cuando haya
      // mecanismo de captura de asistencia. Hoy la guarda de arriba corta
      // antes -- por eso estos tests son los que quedan listos para ese día.
      mockInventario();
    });

    it('escribe una fila por colaborador alcanzado', async () => {
      await liquidar(COORD, 9);

      const { data } = prismaMock.liquidacionColaborador.createMany.mock.calls[0]![0] as { data: unknown[] };
      expect(data).toHaveLength(11);
    });

    it('el universo es el MISMO que colaboradoresAlcanzados', async () => {
      // Si estas dos consultas no coinciden, la cuota por persona no cierra
      // contra el faltante neto y nadie entiende por qué.
      await liquidar(COORD, 9);

      expect(prismaMock.colaborador.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sucursalId: 1, activo: true } }),
      );
    });

    it('deja el inventario en liquidado', async () => {
      await liquidar(COORD, 9);

      expect(prismaMock.inventario.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: { estado: 'liquidado' },
      });
    });

    /**
     * Planilla y estado, o ninguno de los dos. Si el estado quedara en
     * `liquidado` sin las filas, el lacrado -- que ahora EXIGE ese estado --
     * sellaría la planilla vacía que este cambio existe para impedir.
     */
    it('planilla y estado van en la MISMA transacción', async () => {
      await liquidar(COORD, 9);

      const [arg] = prismaMock.$transaction.mock.calls[0] as [unknown];
      expect(Array.isArray(arg)).toBe(true);
      expect((arg as unknown[]).length).toBe(2);
    });

    it('si la transacción falla no queda nada, ni el registro de auditoría', async () => {
      prismaMock.$transaction.mockRejectedValue(new Error('conexión caída'));

      await expect(liquidar(COORD, 9)).rejects.toThrow('conexión caída');
      const { registrarAuditoria } = await import('../../shared/auditoria');
      expect(registrarAuditoria).not.toHaveBeenCalled();
    });

    it('el total descontado cuadra con la suma de la planilla', async () => {
      const cierre = await liquidar(COORD, 9);

      const { data } = prismaMock.liquidacionColaborador.createMany.mock.calls[0]![0] as {
        data: Array<{ cuotaBase: number; multaInasistencia: number; bonoAsistencia: number }>;
      };
      const suma = data.reduce((total, f) => total + calcularTotalDescuento(f), 0);
      expect(cierre.totalDescontado).toBeCloseTo(suma, 2);
    });
  });
});
