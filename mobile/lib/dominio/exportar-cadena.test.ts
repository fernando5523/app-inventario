import { describe, expect, it } from 'vitest';

import type { EstadoInventario, ResumenPorClase, ResumenTiendaCadena, TotalCadena } from '../puertos/repositorios';
import { estadoExportacionCadena, nombreCadenaDeRespaldo, notaExportacionCadena } from './exportar-cadena';

const PLANO: ResumenPorClase = {
  unidad: { items: 0, unidadesFaltantes: 0, unidadesSobrantes: 0, valorFaltante: 0, valorSobrante: 0 },
  paquete: { items: 0, unidadesFaltantes: 0, unidadesSobrantes: 0, valorFaltante: 0, valorSobrante: 0 },
  empresa: { items: 0, unidadesFaltantes: 0, unidadesSobrantes: 0, valorFaltante: 0, valorSobrante: 0 },
};

/** Un total de cadena con lo mínimo para decidir; cada test mueve lo que mide. */
function total(parcial: Partial<TotalCadena> = {}): TotalCadena {
  return {
    tiendas: 4,
    conInventario: 2,
    items: 1000,
    cuadrados: 940,
    auditables: 985,
    valorFaltante: 0,
    valorSobrante: 0,
    valorADescontar: 0,
    porClase: PLANO,
    ...parcial,
  };
}

function tienda(estado: EstadoInventario | null): ResumenTiendaCadena {
  return {
    sucursalId: 1,
    sucursal: 'Market Luzuriaga',
    inventarioId: estado === null ? null : 8078,
    estado,
    items: 985,
    auditables: 985,
    cuadrados: 940,
    valorFaltante: 0,
    valorSobrante: 0,
    valorADescontar: 0,
    porClase: PLANO,
  };
}

describe('cuándo se puede bajar el detalle por producto de la cadena', () => {
  it('con tiendas contadas y alguna sin cuadrar, se puede', () => {
    expect(estadoExportacionCadena(total())).toEqual({ puedeExportar: true });
  });

  /**
   * LA DIFERENCIA DELIBERADA con la planilla de cuadros, que sí se bloquea en
   * `ajuste_auditor`: este archivo es la herramienta CON la que se hace el
   * ajuste. Apagarlo ahí lo esconde justo en el único momento en que se usa.
   */
  it('con una tienda en medio del ajuste SE PUEDE, y la salvedad la dice la nota', () => {
    expect(estadoExportacionCadena(total())).toEqual({ puedeExportar: true });
    expect(notaExportacionCadena([tienda('ajuste_auditor')])).toContain('Una tienda');
  });

  it('sin ninguna tienda con inventario del período NO se puede, y el motivo lo dice', () => {
    const r = estadoExportacionCadena(total({ conInventario: 0, auditables: 0, cuadrados: 0 }));
    expect(r.puedeExportar).toBe(false);
    if (r.puedeExportar) return;
    expect(r.motivo).toContain('abrió el inventario');
  });

  /**
   * EL VACÍO LEÍDO COMO ÉXITO -- el error más caro que tuvo esta app. Sin un
   * solo ítem comparable, una tabla plana sin filas afirma "no falta nada".
   */
  it('con tiendas abiertas pero sin un solo ítem auditable NO se puede', () => {
    const r = estadoExportacionCadena(total({ auditables: 0, cuadrados: 0 }));
    expect(r.puedeExportar).toBe(false);
    if (r.puedeExportar) return;
    expect(r.motivo).toContain('no falta nada');
  });

  /** Cuadró TODO: no es un "todavía", es un resultado, y se dice como resultado. */
  it('con todo cuadrado NO se puede, y el motivo lo dice como resultado', () => {
    const r = estadoExportacionCadena(total({ cuadrados: 985, auditables: 985 }));
    expect(r.puedeExportar).toBe(false);
    if (r.puedeExportar) return;
    expect(r.motivo).toContain('cuadraron');
  });

  /**
   * `cuadrados > auditables` no debería pasar, pero si pasara el archivo
   * saldría igual de vacío: se bloquea por el MISMO motivo, no se deja pasar
   * por una comparación estricta.
   */
  it('si los cuadrados superan a los auditables tampoco se puede', () => {
    expect(estadoExportacionCadena(total({ cuadrados: 990, auditables: 985 })).puedeExportar).toBe(false);
  });
});

describe('la salvedad de las tiendas que todavía se mueven', () => {
  it('sin ninguna tienda abierta no hay nada que aclarar', () => {
    expect(notaExportacionCadena([tienda('conteo_cerrado'), tienda('lacrado')])).toBeNull();
  });

  it('las tiendas sin inventario no cuentan como abiertas', () => {
    expect(notaExportacionCadena([tienda(null), tienda('lacrado')])).toBeNull();
  });

  /** Cuántas, no un "puede cambiar" genérico: con diez tiendas, dos y nueve
   *  son decisiones distintas sobre mandar el archivo o esperar. */
  it('dice cuántas tiendas siguen contando o ajustando', () => {
    const nota = notaExportacionCadena([
      tienda('en_curso'),
      tienda('ajuste_auditor'),
      tienda('lacrado'),
      tienda(null),
    ]);
    expect(nota).toContain('2 tiendas');
  });
});

describe('el nombre de respaldo', () => {
  /** El mes con dos dígitos: sin eso, "2026-9" ordena mal en una carpeta. */
  it('nombra el período con el mes en dos dígitos', () => {
    expect(nombreCadenaDeRespaldo(2026, 9)).toBe('diferencias-cadena-2026-09.xlsx');
    expect(nombreCadenaDeRespaldo(2026, 12)).toBe('diferencias-cadena-2026-12.xlsx');
  });
});
