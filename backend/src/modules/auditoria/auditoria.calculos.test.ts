import { describe, expect, it } from 'vitest';
import {
  aplicarFiltro,
  conteoFinal,
  diferenciasParaPersistir,
  esAuditable,
  diferenciaUnidades,
  diferenciaValor,
  embudoDeConteos,
  resumir,
  rondasNecesarias,
  veredicto,
  type ItemAuditoria,
} from './auditoria.calculos';

/** Base mínima; cada test cambia solo lo que le importa. */
const item = (parcial: Partial<ItemAuditoria> = {}): ItemAuditoria => ({
  productoId: 1,
  codigo: 'IT-0001',
  descripcion: 'Aceite Vegetal Primor 900ml',
  zona: 'A',
  precioVenta: 10,
  stockErp: 100,
  conteo1: null,
  conteo2: null,
  conteo3: null,
  esEmpresa: false,
  ...parcial,
});

// ---------------------------------------------------------------------------
// "NO SE" NO ES "CERO" -- el caso que rompio contra datos reales
// ---------------------------------------------------------------------------

describe('items SIN stock del ERP', () => {
  const sinErp = item({ stockErp: null, conteo1: null });

  it('NO se reportan como cuadrados: se reportan como sin_erp', () => {
    // Este es el bug que aparecio con los 11.835 productos reales sin stock
    // cargado: `stockErp ?? 0` los hacia cuadrar en 0 y el resumen decia
    // "100% cuadrados". Un falso "todo bien" en la pantalla donde se decide
    // si el inventario cierra.
    expect(veredicto(sinErp)).toBe('sin_erp');
    expect(veredicto(sinErp)).not.toBe('cuadrado');
  });

  it('la diferencia es null, NO 0', () => {
    // 0 significa "conte exactamente lo que decia el ERP", que es una
    // afirmacion fuerte; no puede ser tambien el valor de "no tengo idea".
    expect(diferenciaUnidades(sinErp)).toBeNull();
    expect(diferenciaValor(sinErp)).toBeNull();
  });

  it('sigue siendo sin_erp aunque HAYA conteo: falta el otro lado', () => {
    expect(veredicto(item({ stockErp: null, conteo1: 42 }))).toBe('sin_erp');
    expect(diferenciaUnidades(item({ stockErp: null, conteo1: 42 }))).toBeNull();
  });

  it('sin_erp gana sobre esEmpresa: no se puede afirmar nada del item', () => {
    expect(veredicto(item({ stockErp: null, conteo1: 10, esEmpresa: true }))).toBe('sin_erp');
  });

  it('esAuditable dice que no', () => {
    expect(esAuditable(sinErp)).toBe(false);
    expect(esAuditable(item({ stockErp: 100, conteo1: 100 }))).toBe(true);
  });

  it('el resumen de 11.835 items sin stock NO dice 100% cuadrados', () => {
    const catalogoSinStock = Array.from({ length: 11835 }, (_, n) =>
      item({ codigo: `IT-${n}`, stockErp: null, conteo1: null }),
    );
    const r = resumir(catalogoSinStock);
    expect(r.cuadrados).toBe(0);
    expect(r.sinDatoErp).toBe(11835);
    expect(r.auditables).toBe(0);
    expect(r.porcentajeAuditable).toBe(0);
    // Sin nada auditable, el porcentaje de cuadrados es 0, no 100.
    expect(r.porcentajeCuadrado).toBe(0);
  });
});

describe('items CON stock del ERP pero sin contar', () => {
  const sinContar = item({ stockErp: 100, conteo1: null });

  it('tampoco se reportan como cuadrados', () => {
    // Mismo error de fondo: afirmar que algo cuadra sin evidencia.
    expect(veredicto(sinContar)).toBe('sin_contar');
  });

  it('la diferencia es null: falta el conteo, no es que se conto cero', () => {
    expect(diferenciaUnidades(sinContar)).toBeNull();
  });

  it('un conteo de CERO si es un dato real y se compara', () => {
    // Contar 0 es una afirmacion ("no hay ninguno en gondola"), muy
    // distinta de no haber contado.
    expect(veredicto(item({ stockErp: 100, conteo1: 0 }))).toBe('falta');
    expect(diferenciaUnidades(item({ stockErp: 100, conteo1: 0 }))).toBe(-100);
  });

  it('un stock del ERP de CERO tambien es un dato real', () => {
    expect(veredicto(item({ stockErp: 0, conteo1: 0 }))).toBe('cuadrado');
    expect(veredicto(item({ stockErp: 0, conteo1: 5 }))).toBe('falta');
  });
});

describe('conteoFinal', () => {
  it('toma la ronda MAS AVANZADA que exista, no siempre conteo3', () => {
    // Los ~7.350 items que cuadran en la 1ra pasada nunca tienen conteo3:
    // leer conteo3 a secas daria null para casi todo el inventario.
    expect(conteoFinal(item({ conteo1: 100 }))).toBe(100);
    expect(conteoFinal(item({ conteo1: 100, conteo2: 98 }))).toBe(98);
    expect(conteoFinal(item({ conteo1: 100, conteo2: 98, conteo3: 97 }))).toBe(97);
  });

  it('devuelve null si nadie lo conto', () => {
    expect(conteoFinal(item())).toBeNull();
  });

  it('respeta un conteo de CERO como valor real, no como ausencia', () => {
    // 0 es un conteo legitimo ("no hay ninguno en gondola"); si se tratara
    // como "no contado" se perderia justo el faltante mas grave.
    expect(conteoFinal(item({ conteo1: 0 }))).toBe(0);
    expect(conteoFinal(item({ conteo1: 50, conteo2: 0 }))).toBe(0);
  });
});

describe('diferenciaUnidades', () => {
  it('cuadra en cero cuando el conteo final coincide con el ERP', () => {
    expect(diferenciaUnidades(item({ stockErp: 100, conteo1: 100 }))).toBe(0);
  });

  it('negativo = faltante', () => {
    expect(diferenciaUnidades(item({ stockErp: 100, conteo1: 88 }))).toBe(-12);
  });

  it('positivo = sobrante', () => {
    expect(diferenciaUnidades(item({ stockErp: 100, conteo1: 105 }))).toBe(5);
  });

  it('usa la ultima ronda, no la primera', () => {
    expect(diferenciaUnidades(item({ stockErp: 100, conteo1: 88, conteo2: 100 }))).toBe(0);
  });

  it('un item SIN CONTAR da null, ni 0 ni "menos todo el stock"', () => {
    // Las tres respuestas son distintas: -100 inventaria un faltante por
    // cada item al que no se llego; 0 afirmaria que cuadra sin evidencia;
    // null dice la verdad, que es "todavia no se".
    expect(diferenciaUnidades(item({ stockErp: 100 }))).toBeNull();
  });
});

describe('diferenciaValor', () => {
  it('valoriza a precio de VENTA, no de compra', () => {
    expect(diferenciaValor(item({ stockErp: 100, conteo1: 88, precioVenta: 8.9 }))).toBe(-106.8);
  });

  it('redondea a centavos', () => {
    expect(diferenciaValor(item({ stockErp: 10, conteo1: 7, precioVenta: 3.333 }))).toBe(-10);
  });
});

describe('veredicto', () => {
  it('cuadrado cuando no hay diferencia', () => {
    expect(veredicto(item({ stockErp: 100, conteo1: 100 }))).toBe('cuadrado');
  });

  it('falta cuando hay diferencia y no la asume la empresa', () => {
    expect(veredicto(item({ stockErp: 100, conteo1: 88 }))).toBe('falta');
  });

  it('empresa cuando hay diferencia y la categoria la asume gerencia', () => {
    expect(veredicto(item({ stockErp: 100, conteo1: 88, esEmpresa: true }))).toBe('empresa');
  });

  it('un item de empresa que CUADRA sigue siendo cuadrado', () => {
    // esEmpresa solo cambia quien se hace cargo de la diferencia, no
    // inventa una diferencia que no existe.
    expect(veredicto(item({ stockErp: 100, conteo1: 100, esEmpresa: true }))).toBe('cuadrado');
  });

  it('un SOBRANTE cae en "falta": la maqueta no tiene un cuarto bucket', () => {
    expect(veredicto(item({ stockErp: 100, conteo1: 105 }))).toBe('falta');
  });
});

describe('rondasNecesarias', () => {
  it('cuenta hasta donde llego el item', () => {
    expect(rondasNecesarias(item({ conteo1: 10 }))).toBe(1);
    expect(rondasNecesarias(item({ conteo1: 10, conteo2: 9 }))).toBe(2);
    expect(rondasNecesarias(item({ conteo1: 10, conteo2: 9, conteo3: 8 }))).toBe(3);
    expect(rondasNecesarias(item())).toBe(0);
  });
});

describe('aplicarFiltro (los 4 chips de la pantalla)', () => {
  const items = [
    item({ codigo: 'A', stockErp: 100, conteo1: 100 }), // cuadrado
    item({ codigo: 'B', stockErp: 100, conteo1: 88 }), // falta
    item({ codigo: 'C', stockErp: 100, conteo1: 120 }), // falta (sobrante)
    item({ codigo: 'D', stockErp: 100, conteo1: 70, esEmpresa: true }), // empresa
    item({ codigo: 'E', stockErp: 50, conteo1: 50, esEmpresa: true }), // cuadrado
  ];

  it('todos no filtra nada', () => {
    expect(aplicarFiltro(items, 'todos')).toHaveLength(5);
  });

  it('cuadrados trae solo los que coinciden con el ERP', () => {
    expect(aplicarFiltro(items, 'cuadrados').map((i) => i.codigo)).toEqual(['A', 'E']);
  });

  it('faltante incluye los sobrantes y EXCLUYE los de empresa', () => {
    expect(aplicarFiltro(items, 'faltante').map((i) => i.codigo)).toEqual(['B', 'C']);
  });

  it('empresa trae solo los que asume gerencia y tienen diferencia', () => {
    expect(aplicarFiltro(items, 'empresa').map((i) => i.codigo)).toEqual(['D']);
  });

  it('los cuatro filtros particionan el total sin solaparse', () => {
    const suma =
      aplicarFiltro(items, 'cuadrados').length +
      aplicarFiltro(items, 'faltante').length +
      aplicarFiltro(items, 'empresa').length;
    expect(suma).toBe(items.length);
  });
});

describe('resumir', () => {
  const items = [
    item({ codigo: 'A', stockErp: 100, conteo1: 100, precioVenta: 10 }),
    item({ codigo: 'B', stockErp: 100, conteo1: 88, precioVenta: 10 }), // -12 -> -120
    item({ codigo: 'C', stockErp: 100, conteo1: 120, precioVenta: 10 }), // +20 -> +200
    item({ codigo: 'D', stockErp: 100, conteo1: 70, precioVenta: 10, esEmpresa: true }), // -30 -> -300
    item({ codigo: 'E', stockErp: 40, precioVenta: 10 }), // sin contar
  ];
  const r = resumir(items);

  it('cuenta por veredicto, y el sin contar NO entra en cuadrados', () => {
    expect(r.items).toBe(5);
    expect(r.cuadrados).toBe(1); // solo A
    expect(r.conFalta).toBe(2); // B, C
    expect(r.deEmpresa).toBe(1); // D
    expect(r.sinContar).toBe(1); // E -- antes se contaba como cuadrado
    expect(r.auditables).toBe(4); // los 5 menos el que no se puede auditar
  });

  it('separa unidades faltantes de sobrantes, siempre en positivo', () => {
    expect(r.unidadesFaltantes).toBe(42); // 12 + 30
    expect(r.unidadesSobrantes).toBe(20);
  });

  it('valoriza faltante y sobrante por separado', () => {
    expect(r.valorFaltante).toBe(420);
    expect(r.valorSobrante).toBe(200);
  });

  it('el faltante DESCONTABLE excluye lo que asume la empresa', () => {
    // 420 total - 300 de la categoria empresa = 120 que sí van a nomina.
    // Es el numero que entra a la liquidacion como faltante bruto.
    expect(r.valorFaltanteDescontable).toBe(120);
  });

  it('marca cuantos items todavia no conto nadie', () => {
    expect(r.sinContar).toBe(1);
  });

  it('el porcentaje cuadrado se calcula sobre los AUDITABLES, no sobre el total', () => {
    // 1 cuadrado de 4 auditables = 25%. Sobre el total daria 20% y
    // mezclaria peras con manzanas: con 11.835 items sin stock cargado, un
    // porcentaje sobre el total no significa nada.
    expect(r.porcentajeCuadrado).toBe(25);
    expect(r.porcentajeAuditable).toBe(80); // 4 de 5
  });

  it('no divide por cero con una matriz vacia', () => {
    const vacio = resumir([]);
    expect(vacio.items).toBe(0);
    expect(vacio.porcentajeCuadrado).toBe(0);
  });
});

describe('embudoDeConteos', () => {
  it('cuenta cuantos items entraron a cada ronda (Pantalla 4)', () => {
    const items = [
      item({ codigo: 'A', stockErp: 10, conteo1: 10 }),
      item({ codigo: 'B', stockErp: 10, conteo1: 8, conteo2: 10 }),
      item({ codigo: 'C', stockErp: 10, conteo1: 8, conteo2: 9, conteo3: 7 }),
    ];
    expect(embudoDeConteos(items)).toEqual({
      itemsTotales: 3,
      itemsSegundoConteo: 2,
      itemsTercerConteo: 1,
      itemsConDiferencia: 1, // solo C sigue sin cuadrar al final
    });
  });
});

// ---------------------------------------------------------------------------
// El detalle que se congela al cerrar el conteo
// ---------------------------------------------------------------------------

/**
 * `diferenciasParaPersistir` decide QUE se escribe en `DiferenciaItem`, y esa
 * tabla es la que el sello del lacrado hashea. Lo que no entra acá no existe
 * para el histórico ni para el ajuste en el ERP; lo que entra de más se
 * convierte en un descuento al sueldo de alguien.
 *
 * El criterio de fondo es el mismo que hace que `diferenciaUnidades` devuelva
 * `null` y no `0`: no saber no es un valor. La única forma de que un "no sé"
 * no se confunda con un cero es NO escribir la fila.
 */
describe('diferenciasParaPersistir', () => {
  it('un ítem que cuadró NO genera fila', () => {
    // Contó exactamente lo que decía el ERP: no hay nada que ajustar ni que
    // descontarle a nadie. Son ~7.350 de los 8.000 ítems reales.
    expect(diferenciasParaPersistir([item({ stockErp: 10, conteo1: 10 })])).toEqual([]);
  });

  it('un ítem SIN stock del ERP no genera fila, ni con stockSistema en 0', () => {
    // Una fila con `stockSistema: 0` afirmaría "el ERP esperaba cero y
    // apareció mercadería" -- una acusación, no un dato faltante.
    expect(diferenciasParaPersistir([item({ stockErp: null, conteo1: 7 })])).toEqual([]);
  });

  it('un ítem que nadie contó no genera fila, ni con conteoFinal en 0', () => {
    // Y un `conteoFinal: 0` se leería como "no había nada en la góndola",
    // que termina descontándose del sueldo de alguien.
    expect(diferenciasParaPersistir([item({ stockErp: 10, conteo1: null })])).toEqual([]);
  });

  it('un faltante genera fila con diferencia NEGATIVA', () => {
    const [fila] = diferenciasParaPersistir([item({ codigo: 'IT-9', stockErp: 10, conteo1: 7, precioVenta: 4 })]);
    expect(fila).toMatchObject({
      codigo: 'IT-9',
      stockSistema: 10,
      conteoFinal: 7,
      diferencia: -3,
      montoDiferencia: -12,
    });
  });

  it('un sobrante genera fila con diferencia POSITIVA', () => {
    const [fila] = diferenciasParaPersistir([item({ stockErp: 10, conteo1: 12, precioVenta: 4 })]);
    expect(fila?.diferencia).toBe(2);
    expect(fila?.montoDiferencia).toBe(8);
  });

  it('guarda en qué ronda quedó resuelto, no siempre 3', () => {
    // `resueltoEnConteo` es lo que responde "cuántos se arreglaron solos en
    // el 2do conteo" sin recorrer las hojas.
    const [fila] = diferenciasParaPersistir([item({ stockErp: 10, conteo1: 4, conteo2: 7 })]);
    expect(fila?.resueltoEnConteo).toBe(2);
    expect(fila?.conteoFinal).toBe(7); // el ÚLTIMO que existe, no conteo3
  });

  it('sin precio de venta la fila SÍ se crea, con montoDiferencia en null', () => {
    // La diferencia en unidades es un hecho verificado aunque no se pueda
    // valorizar. Y es justo esta fila la que cuenta
    // `liquidacion.service.ts#contarItemsSinPrecio` para avisarle a quien
    // firma que el monto está subestimado: saltearla escondería el problema
    // que la advertencia existe para mostrar.
    const [fila] = diferenciasParaPersistir([item({ stockErp: 10, conteo1: 7, precioVenta: null })]);
    expect(fila?.diferencia).toBe(-3);
    expect(fila?.montoDiferencia).toBeNull();
    expect(fila?.costoUnitario).toBeNull();
  });

  it('congela la descripción del momento del cierre', () => {
    const [fila] = diferenciasParaPersistir([
      item({ descripcion: 'Aceite Primor 900ml', stockErp: 10, conteo1: 7 }),
    ]);
    expect(fila?.descripcion).toBe('Aceite Primor 900ml');
  });

  it('un ítem de la empresa igual genera fila: el faltante existe y se reporta', () => {
    // `esEmpresa` cambia quién lo paga, no si pasó. El histórico y el ajuste
    // en el ERP lo necesitan igual.
    const [fila] = diferenciasParaPersistir([item({ stockErp: 10, conteo1: 7, esEmpresa: true })]);
    expect(fila?.diferencia).toBe(-3);
  });

  /**
   * LA INVARIANTE. El detalle y el total salen de la MISMA matriz, así que
   * no pueden discrepar -- y el sello del lacrado los hashea juntos, donde
   * una discrepancia no se detecta: se firma.
   */
  it('la suma de las filas concuerda con unidadesFaltantes/Sobrantes del resumen', () => {
    const items = [
      item({ codigo: 'A', stockErp: 10, conteo1: 10 }), // cuadra
      item({ codigo: 'B', stockErp: 10, conteo1: 7 }), // -3
      item({ codigo: 'C', stockErp: 10, conteo1: 4, conteo2: 6 }), // -4
      item({ codigo: 'D', stockErp: 10, conteo1: 13 }), // +3
      item({ codigo: 'E', stockErp: null, conteo1: 5 }), // sin_erp
      item({ codigo: 'F', stockErp: 10, conteo1: null }), // sin_contar
    ];

    const filas = diferenciasParaPersistir(items);
    const resumen = resumir(items);

    const faltantes = filas.filter((f) => f.diferencia < 0).reduce((t, f) => t + -f.diferencia, 0);
    const sobrantes = filas.filter((f) => f.diferencia > 0).reduce((t, f) => t + f.diferencia, 0);

    expect(faltantes).toBe(resumen.unidadesFaltantes);
    expect(sobrantes).toBe(resumen.unidadesSobrantes);
    // Y la cantidad de filas es exactamente el `itemsConDiferencia` del embudo
    // que se guarda en ResultadoInventario.
    expect(filas.length).toBe(embudoDeConteos(items).itemsConDiferencia);
  });

  it('sin ítems devuelve lista vacía, no revienta', () => {
    expect(diferenciasParaPersistir([])).toEqual([]);
  });
});
