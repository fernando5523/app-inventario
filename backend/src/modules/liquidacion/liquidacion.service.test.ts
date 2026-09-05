/**
 * `deSucursal`/`conciliacion` con Prisma mockeado -- `npm test` no levanta
 * Postgres.
 *
 * EL FOCO: un número que depende de `colaboradoresAsistieron`/
 * `montoNegativos` (NULLABLE en el schema, NULL = todavía no se capturó)
 * no se deriva con 0 de placeholder. Se deja en `null`, y la advertencia
 * dice por qué -- mismo criterio que `CatalogoItem.stockErp` y que el
 * aviso de "N ítems sin precio" que esta pantalla ya tenía.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findFirst: vi.fn() },
  diferenciaItem: { count: vi.fn() },
  // Los usa `proyectarPlanilla`: `deSucursal` proyecta la planilla cuando
  // todavía no se liquidó, con la misma función que después persiste
  // `liquidar()`. Por defecto vacíos -- cada test que le importe la
  // proyección los llena.
  colaborador: { findMany: vi.fn(async () => []) },
  hojaConteo: { findMany: vi.fn(async () => []) },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

import type { ColaboradorAutenticado } from '../../shared/tipos';
import { conciliacion, deSucursal } from './liquidacion.service';

const COORD: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: 1, rol: 'coordinador' };

const decimal = (n: number) => ({ toNumber: () => n });

/** Resultado con TODO capturado: asistencia y ajustes reales, no placeholder. */
function resultadoCompleto() {
  return {
    montoFaltanteBruto: decimal(500),
    montoNegativos: decimal(50),
    montoFaltanteEmpresa: decimal(100),
    colaboradoresAlcanzados: 10,
    colaboradoresAsistieron: 8,
    multaInasistencia: decimal(20),
  };
}

function inventarioCon(resultado: unknown) {
  return {
    id: 9,
    periodoAnio: 2026,
    periodoMes: 8,
    resultado,
    liquidaciones: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.diferenciaItem.count.mockResolvedValue(0);
});

describe('deSucursal', () => {
  it('sin inventario con conteo cerrado, null -- no un objeto en cero', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue(null);
    expect(await deSucursal(COORD, 1)).toBeNull();
  });

  it('con asistencia y ajustes capturados, calcula el neto normalmente', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue(inventarioCon(resultadoCompleto()));

    const r = await deSucursal(COORD, 1);

    expect(r!.faltanteNeto).not.toBeNull();
    expect(r!.cuotaBase).not.toBeNull();
    expect(r!.bonoAsistencia).not.toBeNull();
    expect(r!.totalFaltas).not.toBeNull();
    expect(r!.negativosDelMes).toBe(50);
    expect(r!.advertencia.asistenciaSinRegistrar).toBe(false);
    expect(r!.advertencia.ajustesSinRegistrar).toBe(false);
  });

  /**
   * EL CASO QUE IMPORTA. `colaboradoresAsistieron: null` en la base --
   * nadie registró asistencia todavía. El neto/cuota/bono/faltas tienen
   * que quedar en `null`, NO en un número calculado con "0 faltas" que se
   * leería como un dato real.
   */
  it('sin asistencia registrada, el neto/cuota/bono/faltas quedan en null -- no en 0', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue(
      inventarioCon({ ...resultadoCompleto(), colaboradoresAsistieron: null }),
    );

    const r = await deSucursal(COORD, 1);

    expect(r!.faltanteNeto).toBeNull();
    expect(r!.cuotaBase).toBeNull();
    expect(r!.bonoAsistencia).toBeNull();
    expect(r!.totalFaltas).toBeNull();
    // Lo que SÍ es real sigue viniendo real, no todo se apaga.
    expect(r!.faltanteBruto).toBe(500);
    expect(r!.negativosDelMes).toBe(50);
    // La distinción vive en el DATO, no solo en el mensaje.
    expect(r!.advertencia.asistenciaSinRegistrar).toBe(true);
    expect(r!.advertencia.mensaje).toContain('asistencia');
  });

  /** Mismo criterio, para el otro campo nullable. */
  it('sin los ajustes del mes cargados, el neto queda en null y negativosDelMes también', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue(
      inventarioCon({ ...resultadoCompleto(), montoNegativos: null }),
    );

    const r = await deSucursal(COORD, 1);

    expect(r!.faltanteNeto).toBeNull();
    expect(r!.negativosDelMes).toBeNull();
    expect(r!.advertencia.ajustesSinRegistrar).toBe(true);
  });
});

describe('conciliacion', () => {
  it('sin datos completos, devuelve calculable:false en vez de dividir por un null', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue(
      inventarioCon({ ...resultadoCompleto(), colaboradoresAsistieron: null }),
    );

    const r = await conciliacion(COORD, 1);

    expect(r).toEqual(
      expect.objectContaining({
        calculable: false,
        advertencia: expect.objectContaining({ asistenciaSinRegistrar: true }),
      }),
    );
    // Ninguno de los campos aritméticos (que hubieran dado NaN) se expone.
    expect(r).not.toHaveProperty('fondoDeMultas');
  });

  it('con datos completos, calcula la conciliación entera', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue(inventarioCon(resultadoCompleto()));

    const r = await conciliacion(COORD, 1);

    expect(r).toEqual(expect.objectContaining({ calculable: true }));
    expect((r as { fondoDeMultas: unknown }).fondoDeMultas).toBeDefined();
  });
});
