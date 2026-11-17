/**
 * EL EXCEL DE AJUSTES DE DYNAMICS: los negativos del mes que bajan el faltante
 * antes de repartirlo entre el personal.
 *
 * Portado de `mobile/lib/dominio/ajustes-negativos.ts` SIN cambiarle un texto.
 * Son las palabras que ya se discutieron con el cliente y que explican, cuando
 * una línea no entra, por qué no entra: de esas líneas sale plata que se le
 * deja de descontar a alguien.
 *
 * Es un archivo sin React a propósito: así se prueba sin montar la pantalla
 * (ver `ajustesNegativos.test.ts`).
 */

// ---------------------------------------------------------------------------
// La previsualización: lo que el lector del Excel encontró, sin persistir nada
// ---------------------------------------------------------------------------

export type MotivoRechazoLinea = 'otra-tienda' | 'datos-invalidos'
export type MotivoAdvertenciaLinea = 'importe-no-coincide' | 'fuera-de-periodo' | 'responsable-no-empleado'

export interface LineaAjusteNegativoValida {
  fila: number
  codigo: string
  nombre2: string
  importe: number
  motivoAjuste: string
  responsable: string
  advertencias: readonly MotivoAdvertenciaLinea[]
}

export interface LineaAjusteNegativoRechazada {
  fila: number
  motivo: MotivoRechazoLinea
}

export type ResultadoPreviewAjustesNegativos =
  | {
      ok: true
      validas: readonly LineaAjusteNegativoValida[]
      rechazadas: readonly LineaAjusteNegativoRechazada[]
      totalImporte: number
    }
  | { ok: false; motivo: 'columna-faltante' | 'archivo-invalido'; detalle: string }

/**
 * POR QUÉ UNA LÍNEA NO ENTRA. Se nombra la columna del Excel, no un código:
 * quien lo lee tiene el archivo abierto al lado y necesita saber dónde mirar.
 */
export function textoMotivoRechazo(motivo: MotivoRechazoLinea): string {
  switch (motivo) {
    case 'otra-tienda':
      return 'Es de otra tienda: el Almacén de esa fila no es el de esta sucursal.'
    case 'datos-invalidos':
      return 'Cantidad, Precio, Importe o la fecha de "Registrado en" no se pudieron leer.'
  }
}

/** La línea SÍ entra, pero con algo raro que conviene mirar antes de confirmar. */
export function textoMotivoAdvertencia(motivo: MotivoAdvertenciaLinea): string {
  switch (motivo) {
    case 'importe-no-coincide':
      return 'El Importe no coincide con Cantidad × Precio.'
    case 'fuera-de-periodo':
      return 'La fecha de "Registrado en" cae fuera del período de este inventario.'
    case 'responsable-no-empleado':
      return 'El Responsable no dice "Empleado".'
  }
}

// ---------------------------------------------------------------------------
// El estado del monto de negativos
// ---------------------------------------------------------------------------

export type EstadoNegativos = 'sin-importar' | 'importado'

export interface EstadoNegativosVisible {
  estado: EstadoNegativos
  bloqueaLiquidar: boolean
  monto: number | null
  texto: string
}

const TEXTO_SIN_IMPORTAR = 'Todavía no se importó el Excel de ajustes de este mes: esto bloquea liquidar.'
const TEXTO_IMPORTADO_SIN_LINEAS = 'Se importó el Excel de este mes: no había ninguna línea útil que reportar.'
const TEXTO_IMPORTADO_CON_MONTO = 'Excel de ajustes importado.'

/**
 * `null` y `0` DICEN COSAS DISTINTAS: `null` es "nadie importó nada todavía" y
 * bloquea liquidar; `0` es "se importó y no había líneas útiles", que es un
 * dato y destraba. Colapsarlos dejaría la liquidación trabada sin motivo.
 */
export function estadoNegativos(montoNegativos: number | null): EstadoNegativosVisible {
  if (montoNegativos === null) {
    return { estado: 'sin-importar', bloqueaLiquidar: true, monto: null, texto: TEXTO_SIN_IMPORTAR }
  }
  return {
    estado: 'importado',
    bloqueaLiquidar: false,
    monto: montoNegativos,
    texto: montoNegativos === 0 ? TEXTO_IMPORTADO_SIN_LINEAS : TEXTO_IMPORTADO_CON_MONTO,
  }
}

// ---------------------------------------------------------------------------
// Las líneas ya guardadas, y excluir o volver a incluir una
// ---------------------------------------------------------------------------

export interface LineaAjusteNegativoGuardada {
  id: number
  fila: number
  codigo: string
  descripcion: string
  importe: number
  excluida: boolean
  motivoExclusion: string | null
  excluidaPor: { id: number; nombre: string } | null
  excluidaEn: string | null
}

export interface ImportacionVigente {
  id: number
  nombreArchivo: string
  importadoPor: { id: number; nombre: string }
  importadoEn: string
}

/** `GET /api/liquidacion/inventarios/:id/ajustes-negativos/lineas`. */
export interface ListadoLineasAjustesNegativos {
  importacion: ImportacionVigente | null
  lineas: readonly LineaAjusteNegativoGuardada[]
  /** `false` = el inventario ya se liquidó o lacró: las líneas quedan firmes. */
  puedeEditar: boolean
}

/** Lo que de verdad suma: las que nadie excluyó. */
export function totalLineasNoExcluidas(lineas: readonly { importe: number; excluida: boolean }[]): number {
  return lineas.reduce((acumulado, l) => acumulado + (l.excluida ? 0 : l.importe), 0)
}

export type AccionLinea = 'excluir' | 'incluir'

export function accionDeLinea(excluida: boolean): AccionLinea {
  return excluida ? 'incluir' : 'excluir'
}

export interface TextosAccionLinea {
  etiqueta: string
  titulo: string
  placeholder: string
}

export function textosAccionLinea(accion: AccionLinea): TextosAccionLinea {
  return accion === 'excluir'
    ? {
        etiqueta: 'Excluir',
        titulo: 'Excluir esta línea',
        placeholder: 'Por qué esta línea no corresponde (el motivo del ajuste está mal, es de otro período…)',
      }
    : {
        etiqueta: 'Volver a incluir',
        titulo: 'Volver a incluir esta línea',
        placeholder: 'Por qué esta línea vuelve a contar',
      }
}

export const MOTIVO_LINEA_MAXIMO = 500

/**
 * EL MOTIVO ES OBLIGATORIO, y el mensaje dice por qué: queda firmado con el
 * nombre de quien lo escribió y es lo que se audita después. Sin eso, excluir
 * una línea sería bajar el monto sin dejar rastro de quién ni por qué.
 */
export function errorDeMotivoLinea(accion: AccionLinea, motivo: string): string | null {
  const limpio = motivo.trim()
  if (limpio.length === 0) {
    return accion === 'excluir'
      ? 'Escribe por qué se excluye esta línea: queda registrado con tu nombre y es lo que se audita después.'
      : 'Escribe por qué esta línea vuelve a contar: queda registrado con tu nombre.'
  }
  if (limpio.length > MOTIVO_LINEA_MAXIMO) {
    return `El motivo no puede pasar de ${MOTIVO_LINEA_MAXIMO} caracteres: llevas ${limpio.length}.`
  }
  return null
}

export const TEXTO_LINEAS_BLOQUEADAS =
  'Este inventario ya se liquidó: excluir o volver a incluir una línea queda bloqueado. No se toca la plata de algo que ya se cerró.'

// ---------------------------------------------------------------------------
// Lo que se dice en cada paso de la importación
// ---------------------------------------------------------------------------

export function tituloPreviewFallido(motivo: 'columna-faltante' | 'archivo-invalido'): string {
  return motivo === 'columna-faltante' ? 'Faltan columnas en el archivo' : 'El archivo no se pudo leer'
}

export interface ResumenPreview {
  validas: number
  rechazadas: number
  conAdvertencia: number
  totalImporte: number
}

export function resumenPreview(preview: Extract<ResultadoPreviewAjustesNegativos, { ok: true }>): ResumenPreview {
  return {
    validas: preview.validas.length,
    rechazadas: preview.rechazadas.length,
    conAdvertencia: preview.validas.filter((v) => v.advertencias.length > 0).length,
    totalImporte: preview.totalImporte,
  }
}

/**
 * QUÉ SE VA A GUARDAR, con la cifra, ANTES de confirmar. Un "¿confirmas?" sin
 * el monto no le da a nadie con qué decidir, y este monto es el que baja el
 * faltante que se reparte entre el personal.
 */
export function textoQueSeConfirma(resumen: ResumenPreview, soles: (n: number) => string): string {
  const cuantas = resumen.validas === 1 ? '1 línea' : `${resumen.validas} líneas`
  const afuera =
    resumen.rechazadas === 0
      ? ''
      : ` ${resumen.rechazadas === 1 ? '1 línea queda' : `${resumen.rechazadas} líneas quedan`} afuera y no suman.`
  return `Se van a guardar ${cuantas} por ${soles(resumen.totalImporte)}, que es lo que va a sumar a favor del personal.${afuera}`
}

export interface ImportacionConfirmada {
  nombreArchivo: string
  cantidadValidas: number
  montoNegativos: number
}

export function textoImportacionConfirmada(r: ImportacionConfirmada, soles: (n: number) => string): string {
  const cuantas = r.cantidadValidas === 1 ? '1 línea' : `${r.cantidadValidas} líneas`
  return `${r.nombreArchivo}: ${cuantas} guardada${r.cantidadValidas === 1 ? '' : 's'} por ${soles(r.montoNegativos)}. Ya es el monto de ajustes de este inventario.`
}

export type EstadoDeLaImportacion = 'sin-importar' | 'vigente'

export interface VistaImportar {
  estado: EstadoDeLaImportacion
  titulo: string
  boton: string
  /** Qué pasa con la importación anterior. `null` cuando no hay ninguna. */
  nota: string | null
}

/**
 * REEMPLAZAR NO ES BORRAR, y la nota lo dice: la importación anterior deja de
 * contar y queda registrada. Sin esa frase, "importar otro archivo" se lee
 * como una operación que pisa el historial.
 */
export function vistaImportar(importacion: ImportacionVigente | null): VistaImportar {
  if (importacion === null) {
    return {
      estado: 'sin-importar',
      titulo: 'Importar el Excel del mes',
      boton: 'Elegir archivo .xlsx',
      nota: null,
    }
  }
  return {
    estado: 'vigente',
    titulo: 'Reemplazar el Excel importado',
    boton: 'Elegir otro archivo .xlsx',
    nota: `Ya hay una importación vigente: ${importacion.nombreArchivo}. Al confirmar otra, esta deja de contar y el monto se recalcula con el archivo nuevo. La anterior queda registrada, no se borra.`,
  }
}
