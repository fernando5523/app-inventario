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
  diferenciaItem: { count: vi.fn(), findMany: vi.fn(async () => []) },
  // Los usa `resolverMontosDeClasificacion` (liquidacion.reclasificacion.ts)
  // cuando el inventario TODAVÍA no está liquidado: `deSucursal` recalcula
  // empresa/sobrante con la clasificación vigente, en vez de leer el
  // congelado -- ver esa función para el bug que existe para evitar. Vacíos
  // por defecto: sin filas de catálogo/clasificación, el recalculo da 0 en
  // ambos montos, que es lo que ya asumían estos tests.
  catalogoItem: { findMany: vi.fn(async () => []) },
  clasificacionProducto: { findMany: vi.fn(async () => []) },
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
    // CONGELADO al cerrar el conteo -- solo se lee tal cual si el inventario
    // ya está `liquidado`/`lacrado`. Mientras siga `conteo_cerrado` (el
    // default de `inventarioCon`), `resolverMontosDeClasificacion` lo
    // IGNORA y recalcula con la clasificación vigente (mockeada vacía más
    // abajo, así que da 0) -- es a propósito: ningún test de este archivo
    // depende del valor exacto de `faltanteEmpresa`.
    montoFaltanteEmpresa: decimal(100),
    montoSobranteEmpleado: null,
    colaboradoresAlcanzados: 10,
    colaboradoresAsistieron: 8,
    multaInasistencia: decimal(20),
  };
}

function inventarioCon(resultado: unknown, estado: string = 'conteo_cerrado') {
  return {
    id: 9,
    estado,
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
      ...inventarioCon(resultadoCompleto(), 'liquidado'),
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
    // Y `faltanteEmpresa`/`faltanteNeto` NUNCA se recalculan con la
    // clasificación de hoy para un inventario ya liquidado -- congelado
    // manda, ni una consulta a `ClasificacionProducto`/`CatalogoItem`.
    expect(r!.faltanteEmpresa).toBe(100);
    expect(prismaMock.catalogoItem.findMany).not.toHaveBeenCalled();
    expect(prismaMock.clasificacionProducto.findMany).not.toHaveBeenCalled();
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

  /**
   * REGRESION del bug reportado por min-3 con numeros exactos (2026-09-14):
   * bruto 130, negativos 40 (Excel), un sobrante de empleado de 50 y una
   * cerveza de faltante 30. ANTES de este fix, esta pantalla (la vista previa
   * ANTES de liquidar) mostraba 90 clasificaras o no la cerveza -- no restaba
   * ni la empresa ni el sobrante. Ahora tiene que dar 10 (clasificada) o 40
   * (sin clasificar), usando la MISMA fuente que liquidar() -- ver
   * liquidacion.reclasificacion.ts#resolverMontosDeClasificacion.
   */
  describe('bug min-3: bruto 130, negativos 40, sobrante 50, cerveza 30', () => {
    const CERVEZA = 'CERVEZA';
    const OTRO = 'OTRO-SOBRANTE';

    function resultadoDelCaso() {
      return {
        montoFaltanteBruto: decimal(130),
        montoNegativos: decimal(40),
        // Congelado al CERRAR el conteo: la cerveza todavia era EMPLEADO en
        // Dynamics, asi que este valor viejo NO la tiene adentro. Antes del
        // fix, `deSucursal` leia esto directo -- ahora se ignora mientras
        // el inventario siga `conteo_cerrado`.
        montoFaltanteEmpresa: decimal(0),
        montoSobranteEmpleado: null,
        colaboradoresAlcanzados: 10,
        colaboradoresAsistieron: 8,
        multaInasistencia: decimal(20),
      };
    }

    beforeEach(() => {
      prismaMock.diferenciaItem.findMany.mockResolvedValue([
        { codigo: CERVEZA, diferencia: -1, montoDiferencia: { toNumber: () => -30 } },
        { codigo: OTRO, diferencia: 1, montoDiferencia: { toNumber: () => 50 } },
      ] as never);
      prismaMock.catalogoItem.findMany.mockResolvedValue([
        { codigo: CERVEZA, esEmpresa: false },
        { codigo: OTRO, esEmpresa: false },
      ] as never);
    });

    it('ANTES de liquidar, CON la cerveza clasificada como empresa: neto 10 (no 90)', async () => {
      prismaMock.clasificacionProducto.findMany.mockResolvedValue([{ codigo: CERVEZA, esEmpresa: true }] as never);
      prismaMock.inventario.findFirst.mockResolvedValue(inventarioCon(resultadoDelCaso(), 'conteo_cerrado'));

      const r = await deSucursal(AUDITOR, 1);

      expect(r!.faltanteNeto).toBe(10);
      // El desglose tiene que sumar contra el total mostrado.
      expect(r!.faltanteEmpresa).toBe(30);
    });

    it('ANTES de liquidar, SIN clasificar la cerveza: neto 40 (bruto - negativos - sobrante, sin empresa)', async () => {
      prismaMock.clasificacionProducto.findMany.mockResolvedValue([]);
      prismaMock.inventario.findFirst.mockResolvedValue(inventarioCon(resultadoDelCaso(), 'conteo_cerrado'));

      const r = await deSucursal(AUDITOR, 1);

      expect(r!.faltanteNeto).toBe(40);
      expect(r!.faltanteEmpresa).toBe(0);
    });

    it('DESPUES de liquidar (congelado con 30/50 ya escritos por liquidar()): neto 10, no 60', async () => {
      prismaMock.inventario.findFirst.mockResolvedValue(
        inventarioCon(
          {
            ...resultadoDelCaso(),
            // Lo que liquidar() YA escribió (ver liquidacion.cierre.ts): el
            // encabezado tiene que leer esto tal cual, no recalcular.
            montoFaltanteEmpresa: decimal(30),
            montoSobranteEmpleado: decimal(50),
          },
          'liquidado',
        ),
      );

      const r = await deSucursal(AUDITOR, 1);

      expect(r!.faltanteNeto).toBe(10);
      expect(r!.faltanteEmpresa).toBe(30);
      // Congelado: ni una consulta a la clasificación vigente.
      expect(prismaMock.clasificacionProducto.findMany).not.toHaveBeenCalled();
    });
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
