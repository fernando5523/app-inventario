import { describe, expect, it } from 'vitest'
import {
  ESTADOS,
  ESTADOS_FILTRABLES,
  aniosDisponibles,
  conteoAbierto,
  estadoExportacion,
  motivoSinNeto,
  nombreArchivoConsolidado,
  nombreArchivoCuadros,
  nombreArchivoDiferencias,
  motivoSinNetoCorto,
  motivoSinResumenDePlanilla,
  periodoMasReciente,
  porPlata,
  rolCapitalizado,
  sinResultado,
  textoFirmas,
  textoFirmasPendientes,
  textoSinLacrar,
} from './historialDominio'
import type { DiferenciaHistorica, InventarioHistorico, ResultadoInventario } from './historialTipos'

/**
 * Lo que se prueba acá no es cosmética: cada texto afirma algo sobre un
 * inventario que decide plata. "Cuadró contra el ERP" sobre un conteo que
 * todavía no cerró es una mentira que se ve igual de prolija que la verdad.
 */

const resultado = (over: Partial<ResultadoInventario> = {}): ResultadoInventario => ({
  itemsTotales: 985,
  itemsConDiferencia: 8,
  itemsCuadrados: 977,
  porcentajeCuadrado: 99.2,
  montoFaltanteBruto: 161.7,
  montoFaltanteNeto: null,
  cuotaBase: null,
  ...over,
})

describe('por qué un inventario no tiene resultado', () => {
  it('distingue el conteo en marcha del ajuste del auditor', () => {
    expect(sinResultado('en_curso')).toContain('al cerrar el ciclo')
    expect(sinResultado('ajuste_auditor')).toContain('ajuste final')
  })

  it('el anulado no produjo resultados, y no es lo mismo que uno sin calcular', () => {
    expect(sinResultado('anulado')).toContain('no produjo resultados')
    expect(sinResultado('lacrado')).toBe('Sin resultados calculados.')
  })
})

describe('por qué el neto es null con el bruto ya calculado', () => {
  it('nombra las dos faltas cuando faltan las dos', () => {
    const t = motivoSinNeto(resultado({ asistenciaSinRegistrar: true, ajustesSinRegistrar: true }))
    expect(t).toContain('la asistencia')
    expect(t).toContain('los ajustes del mes')
  })

  it('nombra solo la que falta', () => {
    expect(motivoSinNeto(resultado({ asistenciaSinRegistrar: true }))).toBe('No se puede calcular: falta registrar la asistencia.')
  })

  /** Sin ninguna bandera no se inventa una causa: se dice que no se puede y punto. */
  it('sin causa conocida no inventa una', () => {
    expect(motivoSinNeto(resultado())).toBe('No se puede calcular todavía.')
  })

  it('la versión corta nunca es un guion ni un "sin liquidar" genérico', () => {
    expect(motivoSinNetoCorto(resultado({ asistenciaSinRegistrar: true, ajustesSinRegistrar: true }))).toBe('Falta asistencia y ajustes')
    expect(motivoSinNetoCorto(resultado({ ajustesSinRegistrar: true }))).toBe('Faltan ajustes')
    expect(motivoSinNetoCorto(resultado())).toBe('No calculado')
  })

  it('la planilla explica lo mismo con sus propias banderas', () => {
    expect(motivoSinResumenDePlanilla({ asistenciaSinRegistrar: true, ajustesSinRegistrar: false })).toContain('la asistencia')
    expect(motivoSinResumenDePlanilla({ asistenciaSinRegistrar: false, ajustesSinRegistrar: true })).toContain('los ajustes del mes')
  })
})

describe('si hay algo que exportar y, si no, por qué', () => {
  it('con el conteo abierto dice que todavía no, no que cuadró', () => {
    const e = estadoExportacion('en_curso', 0)
    expect(e.puedeExportar).toBe(false)
    expect(e.puedeExportar === false && e.motivo).toContain('sigue abierto')
  })

  /**
   * EL BORDE QUE IMPORTA: sin este caso, un inventario en ajuste caía en la
   * rama de "cuadró contra el ERP" — una afirmación sobre un resultado que
   * todavía no existe.
   */
  it('en ajuste final no afirma que cuadró', () => {
    const e = estadoExportacion('ajuste_auditor', 0)
    expect(e.puedeExportar === false && e.motivo).toContain('ajuste final')
    expect(e.puedeExportar === false && e.motivo).not.toContain('cuadró')
  })

  it('el anulado no tiene diferencias calculadas, que no es haber cuadrado', () => {
    const e = estadoExportacion('anulado', 0)
    expect(e.puedeExportar === false && e.motivo).toContain('se anuló')
  })

  it('cerrado y sin diferencias es una buena noticia, no un bloqueo', () => {
    const e = estadoExportacion('liquidado', 0)
    expect(e.puedeExportar === false && e.motivo).toBe('Este inventario cuadró contra el ERP: no hay diferencias que exportar.')
  })

  it('cerrado y con diferencias sí exporta', () => {
    expect(estadoExportacion('lacrado', 3).puedeExportar).toBe(true)
  })
})

describe('el orden de las diferencias', () => {
  const dif = (codigo: string, diferencia: number, montoDiferencia: number | null): DiferenciaHistorica => ({
    codigo,
    descripcion: `Producto ${codigo}`,
    stockSistema: 10,
    conteoFinal: 10 + diferencia,
    diferencia,
    tipo: diferencia < 0 ? 'faltante' : 'sobrante',
    resueltoEnConteo: 1,
    precioUnitario: montoDiferencia === null ? null : 1,
    montoDiferencia,
  })

  /**
   * 300 sorbetes mueven más UNIDADES que 3 whiskys y mucha menos plata. El
   * servidor ordena por unidades; lo que se mira primero es lo que más cuesta.
   */
  it('manda la plata, no las unidades', () => {
    const ordenadas = porPlata([dif('sorbete', -300, -12), dif('whisky', -3, -450)])
    expect(ordenadas.map((d) => d.codigo)).toEqual(['whisky', 'sorbete'])
  })

  it('el que no se puede valorizar va al final, no al principio', () => {
    const ordenadas = porPlata([dif('sin-precio', -900, null), dif('vino', -2, -80)])
    expect(ordenadas.map((d) => d.codigo)).toEqual(['vino', 'sin-precio'])
  })

  it('no muta el array que recibe', () => {
    const original = [dif('a', -1, -1), dif('b', -1, -99)]
    porPlata(original)
    expect(original.map((d) => d.codigo)).toEqual(['a', 'b'])
  })
})

describe('el texto de firmas sigue el mínimo configurable', () => {
  it('con una sola firma requerida no pluraliza', () => {
    expect(textoFirmas(0, 1)).toBe('0 / 1 firma')
    expect(textoFirmas(1, 2)).toBe('1 / 2 firmas')
  })

  /** Con el mínimo de hoy (1) la pantalla decía "faltan 1 de las 1 firma". */
  it('con una requerida y ninguna hecha dice "falta la firma"', () => {
    expect(textoFirmasPendientes(0, 1)).toBe('falta la firma de auditoría')
  })

  it('faltan cero es un estado real: ya firmaron y falta ejecutar el lacrado', () => {
    expect(textoFirmasPendientes(1, 1)).toContain('solo falta ejecutar el lacrado')
    expect(textoFirmasPendientes(3, 2)).toContain('solo falta ejecutar el lacrado')
  })

  it('con dos requeridas y una hecha cuenta la que falta', () => {
    expect(textoFirmasPendientes(1, 2)).toBe('falta 1 de las 2 firmas de auditoría')
  })

  it('el conteo abierto se explica distinto que el cerrado sin sellar', () => {
    expect(textoSinLacrar('en_curso', 0, 1)).toContain('sigue abierto')
    expect(textoSinLacrar('conteo_cerrado', 0, 1)).toContain('ya no se recuenta')
  })
})

describe('los estados y el período', () => {
  it('solo el lacrado está sellado', () => {
    expect(ESTADOS.lacrado.sellado).toBe(true)
    expect(Object.values(ESTADOS).filter((e) => e.sellado)).toHaveLength(1)
  })

  /** El ajuste del auditor es un conteo abierto: todavía se cambian valores. */
  it('el ajuste del auditor cuenta como conteo abierto', () => {
    expect(conteoAbierto('ajuste_auditor')).toBe(true)
    expect(conteoAbierto('en_curso')).toBe(true)
    expect(conteoAbierto('conteo_cerrado')).toBe(false)
  })

  it('ofrece el año actual y los tres anteriores', () => {
    expect(aniosDisponibles(new Date('2026-10-17T12:00:00Z'))).toEqual([2026, 2025, 2024, 2023])
  })

  const inventario = (anio: number, mes: number): InventarioHistorico =>
    ({ periodoAnio: anio, periodoMes: mes }) as InventarioHistorico

  /**
   * Arrancar en "el mes actual" deja la pantalla vacía los primeros días del
   * mes, y una lista vacía se lee como "no hay historial".
   */
  it('el período inicial es el del inventario más reciente', () => {
    expect(periodoMasReciente([inventario(2026, 9), inventario(2025, 12), inventario(2026, 3)])).toEqual({ anio: 2026, mes: 9 })
  })

  it('sin inventarios no hay período que elegir', () => {
    expect(periodoMasReciente([])).toBeNull()
  })

  /**
   * El backend 400ea con `estado=ajuste_auditor` (su enum quedó de antes), así
   * que ese filtro no se ofrece aunque el listado sí devuelva inventarios en
   * ese estado. Si alguien lo agrega sin tocar el backend, este caso falla.
   */
  it('no se ofrece filtrar por un estado que el servidor rechaza', () => {
    expect(ESTADOS_FILTRABLES).not.toContain('ajuste_auditor')
    expect(ESTADOS_FILTRABLES).toHaveLength(5)
    // Pero el estado SÍ se puede mostrar: la columna lo pinta.
    expect(ESTADOS.ajuste_auditor.etiqueta).toBe('Ajuste del auditor')
  })

  it('capitaliza el rol congelado al firmar', () => {
    expect(rolCapitalizado('auditor')).toBe('Auditor')
  })
})

/**
 * El nombre del servidor es el bueno; estos son el respaldo para cuando el
 * navegador no puede leer la cabecera (otro origen). Los tres formatos están
 * verificados contra el backend vivo: lo que manda para el 8078 es
 * `diferencias-market-luzuriaga-2026-09-inv8078.xlsx`.
 */
describe('el nombre de respaldo de los .xlsx', () => {
  it('repite el formato del backend para las diferencias de un inventario', () => {
    expect(nombreArchivoDiferencias('Market Luzuriaga', 2026, 9, 8078)).toBe('diferencias-market-luzuriaga-2026-09-inv8078.xlsx')
  })

  it('y para los cuadros, que son otro archivo', () => {
    expect(nombreArchivoCuadros('Market Luzuriaga', 2026, 9, 8078)).toBe('inventario-cuadros-market-luzuriaga-2026-09-inv8078.xlsx')
  })

  /** Sin espacios ni acentos: es lo que se manda por WhatsApp. */
  it('saca acentos, mayúsculas y signos del nombre de la tienda', () => {
    expect(nombreArchivoDiferencias('Market Jr. Caraz', 2026, 12, 1)).toBe('diferencias-market-jr-caraz-2026-12-inv1.xlsx')
    expect(nombreArchivoDiferencias('Bodega Ñuñoa', 2026, 1, 2)).toBe('diferencias-bodega-nunoa-2026-01-inv2.xlsx')
  })

  /** Un nombre que se queda sin letras no puede dejar el archivo sin identificar. */
  it('una tienda sin caracteres usables no deja un nombre roto', () => {
    expect(nombreArchivoDiferencias('///', 2026, 3, 9)).toBe('diferencias-sucursal-2026-03-inv9.xlsx')
  })

  /** El consolidado mezcla N tiendas: ninguna identificaría el contenido. */
  it('el consolidado lleva solo el período', () => {
    expect(nombreArchivoConsolidado(2026, 9)).toBe('diferencias-consolidado-2026-09.xlsx')
  })
})
