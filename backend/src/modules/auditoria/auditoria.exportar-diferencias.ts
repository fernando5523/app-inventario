/**
 * EL .XLSX CON EL DETALLE POR PRODUCTO de los faltantes y sobrantes de TODAS
 * las tiendas de un periodo -- el archivo que respalda la tabla de tiendas del
 * panel de auditoria (`GET /api/auditoria/cadena`).
 *
 * Pedido textual del usuario (Fernando): *"Incluir los sobrantes y faltantes en
 * la tabla, asi puede sacar sus calculos y exportar el detalle de sobrantes y
 * faltantes por productos"*. La tabla le dice "Luzuriaga, S/ 1.204 al
 * personal"; este archivo le dice CUALES productos son esos S/ 1.204, en que
 * zona y en que hoja se contaron, y con que empaque se midieron.
 *
 * SIN Prisma (regla de capas, ver backend/README.md): recibe filas ya armadas y
 * arma el libro, para poder probarlo sin base de datos.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO SE REUSA `GET /api/historial/diferencias/exportar` -- MEDIDO
 * ---------------------------------------------------------------------------
 * Ese endpoint (`historial.service.ts#exportarDiferenciasConsolidado`) ya baja
 * varias tiendas de un periodo en una tabla plana, una fila por producto. Se
 * verifico contra la base de desarrollo el 2026-09-25 si servia para esto, y NO
 * sirve, por tres razones concretas:
 *
 *   1. Lee la tabla `DiferenciaItem`, que se escribe UNA sola vez: al CERRAR el
 *      ajuste (`rondas.service.ts`, la transaccion que pasa el inventario a
 *      `conteo_cerrado`). Antes de eso no hay filas.
 *   2. Los dos inventarios de 2026-09 que hay en la base estan en
 *      `ajuste_auditor` (8078, Luzuriaga, 985 items) y `en_curso` (8079,
 *      Trujillo Piloto, 40 items), con **0 filas** en `DiferenciaItem` los dos.
 *      Se bajo el archivo del historial por API para ese periodo y trae **0
 *      filas de producto**, mientras este trae 6. O sea: aquel bajaria VACIO
 *      justo en el estado en que el Auditor necesita el detalle -- mientras
 *      decide, ANTES de cerrar.
 *   3. Filtra a `CatalogoItem.responsable === 'empleado'`, asi que descarta los
 *      items de empresa, que la tabla de la cadena SI muestra en su cuadro.
 *
 * Este archivo sale de la MATRIZ VIVA -- `armarMatriz` ->
 * `aplicarClasificacionVigente` -> `detalleDeDiferencias` -- la misma fuente,
 * item por item, que alimenta la tabla. `historial.*` no se toca.
 *
 * ---------------------------------------------------------------------------
 * REGLAS NO NEGOCIABLES DEL CLIENTE (las mismas que historial.exportar.ts)
 * ---------------------------------------------------------------------------
 *   - TABLA PLANA: encabezados en la fila 1, una fila por producto, CERO celdas
 *     combinadas, CERO titulos decorativos, CERO filas en blanco. Una tabla
 *     dinamica que encuentra un titulo o una celda combinada rompe el
 *     agrupamiento -- por eso ni negrita se le pone al encabezado.
 *   - NUMERO COMO NUMERO, nunca como texto: `addRow` con un `number` de JS
 *     entra como NumberValue solo; un string queda alineado a la izquierda y
 *     fuera de cualquier SUMA de una tabla dinamica.
 *   - El periodo va como DOS COLUMNAS NUMERO (año y mes), no como texto
 *     "2026-09" ni como `Date`.
 *   - CELDA VACIA, NUNCA 0, cuando el snapshot no trajo precio: un item sin
 *     precio no vale 0, no se sabe cuanto vale (es la regla que ya sostiene
 *     `diferenciaValor`). `null` en `addRow` deja la celda vacia -- exceljs no
 *     escribe la palabra "null".
 *   - CERO FILAS NO ES ERROR: el archivo sale igual con solo el encabezado,
 *     mismo criterio que `armarLibroDiferencias([])`.
 *
 * ---------------------------------------------------------------------------
 * `Diferencia` Y `Monto` VAN CON SIGNO
 * ---------------------------------------------------------------------------
 * Negativo = faltante. La columna `Tipo` dice lo mismo en palabras, para poder
 * filtrar; el numero lleva el signo porque una tabla dinamica que suma una
 * columna de MAGNITUDES da un total que no existe (los faltantes y los
 * sobrantes se sumarian entre si en vez de compensarse).
 *
 * ---------------------------------------------------------------------------
 * LA COLUMNA `Cuadro` ES LA DEL PANEL, Y TIENE QUE CERRAR CONTRA EL
 * ---------------------------------------------------------------------------
 * Las tres etiquetas -- `Al personal`, `Por paquete`, `Empresa` -- son las que
 * el Auditor lee en la tabla de tiendas, y por eso son las del archivo:
 *
 *     suma de `Monto` con Cuadro = "Al personal" y Tipo = "Faltante"
 *        ==  la columna "Al personal" de la tabla de tiendas
 *        ==  `resumir(matriz, umbral).porClase.unidad.valorFaltante`
 *
 * Se corresponden una a una con los cuadros de la planilla que Gilmer arma a
 * mano (`historial.exportar-cuadros.ts`): `Al personal` son sus cuadros
 * "UNICO" (faltantes y sobrantes), `Por paquete` sus cuadros "POR PAQUETE", y
 * `Empresa` su hoja EMPRESA. Es la MISMA decision, tomada por la MISMA funcion
 * (`auditoria.calculos.ts#cuadroDeLaDiferencia`), no una traduccion: dos
 * repartos distintos para el mismo item serian dos archivos que se contradicen.
 */

import ExcelJS from 'exceljs';
import type { CuadroDeDestino, FilaDetalleDiferencia } from './auditoria.calculos';

/**
 * Una fila del archivo: el detalle del producto mas DE QUE TIENDA ES.
 *
 * `sucursal` es la columna que hace util al consolidado y no un lujo: una tabla
 * dinamica lee UNA tabla contigua, no diez hojas. Sin ella, el Auditor tendria
 * que bajar diez archivos y pegarlos a mano para preguntar "cuanto falta de
 * este producto en toda la cadena".
 */
export interface FilaExportDiferenciaCadena extends FilaDetalleDiferencia {
  sucursal: string;
  periodoAnio: number;
  periodoMes: number;
  inventarioId: number;
}

/**
 * Encabezados EXACTOS de la fila 1, en el mismo orden que
 * `filaAOrdenDeColumnas`. Una sola fuente para las dos cosas: quien agregue una
 * columna acá ya sabe que tiene que tocar la otra funcion (el test de
 * "encabezado exacto" los compara contra esta misma lista).
 */
export const ENCABEZADOS_EXPORT_DIFERENCIAS_CADENA = [
  'Sucursal',
  'Año',
  'Mes',
  'Inventario',
  'Código',
  'Descripción',
  'Zona',
  'Hoja',
  'Empaque',
  'Cuadro',
  'Tipo',
  'Stock ERP',
  'Conteo final',
  'Diferencia',
  'Precio unitario',
  'Monto',
] as const;

/**
 * Las etiquetas del PANEL, no los nombres internos de las clases. El Auditor
 * lee "Al personal" en la pantalla y tiene que leer lo mismo en el archivo para
 * poder cruzarlos -- `unidad` no le dice nada a quien no leyo el codigo.
 */
const ETIQUETA_DE_CUADRO: Record<CuadroDeDestino, string> = {
  unidad: 'Al personal',
  paquete: 'Por paquete',
  empresa: 'Empresa',
};

const ETIQUETA_DE_TIPO: Record<FilaDetalleDiferencia['tipo'], string> = {
  faltante: 'Faltante',
  sobrante: 'Sobrante',
};

/**
 * LA COLUMNA `Empaque`, con la regla del empaque verbatim resuelta para una
 * sola celda.
 *
 * El simbolo del ERP VA TAL CUAL ("Emp.6"), nunca traducido a "caja" ni a
 * "display" ni reemplazado por el numero: es de donde sale la regla del umbral
 * y es lo unico que se puede señalar si mañana alguien discute un descuento
 * (ver el comentario de la columna en schema.prisma).
 *
 * CUANDO EL AUDITOR LO CORRIGIO, la celda tiene que decirlo -- y decirlo SIN
 * pisar lo que dijo Dynamics. La matriz resuelve esto llevando los tres datos
 * separados (`empaqueSimbolo`, `empaqueUsado`, `empaqueEsCorregido`, ver
 * `atribucionDelItem`) y dejando que la pantalla escriba "empaque 12 (corregido
 * por el auditor)". Acá hay UNA columna, asi que los tres entran en el texto:
 *
 *     sin correccion          ->  "Emp.6"
 *     corregido a 12          ->  "Emp.6 (corregido por el auditor a 12)"
 *     sin simbolo, corregido  ->  "Corregido por el auditor a 12"
 *
 * Lo que NO se hace es escribir "Emp.12": ese simbolo no existe en el ERP y
 * quien buscara el producto por el no lo encontraria. El numero corregido dice
 * que lo puso el auditor, siempre.
 *
 * Que la celda quede distinta parte en dos una categoria de tabla dinamica, y
 * eso es DESEADO: el Auditor quiere ver cuales se midieron con un empaque que
 * el corrigio y cuales con el que vino del ERP.
 */
export function textoDeEmpaque(
  fila: Pick<FilaDetalleDiferencia, 'empaqueSimbolo' | 'empaqueUsado' | 'empaqueEsCorregido'>,
): string | null {
  // `empaqueEsCorregido` sin `empaqueUsado` no puede pasar (el corregido ES el
  // usado, ver `empaqueEfectivo`); si pasara, manda lo que dijo el ERP.
  if (!fila.empaqueEsCorregido || fila.empaqueUsado === null) return fila.empaqueSimbolo;
  return fila.empaqueSimbolo === null
    ? `Corregido por el auditor a ${fila.empaqueUsado}`
    : `${fila.empaqueSimbolo} (corregido por el auditor a ${fila.empaqueUsado})`;
}

function filaAOrdenDeColumnas(f: FilaExportDiferenciaCadena): (string | number | null)[] {
  return [
    f.sucursal,
    f.periodoAnio,
    f.periodoMes,
    f.inventarioId,
    f.codigo,
    f.descripcion,
    f.zona,
    f.hoja,
    textoDeEmpaque(f),
    ETIQUETA_DE_CUADRO[f.cuadro],
    ETIQUETA_DE_TIPO[f.tipo],
    f.stockErp,
    f.conteoFinal,
    f.diferencia,
    f.precioUnitario,
    f.monto,
  ];
}

/**
 * El libro: UNA hoja llamada `Diferencias`, sin fusionar celdas, sin fila de
 * titulo, sin fila en blanco entre el encabezado y los datos.
 *
 * UNA SOLA HOJA aunque haya diez tiendas: la columna `Sucursal` las distingue
 * fila por fila. Una hoja por tienda obligaria a pegarlas a mano antes de poder
 * pivotear, que es exactamente el trabajo que el archivo viene a sacar.
 */
export async function armarLibroDiferenciasCadena(
  filas: readonly FilaExportDiferenciaCadena[],
): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Diferencias');

  hoja.addRow([...ENCABEZADOS_EXPORT_DIFERENCIAS_CADENA]);
  for (const fila of filas) {
    hoja.addRow(filaAOrdenDeColumnas(fila));
  }

  const buffer = await libro.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * "diferencias-cadena-2026-09.xlsx" -- SIN espacios ni acentos, mismo criterio
 * que `historial.exportar.ts#nombreArchivoExportDiferencias`: es un archivo que
 * se manda por WhatsApp o correo, y un nombre con "í" o con espacios puede
 * llegar recodificado distinto del otro lado.
 *
 * SIN nombre de tienda ni de inventario, igual que el consolidado del
 * historial: el archivo mezcla las tiendas de la cadena, asi que ninguna de las
 * dos identifica el contenido -- la columna `Sucursal` si, fila por fila.
 *
 * EL NOMBRE LO MANDA EL SERVIDOR (en el `Content-Disposition`) y no el front, y
 * no es un detalle: sin `anio`/`mes` en la query el periodo lo resuelve el
 * servidor con su propio reloj, asi que el front no sabe de que mes es el
 * archivo que acaba de bajar.
 */
export function nombreArchivoDiferenciasCadena(periodoAnio: number, periodoMes: number): string {
  return `diferencias-cadena-${periodoAnio}-${String(periodoMes).padStart(2, '0')}.xlsx`;
}
