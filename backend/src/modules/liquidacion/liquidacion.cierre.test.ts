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
  asistenciaInventario: { findMany: vi.fn() },
  liquidacionColaborador: { createMany: vi.fn() },
  // Liquidacion v2: reclasificacion al liquidar (liquidacion.reclasificacion.ts).
  diferenciaItem: { findMany: vi.fn(), updateMany: vi.fn() },
  catalogoItem: { findMany: vi.fn() },
  clasificacionProducto: { findMany: vi.fn() },
  resultadoInventario: { update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn() }));

import { calcularResumenLiquidacion, calcularTotalDescuento, redondear } from '../historial/historial.calculos';
import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import {
  armarPlanilla,
  fondoDeLaPlanilla,
  liquidar,
  proyectarPlanilla,
  type ColaboradorParaLiquidar,
} from './liquidacion.cierre';

// La liquidación es del auditor desde 2026-09-11 (liquidacion.permisos.ts).
// Sin tienda en la ficha: entra por "administradores" y audita toda la cadena.
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: null, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 8, sucursalId: 1, rol: 'coordinador' };
const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };

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
  /**
   * -------------------------------------------------------------------------
   * EL EJEMPLO CANONICO DEL CLIENTE. Si falla alguno de estos, no se liquida.
   * -------------------------------------------------------------------------
   * Inventario de 3 dias, neto S/229 entre 3 personas, tarifa S/20 por dia.
   * Silvia 3/3, Oscar 3/3, Delia 1/3.
   *
   *   |        | Cuota | Multa | Bono  | Paga   |
   *   | Silvia | 76.33 |     0 | 20.00 |  56.33 |
   *   | Oscar  | 76.33 |     0 | 20.00 |  56.33 |
   *   | Delia  | 76.33 | 40.00 |     0 | 116.33 |
   *
   * Delia falto 2 de 3 dias: 2 x 20 = 40. Ese fondo se reparte entre los dos
   * que vinieron todos los dias: 20 cada uno. La empresa no pone ni se queda
   * con nada.
   */
  describe('el ejemplo canonico: 3 dias, Silvia y Oscar 3/3, Delia 1/3', () => {
    const SILVIA = 1;
    const OSCAR = 2;
    const DELIA = 3;
    const NETO = 229;
    const personal: ColaboradorParaLiquidar[] = [
      { id: SILVIA, nombre: 'Silvia Huerta', rol: 'conteo' },
      { id: OSCAR, nombre: 'Oscar Maguina', rol: 'coordinador' },
      { id: DELIA, nombre: 'Delia Ramos', rol: 'conteo' },
    ];
    // La cuota sale de la misma funcion que la calcula en produccion, no de un
    // 76.33 escrito a mano: si el redondeo de la cuota cambiara, este test
    // tiene que enterarse.
    const resumen = calcularResumenLiquidacion({
      montoFaltanteBruto: NETO,
      montoNegativos: 0,
      montoFaltanteEmpresa: 0,
      colaboradoresAlcanzados: personal.length,
      colaboradoresAsistieron: 2,
      multaInasistencia: 20,
    });
    const filas = armarPlanilla({
      colaboradores: personal,
      diasDelInventario: 3,
      diasAsistidos: new Map([
        [SILVIA, 3],
        [OSCAR, 3],
        [DELIA, 1],
      ]),
      cuotaBase: resumen.cuotaBase,
      tarifaMultaPorDia: 20,
    });
    const porId = new Map(filas.map((f) => [f.colaboradorId, f]));

    it('la cuota base es S/76.33 para los tres', () => {
      expect(resumen.cuotaBase).toBe(76.33);
      expect(filas.every((f) => f.cuotaBase === 76.33)).toBe(true);
    });

    it('Silvia: 3/3 dias, sin multa, cobra S/20 de bono, paga S/56.33', () => {
      const fila = porId.get(SILVIA);
      expect(fila).toMatchObject({ diasAsistidos: 3, asistio: true, multaInasistencia: 0, bonoAsistencia: 20 });
      expect(calcularTotalDescuento(fila!)).toBe(56.33);
    });

    it('Oscar: 3/3 dias, igual que Silvia -- el coordinador tambien entra en la planilla', () => {
      const fila = porId.get(OSCAR);
      expect(fila).toMatchObject({ diasAsistidos: 3, asistio: true, multaInasistencia: 0, bonoAsistencia: 20 });
      expect(calcularTotalDescuento(fila!)).toBe(56.33);
    });

    it('Delia: 1/3 dias, multa de S/40 (2 dias x 20), sin bono, paga S/116.33', () => {
      // EL CAMBIO DE REGLA, en una fila: con la multa vieja (monto fijo por
      // ausente) Delia pagaba S/20 por faltar 2 dias, lo mismo que alguien
      // que no aparecio nunca.
      const fila = porId.get(DELIA);
      expect(fila).toMatchObject({ diasAsistidos: 1, asistio: false, multaInasistencia: 40, bonoAsistencia: 0 });
      expect(calcularTotalDescuento(fila!)).toBe(116.33);
    });

    it('el fondo de multas CIERRA: lo que aporta Delia es lo que cobran Silvia y Oscar', () => {
      // La invariante que no se puede romper. Si el bono se sacara, o se
      // repartiera entre otra gente, la empresa cobraria de mas.
      const multas = filas.reduce((t, f) => t + f.multaInasistencia, 0);
      const bonos = filas.reduce((t, f) => t + f.bonoAsistencia, 0);
      expect(multas).toBe(40);
      expect(bonos).toBe(40);
      expect(fondoDeLaPlanilla(filas)).toBe(40);
    });

    it('LA PLANILLA SUMA EL NETO: 56.33 + 56.33 + 116.33 = 228.99, y el centavo que falta es el residuo conocido', () => {
      // OJO, y es lo unico del ejemplo del brief que no cierra al centavo:
      // la tabla dice "Suma = 229.00", pero 229 / 3 = 76.3333... -> 76.33, y
      // 76.33 x 3 = 228.99. El centavo que falta NO lo introduce la multa por
      // dia (multas y bonos se cancelan exactamente): es el residuo del
      // redondeo de la CUOTA, que existe desde antes de este cambio, se expone
      // en `ResumenLiquidacion.residuoCentavos` y hoy queda a favor del
      // personal (se descuenta de menos). Esta PENDIENTE DE DEFINIR CON EL
      // CLIENTE -- ver historial.calculos.ts.
      const suma = redondear(filas.reduce((t, f) => t + calcularTotalDescuento(f), 0));
      expect(suma).toBe(228.99);
      expect(resumen.residuoCentavos).toBe(0.01);
      expect(redondear(suma + resumen.residuoCentavos)).toBe(NETO);
    });
  });

  it('una fila por persona alcanzada, no solo por quien vino todos los dias', () => {
    // Quien falto tambien entra en la planilla: su fila es la que lleva la
    // multa. Dejarlo afuera seria no cobrarsela.
    const filas = armarPlanilla({
      colaboradores: equipo(11),
      diasDelInventario: 2,
      diasAsistidos: new Map([[1, 2]]),
      cuotaBase: 126.36,
      tarifaMultaPorDia: 20,
    });
    expect(filas).toHaveLength(11);
  });

  it('quien no esta en el Map de dias asistidos paga el inventario COMPLETO', () => {
    // No es un dato faltante: la asistencia la registra el coordinador, y no
    // haber sido marcado nunca es exactamente la ausencia total.
    const [, , sinMarcas] = armarPlanilla({
      colaboradores: equipo(3),
      diasDelInventario: 4,
      diasAsistidos: new Map([
        [1, 4],
        [2, 4],
      ]),
      cuotaBase: 10,
      tarifaMultaPorDia: 20,
    });
    expect(sinMarcas).toMatchObject({ diasAsistidos: 0, asistio: false, multaInasistencia: 80 });
  });

  it('LA MULTA ES POR DIA: faltar 1 de 3 cuesta menos que no aparecer nunca', () => {
    // El test que se rompe si alguien vuelve al monto fijo por persona.
    const filas = armarPlanilla({
      colaboradores: equipo(3),
      diasDelInventario: 3,
      diasAsistidos: new Map([
        [1, 3],
        [2, 2],
        [3, 0],
      ]),
      cuotaBase: 10,
      tarifaMultaPorDia: 20,
    });
    expect(filas.map((f) => f.multaInasistencia)).toEqual([0, 20, 60]);
  });

  it('`asistio` es EXACTAMENTE "no paga multa", nunca "vino alguna vez"', () => {
    // Si se rompiera, alguien podria cobrar bono Y pagar multa: aportaria al
    // fondo y cobraria de el, y la planilla dejaria de sumar el neto.
    const filas = armarPlanilla({
      colaboradores: equipo(4),
      diasDelInventario: 3,
      diasAsistidos: new Map([
        [1, 3],
        [2, 2],
        [3, 1],
      ]),
      cuotaBase: 10,
      tarifaMultaPorDia: 20,
    });
    for (const f of filas) {
      expect(f.asistio).toBe(f.multaInasistencia === 0);
      // El que vino 2 de 3 dias NO tiene asistio: true, pero su fila muestra
      // que vino -- el dato honesto esta en `diasAsistidos`.
      if (!f.asistio && f.diasAsistidos > 0) expect(f.bonoAsistencia).toBe(0);
    }
    expect(filas.map((f) => f.diasAsistidos)).toEqual([3, 2, 1, 0]);
  });

  it('la suma de los bonos da EXACTAMENTE la suma de las multas', () => {
    // El caso real de la reunion, ahora con dias: 11 personas, 4 que faltan un
    // dia cada una a S/20 -> fondo S/80 entre 7. 80/7 = 11.4285..., que con
    // `redondear` daba 11.43 c/u = 80.01 y la empresa ponia un centavo.
    const filas = armarPlanilla({
      colaboradores: equipo(11),
      diasDelInventario: 3,
      // Los 7 primeros vinieron los 3 dias; los 4 ultimos faltaron uno.
      diasAsistidos: new Map<number, number>([
        ...[1, 2, 3, 4, 5, 6, 7].map((id): [number, number] => [id, 3]),
        ...[8, 9, 10, 11].map((id): [number, number] => [id, 2]),
      ]),
      cuotaBase: 126.36,
      tarifaMultaPorDia: 20,
    });
    const multas = filas.reduce((t, f) => t + Math.round(f.multaInasistencia * 100), 0);
    const bonos = filas.reduce((t, f) => t + Math.round(f.bonoAsistencia * 100), 0);
    expect(multas).toBe(8000);
    expect(bonos).toBe(8000);
  });

  it('cierra igual con dias faltados DISTINTOS entre si', () => {
    // Lo que la formula vieja (`gente que falto x tarifa`) ya no puede
    // reconstruir: tres personas que faltaron 1, 2 y 3 dias no aportan
    // `3 x tarifa`, aportan `6 x tarifa`. Por eso el fondo se deriva de las
    // filas y no llega por parametro.
    const filas = armarPlanilla({
      colaboradores: equipo(5),
      diasDelInventario: 3,
      diasAsistidos: new Map([
        [1, 3],
        [2, 3],
        [3, 2],
        [4, 1],
        [5, 0],
      ]),
      cuotaBase: 10,
      tarifaMultaPorDia: 20,
    });
    expect(fondoDeLaPlanilla(filas)).toBe(120); // (1 + 2 + 3) dias x 20
    const bonos = filas.reduce((t, f) => t + Math.round(f.bonoAsistencia * 100), 0);
    expect(bonos).toBe(12000);
  });

  it('el centavo de mas va por id ascendente, no por el orden de la lista', () => {
    // Si dependiera del orden en que la base devolvio las filas, la misma
    // liquidacion podria dar distinto en dos corridas.
    const desordenado: ColaboradorParaLiquidar[] = [
      { id: 9, nombre: 'Nueve', rol: 'conteo' },
      { id: 2, nombre: 'Dos', rol: 'conteo' },
      { id: 5, nombre: 'Cinco', rol: 'conteo' },
      { id: 7, nombre: 'Siete', rol: 'conteo' },
    ];
    const filas = armarPlanilla({
      colaboradores: desordenado,
      diasDelInventario: 1,
      diasAsistidos: new Map([
        [9, 1],
        [2, 1],
        [5, 1],
      ]),
      cuotaBase: 10,
      tarifaMultaPorDia: 20,
    });
    // Fondo S/20 entre 3: 6.67 / 6.67 / 6.66. Los dos centavos sobrantes van a
    // los ids mas chicos (2 y 5), no a los primeros de la lista.
    const bono = (id: number) => filas.find((f) => f.colaboradorId === id)?.bonoAsistencia;
    expect(bono(2)).toBe(6.67);
    expect(bono(5)).toBe(6.67);
    expect(bono(9)).toBe(6.66);
    expect(bono(7)).toBe(0);
  });

  it('NO guarda el total: solo las partes', () => {
    const [fila] = armarPlanilla({
      colaboradores: equipo(1),
      diasDelInventario: 1,
      diasAsistidos: new Map([[1, 1]]),
      cuotaBase: 126.36,
      tarifaMultaPorDia: 20,
    });
    expect(fila).not.toHaveProperty('monto');
    expect(fila).not.toHaveProperty('total');
  });

  it('congela nombre, rol Y dias asistidos del momento de liquidar', () => {
    // Es lo que decia el recibo de sueldo de ese mes. Sin `diasAsistidos`
    // congelado, una multa de S/40 con tarifa 20 obliga a recontar marcas que
    // meses despues pueden haber cambiado.
    const [fila] = armarPlanilla({
      colaboradores: [{ id: 1, nombre: 'Nancy Quispe', rol: 'coordinador' }],
      diasDelInventario: 3,
      diasAsistidos: new Map([[1, 2]]),
      cuotaBase: 10,
      tarifaMultaPorDia: 20,
    });
    expect(fila?.nombreAlLiquidar).toBe('Nancy Quispe');
    expect(fila?.rolAlLiquidar).toBe('coordinador');
    expect(fila?.diasAsistidos).toBe(2);
  });

  it('si NADIE vino todos los dias, nadie cobra bono y el fondo queda sin repartir', () => {
    // Caso degenerado: `liquidar()` lo corta antes de escribir una fila, justo
    // porque este reparto no cierra -- la empresa se quedaria con el fondo.
    // Esta funcion no inventa un destinatario: devuelve lo que es y quien
    // llama decide.
    const filas = armarPlanilla({
      colaboradores: equipo(3),
      diasDelInventario: 3,
      diasAsistidos: new Map([
        [1, 2],
        [2, 1],
      ]),
      cuotaBase: 10,
      tarifaMultaPorDia: 20,
    });
    expect(filas.every((f) => f.bonoAsistencia === 0)).toBe(true);
    expect(fondoDeLaPlanilla(filas)).toBe(120);
  });

  it('inventario de 0 dias: sin multas y sin bonos, solo la cuota', () => {
    // Nadie marco asistencia. No se multa a nadie por un inventario que, segun
    // el registro, no tuvo un solo dia.
    const filas = armarPlanilla({
      colaboradores: equipo(3),
      diasDelInventario: 0,
      diasAsistidos: new Map(),
      cuotaBase: 10,
      tarifaMultaPorDia: 20,
    });
    expect(filas.every((f) => f.multaInasistencia === 0 && f.bonoAsistencia === 0)).toBe(true);
    expect(fondoDeLaPlanilla(filas)).toBe(0);
  });

  it('una tarifa con centavos no arrastra error de punto flotante', () => {
    const filas = armarPlanilla({
      colaboradores: equipo(3),
      diasDelInventario: 3,
      diasAsistidos: new Map([
        [1, 3],
        [2, 0],
        [3, 0],
      ]),
      cuotaBase: 10,
      tarifaMultaPorDia: 20.1,
    });
    expect(fondoDeLaPlanilla(filas)).toBe(120.6);
    expect(filas[0]?.bonoAsistencia).toBe(120.6);
  });
});

// ---------------------------------------------------------------------------
// liquidar -- contra la base
// ---------------------------------------------------------------------------

const resultadoCompleto = {
  montoFaltanteBruto: decimal(1500),
  montoNegativos: decimal(100),
  montoFaltanteEmpresa: decimal(10),
  montoSobranteEmpleado: null,
  colaboradoresAlcanzados: 11,
  // CUANTOS CUMPLIERON LA ASISTENCIA COMPLETA -- los que no pagan multa. Ya no
  // es "cuantos vinieron alguna vez": los 4 que faltan un dia SI vinieron.
  colaboradoresAsistieron: 7,
  /** Los 3 dias que duro el inventario: el denominador de todas las multas. */
  diasDelInventario: 3,
  /** Desde la asistencia por dia, esto es la TARIFA POR DIA. */
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

/** Los 3 dias del inventario, como los devuelve Prisma para un `@db.Date`. */
const DIAS = ['2026-09-01', '2026-09-02', '2026-09-03'].map((d) => new Date(`${d}T00:00:00.000Z`));

/**
 * Las marcas que el Coordinador registro: los 7 primeros hicieron los 3 dias,
 * los 4 ultimos faltaron UNO (hicieron 2 de 3).
 *
 * Coincide con `colaboradoresAsistieron: 7` de `resultadoCompleto` -- y esa
 * coincidencia es la invariante que se testea. El fondo da los mismos S/80 del
 * ejemplo real de la reunion, ahora por otro camino: antes eran 4 ausentes x
 * S/20 fijos, ahora son 4 personas x 1 dia faltado x S/20 por dia.
 */
const marcasDeAsistencia = [
  ...[1, 2, 3, 4, 5, 6, 7].flatMap((id) => DIAS.map((dia) => ({ colaboradorId: id, dia }))),
  // Faltaron el ultimo dia: vinieron, pero no completaron.
  ...[8, 9, 10, 11].flatMap((id) => DIAS.slice(0, 2).map((dia) => ({ colaboradorId: id, dia }))),
];

/**
 * La reclasificacion (liquidacion.reclasificacion.ts) reemplaza a
 * `resultado.montoFaltanteEmpresa` con lo que calcula A PARTIR de estas dos
 * filas. Se arman para reproducir EXACTAMENTE el mismo `montoFaltanteEmpresa:
 * 10` de `resultadoCompleto`, de modo que los tests de ESTE archivo (que no
 * son sobre reclasificacion) seguan viendo los mismos numeros de siempre. El
 * flujo de reclasificacion en si -- que un item cambie de lado -- tiene su
 * propio test en liquidacion.flujo-reclasificacion.test.ts.
 */
const decimalDiferencia = decimal;
const diferenciasPorDefecto = [{ codigo: 'ITEM-EMPRESA', diferencia: -1, montoDiferencia: decimalDiferencia(-10) }];
const catalogoPorDefecto = [{ codigo: 'ITEM-EMPRESA', esEmpresa: true }];

describe('liquidar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInventario();
    prismaMock.colaborador.findMany.mockResolvedValue(
      equipo(11).map((c) => ({ id: c.id, nombre: c.nombre, rol: c.rol })),
    );
    prismaMock.asistenciaInventario.findMany.mockResolvedValue(marcasDeAsistencia);
    prismaMock.diferenciaItem.findMany.mockResolvedValue(diferenciasPorDefecto);
    prismaMock.catalogoItem.findMany.mockResolvedValue(catalogoPorDefecto);
    prismaMock.clasificacionProducto.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : arg,
    );
  });

  it('el inventario que no existe es 404', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue(null);
    await expect(liquidar(AUDITOR, 9)).rejects.toThrow('no existe');
  });

  /**
   * DECISIÓN DEL CLIENTE (2026-09-11): liquidar pasa al AUDITOR -- "el
   * Coordinador deja de ver la liquidacion y ejecutarlo, ahora lo realiza el
   * auditor". Ver liquidacion.permisos.ts.
   */
  it('el coordinador YA NO liquida, y el mensaje dice quién sí', async () => {
    await expect(liquidar(COORDINADOR, 9)).rejects.toThrow(/auditor/);
    expect(prismaMock.liquidacionColaborador.createMany).not.toHaveBeenCalled();
  });

  it('se corta ANTES de tocar la base: al coordinador no le dice ni si el inventario existe', async () => {
    await expect(liquidar(COORDINADOR, 9)).rejects.toThrow(Prohibido);
    expect(prismaMock.inventario.findUnique).not.toHaveBeenCalled();
  });

  it('el administrador tampoco: es técnico, no participa del proceso de inventario', async () => {
    await expect(liquidar(ADMIN, 9)).rejects.toThrow(Prohibido);
    expect(prismaMock.liquidacionColaborador.createMany).not.toHaveBeenCalled();
  });

  it('el auditor liquida el inventario de cualquier sucursal: audita toda la cadena', async () => {
    mockInventario({ sucursalId: 2 });
    await expect(liquidar(AUDITOR, 9)).resolves.toMatchObject({ estado: 'liquidado' });
  });

  it('con el conteo todavía abierto rechaza y dice qué falta', async () => {
    mockInventario({ estado: 'en_curso' });
    await expect(liquidar(AUDITOR, 9)).rejects.toThrow(/cerrar la ultima ronda/);
  });

  it('no se reliquida: un inventario ya liquidado da 409', async () => {
    // El recibo de sueldo de ese mes ya salió. Recalcular con el padrón de
    // hoy daría otro número para un pago que ya se hizo.
    mockInventario({ estado: 'liquidado' });
    await expect(liquidar(AUDITOR, 9)).rejects.toThrow(/ya se cerro/);
    expect(prismaMock.liquidacionColaborador.createMany).not.toHaveBeenCalled();
  });

  it('un inventario lacrado tampoco se reliquida', async () => {
    mockInventario({ estado: 'lacrado' });
    await expect(liquidar(AUDITOR, 9)).rejects.toThrow(/ya se cerro/);
  });

  /**
   * LA GUARDA QUE HOY CORTA SIEMPRE, y que es el punto de todo esto: NULL es
   * "no se capturó", nunca "cero". Escribir la planilla igual sería
   * descontarle a alguien un monto calculado sobre un dato que nadie cargó.
   */
  describe('sin los datos que nadie capturó todavía', () => {
    it('sin asistencia registrada NO escribe la planilla', async () => {
      mockInventario({ resultado: { ...resultadoCompleto, colaboradoresAsistieron: null } });

      await expect(liquidar(AUDITOR, 9)).rejects.toThrow(/asistencia/);
      expect(prismaMock.liquidacionColaborador.createMany).not.toHaveBeenCalled();
      expect(prismaMock.inventario.update).not.toHaveBeenCalled();
    });

    it('sin los ajustes del mes tampoco', async () => {
      mockInventario({ resultado: { ...resultadoCompleto, montoNegativos: null } });

      await expect(liquidar(AUDITOR, 9)).rejects.toThrow(/ajustes del mes/);
      expect(prismaMock.liquidacionColaborador.createMany).not.toHaveBeenCalled();
    });

    it('el mensaje explica la consecuencia, no solo que no se puede', async () => {
      mockInventario({ resultado: { ...resultadoCompleto, colaboradoresAsistieron: null } });
      await expect(liquidar(AUDITOR, 9)).rejects.toThrow(/nadie cargo/);
    });

    it('sin resultado calculado avisa antes de firmar nada', async () => {
      mockInventario({ resultado: null });
      await expect(liquidar(AUDITOR, 9)).rejects.toThrow(/no tiene resultado/);
    });
  });

  /**
   * NADIE MARCO ASISTENCIA. El heredero del caso visto en la app el
   * 2026-09-05 (Luzuriaga, hojas finalizadas por script sin un solo conteo):
   * la planilla salia vacia, con "Cuota base (0 colaboradores)" y
   * "-2 colaboradores que si asistieron".
   *
   * Con la asistencia registrada el sintoma cambia de lado y por eso hay DOS
   * guardas, no una: sin dias no hay multa que calcular (y perdonarsela a
   * todos en silencio es firmar un numero que nadie reviso), y sin nadie que
   * complete el inventario el fondo no tiene a quien repartirse (y la empresa
   * se lo quedaria).
   */
  describe('sin un solo dia de asistencia registrado', () => {
    beforeEach(() => {
      // Un inventario cerrado ANTES de este cambio: quedo con 0 dias y sin
      // marcas. Para esos existe `prisma/rellenar-asistencia.ts`.
      mockInventario({ resultado: { ...resultadoCompleto, diasDelInventario: 0 } });
      prismaMock.asistenciaInventario.findMany.mockResolvedValue([]);
    });

    it('rechaza en vez de escribir una planilla sin una sola multa', async () => {
      // Con 0 dias la formula da multa 0 para TODOS. Para una planilla ya
      // firmada con la regla vieja eso es correcto; para una que se esta por
      // firmar ahora significa que nadie cargo la asistencia.
      await expect(liquidar(AUDITOR, 9)).rejects.toThrow(/ningún día de asistencia registrado/);
      expect(prismaMock.liquidacionColaborador.createMany).not.toHaveBeenCalled();
      expect(prismaMock.inventario.update).not.toHaveBeenCalled();
    });

    it('el mensaje dice la causa Y quien lo resuelve', async () => {
      const error = await liquidar(AUDITOR, 9).catch((e) => e);
      expect(error.message).toContain('sin días no hay multa que calcular ni fondo que repartir');
      expect(error.message).toMatch(/coordinador tiene que registrar la asistencia/);
    });
  });

  /**
   * NADIE COMPLETO EL INVENTARIO: a todos les falta aunque sea un dia.
   *
   * Todos pagan multa y nadie cobra bono, asi que la empresa recauda el fondo
   * y no lo redistribuye: la planilla sumaria `neto + fondo` y se le
   * descontaria de mas a TODO el personal. Es exactamente lo que el bono
   * existe para impedir.
   */
  describe('nadie cumplió los días del inventario', () => {
    beforeEach(() => {
      // Todos hicieron 2 de 3 dias.
      prismaMock.asistenciaInventario.findMany.mockResolvedValue(
        equipo(11).flatMap((c) => DIAS.slice(0, 2).map((dia) => ({ colaboradorId: c.id, dia }))),
      );
    });

    it('rechaza en vez de cobrarle el fondo entero a todo el personal', async () => {
      await expect(liquidar(AUDITOR, 9)).rejects.toThrow(/Ningún colaborador cumplió los 3 días/);
      expect(prismaMock.liquidacionColaborador.createMany).not.toHaveBeenCalled();
      expect(prismaMock.inventario.update).not.toHaveBeenCalled();
    });

    it('el mensaje dice CUANTA plata quedaria sin repartir', async () => {
      // 11 personas x 1 dia faltado x S/20. Que el monto viaje en el mensaje
      // es lo que convierte "no se puede" en algo accionable.
      const error = await liquidar(AUDITOR, 9).catch((e) => e);
      expect(error.message).toContain('S/220.00');
      expect(error.message).toMatch(/le descontaría ese monto de más a todo el personal/);
    });

    it('sin ninguna marca pero con dias congelados tampoco liquida', async () => {
      prismaMock.asistenciaInventario.findMany.mockResolvedValue([]);
      await expect(liquidar(AUDITOR, 9)).rejects.toThrow(/Ningún colaborador cumplió los 3 días/);
    });

    /**
     * Manda el numero que sale de las filas que se estan por escribir, no el
     * congelado en el resultado: si los dos discreparan, vale el recien
     * calculado.
     */
    it('aunque el resultado diga que asistieron 7, si las marcas dicen 0 no liquida', async () => {
      mockInventario({ resultado: { ...resultadoCompleto, colaboradoresAsistieron: 7 } });
      await expect(liquidar(AUDITOR, 9)).rejects.toThrow(/Ningún colaborador cumplió/);
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
      await liquidar(AUDITOR, 9);

      const { data } = prismaMock.liquidacionColaborador.createMany.mock.calls[0]![0] as { data: unknown[] };
      expect(data).toHaveLength(11);
    });

    it('el universo es el MISMO que colaboradoresAlcanzados, y solo roles de tienda', async () => {
      // Si estas dos consultas no coinciden, la cuota por persona no cierra
      // contra el faltante neto y nadie entiende por qué. El auditor y el
      // administrador NO son "de tienda" (decision del cliente) ni con un
      // sucursalId viejo en su ficha.
      await liquidar(AUDITOR, 9);

      expect(prismaMock.colaborador.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sucursalId: 1, activo: true, rol: { in: ['coordinador', 'conteo'] } },
        }),
      );
    });

    it('deja el inventario en liquidado', async () => {
      await liquidar(AUDITOR, 9);

      expect(prismaMock.inventario.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: { estado: 'liquidado' },
      });
    });

    /**
     * Planilla, estado Y la reclasificacion congelada, o ninguno de los
     * tres. Si el estado quedara en `liquidado` sin las filas, el lacrado --
     * que ahora EXIGE ese estado -- sellaría la planilla vacía que este
     * cambio existe para impedir; si la clasificacion quedara a medio
     * escribir, el reporte a gerencia y el sello leerían un
     * `DiferenciaItem.esEmpresa` que no es el que se uso para calcular la
     * planilla que se esta firmando.
     */
    it('planilla, estado y reclasificacion van en la MISMA transacción', async () => {
      await liquidar(AUDITOR, 9);

      const [arg] = prismaMock.$transaction.mock.calls[0] as [unknown];
      expect(Array.isArray(arg)).toBe(true);
      // liquidacionColaborador.createMany + inventario.update +
      // resultadoInventario.update + 1 updateMany por codigo en
      // `diferenciasPorDefecto` (uno solo, 'ITEM-EMPRESA').
      expect((arg as unknown[]).length).toBe(4);
    });

    it('si la transacción falla no queda nada, ni el registro de auditoría', async () => {
      prismaMock.$transaction.mockRejectedValue(new Error('conexión caída'));

      await expect(liquidar(AUDITOR, 9)).rejects.toThrow('conexión caída');
      const { registrarAuditoria } = await import('../../shared/auditoria');
      expect(registrarAuditoria).not.toHaveBeenCalled();
    });

    /**
     * LA INVARIANTE. `colaboradoresAsistieron` (cuántos, en el resultado) y
     * `asistio` (quién, en cada fila) salen de la MISMA lectura y la MISMA
     * regla. Si discreparan, la planilla repartiría el fondo de multas entre
     * un número de gente distinto del que lo generó -- y ese número lo firma
     * alguien.
     */
    it('la cantidad de asistio:true coincide con colaboradoresAsistieron', async () => {
      await liquidar(AUDITOR, 9);

      const { data } = prismaMock.liquidacionColaborador.createMany.mock.calls[0]![0] as {
        data: Array<{ asistio: boolean }>;
      };
      expect(data.filter((f) => f.asistio)).toHaveLength(resultadoCompleto.colaboradoresAsistieron);
    });

    describe('la regla del cliente, fila por fila', () => {
      it('quien hizo los 3 días tiene asistio: true y no paga multa', async () => {
        await liquidar(AUDITOR, 9);
        const { data } = prismaMock.liquidacionColaborador.createMany.mock.calls[0]![0] as {
          data: Array<{ colaboradorId: number; asistio: boolean; multaInasistencia: number }>;
        };
        const fila = data.find((f) => f.colaboradorId === 1);
        expect(fila?.asistio).toBe(true);
        expect(fila?.multaInasistencia).toBe(0);
      });

      /**
       * EL CAMBIO DE REGLA, en una fila: el 8 VINO (2 de los 3 dias) y aun asi
       * tiene `asistio: false`, porque ese booleano es "cumplio la asistencia
       * completa". Paga UN dia de multa, no la multa entera del ausente --
       * antes, faltar un dia costaba lo mismo que no aparecer nunca.
       */
      it('quien vino 2 de 3 días paga UN día de multa, no la multa entera', async () => {
        await liquidar(AUDITOR, 9);
        const { data } = prismaMock.liquidacionColaborador.createMany.mock.calls[0]![0] as {
          data: Array<{ colaboradorId: number; asistio: boolean; multaInasistencia: number }>;
        };
        const fila = data.find((f) => f.colaboradorId === 8);
        expect(fila?.asistio).toBe(false);
        expect(fila?.multaInasistencia).toBe(20);
      });

      it('la fila lleva los días que hizo, no solo el booleano', async () => {
        // Es el "2 de 3" que justifica la multa. Sin el, auditar S/20 con
        // tarifa 20 obliga a recontar marcas que pueden haber cambiado.
        await liquidar(AUDITOR, 9);
        const { data } = prismaMock.liquidacionColaborador.createMany.mock.calls[0]![0] as {
          data: Array<{ colaboradorId: number; diasAsistidos: number }>;
        };
        expect(data.find((f) => f.colaboradorId === 1)?.diasAsistidos).toBe(3);
        expect(data.find((f) => f.colaboradorId === 8)?.diasAsistidos).toBe(2);
      });

      it('quien no tiene NINGUNA marca también tiene fila, con multa completa', async () => {
        // El universo es "colaboradores activos de la sucursal", no "los que
        // marcaron". Dejarlo afuera seria no cobrarle la multa.
        prismaMock.asistenciaInventario.findMany.mockResolvedValue(
          marcasDeAsistencia.filter((m) => m.colaboradorId !== 11),
        );
        await liquidar(AUDITOR, 9);
        const { data } = prismaMock.liquidacionColaborador.createMany.mock.calls[0]![0] as {
          data: Array<{ colaboradorId: number; asistio: boolean; diasAsistidos: number; multaInasistencia: number }>;
        };
        const fila = data.find((f) => f.colaboradorId === 11);
        expect(fila).toMatchObject({ asistio: false, diasAsistidos: 0, multaInasistencia: 60 });
      });

      it('la asistencia usa la MISMA consulta que el cierre del conteo', async () => {
        // Dos queries distintas se desincronizan el dia que una filtra algo
        // que la otra no, y la planilla queda con un denominador distinto del
        // que se firmo en el resultado. Por eso `SELECT_ASISTENCIA` vive en un
        // solo lugar.
        await liquidar(AUDITOR, 9);
        expect(prismaMock.asistenciaInventario.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { inventarioId: 9 } }),
        );
      });
    });

    /**
     * LA INVARIANTE QUE HACE QUE LA VISTA PREVIA VALGA ALGO: lo que la
     * pantalla muestra ANTES de firmar es exactamente lo que se firma.
     *
     * Salen de la misma función (`proyectarPlanilla`), así que no pueden
     * discrepar por construcción. Este test fija que sigan siendo la misma:
     * el día que alguien duplique el cálculo "para la preview", la pantalla
     * mostraría una planilla y se firmaría otra, y nadie lo notaría hasta
     * que alguien compare su recibo con lo que vio en el teléfono.
     */
    it('la proyección y lo que se persiste son LAS MISMAS filas', async () => {
      const { planilla: proyectada } = await proyectarPlanilla(
        9,
        1,
        {
          montoFaltanteBruto: 1500,
          montoNegativos: 100,
          montoFaltanteEmpresa: 10,
          colaboradoresAlcanzados: 11,
          colaboradoresAsistieron: 7,
          multaInasistencia: 20,
        },
        3,
      );

      await liquidar(AUDITOR, 9);
      const { data: persistida } = prismaMock.liquidacionColaborador.createMany.mock.calls[0]![0] as {
        data: Array<Record<string, unknown>>;
      };

      // Se compara sin `inventarioId`, que lo agrega el que escribe.
      const sinInventario = persistida.map(({ inventarioId: _i, ...resto }) => resto);
      expect(sinInventario).toEqual(proyectada);
    });

    it('el total descontado cuadra con la suma de la planilla', async () => {
      const cierre = await liquidar(AUDITOR, 9);

      const { data } = prismaMock.liquidacionColaborador.createMany.mock.calls[0]![0] as {
        data: Array<{ cuotaBase: number; multaInasistencia: number; bonoAsistencia: number }>;
      };
      const suma = data.reduce((total, f) => total + calcularTotalDescuento(f), 0);
      expect(cierre.totalDescontado).toBeCloseTo(suma, 2);
    });
  });
});
