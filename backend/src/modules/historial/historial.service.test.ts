/**
 * REGRESION del bug reportado por min-3 con numeros exactos (2026-09-14):
 * bruto 130, negativos 40 (Excel), sobrante de empleado 50, una cerveza de
 * faltante 30. Antes de este fix, `historial.service.ts` (el detalle, el
 * listado y el comparativo) leia `ResultadoInventario.montoFaltanteEmpresa`
 * directo y nunca sumaba `montoSobranteEmpleado` -- mostrando un neto
 * distinto del que calculaba `liquidar()`/la pantalla de liquidacion.
 *
 * Estos tests cubren SOLO ese camino (el detalle) con Prisma mockeado, en el
 * mismo estilo que `liquidacion.service.test.ts`. El resto de
 * `historial.service.ts` no tiene tests unitarios propios -- se prueba via
 * `historial.routes.test.ts`, que mockea el CONTROLLER, no el service (ver
 * el hallazgo de cobertura en la revision cruzada).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  diferenciaItem: { findMany: vi.fn() },
  catalogoItem: { findMany: vi.fn() },
  clasificacionProducto: { findMany: vi.fn() },
  // Los usa `fondoYBonoReales`: el fondo de multas sale de la planilla
  // firmada si existe, y si no de las marcas de asistencia. Por defecto "no
  // hay planilla, no hay marcas" -- cada test que le importe los llena.
  liquidacionColaborador: { aggregate: vi.fn() },
  asistenciaInventario: { count: vi.fn() },
  justificacionAsistencia: { count: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

import type { ColaboradorAutenticado } from '../../shared/tipos';
import { obtenerDetalle } from './historial.service';

const AUDITOR: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: null, rol: 'auditor' };
const decimal = (n: number) => ({ toNumber: () => n });

const CERVEZA = 'CERVEZA';
const OTRO = 'OTRO-SOBRANTE';

function inventarioBase(estado: string, resultado: unknown) {
  return {
    id: 45,
    sucursalId: 1,
    sucursal: { id: 1, nombre: 'Market Bolívar' },
    estado,
    periodoAnio: 2026,
    periodoMes: 9,
    tamanoHoja: 50,
    snapshotItems: 8000,
    snapshotTomadoEn: new Date('2026-09-01T09:00:00.000Z'),
    abierto: false,
    abiertoEn: new Date('2026-09-01T09:00:00.000Z'),
    cerradoEn: new Date('2026-09-20T18:00:00.000Z'),
    cerradoPor: null,
    resultado,
    hojas: [],
    aprobaciones: [],
    lacrado: null,
    _count: { diferencias: 0, liquidaciones: 0 },
  };
}

function resultadoDelCaso() {
  return {
    montoFaltanteBruto: decimal(130),
    montoNegativos: decimal(40),
    // Congelado al cerrar: la cerveza todavía era EMPLEADO en Dynamics.
    montoFaltanteEmpresa: decimal(0),
    montoSobranteEmpleado: null,
    colaboradoresAlcanzados: 10,
    colaboradoresAsistieron: 8,
    diasDelInventario: 3,
    multaInasistencia: decimal(20),
    calculadoEn: new Date('2026-09-20T18:00:00.000Z'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Por defecto: no hay planilla firmada ni marcas -- `fondoYBonoReales` da 0.
  prismaMock.liquidacionColaborador.aggregate.mockResolvedValue({ _count: 0, _sum: { multaInasistencia: null } });
  prismaMock.asistenciaInventario.count.mockResolvedValue(0);
  prismaMock.justificacionAsistencia.count.mockResolvedValue(0);
  prismaMock.diferenciaItem.findMany.mockResolvedValue([
    { codigo: CERVEZA, diferencia: -1, montoDiferencia: { toNumber: () => -30 } },
    { codigo: OTRO, diferencia: 1, montoDiferencia: { toNumber: () => 50 } },
  ]);
  prismaMock.catalogoItem.findMany.mockResolvedValue([
    { codigo: CERVEZA, esEmpresa: false },
    { codigo: OTRO, esEmpresa: false },
  ]);
});

describe('obtenerDetalle: bug min-3 (bruto 130, negativos 40, sobrante 50, cerveza 30)', () => {
  it('ANTES de liquidar, CON la cerveza clasificada como empresa: neto 10 (no 90)', async () => {
    prismaMock.clasificacionProducto.findMany.mockResolvedValue([{ codigo: CERVEZA, esEmpresa: true }]);
    prismaMock.inventario.findUnique.mockResolvedValue(
      inventarioBase('conteo_cerrado', resultadoDelCaso()),
    );

    const detalle = (await obtenerDetalle(AUDITOR, 45)) as { resultado: Record<string, unknown> };

    expect(detalle.resultado['montoFaltanteNeto']).toBe(10);
    expect(detalle.resultado['montoFaltanteEmpresa']).toBe(30);
  });

  it('ANTES de liquidar, SIN clasificar la cerveza: neto 40', async () => {
    prismaMock.clasificacionProducto.findMany.mockResolvedValue([]);
    prismaMock.inventario.findUnique.mockResolvedValue(
      inventarioBase('conteo_cerrado', resultadoDelCaso()),
    );

    const detalle = (await obtenerDetalle(AUDITOR, 45)) as { resultado: Record<string, unknown> };

    expect(detalle.resultado['montoFaltanteNeto']).toBe(40);
    expect(detalle.resultado['montoFaltanteEmpresa']).toBe(0);
  });

  it('DESPUES de liquidar (congelado con 30/50 ya escritos por liquidar()): neto 10, no 60, sin tocar la clasificacion vigente', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue(
      inventarioBase('liquidado', {
        ...resultadoDelCaso(),
        montoFaltanteEmpresa: decimal(30),
        montoSobranteEmpleado: decimal(50),
      }),
    );

    const detalle = (await obtenerDetalle(AUDITOR, 45)) as { resultado: Record<string, unknown> };

    expect(detalle.resultado['montoFaltanteNeto']).toBe(10);
    expect(detalle.resultado['montoFaltanteEmpresa']).toBe(30);
    expect(prismaMock.clasificacionProducto.findMany).not.toHaveBeenCalled();
  });

  it('inventario viejo (montoSobranteEmpleado NULL, ya liquidado): da el mismo neto de siempre', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue(
      inventarioBase('liquidado', {
        montoFaltanteBruto: decimal(1850),
        montoNegativos: decimal(310),
        montoFaltanteEmpresa: decimal(150),
        montoSobranteEmpleado: null,
        colaboradoresAlcanzados: 11,
        colaboradoresAsistieron: 8,
        multaInasistencia: decimal(20),
        calculadoEn: new Date('2026-08-28T18:00:00.000Z'),
      }),
    );

    const detalle = (await obtenerDetalle(AUDITOR, 45)) as { resultado: Record<string, unknown> };

    // 1850 - 310 - 150 = 1390, el numero de siempre (mockup del cliente).
    expect(detalle.resultado['montoFaltanteNeto']).toBe(1390);
  });
});

/**
 * EL FONDO DE MULTAS DEL HISTORICO, que `calcularResumenLiquidacion` ya no
 * puede calcular.
 *
 * Esa funcion lo saca de `faltantes x multaInasistencia` -- PERSONAS por
 * tarifa -- y con la multa por dia eso deja de ser el fondo en cuanto dos
 * personas faltan distinta cantidad de dias. El historico mostraria un fondo
 * distinto del que de verdad se repartio, sobre una planilla que en la base
 * esta cuadrada. Ver `fondoYBonoReales`.
 */
describe('obtenerDetalle: el fondo de multas con la multa por día', () => {
  beforeEach(() => {
    prismaMock.clasificacionProducto.findMany.mockResolvedValue([]);
  });

  it('SIN liquidar, lo deriva de las marcas: días faltados x tarifa', async () => {
    // 10 alcanzados x 3 dias = 30 dia-persona posibles; hay 24 marcas, asi que
    // se faltaron 6 dias: S/120. La formula vieja habria dicho
    // `(10 - 8) x 20 = 40`, porque solo sabe contar personas.
    prismaMock.inventario.findUnique.mockResolvedValue(
      inventarioBase('conteo_cerrado', resultadoDelCaso()),
    );
    prismaMock.liquidacionColaborador.aggregate.mockResolvedValue({
      _count: 0,
      _sum: { multaInasistencia: null },
    });
    prismaMock.asistenciaInventario.count.mockResolvedValue(24);

    const detalle = (await obtenerDetalle(AUDITOR, 45)) as { resultado: Record<string, unknown> };

    expect(detalle.resultado['fondoMultas']).toBe(120);
    // El PISO del reparto entre los 8 que completaron: 12000/8 = 15.00 exacto.
    expect(detalle.resultado['bonoAsistencia']).toBe(15);
    expect(detalle.resultado['diasDelInventario']).toBe(3);
  });

  it('YA LIQUIDADO, manda la planilla FIRMADA, no las marcas', async () => {
    // Esos montos ya se descontaron de un sueldo: son la unica verdad. Si las
    // marcas dijeran otra cosa hoy, el historico tiene que seguir mostrando lo
    // que se pago.
    prismaMock.inventario.findUnique.mockResolvedValue(
      inventarioBase('liquidado', resultadoDelCaso()),
    );
    prismaMock.liquidacionColaborador.aggregate.mockResolvedValue({
      _count: 10,
      _sum: { multaInasistencia: decimal(180) },
    });
    prismaMock.asistenciaInventario.count.mockResolvedValue(24);

    const detalle = (await obtenerDetalle(AUDITOR, 45)) as { resultado: Record<string, unknown> };

    expect(detalle.resultado['fondoMultas']).toBe(180);
    expect(prismaMock.asistenciaInventario.count).not.toHaveBeenCalled();
  });

  it('inventario de la regla VIEJA (0 días): su planilla firmada se respeta tal cual', async () => {
    // `diasDelInventario: 0` significa "se cerro cuando la asistencia se
    // deducia de las hojas", no "duro cero dias". Sus multas fijas viven
    // congeladas y NO se reinterpretan con la formula nueva.
    prismaMock.inventario.findUnique.mockResolvedValue(
      inventarioBase('liquidado', { ...resultadoDelCaso(), diasDelInventario: 0 }),
    );
    prismaMock.liquidacionColaborador.aggregate.mockResolvedValue({
      _count: 10,
      _sum: { multaInasistencia: decimal(40) },
    });

    const detalle = (await obtenerDetalle(AUDITOR, 45)) as { resultado: Record<string, unknown> };

    expect(detalle.resultado['fondoMultas']).toBe(40);
  });

  it('más marcas que día-persona posibles: fondo 0, nunca negativo', async () => {
    // Pasa si alguien quedo marcado y despues salio del padron alcanzado. Un
    // fondo negativo seria plata que la empresa le estaria devolviendo a todos.
    prismaMock.inventario.findUnique.mockResolvedValue(
      inventarioBase('conteo_cerrado', resultadoDelCaso()),
    );
    prismaMock.liquidacionColaborador.aggregate.mockResolvedValue({
      _count: 0,
      _sum: { multaInasistencia: null },
    });
    prismaMock.asistenciaInventario.count.mockResolvedValue(99);

    const detalle = (await obtenerDetalle(AUDITOR, 45)) as { resultado: Record<string, unknown> };

    expect(detalle.resultado['fondoMultas']).toBe(0);
  });
});
