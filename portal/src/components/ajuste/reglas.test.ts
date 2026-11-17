import { describe, expect, it } from 'vitest'
import type { ItemDeLaMatriz } from '../corregir/tipos'
import {
  diferenciaDelAjuste,
  interpretarCantidad,
  productoIdPorCodigo,
  puedeAjustar,
  puedeIniciarAjuste,
  sinCuadrar,
} from './reglas'

/**
 * Las reglas propias del ajuste. Lo que fijan es lo que decide plata:
 * cuándo se puede escribir, qué cuenta como valor, contra qué stock se mide
 * la previsualización y qué ítems ofrece el filtro por defecto.
 */

const item = (p: Partial<ItemDeLaMatriz> = {}): ItemDeLaMatriz => ({
  productoId: 1,
  codigo: '0051',
  descripcion: 'Producto',
  hoja: '001',
  stockErp: 10,
  conteos: [10],
  conteoFinal: 10,
  diferenciaUnidades: 0,
  veredicto: 'cuadrado',
  stockDeLaMedicion: { stockErp: 10, rondaDelConteo: 1, rondaDelStock: 1, cayoALaRonda1: false },
  ...p,
})

describe('cuándo se puede ajustar', () => {
  /** Es la misma ventana que sostiene el servidor en validarAjusteEnCurso. */
  it('solo con el ajuste ya iniciado', () => {
    expect(puedeAjustar('ajuste')).toBe(true)
    for (const fase of ['contando', 'rondas-cerradas', 'cerrado', 'sin-hojas'] as const) {
      expect(puedeAjustar(fase)).toBe(false)
    }
    expect(puedeAjustar(null)).toBe(false)
  })

  /** Iniciar es lo contrario: se puede ANTES, con la última ronda cerrada. */
  it('y se puede INICIAR solo con las rondas cerradas', () => {
    expect(puedeIniciarAjuste('rondas-cerradas')).toBe(true)
    expect(puedeIniciarAjuste('ajuste')).toBe(false)
    expect(puedeIniciarAjuste('contando')).toBe(false)
  })
})

describe('el valor definitivo', () => {
  it('es un entero en unidades', () => {
    expect(interpretarCantidad('12')).toEqual({ ok: true, valor: 12 })
    expect(interpretarCantidad(' 7 ')).toEqual({ ok: true, valor: 7 })
  })

  /** Un 0 real es un valor: "lo revisé y no había". */
  it('acepta el cero', () => {
    expect(interpretarCantidad('0')).toEqual({ ok: true, valor: 0 })
  })

  /** VACÍO NO ES CERO: guardar un campo en blanco fijaría un valor que nadie afirmó. */
  it('pero el campo vacío no es cero: es "todavía no escribí"', () => {
    const r = interpretarCantidad('')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.mensaje).toMatch(/unidades/)
  })

  it.each(['2,5', '-3', 'doce', '1.5'])('rechaza %s', (texto) => {
    expect(interpretarCantidad(texto).ok).toBe(false)
  })
})

describe('la previsualización de la diferencia', () => {
  /** Se mide contra el stock de LA MEDICIÓN, no contra item.stockErp. */
  it('usa el stock de la ronda contra la que se midió el ítem', () => {
    const i = item({ stockErp: 99, stockDeLaMedicion: { stockErp: 20, rondaDelConteo: 3, rondaDelStock: 1, cayoALaRonda1: true } })
    expect(diferenciaDelAjuste(i, 20)).toBe(0)
    expect(diferenciaDelAjuste(i, 18)).toBe(-2)
    expect(diferenciaDelAjuste(i, 25)).toBe(5)
  })

  /** Sin stock no se puede afirmar nada. `null`, nunca 0: un cero diría "cuadra exacto". */
  it('es null cuando el ERP no trajo stock', () => {
    const i = item({ stockDeLaMedicion: { stockErp: null, rondaDelConteo: 1, rondaDelStock: null, cayoALaRonda1: false } })
    expect(diferenciaDelAjuste(i, 5)).toBeNull()
  })
})

describe('el filtro por defecto', () => {
  /** `empresa` entra con `falta`: tiene diferencia real, solo cambia quién la absorbe. */
  it('deja los que no cuadran, incluidos los de empresa', () => {
    const filas = [
      item({ productoId: 1, veredicto: 'cuadrado' }),
      item({ productoId: 2, veredicto: 'falta' }),
      item({ productoId: 3, veredicto: 'empresa' }),
      item({ productoId: 4, veredicto: 'sin_erp' }),
      item({ productoId: 5, veredicto: 'sin_contar' }),
    ]
    expect(sinCuadrar(filas).map((f) => f.productoId)).toEqual([2, 3])
  })
})

describe('productoIdPorCodigo', () => {
  it('toma el id de la hoja de la ronda que recibe, no el de la matriz', () => {
    const mapa = productoIdPorCodigo([
      { productos: [{ id: 8054, codigo: '100150' }] },
      { productos: [{ id: 8055, codigo: '113967' }] },
    ])
    expect(mapa.get('100150')).toBe(8054)
    expect(mapa.get('113967')).toBe(8055)
  })

  it('el que no entro en esa ronda no esta: no es ajustable', () => {
    const mapa = productoIdPorCodigo([{ productos: [{ id: 8054, codigo: '100150' }] }])
    expect(mapa.has('106230')).toBe(false)
  })

  it('sin hojas devuelve un mapa vacio, no explota', () => {
    expect(productoIdPorCodigo([]).size).toBe(0)
  })
})
