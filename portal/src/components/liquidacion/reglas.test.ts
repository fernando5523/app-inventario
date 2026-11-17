/**
 * Lo que estos tests protegen es CUÁNTA PLATA SALE DEL SUELDO DE ALGUIEN.
 *
 * No son tests de formato. Cada uno fija una distinción que ya costó caro en
 * esta app: un guion que se vuelve un 0 dice que no se le cobró nada a quien
 * sí se le cobró; un régimen mal leído redacta en días un cierre que se firmó
 * en personas; una resta hecha a ojo deja "-2 colaboradores" en pantalla.
 *
 * NINGÚN NOMBRE NI DOCUMENTO REAL EN LOS DATOS DE PRUEBA: esta pantalla
 * muestra personas con su descuento, y una fixture con un nombre de verdad lo
 * deja escrito en el repositorio para siempre.
 */

import { describe, expect, it } from 'vitest'
import {
  MOTIVO_SIN_LIQUIDAR,
  MOTIVO_SIN_PRODUCTOS,
  SIN_DATO,
  asistentesConCentavoExtra,
  bonoDeLaFila,
  diasFaltados,
  estadoAjustesNegativos,
  motivoSinCalcular,
  multaDeLaFila,
  multaPorInasistencia,
  notaFaltanteEmpresa,
  puedeLiquidar,
  regimenDeLaMulta,
  resumirAsistencia,
  textoDiasAsistidos,
  textoMontoReporte,
  textoSinPrecioReporte,
  textoUnidadesReporte,
  tieneFaltas,
  vistaReporteGerencia,
} from './reglas'
import type { AdvertenciaLiquidacion, DetalleLiquidacion, Liquidacion } from './tipos'

const soles = (n: number) => `S/ ${n.toFixed(2)}`
const miles = (n: number) => String(n)

const SIN_ADVERTENCIA: AdvertenciaLiquidacion = {
  itemsSinPrecio: 0,
  asistenciaSinRegistrar: false,
  ajustesSinRegistrar: false,
  mensaje: null,
}

/** Una fila anónima: la planilla real trae personas, las pruebas no. */
function fila(parcial: Partial<DetalleLiquidacion> = {}): DetalleLiquidacion {
  return {
    colaboradorId: 1,
    nombre: 'Colaborador de prueba',
    rol: 'conteo',
    asistio: true,
    diasAsistidos: 3,
    monto: 100,
    ...parcial,
  }
}

function liquidacion(parcial: Partial<Liquidacion> = {}): Liquidacion {
  return {
    inventarioId: 1,
    periodo: 'Setiembre 2026',
    periodoAnio: 2026,
    periodoMes: 9,
    faltanteBruto: 1000,
    negativosDelMes: 100,
    faltanteEmpresa: 50,
    faltanteNeto: 850,
    cuotaBase: 126.36,
    multaInasistencia: 20,
    bonoAsistencia: 11.43,
    diasDelInventario: 3,
    totalFaltas: 1,
    diasFaltadosEnTotal: 2,
    fondoMultas: 40,
    planilla: [],
    proyectada: true,
    advertencia: SIN_ADVERTENCIA,
    ...parcial,
  }
}

describe('motivoSinCalcular', () => {
  /** El `null` tiene que poder explicarse, o es un hueco sin motivo. */
  it('nombra las dos razones y las junta', () => {
    expect(motivoSinCalcular({ ...SIN_ADVERTENCIA, asistenciaSinRegistrar: true })).toBe(
      'No se puede calcular: falta registrar la asistencia.',
    )
    expect(
      motivoSinCalcular({ ...SIN_ADVERTENCIA, asistenciaSinRegistrar: true, ajustesSinRegistrar: true }),
    ).toBe('No se puede calcular: falta registrar la asistencia y faltan los ajustes del mes.')
  })

  it('sin razón conocida no inventa una', () => {
    expect(motivoSinCalcular(SIN_ADVERTENCIA)).toBe('No se puede calcular todavía.')
  })
})

describe('regimenDeLaMulta', () => {
  /**
   * `0` NO es "duró cero días": es un cierre de la regla vieja, donde la multa
   * fue un monto fijo por persona y ya está congelada en la planilla. Leerlo
   * como días redactaría "0 días faltados × S/20 = S/40", una cuenta que no
   * cierra a la vista de quien la lee.
   */
  it('distingue el cierre viejo de uno sin asistencia registrada', () => {
    expect(regimenDeLaMulta({ diasDelInventario: null })).toBe('sin-asistencia')
    expect(regimenDeLaMulta({ diasDelInventario: 0 })).toBe('multa-fija')
    expect(regimenDeLaMulta({ diasDelInventario: 3 })).toBe('multa-por-dia')
  })
})

describe('multaPorInasistencia y diasFaltados', () => {
  it('son días faltados por la tarifa, y nunca negativa', () => {
    expect(diasFaltados(3, 1)).toBe(2)
    expect(multaPorInasistencia(3, 1, 20)).toBe(40)
  })

  /**
   * Un asistido mayor que los días del inventario (una marca que se borró
   * después) daría una multa NEGATIVA, o sea plata a favor por un día que no
   * existió.
   */
  it('un asistido mayor que el inventario no genera plata a favor', () => {
    expect(diasFaltados(2, 5)).toBe(0)
    expect(multaPorInasistencia(2, 5, 20)).toBe(0)
  })
})

describe('multaDeLaFila', () => {
  /**
   * SIN ASISTENCIA REGISTRADA no se afirma nada sobre esta persona: ni que
   * vino, ni que faltó, ni cuánto se le cobra.
   */
  it('sin asistencia registrada, guion', () => {
    expect(multaDeLaFila(fila({ asistio: false }), liquidacion({ diasDelInventario: null }), soles)).toBe(SIN_DATO)
  })

  it('quien vino todos los días no paga multa', () => {
    expect(multaDeLaFila(fila({ asistio: true }), liquidacion(), soles)).toBe('S/ 0.00')
  })

  it('en el régimen por día multiplica los días faltados', () => {
    const l = liquidacion({ diasDelInventario: 3, multaInasistencia: 20 })
    expect(multaDeLaFila(fila({ asistio: false, diasAsistidos: 1 }), l, soles)).toBe('+S/ 40.00')
  })

  /** El cierre viejo ya se firmó con un monto fijo: no hay días que multiplicar. */
  it('en el régimen viejo cobra la tarifa entera', () => {
    const l = liquidacion({ diasDelInventario: 0, multaInasistencia: 20 })
    expect(multaDeLaFila(fila({ asistio: false, diasAsistidos: null }), l, soles)).toBe('+S/ 20.00')
  })

  /**
   * Los días de ESTA persona pueden faltar aunque el inventario sí tenga días.
   * Un 0 ahí diría "no se le cobró nada" sobre alguien a quien sí se le cobró.
   */
  it('sin los días de esa persona, guion y no cero', () => {
    expect(multaDeLaFila(fila({ asistio: false, diasAsistidos: null }), liquidacion(), soles)).toBe(SIN_DATO)
  })
})

describe('bonoDeLaFila', () => {
  it('lleva el signo de lo que hace: baja el descuento', () => {
    expect(bonoDeLaFila(fila({ asistio: true }), { bonoAsistencia: 11.43 }, soles)).toBe('–S/ 11.43')
  })

  it('quien tiene faltas no cobra bono', () => {
    expect(bonoDeLaFila(fila({ asistio: false }), { bonoAsistencia: 11.43 }, soles)).toBe('S/ 0.00')
  })

  it('sin bono calculado, guion', () => {
    expect(bonoDeLaFila(fila(), { bonoAsistencia: null }, soles)).toBe(SIN_DATO)
  })
})

describe('tieneFaltas', () => {
  /**
   * Con la asistencia sin registrar, `asistio: false` no acusa a nadie: quiere
   * decir que nadie marcó nada. Teñir esa fila sería señalar a una persona con
   * un dato que no existe.
   */
  it('no acusa cuando no hay asistencia registrada', () => {
    expect(tieneFaltas(fila({ asistio: false }), { diasDelInventario: null })).toBe(false)
    expect(tieneFaltas(fila({ asistio: false }), { diasDelInventario: 3 })).toBe(true)
    expect(tieneFaltas(fila({ asistio: true }), { diasDelInventario: 3 })).toBe(false)
  })
})

describe('textoDiasAsistidos', () => {
  /** Los dos números juntos: 2 de 2 y 2 de 5 son bono o tres días de multa. */
  it('muestra el numerador con su denominador', () => {
    expect(textoDiasAsistidos(2, 3)).toBe('2 de 3 días')
    expect(textoDiasAsistidos(1, 1)).toBe('1 de 1 día')
  })

  it('sin días registrados no arma una fracción', () => {
    expect(textoDiasAsistidos(0, 0)).toBe('Sin días registrados')
    expect(textoDiasAsistidos(null, 3)).toBe(SIN_DATO)
  })
})

describe('resumirAsistencia', () => {
  /** El bug real: `planilla.length - totalFaltas` con la planilla vacía daba -2. */
  it('nunca devuelve negativos y los dos suman el universo', () => {
    expect(resumirAsistencia(0, 2)).toEqual({ alcanzados: 0, asistieron: 0, faltaron: 0 })
    expect(resumirAsistencia(11, 9)).toEqual({ alcanzados: 11, asistieron: 9, faltaron: 2 })
    expect(resumirAsistencia(-3, -1)).toEqual({ alcanzados: 0, asistieron: 0, faltaron: 0 })
  })
})

describe('asistentesConCentavoExtra', () => {
  /**
   * S/80 entre 7 = seis de 11,43 y uno de 11,42. El piso que manda el servidor
   * es 11,42, así que seis filas muestran un centavo más — y sin decirlo, quien
   * compare el encabezado con la planilla cree que el sistema calcula mal.
   */
  it('cuenta a quienes recibieron un centavo más que el piso', () => {
    const planilla = [
      { asistio: true, monto: 100 - 11.43 },
      { asistio: true, monto: 100 - 11.43 },
      { asistio: true, monto: 100 - 11.42 },
      { asistio: false, monto: 100 + 20 },
    ]
    expect(asistentesConCentavoExtra(planilla, 100, 11.42)).toBe(2)
  })

  it('con el reparto parejo no hay ninguno', () => {
    const planilla = [
      { asistio: true, monto: 100 - 10 },
      { asistio: true, monto: 100 - 10 },
    ]
    expect(asistentesConCentavoExtra(planilla, 100, 10)).toBe(0)
  })
})

describe('estadoAjustesNegativos', () => {
  /** `null` bloquea liquidar; un `0` importado destraba: "se miró y no había". */
  it('distingue sin importar de importado en cero', () => {
    expect(estadoAjustesNegativos(null, soles).bloqueaLiquidacion).toBe(true)
    expect(estadoAjustesNegativos(0, soles).bloqueaLiquidacion).toBe(false)
    expect(estadoAjustesNegativos(0, soles).texto).toBe('Importado: S/ 0.00')
  })
})

describe('notaFaltanteEmpresa', () => {
  it('cambia de tiempo verbal según si la planilla ya cerró', () => {
    expect(notaFaltanteEmpresa(true)).toContain('queda fijo al liquidar')
    expect(notaFaltanteEmpresa(false)).toContain('al liquidar')
  })
})

describe('puedeLiquidar', () => {
  const completa = liquidacion({ planilla: [fila()] })

  it('con las tres condiciones puestas, se puede', () => {
    expect(puedeLiquidar(completa, 100)).toEqual({ puede: true, motivo: null })
  })

  /** El botón apagado tiene que decir qué ir a hacer, no "no se puede". */
  it('sin el Excel de ajustes manda a importarlo', () => {
    const r = puedeLiquidar(completa, null)
    expect(r.puede).toBe(false)
    expect(r.motivo).toContain('importa el Excel de ajustes')
  })

  it('sin días de asistencia nombra quién la marca', () => {
    const r = puedeLiquidar(liquidacion({ diasDelInventario: 0, planilla: [fila()] }), 100)
    expect(r.puede).toBe(false)
    expect(r.motivo).toContain('Asistencia del inventario')
  })

  /**
   * NO se exige "al menos un asistente": con la asistencia por día, un
   * inventario donde todos faltaron alguna jornada daría cero asistentes y
   * bloquearía una liquidación válida — una en la que TODOS trabajaron.
   */
  it('una planilla sin asistentes completos igual se puede liquidar', () => {
    const todosConFaltas = liquidacion({ planilla: [fila({ asistio: false, diasAsistidos: 1 })] })
    expect(puedeLiquidar(todosConFaltas, 100).puede).toBe(true)
  })

  it('con el neto sin calcular manda a las advertencias', () => {
    const r = puedeLiquidar(liquidacion({ faltanteNeto: null, planilla: [fila()] }), 100)
    expect(r.puede).toBe(false)
    expect(r.motivo).toContain('revisa las advertencias')
  })
})

describe('vistaReporteGerencia', () => {
  const vacio = { inventarioId: 1, estado: 'liquidado', faltantes: [], sobrantes: [], totalFaltante: 0, totalSobrante: 0 }

  /** Sin liquidar gana sobre todo: aunque haya quedado un reporte de otra tienda en memoria. */
  it('sin liquidar no muestra reporte aunque haya uno cargado', () => {
    const v = vistaReporteGerencia({ proyectada: true, reporte: vacio, error: 'algo' })
    expect(v).toEqual({ tipo: 'no-liquidado', motivo: MOTIVO_SIN_LIQUIDAR })
  })

  it('liquidado y sin productos lo dice, no muestra dos listas vacías', () => {
    const v = vistaReporteGerencia({ proyectada: false, reporte: vacio, error: null })
    expect(v).toEqual({ tipo: 'sin-productos', motivo: MOTIVO_SIN_PRODUCTOS })
  })

  it('cuenta los productos sin precio, que no suman al total', () => {
    const v = vistaReporteGerencia({
      proyectada: false,
      error: null,
      reporte: {
        ...vacio,
        faltantes: [
          { codigo: '1', descripcion: 'a', unidades: 2, monto: 10 },
          { codigo: '2', descripcion: 'b', unidades: 1, monto: null },
        ],
        totalFaltante: 10,
      },
    })
    expect(v.tipo).toBe('con-datos')
    if (v.tipo === 'con-datos') expect(v.sinPrecio).toBe(1)
  })
})

describe('textos del reporte', () => {
  /** "Sin precio" es un hecho; un 0 diría que el producto no vale nada. */
  it('sin precio no se muestra como cero', () => {
    expect(textoMontoReporte(null, soles)).toBe('Sin precio')
    expect(textoMontoReporte(0, soles)).toBe('S/ 0.00')
  })

  it('las unidades llevan el signo de su lista', () => {
    expect(textoUnidadesReporte('faltante', 5, miles)).toBe('-5 und')
    expect(textoUnidadesReporte('sobrante', 5, miles)).toBe('+5 und')
  })

  it('el aviso de sin precio concuerda en número', () => {
    expect(textoSinPrecioReporte(1)).toContain('1 producto no tiene')
    expect(textoSinPrecioReporte(3)).toContain('3 productos no tienen')
  })
})
