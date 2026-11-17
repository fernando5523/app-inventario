import { describe, expect, it, vi } from 'vitest'
import type { Periodo, ResumenDeLaCadena } from '../../tipos'
import { PERIODOS_A_REVISAR, buscarPeriodoInicial, periodoAnterior } from './periodoInicial'

/** Un resumen mínimo: a la regla solo le importa el período y cuántas tiendas tienen inventario. */
function resumen(periodo: Periodo, conInventario: number): ResumenDeLaCadena {
  return { periodo, total: { conInventario }, tiendas: [] } as unknown as ResumenDeLaCadena
}

/** Una cadena falsa: `conDatos` son los períodos ("2026-9") que tienen inventario. */
function cadenaFalsa(conDatos: string[]) {
  return vi.fn(async (p: Periodo) => resumen(p, conDatos.includes(`${p.anio}-${p.mes}`) ? 3 : 0))
}

const pedidos = (pedir: ReturnType<typeof cadenaFalsa>) => pedir.mock.calls.map(([p]) => `${p.anio}-${p.mes}`)

describe('periodoAnterior', () => {
  it('retrocede un mes y cruza el año en enero', () => {
    expect(periodoAnterior({ anio: 2026, mes: 10 })).toEqual({ anio: 2026, mes: 9 })
    expect(periodoAnterior({ anio: 2026, mes: 1 })).toEqual({ anio: 2025, mes: 12 })
  })
})

describe('buscarPeriodoInicial', () => {
  it('si el mes en curso tiene datos, abre en él con un solo pedido', async () => {
    const pedir = cadenaFalsa(['2026-10'])
    const r = await buscarPeriodoInicial({ anio: 2026, mes: 10 }, pedir)
    expect(r?.periodo).toEqual({ anio: 2026, mes: 10 })
    expect(pedidos(pedir)).toEqual(['2026-10'])
  })

  it('con el mes en curso vacío abre en el anterior con datos y corta ahí', async () => {
    const pedir = cadenaFalsa(['2026-9', '2026-8'])
    const r = await buscarPeriodoInicial({ anio: 2026, mes: 10 }, pedir)
    expect(r?.periodo).toEqual({ anio: 2026, mes: 9 })
    expect(pedidos(pedir)).toEqual(['2026-10', '2026-9'])
  })

  it('cruza al año anterior', async () => {
    const pedir = cadenaFalsa(['2025-12'])
    const r = await buscarPeriodoInicial({ anio: 2026, mes: 1 }, pedir)
    expect(r?.periodo).toEqual({ anio: 2025, mes: 12 })
    expect(pedidos(pedir)).toEqual(['2026-1', '2025-12'])
  })

  it('pide de a uno: no lanza el siguiente hasta que vuelve el anterior', async () => {
    let enVuelo = 0
    let maximo = 0
    const pedir = async (p: Periodo) => {
      enVuelo++
      maximo = Math.max(maximo, enVuelo)
      await new Promise((r) => setTimeout(r, 1))
      enVuelo--
      return resumen(p, p.mes === 6 ? 1 : 0)
    }
    await buscarPeriodoInicial({ anio: 2026, mes: 10 }, pedir)
    expect(maximo).toBe(1)
  })

  it('sin datos en ningún período revisado devuelve el mes en curso, tras doce pedidos como máximo', async () => {
    const pedir = cadenaFalsa(['2025-10'])
    const r = await buscarPeriodoInicial({ anio: 2026, mes: 10 }, pedir)
    expect(PERIODOS_A_REVISAR).toBe(12)
    expect(r?.periodo).toEqual({ anio: 2026, mes: 10 })
    expect(r?.total.conInventario).toBe(0)
    expect(pedidos(pedir)).toHaveLength(12)
    expect(pedidos(pedir).at(-1)).toBe('2025-11')
  })

  it('un error de la red corta la búsqueda y se propaga', async () => {
    const pedir = vi
      .fn<(p: Periodo) => Promise<ResumenDeLaCadena>>()
      .mockResolvedValueOnce(resumen({ anio: 2026, mes: 10 }, 0))
      .mockRejectedValueOnce(new Error('sin conexión'))
    await expect(buscarPeriodoInicial({ anio: 2026, mes: 10 }, pedir)).rejects.toThrow('sin conexión')
    expect(pedir).toHaveBeenCalledTimes(2)
  })

  it('cancelada (la persona eligió a mano, o la pantalla se cerró) no pide más y devuelve null', async () => {
    const pedir = cadenaFalsa([])
    let cancelado = false
    pedir.mockImplementationOnce(async (p) => {
      cancelado = true
      return resumen(p, 0)
    })
    const r = await buscarPeriodoInicial({ anio: 2026, mes: 10 }, pedir, () => cancelado)
    expect(r).toBeNull()
    expect(pedir).toHaveBeenCalledTimes(1)
  })
})
