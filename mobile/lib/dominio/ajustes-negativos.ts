/**
 * Dominio puro de "importar el Excel de ajustes de Dynamics" (Pantalla del
 * Auditor, contra backend/src/modules/liquidacion/liquidacion.ajustes-negativos.ts,
 * commit e39b370). Sin Prisma, sin fetch, sin React -- solo los tipos que
 * calcan la respuesta del lector, los textos de cada motivo, y la regla NULL
 * != 0 llevada a lo que la pantalla tiene que decir.
 */

// ---------------------------------------------------------------------------
// Vista previa (POST .../ajustes-negativos/preview)
// ---------------------------------------------------------------------------

export type MotivoRechazoLinea = 'otra-tienda' | 'datos-invalidos';
export type MotivoAdvertenciaLinea = 'importe-no-coincide' | 'fuera-de-periodo' | 'responsable-no-empleado';

export interface LineaAjusteNegativoValida {
  fila: number;
  codigo: string;
  nombre2: string;
  importe: number;
  motivoAjuste: string;
  responsable: string;
  advertencias: readonly MotivoAdvertenciaLinea[];
}

export interface LineaAjusteNegativoRechazada {
  fila: number;
  motivo: MotivoRechazoLinea;
}

/**
 * Misma forma que `ResultadoLecturaAjustes` del backend: `ok:false` es el
 * archivo entero sin poder leer (columna faltante o no es un .xlsx), nunca
 * una lista vacía disfrazándolo -- ver el 0 explícito más abajo.
 */
export type ResultadoPreviewAjustesNegativos =
  | {
      ok: true;
      validas: readonly LineaAjusteNegativoValida[];
      rechazadas: readonly LineaAjusteNegativoRechazada[];
      totalImporte: number;
    }
  | { ok: false; motivo: 'columna-faltante' | 'archivo-invalido'; detalle: string };

/** Por qué una línea NO entra a la suma, nunca en silencio. */
export function textoMotivoRechazo(motivo: MotivoRechazoLinea): string {
  switch (motivo) {
    case 'otra-tienda':
      return 'Es de otra tienda: el Almacén de esa fila no es el de esta sucursal.';
    case 'datos-invalidos':
      return 'Cantidad, Precio, Importe o la fecha de "Registrado en" no se pudieron leer.';
  }
}

/** La línea SIGUE sumando -- esto es lo que el Auditor decide si excluir o no. */
export function textoMotivoAdvertencia(motivo: MotivoAdvertenciaLinea): string {
  switch (motivo) {
    case 'importe-no-coincide':
      return 'El Importe no coincide con Cantidad × Precio.';
    case 'fuera-de-periodo':
      return 'La fecha de "Registrado en" cae fuera del período de este inventario.';
    case 'responsable-no-empleado':
      return 'El Responsable no dice "Empleado".';
  }
}

// ---------------------------------------------------------------------------
// Estado de los negativos del inventario: NULL != 0
// ---------------------------------------------------------------------------

export type EstadoNegativos = 'sin-importar' | 'importado';

export interface EstadoNegativosVisible {
  estado: EstadoNegativos;
  /** Mismo criterio que liquidacion.cierre.ts: NULL bloquea, 0 no. */
  bloqueaLiquidar: boolean;
  /** `null` mientras no se importó nada -- nunca 0 por defecto. */
  monto: number | null;
  texto: string;
}

const TEXTO_SIN_IMPORTAR =
  'Todavía no se importó el Excel de ajustes de este mes: esto bloquea liquidar.';
const TEXTO_IMPORTADO_SIN_LINEAS =
  'Se importó el Excel de este mes: no había ninguna línea útil que reportar.';
const TEXTO_IMPORTADO_CON_MONTO = 'Excel de ajustes importado.';

/**
 * `montoNegativos` tal como lo devuelve `GET .../ajustes`
 * (`ResultadoInventario.montoNegativos`, backend). `null` = nadie importó
 * nada todavía; `0` = alguien importó un archivo válido sin líneas útiles --
 * un hecho verificado, no lo mismo que "no se hizo nada".
 */
export function estadoNegativos(montoNegativos: number | null): EstadoNegativosVisible {
  if (montoNegativos === null) {
    return { estado: 'sin-importar', bloqueaLiquidar: true, monto: null, texto: TEXTO_SIN_IMPORTAR };
  }
  return {
    estado: 'importado',
    bloqueaLiquidar: false,
    monto: montoNegativos,
    texto: montoNegativos === 0 ? TEXTO_IMPORTADO_SIN_LINEAS : TEXTO_IMPORTADO_CON_MONTO,
  };
}

// ---------------------------------------------------------------------------
// El monto que se muestra
// ---------------------------------------------------------------------------

/** Suma de `importe` de las líneas NO excluidas -- lo que la pantalla muestra tras excluir/incluir. */
export function totalLineasNoExcluidas(lineas: readonly { importe: number; excluida: boolean }[]): number {
  return lineas.reduce((acumulado, l) => acumulado + (l.excluida ? 0 : l.importe), 0);
}
