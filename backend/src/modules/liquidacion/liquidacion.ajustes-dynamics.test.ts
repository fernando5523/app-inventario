/**
 * El lector del Excel de ajustes de Dynamics -- reemplaza el monto de
 * "negativos" cargado a mano (liquidacion.ajustes.ts) por la suma de
 * sobrantes que Jocelyn ya registró en el ERP durante el mes ('Ajuste por
 * análisis de Inventarios', motivo 'Sobrante único por unidad').
 *
 * SIN Prisma acá (mismo criterio que historial.calculos.ts): recibe un
 * Buffer y devuelve datos, para poder probarlo con un Excel armado en
 * memoria, sin subir nada a ningún lado. El cableado a un endpoint real
 * viene después, cuando exista el campo en el esquema (min3).
 */

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { leerAjustesDynamics, type ParametrosLecturaAjustes } from './liquidacion.ajustes-dynamics';

const ENCABEZADOS = ['Diario', 'Descripcion', 'Almacen', 'Codigo', 'Nombre2', 'Cantidad', 'Precio', 'Importe', 'Motivo de ajuste', 'Registrado en', 'Responsable'];

/** Arma un .xlsx en memoria, fila por fila, tal como lo mandaría Jocelyn. */
async function libroDePrueba(encabezados: string[], filas: unknown[][]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Ajustes');
  hoja.addRow(encabezados);
  for (const fila of filas) hoja.addRow(fila);
  const buffer = await libro.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** Una fila REAL del ejemplo del cliente, en el orden de ENCABEZADOS. */
function filaHalls(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  const base: Record<string, unknown> = {
    Diario: 'TRV-032240',
    Descripcion: 'Ajuste por analisis de Inventarios',
    Almacen: 'MD01_LUZ',
    Codigo: '101131',
    Nombre2: 'HALLS CARAMELO BARRA CHERRY CEREZA LYPTUS 28G',
    Cantidad: 1,
    Precio: 0.9,
    Importe: 0.9,
    'Motivo de ajuste': 'Sobrante unico por unidad',
    'Registrado en': '29/06/2026 16:54',
    Responsable: 'Empleado',
  };
  return ENCABEZADOS.map((e) => (e in overrides ? overrides[e] : base[e]));
}

const PARAMS: ParametrosLecturaAjustes = { almacenEsperado: 'MD01_LUZ', periodoAnio: 2026, periodoMes: 6 };

describe('leerAjustesDynamics: caso normal, las dos filas de ejemplo del cliente', () => {
  it('lee ambas filas válidas, sin advertencias, y suma el Importe', async () => {
    const buffer = await libroDePrueba(ENCABEZADOS, [
      filaHalls(),
      filaHalls({
        Diario: 'TRV-032743',
        Codigo: '105586',
        Nombre2: 'UNION PAN FUENTE 780G',
        Cantidad: 4,
        Precio: 7.29,
        Importe: 29.16,
        'Registrado en': '20/07/2026 16:02',
      }),
    ]);
    const resultado = await leerAjustesDynamics(buffer, { ...PARAMS, periodoMes: 7 });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.validas).toHaveLength(2);
    expect(resultado.rechazadas).toHaveLength(0);
    expect(resultado.validas[0]!.advertencias).toEqual([]);
    expect(resultado.validas[1]!.advertencias).toEqual([]);
    expect(resultado.totalImporte).toBeCloseTo(0.9 + 29.16, 2);
  });

  it('lee Cantidad/Precio/Importe como número y Código como texto', async () => {
    const buffer = await libroDePrueba(ENCABEZADOS, [filaHalls()]);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    if (!resultado.ok) throw new Error('debía ser ok');
    const linea = resultado.validas[0]!;
    expect(linea.cantidad).toBe(1);
    expect(linea.precio).toBe(0.9);
    expect(linea.importe).toBe(0.9);
    expect(typeof linea.codigo).toBe('string');
    expect(linea.codigo).toBe('101131');
  });

  it('acepta "Registrado en" como fecha real de Excel (Date), no solo como texto', async () => {
    const buffer = await libroDePrueba(ENCABEZADOS, [filaHalls({ 'Registrado en': new Date(2026, 5, 29, 16, 54) })]);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    if (!resultado.ok) throw new Error('debía ser ok');
    expect(resultado.validas[0]!.registradoEn.getFullYear()).toBe(2026);
    expect(resultado.validas[0]!.registradoEn.getMonth()).toBe(5);
    expect(resultado.validas[0]!.registradoEn.getDate()).toBe(29);
  });
});

describe('leerAjustesDynamics: encuentra columnas por NOMBRE, tolerante a mayúsculas y acentos', () => {
  it('encabezados con acentos y otro orden -- da lo mismo, se busca por nombre', async () => {
    const encabezadosConAcentos = ['Descripción', 'Diario', 'Código', 'Almacén', 'Responsable', 'Registrado en', 'Motivo de ajuste', 'Importe', 'Precio', 'Cantidad', 'Nombre2'];
    const filaEnOrdenNuevo = [
      'Ajuste por analisis de Inventarios',
      'TRV-032240',
      '101131',
      'MD01_LUZ',
      'Empleado',
      '29/06/2026 16:54',
      'Sobrante unico por unidad',
      0.9,
      0.9,
      1,
      'HALLS CARAMELO BARRA CHERRY CEREZA LYPTUS 28G',
    ];
    const buffer = await libroDePrueba(encabezadosConAcentos, [filaEnOrdenNuevo]);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.validas).toHaveLength(1);
    expect(resultado.validas[0]!.codigo).toBe('101131');
  });

  it('encabezados en MAYUSCULAS también matchean', async () => {
    const encabezadosMayus = ENCABEZADOS.map((e) => e.toUpperCase());
    const buffer = await libroDePrueba(encabezadosMayus, [filaHalls()]);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    expect(resultado.ok).toBe(true);
  });

  // Decisión del cliente (2026-09-11): el contrato es la ESTRUCTURA DE
  // TÍTULOS -- no hay archivo real de ejemplo. Columnas de más no molestan
  // (se ignoran); NINGUNA de las 11 esperadas puede faltar, y nada de
  // adivinar una columna "parecida" en su lugar.
  it('columnas de MÁS no molestan -- se ignoran, el archivo se procesa igual', async () => {
    const conColumnaExtra = [...ENCABEZADOS, 'Observaciones internas'];
    const filaConExtra = [...filaHalls(), 'una nota que a nadie le importa acá'];
    const buffer = await libroDePrueba(conColumnaExtra, [filaConExtra]);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.validas).toHaveLength(1);
    expect(resultado.validas[0]!.codigo).toBe('101131');
  });

  it('una columna extra en el MEDIO (antes de una esperada) tampoco corre el resto', async () => {
    const conColumnaEnMedio = ['Diario', 'Columna rara', 'Descripcion', 'Almacen', 'Codigo', 'Nombre2', 'Cantidad', 'Precio', 'Importe', 'Motivo de ajuste', 'Registrado en', 'Responsable'];
    const base = filaHalls();
    const filaConExtra = [base[0], 'lo que sea', ...base.slice(1)];
    const buffer = await libroDePrueba(conColumnaEnMedio, [filaConExtra]);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.validas[0]!.codigo).toBe('101131');
  });
});

describe('leerAjustesDynamics: rechazos (línea de OTRA tienda)', () => {
  it('almacén distinto del esperado -- se marca como de otra tienda, en rechazadas', async () => {
    const buffer = await libroDePrueba(ENCABEZADOS, [filaHalls({ Almacen: 'MD02_JRC' })]);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    if (!resultado.ok) throw new Error('debía ser ok');
    expect(resultado.validas).toHaveLength(0);
    expect(resultado.rechazadas).toHaveLength(1);
    expect(resultado.rechazadas[0]!.motivo).toBe('otra-tienda');
    // El total NO incluye la línea rechazada -- es de otra tienda, no de esta liquidación.
    expect(resultado.totalImporte).toBe(0);
  });

  it('una línea rechazada no descarta las demás -- el resto sigue procesándose', async () => {
    const buffer = await libroDePrueba(ENCABEZADOS, [filaHalls({ Almacen: 'MD02_JRC' }), filaHalls({ Codigo: '999999' })]);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    if (!resultado.ok) throw new Error('debía ser ok');
    expect(resultado.rechazadas).toHaveLength(1);
    expect(resultado.validas).toHaveLength(1);
    expect(resultado.validas[0]!.codigo).toBe('999999');
  });
});

describe('leerAjustesDynamics: advertencias (la línea sigue siendo válida, pero marcada)', () => {
  it('Importe que no coincide con Cantidad x Precio -- advertencia, sigue contando en el total', async () => {
    const buffer = await libroDePrueba(ENCABEZADOS, [filaHalls({ Cantidad: 2, Precio: 0.9, Importe: 5 })]);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    if (!resultado.ok) throw new Error('debía ser ok');
    expect(resultado.validas).toHaveLength(1);
    expect(resultado.validas[0]!.advertencias).toContain('importe-no-coincide');
    expect(resultado.totalImporte).toBe(5);
  });

  it('Importe que coincide CON tolerancia de redondeo (1 centavo) -- sin advertencia', async () => {
    const buffer = await libroDePrueba(ENCABEZADOS, [filaHalls({ Cantidad: 3, Precio: 0.333, Importe: 1 })]);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    if (!resultado.ok) throw new Error('debía ser ok');
    expect(resultado.validas[0]!.advertencias).not.toContain('importe-no-coincide');
  });

  it('"Registrado en" fuera del corte del período (29 del mes anterior a 28 de este) -- advertencia', async () => {
    // Período jun-2026 (periodoMes=6): corte válido es 29/05 al 28/06.
    const buffer = await libroDePrueba(ENCABEZADOS, [filaHalls({ 'Registrado en': '15/05/2026 10:00' })]);
    const resultado = await leerAjustesDynamics(buffer, { ...PARAMS, periodoMes: 6 });
    if (!resultado.ok) throw new Error('debía ser ok');
    expect(resultado.validas[0]!.advertencias).toContain('fuera-de-periodo');
  });

  it('"Registrado en" el primer día del corte (29 del mes anterior) -- sin advertencia, es el límite inclusive', async () => {
    const buffer = await libroDePrueba(ENCABEZADOS, [filaHalls({ 'Registrado en': '29/05/2026 00:00' })]);
    const resultado = await leerAjustesDynamics(buffer, { ...PARAMS, periodoMes: 6 });
    if (!resultado.ok) throw new Error('debía ser ok');
    expect(resultado.validas[0]!.advertencias).not.toContain('fuera-de-periodo');
  });

  it('"Registrado en" el último día del corte (28 de este mes) -- sin advertencia, es el límite inclusive', async () => {
    const buffer = await libroDePrueba(ENCABEZADOS, [filaHalls({ 'Registrado en': '28/06/2026 23:59' })]);
    const resultado = await leerAjustesDynamics(buffer, { ...PARAMS, periodoMes: 6 });
    if (!resultado.ok) throw new Error('debía ser ok');
    expect(resultado.validas[0]!.advertencias).not.toContain('fuera-de-periodo');
  });

  it('Responsable distinto de Empleado -- advertencia, Gilmer pidió poder verla y decidir', async () => {
    const buffer = await libroDePrueba(ENCABEZADOS, [filaHalls({ Responsable: 'Empresa' })]);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    if (!resultado.ok) throw new Error('debía ser ok');
    expect(resultado.validas[0]!.advertencias).toContain('responsable-no-empleado');
  });

  it('una línea puede tener VARIAS advertencias a la vez', async () => {
    const buffer = await libroDePrueba(ENCABEZADOS, [filaHalls({ Responsable: 'Empresa', Importe: 999, 'Registrado en': '01/01/2020 00:00' })]);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    if (!resultado.ok) throw new Error('debía ser ok');
    expect(resultado.validas[0]!.advertencias).toEqual(
      expect.arrayContaining(['responsable-no-empleado', 'importe-no-coincide', 'fuera-de-periodo']),
    );
  });
});

describe('leerAjustesDynamics: el 0 explícito -- un Excel válido sin líneas útiles no es lo mismo que no haber subido nada', () => {
  it('archivo con encabezados y CERO filas de datos: ok, 0 líneas, total 0 -- no un error', async () => {
    const buffer = await libroDePrueba(ENCABEZADOS, []);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.validas).toEqual([]);
    expect(resultado.rechazadas).toEqual([]);
    expect(resultado.totalImporte).toBe(0);
  });
});

describe('leerAjustesDynamics: archivo mal formado -- esto sí es un error, no una lista vacía', () => {
  it('falta una columna obligatoria -- se RECHAZA EL ARCHIVO ENTERO, con el nombre de la que falta y la estructura esperada', async () => {
    const sinResponsable = ENCABEZADOS.filter((e) => e !== 'Responsable');
    const buffer = await libroDePrueba(sinResponsable, [filaHalls().slice(0, -1)]);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivo).toBe('columna-faltante');
    // Dice CUÁL falta...
    expect(resultado.detalle).toMatch(/responsable/i);
    // ...Y dice la estructura completa esperada -- nada de adivinar una
    // columna "parecida" en su lugar, el Auditor tiene que ver el contrato
    // exacto para corregir el archivo.
    for (const encabezado of ENCABEZADOS) {
      expect(resultado.detalle).toContain(encabezado);
    }
  });

  it('faltan VARIAS columnas -- se listan todas, no solo la primera que se encuentra', async () => {
    const sinDosColumnas = ENCABEZADOS.filter((e) => e !== 'Responsable' && e !== 'Precio');
    const buffer = await libroDePrueba(sinDosColumnas, []);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.detalle).toMatch(/responsable/i);
    expect(resultado.detalle).toMatch(/precio/i);
  });

  it('una columna con nombre PARECIDO pero no exacto no cuenta como la esperada -- nada de adivinar', async () => {
    const conColumnaParecida = ENCABEZADOS.map((e) => (e === 'Responsable' ? 'Responsable del ajuste' : e));
    const buffer = await libroDePrueba(conColumnaParecida, [filaHalls()]);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.detalle).toMatch(/responsable/i);
  });

  it('el libro no tiene ninguna hoja -- ok:false, nunca una lista vacía silenciosa', async () => {
    const libro = new ExcelJS.Workbook();
    const buffer = Buffer.from(await libro.xlsx.writeBuffer());
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    expect(resultado.ok).toBe(false);
  });

  it('el archivo ni siquiera es un .xlsx válido -- ok:false, no revienta', async () => {
    const buffer = Buffer.from('esto no es un excel');
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    expect(resultado.ok).toBe(false);
  });
});

describe('leerAjustesDynamics: datos que no se pueden leer, línea por línea (nunca se cuela basura en silencio)', () => {
  it('Cantidad no numérica -- la línea se rechaza con su motivo, el resto sigue', async () => {
    const buffer = await libroDePrueba(ENCABEZADOS, [filaHalls({ Cantidad: 'no-es-un-numero' }), filaHalls({ Codigo: '999999' })]);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    if (!resultado.ok) throw new Error('debía ser ok');
    expect(resultado.rechazadas.some((r) => r.motivo === 'datos-invalidos')).toBe(true);
    expect(resultado.validas).toHaveLength(1);
  });

  it('"Registrado en" no se puede interpretar como fecha -- se rechaza con motivo', async () => {
    const buffer = await libroDePrueba(ENCABEZADOS, [filaHalls({ 'Registrado en': 'no es una fecha' })]);
    const resultado = await leerAjustesDynamics(buffer, PARAMS);
    if (!resultado.ok) throw new Error('debía ser ok');
    expect(resultado.rechazadas).toHaveLength(1);
    expect(resultado.rechazadas[0]!.motivo).toBe('datos-invalidos');
  });
});
