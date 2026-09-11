/**
 * EL LECTOR DEL EXCEL DE AJUSTES DE DYNAMICS.
 *
 * Reemplaza el monto de "negativos" que antes se cargaba a mano en
 * `ResultadoInventario.montoNegativos` (el PUT /ajustes que lo hacía se sacó
 * en a1501dd) por la suma de
 * sobrantes que Jocelyn ya registró en el ERP durante el mes ('Ajuste por
 * análisis de Inventarios', motivo 'Sobrante único por unidad', responsable
 * Empleado) -- corte del 29 del mes anterior al 28 de este.
 *
 * SIN Prisma acá (mismo criterio que historial.calculos.ts/auditoria.calculos.ts):
 * recibe un Buffer y devuelve datos. El cableado a un endpoint real (y a
 * `ResultadoInventario.montoNegativos`) viene después, cuando exista el
 * campo en el esquema (min3) -- ESTE archivo no toca schema.prisma ni
 * liquidacion.permisos.ts a propósito.
 *
 * ---------------------------------------------------------------------------
 * EL CONTRATO ES LA ESTRUCTURA DE TÍTULOS, no un archivo de ejemplo real
 * ---------------------------------------------------------------------------
 * Decisión del cliente (2026-09-11): no hay un Excel real contra el que
 * validar. Lo único fijo son los 11 encabezados de `COLUMNAS_ESPERADAS`. Por
 * eso:
 *   - Se busca cada columna por NOMBRE (tolerante a mayúsculas/acentos),
 *     nunca por posición: el orden de las columnas en el archivo no importa.
 *   - Si falta CUALQUIERA de las 11, se rechaza el ARCHIVO ENTERO (no una
 *     fila): nada de adivinar una columna "parecida" en su lugar. El
 *     `detalle` dice cuáles faltan Y la estructura completa esperada, para
 *     que el Auditor pueda corregir el archivo sin adivinar.
 *   - Columnas de MÁS no molestan: se ignoran.
 *
 * ---------------------------------------------------------------------------
 * RECHAZO vs ADVERTENCIA -- no es lo mismo, y la diferencia es a propósito
 * ---------------------------------------------------------------------------
 * RECHAZO (la línea NO entra a la suma, nunca):
 *   - `otra-tienda`: el Almacén no es el de esta sucursal. No tiene sentido
 *     incluirlo nunca, sea cual sea la decisión del Auditor.
 *   - `datos-invalidos`: Cantidad/Precio/Importe no son números, o
 *     "Registrado en" no se puede interpretar como fecha. "Nunca descartar
 *     en silencio" no significa "incluir basura": una línea sin datos
 *     utilizables no puede sumarse a nada, así que se reporta aparte con su
 *     motivo, nunca como si valiera 0.
 *
 * ADVERTENCIA (la línea SIGUE siendo válida y entra al total -- Gilmer pidió
 * poder VERLAS y decidir él, "el área de negativos se equivoca en poner el
 * motivo"):
 *   - `importe-no-coincide`: Importe ≠ Cantidad × Precio (con tolerancia de
 *     redondeo).
 *   - `fuera-de-periodo`: "Registrado en" cae fuera del corte del mes.
 *   - `responsable-no-empleado`: Responsable no dice "Empleado".
 *
 * ---------------------------------------------------------------------------
 * EL 0 EXPLÍCITO
 * ---------------------------------------------------------------------------
 * Un archivo con encabezados válidos y CERO filas de datos es `ok: true`
 * con `validas: []` y `totalImporte: 0` -- alguien subió el Excel del mes y
 * no había ningún sobrante que reportar, un hecho verificado. Eso es
 * DISTINTO de `ok: false` (archivo mal formado, columna faltante, ni
 * siquiera es un .xlsx): ese es "no se pudo ni leer", y confundirlo con un
 * 0 real es el mismo error que `liquidacion.ajustes.ts` ya evita para
 * `montoNegativos` (NULL ≠ 0).
 */

import ExcelJS from 'exceljs';

// ---------------------------------------------------------------------------
// Encabezados esperados -- EL CONTRATO.
// ---------------------------------------------------------------------------

/**
 * Los 11 encabezados, EXACTOS en su forma canónica (se comparan
 * normalizados, ver `normalizarEncabezado`). El orden acá es el orden en
 * que se listan en un mensaje de error -- no importa el orden real del
 * archivo.
 */
export const COLUMNAS_ESPERADAS = [
  'Diario',
  'Descripcion',
  'Almacen',
  'Codigo',
  'Nombre2',
  'Cantidad',
  'Precio',
  'Importe',
  'Motivo de ajuste',
  'Registrado en',
  'Responsable',
] as const;

type ClaveColumna = (typeof COLUMNAS_ESPERADAS)[number];

/** Minúsculas, sin acentos, espacios colapsados -- para que "Almacén"/"almacen"/"ALMACEN" sean la misma columna, sin adivinar nada que no sea EXACTAMENTE esta forma. */
function normalizarEncabezado(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Motivos, con su texto legible.
// ---------------------------------------------------------------------------

export type MotivoRechazo = 'otra-tienda' | 'datos-invalidos';
export type MotivoAdvertencia = 'importe-no-coincide' | 'fuera-de-periodo' | 'responsable-no-empleado';

export interface LineaAjusteDynamics {
  /** Número de fila en el Excel (1-based, incluyendo el encabezado) -- para que el Auditor la ubique. */
  fila: number;
  diario: string;
  descripcion: string;
  almacen: string;
  /** SIEMPRE texto: un código como "101131" no es una cantidad, es un identificador (ver el mismo criterio en CatalogoItem.codigo). */
  codigo: string;
  nombre2: string;
  cantidad: number;
  precio: number;
  importe: number;
  motivoAjuste: string;
  registradoEn: Date;
  responsable: string;
}

export interface LineaAjusteValida extends LineaAjusteDynamics {
  /** Vacío = sin ningún problema. Puede tener más de uno a la vez. */
  advertencias: readonly MotivoAdvertencia[];
}

export interface LineaAjusteRechazada {
  fila: number;
  motivo: MotivoRechazo;
  /** Lo que se pudo leer de la fila -- nunca completo si el motivo es `datos-invalidos`, es justo lo que falla. */
  crudo: Record<string, unknown>;
}

export interface ParametrosLecturaAjustes {
  /** El almacén de la sucursal de este inventario (Sucursal.almacenId), ej "MD01_LUZ". Toda línea de OTRO almacén se rechaza: es de otra tienda. */
  almacenEsperado: string;
  /** Año y mes del inventario que se liquida -- define el corte válido: del 29 del mes ANTERIOR al 28 de ESTE, ambos inclusive. */
  periodoAnio: number;
  periodoMes: number;
}

export type ResultadoLecturaAjustes =
  | {
      ok: true;
      validas: readonly LineaAjusteValida[];
      rechazadas: readonly LineaAjusteRechazada[];
      /** SUMA de Importe de las VÁLIDAS (incluye las que tienen advertencia: siguen contando hasta que el Auditor decida excluirlas a mano). El 0 explícito de un archivo real sin líneas útiles. */
      totalImporte: number;
    }
  | {
      /** El archivo entero, no se pudo procesar -- nunca una lista vacía disfrazando esto. */
      ok: false;
      motivo: 'columna-faltante' | 'archivo-invalido';
      detalle: string;
    };

// ---------------------------------------------------------------------------
// Tolerancias de negocio.
// ---------------------------------------------------------------------------

/** Un centavo: lo que puede diferir Importe de Cantidad×Precio por redondeo en cada paso de Dynamics, sin que sea un error real. */
const TOLERANCIA_IMPORTE = 0.01;

// ---------------------------------------------------------------------------
// Parseo de "Registrado en": Date real de Excel, o texto "dd/mm/yyyy hh:mm".
// ---------------------------------------------------------------------------

const PATRON_FECHA_TEXTO = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/;

function parsearFecha(valor: unknown): Date | null {
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor;
  }
  if (typeof valor === 'string') {
    const m = PATRON_FECHA_TEXTO.exec(valor.trim());
    if (!m) return null;
    const [, dia, mes, anio, hora, minuto] = m;
    const fecha = new Date(Number(anio), Number(mes) - 1, Number(dia), Number(hora ?? '0'), Number(minuto ?? '0'));
    // new Date(2026, 1, 30) "corrige" a marzo en vez de fallar -- un 30/02
    // real del Excel es un dato roto, no una fecha válida a interpretar.
    if (fecha.getDate() !== Number(dia) || fecha.getMonth() !== Number(mes) - 1) return null;
    return fecha;
  }
  return null;
}

/**
 * El corte del período: del 29 del mes ANTERIOR (00:00) al 28 de ESTE
 * (23:59:59.999), ambos inclusive. `periodoMes` es 1-12; para enero el mes
 * anterior es diciembre del año anterior.
 */
function ventanaDeCorte(periodoAnio: number, periodoMes: number): { desde: Date; hasta: Date } {
  const desde = new Date(periodoAnio, periodoMes - 2, 29, 0, 0, 0, 0);
  const hasta = new Date(periodoAnio, periodoMes - 1, 28, 23, 59, 59, 999);
  return { desde, hasta };
}

function dentroDelCorte(fecha: Date, periodoAnio: number, periodoMes: number): boolean {
  const { desde, hasta } = ventanaDeCorte(periodoAnio, periodoMes);
  return fecha >= desde && fecha <= hasta;
}

// ---------------------------------------------------------------------------
// El lector.
// ---------------------------------------------------------------------------

/** Índice (1-based, como exceljs) de cada columna esperada, o `null` si no está. */
function ubicarColumnas(filaEncabezado: ExcelJS.Row): Map<ClaveColumna, number> {
  const porNombreNormalizado = new Map<string, ClaveColumna>(COLUMNAS_ESPERADAS.map((c) => [normalizarEncabezado(c), c]));
  const encontradas = new Map<ClaveColumna, number>();

  filaEncabezado.eachCell({ includeEmpty: false }, (celda, numeroColumna) => {
    const texto = celda.value;
    if (typeof texto !== 'string') return;
    const clave = porNombreNormalizado.get(normalizarEncabezado(texto));
    // Columnas de más se ignoran; si el archivo repitiera un encabezado
    // esperado dos veces, gana la PRIMERA (el orden de recorrido de
    // exceljs es el orden real de las columnas).
    if (clave && !encontradas.has(clave)) encontradas.set(clave, numeroColumna);
  });

  return encontradas;
}

function mensajeColumnasFaltantes(faltantes: readonly ClaveColumna[]): string {
  return (
    `Faltan estas columnas: ${faltantes.join(', ')}. ` +
    `La estructura esperada es exactamente: ${COLUMNAS_ESPERADAS.join(', ')}.`
  );
}

/** El valor crudo de una celda, como texto -- para el `crudo` de una línea rechazada. */
function valorCrudo(celda: ExcelJS.Cell): unknown {
  const v = celda.value;
  if (v && typeof v === 'object' && 'result' in v) return (v as { result: unknown }).result;
  return v;
}

function numeroDeCelda(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function textoDeCelda(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

export async function leerAjustesDynamics(buffer: Buffer, parametros: ParametrosLecturaAjustes): Promise<ResultadoLecturaAjustes> {
  const libro = new ExcelJS.Workbook();
  try {
    // `as any`: el `Buffer` que declara exceljs es un shim propio
    // (`extends ArrayBuffer`) que nunca matchea al Buffer real de Node
    // (`extends Uint8Array`) con @types/node instalado -- incompatibilidad
    // de TIPOS entre paquetes, no del dato (mismo caso que
    // historial.exportar.test.ts#leer).
    await libro.xlsx.load(buffer as any);
  } catch {
    return { ok: false, motivo: 'archivo-invalido', detalle: 'El archivo no se pudo leer como un Excel (.xlsx) válido.' };
  }

  const hoja = libro.worksheets[0];
  if (!hoja || hoja.rowCount === 0) {
    return { ok: false, motivo: 'columna-faltante', detalle: `El archivo no tiene encabezados. ${mensajeColumnasFaltantes(COLUMNAS_ESPERADAS)}` };
  }

  const filaEncabezado = hoja.getRow(1);
  const columnas = ubicarColumnas(filaEncabezado);
  const faltantes = COLUMNAS_ESPERADAS.filter((c) => !columnas.has(c));
  if (faltantes.length > 0) {
    return { ok: false, motivo: 'columna-faltante', detalle: mensajeColumnasFaltantes(faltantes) };
  }

  const idx = (clave: ClaveColumna): number => columnas.get(clave)!;

  const validas: LineaAjusteValida[] = [];
  const rechazadas: LineaAjusteRechazada[] = [];
  let totalImporte = 0;

  for (let numeroFila = 2; numeroFila <= hoja.rowCount; numeroFila++) {
    const fila = hoja.getRow(numeroFila);
    // Fila completamente vacía (exceljs a veces cuenta filas en blanco al
    // final del rango usado) -- no es una línea de datos, se saltea sin
    // reportarla como nada: no aporta ni rechazo ni advertencia.
    if (fila.cellCount === 0 && fila.actualCellCount === 0) continue;

    const crudo: Record<string, unknown> = {};
    for (const clave of COLUMNAS_ESPERADAS) crudo[clave] = valorCrudo(fila.getCell(idx(clave)));

    const diario = textoDeCelda(crudo['Diario']);
    const descripcion = textoDeCelda(crudo['Descripcion']);
    const almacen = textoDeCelda(crudo['Almacen']);
    const codigo = textoDeCelda(crudo['Codigo']);
    const nombre2 = textoDeCelda(crudo['Nombre2']);
    const motivoAjuste = textoDeCelda(crudo['Motivo de ajuste']);
    const responsable = textoDeCelda(crudo['Responsable']);

    // Una fila donde ni siquiera el código o el diario tienen algo escrito
    // es una fila en blanco de verdad (no una línea de ajuste rota) -- se
    // saltea, no se reporta.
    if (!diario && !codigo && !descripcion) continue;

    const cantidad = numeroDeCelda(crudo['Cantidad']);
    const precio = numeroDeCelda(crudo['Precio']);
    const importe = numeroDeCelda(crudo['Importe']);
    const registradoEn = parsearFecha(crudo['Registrado en']);

    if (cantidad === null || precio === null || importe === null || registradoEn === null) {
      rechazadas.push({ fila: numeroFila, motivo: 'datos-invalidos', crudo });
      continue;
    }

    if (normalizarEncabezado(almacen) !== normalizarEncabezado(parametros.almacenEsperado)) {
      rechazadas.push({ fila: numeroFila, motivo: 'otra-tienda', crudo });
      continue;
    }

    const advertencias: MotivoAdvertencia[] = [];
    if (Math.abs(importe - cantidad * precio) > TOLERANCIA_IMPORTE) advertencias.push('importe-no-coincide');
    if (!dentroDelCorte(registradoEn, parametros.periodoAnio, parametros.periodoMes)) advertencias.push('fuera-de-periodo');
    if (normalizarEncabezado(responsable) !== 'empleado') advertencias.push('responsable-no-empleado');

    validas.push({
      fila: numeroFila,
      diario,
      descripcion,
      almacen,
      codigo,
      nombre2,
      cantidad,
      precio,
      importe,
      motivoAjuste,
      registradoEn,
      responsable,
      advertencias,
    });
    totalImporte += importe;
  }

  return { ok: true, validas, rechazadas, totalImporte };
}
