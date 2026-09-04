import { describe, expect, it } from 'vitest';
import {
  armarContenidoLacrado,
  armarFolio,
  calcularHash,
  serializarCanonico,
  siglaSucursal,
  verificarLacrado,
  VERSION_CONTENIDO_LACRADO,
  type ContenidoLacrado,
  type DatosLacrado,
} from './historial.lacrado';

const BASE: DatosLacrado = {
  inventarioId: 7,
  sucursalId: 1,
  sucursalNombre: 'Market Central Luzuriaga',
  periodoAnio: 2026,
  periodoMes: 8,
  tamanoHoja: 50,
  snapshotItems: 8000,
  snapshotTomadoEn: '2026-08-01T09:00:00.000Z',
  cerradoEn: '2026-08-28T18:00:00.000Z',
  resultado: {
    itemsTotales: 8000,
    itemsConDiferencia: 130,
    itemsSegundoConteo: 650,
    itemsTercerConteo: 130,
    unidadesFaltantes: 412,
    unidadesSobrantes: 55,
    montoFaltanteBruto: 1850,
    montoNegativos: 310,
    montoFaltanteEmpresa: 150,
    colaboradoresAlcanzados: 11,
    colaboradoresAsistieron: 8,
    multaInasistencia: 20,
  },
  diferencias: [
    { codigo: 'IT-0002', stockSistema: 10, conteoFinal: 8, diferencia: -2, resueltoEnConteo: 3, montoDiferencia: -8 },
    { codigo: 'IT-0001', stockSistema: 5, conteoFinal: 7, diferencia: 2, resueltoEnConteo: 2, montoDiferencia: 9.5 },
  ],
  liquidaciones: [
    { colaboradorId: 20, asistio: false, cuotaBase: 126.36, multaInasistencia: 20, bonoAsistencia: 0 },
    { colaboradorId: 10, asistio: true, cuotaBase: 126.36, multaInasistencia: 0, bonoAsistencia: 7.5 },
  ],
  aprobaciones: [
    { aprobadorId: 30, rolAlAprobar: 'auditor', aprobadoEn: '2026-08-29T10:00:00.000Z' },
    { aprobadorId: 12, rolAlAprobar: 'auditor', aprobadoEn: '2026-08-29T09:00:00.000Z' },
  ],
};

describe('serializarCanonico', () => {
  it('ordena las claves de un objeto: el mismo dato da la misma cadena', () => {
    expect(serializarCanonico({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(serializarCanonico({ a: 1, b: 2 })).toBe(serializarCanonico({ b: 2, a: 1 }));
  });

  it('ordena tambien en objetos anidados', () => {
    expect(serializarCanonico({ x: { z: 1, y: 2 } })).toBe('{"x":{"y":2,"z":1}}');
  });

  it('NO reordena arrays: ahi el orden es parte del dato', () => {
    expect(serializarCanonico([3, 1, 2])).toBe('[3,1,2]');
  });

  it('descarta las claves undefined, que no sobreviven a un round-trip por JSON', () => {
    expect(serializarCanonico({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('maneja null y primitivos', () => {
    expect(serializarCanonico(null)).toBe('null');
    expect(serializarCanonico(42)).toBe('42');
    expect(serializarCanonico('hola')).toBe('"hola"');
  });
});

describe('calcularHash', () => {
  it('devuelve 64 caracteres hexadecimales (sha256)', () => {
    expect(calcularHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el mismo contenido en otro orden de claves da EL MISMO hash', () => {
    // Sin esto, la verificacion daria falsos positivos cada vez que Prisma
    // devolviera las columnas en otro orden.
    expect(calcularHash({ a: 1, b: 2 })).toBe(calcularHash({ b: 2, a: 1 }));
  });

  it('un cambio minimo cambia el hash', () => {
    expect(calcularHash({ a: 1 })).not.toBe(calcularHash({ a: 2 }));
  });
});

describe('armarContenidoLacrado', () => {
  const contenido = armarContenidoLacrado(BASE);

  it('ordena los tres arrays para no depender del orden que devuelva la query', () => {
    expect((contenido['diferencias'] as Array<{ codigo: string }>).map((d) => d.codigo)).toEqual([
      'IT-0001',
      'IT-0002',
    ]);
    expect((contenido['liquidaciones'] as Array<{ colaboradorId: number }>).map((l) => l.colaboradorId)).toEqual([
      10, 20,
    ]);
    expect((contenido['aprobaciones'] as Array<{ aprobadorId: number }>).map((a) => a.aprobadorId)).toEqual([12, 30]);
  });

  it('el mismo inventario con los arrays desordenados da el mismo hash', () => {
    const alReves: DatosLacrado = {
      ...BASE,
      diferencias: [...BASE.diferencias].reverse(),
      liquidaciones: [...BASE.liquidaciones].reverse(),
      aprobaciones: [...BASE.aprobaciones].reverse(),
    };
    expect(calcularHash(armarContenidoLacrado(alReves))).toBe(calcularHash(contenido));
  });

  it('sella la planilla de liquidacion, no solo los conteos', () => {
    // Si el sello no cubriera la planilla, se podria cambiar el descuento de
    // una persona despues del cierre sin que el hash se entere -- y es la
    // parte que le importa al colaborador.
    const conOtroDescuento: DatosLacrado = {
      ...BASE,
      liquidaciones: [{ ...BASE.liquidaciones[0]!, cuotaBase: 999 }, BASE.liquidaciones[1]!],
    };
    expect(calcularHash(armarContenidoLacrado(conOtroDescuento))).not.toBe(calcularHash(contenido));
  });

  it('sella quien aprobo: cambiar un aprobador cambia el hash', () => {
    const otroFirmante: DatosLacrado = {
      ...BASE,
      aprobaciones: [BASE.aprobaciones[0]!, { ...BASE.aprobaciones[1]!, aprobadorId: 99 }],
    };
    expect(calcularHash(armarContenidoLacrado(otroFirmante))).not.toBe(calcularHash(contenido));
  });

  it('lleva la version del formato adentro del contenido', () => {
    expect(contenido['version']).toBe(VERSION_CONTENIDO_LACRADO);
  });
});

describe('siglaSucursal', () => {
  it('toma la ultima palabra significativa, no las primeras letras del nombre', () => {
    // Las cuatro tiendas empiezan con "Market": usar el prefijo daria "MAR"
    // para todas y el folio no distinguiria nada.
    expect(siglaSucursal('Market Central Luzuriaga')).toBe('LUZ');
    expect(siglaSucursal('Market Carhuaz')).toBe('CAR');
    expect(siglaSucursal('Market Sucre')).toBe('SUC');
  });

  it('saca las tildes: la sigla va en un identificador ASCII', () => {
    expect(siglaSucursal('Market Bolívar')).toBe('BOL');
  });

  it('rellena cuando el nombre es mas corto que 3 letras', () => {
    expect(siglaSucursal('Market A')).toBe('AXX');
  });

  it('no se queda sin nada si el nombre es solo palabras genericas', () => {
    expect(siglaSucursal('Market')).toBe('MAR');
  });
});

describe('armarFolio', () => {
  it('arma el formato que ya validó el cliente en la maqueta', () => {
    const folio = armarFolio({
      periodoAnio: 2026,
      periodoMes: 8,
      sucursalNombre: 'Market Central Luzuriaga',
      items: 8000,
      hash: 'k99abc0000000000000000000000000000000000000000000000000000000000',
    });
    expect(folio).toBe('INV-2026-08-LUZ-8000-K99');
  });

  it('rellena el mes a dos digitos', () => {
    const folio = armarFolio({
      periodoAnio: 2026,
      periodoMes: 1,
      sucursalNombre: 'Market Carhuaz',
      items: 927,
      hash: 'abc0000000000000000000000000000000000000000000000000000000000000',
    });
    expect(folio).toBe('INV-2026-01-CAR-927-ABC');
  });
});

describe('verificarLacrado', () => {
  const contenido = armarContenidoLacrado(BASE);
  const hash = calcularHash(contenido);

  it('reporta intacto cuando nada se movio', () => {
    const v = verificarLacrado(contenido, hash, contenido);
    expect(v.intacto).toBe(true);
    expect(v.seccionesAlteradas).toEqual([]);
    expect(v.versionDistinta).toBe(false);
  });

  it('detecta que se altero una diferencia DESPUES del lacrado, y dice donde', () => {
    const alterado = armarContenidoLacrado({
      ...BASE,
      diferencias: [{ ...BASE.diferencias[0]!, conteoFinal: 999 }, BASE.diferencias[1]!],
    });
    const v = verificarLacrado(contenido, hash, alterado);
    expect(v.intacto).toBe(false);
    expect(v.seccionesAlteradas).toEqual(['diferencias']);
    expect(v.hashGuardado).not.toBe(v.hashRecalculado);
  });

  it('detecta que se toco la planilla de liquidacion', () => {
    const alterado = armarContenidoLacrado({
      ...BASE,
      liquidaciones: [{ ...BASE.liquidaciones[0]!, multaInasistencia: 0 }, BASE.liquidaciones[1]!],
    });
    expect(verificarLacrado(contenido, hash, alterado).seccionesAlteradas).toEqual(['liquidaciones']);
  });

  it('lista TODAS las secciones alteradas, no solo la primera', () => {
    const alterado = armarContenidoLacrado({
      ...BASE,
      tamanoHoja: 30,
      resultado: { ...BASE.resultado!, unidadesFaltantes: 0 },
    });
    const v = verificarLacrado(contenido, hash, alterado);
    expect(v.seccionesAlteradas).toEqual(['resultado', 'tamanoHoja']);
  });

  it('avisa cuando el sello viejo tiene otra version de formato', () => {
    const viejo = { ...contenido, version: 0 } as unknown as Record<string, unknown>;
    const v = verificarLacrado(viejo, hash, contenido as ContenidoLacrado);
    expect(v.versionDistinta).toBe(true);
  });
});
