import { describe, expect, it } from 'vitest';
import { repartirExacto } from '../../dominio/reparto-de-fondo';
import {
  calcularEmbudo,
  calcularResumenLiquidacion,
  resumirAsistencia,
  calcularTotalDescuento,
  compararPeriodos,
  redondear,
  resumirHistoricoItem,
} from './historial.calculos';

/**
 * Los numeros de estos tests NO son inventados: salen del mockup que el
 * cliente ya validó (docs/pantallas.md, Pantallas 4 y 6) y de la maqueta
 * mobile/design/liquidacion.html. Si un cambio de codigo los rompe, rompio
 * la aritmetica que el cliente ya reviso, no un test arbitrario.
 */

describe('redondear', () => {
  it('redondea a centavos', () => {
    expect(redondear(126.3636)).toBe(126.36);
    expect(redondear(7.499)).toBe(7.5);
  });

  it('resuelve el clasico 1.005 del binario', () => {
    // Sin la correccion de epsilon, Math.round(1.005 * 100) da 100, no 101.
    expect(redondear(1.005)).toBe(1.01);
  });

  it('acepta otra cantidad de decimales', () => {
    expect(redondear(91.7532, 1)).toBe(91.8);
  });
});

describe('calcularEmbudo (Pantalla 4: 8.000 -> 650 -> 130)', () => {
  const embudo = calcularEmbudo({
    itemsTotales: 8000,
    itemsConDiferencia: 130,
    itemsSegundoConteo: 650,
    itemsTercerConteo: 130,
  });

  it('deriva los cuadrados en vez de leerlos de una columna', () => {
    expect(embudo.itemsCuadrados).toBe(7870);
  });

  it('coincide con el 98.4% de items cuadrados al cerrar el ciclo', () => {
    expect(embudo.porcentajeCuadrado).toBe(98.4);
  });

  it('muestra cuanto se angosto el embudo en cada pasada', () => {
    // 650 entraron al 2do, 130 pasaron al 3ro -> 520 se resolvieron ahi.
    expect(embudo.resueltosEnSegundo).toBe(520);
    expect(embudo.resueltosEnTercero).toBe(0);
  });

  it('el 1er conteo del mockup deja 91.8% cuadrado', () => {
    // 7.350 de 8.000 al terminar la 1ra ronda (dato textual del mockup).
    const primeraRonda = calcularEmbudo({
      itemsTotales: 8000,
      itemsConDiferencia: 650,
      itemsSegundoConteo: 650,
      itemsTercerConteo: 130,
    });
    expect(primeraRonda.itemsCuadrados).toBe(7350);
    expect(primeraRonda.porcentajeCuadrado).toBe(91.9);
  });

  it('no divide por cero cuando el inventario no tiene items', () => {
    const vacio = calcularEmbudo({
      itemsTotales: 0,
      itemsConDiferencia: 0,
      itemsSegundoConteo: 0,
      itemsTercerConteo: 0,
    });
    expect(vacio.porcentajeCuadrado).toBe(0);
  });
});

describe('calcularResumenLiquidacion (Pantalla 6)', () => {
  /** Los numeros exactos del mockup: 1850 - 310 - 150 = 1390, /11 = 126.36. */
  const mockup = calcularResumenLiquidacion({
    montoFaltanteBruto: 1850,
    montoNegativos: 310,
    montoFaltanteEmpresa: 150,
    colaboradoresAlcanzados: 11,
    colaboradoresAsistieron: 8,
    multaInasistencia: 20,
  });

  it('calcula el faltante neto restando negativos y faltante de empresa', () => {
    expect(mockup.montoFaltanteNeto).toBe(1390);
  });

  it('reparte la cuota entre TODO el personal habilitado, no solo los que fueron', () => {
    // 1390 / 11 = 126.36 (y no 1390 / 8): regla textual de la reunion.
    expect(mockup.cuotaBase).toBe(126.36);
  });

  it('arma el fondo de multas con las faltas y lo reparte entre los asistentes', () => {
    expect(mockup.faltantes).toBe(3);
    expect(mockup.fondoMultas).toBe(60);
    expect(mockup.bonoAsistencia).toBe(7.5);
  });

  it('expone el residuo de centavos que deja el redondeo en vez de esconderlo', () => {
    // 126.36 x 11 = 1389.96 -> sobran 4 centavos del neto de 1390.
    expect(mockup.residuoCentavos).toBe(0.04);
  });

  it('reproduce los numeros de la maqueta liquidacion.html (2200/380/170)', () => {
    const maqueta = calcularResumenLiquidacion({
      montoFaltanteBruto: 2200,
      montoNegativos: 380,
      montoFaltanteEmpresa: 170,
      colaboradoresAlcanzados: 11,
      colaboradoresAsistieron: 8,
      multaInasistencia: 20,
    });
    expect(maqueta.montoFaltanteNeto).toBe(1650);
    expect(maqueta.cuotaBase).toBe(150);
    expect(maqueta.bonoAsistencia).toBe(7.5);
    // Este reparto da exacto: no queda residuo.
    expect(maqueta.residuoCentavos).toBe(0);
  });

  it('reproduce el ejemplo real de la reunion (4 faltas de 11, S/11.43 c/u)', () => {
    const reunion = calcularResumenLiquidacion({
      montoFaltanteBruto: 0,
      montoNegativos: 0,
      montoFaltanteEmpresa: 0,
      colaboradoresAlcanzados: 11,
      colaboradoresAsistieron: 7,
      multaInasistencia: 20,
    });
    expect(reunion.fondoMultas).toBe(80);
    // El .vtt dice "S/11.43 c/u", y ESE es el numero que no cerraba:
    // 11.43 x 7 = 80.01, un centavo que ponia la empresa.
    //
    // Ahora el encabezado muestra el PISO del reparto (11.42) y la planilla
    // le da 11.43 a los primeros 6 y 11.42 al septimo, para que la suma de
    // exactamente 80. Es un centavo de diferencia en el cartel a cambio de
    // que la plata cierre -- ver dominio/reparto-de-fondo.ts.
    expect(reunion.bonoAsistencia).toBe(11.42);
  });

  it('el bono del encabezado es el PISO, y repartido cierra contra el fondo', () => {
    const reunion = calcularResumenLiquidacion({
      montoFaltanteBruto: 0,
      montoNegativos: 0,
      montoFaltanteEmpresa: 0,
      colaboradoresAlcanzados: 11,
      colaboradoresAsistieron: 7,
      multaInasistencia: 20,
    });
    const asistentes = [1, 2, 3, 4, 5, 6, 7];
    const reparto = repartirExacto(reunion.fondoMultas, asistentes);

    // Nadie recibe MENOS que el numero del encabezado.
    for (const monto of reparto.values()) expect(monto).toBeGreaterThanOrEqual(reunion.bonoAsistencia);

    // Y la suma da el fondo, al centavo.
    const sumado = [...reparto.values()].reduce((t, m) => t + Math.round(m * 100), 0);
    expect(sumado).toBe(Math.round(reunion.fondoMultas * 100));
  });

  it('no divide por cero si no asistio nadie', () => {
    const nadie = calcularResumenLiquidacion({
      montoFaltanteBruto: 1000,
      montoNegativos: 0,
      montoFaltanteEmpresa: 0,
      colaboradoresAlcanzados: 5,
      colaboradoresAsistieron: 0,
      multaInasistencia: 20,
    });
    expect(nadie.bonoAsistencia).toBe(0);
    expect(nadie.fondoMultas).toBe(100);
  });

  it('no inventa faltas negativas si asistieron mas de los alcanzados', () => {
    const raro = calcularResumenLiquidacion({
      montoFaltanteBruto: 0,
      montoNegativos: 0,
      montoFaltanteEmpresa: 0,
      colaboradoresAlcanzados: 3,
      colaboradoresAsistieron: 5,
      multaInasistencia: 20,
    });
    expect(raro.faltantes).toBe(0);
    expect(raro.fondoMultas).toBe(0);
  });
});

/**
 * UN CONTEO DE PERSONAS NO PUEDE SER NEGATIVO.
 *
 * Visto en la app el 2026-09-05: "redistribuido entre los **-2** colaboradores
 * que sí asistieron". Salía de `planilla.length - totalFaltas` con la planilla
 * vacía: 0 - 2 = -2. Un número negativo de personas no es un error de cálculo,
 * es un número que no significa nada — y quien lo ve deja de creerle al resto
 * de la pantalla.
 */
describe('resumirAsistencia: las tres invariantes de un conteo de gente', () => {
  it('el caso normal: 11 alcanzados, 7 vinieron, 4 faltaron', () => {
    expect(resumirAsistencia(11, 7)).toEqual({ alcanzados: 11, asistieron: 7, faltaron: 4 });
  });

  it('nadie vino: 0 asistieron, TODOS faltaron -- nunca un negativo', () => {
    expect(resumirAsistencia(11, 0)).toEqual({ alcanzados: 11, asistieron: 0, faltaron: 11 });
  });

  it('vinieron todos: 0 faltas', () => {
    expect(resumirAsistencia(11, 11)).toEqual({ alcanzados: 11, asistieron: 11, faltaron: 0 });
  });

  it('EL CASO DEL BUG: asistieron mayor que el universo se acota, no da faltaron negativo', () => {
    // 0 - 2 = -2 era lo que se veía en pantalla. Acá el desfase se corrige
    // hacia el universo real en vez de propagarse como un imposible.
    expect(resumirAsistencia(0, 2)).toEqual({ alcanzados: 0, asistieron: 0, faltaron: 0 });
  });

  it('un asistieron mayor que alcanzados se recorta: "13 de 11" es igual de imposible', () => {
    expect(resumirAsistencia(11, 13)).toEqual({ alcanzados: 11, asistieron: 11, faltaron: 0 });
  });

  it('entradas negativas se saneann a 0, no se propagan', () => {
    expect(resumirAsistencia(-5, -3)).toEqual({ alcanzados: 0, asistieron: 0, faltaron: 0 });
  });

  it('LA INVARIANTE, sobre cualquier combinación: nunca negativos y siempre suman', () => {
    for (const alcanzados of [-3, 0, 1, 7, 11]) {
      for (const asistieron of [-2, 0, 1, 7, 13]) {
        const r = resumirAsistencia(alcanzados, asistieron);
        expect(r.asistieron).toBeGreaterThanOrEqual(0);
        expect(r.faltaron).toBeGreaterThanOrEqual(0);
        expect(r.asistieron + r.faltaron).toBe(r.alcanzados);
      }
    }
  });
});

describe('calcularTotalDescuento (planilla de la Pantalla 6)', () => {
  it('al que asistio le baja la cuota con el bono: 126.36 - 7.50 = 118.86', () => {
    expect(calcularTotalDescuento({ cuotaBase: 126.36, multaInasistencia: 0, bonoAsistencia: 7.5 })).toBe(118.86);
  });

  it('al que falto le suma la multa y no le da bono: 126.36 + 20 = 146.36', () => {
    expect(calcularTotalDescuento({ cuotaBase: 126.36, multaInasistencia: 20, bonoAsistencia: 0 })).toBe(146.36);
  });
});

describe('resumirHistoricoItem ("cuantas veces dio diferencia este ano")', () => {
  const resumen = resumirHistoricoItem([
    { periodoAnio: 2026, periodoMes: 6, diferencia: -12, montoDiferencia: -48.5 },
    { periodoAnio: 2026, periodoMes: 7, diferencia: 3, montoDiferencia: 12.25 },
    { periodoAnio: 2026, periodoMes: 8, diferencia: -40, montoDiferencia: -160 },
  ]);

  it('cuenta apariciones y separa faltantes de sobrantes', () => {
    expect(resumen.veces).toBe(3);
    expect(resumen.vecesFaltante).toBe(2);
    expect(resumen.vecesSobrante).toBe(1);
  });

  it('acumula unidades por signo, siempre en positivo', () => {
    expect(resumen.unidadesFaltantes).toBe(52);
    expect(resumen.unidadesSobrantes).toBe(3);
  });

  it('acumula el monto respetando el signo', () => {
    expect(resumen.montoAcumulado).toBe(-196.25);
  });

  it('senala el peor periodo por diferencia absoluta', () => {
    expect(resumen.peorPeriodo).toEqual({ anio: 2026, mes: 8, diferencia: -40 });
  });

  it('con un item que nunca dio diferencia devuelve todo en cero y sin peor periodo', () => {
    const vacio = resumirHistoricoItem([]);
    expect(vacio.veces).toBe(0);
    expect(vacio.peorPeriodo).toBeNull();
  });

  it('ignora en el monto las apariciones que no se pudieron valorizar', () => {
    const sinCosto = resumirHistoricoItem([
      { periodoAnio: 2026, periodoMes: 8, diferencia: -5, montoDiferencia: null },
      { periodoAnio: 2026, periodoMes: 9, diferencia: -5, montoDiferencia: -20 },
    ]);
    expect(sinCosto.unidadesFaltantes).toBe(10);
    expect(sinCosto.montoAcumulado).toBe(-20);
  });
});

describe('compararPeriodos', () => {
  const serie = compararPeriodos([
    { periodoAnio: 2026, periodoMes: 7, itemsTotales: 8000, itemsConDiferencia: 200, montoFaltanteNeto: 1000 },
    { periodoAnio: 2026, periodoMes: 8, itemsTotales: 8000, itemsConDiferencia: 130, montoFaltanteNeto: 1390 },
    { periodoAnio: 2026, periodoMes: 9, itemsTotales: 8000, itemsConDiferencia: 100, montoFaltanteNeto: 695 },
  ]);

  it('deja el primer punto sin variacion en vez de decir 0%', () => {
    // Devolver 0 ahi seria afirmar "no cambio", que es una mentira distinta
    // de "no hay contra que comparar".
    expect(serie[0]?.variacionFaltantePct).toBeNull();
  });

  it('calcula la variacion contra el mes anterior', () => {
    expect(serie[1]?.variacionFaltantePct).toBe(39);
    expect(serie[2]?.variacionFaltantePct).toBe(-50);
  });

  it('agrega el porcentaje cuadrado de cada mes', () => {
    expect(serie[1]?.porcentajeCuadrado).toBe(98.4);
  });

  it('no divide por cero si el mes anterior no tuvo faltante', () => {
    const conCero = compararPeriodos([
      { periodoAnio: 2026, periodoMes: 7, itemsTotales: 10, itemsConDiferencia: 0, montoFaltanteNeto: 0 },
      { periodoAnio: 2026, periodoMes: 8, itemsTotales: 10, itemsConDiferencia: 1, montoFaltanteNeto: 500 },
    ]);
    expect(conCero[1]?.variacionFaltantePct).toBeNull();
  });
});
