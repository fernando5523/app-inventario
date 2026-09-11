import { describe, expect, it } from 'vitest';
import {
  armarContenidoLacrado,
  armarFolio,
  calcularHash,
  parsearAprobacionesRequeridas,
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

  /**
   * REGRESION liquidacion v2 (2026-09): el inventario 45 (folio
   * INV-2026-09-CON-10-9A8) se lacro en formato v1, ANTES de que existieran
   * `montoSobranteEmpleado`/`esEmpresa`. Verificarlo HOY -- con el codigo que
   * ya sabe de esos dos campos -- tiene que seguir dando `intacto: true`.
   */
  it('un sello v1 (inventario 45) sigue verificando intacto aunque el codigo ya sepa de liquidacion v2', () => {
    // Lo sellado en su momento: version 1, SIN los campos nuevos siquiera
    // declarados (asi era DatosLacrado antes de esta funcionalidad).
    const selladoEnV1 = armarContenidoLacrado(BASE, 1);
    const hashDelSello = calcularHash(selladoEnV1);

    // Hoy, `armarDatosLacrado` (historial.service.ts) SIEMPRE lee las
    // columnas nuevas de la base -- para un inventario viejo, vienen NULL /
    // el default `false`. La reconstruccion para VERIFICAR tiene que pedirse
    // en version 1 (la que dice `lacrado.contenido.version`), no la ultima.
    const datosDeHoy: DatosLacrado = {
      ...BASE,
      resultado: { ...BASE.resultado!, montoSobranteEmpleado: null },
      diferencias: BASE.diferencias.map((d) => ({ ...d, esEmpresa: false })),
    };
    const reconstruidoEnV1 = armarContenidoLacrado(datosDeHoy, 1);

    const v = verificarLacrado(selladoEnV1, hashDelSello, reconstruidoEnV1);
    expect(v.intacto).toBe(true);
    expect(v.seccionesAlteradas).toEqual([]);
  });

  it('la MISMA reconstruccion en v2 (el error que hay que evitar) SI rompe el hash de un sello v1', () => {
    // Documenta por que `verificarSello` tiene que leer la version guardada
    // y no siempre la ultima: si lo hiciera, esto es lo que pasaria.
    const selladoEnV1 = armarContenidoLacrado(BASE, 1);
    const hashDelSello = calcularHash(selladoEnV1);
    const reconstruidoEnV2 = armarContenidoLacrado(BASE, 2);

    expect(verificarLacrado(selladoEnV1, hashDelSello, reconstruidoEnV2 as ContenidoLacrado).intacto).toBe(false);
  });
});

describe('armarContenidoLacrado: version 2 (liquidacion v2)', () => {
  const conCamposNuevos: DatosLacrado = {
    ...BASE,
    resultado: { ...BASE.resultado!, montoSobranteEmpleado: 200 },
    diferencias: [
      { ...BASE.diferencias[0]!, esEmpresa: true },
      { ...BASE.diferencias[1]!, esEmpresa: false },
    ],
  };

  it('v1 NO incluye los campos nuevos en la forma CANONICA del contenido, ni aunque `datos` los traiga', () => {
    // Las claves quedan como `undefined` en el objeto JS (asi las descarta
    // `serializarCanonico`, ver su comentario) -- lo que importa para el
    // hash es la cadena canonica, no `Object.keys` en crudo.
    const v1 = armarContenidoLacrado(conCamposNuevos, 1);
    expect(serializarCanonico(v1)).not.toContain('montoSobranteEmpleado');
    expect(serializarCanonico(v1)).not.toContain('esEmpresa');
    // Y da EXACTAMENTE el mismo hash que si `datos` nunca hubiera tenido
    // esos campos -- la prueba real de que v1 es indiferente a ellos.
    expect(calcularHash(v1)).toBe(calcularHash(armarContenidoLacrado(BASE, 1)));
  });

  it('v2 SI los incluye, y el hash cambia si el sobrante cambia', () => {
    const v2 = armarContenidoLacrado(conCamposNuevos, 2);
    expect((v2['resultado'] as Record<string, unknown>)['montoSobranteEmpleado']).toBe(200);

    const otroSobrante: DatosLacrado = { ...conCamposNuevos, resultado: { ...conCamposNuevos.resultado!, montoSobranteEmpleado: 0 } };
    expect(calcularHash(armarContenidoLacrado(otroSobrante, 2))).not.toBe(calcularHash(armarContenidoLacrado(conCamposNuevos, 2)));
  });

  it('v2 sella la clasificacion empresa/empleado: reclasificar un item cambia el hash', () => {
    const reclasificado: DatosLacrado = {
      ...conCamposNuevos,
      diferencias: [{ ...conCamposNuevos.diferencias[0]!, esEmpresa: false }, conCamposNuevos.diferencias[1]!],
    };
    expect(calcularHash(armarContenidoLacrado(reclasificado, 2))).not.toBe(
      calcularHash(armarContenidoLacrado(conCamposNuevos, 2)),
    );
  });

  it('sin version explicita, usa la ultima (VERSION_CONTENIDO_LACRADO)', () => {
    expect((armarContenidoLacrado(conCamposNuevos) as { version: number }).version).toBe(VERSION_CONTENIDO_LACRADO);
    expect(VERSION_CONTENIDO_LACRADO).toBe(2);
  });
});

/**
 * CONFIGURABLE (decision del cliente 2026-09-10): "por ahora" el lacrado se
 * firma con UNA sola firma -- hoy hay un solo auditor real (Gilmer) y exigir
 * dos bloqueaba el cierre para siempre. Pura, sin tocar `process.env`: lo
 * unico que hace `APROBACIONES_REQUERIDAS` (el valor real que usa
 * historial.service.ts) es llamar a esto con
 * `process.env.LACRADO_APROBACIONES_REQUERIDAS`.
 */
describe('parsearAprobacionesRequeridas', () => {
  it('sin la variable seteada (undefined), el default es 1 -- el proceso real de hoy', () => {
    expect(parsearAprobacionesRequeridas(undefined)).toBe(1);
  });

  it('vacia o solo espacios, mismo default que undefined', () => {
    expect(parsearAprobacionesRequeridas('')).toBe(1);
    expect(parsearAprobacionesRequeridas('   ')).toBe(1);
  });

  it('"1" explicito da 1', () => {
    expect(parsearAprobacionesRequeridas('1')).toBe(1);
  });

  it('"2" explicito da 2 -- el dia que entre una segunda cuenta de auditor, alcanza con este numero', () => {
    expect(parsearAprobacionesRequeridas('2')).toBe(2);
  });

  it('acepta cualquier entero positivo, no solo 1 o 2', () => {
    expect(parsearAprobacionesRequeridas('5')).toBe(5);
  });

  it('rechaza 0: hace falta AL MENOS una firma, siempre', () => {
    expect(() => parsearAprobacionesRequeridas('0')).toThrow(/LACRADO_APROBACIONES_REQUERIDAS invalido/);
  });

  it('rechaza negativos', () => {
    expect(() => parsearAprobacionesRequeridas('-1')).toThrow(/LACRADO_APROBACIONES_REQUERIDAS invalido/);
  });

  it('rechaza no-enteros', () => {
    expect(() => parsearAprobacionesRequeridas('1.5')).toThrow(/LACRADO_APROBACIONES_REQUERIDAS invalido/);
  });

  it('rechaza texto que no es un numero', () => {
    expect(() => parsearAprobacionesRequeridas('dos')).toThrow(/LACRADO_APROBACIONES_REQUERIDAS invalido/);
  });

  it('el mensaje de error cita el valor invalido tal cual vino, para poder corregirlo en el .env', () => {
    expect(() => parsearAprobacionesRequeridas('abc')).toThrow(/"abc"/);
  });
});
