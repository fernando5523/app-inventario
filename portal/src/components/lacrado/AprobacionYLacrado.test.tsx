import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../store/authStore'
import type { EstadoLacrado, InventarioDelHistorial } from './lacradoTipos'

/**
 * LO QUE CUBRE ESTE ARCHIVO, Y POR QUÉ NO SE VERIFICÓ EN EL NAVEGADOR.
 *
 * Con la base de desarrollo del 2026-10-17 NINGUNA de las once tiendas tiene un
 * inventario en estado lacrable: diez están `en_curso` y Luzuriaga en
 * `ajuste_auditor` (medido contra el backend vivo, ver el informe). Con esos
 * datos la pantalla muestra, correctamente, "Todavía no hay nada que lacrar"
 * para todas -- así que la lista de firmas, la tarjeta del sello y el diálogo
 * de confirmación no se pueden producir con datos reales sin cerrar el conteo
 * de alguna tienda, y eso alteraría el escenario compartido que usan los demás
 * agentes. Acá se producen con el servidor mockeado.
 *
 * LOS CASOS SON LOS QUE MÁS CUESTAN SI SE ROMPEN:
 *   - el BOTÓN DE LACRAR habilitado cuando no corresponde: es irreversible;
 *   - la CONFIRMACIÓN tiene que nombrar la consecuencia, no preguntar "¿estás
 *     seguro?";
 *   - el REGISTRO EN EL ERP tiene que decir que lo hace una persona, nunca
 *     insinuar que el sistema lo envió;
 *   - la VERIFICACIÓN del sello no se ofrece antes de lacrar: el servidor
 *     contesta 409 "no hay sello que verificar" (verificado con curl).
 *
 * NINGUNA PRUEBA CONFIRMA EL LACRADO. Se llega al diálogo y se cancela, igual
 * que la verificación manual: `lacrar` no se llama ni con el api mockeado, para
 * que el archivo no enseñe a hacerlo.
 */

const api = vi.hoisted(() => ({
  historial: vi.fn(),
  estado: vi.fn(),
  verificacion: vi.fn(),
  aprobar: vi.fn(),
  lacrar: vi.fn(),
  marcarRegistradoEnErp: vi.fn(),
}))

vi.mock('./lacradoApi', () => ({ lacradoApi: api }))
vi.mock('../../services/api', () => ({
  default: {},
  sesionApi: {
    sucursales: vi.fn(async () => [{ id: 1, nombre: 'Market Luzuriaga', colaboradores: 11 }]),
    administradores: vi.fn(async () => [
      { id: 103, nombre: 'Gilmer Quispe', dni: '3421', rol: 'auditor' },
      { id: 106, nombre: 'Rosa Melgarejo', dni: '3422', rol: 'auditor' },
      { id: 1000, nombre: 'Admin Sistema', dni: '9999', rol: 'administrador' },
    ]),
  },
}))

import { AprobacionYLacrado } from './AprobacionYLacrado'

const CERRADO: InventarioDelHistorial = {
  id: 8078,
  sucursalId: 1,
  sucursalNombre: 'Market Luzuriaga',
  estado: 'conteo_cerrado',
  periodo: '2026-09',
  snapshotItems: 985,
}

function estado(parcial: Partial<EstadoLacrado> = {}): EstadoLacrado {
  return {
    inventarioId: 8078,
    aprobaciones: [],
    // 1 es la configuración REAL del backend (`APROBACIONES_REQUERIDAS`),
    // verificada con curl: `aprobacionesRequeridas: 1`.
    aprobacionesRequeridas: 1,
    todoSincronizado: true,
    lacrado: false,
    hash: null,
    lacradoEn: null,
    registradoManualmenteEnDynamics: false,
    ...parcial,
  }
}

function sembrar(estadoLacrado: EstadoLacrado, inventarios: InventarioDelHistorial[] = [CERRADO]): void {
  api.historial.mockResolvedValue({ inventarios })
  api.estado.mockResolvedValue(estadoLacrado)
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({
    colaborador: { id: 103, nombre: 'Gilmer Quispe', dni: '3421', rol: 'auditor' },
    sucursal: { id: 1, nombre: 'Market Luzuriaga', colaboradores: 11 },
  } as never)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('qué inventario se ofrece lacrar', () => {
  it('con todo en curso no hay nada que sellar, y lo dice', async () => {
    sembrar(estado(), [{ ...CERRADO, estado: 'en_curso' }])
    render(<AprobacionYLacrado />)
    expect(await screen.findByText('Todavía no hay nada que lacrar')).toBeInTheDocument()
    // No se pidió el estado de un inventario que no se puede lacrar.
    expect(api.estado).not.toHaveBeenCalled()
  })

  /**
   * EL AJUSTE FINAL NO SE PUEDE LACRAR TODAVÍA, y es el caso real de Luzuriaga
   * con la base de hoy: el conteo todavía no cerró.
   */
  it('un inventario en ajuste final tampoco', async () => {
    sembrar(estado(), [{ ...CERRADO, estado: 'ajuste_auditor' }])
    render(<AprobacionYLacrado />)
    expect(await screen.findByText('Todavía no hay nada que lacrar')).toBeInTheDocument()
  })

  it('con el conteo cerrado sí: muestra el inventario y sus ítems', async () => {
    sembrar(estado())
    render(<AprobacionYLacrado />)
    expect(await screen.findByText('Inventario a lacrar')).toBeInTheDocument()
    expect(screen.getByText('2026-09')).toBeInTheDocument()
    expect(screen.getByText('985 ítems del inventario')).toBeInTheDocument()
  })
})

describe('la lista de firmas', () => {
  it('solo la fila de quien está en sesión tiene botón', async () => {
    sembrar(estado())
    render(<AprobacionYLacrado />)
    await screen.findByText('Gilmer Quispe')

    expect(screen.getByRole('button', { name: /Aprobar/ })).toBeEnabled()
    // Rosa está en la lista para que se entienda quién es, pero sin botón: no
    // la puede aprobar quien no es ella.
    expect(screen.getByText('Rosa Melgarejo')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Aprobar/ })).toHaveLength(1)
  })

  it('el administrador no entra a la lista de firmantes', async () => {
    sembrar(estado())
    render(<AprobacionYLacrado />)
    await screen.findByText('Gilmer Quispe')
    expect(screen.queryByText('Admin Sistema')).not.toBeInTheDocument()
  })

  it('una firma registrada muestra cuándo firmó, y el botón ya no está', async () => {
    sembrar(
      estado({ aprobaciones: [{ colaboradorId: 103, nombre: 'Gilmer Quispe', fecha: '2026-10-17T14:32:00.000Z' }] }),
    )
    render(<AprobacionYLacrado />)
    await screen.findByText('Gilmer Quispe')
    expect(screen.getByText(/Firmó el/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Aprobar/ })).not.toBeInTheDocument()
  })

  it('aprobar manda la firma de la sesión y pinta el estado que devuelve el servidor', async () => {
    sembrar(estado())
    api.aprobar.mockResolvedValue(
      estado({ aprobaciones: [{ colaboradorId: 103, nombre: 'Gilmer Quispe', fecha: '2026-10-17T14:32:00.000Z' }] }),
    )
    render(<AprobacionYLacrado />)
    await screen.findByText('Gilmer Quispe')

    await userEvent.click(screen.getByRole('button', { name: /Aprobar/ }))
    // Sin argumentos de identidad: quién firma sale del token.
    await waitFor(() => expect(api.aprobar).toHaveBeenCalledWith(8078))
    expect(await screen.findByText(/Firmó el/)).toBeInTheDocument()
  })

  /**
   * EL CASO REAL DE UN INVENTARIO EN `conteo_cerrado`, y la razón de que el
   * rechazo tenga que quedarse en pantalla.
   *
   * `historial.permisos.ts#ESTADOS_APROBABLES` es `['liquidado']` a secas: con
   * el conteo cerrado pero sin liquidar, el botón "Aprobar" está habilitado --
   * la pantalla del teléfono lo habilita igual, y este port no cambió esa regla
   * -- y el servidor contesta 409 explicando que primero hay que cerrar la
   * planilla en Liquidación. Ese texto es la única cosa que le dice a la
   * persona qué hacer, así que no puede irse en un toast.
   */
  it('si el servidor rechaza la firma, el motivo queda a la vista', async () => {
    sembrar(estado())
    api.aprobar.mockRejectedValue(
      new Error('Ya aprobaste el cierre de este inventario. La segunda aprobacion la tiene que dar OTRA persona.'),
    )
    render(<AprobacionYLacrado />)
    await screen.findByText('Gilmer Quispe')

    await userEvent.click(screen.getByRole('button', { name: /Aprobar/ }))
    expect(await screen.findByText('No se pudo aprobar')).toBeInTheDocument()
    expect(screen.getByText(/la tiene que dar OTRA persona/)).toBeInTheDocument()
  })

  /** El 409 literal del backend cuando falta liquidar. Ver el comentario de arriba. */
  it('con el conteo cerrado sin liquidar, el 409 explica que falta la planilla', async () => {
    sembrar(estado())
    api.aprobar.mockRejectedValue(
      new Error(
        'El inventario todavia no esta liquidado: un auditor tiene que cerrar la planilla en Liquidación y nómina ' +
          'antes de que se pueda firmar el lacrado.',
      ),
    )
    render(<AprobacionYLacrado />)
    await screen.findByText('Gilmer Quispe')

    await userEvent.click(screen.getByRole('button', { name: /Aprobar/ }))
    expect(await screen.findByText('No se pudo aprobar')).toBeInTheDocument()
    expect(screen.getByText(/cerrar la planilla en Liquidación y nómina/)).toBeInTheDocument()
  })
})

describe('el botón de lacrar', () => {
  it('apagado sin firmas, y a la vista: no se esconde', async () => {
    sembrar(estado())
    render(<AprobacionYLacrado />)
    const boton = await screen.findByRole('button', { name: /Ejecutar lacrado digital/ })
    expect(boton).toBeDisabled()
  })

  /** FIRMADO PERO SIN SINCRONIZAR: el servidor lo rechazaría, así que el botón no se prende. */
  it('apagado con la firma puesta pero sin sincronizar', async () => {
    sembrar(
      estado({
        aprobaciones: [{ colaboradorId: 103, nombre: 'Gilmer Quispe', fecha: '2026-10-17T14:32:00.000Z' }],
        todoSincronizado: false,
      }),
    )
    render(<AprobacionYLacrado />)
    expect(await screen.findByRole('button', { name: /Ejecutar lacrado digital/ })).toBeDisabled()
    expect(screen.getByText(/WiFi de tienda/)).toBeInTheDocument()
  })

  it('encendido con la firma y la sincronización', async () => {
    sembrar(estado({ aprobaciones: [{ colaboradorId: 103, nombre: 'Gilmer Quispe', fecha: '2026-10-17T14:32:00.000Z' }] }))
    render(<AprobacionYLacrado />)
    expect(await screen.findByRole('button', { name: /Ejecutar lacrado digital/ })).toBeEnabled()
  })
})

describe('la confirmación del lacrado', () => {
  /**
   * NOMBRA LA CONSECUENCIA Y LA CIFRA. Es el mismo texto del teléfono: qué
   * queda sellado, que no se deshace, y a dónde va cualquier ajuste posterior.
   */
  it('dice qué queda congelado y que no hay forma de deshacerlo', async () => {
    sembrar(estado({ aprobaciones: [{ colaboradorId: 103, nombre: 'Gilmer Quispe', fecha: '2026-10-17T14:32:00.000Z' }] }))
    render(<AprobacionYLacrado />)
    await userEvent.click(await screen.findByRole('button', { name: /Ejecutar lacrado digital/ }))

    // El título del diálogo viaja como nombre accesible: en escritorio el
    // `ResponsiveModalShell` del variante `dialog` lo pone en `aria-label`, no
    // como texto. Se busca por rol para no depender de eso.
    const dialogo = await screen.findByRole('dialog', { name: 'Confirmar lacrado' })
    expect(within(dialogo).getByText(/Market Luzuriaga/)).toBeInTheDocument()
    expect(within(dialogo).getByText(/985 ítems/)).toBeInTheDocument()
    expect(within(dialogo).getByText(/congelado de forma inmutable/)).toBeInTheDocument()
    expect(within(dialogo).getByText(/no hay forma de deshacerlo ni de editar los conteos/)).toBeInTheDocument()
    expect(within(dialogo).getByText(/entra en el período siguiente/)).toBeInTheDocument()
  })

  /**
   * SE CANCELA Y NO SE LACRA NADA. El lacrado no se ejecuta ni en una prueba:
   * se verifica que cancelar no llama al servidor, que es la mitad que de
   * verdad importa de un diálogo irreversible.
   */
  it('cancelar no llama al servidor', async () => {
    sembrar(estado({ aprobaciones: [{ colaboradorId: 103, nombre: 'Gilmer Quispe', fecha: '2026-10-17T14:32:00.000Z' }] }))
    render(<AprobacionYLacrado />)
    await userEvent.click(await screen.findByRole('button', { name: /Ejecutar lacrado digital/ }))
    await screen.findByRole('dialog', { name: 'Confirmar lacrado' })

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.lacrar).not.toHaveBeenCalled()
  })
})

describe('el registro en Dynamics', () => {
  /**
   * ES UN MARCADOR MANUAL. El backend no escribe en el ERP: el texto tiene que
   * decirlo y no insinuar que el sistema lo mandó.
   */
  it('dice que lo registra TI a mano y que el sistema no lo envía', async () => {
    sembrar(estado())
    render(<AprobacionYLacrado />)
    expect(await screen.findByText(/el equipo de TI registra/)).toBeInTheDocument()
    expect(screen.getByText(/el sistema no lo envía/)).toBeInTheDocument()
    expect(screen.getByText(/fase 2/)).toBeInTheDocument()
  })

  it('apagado hasta que el inventario esté lacrado', async () => {
    sembrar(estado())
    render(<AprobacionYLacrado />)
    expect(await screen.findByRole('button', { name: /Marcar como registrado manualmente/ })).toBeDisabled()
  })

  it('encendido ya lacrado, y apagado otra vez una vez registrado', async () => {
    sembrar(estado({ lacrado: true, hash: 'a1b2c3', lacradoEn: '2026-10-17T15:00:00.000Z' }))
    const { unmount } = render(<AprobacionYLacrado />)
    expect(await screen.findByRole('button', { name: /Marcar como registrado manualmente/ })).toBeEnabled()
    unmount()

    sembrar(estado({ lacrado: true, hash: 'a1b2c3', registradoManualmenteEnDynamics: true }))
    render(<AprobacionYLacrado />)
    expect(await screen.findByRole('button', { name: /Registrado por TI/ })).toBeDisabled()
  })
})

describe('el sello y su verificación', () => {
  it('lacrado: muestra el hash y que los ítems quedan inmutables', async () => {
    sembrar(estado({ lacrado: true, hash: 'a1b2c3d4', lacradoEn: '2026-10-17T15:00:00.000Z' }))
    render(<AprobacionYLacrado />)
    expect(await screen.findByText('a1b2c3d4')).toBeInTheDocument()
    expect(screen.getByText(/quedan grabados de forma inmutable/)).toBeInTheDocument()
    // Ya no se ofrece volver a lacrar.
    expect(screen.queryByRole('button', { name: /Ejecutar lacrado digital/ })).toBeDisabled()
  })

  /**
   * ANTES DE LACRAR NO SE OFRECE VERIFICAR: el servidor contesta 409 "El
   * inventario todavia no esta lacrado: no hay sello que verificar" (verificado
   * con curl contra el backend vivo). Un botón que solo puede fallar no va.
   */
  it('sin lacrar no hay botón de verificar', async () => {
    sembrar(estado())
    render(<AprobacionYLacrado />)
    await screen.findByText('Inventario a lacrar')
    expect(screen.queryByRole('button', { name: /Verificar el sello/ })).not.toBeInTheDocument()
  })

  it('lacrado y verificado íntegro, lo dice', async () => {
    sembrar(estado({ lacrado: true, hash: 'a1b2c3d4' }))
    api.verificacion.mockResolvedValue({
      inventarioId: 8078,
      valido: true,
      hashGuardado: 'a1b2c3d4',
      hashRecalculado: 'a1b2c3d4',
      motivo: null,
    })
    render(<AprobacionYLacrado />)
    await userEvent.click(await screen.findByRole('button', { name: /Verificar el sello/ }))
    expect(await screen.findByText('Sello íntegro')).toBeInTheDocument()
  })

  /** EL CASO QUE JUSTIFICA LA PANTALLA: alguien tocó el inventario después del sello. */
  it('si el hash no coincide lo dice, con el motivo del servidor', async () => {
    sembrar(estado({ lacrado: true, hash: 'a1b2c3d4' }))
    api.verificacion.mockResolvedValue({
      inventarioId: 8078,
      valido: false,
      hashGuardado: 'a1b2c3d4',
      hashRecalculado: 'ffffffff',
      motivo: 'El contenido del inventario cambio despues del lacrado.',
    })
    render(<AprobacionYLacrado />)
    await userEvent.click(await screen.findByRole('button', { name: /Verificar el sello/ }))
    expect(await screen.findByText('Sello alterado')).toBeInTheDocument()
    expect(screen.getByText('El contenido del inventario cambio despues del lacrado.')).toBeInTheDocument()
  })
})
