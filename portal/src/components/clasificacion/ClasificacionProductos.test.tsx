import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClasificacionProductos } from './ClasificacionProductos'
import type { PaginaDeProductos, ProductoClasificable } from './tipos'

/**
 * LO QUE PROTEGE ESTE ARCHIVO son las dos escrituras —guardar la excepción y
 * QUITARLA— y la frase que las acompaña. Es lo que no se puede mirar en una
 * captura: que el cuerpo del PUT lleve `empaqueCompraCorregido` explícito
 * (omitirlo borraría la corrección anterior sin que nadie lo pida), y que
 * quitar la excepción se explique como lo que es.
 */

const { buscar, clasificar, desclasificar } = vi.hoisted(() => ({
  buscar: vi.fn(),
  clasificar: vi.fn(),
  desclasificar: vi.fn(),
}))

vi.mock('./api', () => ({ clasificacionApi: { buscar, clasificar, desclasificar } }))

const CERVEZA: ProductoClasificable = {
  codigo: '100523',
  descripcion: 'CERVEZA PILSEN CALLAO 620ML',
  categoria: 'CERVEZAS',
  responsableDynamics: 'empleado',
  claseDynamics: 'unidad',
  empaqueCompra: 12,
  empaqueCompraSimbolo: 'Emp.12',
  clasificacion: null,
}

function pagina(productos: ProductoClasificable[], total = productos.length): PaginaDeProductos {
  return { total, limite: 40, desplazamiento: 0, productos }
}

function montar(productos = [CERVEZA]) {
  buscar.mockResolvedValue(pagina(productos))
  render(<ClasificacionProductos />)
  return userEvent.setup()
}

describe('Clasificación de productos', () => {
  it('muestra el total del CATÁLOGO, no el de lo que trajo', async () => {
    buscar.mockResolvedValue(pagina([CERVEZA], 11800))
    render(<ClasificacionProductos />)
    expect(await screen.findByText('Mostrando 1 de 11.800 productos')).toBeTruthy()
  })

  /**
   * `findAllBy` y no `findBy`: la pantalla dibuja la tabla Y las tarjetas de
   * móvil, y en jsdom no hay CSS que esconda una de las dos. Dos coincidencias
   * son lo correcto acá, no un duplicado a arreglar.
   */
  it('enfrenta lo que hace el sistema con la excepción del auditor', async () => {
    montar()
    expect((await screen.findAllByText('Empleado · Unidad')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sin excepción').length).toBeGreaterThan(0)
  })

  it('guarda el cuadro forzado Y el empaque, con el empaque explícito aunque esté vacío', async () => {
    const user = montar()
    await user.click(await screen.findByTitle(/Clasificar CERVEZA/))

    clasificar.mockResolvedValue({
      codigo: '100523', esEmpresa: true, clase: 'empresa', empaqueCompraCorregido: null,
      nota: null, clasificadoPorId: 103, clasificadoEn: '2026-10-17T12:00:00.000Z',
    })
    await user.click(await screen.findByRole('button', { name: 'Empresa' }))
    await user.click(screen.getByRole('button', { name: 'Guardar la excepción' }))

    // `empaqueCompraCorregido: null` VIAJA: es un PUT, y omitirlo borraría la
    // corrección anterior sin que nadie lo haya pedido.
    await waitFor(() =>
      expect(clasificar).toHaveBeenCalledWith('100523', { clase: 'empresa', empaqueCompraCorregido: null }),
    )
  })

  it('no deja guardar un cuerpo que no afirma nada', async () => {
    const user = montar()
    await user.click(await screen.findByTitle(/Clasificar CERVEZA/))

    const guardar = await screen.findByRole('button', { name: 'Guardar la excepción' })
    expect(guardar.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/por ahora no hay nada que guardar/)).toBeTruthy()
  })

  it('dice que quitar la excepción NO borra el producto, y nombra a dónde vuelve', async () => {
    const user = montar([
      {
        ...CERVEZA,
        clasificacion: {
          codigo: '100523', esEmpresa: true, clase: 'empresa', empaqueCompraCorregido: null,
          nota: null, clasificadoPorId: 103, clasificadoEn: '2026-09-11T12:00:00.000Z',
        },
      },
    ])
    await user.click(await screen.findByTitle(/Clasificar CERVEZA/))

    expect(await screen.findByText(/Quitar la excepción no borra el producto/)).toBeTruthy()
    // El cuadro al que vuelve es el del sistema, con su consecuencia.
    expect(screen.getByText(/Se le descuenta al personal, entero/)).toBeTruthy()

    desclasificar.mockResolvedValue(undefined)
    await user.click(screen.getByRole('button', { name: 'Quitar la excepción' }))
    await waitFor(() => expect(desclasificar).toHaveBeenCalledWith('100523'))
  })

  it('la búsqueda va al SERVIDOR, no filtra las filas que ya están', async () => {
    const user = montar()
    await screen.findAllByText('CERVEZA PILSEN CALLAO 620ML')
    buscar.mockClear()

    await user.type(screen.getByLabelText('Filtro'), 'pilsen')

    // Con un respiro entre tecla y tecla: un pedido, no seis.
    await waitFor(() => expect(buscar).toHaveBeenCalled())
    expect(buscar.mock.calls.at(-1)?.[0]).toMatchObject({ q: 'pilsen', desplazamiento: 0 })
  })
})
