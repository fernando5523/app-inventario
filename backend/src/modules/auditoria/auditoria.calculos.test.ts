import { describe, expect, it } from 'vitest';
import {
  aplicarFiltro,
  cuadrosParaExportar,
  atribucionDelItem,
  filasDePaquete,
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
  conteos: [null],
  esEmpresa: false,
  // Por defecto `unidad`: sin empaque de compra no hay regla de paquete que
  // correr, que es el caso de 457 de los primeros 2.000 items reales.
  clase: 'unidad',
  claseForzada: null,
  empaqueCompra: null,
  empaqueCompraSimbolo: null,
  empaqueCompraCorregido: null,
  ...parcial,
  // LA INVARIANTE `esEmpresa === (clase === 'empresa')`, sostenida acá para
  // que ningun test pueda armar un item imposible: uno que diga "lo absorbe la
  // empresa" y a la vez caiga en el cuadro del descuento al personal. Pasar
  // `clase` explicito sigue mandando -- esto solo cubre el caso de escribir
  // `esEmpresa: true` a secas, que es como estaban escritos los tests viejos.
  ...(parcial.esEmpresa === true && parcial.clase === undefined ? { clase: 'empresa' as const } : {}),
});

/** El umbral congelado del inventario. Hoy solo alimenta la rama pendiente. */
const UMBRAL = 0.5;

// ---------------------------------------------------------------------------
// "NO SE" NO ES "CERO" -- el caso que rompio contra datos reales
// ---------------------------------------------------------------------------

describe('items SIN stock del ERP', () => {
  const sinErp = item({ stockErp: null, conteos: [null] });

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
    expect(veredicto(item({ stockErp: null, conteos: [42] }))).toBe('sin_erp');
    expect(diferenciaUnidades(item({ stockErp: null, conteos: [42] }))).toBeNull();
  });

  it('sin_erp gana sobre esEmpresa: no se puede afirmar nada del item', () => {
    expect(veredicto(item({ stockErp: null, conteos: [10], esEmpresa: true }))).toBe('sin_erp');
  });

  it('esAuditable dice que no', () => {
    expect(esAuditable(sinErp)).toBe(false);
    expect(esAuditable(item({ stockErp: 100, conteos: [100] }))).toBe(true);
  });

  it('el resumen de 11.835 items sin stock NO dice 100% cuadrados', () => {
    const catalogoSinStock = Array.from({ length: 11835 }, (_, n) =>
      item({ codigo: `IT-${n}`, stockErp: null, conteos: [null] }),
    );
    const r = resumir(catalogoSinStock, UMBRAL);
    expect(r.cuadrados).toBe(0);
    expect(r.sinDatoErp).toBe(11835);
    expect(r.auditables).toBe(0);
    expect(r.porcentajeAuditable).toBe(0);
    // Sin nada auditable, el porcentaje de cuadrados es 0, no 100.
    expect(r.porcentajeCuadrado).toBe(0);
  });
});

describe('items CON stock del ERP pero sin contar', () => {
  const sinContar = item({ stockErp: 100, conteos: [null] });

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
    expect(veredicto(item({ stockErp: 100, conteos: [0] }))).toBe('falta');
    expect(diferenciaUnidades(item({ stockErp: 100, conteos: [0] }))).toBe(-100);
  });

  it('un stock del ERP de CERO tambien es un dato real', () => {
    expect(veredicto(item({ stockErp: 0, conteos: [0] }))).toBe('cuadrado');
    expect(veredicto(item({ stockErp: 0, conteos: [5] }))).toBe('falta');
  });
});

describe('conteoFinal', () => {
  it('toma la ronda MAS AVANZADA que exista, no siempre la ultima posicion', () => {
    // Los ~7.350 items que cuadran en la 1ra pasada no llegan a la 3ra: leer
    // el final de la lista a secas daria null para casi todo el inventario.
    expect(conteoFinal(item({ conteos: [100] }))).toBe(100);
    expect(conteoFinal(item({ conteos: [100, 98] }))).toBe(98);
    expect(conteoFinal(item({ conteos: [100, 98, 97] }))).toBe(97);
    // Y con las rondas extra del Auditor manda la 5ta, no la 3ra: si siguiera
    // mirando la 3ra, el ajuste del Auditor no cambiaria la liquidacion.
    expect(conteoFinal(item({ conteos: [100, 98, 97, 96, 95] }))).toBe(95);
  });

  it('devuelve null si nadie lo conto', () => {
    expect(conteoFinal(item())).toBeNull();
  });

  it('respeta un conteo de CERO como valor real, no como ausencia', () => {
    // 0 es un conteo legitimo ("no hay ninguno en gondola"); si se tratara
    // como "no contado" se perderia justo el faltante mas grave.
    expect(conteoFinal(item({ conteos: [0] }))).toBe(0);
    expect(conteoFinal(item({ conteos: [50, 0] }))).toBe(0);
  });
});

describe('diferenciaUnidades', () => {
  it('cuadra en cero cuando el conteo final coincide con el ERP', () => {
    expect(diferenciaUnidades(item({ stockErp: 100, conteos: [100] }))).toBe(0);
  });

  it('negativo = faltante', () => {
    expect(diferenciaUnidades(item({ stockErp: 100, conteos: [88] }))).toBe(-12);
  });

  it('positivo = sobrante', () => {
    expect(diferenciaUnidades(item({ stockErp: 100, conteos: [105] }))).toBe(5);
  });

  it('usa la ultima ronda, no la primera', () => {
    expect(diferenciaUnidades(item({ stockErp: 100, conteos: [88, 100] }))).toBe(0);
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
    expect(diferenciaValor(item({ stockErp: 100, conteos: [88], precioVenta: 8.9 }))).toBe(-106.8);
  });

  it('redondea a centavos', () => {
    expect(diferenciaValor(item({ stockErp: 10, conteos: [7], precioVenta: 3.333 }))).toBe(-10);
  });
});

describe('veredicto', () => {
  it('cuadrado cuando no hay diferencia', () => {
    expect(veredicto(item({ stockErp: 100, conteos: [100] }))).toBe('cuadrado');
  });

  it('falta cuando hay diferencia y no la asume la empresa', () => {
    expect(veredicto(item({ stockErp: 100, conteos: [88] }))).toBe('falta');
  });

  it('empresa cuando hay diferencia y la categoria la asume gerencia', () => {
    expect(veredicto(item({ stockErp: 100, conteos: [88], esEmpresa: true }))).toBe('empresa');
  });

  it('un item de empresa que CUADRA sigue siendo cuadrado', () => {
    // esEmpresa solo cambia quien se hace cargo de la diferencia, no
    // inventa una diferencia que no existe.
    expect(veredicto(item({ stockErp: 100, conteos: [100], esEmpresa: true }))).toBe('cuadrado');
  });

  it('un SOBRANTE cae en "falta": la maqueta no tiene un cuarto bucket', () => {
    expect(veredicto(item({ stockErp: 100, conteos: [105] }))).toBe('falta');
  });
});

describe('rondasNecesarias', () => {
  it('cuenta hasta donde llego el item', () => {
    expect(rondasNecesarias(item({ conteos: [10] }))).toBe(1);
    expect(rondasNecesarias(item({ conteos: [10, 9] }))).toBe(2);
    expect(rondasNecesarias(item({ conteos: [10, 9, 8] }))).toBe(3);
  });

  it('YA NO TIENE TECHO EN 3: con las rondas extra del Auditor llega a 5', () => {
    // Antes devolvia 3 como maximo por construccion (tres campos sueltos), y
    // un item resuelto en la 5ta se congelaba como `resueltoEnConteo: 3`.
    expect(rondasNecesarias(item({ conteos: [10, 9, 8, 8, 7] }))).toBe(5);
  });

  it('es la ronda donde quedo RESUELTO, no cuantas veces se lo conto', () => {
    // Contado en la 1 y en la 4, salteado en la 2 y la 3: necesito 4 pasadas.
    // `resueltoEnConteo` pregunta hasta donde hubo que llegar, no cuanto
    // trabajo costo.
    expect(rondasNecesarias(item({ conteos: [10, null, null, 7] }))).toBe(4);
  });

  it('los nulls del final no cuentan como rondas', () => {
    expect(rondasNecesarias(item({ conteos: [10, null, null] }))).toBe(1);
    expect(rondasNecesarias(item())).toBe(0);
  });
});

describe('aplicarFiltro (los 4 chips de la pantalla)', () => {
  const items = [
    item({ codigo: 'A', stockErp: 100, conteos: [100] }), // cuadrado
    item({ codigo: 'B', stockErp: 100, conteos: [88] }), // falta
    item({ codigo: 'C', stockErp: 100, conteos: [120] }), // falta (sobrante)
    item({ codigo: 'D', stockErp: 100, conteos: [70], esEmpresa: true }), // empresa
    item({ codigo: 'E', stockErp: 50, conteos: [50], esEmpresa: true }), // cuadrado
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
    item({ codigo: 'A', stockErp: 100, conteos: [100], precioVenta: 10 }),
    item({ codigo: 'B', stockErp: 100, conteos: [88], precioVenta: 10 }), // -12 -> -120
    item({ codigo: 'C', stockErp: 100, conteos: [120], precioVenta: 10 }), // +20 -> +200
    item({ codigo: 'D', stockErp: 100, conteos: [70], precioVenta: 10, esEmpresa: true }), // -30 -> -300
    item({ codigo: 'E', stockErp: 40, precioVenta: 10 }), // sin contar
  ];
  const r = resumir(items, UMBRAL);

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
    const vacio = resumir([], UMBRAL);
    expect(vacio.items).toBe(0);
    expect(vacio.porcentajeCuadrado).toBe(0);
  });
});

describe('embudoDeConteos', () => {
  it('cuenta cuantos items entraron a cada ronda (Pantalla 4)', () => {
    const items = [
      item({ codigo: 'A', stockErp: 10, conteos: [10] }),
      item({ codigo: 'B', stockErp: 10, conteos: [8, 10] }),
      item({ codigo: 'C', stockErp: 10, conteos: [8, 9, 7] }),
    ];
    expect(embudoDeConteos(items)).toEqual({
      itemsTotales: 3,
      itemsPorRonda: [3, 2, 1],
      itemsSegundoConteo: 2,
      itemsTercerConteo: 1,
      itemsConDiferencia: 1, // solo C sigue sin cuadrar al final
    });
  });

  /**
   * EL EMBUDO CON RONDAS EXTRA. Con dos campos fijos, un inventario de 5
   * rondas mostraba el embudo cortado en la 3ra y las dos pasadas del Auditor
   * no aparecian en ningun lado.
   */
  it('con rondas extra del Auditor, el embudo completo sigue en itemsPorRonda', () => {
    const items = [
      item({ codigo: 'A', stockErp: 10, conteos: [10] }),
      item({ codigo: 'B', stockErp: 10, conteos: [8, 10] }),
      item({ codigo: 'C', stockErp: 10, conteos: [8, 9, 9, 10] }),
      item({ codigo: 'D', stockErp: 10, conteos: [7, 8, 9, 9, 10] }),
    ];
    const embudo = embudoDeConteos(items);
    expect(embudo.itemsPorRonda).toEqual([4, 3, 2, 2, 1]);
    // Las dos columnas de `ResultadoInventario` siguen diciendo lo MISMO de
    // siempre: cuantos llegaron a la 2 y a la 3. Ciertas, pero incompletas --
    // el embudo entero esta arriba.
    expect(embudo.itemsSegundoConteo).toBe(3);
    expect(embudo.itemsTercerConteo).toBe(2);
  });

  it('un item salteado en una ronda intermedia no infla ese escalon', () => {
    // El B no se conto en la ronda 2 (la hoja se finalizo sin tocarlo) pero si
    // en la 3. La ronda 2 tuvo UN item contado, no dos.
    const items = [
      item({ codigo: 'A', stockErp: 10, conteos: [9, 10] }),
      item({ codigo: 'B', stockErp: 10, conteos: [8, null, 10] }),
    ];
    expect(embudoDeConteos(items).itemsPorRonda).toEqual([2, 1, 1]);
  });

  it('una lista acolchada con nulls al final NO inventa rondas', () => {
    // Si quien arma la matriz rellena hasta el largo del ciclo, las
    // posiciones finales en null describen rondas que nadie conto. El embudo
    // no puede decir "hubo 3 rondas" cuando la 2 y la 3 estan vacias.
    const items = [item({ codigo: 'A', stockErp: 10, conteos: [10, null, null] })];
    expect(embudoDeConteos(items).itemsPorRonda).toEqual([1]);
    expect(embudoDeConteos(items).itemsSegundoConteo).toBe(0);
    expect(embudoDeConteos(items).itemsTercerConteo).toBe(0);
  });

  it('sin items, el embudo esta vacio y no revienta', () => {
    expect(embudoDeConteos([])).toEqual({
      itemsTotales: 0,
      itemsPorRonda: [],
      itemsSegundoConteo: 0,
      itemsTercerConteo: 0,
      itemsConDiferencia: 0,
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
    expect(diferenciasParaPersistir([item({ stockErp: 10, conteos: [10] })])).toEqual([]);
  });

  it('un ítem SIN stock del ERP no genera fila, ni con stockSistema en 0', () => {
    // Una fila con `stockSistema: 0` afirmaría "el ERP esperaba cero y
    // apareció mercadería" -- una acusación, no un dato faltante.
    expect(diferenciasParaPersistir([item({ stockErp: null, conteos: [7] })])).toEqual([]);
  });

  it('un ítem que nadie contó no genera fila, ni con conteoFinal en 0', () => {
    // Y un `conteoFinal: 0` se leería como "no había nada en la góndola",
    // que termina descontándose del sueldo de alguien.
    expect(diferenciasParaPersistir([item({ stockErp: 10, conteos: [null] })])).toEqual([]);
  });

  it('un faltante genera fila con diferencia NEGATIVA', () => {
    const [fila] = diferenciasParaPersistir([item({ codigo: 'IT-9', stockErp: 10, conteos: [7], precioVenta: 4 })]);
    expect(fila).toMatchObject({
      codigo: 'IT-9',
      stockSistema: 10,
      conteoFinal: 7,
      diferencia: -3,
      montoDiferencia: -12,
    });
  });

  it('un sobrante genera fila con diferencia POSITIVA', () => {
    const [fila] = diferenciasParaPersistir([item({ stockErp: 10, conteos: [12], precioVenta: 4 })]);
    expect(fila?.diferencia).toBe(2);
    expect(fila?.montoDiferencia).toBe(8);
  });

  it('guarda en qué ronda quedó resuelto, no siempre 3', () => {
    // `resueltoEnConteo` es lo que responde "cuántos se arreglaron solos en
    // el 2do conteo" sin recorrer las hojas.
    const [fila] = diferenciasParaPersistir([item({ stockErp: 10, conteos: [4, 7] })]);
    expect(fila?.resueltoEnConteo).toBe(2);
    expect(fila?.conteoFinal).toBe(7); // el ÚLTIMO que existe, no la última ronda del ciclo
  });

  it('sin precio de venta la fila SÍ se crea, con montoDiferencia en null', () => {
    // La diferencia en unidades es un hecho verificado aunque no se pueda
    // valorizar. Y es justo esta fila la que cuenta
    // `liquidacion.service.ts#contarItemsSinPrecio` para avisarle a quien
    // firma que el monto está subestimado: saltearla escondería el problema
    // que la advertencia existe para mostrar.
    const [fila] = diferenciasParaPersistir([item({ stockErp: 10, conteos: [7], precioVenta: null })]);
    expect(fila?.diferencia).toBe(-3);
    expect(fila?.montoDiferencia).toBeNull();
    expect(fila?.precioUnitario).toBeNull();
  });

  it('congela la descripción del momento del cierre', () => {
    const [fila] = diferenciasParaPersistir([
      item({ descripcion: 'Aceite Primor 900ml', stockErp: 10, conteos: [7] }),
    ]);
    expect(fila?.descripcion).toBe('Aceite Primor 900ml');
  });

  it('un ítem de la empresa igual genera fila: el faltante existe y se reporta', () => {
    // `esEmpresa` cambia quién lo paga, no si pasó. El histórico y el ajuste
    // en el ERP lo necesitan igual.
    const [fila] = diferenciasParaPersistir([item({ stockErp: 10, conteos: [7], esEmpresa: true })]);
    expect(fila?.diferencia).toBe(-3);
  });

  /**
   * LA INVARIANTE. El detalle y el total salen de la MISMA matriz, así que
   * no pueden discrepar -- y el sello del lacrado los hashea juntos, donde
   * una discrepancia no se detecta: se firma.
   */
  it('la suma de las filas concuerda con unidadesFaltantes/Sobrantes del resumen', () => {
    const items = [
      item({ codigo: 'A', stockErp: 10, conteos: [10] }), // cuadra
      item({ codigo: 'B', stockErp: 10, conteos: [7] }), // -3
      item({ codigo: 'C', stockErp: 10, conteos: [4, 6] }), // -4
      item({ codigo: 'D', stockErp: 10, conteos: [13] }), // +3
      item({ codigo: 'E', stockErp: null, conteos: [5] }), // sin_erp
      item({ codigo: 'F', stockErp: 10, conteos: [null] }), // sin_contar
    ];

    const filas = diferenciasParaPersistir(items);
    const resumen = resumir(items, UMBRAL);

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

/**
 * LA INVARIANTE DE LA PLANILLA CON LOS TRES CUADROS.
 *
 * Lo que este cambio mueve es a QUIÉN se le carga cada faltante, nunca cuánto
 * faltó en total. Que el descuento al personal BAJE está bien -- es el punto.
 * Que los tres cuadros no sumen el total, no: ahí o se le descuenta de más a
 * alguien, o la empresa se come un faltante que nadie decidió.
 */
describe('resumir — los tres cuadros contra los totales', () => {
  const conEmpaque = (parcial: Partial<ItemAuditoria>) =>
    item({ empaqueCompra: 6, empaqueCompraSimbolo: 'Emp.6', ...parcial });

  const inventario = [
    // Faltante grande sobre empaque 6: razón 23/6 > 0.5 -> cuadro PAQUETE.
    conEmpaque({ codigo: 'A', clase: 'paquete', stockErp: 100, conteos: [77], precioVenta: 10 }),
    // Faltante chico: razón 2/6 <= 0.5 -> cuadro UNIDAD (descuento al personal).
    conEmpaque({ codigo: 'B', clase: 'paquete', stockErp: 100, conteos: [98], precioVenta: 10 }),
    // Sobrante grande sobre empaque 6 -> cuadro PAQUETE, del lado sobrante.
    conEmpaque({ codigo: 'C', clase: 'paquete', stockErp: 100, conteos: [120], precioVenta: 10 }),
    // Sin empaque de compra: `unidad`, al personal por más grande que sea.
    item({ codigo: 'D', stockErp: 100, conteos: [50], precioVenta: 10 }),
    // La cerveza: la absorbe gerencia.
    item({ codigo: 'E', esEmpresa: true, stockErp: 100, conteos: [60], precioVenta: 10 }),
  ];

  const r = resumir(inventario, UMBRAL);

  it('los tres cuadros SUMAN el faltante total del inventario', () => {
    const suma = r.porClase.unidad.valorFaltante + r.porClase.paquete.valorFaltante + r.porClase.empresa.valorFaltante;
    expect(suma).toBe(r.valorFaltante);
  });

  it('los tres cuadros SUMAN el sobrante total', () => {
    const suma = r.porClase.unidad.valorSobrante + r.porClase.paquete.valorSobrante + r.porClase.empresa.valorSobrante;
    expect(suma).toBe(r.valorSobrante);
  });

  it('lo DESCONTABLE es exactamente el faltante del cuadro `unidad`', () => {
    // B (-2 x 10 = 20) y D (-50 x 10 = 500). A y C se fueron a paquetes, E a
    // la empresa.
    expect(r.porClase.unidad.valorFaltante).toBe(520);
    expect(r.valorFaltanteDescontable).toBe(520);
  });

  it('EL DESCUENTO BAJA: sin el cuadro de paquetes serían S/230 más', () => {
    // A aportaba 230 al descuento antes de esta regla. Que baje es el punto
    // del cambio -- el cliente los audita aparte y quizás se los descuenta al
    // almacenero.
    expect(r.porClase.paquete.valorFaltante).toBe(230);
    expect(r.valorFaltante).toBe(520 + 230 + 400); // unidad + paquete + empresa
  });

  it('CADA ITEM EN UN SOLO CUADRO: los tres `items` suman los que tienen diferencia', () => {
    const items = r.porClase.unidad.items + r.porClase.paquete.items + r.porClase.empresa.items;
    expect(items).toBe(5);
  });

  it('el cuadro de paquetes lleva el símbolo del ERP, para poder discutirlo', () => {
    const filas = filasDePaquete(inventario, UMBRAL);
    expect(filas.map((f) => f.codigo)).toEqual(['A', 'C']);
    const a = filas.find((f) => f.codigo === 'A')!;
    expect(a).toMatchObject({ empaqueCompraSimbolo: 'Emp.6', empaqueCompra: 6, diferencia: -23 });
    // Y la razón que lo mandó ahí: "faltan 23 de un empaque de 6".
    expect(a.razon).toBeCloseTo(23 / 6);
    expect(a.unidadesAlPersonal).toBe(0);
  });
});

/**
 * EL CASO QUE MOTIVO TODO EL LOTE, por el camino real del cálculo.
 *
 * DORITOS QUESO ATREVIDO 90G: Dynamics lo trae con `PurchaseUnitSymbol = 'U'`
 * (empaque 1) y el Auditor lo corrige a 12. Faltan 21. En el Excel de Bolívar
 * julio 2026, Gilmer lo puso a mano en FALTANTE POR PAQUETE.
 *
 * Con el empaque del snapshot, `claseEfectiva` lo degrada a `unidad` y se le
 * descuenta entero al personal -- la corrección se guarda y no mueve nada.
 */
describe('resumir — la corrección del empaque del Auditor MUEVE el ítem de cuadro', () => {
  const doritos = (empaqueCompraCorregido: number | null) =>
    item({
      codigo: '105621',
      descripcion: 'DORITOS QUESO ATREVIDO 90G',
      clase: 'paquete',
      empaqueCompra: 1, // lo que dice el ERP, mal
      empaqueCompraSimbolo: 'U',
      empaqueCompraCorregido,
      stockErp: 100,
      conteos: [79], // faltan 21
      precioVenta: 3.8,
    });

  it('SIN corregir: empaque 1 -> degrada a `unidad` y se le descuenta al personal', () => {
    const r = resumir([doritos(null)], UMBRAL);
    expect(r.porClase.unidad.valorFaltante).toBe(79.8);
    expect(r.porClase.paquete.valorFaltante).toBe(0);
  });

  it('CORREGIDO a 12: pasa al cuadro de paquetes SIN forzar la clase a mano', () => {
    // Es el "así evitamos estar corrigiendo 1:1" del cliente: corregir el
    // empaque tiene que alcanzar, sin tener que además forzar el cuadro.
    const r = resumir([doritos(12)], UMBRAL);
    expect(r.porClase.paquete.valorFaltante).toBe(79.8);
    expect(r.porClase.unidad.valorFaltante).toBe(0);
    expect(r.valorFaltanteDescontable).toBe(0);
  });

  it('el reporte muestra los DOS empaques y cuál se usó para medir', () => {
    // "el ERP dijo 1 y el Auditor lo corrigió a 12" -- las dos cosas, o no se
    // puede discutir un descuento.
    const [fila] = filasDePaquete([doritos(12)], UMBRAL);
    expect(fila).toMatchObject({
      empaqueCompra: 1,
      empaqueCompraSimbolo: 'U',
      empaqueCompraCorregido: 12,
      empaqueCompraUsado: 12,
    });
    expect(fila!.razon).toBeCloseTo(21 / 12);
  });

  it('corregido a 1 o sin dato: sigue degradando a `unidad`, y está bien', () => {
    // No se inventa un paquete: sin denominador utilizable la regla no corre.
    expect(resumir([doritos(1)], UMBRAL).porClase.unidad.valorFaltante).toBe(79.8);
  });
});

/**
 * EL CASO DORITOS, CERRADO: corregir el empaque ALCANZA, sin forzar el cuadro.
 *
 * Hasta este cambio el empaque solo degradaba (`paquete` -> `unidad`) y nunca
 * promovía, así que el Auditor tenía que corregir el empaque Y ADEMÁS forzar
 * el cuadro en cada producto -- el "corregir 1:1" que quería evitar.
 */
describe('resumir — el empaque corregido RE-DERIVA la clase', () => {
  const doritos = (extra: Partial<ItemAuditoria>) =>
    item({
      codigo: '105621',
      descripcion: 'DORITOS QUESO ATREVIDO 90G',
      clase: 'unidad', // lo que el snapshot derivó del empaque MALO
      empaqueCompra: 1,
      empaqueCompraSimbolo: 'U',
      stockErp: 100,
      conteos: [79], // faltan 21
      precioVenta: 10,
      ...extra,
    });

  it('corregir el empaque a 12 lo mueve a paquetes SIN forzar el cuadro', () => {
    const r = resumir([doritos({ empaqueCompraCorregido: 12 })], UMBRAL);
    expect(r.porClase.paquete.valorFaltante).toBe(210);
    expect(r.porClase.unidad.valorFaltante).toBe(0);
  });

  it('sin corregir sigue en el descuento al personal', () => {
    const r = resumir([doritos({})], UMBRAL);
    expect(r.porClase.unidad.valorFaltante).toBe(210);
  });

  it('si el Auditor FUERZA `unidad`, manda él aunque el empaque diga 12', () => {
    const r = resumir([doritos({ empaqueCompraCorregido: 12, claseForzada: 'unidad' })], UMBRAL);
    expect(r.porClase.unidad.valorFaltante).toBe(210);
    expect(r.porClase.paquete.valorFaltante).toBe(0);
  });

  it('un ítem de EMPRESA no se mueve por corregirle el empaque', () => {
    const cerveza = item({
      codigo: '109370',
      clase: 'empresa',
      esEmpresa: true,
      empaqueCompra: 1,
      empaqueCompraCorregido: 12,
      stockErp: 100,
      conteos: [79],
      precioVenta: 10,
    });
    const r = resumir([cerveza], UMBRAL);
    expect(r.porClase.empresa.valorFaltante).toBe(210);
    expect(r.porClase.paquete.valorFaltante).toBe(0);
  });
});

/**
 * LA ATRIBUCIÓN POR ÍTEM, que es lo que la pantalla muestra en cada fila.
 *
 * Lo que este bloque protege es la razón por la que el cálculo vive en el
 * servidor y no en el móvil: la suma de las atribuciones tiene que dar
 * EXACTAMENTE los totales del encabezado. Con dos cálculos, la pantalla podría
 * decir que a alguien se le descuentan S/20 mientras el total dice otra cosa.
 */
describe('atribucionDelItem', () => {
  const conEmpaque = (parcial: Partial<ItemAuditoria>) =>
    item({ empaqueCompra: 6, empaqueCompraSimbolo: 'Emp.6', clase: 'paquete', stockErp: 100, precioVenta: 10, ...parcial });

  it('LA INVARIANTE: las atribuciones suman los totales del resumen', () => {
    const items = [
      conEmpaque({ codigo: 'A', conteos: [77] }), // -23 -> paquete
      conEmpaque({ codigo: 'B', conteos: [98] }), // -2  -> unidad
      conEmpaque({ codigo: 'C', conteos: [120] }), // +20 -> paquete (sobrante)
      item({ codigo: 'D', esEmpresa: true, clase: 'empresa', stockErp: 100, conteos: [60], precioVenta: 10 }),
    ];
    const r = resumir(items, UMBRAL);
    const atribuciones = items.map((i) => atribucionDelItem(i, UMBRAL));

    const sumar = (f: (a: ReturnType<typeof atribucionDelItem>) => number, signo: number) =>
      atribuciones.reduce((t, a) => (Math.sign(f(a)) === signo ? t + Math.abs(f(a)) * 10 : t), 0);

    expect(sumar((a) => a.unidadesAlPersonal, -1)).toBe(r.porClase.unidad.valorFaltante);
    expect(sumar((a) => a.unidadesAPaquetes, -1)).toBe(r.porClase.paquete.valorFaltante);
    expect(sumar((a) => a.unidadesAPaquetes, 1)).toBe(r.porClase.paquete.valorSobrante);
    expect(sumar((a) => a.unidadesAEmpresa, -1)).toBe(r.porClase.empresa.valorFaltante);
  });

  it('trae lo que hace falta para escribir la fila entera', () => {
    // "Va a paquetes — empaque 6 (Emp.6), faltan 23: 3,8 cajas"
    const a = atribucionDelItem(conEmpaque({ conteos: [77] }), UMBRAL);
    expect(a.clase).toBe('paquete');
    expect(a.empaqueUsado).toBe(6);
    expect(a.empaqueSimbolo).toBe('Emp.6');
    expect(a.razon).toBeCloseTo(23 / 6);
    expect(a.empaqueEsCorregido).toBe(false);
  });

  it('informa el empaque EFECTIVO y avisa que lo corrigió el auditor', () => {
    // "empaque 12 (corregido por el auditor)" -- es lo que le explica a quien
    // discute el descuento por qué su producto cambió de cuadro.
    const a = atribucionDelItem(
      conEmpaque({ clase: 'unidad', empaqueCompra: 1, empaqueCompraSimbolo: 'U', empaqueCompraCorregido: 12, conteos: [79] }),
      UMBRAL,
    );
    expect(a.empaqueUsado).toBe(12); // el efectivo, NO el 1 del ERP
    expect(a.empaqueEsCorregido).toBe(true);
    expect(a.clase).toBe('paquete');
    expect(a.razon).toBeCloseTo(21 / 12);
  });

  it('una corrección que NO cambia nada no se anuncia como corrección', () => {
    // Corregir a 6 un ítem que el ERP ya traía en 6 no cambió nada: la fila no
    // tiene por qué decir que sí.
    const a = atribucionDelItem(conEmpaque({ empaqueCompraCorregido: 6, conteos: [77] }), UMBRAL);
    expect(a.empaqueEsCorregido).toBe(false);
  });

  it('un ítem sin diferencia o sin dato no atribuye nada, y no revienta', () => {
    const sinErp = atribucionDelItem(conEmpaque({ stockErp: null, conteos: [50] }), UMBRAL);
    expect([sinErp.unidadesAlPersonal, sinErp.unidadesAPaquetes, sinErp.unidadesAEmpresa]).toEqual([0, 0, 0]);
    expect(sinErp.razon).toBeNull();
  });

  it('respeta el cuadro forzado por el auditor, igual que el reparto', () => {
    const a = atribucionDelItem(conEmpaque({ claseForzada: 'unidad', conteos: [77] }), UMBRAL);
    expect(a.clase).toBe('unidad');
    expect(a.unidadesAlPersonal).toBe(-23);
  });
});

/**
 * EL REPARTO EN LOS CUADROS DEL ARCHIVO DEL CLIENTE.
 *
 * Lo que protege: que el Excel y el panel de auditoría repartan los MISMOS
 * ítems en los MISMOS cuadros. Si difieren, el cliente pone los dos al lado y
 * la discusión está perdida.
 */
describe('cuadrosParaExportar', () => {
  const conEmpaque = (parcial: Partial<ItemAuditoria>) =>
    item({ empaqueCompra: 6, empaqueCompraSimbolo: 'Emp.6', clase: 'paquete', stockErp: 100, precioVenta: 10, ...parcial });

  it('AGRUPA POR DONDE FUERON LAS UNIDADES, no por la clase del ítem', () => {
    // EL BUG QUE ESTE TEST FIJA: un ítem de clase `paquete` cuya razón no
    // supera el umbral (faltan 2 de 6 = 0.33) tiene sus unidades en el
    // descuento al personal, así que va al cuadro ÚNICO. Agruparlo por su
    // clase lo mandaba al de paquetes y el Excel repartía distinto que la app.
    const c = cuadrosParaExportar([conEmpaque({ codigo: 'CHICO', conteos: [98] })], UMBRAL);
    expect(c.faltantesUnicos.map((f) => f.codigo)).toEqual(['CHICO']);
    expect(c.faltantesPaquete).toEqual([]);
  });

  it('los cuatro cuadros, cada ítem en uno solo', () => {
    const c = cuadrosParaExportar(
      [
        conEmpaque({ codigo: 'A', conteos: [77] }), // -23 -> paquete
        conEmpaque({ codigo: 'B', conteos: [98] }), // -2  -> único
        conEmpaque({ codigo: 'C', conteos: [120] }), // +20 -> sobrante paquete
        conEmpaque({ codigo: 'D', conteos: [102] }), // +2  -> sobrante único
        item({ codigo: 'E', esEmpresa: true, clase: 'empresa', stockErp: 100, conteos: [60], precioVenta: 10 }),
      ],
      UMBRAL,
    );
    expect(c.faltantesPaquete.map((f) => f.codigo)).toEqual(['A']);
    expect(c.faltantesUnicos.map((f) => f.codigo)).toEqual(['B']);
    expect(c.sobrantesPaquete.map((f) => f.codigo)).toEqual(['C']);
    expect(c.sobrantesUnicos.map((f) => f.codigo)).toEqual(['D']);
    expect(c.empresaFaltantes.map((f) => f.codigo)).toEqual(['E']);
  });

  it('LOS CUADROS SUMAN LO MISMO QUE EL RESUMEN, cuadro por cuadro', () => {
    const items = [
      conEmpaque({ codigo: 'A', conteos: [77] }),
      conEmpaque({ codigo: 'B', conteos: [98] }),
      item({ codigo: 'E', esEmpresa: true, clase: 'empresa', stockErp: 100, conteos: [60], precioVenta: 10 }),
    ];
    const r = resumir(items, UMBRAL);
    const c = cuadrosParaExportar(items, UMBRAL);
    const suma = (filas: { total: number | null }[]) => Math.abs(filas.reduce((t, f) => t + (f.total ?? 0), 0));

    expect(suma(c.faltantesUnicos)).toBe(r.porClase.unidad.valorFaltante);
    expect(suma(c.faltantesPaquete)).toBe(r.porClase.paquete.valorFaltante);
    expect(suma(c.empresaFaltantes)).toBe(r.porClase.empresa.valorFaltante);
  });

  it('lo que cuadró o no se puede auditar no entra en ningún cuadro', () => {
    const c = cuadrosParaExportar(
      [
        conEmpaque({ codigo: 'CUADRA', conteos: [100] }),
        conEmpaque({ codigo: 'SIN-ERP', stockErp: null, conteos: [50] }),
        conEmpaque({ codigo: 'SIN-CONTAR', conteos: [null] }),
      ],
      UMBRAL,
    );
    expect(Object.values(c).every((filas) => filas.length === 0)).toBe(true);
  });
});
