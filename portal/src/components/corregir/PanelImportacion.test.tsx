import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PanelImportacion } from './PanelImportacion'
import type { ResultadoConfirmacion, VistaPreviaImportacion } from './tipos'

/**
 * LO QUE ESTE ARCHIVO PROTEGE es el ORDEN y las DOS CIFRAS, que son las dos
 * formas en que esta pantalla puede mentirle al auditor:
 *
 *  - si las filas rechazadas quedan debajo de "42 filas quedaron igual", nadie
 *    las ve, y cada una es trabajo suyo que se pierde;
 *  - si al confirmar se muestra solo "aplicadas", parece un lote de todo o
 *    nada, y volver a subir el archivo entero repetiría lo que ya entró.
 *
 * El servidor va mockeado: lo que se prueba acá es la pantalla, y los
 * contratos ya están verificados contra el backend vivo.
 */

const { previsualizar, confirmar } = vi.hoisted(() => ({ previsualizar: vi.fn(), confirmar: vi.fn() }))
const { elegir } = vi.hoisted(() => ({ elegir: vi.fn() }))

vi.mock('./api', () => ({
  corregirApi: { previsualizarCorrecciones: previsualizar, confirmarCorrecciones: confirmar },
}))

vi.mock('./reglas', async (original) => ({
  ...(await original<typeof import('./reglas')>()),
  elegirArchivoXlsx: elegir,
}))

const VISTA_PREVIA: VistaPreviaImportacion = {
  ok: true,
  resumen: { aCorregir: 1, sinCambio: 42, rechazadas: 1, conAdvertencia: 1 },
  aCorregir: [
    {
      fila: 7, inventarioId: 8088, sucursal: 'Market Carhuaz', ronda: 1, hoja: '001',
      codigo: '100009', hojaId: 55, productoId: 9, contadoActual: 1, nuevoValor: 2,
      motivo: 'Se contó una caja de más',
    },
  ],
  sinCambio: [
    { fila: 12, inventarioId: 8088, ronda: 1, codigo: '100523', contado: 20, advertencias: ['motivo-sin-cambio'] },
  ],
  rechazadas: [
    {
      fila: 3, motivo: 'sin-conteo-previo', detalle: 'Nadie contó este producto en esa ronda.',
      codigo: '100108', inventarioId: 8088, ronda: 1,
    },
  ],
}

const CONFIRMADO: ResultadoConfirmacion = {
  nombreArchivo: 'conteos-2026-09-suc2.xlsx',
  aplicadoEn: '2026-10-17T14:00:00.000Z',
  resumen: { aCorregir: 1, sinCambio: 42, rechazadas: 2, conAdvertencia: 1, aplicadas: 1, fallidas: 1 },
  aplicadas: [
    {
      fila: 7, inventarioId: 8088, sucursal: 'Market Carhuaz', ronda: 1, hoja: '001',
      codigo: '100009', valorAnterior: 1, valorNuevo: 2, salioDeLaRondaSiguiente: false,
    },
  ],
  sinCambio: VISTA_PREVIA.sinCambio,
  rechazadas: [
    ...VISTA_PREVIA.rechazadas,
    {
      fila: 9, motivo: 'fallo-al-aplicar', detalle: 'El inventario ya pasó al ajuste final.',
      codigo: '100141', inventarioId: 8088, ronda: 1,
    },
  ],
}

function abrir() {
  elegir.mockResolvedValue({ nombre: 'conteos-2026-09-suc2.xlsx', bytes: new ArrayBuffer(8) })
  previsualizar.mockResolvedValue(VISTA_PREVIA)
  confirmar.mockResolvedValue(CONFIRMADO)
  const onAplicado = vi.fn()
  render(<PanelImportacion abierto onCerrar={vi.fn()} onAplicado={onAplicado} />)
  return { onAplicado, user: userEvent.setup() }
}

describe('la importación por Excel', () => {
  it('previsualiza sin escribir: elegir el archivo NO confirma nada', async () => {
    const { user } = abrir()
    await user.click(screen.getByRole('button', { name: /Elegir el archivo/ }))

    await screen.findByText(/1 fila rechazada/)
    expect(confirmar).not.toHaveBeenCalled()
    expect(screen.getByText(/Todavía no se escribió nada/)).toBeTruthy()
    // El botón nombra lo que va a pasar, no dice "Aceptar".
    expect(screen.getByRole('button', { name: /Aplicar 1 corrección/ })).toBeTruthy()
  })

  it('pone las rechazadas y las advertencias ARRIBA, y las que quedaron igual al final', async () => {
    const { user } = abrir()
    await user.click(screen.getByRole('button', { name: /Elegir el archivo/ }))
    await screen.findByText(/1 fila rechazada/)

    const texto = document.body.textContent ?? ''
    const posicion = (fragmento: string) => texto.indexOf(fragmento)
    expect(posicion('1 fila rechazada')).toBeGreaterThan(-1)
    expect(posicion('1 fila rechazada')).toBeLessThan(posicion('1 fila con advertencia'))
    expect(posicion('1 fila con advertencia')).toBeLessThan(posicion('1 corrección por aplicar'))
    expect(posicion('1 corrección por aplicar')).toBeLessThan(posicion('42 filas quedaron igual'))
  })

  it('cada fila lleva SU número de fila del Excel, que es como se la busca en el archivo', async () => {
    const { user } = abrir()
    await user.click(screen.getByRole('button', { name: /Elegir el archivo/ }))
    await screen.findByText(/1 fila rechazada/)

    expect(screen.getByText('Fila 3')).toBeTruthy()
    expect(screen.getByText('Fila 12')).toBeTruthy()
    expect(screen.getByText('Fila 7')).toBeTruthy()
    // La advertencia va en términos del negocio, no con el enum del servidor.
    expect(screen.getByText(/revisa si te faltó cambiarlo/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('motivo-sin-cambio')
  })

  it('al confirmar dice lo aplicado Y lo que falló, y que el lote no es todo o nada', async () => {
    const { user, onAplicado } = abrir()
    await user.click(screen.getByRole('button', { name: /Elegir el archivo/ }))
    await screen.findByText(/1 fila rechazada/)
    await user.click(screen.getByRole('button', { name: /Aplicar 1 corrección/ }))

    await screen.findByText(/Se aplicaron 1 corrección/)
    expect(screen.getByText(/1 fila falló y el resto sí entró/)).toBeTruthy()
    expect(screen.getByText(/no todo o nada/)).toBeTruthy()
    // El archivo se manda igual que se previsualizó, con su nombre.
    expect(confirmar).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'conteos-2026-09-suc2.xlsx')
    await waitFor(() => expect(onAplicado).toHaveBeenCalledWith(CONFIRMADO))
  })

  it('después de aplicar muestra los valores que el servidor GUARDÓ', async () => {
    const { user } = abrir()
    await user.click(screen.getByRole('button', { name: /Elegir el archivo/ }))
    await screen.findByText(/1 fila rechazada/)
    await user.click(screen.getByRole('button', { name: /Aplicar 1 corrección/ }))

    const bloque = await screen.findByText(/1 corrección aplicada/)
    const lista = bloque.parentElement as HTMLElement
    expect(within(lista).getByText(/1 → 2/)).toBeTruthy()
    // Y la fila que falló al escribir se suma a las rechazadas, con su motivo.
    expect(screen.getByText(/2 filas rechazadas/)).toBeTruthy()
    expect(screen.getByText(/El inventario ya pasó al ajuste final/)).toBeTruthy()
  })
})
