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

import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { calcularTotalDescuento } from '../historial/historial.calculos';
import { conciliacion, deSucursal } from './liquidacion.service';

// La liquidación es del auditor desde 2026-09-11 (liquidacion.permisos.ts).
// Sin tienda en la ficha: entra por "administradores" y audita toda la cadena.
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: null, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 8, sucursalId: 1, rol: 'coordinador' };

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
    expect(await deSucursal(AUDITOR, 1)).toBeNull();
  });

  it('el coordinador recibe 403 y NO llega a la base, ni para la de su propia tienda', async () => {
    await expect(deSucursal(COORDINADOR, 1)).rejects.toThrow(Prohibido);
    expect(prismaMock.inventario.findFirst).not.toHaveBeenCalled();
  });

  /**
   * LOS YA LIQUIDADOS SE SIGUEN LEYENDO IGUAL. Los que cerró un coordinador
   * antes del 2026-09-11 tienen sus filas firmadas en LiquidacionColaborador:
   * el auditor las ve tal cual se firmaron -- nombre y rol CONGELADOS, sin
   * recalcular nada con el padrón de hoy.
   */
  it('un inventario ya liquidado se lee de sus filas firmadas, tal cual se firmaron', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue({
      ...inventarioCon(resultadoCompleto()),
      liquidaciones: [
        {
          colaboradorId: 1,
          nombreAlLiquidar: 'Nancy Quispe',
          rolAlLiquidar: 'coordinador',
          asistio: true,
          cuotaBase: decimal(40),
          multaInasistencia: decimal(0),
          bonoAsistencia: decimal(2.5),
          // El padrón de HOY: otro nombre, otro rol. No es lo que dice el recibo.
          colaborador: { id: 1, nombre: 'Nancy Quispe Rojas', rol: 'auditor' },
        },
      ],
    });

    const r = await deSucursal(AUDITOR, 1);

    expect(r!.proyectada).toBe(false);
    expect(r!.planilla).toEqual([
      {
        colaboradorId: 1,
        nombre: 'Nancy Quispe',
        rol: 'coordinador',
        asistio: true,
        monto: calcularTotalDescuento({ cuotaBase: 40, multaInasistencia: 0, bonoAsistencia: 2.5 }),
      },
    ]);
    // Nada se proyecta: mandan las filas firmadas.
    expect(prismaMock.colaborador.findMany).not.toHaveBeenCalled();
  });

  it('con asistencia y ajustes capturados, calcula el neto normalmente', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue(inventarioCon(resultadoCompleto()));

    const r = await deSucursal(AUDITOR, 1);

    expect(r!.faltanteNeto).not.toBeNull();
    expect(r!.cuotaBase).not.toBeNull();
    expect(r!.bonoAsistencia).not.toBeNull();
    expect(r!.totalFaltas).not.toBeNull();
    expect(r!.negativosDelMes).toBe(50);
    expect(r!.advertencia.asistenciaSinRegistrar).toBe(false);
    expect(r!.advertencia.ajustesSinRegistrar).toBe(false);
  });

  it('trae año y mes como NÚMEROS además del texto: el nombre del archivo del reporte a gerencia los necesita', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue(inventarioCon(resultadoCompleto()));

    const r = await deSucursal(AUDITOR, 1);

    expect(r).toMatchObject({ periodo: 'Agosto 2026', periodoAnio: 2026, periodoMes: 8 });
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

    const r = await deSucursal(AUDITOR, 1);

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

    const r = await deSucursal(AUDITOR, 1);

    expect(r!.faltanteNeto).toBeNull();
    expect(r!.negativosDelMes).toBeNull();
    expect(r!.advertencia.ajustesSinRegistrar).toBe(true);
  });
});

describe('conciliacion', () => {
  it('el coordinador tampoco la ve: es el mismo resultado, con más detalle', async () => {
    await expect(conciliacion(COORDINADOR, 1)).rejects.toThrow(Prohibido);
    expect(prismaMock.inventario.findFirst).not.toHaveBeenCalled();
  });

  it('sin datos completos, devuelve calculable:false en vez de dividir por un null', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue(
      inventarioCon({ ...resultadoCompleto(), colaboradoresAsistieron: null }),
    );

    const r = await conciliacion(AUDITOR, 1);

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

    const r = await conciliacion(AUDITOR, 1);

    expect(r).toEqual(expect.objectContaining({ calculable: true }));
    expect((r as { fondoDeMultas: unknown }).fondoDeMultas).toBeDefined();
  });
});
