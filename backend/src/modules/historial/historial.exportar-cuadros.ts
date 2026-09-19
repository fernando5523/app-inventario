/**
 * EL LIBRO EXCEL CON EL FORMATO DEL CLIENTE: los cuatro cuadros mas empresa y
 * la hoja de descuento, tal como Gilmer los arma a mano todos los meses.
 *
 * SIN Prisma (regla de capas, ver historial.service.ts): recibe los cuadros ya
 * armados y arma el libro, para poder probarlo sin base de datos.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO EXISTE AL LADO DE `historial.exportar.ts`
 * ---------------------------------------------------------------------------
 * Son DOS entregables distintos y ninguno reemplaza al otro:
 *
 *   - `historial.exportar.ts` -> TABLA PLANA, una fila por producto, sin
 *     titulos ni celdas combinadas, para analizar en tablas dinamicas. Tiene
 *     su propio contrato con el cliente y NO se toca.
 *   - este -> EL FORMATO DE SU PLANILLA, con bloques, totales y la hoja de
 *     descuento. Es el que el cliente va a poner al lado del suyo para
 *     comparar.
 *
 * ---------------------------------------------------------------------------
 * LA ESPECIFICACION ES SU PROPIO ARCHIVO, NO UN DISENO NUESTRO
 * ---------------------------------------------------------------------------
 * `requerimiento/INVENTARIO MES DE JULIO 2026 ACTUAL MKT BOLIVAR.xlsx`, que
 * Fernando le pidio en la reunion justamente para replicar el formato. De ahi
 * salen los nombres de las hojas, el orden de los bloques y los encabezados.
 *
 * "DISCRIPCION" VA ASI, CON LA FALTA DE ORTOGRAFIA. No es un descuido: quien
 * recibe el archivo lo va a comparar columna por columna contra el suyo, y una
 * columna renombrada es una pregunta que no queremos que haga. Lo mismo con
 * "PRODUCTOS SOBRANTES UNICO" en singular mientras el de faltantes va en
 * plural. Si alguna vez se corrige, se corrige de acuerdo con el cliente y en
 * su archivo tambien -- no unilateralmente acá.
 *
 * Lo unico que NO se replica al pie de la letra son los espacios al final de
 * algunos de sus titulos ("MONTO A DESCONTAR "): son invisibles, no cambian la
 * comparacion y parecerian un error de este codigo.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ENTRA AL DESCUENTO Y LO QUE NO
 * ---------------------------------------------------------------------------
 * Verificado contra su hoja DESCUENTO de julio 2026:
 *
 *     TOTAL FALTANTES (unicos)  -862.50
 *   + TOTAL SOBRANTES (unicos)  +490.60
 *   = DIFERENCIA                -371.90   ->  / 12 personas = -30.99 c/u
 *
 * Los cuadros POR PAQUETE (-877.20 y +625.90) y la hoja EMPRESA se reportan
 * pero NO entran en esa suma. Es el "lo quito este paquete de aca y le pongo
 * en otro cuadro" del cliente: se auditan aparte, quizas contra el almacenero.
 */

import ExcelJS from 'exceljs';

/** Una fila de cualquiera de los cuadros. `cantidad` y `total` CON SIGNO. */
export interface FilaCuadro {
  codigo: string;
  descripcion: string;
  /** Negativo = faltante, positivo = sobrante. */
  cantidad: number;
  /** `null` = el snapshot no trajo precio: la fila existe, el monto no. */
  precioUnitario: number | null;
  /** `cantidad x precioUnitario`. `null` cuando no se pudo valorizar. */
  total: number | null;
}

/** Una fila de la hoja DESCUENTO: lo que se le descuenta a cada persona. */
export interface FilaDescuento {
  nombre: string;
  dni: string;
  cuotaBase: number;
  /** Multa menos bono, con signo: negativo descuenta, positivo devuelve. */
  asistencia: number;
  /** cuotaBase + asistencia. Derivado, nunca guardado (ver historial.calculos.ts). */
  total: number;
}

export interface LibroDeCuadros {
  sucursal: string;
  faltantesUnicos: readonly FilaCuadro[];
  sobrantesUnicos: readonly FilaCuadro[];
  faltantesPaquete: readonly FilaCuadro[];
  sobrantesPaquete: readonly FilaCuadro[];
  empresaFaltantes: readonly FilaCuadro[];
  empresaSobrantes: readonly FilaCuadro[];
  descuento: {
    totalFaltantes: number;
    totalSobrantes: number;
    /** `totalFaltantes + totalSobrantes` -- los sobrantes COMPENSAN. */
    diferencia: number;
    personas: number;
    cuotaBase: number;
    planilla: readonly FilaDescuento[];
  };
}

/** Sus encabezados, tal cual. Ver el comentario de cabecera sobre "DISCRIPCION". */
const ENCABEZADOS = ['CODIGO', 'DISCRIPCION', 'CANTIDAD', 'P/U', 'TOTAL'] as const;

/**
 * Suma los totales de un cuadro, salteando lo que no se pudo valorizar.
 *
 * Un item sin precio NO vale 0: no se sabe cuanto vale. Se suma lo que si se
 * puede y la fila queda en el cuadro con el monto vacio -- es la misma regla
 * que hace que `diferenciaValor` devuelva null (auditoria.calculos.ts).
 */
function totalDe(filas: readonly FilaCuadro[]): number {
  return filas.reduce((suma, f) => suma + (f.total ?? 0), 0);
}

/**
 * Un bloque: titulo, encabezados, filas y su total. Devuelve la fila siguiente
 * para que quien llama encadene el bloque de abajo sin contar a mano.
 *
 * `conTotal` porque los bloques de su archivo no son todos iguales: el de
 * faltantes unicos lleva la palabra TOTAL al lado del numero y los de paquete
 * llevan el numero solo. Se replica esa diferencia en vez de uniformarla, por
 * el mismo motivo que "DISCRIPCION".
 */
function escribirBloque(
  hoja: ExcelJS.Worksheet,
  desde: number,
  titulo: string,
  filas: readonly FilaCuadro[],
  conEtiquetaTotal: boolean,
): number {
  hoja.getCell(`B${desde}`).value = titulo;
  const filaEncabezados = desde + 1;
  ENCABEZADOS.forEach((texto, i) => {
    hoja.getCell(filaEncabezados, i + 1).value = texto;
  });

  let n = filaEncabezados + 1;

  /**
   * UN CUADRO VACIO LLEVA SUS ENCABEZADOS Y UNA LINEA QUE LO DICE, no se
   * omite.
   *
   * La diferencia importa para quien recibe el archivo: una hoja o un bloque
   * QUE FALTA se lee como "el sistema falló y no lo generó", y manda a alguien
   * a preguntar. Un bloque presente y vacio, con la linea puesta, afirma algo:
   * "se miró y no hubo nada en este cuadro". Es la misma distincion entre
   * `null` y `0` que este backend sostiene en todos lados -- no saber no es lo
   * mismo que saber que no hay.
   *
   * Y tiene un efecto practico: el cliente compara este archivo contra el
   * suyo bloque por bloque. Si un mes no hubo faltantes por paquete y el
   * bloque desaparece, los renglones de abajo se corren y la comparacion
   * visual deja de funcionar.
   */
  if (filas.length === 0) {
    hoja.getCell(n, 2).value = 'Sin ítems en este cuadro.';
    n += 1;
  }

  for (const fila of filas) {
    // Numeros como NUMERO, nunca como texto: un string queda fuera de
    // cualquier SUMA y se alinea distinto. Misma regla que historial.exportar.ts.
    hoja.getCell(n, 1).value = fila.codigo;
    hoja.getCell(n, 2).value = fila.descripcion;
    hoja.getCell(n, 3).value = fila.cantidad;
    hoja.getCell(n, 4).value = fila.precioUnitario;
    hoja.getCell(n, 5).value = fila.total;
    n += 1;
  }

  if (conEtiquetaTotal) hoja.getCell(n, 2).value = 'TOTAL';
  hoja.getCell(n, 5).value = totalDe(filas);
  // Una fila en blanco entre bloques, como en su archivo.
  return n + 2;
}

/**
 * El libro completo. Cuatro hojas, en el orden de su archivo.
 */
export async function armarLibroDeCuadros(datos: LibroDeCuadros): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();

  // --- FALTANTES: los unicos arriba, los dos cuadros por paquete abajo ---
  const faltantes = libro.addWorksheet('FALTANTES');
  faltantes.getCell('A1').value = `INVENTARIO DE PRODUCTOS GRANDES ${datos.sucursal}`;
  let n = escribirBloque(faltantes, 3, 'PRODUCTOS FALTANTES UNICOS', datos.faltantesUnicos, true);
  n = escribirBloque(faltantes, n, 'FALTANTE POR PAQUETE', datos.faltantesPaquete, false);
  escribirBloque(faltantes, n, 'SOBRANTE POR PAQUETE', datos.sobrantesPaquete, false);

  // --- SOBRANTES ---
  const sobrantes = libro.addWorksheet('SOBRANTES');
  sobrantes.getCell('A1').value = `INVENTARIO DE PRODUCTOS GRANDES ${datos.sucursal}`;
  escribirBloque(sobrantes, 2, 'PRODUCTOS SOBRANTES UNICO', datos.sobrantesUnicos, true);

  // --- EMPRESA: lo que absorbe gerencia, aparte y con su propia diferencia ---
  const empresa = libro.addWorksheet('EMPRESA');
  empresa.getCell('A1').value = `INVENTARIO DE PRODUCTOS CERVEZA ${datos.sucursal}`;
  let e = escribirBloque(empresa, 3, 'PRODUCTOS FALTANTES UNICOS', datos.empresaFaltantes, true);
  e = escribirBloque(empresa, e, 'PRODUCTOS SOBRANTES UNICO', datos.empresaSobrantes, true);
  empresa.getCell(`B${e}`).value = 'DIFERENCIA';
  empresa.getCell(`E${e}`).value = totalDe(datos.empresaFaltantes) + totalDe(datos.empresaSobrantes);

  escribirDescuento(libro.addWorksheet('DESCUENTO'), datos);

  const buffer = await libro.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * La hoja DESCUENTO: de donde sale el monto y como se reparte.
 *
 * Los tres renglones de arriba son la cuenta entera, y estan a proposito uno
 * debajo del otro: quien recibe el archivo tiene que poder seguirla sin abrir
 * otra hoja. Los cuadros por paquete NO aparecen acá -- si aparecieran,
 * alguien los sumaria.
 */
function escribirDescuento(hoja: ExcelJS.Worksheet, datos: LibroDeCuadros): void {
  const d = datos.descuento;
  hoja.getCell('B2').value = `DESCUENTOS DEL MES ${datos.sucursal}`;

  hoja.getCell('B4').value = 'TOTAL FALTANTES';
  hoja.getCell('E4').value = d.totalFaltantes;
  hoja.getCell('B5').value = 'TOTAL SOBRANTES';
  hoja.getCell('E5').value = d.totalSobrantes;
  hoja.getCell('B6').value = 'DIFERENCIA';
  hoja.getCell('E6').value = d.diferencia;

  hoja.getCell('B9').value = 'MONTO A DESCONTAR';
  hoja.getCell('E9').value = d.diferencia;
  hoja.getCell('B11').value = 'CUOTA POR PERSONA';
  hoja.getCell('E11').value = d.cuotaBase;
  hoja.getCell('C11').value = d.personas;

  hoja.getCell('C13').value = 'RELACIÓN DEL PERSONAL A DESCONTAR';
  hoja.getCell('C14').value = 'APELLIDOS Y NOMBRES';
  hoja.getCell('D14').value = 'DNI';
  hoja.getCell('E14').value = 'CUOTA';
  hoja.getCell('G14').value = 'ASISTENCIA';
  hoja.getCell('I14').value = 'TOTAL';

  let n = 15;
  for (const [indice, persona] of d.planilla.entries()) {
    hoja.getCell(n, 2).value = indice + 1;
    hoja.getCell(n, 3).value = persona.nombre;
    hoja.getCell(n, 4).value = persona.dni;
    hoja.getCell(n, 5).value = persona.cuotaBase;
    hoja.getCell(n, 7).value = persona.asistencia;
    hoja.getCell(n, 9).value = persona.total;
    n += 1;
  }

  hoja.getCell(n, 3).value = 'TOTAL';
  hoja.getCell(n, 9).value = d.planilla.reduce((suma, p) => suma + p.total, 0);
}

/** `inventario-cuadros-market-bolivar-2026-07-inv45.xlsx` */
export function nombreArchivoCuadros(
  sucursal: string,
  periodoAnio: number,
  periodoMes: number,
  inventarioId: number,
): string {
  const limpia = sucursal
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `inventario-cuadros-${limpia}-${periodoAnio}-${String(periodoMes).padStart(2, '0')}-inv${inventarioId}.xlsx`;
}
