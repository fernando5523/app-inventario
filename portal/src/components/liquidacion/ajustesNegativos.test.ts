/**
 * El Excel de ajustes decide cuánta plata se le DEJA de descontar al personal.
 * Lo que estos tests fijan es que la pantalla diga, con las palabras del
 * cliente, qué entra, qué no entra y por qué.
 *
 * Sin nombres ni documentos reales en las fixtures: ver `reglas.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import {
  MOTIVO_LINEA_MAXIMO,
  accionDeLinea,
  errorDeMotivoLinea,
  estadoNegativos,
  resumenPreview,
  textoImportacionConfirmada,
  textoMotivoAdvertencia,
  textoMotivoRechazo,
  textoQueSeConfirma,
  textosAccionLinea,
  tituloPreviewFallido,
  totalLineasNoExcluidas,
  vistaImportar,
} from './ajustesNegativos'

const soles = (n: number) => `S/ ${n.toFixed(2)}`

describe('estadoNegativos', () => {
  /**
   * LA DISTINCIÓN QUE DESTRABA O TRABA LA LIQUIDACIÓN. `null` es "nadie
   * importó nada" y bloquea; `0` es "se importó y no había líneas útiles", que
   * es un dato y deja liquidar. Colapsarlos dejaría el cierre del mes trabado
   * sin motivo.
   */
  it('null bloquea liquidar y cero no', () => {
    expect(estadoNegativos(null).bloqueaLiquidar).toBe(true)
    expect(estadoNegativos(0).bloqueaLiquidar).toBe(false)
    expect(estadoNegativos(1200).bloqueaLiquidar).toBe(false)
  })

  it('cada caso tiene su propio texto', () => {
    expect(estadoNegativos(null).texto).toContain('bloquea liquidar')
    expect(estadoNegativos(0).texto).toContain('no había ninguna línea útil')
    expect(estadoNegativos(1200).texto).toBe('Excel de ajustes importado.')
  })
})

describe('textoMotivoRechazo y textoMotivoAdvertencia', () => {
  /**
   * Nombran la COLUMNA del Excel, no un código: quien lo lee tiene el archivo
   * abierto al lado y necesita saber dónde mirar.
   */
  it('el rechazo dice qué columna lo causó', () => {
    expect(textoMotivoRechazo('otra-tienda')).toContain('Almacén')
    expect(textoMotivoRechazo('datos-invalidos')).toContain('Registrado en')
  })

  it('la advertencia dice qué está raro, y la línea igual entra', () => {
    expect(textoMotivoAdvertencia('importe-no-coincide')).toContain('Cantidad × Precio')
    expect(textoMotivoAdvertencia('fuera-de-periodo')).toContain('fuera del período')
    expect(textoMotivoAdvertencia('responsable-no-empleado')).toContain('Responsable')
  })
})

describe('totalLineasNoExcluidas', () => {
  /** Lo que de verdad suma: una línea excluida aporta 0, no se borra. */
  it('suma solo las que nadie excluyó', () => {
    const lineas = [
      { importe: 100, excluida: false },
      { importe: 250, excluida: true },
      { importe: 50, excluida: false },
    ]
    expect(totalLineasNoExcluidas(lineas)).toBe(150)
  })
})

describe('errorDeMotivoLinea', () => {
  /**
   * EL MOTIVO ES OBLIGATORIO porque queda firmado y es lo que se audita
   * después: excluir una línea baja el monto, y sin motivo eso sería bajar
   * plata sin dejar rastro.
   */
  it('exige un motivo y explica para qué queda', () => {
    expect(errorDeMotivoLinea('excluir', '   ')).toContain('queda registrado con tu nombre')
    expect(errorDeMotivoLinea('incluir', '')).toContain('vuelve a contar')
  })

  it('con motivo escrito no hay error', () => {
    expect(errorDeMotivoLinea('excluir', 'El ajuste es de otro período')).toBeNull()
  })

  it('el tope dice cuánto llevas, no solo cuál es', () => {
    const largo = 'x'.repeat(MOTIVO_LINEA_MAXIMO + 5)
    expect(errorDeMotivoLinea('excluir', largo)).toContain(String(MOTIVO_LINEA_MAXIMO + 5))
  })
})

describe('accionDeLinea y textosAccionLinea', () => {
  it('una línea excluida se vuelve a incluir, y al revés', () => {
    expect(accionDeLinea(true)).toBe('incluir')
    expect(accionDeLinea(false)).toBe('excluir')
  })

  it('cada acción trae su etiqueta, su título y su ejemplo', () => {
    expect(textosAccionLinea('excluir').etiqueta).toBe('Excluir')
    expect(textosAccionLinea('excluir').placeholder).toContain('no corresponde')
    expect(textosAccionLinea('incluir').etiqueta).toBe('Volver a incluir')
  })
})

describe('resumenPreview y textoQueSeConfirma', () => {
  const preview = {
    ok: true as const,
    validas: [
      { fila: 2, codigo: '1', nombre2: 'a', importe: 60, motivoAjuste: 'm', responsable: 'Empleado', advertencias: [] },
      {
        fila: 3,
        codigo: '2',
        nombre2: 'b',
        importe: 40,
        motivoAjuste: 'm',
        responsable: 'Otro',
        advertencias: ['responsable-no-empleado' as const],
      },
    ],
    rechazadas: [{ fila: 4, motivo: 'otra-tienda' as const }],
    totalImporte: 100,
  }

  it('cuenta las válidas, las rechazadas y las que entran con aviso', () => {
    expect(resumenPreview(preview)).toEqual({ validas: 2, rechazadas: 1, conAdvertencia: 1, totalImporte: 100 })
  })

  /** La cifra ANTES de confirmar: un "¿confirmas?" sin monto no deja decidir. */
  it('dice el monto que va a sumar y cuántas quedan afuera', () => {
    const t = textoQueSeConfirma(resumenPreview(preview), soles)
    expect(t).toContain('2 líneas por S/ 100.00')
    expect(t).toContain('1 línea queda afuera')
  })

  it('sin rechazadas no menciona ninguna', () => {
    const t = textoQueSeConfirma({ validas: 1, rechazadas: 0, conAdvertencia: 0, totalImporte: 10 }, soles)
    expect(t).toContain('1 línea por S/ 10.00')
    expect(t).not.toContain('afuera')
  })
})

describe('textoImportacionConfirmada', () => {
  it('concuerda en número y nombra el archivo', () => {
    expect(textoImportacionConfirmada({ nombreArchivo: 'a.xlsx', cantidadValidas: 1, montoNegativos: 5 }, soles)).toContain(
      '1 línea guardada',
    )
    expect(textoImportacionConfirmada({ nombreArchivo: 'a.xlsx', cantidadValidas: 3, montoNegativos: 5 }, soles)).toContain(
      '3 líneas guardadas',
    )
  })
})

describe('vistaImportar', () => {
  it('sin importación vigente invita a importar y no promete nada más', () => {
    const v = vistaImportar(null)
    expect(v.estado).toBe('sin-importar')
    expect(v.nota).toBeNull()
  })

  /**
   * REEMPLAZAR NO ES BORRAR, y la nota lo dice: sin esa frase, "importar otro
   * archivo" se lee como una operación que pisa el historial.
   */
  it('con una vigente avisa que la anterior deja de contar pero queda registrada', () => {
    const v = vistaImportar({
      id: 1,
      nombreArchivo: 'ajustes-setiembre.xlsx',
      importadoPor: { id: 1, nombre: 'Auditor de prueba' },
      importadoEn: '2026-10-01T10:00:00.000Z',
    })
    expect(v.estado).toBe('vigente')
    expect(v.nota).toContain('ajustes-setiembre.xlsx')
    expect(v.nota).toContain('no se borra')
  })
})

describe('tituloPreviewFallido', () => {
  it('distingue el archivo ilegible de las columnas que faltan', () => {
    expect(tituloPreviewFallido('columna-faltante')).toBe('Faltan columnas en el archivo')
    expect(tituloPreviewFallido('archivo-invalido')).toBe('El archivo no se pudo leer')
  })
})
