import { describe, expect, it } from 'vitest'
import {
  avisoDeFirmas,
  cartelDelCierre,
  inventarioALacrar,
  sePuedeLacrar,
  textoAuditoresInsuficientes,
  textoDelLacrado,
} from './lacradoDominio'
import type { EstadoLacrado, InventarioDelHistorial } from './lacradoTipos'

/**
 * LAS REGLAS DEL LACRADO. Lo que se fija acá es que los textos sigan el mínimo
 * CONFIGURABLE de firmas (hoy 1) y nunca un 2 escrito a mano: con 1 requerida
 * la pantalla no puede hablar de "personas distintas" ni decir "faltan 1".
 */

function estado(parcial: Partial<EstadoLacrado> = {}): EstadoLacrado {
  return {
    inventarioId: 8078,
    aprobaciones: [],
    aprobacionesRequeridas: 2,
    todoSincronizado: true,
    lacrado: false,
    hash: null,
    lacradoEn: null,
    registradoManualmenteEnDynamics: false,
    ...parcial,
  }
}

function firma(colaboradorId: number, nombre: string) {
  return { colaboradorId, nombre, fecha: '2026-10-17T14:32:00.000Z' }
}

function inventario(id: number, estadoInv: InventarioDelHistorial['estado']): InventarioDelHistorial {
  return { id, sucursalId: 1, sucursalNombre: 'Market Luzuriaga', estado: estadoInv, periodo: '2026-09', snapshotItems: 985 }
}

describe('cuál es el inventario a lacrar', () => {
  /**
   * EL ABIERTO NO SE PUEDE SELLAR, y es justo el que devolvería
   * `inventarios/activo`. Por eso el inventario sale del historial.
   */
  it('el abierto no se toma, ni el que ya está lacrado', () => {
    const elegido = inventarioALacrar([
      inventario(9000, 'en_curso'),
      inventario(8078, 'conteo_cerrado'),
      inventario(8000, 'lacrado'),
    ])
    expect(elegido?.id).toBe(8078)
  })

  it('un liquidado también se puede lacrar: liquidar no sella', () => {
    expect(inventarioALacrar([inventario(8078, 'liquidado')])?.id).toBe(8078)
  })

  it('toma el más reciente, que es el primero de la lista', () => {
    expect(inventarioALacrar([inventario(8100, 'conteo_cerrado'), inventario(8078, 'liquidado')])?.id).toBe(8100)
  })

  it('sin ninguno que calce devuelve null, no el primero que hay', () => {
    expect(inventarioALacrar([inventario(9000, 'en_curso'), inventario(8000, 'lacrado')])).toBeNull()
    expect(inventarioALacrar([])).toBeNull()
  })
})

describe('el cartel dice en qué punto del cierre está', () => {
  it('sin inventario: neutro, y no dice que falte una firma', () => {
    const cartel = cartelDelCierre(null)
    expect(cartel.tono).toBe('neutro')
    expect(cartel.titulo).toBe('Sin inventario para lacrar')
  })

  it('lacrado: verde y cerrado', () => {
    expect(cartelDelCierre(estado({ lacrado: true, hash: 'abc' }))).toEqual({
      titulo: 'Lacrado',
      detalle: 'Cerrado y sellado: no se toca más.',
      tono: 'ok',
    })
  })

  /** CON UNA SOLA REQUERIDA EL SINGULAR TIENE QUE CERRAR. */
  it('con 1 requerida y 0 firmas habla en singular', () => {
    const cartel = cartelDelCierre(estado({ aprobacionesRequeridas: 1 }))
    expect(cartel.titulo).toBe('Falta la firma')
    expect(cartel.detalle).toBe('0 de 1 firma de auditoría registrada.')
  })

  it('con 2 requeridas y 1 firma habla en plural', () => {
    const cartel = cartelDelCierre(estado({ aprobaciones: [firma(103, 'Gilmer')] }))
    expect(cartel.titulo).toBe('Faltan firmas')
    expect(cartel.detalle).toBe('1 de 2 firmas de auditoría registradas.')
  })

  it('firmado pero sin sincronizar: lo que falta es Dynamics, no una firma', () => {
    const cartel = cartelDelCierre(
      estado({ aprobacionesRequeridas: 1, aprobaciones: [firma(103, 'Gilmer')], todoSincronizado: false }),
    )
    expect(cartel.titulo).toBe('Falta sincronizar')
  })

  it('todo listo: dice que falta ejecutar y que no se deshace', () => {
    const cartel = cartelDelCierre(estado({ aprobacionesRequeridas: 1, aprobaciones: [firma(103, 'Gilmer')] }))
    expect(cartel.titulo).toBe('Listo para lacrar')
    expect(cartel.detalle).toContain('no se puede deshacer')
  })

  /** NUNCA UN TONO DE PELIGRO: el rojo de esta pantalla es el botón de lacrar. */
  it('ningún estado devuelve un tono de peligro', () => {
    const casos: Array<EstadoLacrado | null> = [
      null,
      estado(),
      estado({ aprobaciones: [firma(103, 'Gilmer')] }),
      estado({ todoSincronizado: false }),
      estado({ lacrado: true }),
    ]
    for (const caso of casos) {
      expect(['ok', 'atencion', 'neutro']).toContain(cartelDelCierre(caso).tono)
    }
  })
})

describe('si se puede ejecutar el lacrado', () => {
  it('hacen falta las firmas Y la sincronización', () => {
    expect(sePuedeLacrar(estado({ aprobacionesRequeridas: 1, aprobaciones: [firma(103, 'G')] }))).toBe(true)
    expect(sePuedeLacrar(estado({ aprobacionesRequeridas: 1 }))).toBe(false)
    expect(
      sePuedeLacrar(estado({ aprobacionesRequeridas: 1, aprobaciones: [firma(103, 'G')], todoSincronizado: false })),
    ).toBe(false)
  })

  it('un inventario ya lacrado no se vuelve a lacrar', () => {
    expect(sePuedeLacrar(estado({ aprobacionesRequeridas: 1, aprobaciones: [firma(103, 'G')], lacrado: true }))).toBe(false)
  })

  it('sin estado todavía, no', () => {
    expect(sePuedeLacrar(null)).toBe(false)
  })
})

describe('el aviso de firmas', () => {
  const base = { auditores: 2, firmoElDeLaSesion: false, nombresPendientes: ['Rosa Díaz'] }

  it('no dice nada sobre un inventario ya lacrado', () => {
    expect(avisoDeFirmas({ ...base, estado: estado({ lacrado: true }) })).toBeNull()
    expect(avisoDeFirmas({ ...base, estado: null })).toBeNull()
  })

  /**
   * EL CASO QUE MÁS IMPORTA: quien mira ya firmó y falta otro. Sin este texto,
   * el auditor espera delante de un botón que nunca se le va a habilitar.
   */
  it('si ya firmé y falta otro, dice que solo esa persona puede ponerla y cómo', () => {
    const aviso = avisoDeFirmas({
      estado: estado({ aprobaciones: [firma(103, 'Gilmer')] }),
      auditores: 2,
      firmoElDeLaSesion: true,
      nombresPendientes: ['Rosa Díaz'],
    })
    expect(aviso).toContain('Tu firma ya quedó registrada')
    expect(aviso).toContain('Falta la de Rosa Díaz')
    expect(aviso).toContain('su propio PIN')
  })

  it('con dos pendientes pluraliza', () => {
    const aviso = avisoDeFirmas({
      estado: estado({ aprobacionesRequeridas: 3, aprobaciones: [firma(103, 'Gilmer')] }),
      auditores: 3,
      firmoElDeLaSesion: true,
      nombresPendientes: ['Rosa Díaz', 'Ana Villanueva'],
    })
    expect(aviso).toContain('Faltan las de Rosa Díaz y Ana Villanueva')
  })

  it('con 1 requerida y nadie firmó, invita a firmar sin hablar de otros', () => {
    const aviso = avisoDeFirmas({ ...base, estado: estado({ aprobacionesRequeridas: 1 }) })
    expect(aviso).toBe('Puedes registrar tu firma ahora: con esa alcanza para habilitar el lacrado.')
  })

  it('con 2 requeridas y nadie firmó, nombra a quién le toca después', () => {
    const aviso = avisoDeFirmas({ ...base, estado: estado() })
    expect(aviso).toContain('Todavía no hay ninguna firma')
    expect(aviso).toContain('Rosa Díaz')
  })

  it('si ya hay firmas y falta la mía, lo dice así', () => {
    const aviso = avisoDeFirmas({ ...base, estado: estado({ aprobaciones: [firma(106, 'Rosa')] }), nombresPendientes: [] })
    expect(aviso).toBe('Ya hay una firma registrada. Falta la tuya para completar la validación.')
  })

  it('completas: dice que ya se puede ejecutar', () => {
    const aviso = avisoDeFirmas({
      estado: estado({ aprobacionesRequeridas: 1, aprobaciones: [firma(103, 'Gilmer')] }),
      auditores: 2,
      firmoElDeLaSesion: true,
      nombresPendientes: [],
    })
    expect(aviso).toBe('Tu firma quedó registrada. Ya se puede ejecutar el lacrado.')
  })

  /**
   * SIN CUENTAS SUFICIENTES, el aviso manda a Usuarios en vez de dejar a
   * alguien esperando una firma que nadie puede dar.
   */
  it('con menos auditores que firmas requeridas, manda a dar de alta cuentas', () => {
    const aviso = avisoDeFirmas({ estado: estado(), auditores: 1, firmoElDeLaSesion: false, nombresPendientes: [] })
    expect(aviso).toContain('una sola cuenta de Auditor cargada')
    expect(aviso).toContain('en Usuarios')
  })
})

describe('el texto de auditores insuficientes sigue el mínimo configurable', () => {
  it('con 1 requerida NO habla de personas distintas', () => {
    const texto = textoAuditoresInsuficientes(0, 1)
    expect(texto).toContain('el lacrado exige 1')
    expect(texto).not.toContain('personas distintas')
  })

  it('con 2 requeridas sí lo aclara', () => {
    expect(textoAuditoresInsuficientes(1, 2)).toContain('personas distintas')
  })

  it('pluraliza las altas que faltan', () => {
    expect(textoAuditoresInsuficientes(1, 2)).toContain('una cuenta más')
    expect(textoAuditoresInsuficientes(1, 3)).toContain('2 cuentas más')
  })
})

describe('el texto de la tarjeta del sello', () => {
  it('ya lacrado: null, porque ahí se muestra el hash y no este texto', () => {
    expect(textoDelLacrado(estado({ lacrado: true, hash: 'abc' }))).toBeNull()
    expect(textoDelLacrado(null)).toBeNull()
  })

  /** CON 1 REQUERIDA NO PUEDE DECIR "faltan 1 de las 1 firmas". */
  it('con 1 requerida y 0 firmas habla en singular', () => {
    const texto = textoDelLacrado(estado({ aprobacionesRequeridas: 1 }))
    expect(texto).toContain('Falta la firma de auditoría (0 de 1)')
    expect(texto).toContain('esa firma')
  })

  it('con 2 requeridas habla en plural', () => {
    const texto = textoDelLacrado(estado())
    expect(texto).toContain('Faltan firmas de auditoría (0 de 2)')
    expect(texto).toContain('todas ellas')
  })

  it('firmado y sin sincronizar: nombra el WiFi de tienda', () => {
    const texto = textoDelLacrado(
      estado({ aprobacionesRequeridas: 1, aprobaciones: [firma(103, 'G')], todoSincronizado: false }),
    )
    expect(texto).toContain('falta sincronización con Dynamics')
    expect(texto).toContain('WiFi de tienda')
  })

  it('todo listo lo dice sin prometer que ya está hecho', () => {
    const texto = textoDelLacrado(estado({ aprobacionesRequeridas: 1, aprobaciones: [firma(103, 'G')] }))
    expect(texto).toBe('Todo listo: la firma está registrada y hay sincronización con Dynamics.')
  })
})
