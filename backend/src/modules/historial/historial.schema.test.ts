import { describe, expect, it } from 'vitest';
import {
  aprobarCierreSchema,
  comparativoQuerySchema,
  historicoItemQuerySchema,
  lacrarSchema,
  listarDiferenciasQuerySchema,
  listarInventariosQuerySchema,
  parametrosInventarioSchema,
  parametrosItemSchema,
  registrarEnErpSchema,
} from './historial.schema';

// ---------------------------------------------------------------------------
// EL BODY NO DECLARA QUIEN FIRMA
// ---------------------------------------------------------------------------

describe('aprobarCierreSchema', () => {
  it('acepta un body vacio: quien aprueba sale de la sesion', () => {
    expect(aprobarCierreSchema.safeParse({}).success).toBe(true);
  });

  it('acepta una nota opcional', () => {
    const r = aprobarCierreSchema.safeParse({ nota: 'Aprobado con reserva por el faltante de cervezas.' });
    expect(r.success).toBe(true);
  });

  it('RECHAZA un aprobadorId en el body en vez de ignorarlo en silencio', () => {
    // Este es el agujero que cerramos: hasta ahora un auditor podia mandar el
    // id del otro y firmar por el. Ahora falla con 400, y falla RUIDOSAMENTE
    // -- si se ignorara callado, el cliente se quedaria creyendo que firmo.
    const r = aprobarCierreSchema.safeParse({ aprobadorId: 30 });
    expect(r.success).toBe(false);
  });

  it('rechaza cualquier otro intento de declarar identidad', () => {
    expect(aprobarCierreSchema.safeParse({ colaboradorId: 30 }).success).toBe(false);
    expect(aprobarCierreSchema.safeParse({ rolAlAprobar: 'auditor' }).success).toBe(false);
    expect(aprobarCierreSchema.safeParse({ nota: 'ok', aprobadorId: 30 }).success).toBe(false);
  });

  it('rechaza una nota vacia: si mandas nota, que diga algo', () => {
    expect(aprobarCierreSchema.safeParse({ nota: '   ' }).success).toBe(false);
  });
});

describe('lacrarSchema', () => {
  it('acepta un body vacio', () => {
    expect(lacrarSchema.safeParse({}).success).toBe(true);
  });

  it('rechaza que el cliente declare el contenido a sellar', () => {
    // Aceptarlo seria dejar que el sellado declare lo que quiere haber
    // sellado. El contenido lo arma el backend leyendo el inventario.
    expect(lacrarSchema.safeParse({ hash: 'abc' }).success).toBe(false);
    expect(lacrarSchema.safeParse({ contenido: {} }).success).toBe(false);
    expect(lacrarSchema.safeParse({ lacradoPorId: 12 }).success).toBe(false);
  });
});

describe('registrarEnErpSchema', () => {
  it('acepta una referencia del asiento del ERP', () => {
    expect(registrarEnErpSchema.safeParse({ referencia: 'AJ-2026-08-114' }).success).toBe(true);
  });

  it('acepta body vacio', () => {
    expect(registrarEnErpSchema.safeParse({}).success).toBe(true);
  });

  it('rechaza que se declare quien registro', () => {
    expect(registrarEnErpSchema.safeParse({ registradoPorId: 12 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Filtros de lectura
// ---------------------------------------------------------------------------

describe('listarInventariosQuerySchema', () => {
  it('trae defaults de paginacion sin que el cliente los mande', () => {
    const r = listarInventariosQuerySchema.parse({});
    expect(r.limite).toBe(24);
    expect(r.desplazamiento).toBe(0);
  });

  it('coerce los numeros que llegan como string en el query', () => {
    const r = listarInventariosQuerySchema.parse({ sucursalId: '1', periodoAnio: '2026', periodoMes: '8' });
    expect(r.sucursalId).toBe(1);
    expect(r.periodoAnio).toBe(2026);
    expect(r.periodoMes).toBe(8);
  });

  it('acepta los 5 estados reales y rechaza cualquier otro', () => {
    expect(listarInventariosQuerySchema.safeParse({ estado: 'lacrado' }).success).toBe(true);
    expect(listarInventariosQuerySchema.safeParse({ estado: 'cerrado' }).success).toBe(false);
  });

  it('rechaza un mes fuera del calendario', () => {
    expect(listarInventariosQuerySchema.safeParse({ periodoMes: 13 }).success).toBe(false);
    expect(listarInventariosQuerySchema.safeParse({ periodoMes: 0 }).success).toBe(false);
  });

  it('pone techo al limite para que nadie pida los 8.000 de una', () => {
    expect(listarInventariosQuerySchema.safeParse({ limite: 500 }).success).toBe(false);
  });
});

describe('listarDiferenciasQuerySchema', () => {
  it('filtra por faltante o sobrante', () => {
    expect(listarDiferenciasQuerySchema.safeParse({ tipo: 'faltante' }).success).toBe(true);
    expect(listarDiferenciasQuerySchema.safeParse({ tipo: 'ninguno' }).success).toBe(false);
  });

  it('la ronda de reconteo va de 1 a 3 (no hay 4to conteo)', () => {
    expect(listarDiferenciasQuerySchema.safeParse({ resueltoEnConteo: 3 }).success).toBe(true);
    expect(listarDiferenciasQuerySchema.safeParse({ resueltoEnConteo: 4 }).success).toBe(false);
  });

  it('pagina por defecto de a 100', () => {
    expect(listarDiferenciasQuerySchema.parse({}).limite).toBe(100);
  });
});

describe('parametrosInventarioSchema', () => {
  it('coerce el id de la ruta', () => {
    expect(parametrosInventarioSchema.parse({ id: '7' }).id).toBe(7);
  });

  it('rechaza ids no positivos o no numericos', () => {
    expect(parametrosInventarioSchema.safeParse({ id: '0' }).success).toBe(false);
    expect(parametrosInventarioSchema.safeParse({ id: 'abc' }).success).toBe(false);
  });
});

describe('parametrosItemSchema', () => {
  it('acepta un ItemNumber de Dynamics', () => {
    expect(parametrosItemSchema.parse({ codigo: 'IT-00042' }).codigo).toBe('IT-00042');
  });

  it('rechaza un codigo vacio', () => {
    expect(parametrosItemSchema.safeParse({ codigo: '  ' }).success).toBe(false);
  });
});

describe('historicoItemQuerySchema', () => {
  it('acepta un rango de anios', () => {
    const r = historicoItemQuerySchema.parse({ desdeAnio: '2025', hastaAnio: '2026' });
    expect(r.desdeAnio).toBe(2025);
    expect(r.hastaAnio).toBe(2026);
  });
});

describe('comparativoQuerySchema', () => {
  it('acepta un rango coherente', () => {
    expect(comparativoQuerySchema.safeParse({ desdeAnio: 2025, hastaAnio: 2026 }).success).toBe(true);
  });

  it('rechaza un rango invertido en vez de devolver una serie vacia sin explicacion', () => {
    expect(comparativoQuerySchema.safeParse({ desdeAnio: 2026, hastaAnio: 2025 }).success).toBe(false);
  });
});
