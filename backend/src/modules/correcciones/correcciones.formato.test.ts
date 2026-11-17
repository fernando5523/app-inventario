/**
 * EL FORMATO DEL EXCEL DE CORRECCIÓN, fijado.
 *
 * Lo que estos tests protegen, que es lo que más cuesta si se rompe:
 *  - una fila sin cambio NUNCA se ignora en silencio: se informa con su
 *    veredicto, y si traía motivo se avisa (lo más probable es que quien lo
 *    escribió quiso cambiar el número y se olvidó);
 *  - el motivo es obligatorio en la fila que cambia, y eso rechaza LA FILA,
 *    no el archivo;
 *  - un archivo al que le falta una columna necesaria se rechaza ENTERO, con
 *    el detalle de cuál falta -- distinto de un archivo válido sin filas;
 *  - `Contado` no es decorativo: decide si la fila cambia.
 */

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { COLUMNAS_EXPORT, COLUMNAS_REQUERIDAS, leerCorrecciones } from './correcciones.formato';

/** Un .xlsx de verdad, armado en memoria: el lector recibe bytes, no un objeto. */
async function excel(encabezados: readonly string[], filas: readonly (readonly unknown[])[]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Conteos');
  hoja.addRow([...encabezados]);
  for (const fila of filas) hoja.addRow([...fila]);
  return Buffer.from(await libro.xlsx.writeBuffer());
}

/** Las seis columnas que el importador necesita, en el orden del export. */
/**
 * `lista[0]` con el chequeo que exige `noUncheckedIndexedAccess`: si la lista
 * vino vacía, el test falla ACÁ -- diciendo que no había ninguna fila -- en vez
 * de dos líneas después con un "cannot read properties of undefined".
 */
function primera<T>(filas: readonly T[]): T {
  expect(filas.length).toBeGreaterThan(0);
  return filas[0] as T;
}

const CABECERA = ['Inventario', 'Tienda', 'Ronda', 'Codigo', 'Contado', 'Nuevo valor', 'Motivo'] as const;
const BASE: Record<(typeof CABECERA)[number], unknown> = {
  Inventario: 8090,
  Tienda: 'Market Sucre',
  Ronda: 1,
  Codigo: '0051',
  Contado: 10,
  'Nuevo valor': 12,
  Motivo: 'Se contó mal la caja',
};
/**
 * `in` y no `??`: un `null` EXPLÍCITO es justo lo que varios de estos tests
 * quieren probar (celda vacía), y con `??` volvería al valor por defecto.
 */
const fila = (p: Partial<Record<(typeof CABECERA)[number], unknown>> = {}) =>
  CABECERA.map((c) => (c in p ? p[c] : BASE[c]));

describe('el archivo entero', () => {
  it('rechaza lo que no es un .xlsx, y lo dice', async () => {
    const r = await leerCorrecciones(Buffer.from('esto no es un excel'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe('archivo-invalido');
  });

  /** Sin una columna clave no se puede saber a qué conteo apunta la fila: no se adivina. */
  it('rechaza el archivo entero si falta una columna necesaria, nombrándola', async () => {
    const r = await leerCorrecciones(await excel(['Inventario', 'Codigo', 'Contado', 'Nuevo valor', 'Motivo'], [[8090, '0051', 10, 12, 'x']]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe('columna-faltante');
    expect(r.detalle).toContain('Ronda');
    // Y dice cuáles son todas, para poder arreglarlo sin adivinar.
    for (const c of COLUMNAS_REQUERIDAS) expect(r.detalle).toContain(c);
  });

  /** Un archivo válido con cero filas NO es un archivo roto: son cero correcciones. */
  it('un archivo con encabezados y sin filas es válido y no corrige nada', async () => {
    const r = await leerCorrecciones(await excel(CABECERA, []))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.aCorregir).toHaveLength(0)
    expect(r.sinCambio).toHaveLength(0)
    expect(r.rechazadas).toHaveLength(0)
  })

  it('las columnas se buscan por nombre: el orden no importa y las de más se ignoran', async () => {
    const r = await leerCorrecciones(
      await excel(['Motivo', 'Codigo', 'Nuevo valor', 'Ronda', 'Contado', 'Inventario', 'Columna rara'], [
        ['Se contó mal', '0051', 12, 1, 10, 8090, 'basura'],
      ]),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.aCorregir).toHaveLength(1)
    expect(primera(r.aCorregir).nuevoValor).toBe(12)
  })

  it('tolera acentos y mayúsculas en los encabezados', async () => {
    const r = await leerCorrecciones(
      await excel(['INVENTARIO', 'Ronda', 'Código', 'Contado', 'NUEVO VALOR', 'motivo'], [[8090, 1, '0051', 10, 12, 'Se contó mal']]),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.aCorregir).toHaveLength(1)
  })
})

describe('las filas que cambian', () => {
  it('entran con su valor nuevo, su motivo y su número de fila del Excel', async () => {
    const r = await leerCorrecciones(await excel(CABECERA, [fila()]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.aCorregir).toEqual([
      { fila: 2, inventarioId: 8090, ronda: 1, codigo: '0051', contado: 10, nuevoValor: 12, motivo: 'Se contó mal la caja', tienda: 'Market Sucre' },
    ])
  })

  /** Un 0 real es una corrección como cualquier otra: "lo revisé y no había". */
  it('corregir a 0 es una corrección, no una fila vacía', async () => {
    const r = await leerCorrecciones(await excel(CABECERA, [fila({ 'Nuevo valor': 0 })]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(primera(r.aCorregir).nuevoValor).toBe(0)
  })
})

describe('las filas que NO cambian', () => {
  /**
   * `Nuevo valor` igual a `Contado` = esta fila no toca nada. No se aplica,
   * pero SE INFORMA: la vista previa dice cuántas son antes de confirmar.
   */
  it('se informan con su veredicto en vez de desaparecer', async () => {
    const r = await leerCorrecciones(await excel(CABECERA, [fila({ 'Nuevo valor': 10 })]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.aCorregir).toHaveLength(0)
    expect(r.sinCambio).toHaveLength(1)
    expect(primera(r.sinCambio)).toMatchObject({ fila: 2, codigo: '0051', contado: 10 })
  })

  /**
   * EL CASO MAYORITARIO, y el que más caro salió: el exportador escribe
   * "Nuevo valor" en blanco, así que casi todas las filas vuelven así. Leerlo
   * como dato faltante rechazaba el archivo entero fila por fila (bug real,
   * encontrado probando el circuito contra la base el 2026-10-13).
   */
  it('una celda de "Nuevo valor" vacía es una fila que no se tocó, no un dato faltante', async () => {
    const r = await leerCorrecciones(await excel(CABECERA, [fila({ 'Nuevo valor': null, Motivo: null })]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rechazadas).toHaveLength(0)
    expect(r.sinCambio).toHaveLength(1)
    expect(primera(r.sinCambio)).toMatchObject({ fila: 2, codigo: '0051' })
  })

  /** Un valor escrito pero ilegible SÍ es un dato roto: ahí sí se rechaza. */
  it('pero un "Nuevo valor" escrito y no numérico se rechaza', async () => {
    const r = await leerCorrecciones(await excel(CABECERA, [fila({ 'Nuevo valor': 'doce' })]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(primera(r.rechazadas).motivo).toBe('valor-invalido')
  })

  /**
   * ESCRIBIÓ UN MOTIVO Y EL VALOR NO CAMBIÓ. Casi siempre significa que quiso
   * cambiarlo y se olvidó -- dejarlo pasar en silencio es el peor resultado
   * posible, así que la fila sale con advertencia.
   */
  it('avisa cuando hay motivo pero el valor quedó igual', async () => {
    const r = await leerCorrecciones(await excel(CABECERA, [fila({ 'Nuevo valor': 10, Motivo: 'Corregido a 12' })]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(primera(r.sinCambio).advertencias).toEqual(['motivo-sin-cambio'])
  })

  it('y no avisa cuando no hay motivo: esa fila simplemente no se tocó', async () => {
    const r = await leerCorrecciones(await excel(CABECERA, [fila({ 'Nuevo valor': 10, Motivo: null })]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(primera(r.sinCambio).advertencias).toEqual([])
  })
})

describe('el motivo', () => {
  /** Rechaza LA FILA, no el archivo: las demás se aplican igual. */
  it('falta en una fila que cambia: se rechaza esa fila y las otras siguen', async () => {
    const r = await leerCorrecciones(
      await excel(CABECERA, [fila({ Motivo: null }), fila({ Codigo: '0052', Motivo: 'Estaba mal sumado' })]),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rechazadas).toHaveLength(1)
    expect(primera(r.rechazadas)).toMatchObject({ fila: 2, motivo: 'motivo-faltante', codigo: '0051' })
    // El detalle dice los DOS valores, para saber qué fila es sin volver al Excel.
    expect(primera(r.rechazadas).detalle).toContain('10')
    expect(primera(r.rechazadas).detalle).toContain('12')
    expect(r.aCorregir).toHaveLength(1)
  })

  /** El mismo piso que `hojas.schema.ts#motivoDeCorreccionSchema`: un "." no es un motivo. */
  it('un motivo de menos de 3 caracteres no alcanza', async () => {
    const r = await leerCorrecciones(await excel(CABECERA, [fila({ Motivo: '.' })]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(primera(r.rechazadas).motivo).toBe('motivo-faltante')
  })

  it('y uno de más de 200 tampoco', async () => {
    const r = await leerCorrecciones(await excel(CABECERA, [fila({ Motivo: 'x'.repeat(201) })]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(primera(r.rechazadas).motivo).toBe('motivo-faltante')
    expect(primera(r.rechazadas).detalle).toContain('201')
  })
})

describe('filas mal formadas', () => {
  it('sin inventario, ronda o código no se sabe a qué conteo apunta', async () => {
    const r = await leerCorrecciones(await excel(CABECERA, [fila({ Ronda: null })]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(primera(r.rechazadas).motivo).toBe('clave-incompleta')
  })

  /** Una unidad contada no es 2,5 ni un número negativo. */
  it.each([['2,5'], [-3], ['abc']])('rechaza %s como valor', async (valor) => {
    const r = await leerCorrecciones(await excel(CABECERA, [fila({ 'Nuevo valor': valor })]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(primera(r.rechazadas).motivo).toBe('valor-invalido')
  })

  /** Dos filas para el mismo conteo: no se aplican las dos ni se elige una. */
  it('rechaza la segunda fila que repite la misma clave', async () => {
    const r = await leerCorrecciones(await excel(CABECERA, [fila(), fila({ 'Nuevo valor': 15 })]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.aCorregir).toHaveLength(1)
    expect(primera(r.aCorregir).nuevoValor).toBe(12)
    expect(primera(r.rechazadas)).toMatchObject({ fila: 3, motivo: 'fila-duplicada' })
  })

  /** La misma ronda en OTRA tienda no es la misma clave. */
  it('el mismo código en otro inventario no es un duplicado', async () => {
    const r = await leerCorrecciones(await excel(CABECERA, [fila(), fila({ Inventario: 8091 })]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.aCorregir).toHaveLength(2)
    expect(r.rechazadas).toHaveLength(0)
  })

  it('una fila completamente en blanco no es nada: ni se reporta', async () => {
    const r = await leerCorrecciones(await excel(CABECERA, [fila(), [null, null, null, null, null, null, null]]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.aCorregir).toHaveLength(1)
    expect(r.rechazadas).toHaveLength(0)
    expect(r.sinCambio).toHaveLength(0)
  })
})

describe('el contrato de columnas', () => {
  it('el export escribe las seis requeridas', () => {
    for (const c of COLUMNAS_REQUERIDAS) expect(COLUMNAS_EXPORT).toContain(c)
  })

  it('"Tienda" se exporta aunque el importador no la necesite: es la que hace legible el archivo', () => {
    expect(COLUMNAS_EXPORT).toContain('Tienda')
    expect(COLUMNAS_REQUERIDAS as readonly string[]).not.toContain('Tienda')
  })
})
