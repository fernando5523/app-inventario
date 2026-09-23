import { describe, expect, it } from 'vitest';

import {
  conteoFinal,
  diferenciaUnidades,
  resumirAuditoria,
  rondasNecesarias,
  veredicto,
  cuadroDelItem,
  pagaLaEmpresa,
  textoEmpaqueUsado,
  textoPorQueCuadro,
} from './auditoria';
import type { AtribucionItem, ItemAuditoria } from './tipos';

let sig = 0;
/** Un ItemAuditoria mínimo; por defecto con ERP y SIN ningún conteo. */
function item(over: Partial<ItemAuditoria> = {}): ItemAuditoria {
  sig += 1;
  return {
    productoId: sig,
    codigo: `C${sig}`,
    descripcion: `Producto ${sig}`,
    zona: 'A',
    hoja: '001',
    precioVenta: 2,
    stockErp: 10,
    conteos: [null, null, null],
    atribucion: atribucion(),
    esEmpresa: false,
    ...over,
  };
}

/** El reparto que resuelve el servidor. Por default, nada que repartir. */
function atribucion(over: Partial<AtribucionItem> = {}): AtribucionItem {
  return {
    clase: 'unidad',
    empaqueUsado: null,
    empaqueSimbolo: null,
    empaqueEsCorregido: false,
    razon: null,
    unidadesAlPersonal: 0,
    unidadesAPaquetes: 0,
    unidadesAEmpresa: 0,
    ...over,
  };
}

describe('veredicto — "no sé" no es "cero"', () => {
  it('sin ningún conteo NO es cuadrado: es sin_contar (el bug del cliente)', () => {
    // Un ítem del catálogo con stock del ERP pero que nadie contó todavía.
    expect(veredicto(item({ stockErp: 10 }))).toBe('sin_contar');
  });

  it('sin stock del ERP es sin_erp, aunque esté contado', () => {
    expect(veredicto(item({ conteos: [5], stockErp: null }))).toBe('sin_erp');
  });

  it('sin_erp gana a sin_contar cuando faltan los dos lados', () => {
    expect(veredicto(item({ stockErp: null }))).toBe('sin_erp');
  });

  it('cuadrado solo cuando el conteo final coincide de verdad con el ERP', () => {
    expect(veredicto(item({ conteos: [10], stockErp: 10 }))).toBe('cuadrado');
    expect(veredicto(item({ conteos: [10, 9, 10], stockErp: 10 }))).toBe('cuadrado');
  });

  it('con diferencia: falta, o empresa si la asume gerencia', () => {
    expect(veredicto(item({ conteos: [null, null, 8], stockErp: 10 }))).toBe('falta');
    expect(veredicto(item({ conteos: [null, null, 13], stockErp: 10 }))).toBe('falta'); // sobrante también es "falta"
    expect(veredicto(item({ conteos: [null, null, 8], stockErp: 10, esEmpresa: true }))).toBe('empresa');
  });
});

describe('diferenciaUnidades — null cuando falta un lado, nunca 0', () => {
  it('sin conteo devuelve null (no 0)', () => {
    expect(diferenciaUnidades(item({ stockErp: 10 }))).toBeNull();
  });
  it('sin ERP devuelve null', () => {
    expect(diferenciaUnidades(item({ conteos: [5], stockErp: null }))).toBeNull();
  });
  it('con ambos lados, es conteoFinal - stockErp', () => {
    expect(diferenciaUnidades(item({ conteos: [null, null, 7], stockErp: 10 }))).toBe(-3);
    expect(diferenciaUnidades(item({ conteos: [null, null, 13], stockErp: 10 }))).toBe(3);
  });
});

describe('rondasNecesarias — la ronda REAL, nunca un default a la 3ra', () => {
  it('sin contar es 0, no 3', () => {
    expect(rondasNecesarias(item())).toBe(0);
  });
  it('la última ronda con conteo', () => {
    expect(rondasNecesarias(item({ conteos: [10] }))).toBe(1);
    expect(rondasNecesarias(item({ conteos: [9, 10] }))).toBe(2);
    expect(rondasNecesarias(item({ conteos: [9, 9, 10] }))).toBe(3);
  });
  it('conteoFinal acompaña a rondasNecesarias', () => {
    expect(conteoFinal(item({ conteos: [9, 10] }))).toBe(10);
    expect(conteoFinal(item())).toBeNull();
  });
});

describe('resumirAuditoria — resumen honesto', () => {
  it('EL CASO DEL CLIENTE: 10 ítems de catálogo, CERO conteos -> ningún cuadrado', () => {
    const items = Array.from({ length: 10 }, () => item({ stockErp: 5 }));
    const r = resumirAuditoria(items);

    expect(r.total).toBe(10);
    expect(r.contados).toBe(0);
    expect(r.sinContar).toBe(10); // los 10 sin contar
    expect(r.sinDatoErp).toBe(0);
    expect(r.auditables).toBe(0); // nada auditable todavía
    expect(r.cuadrados).toBe(0); // NADIE cuadró — el vacío ya no se lee como éxito
    expect(r.conDiferencia).toBe(0);
    expect(r.faltanteNeto).toBe(0);
    expect(r.sobranteNeto).toBe(0);
    // Y ni un solo ítem con veredicto 'cuadrado'.
    expect([...r.veredictoPorId.values()].every((v) => v === 'sin_contar')).toBe(true);
  });

  it('MIXTO: algunos contados y otros no -> cada cifra cuenta lo suyo', () => {
    const items = [
      item({ conteos: [null, null, 10], productoId: 1, stockErp: 10 }), // cuadrado
      item({ conteos: [null, null, 7], productoId: 2, stockErp: 10 }), //  falta (-3)
      item({ conteos: [null, null, 13], productoId: 3, stockErp: 10 }), // sobrante (+3)
      item({ conteos: [null, null, 6], productoId: 4, stockErp: 10, esEmpresa: true }), // empresa (-4)
      item({ productoId: 5, stockErp: 10 }), //               sin_contar
      item({ conteos: [null, null, 5], productoId: 6, stockErp: null }), //  sin_erp (pero contado)
      item({ conteos: [null, null, 10], productoId: 7, stockErp: 10, precioVenta: 3 }), // cuadrado
    ];
    const r = resumirAuditoria(items);

    expect(r.total).toBe(7);
    expect(r.contados).toBe(6); // todos menos el #5
    expect(r.sinContar).toBe(1); // #5
    expect(r.sinDatoErp).toBe(1); // #6
    expect(r.auditables).toBe(5); // #1,2,3,4,7
    expect(r.cuadrados).toBe(2); // #1, #7
    expect(r.conFalta).toBe(2); // #2, #3
    expect(r.deEmpresa).toBe(1); // #4
    expect(r.conDiferencia).toBe(3); // #2,3,4
    expect(r.faltanteNeto).toBe(-6); // #2: -3 * 2
    expect(r.sobranteNeto).toBe(6); // #3: +3 * 2
    expect(r.asumidoEmpresa).toBe(-8); // #4: -4 * 2
    expect(r.sinPrecio).toBe(0);
  });

  it('cuenta sinPrecio cuando una diferencia real no se puede valorizar', () => {
    const r = resumirAuditoria([item({ conteos: [null, null, 7], stockErp: 10, precioVenta: null })]);
    expect(r.conFalta).toBe(1);
    expect(r.sinPrecio).toBe(1);
    expect(r.faltanteNeto).toBe(0); // no se pudo valorizar: no se inventa un monto
  });
});

/**
 * SE ACABARON LOS TRES CONTEOS FIJOS. El Auditor abre un 4to o un 5to cuando
 * el inventario no le cierra, y estas funciones eran `conteo3 ?? conteo2 ??
 * conteo1`: con esa cadena, la ronda que el Auditor acababa de mandar a hacer
 * no entraba en ninguna cuenta -- ni en la diferencia, ni en el veredicto, ni
 * en el badge -- y el inventario se liquidaba con el valor de la 3ra.
 */
describe('rondas más allá de la tercera', () => {
  it('el conteo final sale de la ÚLTIMA ronda, sea la 4ta o la 6ta', () => {
    expect(conteoFinal(item({ conteos: [9, 9, 9, 12] }))).toBe(12);
    expect(conteoFinal(item({ conteos: [9, 9, 9, 9, 9, 15] }))).toBe(15);
  });

  it('rondasNecesarias ya no tiene techo en 3', () => {
    expect(rondasNecesarias(item({ conteos: [9, 9, 9, 12] }))).toBe(4);
    expect(rondasNecesarias(item({ conteos: [9, 9, 9, 9, 15] }))).toBe(5);
  });

  /** El ajuste del auditor entra como el último valor: manda igual que una ronda. */
  it('el veredicto y la diferencia usan el valor de la última ronda', () => {
    expect(veredicto(item({ stockErp: 10, conteos: [8, 8, 8, 10] }))).toBe('cuadrado');
    expect(diferenciaUnidades(item({ stockErp: 10, conteos: [8, 8, 8, 7] }))).toBe(-3);
  });

  /** Una ronda que se abrió pero a la que este ítem no entró es `null`, y se saltea. */
  it('un null al final no borra lo contado antes', () => {
    expect(conteoFinal(item({ conteos: [9, 11, null, null] }))).toBe(11);
    expect(rondasNecesarias(item({ conteos: [9, 11, null, null] }))).toBe(2);
  });

  it('una lista vacía es "nadie lo contó", no un cero', () => {
    expect(conteoFinal(item({ conteos: [] }))).toBeNull();
    expect(rondasNecesarias(item({ conteos: [] }))).toBe(0);
    expect(veredicto(item({ stockErp: 10, conteos: [] }))).toBe('sin_contar');
  });
});

/**
 * A QUÉ CUADRO FUE CADA ÍTEM. Los números salen del escenario real 8059,
 * medido contra la API antes de escribir esto.
 *
 * La lección que estos tests fijan: LA CLASE NO ES EL CUADRO. Los tres ítems
 * con diferencia de ese inventario tienen `clase: 'paquete'`, y sin embargo
 * uno se le descuenta al personal. Derivar el cuadro de la clase habría puesto
 * "va a paquetes" sobre plata que sí se descuenta.
 */
describe('cuadroDelItem: sale del reparto, nunca de la clase', () => {
  it('GRANDE EMPAQUE 6: -23 sobre empaque 6 -> paquetes', () => {
    const a = atribucion({ clase: 'paquete', empaqueUsado: 6, empaqueSimbolo: 'Emp.6', razon: 3.8333, unidadesAPaquetes: -23 });
    expect(cuadroDelItem(a)).toBe('paquetes');
  });

  /** EL CASO QUE LA CLASE SOLA NO PODÍA VER: clase `paquete`, cuadro personal. */
  it('CHICO EMPAQUE 6: -2 sobre empaque 6 NO llega a medio empaque -> personal', () => {
    const a = atribucion({ clase: 'paquete', empaqueUsado: 6, empaqueSimbolo: 'Emp.6', razon: 0.3333, unidadesAlPersonal: -2 });
    expect(a.clase).toBe('paquete');
    expect(cuadroDelItem(a)).toBe('personal');
  });

  it('lo que absorbe gerencia va a empresa', () => {
    expect(cuadroDelItem(atribucion({ clase: 'empresa', unidadesAEmpresa: -9 }))).toBe('empresa');
  });

  /** Sin stock del ERP o sin contar: ceros y razón null. No se inventa un cuadro. */
  it('sin nada que repartir devuelve null, no un cuadro por defecto', () => {
    expect(cuadroDelItem(atribucion())).toBeNull();
  });

  it('un sobrante también tiene cuadro: el signo no cambia el destino', () => {
    expect(cuadroDelItem(atribucion({ unidadesAPaquetes: 18 }))).toBe('paquetes');
  });
});

describe('el empaque con el que se midió', () => {
  /**
   * EL SÍMBOLO TAL CUAL Y NADA MÁS. Regla del usuario para toda la app: el
   * empaque de Dynamics se muestra como vino. "empaque 6 (Emp.6)" repetía el
   * mismo dato y le anteponía una palabra nuestra a un nombre del ERP.
   */
  it('con el del ERP muestra el símbolo tal cual, sin anteponerle nada', () => {
    const texto = textoEmpaqueUsado(atribucion({ empaqueUsado: 6, empaqueSimbolo: 'Emp.6' }));
    expect(texto).toBe('Emp.6');
    expect(texto).not.toContain('empaque');
  });

  /**
   * EL CASO REAL DEL ESCENARIO: `empaqueUsado: 12` con `empaqueSimbolo: "U"`.
   * El símbolo describe el empaque DEL SNAPSHOT, no el corregido: pegarlos
   * daría "12 (U)", que se lee como "doce unidades sueltas".
   */
  it('con el corregido NO muestra el símbolo viejo, y dice de quién es el número', () => {
    const a = atribucion({ empaqueUsado: 12, empaqueSimbolo: 'U', empaqueEsCorregido: true });
    expect(textoEmpaqueUsado(a)).toBe('12, corregido por el auditor');
    expect(textoEmpaqueUsado(a)).not.toContain('U');
  });

  /**
   * El símbolo es lo que respalda el número frente a un reclamo, así que un
   * número que NO vino del ERP no puede quedar indistinguible de uno que sí.
   */
  it('el número corregido nunca se puede confundir con un dato de Dynamics', () => {
    const delErp = textoEmpaqueUsado(atribucion({ empaqueUsado: 12, empaqueSimbolo: 'Emp.12' }));
    const aMano = textoEmpaqueUsado(atribucion({ empaqueUsado: 12, empaqueSimbolo: 'Emp.12', empaqueEsCorregido: true }));
    expect(delErp).toBe('Emp.12');
    expect(aMano).toBe('12, corregido por el auditor');
    expect(aMano).not.toContain('Emp.12');
  });

  it('sin empaque no dice nada: null no es 1', () => {
    expect(textoEmpaqueUsado(atribucion({ empaqueUsado: null }))).toBeNull();
  });
});

describe('textoPorQueCuadro: el "hay que indicar" del cliente', () => {
  const fmt = (n: number) => n.toFixed(1).replace('.', ',');

  it('la frase completa: símbolo del ERP, cantidad y razón', () => {
    const a = atribucion({ empaqueUsado: 6, empaqueSimbolo: 'Emp.6', razon: 3.8333 });
    expect(textoPorQueCuadro(a, -23, fmt)).toBe('Emp.6 · faltan 23: 3,8 empaques');
  });

  /**
   * NO INVENTAMOS LA PRESENTACIÓN. Un Emp.6 puede ser un six pack, una plancha
   * o un display: el ERP no lo dice, así que la app tampoco.
   */
  it('no nombra una presentación que el ERP no dijo', () => {
    const a = atribucion({ empaqueUsado: 6, empaqueSimbolo: 'Emp.6', razon: 3.8333 });
    const frase = textoPorQueCuadro(a, -23, fmt) ?? '';
    for (const inventada of ['caja', 'plancha', 'display', 'pack']) {
      expect(frase.toLowerCase()).not.toContain(inventada);
    }
  });

  it('un sobrante dice "sobran", no "faltan"', () => {
    const a = atribucion({ empaqueUsado: 6, empaqueSimbolo: 'Emp.6', razon: 3 });
    expect(textoPorQueCuadro(a, 18, fmt)).toContain('sobran 18');
  });

  it('con el empaque corregido, la frase dice quién puso el número', () => {
    const a = atribucion({ empaqueUsado: 12, empaqueSimbolo: 'U', empaqueEsCorregido: true, razon: 1.75 });
    expect(textoPorQueCuadro(a, -21, fmt)).toBe('12, corregido por el auditor · faltan 21: 1,8 empaques');
  });

  /** Antes que una explicación a medias, ninguna. */
  it('sin razón o sin empaque no explica nada', () => {
    expect(textoPorQueCuadro(atribucion({ empaqueUsado: 6, razon: null }), -2, fmt)).toBeNull();
    expect(textoPorQueCuadro(atribucion({ empaqueUsado: null, razon: 2 }), -2, fmt)).toBeNull();
  });
});

describe('lo que paga la empresa de su cuadro', () => {
  it('faltante menos sobrante', () => {
    expect(pagaLaEmpresa({ valorFaltante: 48, valorSobrante: 12 })).toBe(36);
  });

  it('sin sobrante, paga el faltante entero', () => {
    expect(pagaLaEmpresa({ valorFaltante: 48, valorSobrante: 0 })).toBe(48);
  });

  /**
   * NADIE PAGA UNA CANTIDAD NEGATIVA. Si sobró más de lo que faltó, la empresa
   * no cobra nada — el sobrante no se le devuelve a nadie —: simplemente no
   * hay nada que pagar, y eso se dice con un 0.
   */
  it('con más sobrante que faltante no hay nada que pagar: 0, no un negativo', () => {
    expect(pagaLaEmpresa({ valorFaltante: 12, valorSobrante: 48 })).toBe(0);
  });

  it('un cuadro sin nada paga 0', () => {
    expect(pagaLaEmpresa({ valorFaltante: 0, valorSobrante: 0 })).toBe(0);
  });
});
