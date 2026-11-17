import { describe, expect, it } from 'vitest'
import {
  FORMULARIO_VACIO,
  MOTIVO_PROPIA_CUENTA,
  cuerpoDeAlta,
  erroresDelFormulario,
  erroresDelServidor,
  estadoDeCuenta,
  motivoSinEliminar,
  motivoSinGestion,
  motivoSinSeleccion,
  opcionesDeRol,
  puedeAsignarRol,
  resumenDeCuentas,
  rolesQuePuedeAsignar,
  sucursalDelCuerpo,
} from './usuariosReglas'
import type { Actor, UsuarioDto } from './usuariosTipos'

/**
 * LA MATRIZ DE "QUIÉN PUEDE CON QUIÉN" es la regla más cara de esta pantalla:
 * si se afloja, un auditor se crea un administrador. Acá se prueba la copia
 * del lado de la pantalla, que es la que decide qué se OFRECE —la que
 * autoriza de verdad es `backend/src/modules/usuarios/usuarios.permisos.ts`, y
 * tiene las suyas—.
 *
 * Las personas de estas pruebas son inventadas, y los documentos también: no
 * se escribe acá el nombre ni el documento de nadie real.
 */

const AUDITOR: Actor = { id: 10, rol: 'auditor', sucursalId: 2 }
const ADMIN: Actor = { id: 1, rol: 'administrador', sucursalId: null }

function cuenta(over: Partial<UsuarioDto> = {}): UsuarioDto {
  return {
    id: 20,
    nombre: 'Cuenta de prueba',
    dni: '00000001',
    rol: 'conteo',
    sucursalId: 2,
    activo: true,
    creadoPorId: 10,
    createdAt: '2026-10-01T12:00:00.000Z',
    ...over,
  }
}

describe('qué roles puede asignar cada rol', () => {
  it('el auditor, solo coordinador y conteo: nunca otro auditor ni un administrador', () => {
    expect(rolesQuePuedeAsignar('auditor')).toEqual(['coordinador', 'conteo'])
    expect(puedeAsignarRol('auditor', 'auditor')).toBe(false)
    expect(puedeAsignarRol('auditor', 'administrador')).toBe(false)
  })

  it('el administrador, los cuatro', () => {
    expect(rolesQuePuedeAsignar('administrador')).toHaveLength(4)
  })

  it('coordinador y conteo no asignan ninguno', () => {
    expect(rolesQuePuedeAsignar('coordinador')).toEqual([])
    expect(rolesQuePuedeAsignar('conteo')).toEqual([])
  })

  /**
   * Las cuatro opciones se MUESTRAN siempre: las que no se pueden van
   * deshabilitadas y con el motivo. Esconderlas dejaría al auditor buscando
   * una opción que no está, sin saber que no es para él.
   */
  it('el selector ofrece los cuatro roles, con motivo en los que no se pueden', () => {
    const opciones = opcionesDeRol('auditor')
    expect(opciones).toHaveLength(4)
    const bloqueadas = opciones.filter((o) => o.disabled)
    expect(bloqueadas).toHaveLength(2)
    // El motivo va en el `sublabel`, al lado de la opción apagada.
    for (const opcion of bloqueadas) expect(opcion.sublabel ?? '').not.toBe('')
  })
})

describe('qué cuentas puede gestionar un auditor', () => {
  it('una de conteo de su propia sucursal: sí', () => {
    expect(motivoSinGestion(AUDITOR, cuenta())).toBeNull()
  })

  it('una de otra sucursal: no, y lo dice', () => {
    expect(motivoSinGestion(AUDITOR, cuenta({ sucursalId: 7 }))).toMatch(/otra sucursal/)
  })

  it('una de auditor: no, aunque sea de su misma sucursal', () => {
    expect(motivoSinGestion(AUDITOR, cuenta({ id: 33, rol: 'auditor' }))).toMatch(/Auditor/)
  })

  /** Su propia cuenta cae acá por ser de rol auditor, y se le nombra el otro camino. */
  it('la suya propia: no, y le dice dónde cambia su PIN', () => {
    expect(motivoSinGestion(AUDITOR, cuenta({ id: AUDITOR.id, rol: 'auditor' }))).toMatch(/Cambiar mi PIN/)
  })

  it('el administrador gestiona cualquiera', () => {
    expect(motivoSinGestion(ADMIN, cuenta({ rol: 'auditor', sucursalId: 9 }))).toBeNull()
  })

  /** La única regla que el borrado agrega, y le gana al resto del alcance. */
  it('nadie elimina su propia cuenta, ni siquiera el administrador', () => {
    expect(motivoSinEliminar(ADMIN, cuenta({ id: ADMIN.id, rol: 'administrador', sucursalId: null }))).toBe(
      MOTIVO_PROPIA_CUENTA,
    )
  })
})

describe('la barra de acciones', () => {
  it('sin cuenta elegida y con varias, dice qué falta en vez de solo apagarse', () => {
    expect(motivoSinSeleccion(0)).toMatch(/Elige una cuenta/)
    expect(motivoSinSeleccion(2)).toMatch(/una sola/)
    expect(motivoSinSeleccion(1)).toBeNull()
  })

  it('el estado se nombra y no solo se colorea', () => {
    expect(estadoDeCuenta(true)).toEqual({ label: 'Habilitada', variant: 'success' })
    expect(estadoDeCuenta(false).label).toBe('Deshabilitada')
  })

  it('el resumen cuenta las habilitadas aparte del total', () => {
    expect(resumenDeCuentas([{ activo: true }, { activo: false }, { activo: true }])).toBe('3 cuentas · 2 habilitadas')
  })
})

describe('qué sucursal viaja en el cuerpo', () => {
  /** Es el punto donde "la sucursal del auditor no se elige" se vuelve código. */
  it('la del auditor es SIEMPRE la suya, aunque el formulario traiga otra', () => {
    expect(sucursalDelCuerpo(AUDITOR, 'conteo', 99)).toBe(2)
  })

  it('el administrador manda la que eligió', () => {
    expect(sucursalDelCuerpo(ADMIN, 'conteo', 7)).toBe(7)
  })

  it('un administrador nuevo no lleva ninguna: el servidor la rechaza', () => {
    expect(sucursalDelCuerpo(ADMIN, 'administrador', 7)).toBeUndefined()
  })

  it('el cuerpo del alta de un auditor sale con su sucursal y el PIN tipeado', () => {
    const cuerpo = cuerpoDeAlta(AUDITOR, {
      nombre: '  Cuenta de prueba  ',
      dni: '00000002',
      rol: 'coordinador',
      sucursalId: null,
      pin: '123987',
      pinRepetido: '123987',
    })
    expect(cuerpo).toEqual({
      nombre: 'Cuenta de prueba',
      dni: '00000002',
      rol: 'coordinador',
      sucursalId: 2,
      pin: '123987',
    })
  })
})

describe('lo que le falta al formulario', () => {
  const lleno = {
    nombre: 'Cuenta de prueba',
    dni: '00000003',
    rol: 'conteo' as const,
    sucursalId: null,
    pin: '482913',
    pinRepetido: '482913',
  }

  it('un alta completa de un auditor no tiene errores', () => {
    expect(erroresDelFormulario(AUDITOR, lleno, 'alta')).toEqual({})
  })

  it('el formulario vacío pide todo lo obligatorio', () => {
    const errores = erroresDelFormulario(AUDITOR, FORMULARIO_VACIO, 'alta')
    expect(Object.keys(errores).sort()).toEqual(['dni', 'nombre', 'pin', 'rol'])
  })

  /** Dos PIN distintos dejan a alguien afuera de su propia cuenta. */
  it('los dos PIN tienen que coincidir', () => {
    expect(erroresDelFormulario(AUDITOR, { ...lleno, pinRepetido: '482914' }, 'alta').pinRepetido).toMatch(
      /no coinciden/,
    )
  })

  it('un auditor eligiendo rol auditor: el error va en el campo del rol', () => {
    expect(erroresDelFormulario(AUDITOR, { ...lleno, rol: 'auditor' }, 'alta').rol).toMatch(/nunca auditor/)
  })

  /** En la edición no se pide PIN: para eso está "Poner un PIN nuevo". */
  it('la edición no exige PIN', () => {
    const errores = erroresDelFormulario(AUDITOR, { ...lleno, pin: '', pinRepetido: '' }, 'edicion')
    expect(errores.pin).toBeUndefined()
  })
})

describe('el 400 del servidor', () => {
  it('cae en el campo que lo causó, no en un cartel genérico', () => {
    const error = {
      response: { data: { error: 'Solicitud invalida.', detalles: { fieldErrors: { dni: ['El DNI debe tener 8 digitos.'] } } } },
    }
    expect(erroresDelServidor(error)).toEqual({ dni: 'El DNI debe tener 8 digitos.' })
  })

  it('un error sin detalle no inventa ninguno', () => {
    expect(erroresDelServidor(new Error('se cayó la red'))).toEqual({})
  })
})
