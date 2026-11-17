/**
 * EL FORMATO DEL EXCEL DE CORRECCIÓN MASIVA, y su lector.
 *
 * Pedido del usuario: exportar lo contado, corregirlo en Excel y volver a
 * importar EL MISMO archivo. Este archivo define las columnas y traduce el
 * .xlsx a filas; quién puede escribir y qué se escribe lo decide
 * `correcciones.service.ts`, que entra por `hojas.service.ts#corregirConteo`
 * -- la MISMA función que la corrección de a uno.
 *
 * SIN Prisma acá, mismo criterio que `liquidacion.ajustes-dynamics.ts`:
 * recibe un Buffer y devuelve datos, así se prueba sin base.
 *
 * ---------------------------------------------------------------------------
 * QUÉ IDENTIFICA UNA FILA (y por qué no alcanza el código de producto)
 * ---------------------------------------------------------------------------
 * La exportación puede traer LAS ONCE TIENDAS y VARIAS RONDAS en el mismo
 * archivo. Un código de producto se repite en todas: aparece en la ronda 1 de
 * Luzuriaga, en la 2 de Luzuriaga y en la 1 de Carhuaz, y son tres conteos
 * distintos. La clave es `Inventario + Ronda + Codigo`, y las tres tienen que
 * venir en el archivo.
 *
 * `Inventario` es un id y `Tienda` un nombre: el id manda, el nombre se
 * VERIFICA. Si no concuerdan, la fila se rechaza en vez de preferir uno --
 * un archivo donde alguien reordenó mal las filas no se arregla adivinando.
 *
 * ---------------------------------------------------------------------------
 * `Contado` NO ES DECORATIVO: ES LA BASE DE COMPARACIÓN Y EL SEGURO
 * ---------------------------------------------------------------------------
 * Hace dos trabajos, y los dos son la razón de que el formato no necesite una
 * columna de "marcar para corregir":
 *
 *   1. Decide si la fila CAMBIA: `Nuevo valor` distinto de `Contado` es una
 *      corrección; igual, no. Así la mayoría del archivo vuelve sin tocar y
 *      sin que nadie tenga que marcar nada.
 *   2. Detecta que el archivo QUEDÓ VIEJO: si el `Contado` del archivo ya no
 *      es el que tiene la base, alguien corrigió ese conteo entre la
 *      exportación y la importación. Ahí la fila se RECHAZA (`valor-
 *      desactualizado`) en vez de pisar el trabajo del otro en silencio.
 *
 * Y NADA SE IGNORA EN SILENCIO: una fila sin cambio se informa igual, con su
 * veredicto `sin-cambio` y su cuenta en el resumen. La vista previa dice "38
 * sin cambio, 5 a corregir" ANTES de confirmar, que es donde quien creyó
 * haber cambiado algo se entera de que no lo cambió.
 *
 * ---------------------------------------------------------------------------
 * LAS COLUMNAS QUE EL LECTOR IGNORA
 * ---------------------------------------------------------------------------
 * `Tienda` (se verifica, no se usa), `Periodo`, `Hoja`, `Descripcion`,
 * `Corregible`, `Stock ERP` y `Diferencia` son INFORMATIVAS: están para que
 * el archivo se pueda leer y decidir en Excel. El exportador escribe una
 * segunda hoja, `Instrucciones`, que lo dice ahí mismo -- y el lector mira
 * SOLO la primera hoja, así que agregar hojas no rompe nada.
 */

import ExcelJS from 'exceljs';

// ---------------------------------------------------------------------------
// Las columnas -- EL CONTRATO
// ---------------------------------------------------------------------------

/**
 * Las SEIS que el importador necesita. Si falta cualquiera se rechaza el
 * ARCHIVO ENTERO (no una fila): sin ellas no se puede saber a qué conteo
 * apunta la fila ni qué escribir. Mismo criterio que el Excel de negativos.
 */
export const COLUMNAS_REQUERIDAS = ['Inventario', 'Ronda', 'Codigo', 'Contado', 'Nuevo valor', 'Motivo'] as const;

/**
 * Las informativas. El lector NO las exige; `Tienda`, si viene, se verifica
 * contra `Inventario`. Las demás no se miran -- están para quien abre el
 * archivo, no para el importador.
 */
export const COLUMNAS_INFORMATIVAS = [
  'Tienda',
  'Periodo',
  'Hoja',
  'Descripcion',
  'Corregible',
  'Stock ERP',
  'Diferencia',
] as const;

/** El orden en que las escribe el exportador. Reordenarlas en Excel no rompe nada: se buscan por nombre. */
export const COLUMNAS_EXPORT = [
  'Inventario',
  'Tienda',
  'Periodo',
  'Ronda',
  'Hoja',
  'Codigo',
  'Descripcion',
  'Contado',
  'Nuevo valor',
  'Motivo',
  'Corregible',
  'Stock ERP',
  'Diferencia',
] as const;

export type ColumnaExport = (typeof COLUMNAS_EXPORT)[number];
type ClaveRequerida = (typeof COLUMNAS_REQUERIDAS)[number];

/** Minúsculas, sin acentos, espacios colapsados: "Código"/"codigo"/"CODIGO" son la misma columna. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// El veredicto de cada fila
// ---------------------------------------------------------------------------

/**
 * Por qué una fila no se puede corregir. Las que dependen de la BASE
 * (producto, conteo previo, estado del inventario) las resuelve el service;
 * acá solo las que se ven leyendo el archivo.
 */
export type MotivoRechazoFila =
  | 'clave-incompleta'
  | 'valor-invalido'
  | 'motivo-faltante'
  | 'fila-duplicada'
  // -- de acá para abajo las decide el service, contra la base --
  | 'inventario-inexistente'
  | 'tienda-no-coincide'
  | 'inventario-no-corrige'
  | 'sin-permiso'
  | 'producto-inexistente'
  | 'producto-ambiguo'
  | 'sin-conteo-previo'
  | 'valor-desactualizado'
  | 'fallo-al-aplicar';

/**
 * Lo que no impide corregir pero hay que ver. La única que sale del archivo
 * es la que más importa: escribió un motivo y el valor NO cambió. Suele
 * significar que quiso cambiarlo y se olvidó -- ignorarlo en silencio es
 * exactamente el peor resultado posible.
 */
export type MotivoAdvertenciaFila = 'motivo-sin-cambio';

/** Una fila del archivo, ya leída. `fila` es el número de fila del Excel (1-based, con encabezado). */
export interface FilaLeida {
  fila: number;
  inventarioId: number;
  ronda: number;
  codigo: string;
  /** Lo que el archivo dice que hay cargado hoy. */
  contado: number;
  /** Lo que se quiere dejar. */
  nuevoValor: number;
  motivo: string;
  /** `null` si el archivo no trae la columna `Tienda`. Se verifica contra el inventario. */
  tienda: string | null;
}

export interface FilaSinCambio {
  fila: number;
  inventarioId: number;
  ronda: number;
  codigo: string;
  /** `null` cuando la fila ni siquiera trae `Contado` legible -- no se toca igual, así que no hace falta. */
  contado: number | null;
  advertencias: readonly MotivoAdvertenciaFila[];
}

export interface FilaRechazada {
  fila: number;
  motivo: MotivoRechazoFila;
  /** Lo que el servidor puede decir de esta fila, en castellano y sin traducir el enum. */
  detalle: string;
  /** Lo que se pudo leer -- para que quien mira la vista previa ubique la fila en su Excel. */
  codigo: string;
  inventarioId: number | null;
  ronda: number | null;
}

export type ResultadoLecturaCorrecciones =
  | {
      ok: true;
      /** Filas que CAMBIAN el valor y están bien formadas. Todavía falta validarlas contra la base. */
      aCorregir: readonly FilaLeida[];
      /** `Nuevo valor` igual a `Contado`: no se tocan, pero se informan. */
      sinCambio: readonly FilaSinCambio[];
      rechazadas: readonly FilaRechazada[];
    }
  | {
      /** El archivo entero: nunca una lista vacía disfrazando esto. */
      ok: false;
      motivo: 'archivo-invalido' | 'columna-faltante';
      detalle: string;
    };

// ---------------------------------------------------------------------------
// El lector
// ---------------------------------------------------------------------------

/** El mínimo de `motivoDeCorreccionSchema` (hojas.schema.ts): el mismo piso, para rechazar acá y no en la fila 400. */
const MOTIVO_MINIMO = 3;
const MOTIVO_MAXIMO = 200;

function ubicarColumnas(filaEncabezado: ExcelJS.Row): Map<string, number> {
  const encontradas = new Map<string, number>();
  filaEncabezado.eachCell({ includeEmpty: false }, (celda, numeroColumna) => {
    const texto = celda.value;
    if (typeof texto !== 'string') return;
    const clave = normalizar(texto);
    // Si una columna esperada viniera repetida, gana la PRIMERA.
    if (!encontradas.has(clave)) encontradas.set(clave, numeroColumna);
  });
  return encontradas;
}

function valorCrudo(celda: ExcelJS.Cell): unknown {
  const v = celda.value;
  if (v && typeof v === 'object' && 'result' in v) return (v as { result: unknown }).result;
  return v;
}

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

/** Un entero >= 0. `null` si no lo es: una unidad contada no es 2,5 ni -3. */
function entero(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isInteger(valor) && valor >= 0 ? valor : null;
  const t = texto(valor);
  if (t === '') return null;
  const n = Number(t.replace(',', '.'));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function enteroPositivo(valor: unknown): number | null {
  const n = entero(valor);
  return n === null || n === 0 ? null : n;
}

function mensajeColumnasFaltantes(faltantes: readonly string[]): string {
  return (
    `Faltan estas columnas: ${faltantes.join(', ')}. ` +
    `El importador necesita exactamente estas: ${COLUMNAS_REQUERIDAS.join(', ')}. ` +
    `Las demás (${COLUMNAS_INFORMATIVAS.join(', ')}) son informativas y pueden faltar. ` +
    'Lo más simple es exportar de nuevo y corregir sobre ese archivo.'
  );
}

/**
 * Lee el archivo y clasifica cada fila. NO toca la base: lo que depende del
 * inventario, del producto o del conteo lo resuelve el service.
 *
 * SOLO LA PRIMERA HOJA, igual que el lector de negativos: el exportador
 * escribe una segunda hoja con las instrucciones, y tiene que poder agregar
 * hojas sin que el importador las confunda con datos.
 */
export async function leerCorrecciones(buffer: Buffer): Promise<ResultadoLecturaCorrecciones> {
  const libro = new ExcelJS.Workbook();
  try {
    // `as any`: el Buffer que declara exceljs es un shim propio que nunca
    // matchea al Buffer real de Node -- incompatibilidad de TIPOS entre
    // paquetes, no del dato (mismo caso que liquidacion.ajustes-dynamics.ts).
    await libro.xlsx.load(buffer as any);
  } catch {
    return { ok: false, motivo: 'archivo-invalido', detalle: 'El archivo no se pudo leer como un Excel (.xlsx) válido.' };
  }

  const hoja = libro.worksheets[0];
  if (!hoja || hoja.rowCount === 0) {
    return {
      ok: false,
      motivo: 'columna-faltante',
      detalle: `El archivo no tiene encabezados. ${mensajeColumnasFaltantes(COLUMNAS_REQUERIDAS)}`,
    };
  }

  const columnas = ubicarColumnas(hoja.getRow(1));
  const faltantes = COLUMNAS_REQUERIDAS.filter((c) => !columnas.has(normalizar(c)));
  if (faltantes.length > 0) {
    return { ok: false, motivo: 'columna-faltante', detalle: mensajeColumnasFaltantes(faltantes) };
  }

  const idx = (clave: ClaveRequerida | 'Tienda'): number | undefined => columnas.get(normalizar(clave));
  const celda = (fila: ExcelJS.Row, clave: ClaveRequerida | 'Tienda'): unknown => {
    const i = idx(clave);
    return i === undefined ? undefined : valorCrudo(fila.getCell(i));
  };

  const aCorregir: FilaLeida[] = [];
  const sinCambio: FilaSinCambio[] = [];
  const rechazadas: FilaRechazada[] = [];
  /** `inventario|ronda|codigo` de las filas ya vistas: la segunda es ambigua. */
  const vistas = new Set<string>();

  for (let numeroFila = 2; numeroFila <= hoja.rowCount; numeroFila++) {
    const fila = hoja.getRow(numeroFila);
    if (fila.cellCount === 0 && fila.actualCellCount === 0) continue;

    const codigo = texto(celda(fila, 'Codigo'));
    const inventarioId = enteroPositivo(celda(fila, 'Inventario'));
    const ronda = enteroPositivo(celda(fila, 'Ronda'));

    // Fila realmente en blanco (exceljs cuenta filas vacías al final del
    // rango usado): no es una corrección rota, se saltea sin reportarla.
    if (codigo === '' && inventarioId === null && ronda === null) continue;

    if (inventarioId === null || ronda === null || codigo === '') {
      rechazadas.push({
        fila: numeroFila,
        motivo: 'clave-incompleta',
        detalle:
          'Esta fila no dice a qué conteo apunta: hacen falta Inventario, Ronda y Codigo, y los tres tienen que venir completos.',
        codigo,
        inventarioId,
        ronda,
      });
      continue;
    }

    const clave = `${inventarioId}|${ronda}|${codigo}`;
    if (vistas.has(clave)) {
      rechazadas.push({
        fila: numeroFila,
        motivo: 'fila-duplicada',
        detalle: `El código ${codigo} ya aparece antes en este archivo para el inventario ${inventarioId}, ronda ${ronda}. Dos filas para el mismo conteo no se pueden aplicar las dos: deja una sola.`,
        codigo,
        inventarioId,
        ronda,
      });
      continue;
    }
    vistas.add(clave);

    const crudoNuevoValor = celda(fila, 'Nuevo valor');
    const contado = entero(celda(fila, 'Contado'));
    const nuevoValor = entero(crudoNuevoValor);
    const motivo = texto(celda(fila, 'Motivo'));
    const tienda = idx('Tienda') === undefined ? null : texto(celda(fila, 'Tienda'));

    /**
     * `Nuevo valor` VACÍO = esta fila no se tocó, y es EL CASO MAYORITARIO.
     *
     * El exportador escribe esa celda en blanco a propósito (si viniera con el
     * valor actual, un pegado distraído haría que el archivo pareciera no
     * cambiar nada), así que la enorme mayoría del archivo vuelve con la celda
     * como salió. Leer eso como "dato faltante" rechazaría casi todas las
     * filas de cada importación.
     *
     * BUG REAL, encontrado probando el circuito contra la base (2026-10-13):
     * de las cinco filas de Market Sucre, las dos que no se tocaron volvieron
     * como `valor-invalido`.
     */
    const sinTocar = texto(crudoNuevoValor) === '';

    /**
     * SIN CAMBIO, PERO NUNCA EN SILENCIO. Dos formas de no tocar una fila: no
     * escribir nada, o escribir el mismo número que ya estaba. Las dos salen
     * acá, se informan con su veredicto y se cuentan en el resumen -- la vista
     * previa dice "38 sin cambio, 5 a corregir" ANTES de confirmar, que es
     * donde quien creyó haber cambiado algo se entera de que no lo cambió.
     *
     * Y si además escribió un MOTIVO, se avisa: lo más probable es que quisiera
     * cambiar el número y se haya olvidado.
     */
    const noCambia = sinTocar || (contado !== null && nuevoValor === contado);
    if (noCambia) {
      sinCambio.push({
        fila: numeroFila,
        inventarioId,
        ronda,
        codigo,
        contado,
        advertencias: motivo.length >= MOTIVO_MINIMO ? ['motivo-sin-cambio'] : [],
      });
      continue;
    }

    /**
     * De acá para abajo la fila SÍ cambia algo, así que los dos números tienen
     * que ser legibles. Un valor escrito y no numérico es un dato roto -- muy
     * distinto de la celda en blanco de arriba.
     */
    if (contado === null || nuevoValor === null) {
      rechazadas.push({
        fila: numeroFila,
        motivo: 'valor-invalido',
        detalle:
          'Contado y Nuevo valor tienen que ser números enteros de cero para arriba, en unidades. Una unidad contada no es 2,5 ni un número negativo.',
        codigo,
        inventarioId,
        ronda,
      });
      continue;
    }

    /**
     * EL MOTIVO ES OBLIGATORIO EN LA FILA QUE CAMBIA, y la fila se rechaza --
     * no se aplica sin él ni se rechaza el archivo entero. Es el mismo piso de
     * `hojas.schema.ts#motivoDeCorreccionSchema` (3 a 200), chequeado acá para
     * que el problema aparezca en la vista previa con su número de fila y no
     * recién al intentar escribir.
     */
    if (motivo.length < MOTIVO_MINIMO) {
      rechazadas.push({
        fila: numeroFila,
        motivo: 'motivo-faltante',
        detalle: `Cambia el valor de ${contado} a ${nuevoValor} pero no dice por qué. El motivo es obligatorio en cada fila que cambia: estos números descuentan plata del sueldo de alguien.`,
        codigo,
        inventarioId,
        ronda,
      });
      continue;
    }

    if (motivo.length > MOTIVO_MAXIMO) {
      rechazadas.push({
        fila: numeroFila,
        motivo: 'motivo-faltante',
        detalle: `El motivo tiene ${motivo.length} caracteres y el máximo es ${MOTIVO_MAXIMO}.`,
        codigo,
        inventarioId,
        ronda,
      });
      continue;
    }

    aCorregir.push({ fila: numeroFila, inventarioId, ronda, codigo, contado, nuevoValor, motivo, tienda });
  }

  return { ok: true, aCorregir, sinCambio, rechazadas };
}
