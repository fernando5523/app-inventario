/**
 * Derivados del historico -- CERO Prisma aca, misma razon que
 * usuarios.permisos.ts y config.validadores.ts: son las cuentas que le
 * llegan al recibo de sueldo de una persona, asi que tienen que poder
 * testearse sin base de datos (ver historial.calculos.test.ts).
 *
 * POR QUE ESTO ES UNA FUNCION Y NO UNA COLUMNA: prisma/schema.prisma
 * arrastra desde el modelo Conteo la regla de no guardar nunca un total
 * junto a sus partes ("guardar un total junto a sus partes es garantizar
 * que algun dia no coincidan"). ResultadoInventario y
 * LiquidacionColaborador guardan los sumandos; los totales viven aca.
 *
 * Todos los montos son numeros en soles con 2 decimales. Se usa `number`
 * y no Prisma.Decimal a proposito: un double representa exactamente
 * cualquier monto de esta escala (miles de soles, 2 decimales), y mantener
 * el archivo sin dependencias es lo que lo hace testeable de verdad. El
 * unico cuidado real es redondear al final de cada operacion, no al final
 * de una cadena -- de eso se ocupa `redondear`.
 */

import { bonoBase } from '../../dominio/reparto-de-fondo';

/** Redondeo a 2 decimales (centavos), medio hacia arriba. */
export function redondear(valor: number, decimales = 2): number {
  const factor = 10 ** decimales;
  // El +Number.EPSILON corrige el clasico 1.005 -> 1.00 del binario.
  return Math.round((valor + Number.EPSILON) * factor) / factor;
}

// ---------------------------------------------------------------------------
// Embudo de los 3 conteos (docs/pantallas.md, Pantalla 4)
// ---------------------------------------------------------------------------

export interface EntradaEmbudo {
  itemsTotales: number;
  itemsConDiferencia: number;
  itemsSegundoConteo: number;
  itemsTercerConteo: number;
}

export interface Embudo {
  /** itemsTotales - itemsConDiferencia. No se guarda: se deriva. */
  itemsCuadrados: number;
  /** % de items que cuadraron al final del ciclo (91.8% en el ejemplo). */
  porcentajeCuadrado: number;
  /** Cuantos se resolvieron en cada reconteo -- el angosto del embudo. */
  resueltosEnSegundo: number;
  resueltosEnTercero: number;
}

/**
 * El embudo que dibuja la Pantalla 4: 8.000 -> 650 -> 130. Lo que hace
 * util al historico no es el numero final sino cuanto se angosto en cada
 * pasada: si el 2do conteo deja de resolver casos, el problema no es la
 * gente contando, es el dato de origen.
 */
export function calcularEmbudo(r: EntradaEmbudo): Embudo {
  const itemsCuadrados = r.itemsTotales - r.itemsConDiferencia;
  return {
    itemsCuadrados,
    porcentajeCuadrado: r.itemsTotales === 0 ? 0 : redondear((itemsCuadrados / r.itemsTotales) * 100, 1),
    resueltosEnSegundo: r.itemsSegundoConteo - r.itemsTercerConteo,
    resueltosEnTercero: r.itemsTercerConteo - r.itemsConDiferencia,
  };
}

// ---------------------------------------------------------------------------
// Liquidacion (docs/pantallas.md, Pantalla 6)
// ---------------------------------------------------------------------------

export interface EntradaLiquidacion {
  montoFaltanteBruto: number;
  /** Ajustes de entradas/salidas del mes (Jocelyn), a favor del personal. */
  montoNegativos: number;
  /** Faltante que absorbe la empresa (las cervezas del ejemplo). */
  montoFaltanteEmpresa: number;
  /** TODO el personal habilitado de la tienda, no solo quien asistio. */
  colaboradoresAlcanzados: number;
  colaboradoresAsistieron: number;
  /** Multa vigente en ESE inventario (S/20 hoy). */
  multaInasistencia: number;
}

/**
 * CUANTA GENTE VINO Y CUANTA FALTO, con las tres invariantes que un conteo
 * de PERSONAS no puede violar nunca:
 *
 *   asistieron >= 0
 *   faltaron   >= 0
 *   asistieron + faltaron === alcanzados
 *
 * Existe porque la pantalla mostro "redistribuido entre los -2 colaboradores
 * que si asistieron" (visto en la app el 2026-09-05). Salia de restar
 * `planilla.length - totalFaltas` con la planilla vacia: 0 - 2 = -2. Un
 * numero negativo de personas no es un error de calculo, es un numero que no
 * significa nada -- y quien lo ve deja de creerle al resto de la pantalla.
 *
 * Se acota contra `alcanzados` y no solo contra 0: si `asistieron` viniera
 * mayor que el universo (una planilla desfasada del resultado), "13 de 11
 * asistieron" es igual de imposible.
 */
export interface AsistenciaResumida {
  alcanzados: number;
  asistieron: number;
  faltaron: number;
}

export function resumirAsistencia(alcanzados: number, asistieron: number): AsistenciaResumida {
  const universo = Math.max(0, alcanzados);
  const vinieron = Math.min(Math.max(0, asistieron), universo);
  return { alcanzados: universo, asistieron: vinieron, faltaron: universo - vinieron };
}

export interface ResumenLiquidacion {
  /** bruto - negativos - empresa. */
  montoFaltanteNeto: number;
  /** neto / colaboradoresAlcanzados. */
  cuotaBase: number;
  faltantes: number;
  /** faltantes * multaInasistencia -- lo que se redistribuye. */
  fondoMultas: number;
  /**
   * El PISO del reparto del fondo entre los asistentes -- lo que muestra el
   * encabezado ("-S/7.50 de descuento adicional para cada asistente").
   *
   * Es el piso y no el promedio: cuando el fondo no divide exacto, a algunos
   * les toca UN centavo mas (ver dominio/reparto-de-fondo.ts). Decir un
   * promedio con decimales que nadie recibe seria peor que decir el piso.
   * El monto exacto de cada persona esta en su fila de la planilla.
   */
  bonoAsistencia: number;
  /**
   * Centavos que quedan sin repartir por el redondeo de `cuotaBase`
   * (1390 / 11 = 126.3636... -> 126.36 x 11 = 1389.96, sobran 4 centavos).
   *
   * Se expone en vez de esconderse: la maqueta redondea igual y no dice
   * quien se come el residuo. Con esto a la vista, el dia que Contabilidad
   * pregunte por que el descuento total no da igual al faltante neto, la
   * respuesta esta en la respuesta del endpoint y no hay que auditar nada.
   * PENDIENTE DE DEFINIR CON EL CLIENTE: hoy el residuo queda a favor del
   * personal (se descuenta de menos), que es la opcion conservadora.
   */
  residuoCentavos: number;
}

export function calcularResumenLiquidacion(e: EntradaLiquidacion): ResumenLiquidacion {
  const montoFaltanteNeto = redondear(e.montoFaltanteBruto - e.montoNegativos - e.montoFaltanteEmpresa);

  const cuotaBase = e.colaboradoresAlcanzados === 0 ? 0 : redondear(montoFaltanteNeto / e.colaboradoresAlcanzados);

  const faltantes = Math.max(0, e.colaboradoresAlcanzados - e.colaboradoresAsistieron);
  const fondoMultas = redondear(faltantes * e.multaInasistencia);
  // `bonoBase` y no `redondear(fondo / asistentes)`: con el redondeo, la suma
  // de los bonos no daba el fondo y la empresa a veces ponia y a veces se
  // quedaba con la diferencia. Ver dominio/reparto-de-fondo.ts.
  const bonoAsistencia = bonoBase(fondoMultas, e.colaboradoresAsistieron);

  const residuoCentavos = redondear(montoFaltanteNeto - cuotaBase * e.colaboradoresAlcanzados);

  return { montoFaltanteNeto, cuotaBase, faltantes, fondoMultas, bonoAsistencia, residuoCentavos };
}

export interface EntradaDescuento {
  cuotaBase: number;
  multaInasistencia: number;
  bonoAsistencia: number;
}

/**
 * El descuento final de una persona. No se guarda en
 * LiquidacionColaborador -- solo sus tres partes -- por la misma regla que
 * deja a Conteo sin columna `total`.
 */
export function calcularTotalDescuento(d: EntradaDescuento): number {
  return redondear(d.cuotaBase + d.multaInasistencia - d.bonoAsistencia);
}

// ---------------------------------------------------------------------------
// Historico de un articulo entre periodos
// ---------------------------------------------------------------------------

export interface AparicionItem {
  periodoAnio: number;
  periodoMes: number;
  diferencia: number;
  montoDiferencia: number | null;
}

export interface ResumenItem {
  /** En cuantos inventarios aparecio con diferencia. */
  veces: number;
  vecesFaltante: number;
  vecesSobrante: number;
  /** Suma de unidades faltantes (positiva) a lo largo del historico. */
  unidadesFaltantes: number;
  unidadesSobrantes: number;
  /** Solo suma las apariciones que pudieron valorizarse. */
  montoAcumulado: number;
  /** Peor diferencia absoluta y en que periodo se dio. */
  peorPeriodo: { anio: number; mes: number; diferencia: number } | null;
}

/**
 * "Este producto, cuantas veces dio diferencia este ano" -- la pregunta
 * textual del cliente. Un item que aparece todos los meses con faltante no
 * es un error de conteo: es una merma sistematica o un robo, y la unica
 * forma de verlo es mirar el historico completo del codigo, no un mes.
 */
export function resumirHistoricoItem(apariciones: AparicionItem[]): ResumenItem {
  const resumen: ResumenItem = {
    veces: apariciones.length,
    vecesFaltante: 0,
    vecesSobrante: 0,
    unidadesFaltantes: 0,
    unidadesSobrantes: 0,
    montoAcumulado: 0,
    peorPeriodo: null,
  };

  for (const a of apariciones) {
    if (a.diferencia < 0) {
      resumen.vecesFaltante += 1;
      resumen.unidadesFaltantes += -a.diferencia;
    } else if (a.diferencia > 0) {
      resumen.vecesSobrante += 1;
      resumen.unidadesSobrantes += a.diferencia;
    }
    if (a.montoDiferencia !== null) resumen.montoAcumulado += a.montoDiferencia;

    const peor = resumen.peorPeriodo;
    if (peor === null || Math.abs(a.diferencia) > Math.abs(peor.diferencia)) {
      resumen.peorPeriodo = { anio: a.periodoAnio, mes: a.periodoMes, diferencia: a.diferencia };
    }
  }

  resumen.montoAcumulado = redondear(resumen.montoAcumulado);
  return resumen;
}

// ---------------------------------------------------------------------------
// Comparacion entre periodos
// ---------------------------------------------------------------------------

export interface PuntoComparativo {
  periodoAnio: number;
  periodoMes: number;
  itemsTotales: number;
  itemsConDiferencia: number;
  montoFaltanteNeto: number;
}

export interface VariacionComparativo extends PuntoComparativo {
  /** % de items que cuadraron ese mes. */
  porcentajeCuadrado: number;
  /**
   * Variacion del faltante neto contra el periodo ANTERIOR de la serie,
   * en %. `null` en el primer punto: no hay contra que comparar, y
   * devolver 0 ahi seria mentir diciendo "no cambio".
   */
  variacionFaltantePct: number | null;
}

/**
 * Serie mes a mes de una sucursal. Recibe los puntos EN ORDEN cronologico
 * (lo garantiza el orderBy del service) y agrega la variacion contra el
 * mes anterior -- que es lo unico que convierte una lista de numeros en
 * una respuesta a "vamos mejor o peor que el mes pasado".
 */
export function compararPeriodos(puntos: PuntoComparativo[]): VariacionComparativo[] {
  return puntos.map((p, i) => {
    const anterior = i === 0 ? undefined : puntos[i - 1];
    let variacionFaltantePct: number | null = null;
    if (anterior !== undefined && anterior.montoFaltanteNeto !== 0) {
      variacionFaltantePct = redondear(
        ((p.montoFaltanteNeto - anterior.montoFaltanteNeto) / Math.abs(anterior.montoFaltanteNeto)) * 100,
        1,
      );
    }
    return {
      ...p,
      porcentajeCuadrado:
        p.itemsTotales === 0 ? 0 : redondear(((p.itemsTotales - p.itemsConDiferencia) / p.itemsTotales) * 100, 1),
      variacionFaltantePct,
    };
  });
}
