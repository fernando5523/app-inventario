import { describe, expect, it } from 'vitest'
import { formatoMiles, formatoPct } from '../../utils/formato'
import {
  RONDA_MAX,
  badgeDePaso,
  comparativoDeRonda,
  elAuditorPuedeDecidir,
  estadoDePaso,
  faseDeCierre,
  filasDelCiclo,
  inventarioDelCiclo,
  ordinal,
  pasadasCorridas,
  rondaQueAdmiteConteo,
  ultimaPasadaConDatos,
  type ResumenParaMostrar,
} from './cicloDominio'

/**
 * LAS REGLAS DEL CICLO, FIJADAS. Cada bloque de abajo corresponde a un bug
 * real que ya se arregló en la app del teléfono: este archivo existe para que
 * la copia del portal no los vuelva a tener.
 *
 * El caso con datos reales es Market Carhuaz (inventario 8088, leído del
 * backend vivo el 2026-10-13): ronda 1 con 60 ítems y 53 cuadrados, ronda 2
 * abierta con los 7 que no cuadraron.
 */

const ronda = (p: Partial<ResumenParaMostrar>): ResumenParaMostrar => ({
  total: 0,
  cuadrados: 0,
  aRecontar: 0,
  sinContar: 0,
  sinDatoErp: 0,
  ...p,
})

describe('ordinal: responde para cualquier ronda, no solo para tres', () => {
  it('usa la forma irregular del español en las primeras', () => {
    expect([1, 2, 3, 4, 5, 6].map(ordinal)).toEqual(['1er', '2do', '3er', '4to', '5to', '6to'])
  })

  /** Decía "undefined conteo abierto" justo en el paso que acababa de inventarse. */
  it('y compone con el número de la 7ma en adelante, sin devolver undefined', () => {
    expect(ordinal(7)).toBe('7°')
    expect(ordinal(12)).toBe('12°')
  })
})

describe('estadoDePaso: el badge sale de la ronda activa, nunca de un literal', () => {
  it('las anteriores a la activa están cerradas y la activa con datos, en curso', () => {
    expect(estadoDePaso(1, 2, true)).toBe('cerrado')
    expect(estadoDePaso(2, 2, true)).toBe('en-curso')
    expect(estadoDePaso(3, 2, false)).toBe('pendiente')
  })

  /** Una ronda abierta sin una sola hoja cargada no está "en curso": está pendiente. */
  it('la activa sin datos queda pendiente', () => {
    expect(estadoDePaso(2, 2, false)).toBe('pendiente')
  })

  /**
   * Sin ronda activa el conteo ya cerró. Lo que corrió quedó cerrado; lo que
   * nunca se abrió no tiene nada que mostrar -- y son dos etiquetas distintas
   * porque "cuadró antes de llegar acá" no es "todavía no empezó".
   */
  it('sin ronda activa distingue lo que corrió de lo que nunca se abrió', () => {
    expect(estadoDePaso(1, null, true)).toBe('cerrado')
    expect(estadoDePaso(3, null, false)).toBe('sin-datos')
  })

  it('cada estado tiene su etiqueta, y ninguna se repite', () => {
    const etiquetas = (['cerrado', 'en-curso', 'pendiente', 'sin-datos'] as const).map((e) => badgeDePaso(e).label)
    expect(etiquetas).toEqual(['Cerrado', 'En curso', 'Pendiente', 'Sin datos todavía'])
    expect(new Set(etiquetas).size).toBe(4)
  })
})

describe('comparativoDeRonda', () => {
  it('el porcentaje se mide sobre los AUDITABLES, no sobre el total', () => {
    // 10 ítems, 2 sin stock del ERP: 8 auditables, 4 cuadrados -> 50%, no 40%.
    const c = comparativoDeRonda(ronda({ total: 10, cuadrados: 4, aRecontar: 4, sinDatoErp: 2 }), formatoMiles, formatoPct)
    expect(c?.auditables).toBe(8)
    expect(c?.avance.pct).toBe(50)
  })

  /** Con el stock del ERP ausente en todo, no se afirma un porcentaje. */
  it('sin ningún auditable el porcentaje es 0 y no una división por cero', () => {
    const c = comparativoDeRonda(ronda({ total: 5, sinDatoErp: 5 }), formatoMiles, formatoPct)
    expect(c?.avance.pct).toBe(0)
    expect(c?.auditables).toBe(0)
  })

  /** `null` = la ronda no existe; `total: 0` = no entró ningún ítem. Las dos sin comparativo. */
  it('devuelve null cuando no hay ronda o no entró nada', () => {
    expect(comparativoDeRonda(null, formatoMiles, formatoPct)).toBeNull()
    expect(comparativoDeRonda(ronda({ total: 0 }), formatoMiles, formatoPct)).toBeNull()
  })

  it('solo nombra lo que no es cero: un "0 sin contar" sería ruido', () => {
    const c = comparativoDeRonda(ronda({ total: 60, cuadrados: 53, aRecontar: 7 }), formatoMiles, formatoPct)
    expect(c?.detalle).toBe('53 cuadraron contra Dynamics · 7 pasan al siguiente conteo.')
    expect(c?.detalle).not.toContain('sin contar')
    expect(c?.detalle).not.toContain('sin stock')
  })

  /** En la 2da y la 3ra pasada el embudo trabaja sobre pocos ítems y puede dar 1. */
  it('el verbo concuerda con su cifra', () => {
    const c = comparativoDeRonda(ronda({ total: 2, cuadrados: 1, aRecontar: 1 }), formatoMiles, formatoPct)
    expect(c?.detalle).toBe('1 cuadró contra Dynamics · 1 pasa al siguiente conteo.')
    expect(c?.avance.texto).toBe('1 de 2 ítems cuadrados (50,0%)')
  })

  it('el sustantivo del avance concuerda con el total de auditables, no con los cuadrados', () => {
    const c = comparativoDeRonda(ronda({ total: 1, cuadrados: 1 }), formatoMiles, formatoPct)
    expect(c?.avance.texto).toBe('1 de 1 ítem cuadrado (100,0%)')
  })
})

describe('faseDeCierre', () => {
  it('el ajuste del auditor manda sobre todo lo demás', () => {
    expect(faseDeCierre('ajuste_auditor', 4, 34, 4)).toBe('ajuste')
  })

  it('cualquier estado que no sea en_curso ya cerró el conteo', () => {
    expect(faseDeCierre('conteo_cerrado', 3, 10, 3)).toBe('cerrado')
    expect(faseDeCierre('liquidado', 3, 10, 3)).toBe('cerrado')
    expect(faseDeCierre('lacrado', 3, 10, 3)).toBe('cerrado')
  })

  /**
   * BUG REAL (2026-09-21): el catálogo traído y CERO hojas se leía como "el
   * conteo de este inventario terminó". Son lo contrario: nada empezó todavía.
   */
  it('con el catálogo traído y cero hojas el conteo NO terminó: no empezó', () => {
    expect(faseDeCierre('en_curso', null, 0, null)).toBe('sin-hojas')
  })

  /**
   * EL CAMINO NORMAL: al cerrar la ronda 1 con diferencias queda
   * `rondaActiva: 2` y `ultimaRondaCerrada: 1`, así que sigue 'contando'. Es el
   * caso real de Market Carhuaz.
   */
  it('cerrar una ronda que abre la siguiente sigue siendo "contando"', () => {
    expect(faseDeCierre('en_curso', 2, 2, 1)).toBe('contando')
  })

  /**
   * BUG REAL (2026-09-22, los 980 ítems de Luzuriaga cuadrando): cuando TODO
   * cuadra no se crea la ronda siguiente, así que el cierre no dejaba huella y
   * la pantalla seguía diciendo "Paso 1 · En curso". La marca propia
   * (`ultimaRondaCerrada`) es la que lo resuelve.
   */
  it('la última ronda cerrada igual a la activa es la ventana del auditor', () => {
    expect(faseDeCierre('en_curso', 1, 20, 1)).toBe('rondas-cerradas')
    expect(faseDeCierre('en_curso', 3, 20, 3)).toBe('rondas-cerradas')
  })

  it('sin ninguna ronda cerrada todavía se está contando', () => {
    expect(faseDeCierre('en_curso', 1, 20, null)).toBe('contando')
  })

  /**
   * Las dos decisiones se ofrecen en 'contando' y en 'rondas-cerradas' -- no
   * solo en la segunda. Con el candado en 'rondas-cerradas' la pantalla decía
   * "el auditor decide" y no mostraba un botón para decidir nada.
   */
  it('el auditor decide con el inventario abierto, no solo con la ronda cerrada', () => {
    expect(elAuditorPuedeDecidir('contando')).toBe(true)
    expect(elAuditorPuedeDecidir('rondas-cerradas')).toBe(true)
    expect(elAuditorPuedeDecidir('ajuste')).toBe(false)
    expect(elAuditorPuedeDecidir('cerrado')).toBe(false)
    expect(elAuditorPuedeDecidir('sin-hojas')).toBe(false)
  })
})

describe('rondaQueAdmiteConteo', () => {
  /**
   * BUG REAL (inventario 8040 en `ajuste_auditor`): el Paso 3 decía "En curso"
   * con la ronda 3 ya cerrada, porque `rondaActiva` es `max(numeroConteo)` y
   * sigue siendo un número mientras el auditor ajusta.
   */
  it('en el ajuste no hay ninguna ronda abierta, aunque rondaActiva sea un número', () => {
    expect(rondaQueAdmiteConteo('ajuste', 4)).toBeNull()
    expect(rondaQueAdmiteConteo('cerrado', 3)).toBeNull()
    expect(rondaQueAdmiteConteo('rondas-cerradas', 3)).toBeNull()
  })

  it('contando, la abierta es la activa', () => {
    expect(rondaQueAdmiteConteo('contando', 2)).toBe(2)
  })

  it('sin fase conocida se devuelve la activa tal cual', () => {
    expect(rondaQueAdmiteConteo(null, 2)).toBe(2)
  })
})

describe('inventarioDelCiclo', () => {
  const activo = { inventarioId: 8088, items: 60, tamanoHoja: 60, rondaActiva: 2, totalHojas: 2 }

  it('con inventario abierto, ese es el del ciclo', () => {
    expect(inventarioDelCiclo(activo, [])).toEqual({
      inventarioId: 8088,
      items: 60,
      tamanoHoja: 60,
      rondaActiva: 2,
      totalHojas: 2,
    })
  })

  /**
   * `activo()` devuelve null con el inventario ya cerrado, y la pantalla se
   * quedaba EN BLANCO sobre un ciclo que terminó con sus pasadas contadas.
   */
  it('sin inventario abierto, el ciclo es el último CERRADO del histórico', () => {
    const r = inventarioDelCiclo(null, [
      { id: 90, estado: 'anulado', tamanoHoja: 50, snapshotItems: 10 },
      { id: 80, estado: 'lacrado', tamanoHoja: 50, snapshotItems: 985 },
      { id: 70, estado: 'conteo_cerrado', tamanoHoja: 30, snapshotItems: 300 },
    ])
    expect(r?.inventarioId).toBe(80)
    expect(r?.items).toBe(985)
    // `null` NO es 1: con el inventario cerrado no hay ronda que cerrar.
    expect(r?.rondaActiva).toBeNull()
  })

  it('un histórico sin ningún inventario cerrado no tiene ciclo que mostrar', () => {
    expect(inventarioDelCiclo(null, [{ id: 90, estado: 'anulado', tamanoHoja: 50, snapshotItems: 10 }])).toBeNull()
    expect(inventarioDelCiclo(null, [])).toBeNull()
  })
})

describe('filasDelCiclo', () => {
  /** El caso real de Market Carhuaz: ronda 1 cerrada, ronda 2 abierta con 7 ítems. */
  const carhuaz = {
    1: ronda({ total: 60, cuadrados: 53, aRecontar: 7 }),
    2: ronda({ total: 7, aRecontar: 7 }),
    3: null,
  }

  it('las tres pasadas del ciclo automático siempre están, aunque la 3ra no exista', () => {
    const filas = filasDelCiclo(carhuaz, 2, formatoMiles, formatoPct)
    expect(filas.map((f) => f.ronda)).toEqual([1, 2, 3])
    expect(filas.length).toBe(RONDA_MAX)
  })

  it('la que no existe va sin comparativo: todas sus cifras son guion, nunca 0', () => {
    const tercera = filasDelCiclo(carhuaz, 2, formatoMiles, formatoPct)[2]
    expect(tercera.comparativo).toBeNull()
    expect(tercera.resumen).toBeNull()
    expect(tercera.estado).toBe('pendiente')
  })

  /** La nota explica POR QUÉ no empezó, en vez de dejar la descripción genérica. */
  it('una pasada sin datos muestra por qué todavía no empezó', () => {
    const filas = filasDelCiclo(carhuaz, 2, formatoMiles, formatoPct)
    expect(filas[2].descripcion).toContain('se abre al cerrar el 2do')
    // La que SÍ corrió muestra qué entra en ella.
    expect(filas[0].descripcion).toContain('100% del catálogo')
  })

  it('los títulos son los del teléfono, uno por pasada', () => {
    const filas = filasDelCiclo(carhuaz, 2, formatoMiles, formatoPct)
    expect(filas.map((f) => f.titulo)).toEqual([
      'Paso 1 · 1er Conteo General',
      'Paso 2 · 2do Reconteo',
      'Paso 3 · 3er Reconteo',
    ])
  })

  /**
   * LAS RONDAS EXTRA SOLO SI EXISTEN. Dibujar las posiciones hasta la ronda
   * activa haría aparecer una pasada que nadie abrió, y un paso vacío se lee
   * como "acá no cuadró nada", que es una afirmación.
   */
  it('una 4ta pasada con datos entra; una sin datos no se inventa', () => {
    const conCuarta = { ...carhuaz, 3: ronda({ total: 5, cuadrados: 2, aRecontar: 3 }), 4: ronda({ total: 3, aRecontar: 3 }), 5: null }
    const filas = filasDelCiclo(conCuarta, 4, formatoMiles, formatoPct)
    expect(filas.map((f) => f.ronda)).toEqual([1, 2, 3, 4])
    expect(filas[3].titulo).toBe('Paso 4 · 4to Conteo')
    expect(filas[3].descripcion).toContain('abierto por el auditor')
    expect(filas[3].descripcion).toContain('tras el 3er')
  })

  it('cuenta las pasadas que corrieron de verdad, no las posibles', () => {
    expect(pasadasCorridas(carhuaz)).toBe(2)
    expect(pasadasCorridas({ 1: ronda({ total: 10, cuadrados: 10 }), 2: null, 3: null })).toBe(1)
  })

  /**
   * LA ÚLTIMA PASADA CON DATOS dice dónde quedó el ciclo. No se suman las
   * pasadas: un ítem que pasó de la 1 a la 2 está en las dos.
   */
  it('la última pasada con datos es la que dice dónde quedó el ciclo', () => {
    const filas = filasDelCiclo(carhuaz, 2, formatoMiles, formatoPct)
    expect(ultimaPasadaConDatos(filas)?.ronda).toBe(2)
    const soloPrimera = filasDelCiclo({ 1: carhuaz[1], 2: null, 3: null }, 1, formatoMiles, formatoPct)
    expect(ultimaPasadaConDatos(soloPrimera)?.ronda).toBe(1)
    const ninguna = filasDelCiclo({ 1: null, 2: null, 3: null }, null, formatoMiles, formatoPct)
    expect(ultimaPasadaConDatos(ninguna)).toBeNull()
  })

  /** Con el inventario en ajuste, ninguna pasada puede estar "en curso". */
  it('en el ajuste todas las pasadas con datos quedan cerradas', () => {
    const filas = filasDelCiclo(carhuaz, rondaQueAdmiteConteo('ajuste', 2), formatoMiles, formatoPct)
    expect(filas[0].estado).toBe('cerrado')
    expect(filas[1].estado).toBe('cerrado')
    expect(filas[2].estado).toBe('sin-datos')
  })
})
