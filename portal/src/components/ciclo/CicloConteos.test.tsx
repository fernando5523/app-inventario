import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../store/authStore'
import type { InventarioActivo, ResumenRonda } from './cicloTipos'

/**
 * LO QUE ESTE ARCHIVO CUBRE, y por qué no se verificó en el navegador: con la
 * base de desarrollo del 2026-10-13 las once tiendas tenían inventario abierto,
 * así que el estado "esta tienda todavía no tiene inventario" y el rechazo del
 * servidor al abrir otra pasada no se podían producir con datos reales sin
 * tocar los inventarios sembrados. Acá se producen con el servidor mockeado.
 *
 * Los dos casos son los que más cuestan si se rompen:
 *   - el RECHAZO tiene que mostrar el texto del servidor TAL CUAL (dice qué
 *     regla se topó, y una de ellas ni siquiera es un error) y decir de cuál
 *     de las dos acciones habla;
 *   - una pasada que todavía no existe va en GUION, nunca en 0: un cero afirma
 *     que se contó y dio cero.
 */

const api = vi.hoisted(() => ({
  activo: vi.fn(),
  resumenDeRonda: vi.fn(),
  abrirRondaExtra: vi.fn(),
  iniciarAjuste: vi.fn(),
  historial: vi.fn(),
}))

vi.mock('./cicloApi', () => ({ cicloApi: api }))
vi.mock('../../services/api', () => ({
  default: {},
  sesionApi: { sucursales: vi.fn(async () => [{ id: 2, nombre: 'Market Carhuaz', colaboradores: 5 }]) },
}))
vi.mock('../../utils/notifyError', () => ({ notifyError: vi.fn() }))

import { CicloConteos } from './CicloConteos'

const ACTIVO: InventarioActivo = {
  inventarioId: 8088,
  estado: 'en_curso',
  items: 60,
  tomadoEn: '2026-10-13T12:00:00.000Z',
  tamanoHoja: 60,
  totalHojas: 2,
  rondaActiva: 2,
  ultimaRondaCerrada: 1,
  admiteConteo: true,
  stockDeRondaTomadoEn: null,
  stockDeRondaItems: null,
}

const resumen = (ronda: number, p: Partial<ResumenRonda>): ResumenRonda => ({
  inventarioId: 8088,
  ronda,
  total: 0,
  contados: 0,
  sinContar: 0,
  cuadrados: 0,
  aRecontar: 0,
  sinDatoErp: 0,
  porcentajeCuadrado: 0,
  hojasSinFinalizar: [],
  sePuedeCerrar: true,
  siguienteRonda: null,
  motivoSinSiguiente: null,
  ...p,
})

/** La sesión del Auditor de Luzuriaga, como la deja el login. */
function sesionDeAuditor() {
  useAuthStore.setState({
    colaborador: { id: 103, nombre: 'Gilmer Quispe', dni: '12345678', rol: 'auditor' },
    sucursal: { id: 2, nombre: 'Market Carhuaz', colaboradores: 5 },
    token: 'test',
    rol: 'auditor',
    isAuthenticated: true,
    isLoading: false,
  })
}

const dibujar = () => render(<CicloConteos />, { wrapper: MemoryRouter })

/**
 * LAS CONSULTAS VAN CONTRA LA TABLA, no contra el documento: la pantalla
 * dibuja TAMBIÉN las tarjetas de móvil (se esconden con una clase de Tailwind,
 * y jsdom no aplica CSS), así que cada pasada aparece dos veces en el árbol.
 * Buscar suelto encuentra las dos y falla con "found multiple elements".
 */
const enLaTabla = (container: HTMLElement) => within(container.querySelector('table')!)

beforeEach(() => {
  sesionDeAuditor()
  api.activo.mockResolvedValue(ACTIVO)
  api.historial.mockResolvedValue({ total: 0, inventarios: [] })
  // El caso real de Carhuaz: ronda 1 cerrada con 7 que no cuadraron, ronda 2
  // abierta con esos 7, ronda 3 que todavía no existe (404 -> rechaza).
  api.resumenDeRonda.mockImplementation(async (_inv: number, ronda: number) => {
    if (ronda === 1) return resumen(1, { total: 60, contados: 60, cuadrados: 53, aRecontar: 7, porcentajeCuadrado: 88.3 })
    if (ronda === 2) return resumen(2, { total: 7, contados: 7, aRecontar: 7 })
    throw new Error('404')
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('el embudo con datos reales de una ronda abierta', () => {
  it('muestra una fila por pasada, con el estado de cada una', async () => {
    const { container } = dibujar()
    await screen.findAllByText('Paso 1 · 1er Conteo General')
    const tabla = enLaTabla(container)
    expect(tabla.getByText('Paso 1 · 1er Conteo General')).toBeInTheDocument()
    expect(tabla.getByText('Paso 2 · 2do Reconteo')).toBeInTheDocument()
    expect(tabla.getByText('Paso 3 · 3er Reconteo')).toBeInTheDocument()
    // La 1ra cerró, la 2da es la activa con datos, la 3ra todavía no se abrió.
    expect(tabla.getByText('Cerrado')).toBeInTheDocument()
    expect(tabla.getByText('En curso')).toBeInTheDocument()
    expect(tabla.getByText('Pendiente')).toBeInTheDocument()
  })

  it('la pasada que todavía no existe va en GUION, nunca en 0', async () => {
    const { container } = dibujar()
    await screen.findAllByText('Paso 3 · 3er Reconteo')
    const filas = container.querySelectorAll('table tbody tr')
    const tercera = filas[2]
    const celdas = Array.from(tercera.querySelectorAll('td')).map((td) => td.textContent?.trim())
    // Entraron, Cuadraron, %, A recontar, Sin contar, Sin stock ERP: las seis en guion.
    expect(celdas.slice(2, 8)).toEqual(['—', '—', '—', '—', '—', '—'])
    expect(celdas).not.toContain('0')
  })

  it('el botón de abrir nombra la ronda SIGUIENTE a la activa', async () => {
    dibujar()
    expect(await screen.findByRole('button', { name: /Abrir el 3er conteo/ })).toBeEnabled()
  })
})

describe('cuando el servidor rechaza abrir otra pasada', () => {
  /**
   * El 409 del backend trae la regla escrita. Mostrar un "no se pudo" genérico
   * borraría la única información accionable -- y una de las negativas ("no
   * queda nada por recontar") es el caso feliz, no un error.
   */
  it('muestra el mensaje del servidor tal cual y dice de qué acción habla', async () => {
    const motivo =
      'La ronda 2 todavía tiene 1 hoja(s) sin finalizar — 001 (pendiente). Una hoja sin finalizar es una hoja que alguien todavía está contando.'
    api.abrirRondaExtra.mockRejectedValue({ response: { status: 409, data: { error: motivo } } })

    dibujar()
    const boton = await screen.findByRole('button', { name: /Abrir el 3er conteo/ })
    await userEvent.click(boton)

    await waitFor(() => expect(screen.getByText(motivo, { exact: false })).toBeInTheDocument())
    expect(screen.getByText('Abrir otro conteo:')).toBeInTheDocument()
  })

  it('el aviso se puede cerrar, y no vuelve solo', async () => {
    api.abrirRondaExtra.mockRejectedValue({ response: { status: 409, data: { error: 'No queda nada por recontar.' } } })
    dibujar()
    await userEvent.click(await screen.findByRole('button', { name: /Abrir el 3er conteo/ }))
    await waitFor(() => expect(screen.getByText(/No queda nada por recontar/)).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar el aviso' }))
    expect(screen.queryByText(/No queda nada por recontar/)).not.toBeInTheDocument()
  })
})

describe('el ajuste final se confirma antes de empezar', () => {
  /**
   * Es la asimetría del teléfono y es deliberada: abrir otra pasada crea hojas;
   * empezar el ajuste le saca al coordinador la posibilidad de corregir y SE
   * PUEDE UNA SOLA VEZ.
   */
  it('no se llama al servidor hasta confirmar', async () => {
    api.iniciarAjuste.mockResolvedValue({ inventarioId: 8088, estado: 'ajuste_auditor', ronda: 2 })
    dibujar()
    await userEvent.click(await screen.findByRole('button', { name: /Empezar el ajuste final/ }))
    expect(screen.getByText(/Se puede empezar una sola vez/)).toBeInTheDocument()
    expect(api.iniciarAjuste).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Empezar el ajuste' }))
    await waitFor(() => expect(api.iniciarAjuste).toHaveBeenCalledWith(8088))
  })

  it('y "Todavía no" lo cancela sin llamar a nadie', async () => {
    dibujar()
    await userEvent.click(await screen.findByRole('button', { name: /Empezar el ajuste final/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Todavía no' }))
    expect(api.iniciarAjuste).not.toHaveBeenCalled()
  })
})

describe('una tienda que todavía no tiene inventario', () => {
  /**
   * No es un error ni una falta de permisos: es el estado normal de cada tienda
   * al empezar el mes. Antes acá caían las tres pasadas con sus "todavía no
   * empezó", que sobre una tienda sin inventario se leen como un ciclo en curso
   * y atrasado.
   */
  it('lo dice, y no dibuja un embudo vacío', async () => {
    api.activo.mockResolvedValue(null)
    api.historial.mockResolvedValue({ total: 0, inventarios: [] })
    dibujar()
    expect(await screen.findByText('Esta tienda todavía no tiene inventario')).toBeInTheDocument()
    expect(screen.queryAllByText('Paso 1 · 1er Conteo General')).toHaveLength(0)
  })

  /** Sin inventario abierto, el ciclo que se muestra es el del último CERRADO. */
  it('pero si tiene uno cerrado, muestra ESE ciclo', async () => {
    api.activo.mockResolvedValue(null)
    api.historial.mockResolvedValue({
      total: 1,
      inventarios: [
        {
          id: 7001,
          sucursalId: 2,
          sucursalNombre: 'Market Carhuaz',
          estado: 'lacrado' as const,
          periodo: '2026-09',
          tamanoHoja: 50,
          snapshotItems: 60,
        },
      ],
    })
    const { container } = dibujar()
    await screen.findAllByText('Paso 1 · 1er Conteo General')
    expect(enLaTabla(container).getByText('Paso 1 · 1er Conteo General')).toBeInTheDocument()
    expect(screen.getByText(/Inventario 7001/)).toBeInTheDocument()
    // Con el inventario cerrado no hay nada que decidir: las dos acciones apagadas.
    expect(screen.getByRole('button', { name: /Abrir el/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Empezar el ajuste final/ })).toBeDisabled()
  })
})
